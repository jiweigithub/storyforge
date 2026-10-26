import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { sha256, readerMessages } from './narrative-reader-contract.mjs'
import { bindReaderCliTestParentToCurrentRuntime } from '../tests/helpers/narrative-reader-cli-fixture.mjs'
import { readerRequestArtifact, validateReaderCall, validateReaderContinuationParent, readReaderHistory,
  verifyReaderHistory, reserveReaderContinuation, readerExecutionCounts, readerSummaryName } from './narrative-reader-continuation.mjs'

const root = resolve(import.meta.dirname, '..')
const protocol = JSON.parse(readFileSync(resolve(root, 'tests/acceptance/narrative-world/reader-protocol-20261015-v3.json')))
const item = { question: { question: '铜铃在哪里？', operation: 'state', view: 'author', branch: 'canon' },
  context: { status: 'matched', diagnostics: [], documents: [] } }
const request = readerMessages(item, protocol), second = readerMessages({ ...item, question: { ...item.question, question: '铜铃何时交接？' } }, protocol)
const start = { promptHash: request.promptHash, model: protocol.model, startedAt: '2026-10-15T06:00:00Z' }
const failed = { ...start, provider: protocol.provider, status: 'failed', dispatched: true, rawText: '', usage: null,
  completedAt: '2026-10-15T06:00:01Z', durationMs: 1000, error: 'recorded connection failure' }
const answer = { status: 'insufficient', answer: '资料不足。', citations: [] }
const completed = { ...failed, status: 'completed', rawText: JSON.stringify(answer), answer, usage: { inputTokens: 100, outputTokens: 20 } }
const prior = result => ({ request: readerRequestArtifact(request, protocol), started: start, result })

test('prewritten requests remain unattempted, but a result cannot exist without its start', () => {
  assert.equal(validateReaderCall({ request: readerRequestArtifact(request, protocol) }, request, protocol), null)
  assert.throws(() => validateReaderCall({ request: readerRequestArtifact(request, protocol), result: failed }, request, protocol), /no start/)
})
test('historical reader messages, schema, model and budget metadata must match exactly', () => {
  for (const change of [value => value.messages[1].content += 'POISON', value => value.model = 'replacement',
    value => value.outputSchema = {}, value => value.inputBytes++, value => value.promptHash = '0'.repeat(64)]) {
    const value = structuredClone(prior(completed)); change(value.request)
    assert.throws(() => validateReaderCall(value, request, protocol), /request changed/)
  }
})
test('completed historical calls require valid raw answers, matching parsed answers and nonnegative bounded usage', () => {
  assert.deepEqual(validateReaderCall(prior(completed), request, protocol), completed)
  for (const change of [value => value.answer.answer = 'POISON', value => value.usage = null,
    value => value.usage.inputTokens = -1, value => value.usage.outputTokens = 4001,
    value => value.dispatched = false, value => value.rawText = '{}']) {
    const value = structuredClone(completed); change(value)
    assert.throws(() => validateReaderCall(prior(value), request, protocol))
  }
})
test('known terminal failures retain unknown usage; unknown or interrupted outcomes block continuation', () => {
  assert.deepEqual(validateReaderCall(prior(failed), request, protocol), failed)
  assert.throws(() => validateReaderCall(prior(undefined), request, protocol), /outcome is unknown/)
  assert.throws(() => validateReaderCall(prior({ ...failed, status: 'unknown-or-interrupted' }), request, protocol), /outcome is unknown/)
  assert.throws(() => validateReaderCall(prior({ ...failed, startedAt: 'other' }), request, protocol), /Invalid historical/)
})

