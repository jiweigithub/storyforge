import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { sha256, readerMessages } from './narrative-reader-contract.mjs'
import { loadIncompleteReaderJudgeCoverageV1 } from './narrative-reader-judge-coverage.mjs'
import { validateJudgeContinuationParent } from './narrative-reader-judge-contract.mjs'

const base = 'tests/acceptance/narrative-world/'
const readerProtocol = JSON.parse(readFileSync(new URL(`../${base}reader-protocol-20261015-v4.json`, import.meta.url)))
function fixture() {
  const files = new Map(), directories = new Map(), run = `${base}raw/test-reader`, callsPath = `${run}/calls`
  const diagnosticPath = `${base}test-diagnostic.json`, policyPath = `${base}test-coverage.json`
  const put = (path, value) => files.set(path, Buffer.from(JSON.stringify(value)))
  const get = path => JSON.parse(files.get(path))
  const answer = { status: 'answered', answer: '铜铃在桌上。', citations: [{ documentId: 'D1', quote: '铜铃在桌上。' }] }
  const cases = ['v3-provider', 'ir-lexical', 'ir-no-time', 'lexical-original'].map((condition, index) => ({
    id: `test:q${Math.max(1, index)}/${condition}`, familyId: 'test', split: 'development', condition,
    question: { id: `test:q${Math.max(1, index)}`, operation: 'original-read', question: index < 2 ? '铜铃在哪里？' : `未决问题${index}？`, view: 'author', branch: 'canon' },
    context: { status: 'matched', diagnostics: [], documents: [{ id: 'one', title: '第一段', kind: 'chapter', text: '铜铃在桌上。', atom: null, evidence: [] }] },
  }))
  const identities = [], observations = [], rows = []
  for (const [index, item] of cases.entries()) {
    const prepared = readerMessages(item, readerProtocol), hash = prepared.promptHash
    identities.push({ id: item.id, promptHash: hash })
    put(`${callsPath}/${hash}.request.json`, { promptHash: hash, model: readerProtocol.model, messages: prepared.messages })
    put(`${callsPath}/${hash}.started.json`, { promptHash: hash, model: readerProtocol.model, startedAt: 'fixed-test-time' })
    const status = index < 2 ? 'completed' : index === 2 ? 'failed' : 'unknown'
    const identity = { id: item.id, questionId: item.question.id, familyId: item.familyId, split: item.split,
      operation: item.question.operation, condition: item.condition, promptHash: hash }
    observations.push({ ...identity, status, resultPath: status === 'unknown' ? null : `${callsPath}/${hash}.result.json`,
      unknownStartPath: status === 'unknown' ? `${callsPath}/${hash}.started.json` : null })
    if (status !== 'unknown') put(`${callsPath}/${hash}.result.json`, { promptHash: hash, model: readerProtocol.model,
      provider: readerProtocol.provider, status, dispatched: true, rawText: status === 'completed' ? JSON.stringify(answer) : '',
      usage: status === 'completed' ? { inputTokens: 100, outputTokens: 20 } : null })
    if (status === 'completed') rows.push({ ...identity, answer })
  }
  const inputsPath = `${base}test-inputs.json`, protocolPath = `${base}test-reader-protocol.json`, corpusPath = `${base}corpus-v1.json`
  put(corpusPath, { families: [] }); put(inputsPath, { sourceHashes: { [corpusPath]: sha256(files.get(corpusPath)) }, families: [{ id: 'test', cases }] })
  put(protocolPath, readerProtocol)
  put(`${run}/manifest.json`, { accepted: false, totalCases: 4, distinctPrompts: 3, provider: readerProtocol.provider, model: readerProtocol.model,
    inputsPath, inputsSha256: sha256(files.get(inputsPath)), protocolPath, protocolSha256: sha256(files.get(protocolPath)), cases: identities })
  directories.set(callsPath, [...files.keys()].filter(path => path.startsWith(`${callsPath}/`)).map(path => path.slice(callsPath.length + 1)))
  const report = { schema: 'storyforge.narrative-reader-incomplete-diagnostic', version: 1, run,
    manifestSha256: sha256(files.get(`${run}/manifest.json`)), accepted: false, executionComplete: false, semanticAcceptance: false,
    cohortFinishedUnattemptedInputs: true, conditionObservations: { unattempted: 0 }, observations, rows,
    inventories: Object.fromEntries(directories), hashes: Object.fromEntries([...files].map(([path, bytes]) => [path, sha256(bytes)])) }
  put(diagnosticPath, report)
  put(policyPath, { schema: 'storyforge.narrative-reader-judge-coverage-policy', version: 1, mode: 'incomplete-diagnostic-only', accepted: false,
    diagnosticPath, diagnosticSha256: sha256(files.get(diagnosticPath)), rubricVersion: 'content-disposition-grounding-scope-v2',
    missingReaderPolicy: 'retain-planned-denominator-never-dispatch-or-grade', completeMatrixAcceptance: false,
    expectedCoverage: { planned: 4, eligible: 2, failed: 1, unknown: 1, distinctReaderInputs: 3, successfulReaderInputs: 1 },
    unavailableReaderObservations: observations.filter(row => row.status !== 'completed').map(({ id, promptHash, status }) => ({ id, promptHash, status })) })
  const update = (path, change, repin = true) => {
    const value = get(path); change(value); put(path, value)
    if (repin && path !== policyPath) {
      if (path !== diagnosticPath) { const report = get(diagnosticPath); report.hashes[path] = sha256(files.get(path)); put(diagnosticPath, report) }
      const policy = get(policyPath); policy.diagnosticSha256 = sha256(files.get(diagnosticPath)); put(policyPath, policy)
    }
  }
  return { files, get, put, update, directories, diagnosticPath, policyPath, callsPath, observations,
    load: () => loadIncompleteReaderJudgeCoverageV1({ diagnosticPath, policyPath,
      readFrozen: async path => { if (!files.has(path)) throw Error(`missing ${path}`); return files.get(path) },
      listDirectory: async path => {
        if (!directories.has(path)) throw Object.assign(Error(`missing directory ${path}`), { code: 'ENOENT' })
        return directories.get(path)
      } }) }
}

