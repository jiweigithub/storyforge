import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { AUTHOR_QUALITY_ENTRY_ID, authorQualityHash } from './narrative-author-quality-contract.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
const rawHash = value => createHash('sha256').update(value).digest('hex')
const fakeRuntime = `import { appendFileSync } from 'node:fs';
export class CodexRuntime {
  version = 'test-runtime-no-network';
  async start() {}
  async account() { return { state: 'ready' }; }
  async models() { return [{ id: 'writer' }, { id: 'reviewer' }]; }
  close() {}
  async generate(input, notify) {
    appendFileSync(process.env.AUTHOR_QUALITY_TEST_CALL_LOG, JSON.stringify({ model: input.model, id: input.id }) + '\\n');
    notify({ dispatched: true });
    notify({ usage: { inputTokens: 100, outputTokens: 0 } });
    if (process.env.AUTHOR_QUALITY_TEST_FAILURE === 'after-submit') throw Error('test transport interrupted');
    const payload = JSON.parse(input.messages.find(message => message.role === 'user').content);
    const value = input.model === 'writer' ? { revisedStory: payload.original + payload.documents[0].text,
      continuation: [{ title: '一', text: '第一章，仅用于执行器测试。' }, { title: '二', text: '第二章，仅用于执行器测试。' }] }
      : { judgments: payload.variants.map(item => ({ label: item.label, consistency: 4, motivation: 4, acceptance: 4,
        consistencyChange: 'not-lower', reason: '模拟评阅，仅证明执行器行为。',
        evidence: [{ sourceId: item.label + ':revision', quote: item.revisedStory },
          { sourceId: 'original', quote: payload.original }], hardContradictions: [] })) };
    notify({ text: JSON.stringify(value), usage: { inputTokens: 100, outputTokens: 200 } });
  }
}`

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nw-author-quality-runner-test-'))
  // Only the unique temporary fixture made by this test is removed.
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value) }
  const json = (path, value) => write(path, JSON.stringify(value) + '\n')
  for (const name of ['evaluate-narrative-author-quality-local-codex.mjs', 'narrative-author-quality-contract.mjs',
    'narrative-author-quality-review.mjs',
    'narrative-reader-storage.mjs', 'narrative-reader-contract.mjs']) {
    mkdirSync(join(root, 'scripts'), { recursive: true }); copyFileSync(join(scripts, name), join(root, 'scripts', name))
  }
  write('scripts/local-codex/runtime.mjs', fakeRuntime)
  json('package.json', { name: 'storyforge-author-quality-test', type: 'module' })
  json('package-lock.json', { lockfileVersion: 3 })
  json('src/lib/agent/ai-entry-registry.json', { offlineEvaluations: [{ entryId: AUTHOR_QUALITY_ENTRY_ID,
    boundary: 'eval-only', adoptAllowed: false, transport: 'local-codex-subscription',
    caller: 'scripts/evaluate-narrative-author-quality-local-codex.mjs', contract: 'scripts/narrative-author-quality-contract.mjs' }] })
  const base = 'tests/acceptance/narrative-world/'
  const protocol = { schema: 'storyforge.narrative-author-quality-protocol', version: 1,
    entryId: AUTHOR_QUALITY_ENTRY_ID, provider: 'local-codex-subscription', writerModel: 'writer', reviewerModel: 'reviewer',
    reasoningEffort: 'medium', retries: 0, budget: { maxInputBytes: 10000, maxObservedInputTokens: 4000,
      maxObservedOutputTokens: 4000, timeoutMs: 1000, maxOutputCharacters: 10000, serverEnforcedOutputTokenLimit: null },
    writerPrompt: '测试，不调用真实模型。', reviewerPrompt: '测试，不代表真实评阅。', accepted: false }
  json(base + 'protocol.json', protocol)
  const original = '测试原文。', request = '测试修改要求。', h = 'a'.repeat(64)
  const input = { schema: 'storyforge.narrative-author-quality-input', version: 1, original,
    originalHash: authorQualityHash(original), revisionRequest: request, revisionRequestHash: authorQualityHash(request),
    releaseContentHash: h, sourceReceipts: [], accepted: false,
    conditions: Object.fromEntries(['original-lexical', 'original-ir'].map((name, index) => [name, {
      documents: [{ id: 'D1', text: '测试材料' + index, hash: authorQualityHash('测试材料' + index) }],
      selectionReceiptHash: h, releaseContentHash: h,
    }])) }
  const selections = Object.fromEntries(Object.entries(input.conditions).map(([condition, row]) => [condition, {
    schema: 'storyforge.author-quality-source-selection', version: 1, releaseContentHash: h,
    documents: row.documents.map(({ id, hash }) => ({ id, hash })),
  }]))
  for (const condition of Object.keys(selections)) input.conditions[condition].selectionReceiptHash = authorQualityHash(selections[condition])
  const originalPath = base + 'original.txt'
  write(originalPath, original)
  const proof = JSON.stringify({ schema: 'storyforge.narrative-author-quality-source-preparation', version: 1,
    boundary: 'Mock runner fixture only; no real source preparation or model quality evidence.',
    sourcePreparationComplete: true, inputContractVerified: true, completed: true, sourceFilesUnchanged: true, accepted: false,
    releaseContentHash: h, originalSource: { path: originalPath, sha256: input.originalHash }, selections,
    sourceHashes: { 'package.json': rawHash(readFileSync(join(root, 'package.json'))) } })
  write(base + 'source-receipt.json', proof)
  input.sourceReceipts = [{ path: base + 'source-receipt.json', sha256: rawHash(proof) }, { path: originalPath, sha256: input.originalHash }]
  json(base + 'input.json', input)
  mkdirSync(join(root, base, 'raw'), { recursive: true })
  for (const args of [['-c', 'init.templateDir=', 'init', '-q'], ['-c', 'user.name=Test Fixture', '-c', 'user.email=test@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'isolated test fixture']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const log = join(root, 'calls-observed.jsonl')
  const run = (name, execute, failure = '') => spawnSync(process.execPath,
    ['scripts/evaluate-narrative-author-quality-local-codex.mjs', '--protocol', base + 'protocol.json', '--input', base + 'input.json',
      '--output', base + 'raw/author-quality-' + name, ...(execute ? ['--execute'] : [])], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, AUTHOR_QUALITY_TEST_CALL_LOG: log, AUTHOR_QUALITY_TEST_FAILURE: failure },
    })
  return { root, base, run, observed: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [],
    output: name => join(root, base, 'raw', 'author-quality-' + name) }
}

