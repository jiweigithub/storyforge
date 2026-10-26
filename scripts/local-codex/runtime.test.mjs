import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { CodexRuntime, ISOLATION } from './runtime.mjs'

function fixture(t, { account = { type: 'chatgpt', email: 'test@example.com' }, config = ISOLATION, instructions = [], model = 'test', tool = false, version = '0.162.0', events = [], completion = { status: 'completed' } } = {}) {
  const calls = []; const spawned = []
  const runtime = new CodexRuntime({ spawnProcess: (executable, args, options) => {
    spawned.push({ executable, args, options })
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { child.stdout.end() }
    const emit = message => child.stdout.write(JSON.stringify(message) + '\n')
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const m = JSON.parse(chunk.toString()); calls.push(m)
      if (!m.id || !m.method) { done(); return }
      const replies = {
        initialize: { userAgent: `storyforge/${version} (test)` }, 'config/read': { config }, 'skills/list': { data: [] },
        'account/read': { account }, 'model/list': { data: [{ model: 'test', displayName: 'Test', isDefault: true }] },
        'thread/start': { thread: { id: 'thread' }, model, modelProvider: 'storyforge-subscription', instructionSources: instructions },
        'turn/start': { turn: { id: 'turn' } },
      }
      emit({ id: m.id, result: replies[m.method] ?? {} }); done()
      if (m.method === 'turn/start') queueMicrotask(() => {
        emit({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } })
        for (const event of events) emit(event)
        if (tool) emit({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread' } })
        emit({ method: 'item/completed', params: { threadId: 'thread', item: { type: 'agentMessage', id: 'comment', phase: 'commentary', text: 'not author content' } } })
        emit({ method: 'item/completed', params: { threadId: 'thread', item: { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: '{"title":"候选"}' } } })
        emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', tokenUsage: { last: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } } })
        emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', ...completion } } })
      })
    } })
    return child
  } })
  t.after(() => runtime.close())
  return { runtime, calls, spawned }
}
const input = { model: 'test', messages: [{ role: 'system', content: 'StoryForge context' }, { role: 'user', content: 'write' }], outputSchema: { type: 'object' } }

test('reuses native auth, isolates thread, disables tools/retries, preserves schema and final answer', async t => {
  const { runtime, calls, spawned } = fixture(t); const updates = []
  await runtime.generate(input, v => updates.push(v), new AbortController().signal)
  assert.equal(updates.find(v => v.text)?.text, '{"title":"候选"}')
  assert.equal(updates.find(v => v.usage)?.usage.totalTokens, 15)
  assert.equal(calls.some(v => v.method === 'account/login/start'), false)
  const thread = calls.find(v => v.method === 'thread/start').params
  assert.equal(thread.ephemeral, true); assert.equal(thread.allowProviderModelFallback, false)
  assert.deepEqual(thread.environments, []); assert.equal(thread.config.web_search, 'disabled')
  assert.equal(thread.developerInstructions, 'StoryForge context')
  assert.deepEqual(calls.find(v => v.method === 'turn/start').params.outputSchema, input.outputSchema)
  assert.equal(spawned[0].options.env.OPENAI_API_KEY, undefined)
  assert.equal(thread.config.model_providers['storyforge-subscription'].stream_max_retries, 0)
  for (const key of ['skill_search', 'view_image', 'sleep_tool', 'unbounded_connection_retries', 'daemon_auto_start']) assert.equal(thread.config.features[key], false)
})
test('API-key or absent login cannot dispatch or fall back', async t => {
  for (const account of [null, { type: 'apiKey' }]) {
    const { runtime, calls } = fixture(t, { account })
    await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), /登录不可用/)
    assert.equal(calls.some(v => v.method === 'turn/start'), false)
  }
})
test('unknown model, inherited instructions and too-old protocol fail before generation', async t => {
  for (const options of [{ model: 'substituted' }, { instructions: [{ path: '/AGENTS.md' }] }, { version: '0.100.0' }]) {
    const { runtime, calls } = fixture(t, options)
    await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal))
    assert.equal(calls.some(v => v.method === 'turn/start'), false)
  }
})
test('unexpected approval/tool RPC is denied and cannot become successful output', async t => {
  const { runtime, calls } = fixture(t, { tool: true })
  await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), /工具/)
  assert.ok(calls.some(v => v.id === 900 && v.error.code === -32601))
})
test('managed policy that keeps tools enabled blocks inference', async t => {
  const { runtime, calls } = fixture(t, { config: { ...ISOLATION, features: { ...ISOLATION.features, shell_tool: true } } })
  await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), /隔离/)
  assert.equal(calls.some(v => v.method === 'turn/start'), false)
})