function fixture(t) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'nw-reader-history-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const run = 'tests/acceptance/narrative-world/raw/parent', directory = resolve(temporary, run)
  mkdirSync(resolve(directory, 'calls'), { recursive: true })
  const write = (name, value) => writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2) + '\n')
  const preflight = { version: 2, dispatchAllowed: true }
  const frozen = { schema: 'storyforge.narrative-reader-run', version: 1, entryId: 'eval.narrative-world.fixed-reader', accepted: false,
    inputsPath: 'inputs.json', inputsSha256: 'input', protocolPath: 'protocol.json', protocolSha256: 'protocol',
    provider: protocol.provider, model: protocol.model, reasoningEffort: protocol.reasoningEffort,
    preflight: { version: 2, sha256: sha256(preflight), dispatchAllowed: true }, sourceHashes: { corpus: 'frozen' },
    cases: [{ id: 'first', promptHash: request.promptHash }, { id: 'second', promptHash: second.promptHash }], totalCases: 2, distinctPrompts: 2,
    runtimeHashes: { 'scripts/evaluate-narrative-reader-local-codex.mjs': 'old', 'scripts/narrative-reader-contract.mjs': 'stable',
      'src/lib/agent/ai-entry-registry.json': 'registered' } }
  write('manifest.json', frozen); write('preflight.json', preflight)
  for (const r of [request, second]) write(`calls/${r.promptHash}.request.json`, readerRequestArtifact(r, protocol))
  write(`calls/${request.promptHash}.started.json`, start); write(`calls/${request.promptHash}.result.json`, failed)
  const summary = { manifestSha256: sha256(frozen), notYetCalled: 1, completedActualCalls: 0, failedActualCalls: 1, completedCases: 0, rows: [] }
  write('summary-0001.json', summary)
  return { temporary, run, directory, write, frozen, summary, unique: new Map([[request.promptHash, request], [second.promptHash, second]]) }
}
test('continuation permits only orchestration changes, preserving every frozen input and transport identity', t => {
  const { frozen } = fixture(t), current = structuredClone(frozen)
  current.runtimeHashes['scripts/evaluate-narrative-reader-local-codex.mjs'] = 'new'
  assert.doesNotThrow(() => validateReaderContinuationParent(frozen, current))
  for (const key of ['inputsSha256', 'protocolSha256', 'provider', 'model', 'reasoningEffort', 'preflight', 'cases', 'sourceHashes']) {
    assert.throws(() => validateReaderContinuationParent(frozen, { ...current, [key]: 'changed' }), /changes frozen/)
  }
  for (const path of ['scripts/narrative-reader-contract.mjs', 'src/lib/agent/ai-entry-registry.json']) {
    assert.throws(() => validateReaderContinuationParent(frozen, {
      ...current, runtimeHashes: { ...current.runtimeHashes, [path]: 'changed' },
    }), /changes reader runtime/)
  }
})
test('settled parent replay retains the failed denominator while excluding its attempted input', async t => {
  const f = fixture(t), history = await readReaderHistory(f.temporary, f.run, f.frozen, f.unique, protocol)
  assert.deepEqual([...history.results.keys()], [request.promptHash])
  assert.equal(history.results.get(request.promptHash).usage, null)
  assert.equal(history.results.has(second.promptHash), false)
  await verifyReaderHistory(f.temporary, history.evidence)
})
test('missing terminal proof, forged summary or preflight cannot authorize a continuation', async t => {
  const f = fixture(t)
  f.write('summary-0001.json', { ...f.summary, notYetCalled: 2 })
  await assert.rejects(readReaderHistory(f.temporary, f.run, f.frozen, f.unique, protocol), /terminal summary/)
  f.write('summary-0001.json', f.summary); f.write('preflight.json', { version: 2, dispatchAllowed: false })
  await assert.rejects(readReaderHistory(f.temporary, f.run, f.frozen, f.unique, protocol), /preflight changed/)
})
test('historical evidence and directory inventories are rechecked, including newly started calls', async t => {
  const f = fixture(t), history = await readReaderHistory(f.temporary, f.run, f.frozen, f.unique, protocol)
  f.write(`calls/${second.promptHash}.started.json`, { ...start, promptHash: second.promptHash })
  await assert.rejects(verifyReaderHistory(f.temporary, history.evidence), /inventory changed/)
  await assert.rejects(readReaderHistory(f.temporary, f.run, f.frozen, f.unique, protocol), /outcome is unknown/)
})
test('one parent reserves one continuation without modifying parent evidence or allowing a fork', async t => {
  const f = fixture(t), history = await readReaderHistory(f.temporary, f.run, f.frozen, f.unique, protocol)
  const child = 'tests/acceptance/narrative-world/raw/child'
  const claim = await reserveReaderContinuation(f.temporary, f.run, history.manifestSha256, child)
  assert.equal(await reserveReaderContinuation(f.temporary, f.run, history.manifestSha256, child), claim)
  await assert.rejects(reserveReaderContinuation(f.temporary, f.run, history.manifestSha256, `${child}-fork`), /different continuation/)
  await verifyReaderHistory(f.temporary, history.evidence)
})
test('descendant replay preserves all ancestors and rejects changed lineage or duplicate attempts', async t => {
  const f = fixture(t), history = await readReaderHistory(f.temporary, f.run, f.frozen, f.unique, protocol)
  const child = 'tests/acceptance/narrative-world/raw/child', childDir = resolve(f.temporary, child)
  const claimPath = await reserveReaderContinuation(f.temporary, f.run, history.manifestSha256, child)
  mkdirSync(resolve(childDir, 'calls'), { recursive: true })
  const write = (name, value) => writeFileSync(resolve(childDir, name), JSON.stringify(value, null, 2) + '\n')
  const childManifest = { ...f.frozen, version: 2, continuation: { version: 1, run: f.run,
    manifestSha256: history.manifestSha256, claimPath, claimSha256: sha256(readFileSync(resolve(f.temporary, claimPath))),
    evidence: history.evidence, inheritedPromptHashes: [request.promptHash], unresolvedPromptHashes: [request.promptHash] } }
  write('manifest.json', childManifest); write('preflight.json', JSON.parse(readFileSync(resolve(f.directory, 'preflight.json'))))
  write(`calls/${second.promptHash}.request.json`, readerRequestArtifact(second, protocol))
  write(`calls/${second.promptHash}.started.json`, { ...start, promptHash: second.promptHash })
  write(`calls/${second.promptHash}.result.json`, { ...completed, promptHash: second.promptHash })
  write('summary-0002.json', { manifestSha256: sha256(childManifest), notYetCalled: 0, completedActualCalls: 1, failedActualCalls: 1,
    completedCases: 1, rows: [{ id: 'second', promptHash: second.promptHash, answer, usage: completed.usage, durationMs: completed.durationMs }] })
  const replay = await readReaderHistory(f.temporary, child, f.frozen, f.unique, protocol)
  assert.equal(replay.results.size, 2); assert.equal(replay.results.get(request.promptHash).status, 'failed')
  write('manifest.json', { ...childManifest, continuation: { ...childManifest.continuation, manifestSha256: 'changed' } })
  await assert.rejects(readReaderHistory(f.temporary, child, f.frozen, f.unique, protocol), /ancestry changed/)
  write('manifest.json', childManifest); write(`calls/${request.promptHash}.request.json`, readerRequestArtifact(request, protocol))
  await assert.rejects(readReaderHistory(f.temporary, child, f.frozen, f.unique, protocol), /repeated historical/)
})
test('call accounting separates pre-dispatch failures, unknown outcomes, unknown usage and unattempted inputs', () => {
  assert.deepEqual(readerExecutionCounts([completed, failed, { ...failed, dispatched: false }, { ...failed, status: 'unknown-or-interrupted' }], 7), {
    recordedAttempts: 4, actualCalls: 3, completedActualCalls: 1, failedActualCalls: 1,
    unknownActualCalls: 1, preDispatchFailures: 1, unknownUsageCalls: 2, unattempted: 3 })
  assert.notEqual(readerSummaryName(0), readerSummaryName(0))
})