test('default preflight writes frozen requests without starting a model or inferring quality', t => {
  const f = fixture(t), result = f.run('preflight', false)
  assert.equal(result.status, 0, result.stderr)
  const terminal = JSON.parse(readFileSync(join(f.output('preflight'), 'terminal.json')))
  assert.equal(terminal.actualCallsObserved, 0)
  assert.equal(terminal.sourceUnchanged, true)
  assert.equal(terminal.accepted, false)
  assert.equal(terminal.independentHumanReviews, 0)
  assert.deepEqual(f.observed(), [])
  assert.equal(readdirSync(join(f.output('preflight'), 'calls')).filter(name => name.endsWith('.request.json')).length, 2)
})

test('implementation drift fails before creating a run or dispatching any request', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ name: 'changed-source', type: 'module' }))
  const result = f.run('changed-source', true)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /current implementation/)
  assert.equal(existsSync(f.output('changed-source')), false)
  assert.deepEqual(f.observed(), [])
})

test('mocked paired generation and independent review preserve exact receipts and blind metadata', t => {
  const f = fixture(t), result = f.run('complete', true)
  assert.equal(result.status, 0, result.stderr)
  const terminal = JSON.parse(readFileSync(join(f.output('complete'), 'terminal.json')))
  assert.equal(terminal.actualCallsObserved, 3)
  assert.equal(terminal.persistedTerminalCalls, 3)
  assert.deepEqual(terminal.uncommittedAttempts, [])
  assert.equal(terminal.sourceUnchanged, true)
  assert.equal(terminal.accepted, false)
  assert.deepEqual(f.observed().map(call => call.model), ['writer', 'writer', 'reviewer'])
  const packet = readFileSync(join(f.output('complete'), 'blind-packet.json'), 'utf8')
  assert.ok(!packet.includes('original-ir'))
  assert.ok(!packet.includes('reviewerModel'))
  const view = readFileSync(join(f.output('complete'), 'human-review.html'))
  const viewReceipt = JSON.parse(readFileSync(join(f.output('complete'), 'human-review-view.json')))
  assert.equal(viewReceipt.sha256, rawHash(view))
  assert.equal(viewReceipt.packetHash, authorQualityHash(JSON.parse(packet)))
  assert.equal(viewReceipt.humanReviews, 0)
  assert.equal(viewReceipt.accepted, false)
  for (const name of readdirSync(join(f.output('complete'), 'calls')).filter(name => name.endsWith('.result.json'))) {
    const receipt = JSON.parse(readFileSync(join(f.output('complete'), 'calls', name)))
    assert.equal(receipt.status, 'completed')
    assert.equal(receipt.costUsd, null)
    assert.equal(receipt.usage.outputTokens, 200)
  }
})

test('post-submission interruption stops later stages and blocks redispatch in a new directory', t => {
  const f = fixture(t), first = f.run('interrupted', true, 'after-submit')
  assert.equal(first.status, 2, first.stderr)
  const terminal = JSON.parse(readFileSync(join(f.output('interrupted'), 'terminal.json')))
  assert.equal(terminal.actualCallsObserved, 1)
  assert.equal(terminal.results[0].status, 'unknown-or-interrupted')
  assert.equal(existsSync(join(f.output('interrupted'), 'blind-packet.json')), false)
  const retry = f.run('must-not-retry', true)
  assert.notEqual(retry.status, 0)
  assert.match(retry.stderr, /already started/)
  assert.equal(existsSync(f.output('must-not-retry')), false)
  assert.equal(f.observed().length, 1)
})