test('failed turns retain only allowlisted codes and numeric HTTP status, without a resend', async t => {
  const cases = [
    ['usageLimitExceeded', { code: 'usageLimitExceeded', httpStatusCode: null }],
    ['unauthorized', { code: 'unauthorized', httpStatusCode: null }],
    [{ responseStreamDisconnected: { httpStatusCode: 503, secret: 'POISON' } }, { code: 'responseStreamDisconnected', httpStatusCode: 503 }],
    [{ httpConnectionFailed: { httpStatusCode: '401 POISON' } }, { code: 'httpConnectionFailed', httpStatusCode: null }],
    [{ responseTooManyFailedAttempts: { httpStatusCode: 1000 } }, { code: 'responseTooManyFailedAttempts', httpStatusCode: null }],
    ['future-POISON-variant', { code: 'unclassified', httpStatusCode: null }],
    [{ httpConnectionFailed: { httpStatusCode: 429 }, extra: 'POISON' }, { code: 'unclassified', httpStatusCode: null }],
  ]
  for (const [codexErrorInfo, expected] of cases) {
    const { runtime, calls } = fixture(t, { completion: { status: 'failed', error: { codexErrorInfo,
      message: 'POISON prompt or credential', additionalDetails: '/POISON/private', misalignment: { explanation: 'POISON' } } } })
    await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), error => {
      assert.deepEqual(error.codexDiagnostic, expected)
      assert.doesNotMatch(String(error) + JSON.stringify(error), /POISON/)
      return true
    })
    assert.equal(calls.filter(value => value.method === 'turn/start').length, 1)
    assert.equal(calls.filter(value => value.method === 'thread/start').length, 1)
  }
})
test('matching error notification fills only an absent terminal error, never overrides it', async t => {
  const events = [{ method: 'error', params: { threadId: 'thread', turnId: 'turn', willRetry: false,
    error: { codexErrorInfo: 'rateLimitExceeded', message: 'POISON' } } }]
  for (const [error, code] of [[null, 'rateLimitExceeded'], [{ codexErrorInfo: 'badRequest' }, 'badRequest'],
    [{ codexErrorInfo: 'future-POISON' }, 'unclassified']]) {
    const { runtime } = fixture(t, { events, completion: { status: 'failed', error } })
    await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), failure => {
      assert.equal(failure.codexDiagnostic.code, code)
      assert.doesNotMatch(String(failure), /POISON/)
      return true
    })
  }
})
test('another thread or turn cannot supply the failure diagnosis or complete this request', async t => {
  const error = { codexErrorInfo: 'unauthorized', message: 'POISON' }
  const events = [
    { method: 'error', params: { threadId: 'other', turnId: 'turn', error } },
    { method: 'error', params: { threadId: 'thread', turnId: 'other', error } },
    { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'other', status: 'completed' } } },
  ]
  const { runtime } = fixture(t, { events, completion: { status: 'failed', error: null } })
  await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), failure => {
    assert.deepEqual(failure.codexDiagnostic, { code: 'unclassified', httpStatusCode: null })
    return true
  })
})
test('completed output stays successful after an error notification and no retry is dispatched', async t => {
  const { runtime, calls } = fixture(t, { events: [{ method: 'error', params: { threadId: 'thread', turnId: 'turn',
    willRetry: false, error: { codexErrorInfo: 'other', message: 'POISON' } } }] })
  const updates = []
  await runtime.generate(input, update => updates.push(update), new AbortController().signal)
  assert.equal(updates.find(update => update.text)?.text, '{"title":"候选"}')
  assert.doesNotMatch(JSON.stringify(updates), /POISON/)
  assert.equal(calls.filter(value => value.method === 'turn/start').length, 1)
})
