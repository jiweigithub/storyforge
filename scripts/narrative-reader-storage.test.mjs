import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sha256 } from './narrative-reader-contract.mjs'
import { bindReaderCliTestParentToCurrentRuntime } from '../tests/helpers/narrative-reader-cli-fixture.mjs'
import { READER_STORAGE_POLICY, createReaderReceiptStore, inspectReaderReceiptJournal, readerStorageDiagnostic } from './narrative-reader-storage.mjs'

const root = resolve(import.meta.dirname, '..'), hash = 'a'.repeat(64)
const start = { promptHash: hash, model: 'fixture', startedAt: '2026-10-15T00:00:00Z' }
function fixture(t, overrides = {}) {
  const output = fs.mkdtempSync(resolve(tmpdir(), 'nw-reader-storage-'))
  fs.mkdirSync(resolve(output, 'calls'))
  t.after(() => fs.rmSync(output, { recursive: true, force: true }))
  const store = createReaderReceiptStore(output, { ...fs, ...overrides })
  return { output, store, startedPath: resolve(output, 'calls', `${hash}.started.json`),
    resultPath: resolve(output, 'calls', `${hash}.result.json`) }
}
test('durable milestones retain the exact response before the exclusive result commit', t => {
  const f = fixture(t), journal = f.store.begin(start, f.startedPath)
  journal.append('submission-intent', { model: 'fixture' })
  const response = { rawText: '{"answer":"铜铃在木箱。"}', usage: { inputTokens: 10, outputTokens: 5 } }
  journal.append('generation-completed', response)
  journal.append('terminal-receipt', { status: 'completed', ...response })
  f.store.writeJson(f.resultPath, { status: 'completed', ...response }); journal.close()
  assert.deepEqual(JSON.parse(fs.readFileSync(f.startedPath)), start)
  const audit = inspectReaderReceiptJournal(fs.readFileSync(journal.path), hash)
  assert.deepEqual(audit.generationCompletedEvidence, response)
  assert.equal(audit.events[1].kind, 'submission-intent'); assert.equal(audit.corruption, null)
  assert.equal(audit.automaticRecoveryAllowed, false); assert.equal(audit.accepted, false)
})
test('insufficient space stops admission before creating a start or allowing dispatch', t => {
  const f = fixture(t, { statfsSync: () => ({ bavail: 0n, bsize: 4096n }) })
  let dispatched = false
  assert.throws(() => { f.store.begin(start, f.startedPath); dispatched = true }, { code: 'READER_STORAGE_LOW_SPACE' })
  assert.equal(dispatched, false); assert.equal(fs.existsSync(f.startedPath), false)
  assert.deepEqual(fs.readdirSync(resolve(f.output, 'receipt-journal')), ['staging'])
})
test('short filesystem writes are completed before any receipt becomes visible', t => {
  let writes = 0
  const f = fixture(t, { writeSync(fd, bytes, offset, length) { writes++; return fs.writeSync(fd, bytes, offset, Math.min(length, 7)) } })
  f.store.writeJson(f.resultPath, { answer: '铜铃'.repeat(30) })
  assert.ok(writes > 1); assert.deepEqual(JSON.parse(fs.readFileSync(f.resultPath)), { answer: '铜铃'.repeat(30) })
})
test('an existing receipt cannot be overwritten; failed staged bytes remain separate evidence', t => {
  const f = fixture(t)
  f.store.writeJson(f.resultPath, { value: 'original' })
  assert.throws(() => f.store.writeJson(f.resultPath, { value: 'replacement' }), { code: 'EEXIST' })
  assert.deepEqual(JSON.parse(fs.readFileSync(f.resultPath)), { value: 'original' })
  assert.equal(fs.readdirSync(resolve(f.output, 'receipt-journal/staging')).length, 1)
})
test('disk exhaustion at result publication leaves no partial result and retains completed generation evidence', t => {
  let deny = false
  const f = fixture(t, { linkSync(...args) { if (deny) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return fs.linkSync(...args) } })
  const journal = f.store.begin(start, f.startedPath)
  journal.append('submission-intent', {})
  const response = { rawText: '完整的实际响应', usage: { inputTokens: 10, outputTokens: 5 } }
  journal.append('generation-completed', response); deny = true
  assert.throws(() => f.store.writeJson(f.resultPath, response), { code: 'ENOSPC' }); journal.close()
  assert.equal(fs.existsSync(f.resultPath), false)
  const audit = inspectReaderReceiptJournal(fs.readFileSync(journal.path), hash)
  assert.deepEqual(audit.generationCompletedEvidence, response)
  assert.equal(audit.terminalEvidence, null); assert.equal(audit.automaticRecoveryAllowed, false)
})
test('journal sync failure is surfaced and prevents later events from masking the failure', t => {
  let deny = false
  const f = fixture(t, { fsyncSync(fd) { if (deny) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return fs.fsyncSync(fd) } })
  const journal = f.store.begin(start, f.startedPath); deny = true
  assert.throws(() => journal.append('submission-intent', {}), { code: 'ENOSPC' })
  deny = false
  assert.throws(() => journal.append('generation-completed', { rawText: 'not trustworthy' }), /broken-journal/)
  journal.close(); assert.equal(fs.existsSync(f.resultPath), false)
})
test('a torn final journal line is not promoted to a terminal result', t => {
  const f = fixture(t), journal = f.store.begin(start, f.startedPath)
  journal.append('submission-intent', {}); journal.close()
  fs.appendFileSync(journal.path, '{"body":{"kind":"terminal-receipt"')
  const audit = inspectReaderReceiptJournal(fs.readFileSync(journal.path), hash)
  assert.equal(audit.events.length, 2); assert.equal(audit.corruption, 'incomplete-final-line')
  assert.equal(audit.terminalEvidence, null)
})
test('wrong identity, checksum, ordering and event kind fail closed during forensic inspection', t => {
  const f = fixture(t), journal = f.store.begin(start, f.startedPath); journal.close()
  const original = JSON.parse(fs.readFileSync(journal.path, 'utf8'))
  for (const patch of [{ promptHash: 'b'.repeat(64) }, { sequence: 1 }, { kind: 'generation-completed' }, { kind: 'invented' }]) {
    const body = { ...original.body, ...patch }, audit = inspectReaderReceiptJournal(JSON.stringify({ body, sha256: sha256(body) }) + '\n', hash)
    assert.equal(audit.corruption, 'invalid-complete-line'); assert.equal(audit.events.length, 0)
  }
  original.body.payload.model = 'changed'
  assert.equal(inspectReaderReceiptJournal(JSON.stringify(original) + '\n', hash).events.length, 0)
})
test('bounded receipts reject oversized responses without creating a canonical result', t => {
  const f = fixture(t)
  assert.throws(() => f.store.writeJson(f.resultPath, { text: 'x'.repeat(READER_STORAGE_POLICY.maximumCallReceiptBytes) }), { code: 'EFBIG' })
  assert.equal(fs.existsSync(f.resultPath), false)
})
test('public storage diagnostics contain only allowlisted codes and operations', () => {
  assert.deepEqual(readerStorageDiagnostic({ code: 'ENOSPC', receiptOperation: 'journal', message: 'POISON' }), { code: 'ENOSPC', operation: 'journal' })
  assert.deepEqual(readerStorageDiagnostic({ code: 'POISON', receiptOperation: 'private/path' }), { code: 'unclassified', operation: 'unknown' })
})
test('CLI storage admission stops before starting the model transport and records zero new calls', t => {
  const parent = 'tests/acceptance/narrative-world/raw/reader-fixed-20261015-v3'
  const output = `tests/acceptance/narrative-world/raw/test-storage-${randomUUID()}`, copy = `${output}-parent`
  fs.cpSync(resolve(root, parent), resolve(root, copy), { recursive: true, errorOnExist: true, force: false })
  const parentManifestSha256 = bindReaderCliTestParentToCurrentRuntime(root, copy)
  const claim = resolve(root, 'tests/acceptance/narrative-world/raw/reader-continuation-claims', `${sha256({ parent: copy, parentManifestSha256 })}.json`)
  t.after(() => { fs.rmSync(resolve(root, output), { recursive: true, force: true }); fs.rmSync(resolve(root, copy), { recursive: true, force: true }); fs.rmSync(claim, { force: true }) })
  const hook = "import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';fs.statfsSync=()=>({bavail:0n,bsize:4096n});syncBuiltinESMExports()"
  const args = ['--import', `data:text/javascript,${encodeURIComponent(hook)}`, resolve(root, 'scripts/evaluate-narrative-reader-local-codex.mjs'),
    '--inputs', 'tests/acceptance/narrative-world/reader-inputs-20261015-v6.json', '--protocol', 'tests/acceptance/narrative-world/reader-protocol-20261015-v3.json',
    '--output', output, '--continue-unstarted-from', copy, '--max-calls', '1']
  assert.throws(() => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 20_000,
    env: { ...process.env, STORYFORGE_CODEX_BIN: resolve(root, copy, 'does-not-exist') } }), error => /READER_STORAGE_LOW_SPACE/.test(error.stderr))
  const summaries = fs.readdirSync(resolve(root, output)).filter(name => name.startsWith('summary-'))
  assert.equal(summaries.length, 1)
  const summary = JSON.parse(fs.readFileSync(resolve(root, output, summaries[0])))
  assert.equal(summary.runError.storageDiagnostic.code, 'READER_STORAGE_LOW_SPACE')
  assert.equal(summary.runError.newCohortAttempts, 0); assert.equal(summary.counts.actualCalls, 41)
  assert.equal(summary.counts.unattempted, 420); assert.equal(summary.unpersistedAttempts.length, 0)
  assert.equal(fs.readdirSync(resolve(root, output, 'calls')).filter(name => name.endsWith('.started.json')).length, 0)
  assert.equal(summary.executionComplete, false); assert.equal(summary.accepted, false)
})