test('incomplete diagnosis retains failed/unknown denominators and shares only successful frozen responses', async () => {
  const f = fixture(), result = await f.load()
  assert.deepEqual(result.coverage.counts, { planned: 4, eligible: 2, failed: 1, unknown: 1, distinctReaderInputs: 3, successfulReaderInputs: 1 })
  assert.equal(result.calls.size, 1); assert.equal(result.coverage.completeMatrixAcceptance, false)
  assert.deepEqual(result.coverage.unavailable.map(row => row.status), ['failed', 'unknown'])
  assert.deepEqual(result.coverage.byCondition['lexical-original'], { planned: 1, eligible: 0, failed: 0, unknown: 1 })
})
test('changed historical bytes fail before a judgment can be prepared', async () => {
  const f = fixture(); f.update(f.observations[0].resultPath, value => { value.rawText = '{}' }, false)
  await assert.rejects(f.load(), /evidence changed/)
})
test('Git-omitted empty directories are recorded explicitly; missing files and unlisted new results still fail', async () => {
  const f = fixture(), empty = `${f.callsPath}/empty`
  f.update(f.diagnosticPath, report => { report.inventories[f.callsPath].push('empty'); report.inventories[empty] = [] })
  assert.deepEqual((await f.load()).coverage.absentEmptyDirectories, [empty])
  f.update(f.diagnosticPath, report => { report.inventories[empty] = ['missing-result.json'] })
  await assert.rejects(f.load(), /missing directory/)
  const extra = fixture(); extra.directories.get(extra.callsPath).push('unlisted.result.json')
  await assert.rejects(extra.load(), /inventory changed/)
})
test('omitted or duplicate observation identities cannot shrink the planned matrix', async () => {
  for (const change of [report => { report.observations.pop() }, report => { report.observations[3] = report.observations[2] }]) {
    const f = fixture(); f.update(f.diagnosticPath, change); await assert.rejects(f.load(), /every original observation/)
  }
})
test('a failed response cannot be promoted to completed or supplied with a score', async () => {
  for (const change of [report => { report.observations[2].status = 'completed' }, report => { report.rows.push({ ...report.observations[2], answer: {} }) }]) {
    const f = fixture(); f.update(f.diagnosticPath, change); await assert.rejects(f.load(), /status or identity changed|cannot be scored/)
  }
})
test('unknown input never acquires an answer and must keep its frozen start evidence', async () => {
  const f = fixture(); f.update(f.diagnosticPath, report => { report.observations[3].resultPath = 'invented-result.json' })
  await assert.rejects(f.load(), /cannot be supplied or scored/)
  const missing = fixture(); missing.files.delete(missing.observations[3].unknownStartPath)
  await assert.rejects(missing.load(), /missing/)
})
test('row answers and successful usage are independently checked against the original terminal result', async () => {
  const f = fixture(); f.update(f.diagnosticPath, report => { report.rows[0].answer.answer = '被改写的回答' })
  await assert.rejects(f.load(), /differs from original reader answer/)
  const missing = fixture(); missing.update(missing.observations[0].resultPath, result => { result.usage = null })
  await assert.rejects(missing.load(), /bounded usage/)
})
test('changed frozen materials, missing directory inventory and acceptance promotion are refused', async () => {
  const f = fixture(); const request = f.observations[0].resultPath.replace('.result.json', '.request.json')
  f.update(request, value => { value.messages[1].content = 'replacement' }); await assert.rejects(f.load(), /request or frozen material/)
  const inventory = fixture(); inventory.update(inventory.diagnosticPath, report => { report.inventories = {} })
  await assert.rejects(inventory.load(), /lacks a frozen inventory/)
  const promoted = fixture(); promoted.update(promoted.policyPath, policy => { policy.completeMatrixAcceptance = true })
  await assert.rejects(promoted.load(), /coverage policy/)
})
test('continuation cannot cross evidence schemas or discard unavailable reader observations', () => {
  const parent = { schema: 'storyforge.narrative-reader-incomplete-judge-run', version: 1, accepted: false, protocolVersion: 2,
    entryId: 'judge', provider: 'subscription', model: 'judge', readerProvider: 'subscription', readerModel: 'reader', reasoningEffort: 'medium',
    totalObservations: 4, eligibleObservations: 2, distinctPrompts: 1, cases: [], dispatchOrder: ['one'], sourceHashes: {}, runtimeHashes: { script: 'one' },
    readerCoverage: { completeMatrixAcceptance: false, unavailable: ['failed', 'unknown'] } }
  assert.equal(validateJudgeContinuationParent(parent, structuredClone(parent)), parent)
  for (const change of [{ schema: 'storyforge.narrative-reader-judge-run' }, { eligibleObservations: 4 },
    { readerCoverage: { completeMatrixAcceptance: false, unavailable: [] } }]) {
    assert.throws(() => validateJudgeContinuationParent(parent, { ...parent, ...change }), /Continuation changes/)
  }
})
test('legacy complete-report entry still rejects the real incomplete report before creating a run or calling a model', () => {
  const result = spawnSync(process.execPath, ['scripts/evaluate-narrative-reader-judge-local-codex.mjs',
    '--reader-report', `${base}reader-incomplete-diagnostic-20261015-v1.json`, '--protocol', `${base}reader-judge-protocol-20261015-v2.json`,
    '--output', `${base}raw/never-created-incomplete-as-complete`], { encoding: 'utf8' })
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Unknown evaluation contract/)
})
