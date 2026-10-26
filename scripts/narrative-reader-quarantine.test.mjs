import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { sha256, readerMessages } from './narrative-reader-contract.mjs'
import { readerRequestArtifact, verifyReaderHistory } from './narrative-reader-continuation.mjs'
import { readerEvaluationProtocol, readReaderQuarantine } from './narrative-reader-quarantine.mjs'
import { bindReaderCliTestParentToCurrentRuntime } from '../tests/helpers/narrative-reader-cli-fixture.mjs'

const root = resolve(import.meta.dirname, '..')
const protocol3 = JSON.parse(readFileSync(resolve(root, 'tests/acceptance/narrative-world/reader-protocol-20261015-v3.json')))
const protocol4 = JSON.parse(readFileSync(resolve(root, 'tests/acceptance/narrative-world/reader-protocol-20261015-v4.json')))
const raw = 'tests/acceptance/narrative-world/raw/'
const write = (root, path, value) => {
  mkdirSync(resolve(root, path, '..'), { recursive: true })
  writeFileSync(resolve(root, path), JSON.stringify(value, null, 2) + '\n')
}
function fixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'nw-reader-quarantine-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const run = `${raw}interrupted`, auditPath = `${raw}audit/interruption.json`
  const requests = ['位置', '时间', '见证人'].map(question => readerMessages({ question: { question, operation: 'state', view: 'author', branch: 'canon' },
    context: { status: 'matched', diagnostics: [], documents: [] } }, protocol3))
  const unique = new Map(requests.map(request => [request.promptHash, request]))
  const preflight = { version: 2, dispatchAllowed: true }
  const protocolPath = 'tests/acceptance/narrative-world/protocol3.json'
  write(directory, protocolPath, protocol3)
  const parent = { schema: 'storyforge.narrative-reader-run', version: 1, accepted: false,
    entryId: protocol3.entryId, inputsPath: 'inputs.json', inputsSha256: 'frozen', protocolPath,
    protocolSha256: sha256(readFileSync(resolve(directory, protocolPath))), provider: protocol3.provider, model: protocol3.model,
    reasoningEffort: protocol3.reasoningEffort, runtimeHashes: { 'scripts/narrative-reader-contract.mjs': 'unchanged' },
    preflight: { version: 2, sha256: sha256(preflight), dispatchAllowed: true }, sourceHashes: { corpus: 'unchanged' },
    cases: requests.map((r, i) => ({ id: String(i), promptHash: r.promptHash })), totalCases: 3, distinctPrompts: 3 }
  write(directory, `${run}/manifest.json`, parent); write(directory, `${run}/preflight.json`, preflight)
  for (const request of requests) write(directory, `${run}/calls/${request.promptHash}.request.json`, readerRequestArtifact(request, protocol3))
  const starts = requests.slice(0, 2).map(request => ({ promptHash: request.promptHash, model: protocol3.model, startedAt: '2026-10-15T06:00:00Z' }))
  for (const start of starts) write(directory, `${run}/calls/${start.promptHash}.started.json`, start)
  write(directory, `${run}/calls/${requests[0].promptHash}.result.json`, { ...starts[0], provider: protocol3.provider,
    status: 'failed', dispatched: true, rawText: '', usage: null, error: 'known failure', durationMs: 1000, completedAt: '2026-10-15T06:00:01Z' })
  const audit = { schema: 'storyforge.narrative-reader-continuation-evidence', version: 2, run,
    manifestSha256: sha256(readFileSync(resolve(directory, run, 'manifest.json'))), accepted: false, executionComplete: false,
    observedProcessTerminal: { sessionId: 123, exitCode: 1, terminalObservedAt: '2026-10-15T06:00:02Z', runnerSummaryWritten: false },
    unknown: [{ promptHash: requests[1].promptHash, startReceipt: `${run}/calls/${requests[1].promptHash}.started.json`,
      startedAt: starts[1].startedAt, providerDispatchAcknowledgedInDurableReceipt: null, result: null, usage: null, costUsd: null }],
    combined: { distinctInputSlots: 3, attemptedInputSlots: 2, knownActualCalls: 1, completedResults: 0, knownFailedResults: 1,
      unknownAttempts: 1, unattemptedInputSlots: 1 }, rawHashes: {} }
  for (const file of ['manifest.json', 'preflight.json', ...readdirSync(resolve(directory, run, 'calls')).map(n => `calls/${n}`)]) {
    audit.rawHashes[`${run}/${file}`] = sha256(readFileSync(resolve(directory, run, file)))
  }
  const protocol = structuredClone(protocol4)
  const saveAudit = () => {
    write(directory, auditPath, audit)
    protocol.recoveryPolicy = { ...protocol.recoveryPolicy, parentRun: run, auditPath,
      auditSha256: sha256(readFileSync(resolve(directory, auditPath))) }
  }
  saveAudit()
  const frozen = { ...parent, protocolPath: 'protocol4.json', protocolSha256: 'new-policy-only' }
  const read = () => readReaderQuarantine(directory, run, frozen, unique, protocol)
  return { directory, run, requests, unique, parent, frozen, protocol, audit, saveAudit, read }
}