test('isolated current-runtime parent dry-run excludes all 41 attempts, blocks forks and preserves startup failure without a model call', t => {
  const parent = 'tests/acceptance/narrative-world/raw/reader-fixed-20261015-v3'
  const output = `tests/acceptance/narrative-world/raw/test-reader-continuation-${randomUUID()}`
  const parentBytes = readFileSync(resolve(root, parent, 'manifest.json'))
  assert.throws(() => bindReaderCliTestParentToCurrentRuntime(root, parent), /Only an isolated reader test parent/)
  const claim = resolve(root, 'tests/acceptance/narrative-world/raw/reader-continuation-claims', `${sha256({ parent, parentManifestSha256: sha256(parentBytes) })}.json`)
  // The integration test owns a temporary parent copy so production claims are untouched.
  const copy = `${output}-parent`, copyDir = resolve(root, copy)
  mkdirSync(resolve(copyDir, 'calls'), { recursive: true })
  for (const name of readdirSync(resolve(root, parent))) if (name !== 'calls') writeFileSync(resolve(copyDir, name), readFileSync(resolve(root, parent, name)))
  for (const name of readdirSync(resolve(root, parent, 'calls'))) writeFileSync(resolve(copyDir, 'calls', name), readFileSync(resolve(root, parent, 'calls', name)))
  const copyManifestSha256 = bindReaderCliTestParentToCurrentRuntime(root, copy)
  const ownClaim = resolve(root, 'tests/acceptance/narrative-world/raw/reader-continuation-claims', `${sha256({ parent: copy, parentManifestSha256: copyManifestSha256 })}.json`)
  const originalClaim = existsSync(claim) ? readFileSync(claim) : null
  t.after(() => {
    rmSync(resolve(root, output), { recursive: true, force: true }); rmSync(copyDir, { recursive: true, force: true }); rmSync(ownClaim, { force: true })
  })
  const args = [resolve(root, 'scripts/evaluate-narrative-reader-local-codex.mjs'), '--inputs', 'tests/acceptance/narrative-world/reader-inputs-20261015-v6.json',
    '--protocol', 'tests/acceptance/narrative-world/reader-protocol-20261015-v3.json', '--output', output, '--continue-unstarted-from', copy]
  const run = extra => execFileSync(process.execPath, [...args, ...extra], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 20_000,
    env: { ...process.env, STORYFORGE_CODEX_BIN: resolve(copyDir, 'missing-codex') } })
  run(['--dry-run'])
  const manifest = JSON.parse(readFileSync(resolve(root, output, 'manifest.json')))
  assert.equal(manifest.version, 2); assert.equal(manifest.continuation.inheritedPromptHashes.length, 41)
  assert.equal(manifest.continuation.unresolvedPromptHashes.length, 1)
  assert.equal(readdirSync(resolve(root, output, 'calls')).length, 420)
  run(['--resume', '--dry-run'])
  assert.throws(() => execFileSync(process.execPath, [...args.map(value => value === output ? `${output}-fork` : value), '--dry-run'],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' }), error => /different continuation/.test(error.stderr))
  assert.throws(() => run(['--resume', '--max-calls', '1']), error => /run-failed-before-summary/.test(error.stderr))
  const summaries = readdirSync(resolve(root, output)).filter(name => name.startsWith('summary-')).map(name => JSON.parse(readFileSync(resolve(root, output, name))))
  assert.equal(summaries.length, 3)
  assert.ok(summaries.every(summary => summary.counts.actualCalls === 41 && summary.counts.unattempted === 420 && !summary.executionComplete && !summary.accepted))
  const failedStartup = summaries.find(summary => summary.runError)
  assert.equal(failedStartup.runError.newCohortAttempts, 0); assert.equal(failedStartup.historicalEvidenceUnchanged, true)
  assert.equal(readdirSync(resolve(root, output, 'calls')).filter(name => !name.endsWith('.request.json')).length, 0)
  assert.deepEqual(readFileSync(resolve(root, parent, 'manifest.json')), parentBytes)
  assert.deepEqual(existsSync(claim) ? readFileSync(claim) : null, originalClaim)
  assert.equal(relative(root, resolve(root, output)).startsWith('tests/acceptance/narrative-world/raw/'), true)
})