test('v4 evaluation preserves the original model, prompts, budget, scorer and split-aware preflight', () => {
  assert.deepEqual(readerEvaluationProtocol(protocol4), protocol3)
  for (const key of ['repeatAttemptedInputs', 'replaceHistoricalResults', 'unknownCountsAsPassed', 'automaticRecoveryAfterNewFailure']) {
    const changed = structuredClone(protocol4); changed.recoveryPolicy[key] = true
    assert.throws(() => readerEvaluationProtocol(changed), /Unsafe reader quarantine/)
  }
})
test('quarantine records an unknown attempt separately without synthesizing its result or actual dispatch', async t => {
  const f = fixture(t), history = await f.read()
  assert.equal(history.results.size, 1); assert.equal(history.quarantined.size, 1)
  assert.equal(history.results.has(f.requests[1].promptHash), false)
  assert.equal(history.results.has(f.requests[2].promptHash), false)
  assert.deepEqual(history.counts, f.audit.combined)
  assert.equal(history.quarantined.get(f.requests[1].promptHash).providerDispatchAcknowledged, null)
  assert.equal(history.quarantined.get(f.requests[1].promptHash).result, null)
  await verifyReaderHistory(f.directory, history.evidence)
})
test('missing, unbound or successful-process audit cannot authorize a quarantine cohort', async t => {
  for (const change of [f => { f.audit.manifestSha256 = 'forged' }, f => { f.audit.observedProcessTerminal.exitCode = 0 },
    f => { f.audit.run += '-other' }, f => { f.audit.observedProcessTerminal.runnerSummaryWritten = true }]) {
    const f = fixture(t); change(f); f.saveAudit()
    await assert.rejects(f.read(), /audit|manifest/)
  }
})
test('changed frozen model, budget, cases or transport stay forbidden after an interruption', async t => {
  for (const change of [f => { f.protocol.model = 'other' }, f => { f.protocol.budget.maxObservedOutputTokens++ },
    f => { f.frozen.cases = [] }, f => { f.frozen.runtimeHashes = { 'scripts/narrative-reader-contract.mjs': 'other' } }]) {
    const f = fixture(t); change(f)
    await assert.rejects(f.read(), /changes|Continuation/)
  }
})
test('unknown receipt, start time, dispatch status and accounting must match the observed evidence', async t => {
  for (const change of [f => { f.audit.unknown[0].startReceipt += '-other' }, f => { f.audit.unknown[0].result = {} },
    f => { f.audit.unknown[0].providerDispatchAcknowledgedInDurableReceipt = false },
    f => { f.audit.observedProcessTerminal.terminalObservedAt = '2026-10-15T05:00:00Z' },
    f => { f.audit.combined.unattemptedInputSlots++ }]) {
    const f = fixture(t); change(f); f.saveAudit()
    await assert.rejects(f.read(), /attempt|accounting/)
  }
})
test('removed or modified audited requests cannot be relabelled as never attempted', async t => {
  const f = fixture(t)
  rmSync(resolve(f.directory, f.run, 'calls', `${f.requests[1].promptHash}.started.json`))
  await assert.rejects(f.read(), /inventory changed|missing or changed/)
  const g = fixture(t)
  write(g.directory, `${g.run}/calls/${g.requests[2].promptHash}.request.json`, {})
  await assert.rejects(g.read(), /request changed/)
})
test('post-inspection new starts and fabricated terminal results invalidate the frozen history', async t => {
  const f = fixture(t), history = await f.read()
  write(f.directory, `${f.run}/calls/${f.requests[2].promptHash}.started.json`, {
    promptHash: f.requests[2].promptHash, model: protocol3.model, startedAt: '2026-10-15T06:00:00Z' })
  await assert.rejects(verifyReaderHistory(f.directory, history.evidence), /inventory changed/)
  const g = fixture(t)
  write(g.directory, `${g.run}/calls/${g.requests[1].promptHash}.result.json`, { status: 'completed' })
  await assert.rejects(g.read(), /Invalid historical/)
})
test('real interrupted evidence identifies exactly390 unattempted inputs and preserves both prior cohorts', async () => {
  const parent = JSON.parse(readFileSync(resolve(root, protocol4.recoveryPolicy.parentRun, 'manifest.json')))
  const inputs = JSON.parse(readFileSync(resolve(root, parent.inputsPath)))
  const unique = new Map(inputs.families.flatMap(f => f.cases).map(item => { const request = readerMessages(item, protocol3); return [request.promptHash, request] }))
  const frozen = { ...parent, protocolPath: 'tests/acceptance/narrative-world/reader-protocol-20261015-v4.json', protocolSha256: sha256(protocol4) }
  const history = await readReaderQuarantine(root, protocol4.recoveryPolicy.parentRun, frozen, unique, protocol4)
  assert.deepEqual(history.counts, { distinctInputSlots: 461, attemptedInputSlots: 71, knownActualCalls: 70,
    completedResults: 69, knownFailedResults: 1, unknownAttempts: 1, unattemptedInputSlots: 390 })
  assert.equal(history.results.size, 70); assert.equal(history.quarantined.size, 1)
  assert.ok(Object.keys(history.evidence.files).some(path => path.includes('/reader-fixed-20261015-v3/')))
  await verifyReaderHistory(root, history.evidence)
})

test('current CLI with a synthetic parent excludes every attempted input, rejects forks and keeps missing-binary startup at zero new attempts', t => {
  const id = `test-reader-quarantine-${randomUUID()}`, run = `${raw}${id}-parent`, output = `${raw}${id}`
  const auditPath = `${raw}${id}-audit/interruption.json`, protocolPath = `tests/acceptance/narrative-world/${id}-protocol.json`
  const parent = JSON.parse(readFileSync(resolve(root, protocol4.recoveryPolicy.parentRun, 'manifest.json')))
  const { continuation: _continuation, ...original } = parent
  const manifest = { ...original, version: 1 }
  mkdirSync(resolve(root, run, 'calls'), { recursive: true })
  for (const source of ['reader-fixed-20261015-v3', 'reader-fixed-20261015-v4']) {
    const directory = resolve(root, raw, source, 'calls')
    for (const name of readdirSync(directory)) writeFileSync(resolve(root, run, 'calls', name), readFileSync(resolve(directory, name)))
  }
  write(root, `${run}/manifest.json`, manifest)
  bindReaderCliTestParentToCurrentRuntime(root, run)
  writeFileSync(resolve(root, run, 'preflight.json'), readFileSync(resolve(root, protocol4.recoveryPolicy.parentRun, 'preflight.json')))
  const audit = JSON.parse(readFileSync(resolve(root, protocol4.recoveryPolicy.auditPath)))
  audit.run = run; audit.manifestSha256 = sha256(readFileSync(resolve(root, run, 'manifest.json')))
  audit.unknown = audit.unknown.map(item => ({ ...item, startReceipt: `${run}/calls/${item.promptHash}.started.json` }))
  audit.rawHashes = Object.fromEntries(['manifest.json', 'preflight.json', ...readdirSync(resolve(root, run, 'calls')).map(n => `calls/${n}`)]
    .map(name => [`${run}/${name}`, sha256(readFileSync(resolve(root, run, name)))]))
  write(root, auditPath, audit)
  const protocol = structuredClone(protocol4)
  protocol.recoveryPolicy = { ...protocol.recoveryPolicy, parentRun: run, auditPath, auditSha256: sha256(readFileSync(resolve(root, auditPath))) }
  write(root, protocolPath, protocol)
  const claim = `${raw}reader-continuation-claims/${sha256({ parent: run, parentManifestSha256: audit.manifestSha256 })}.json`
  t.after(() => {
    for (const path of [run, output, `${raw}${id}-audit`]) rmSync(resolve(root, path), { recursive: true, force: true })
    for (const path of [protocolPath, claim]) rmSync(resolve(root, path), { force: true })
  })
  const args = ['scripts/evaluate-narrative-reader-local-codex.mjs', '--inputs', parent.inputsPath,
    '--protocol', protocolPath, '--output', output, '--quarantine-unstarted-from', run]
  const invoke = extra => execFileSync(process.execPath, [...args, ...extra], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
    env: { ...process.env, STORYFORGE_CODEX_BIN: resolve(root, run, 'missing-codex') } })
  invoke(['--dry-run']); invoke(['--resume', '--dry-run'])
  const child = JSON.parse(readFileSync(resolve(root, output, 'manifest.json')))
  assert.equal(child.version, 3); assert.equal(child.recovery.inheritedPromptHashes.length, 70)
  assert.equal(child.recovery.quarantinedAttempts.length, 1); assert.equal(child.recovery.pendingPromptHashes.length, 390)
  assert.equal(readdirSync(resolve(root, output, 'calls')).length, 390)
  assert.throws(() => execFileSync(process.execPath, [...args.map(v => v === output ? `${output}-fork` : v), '--dry-run'],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' }), error => /different continuation/.test(error.stderr))
  assert.throws(() => invoke(['--resume', '--max-calls', '1']), error => /run-failed-before-summary/.test(error.stderr))
  for (const name of readdirSync(resolve(root, output)).filter(name => name.startsWith('summary-'))) {
    const summary = JSON.parse(readFileSync(resolve(root, output, name)))
    assert.equal(summary.counts.actualCalls, 70); assert.equal(summary.counts.recordedAttempts, 71)
    assert.equal(summary.counts.unknownDispatchAttempts, 1); assert.equal(summary.counts.unattempted, 390)
    assert.equal(summary.cohort.newRecordedAttempts, 0); assert.equal(summary.executionComplete, false); assert.equal(summary.accepted, false)
    assert.equal(summary.historicalEvidenceUnchanged, true)
  }
  assert.equal(readdirSync(resolve(root, output, 'calls')).filter(name => !name.endsWith('.request.json')).length, 0)
  assert.equal(relative(root, resolve(root, output)).startsWith(raw), true)
})
