import { afterEach, describe, expect, it, vi } from 'vitest'
import profile from '../../scripts/ttrpg-local-tts/product-profile.json'
import { createTtrpgOpenLocalVoiceTransportV1 } from '../../src/lib/ttrpg/open-local-voice-transport'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const prefix = '/storyforge/local-tts/v1'
const response = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } })
async function fixture(handler?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const hash = await hashCanonicalValue(profile), calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.endsWith('/profile')) return response({ kind: 'local-offline-speech-v1', profileHash: hash, profile })
    return handler ? handler(url, init) : response({})
  }))
  return { transport: await createTtrpgOpenLocalVoiceTransportV1(), hash, calls }
}
describe('R-TTRPGOPEN10 bounded original-job browser transport', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('only probes on construction and sends one explicit start after current owner check, retaining the exact raw response', async () => {
    let ownerChecks = 0, profileHash = '', gets = 0
    const key = 'ttrpg.voice.1.' + 'a'.repeat(64), inputArtifactHash = 'a'.repeat(64)
    const f = await fixture((url, init) => {
      const status = url.endsWith('/jobs') ? 'waiting-for-slot' : url.endsWith('/start') ? 'running' : 'generated'
      if (url.endsWith('/start')) expect(ownerChecks).toBe(1)
      if (url.endsWith('/raw')) return response({ testOnly: true, raw: 'exact raw response', candidateAccepted: false })
      if (!init?.method) gets++
      return response({ jobKey: key, inputArtifactHash, profileHash, status, canStart: true })
    }); profileHash = f.hash
    expect(f.calls).toHaveLength(1)
    const result = await f.transport.execute({ jobKey: key, inputArtifactHash, execution: {} as never, assertCurrentBeforeStart: async () => { ownerChecks++ } })
    expect(JSON.parse(result)).toEqual({ testOnly: true, raw: 'exact raw response', candidateAccepted: false })
    expect(f.calls.filter(c => c.url.endsWith('/start'))).toHaveLength(1); expect(gets).toBeGreaterThan(0)
    expect(f.calls.every(c => c.url.startsWith(prefix))).toBe(true)
  })
  it('a revoked owner in the wait-to-start interval requests cancellation and never starts a worker', async () => {
    let hash = ''; const key = 'ttrpg.voice.1.' + 'a'.repeat(64)
    const f = await fixture(() => response({ jobKey: key, inputArtifactHash: 'a'.repeat(64), profileHash: hash, status: 'waiting-for-slot', canStart: true })); hash = f.hash
    await expect(f.transport.execute({ jobKey: key, inputArtifactHash: 'a'.repeat(64), execution: {} as never, assertCurrentBeforeStart: async () => { throw new Error('owner-revoked') } })).rejects.toThrow('owner-revoked')
    expect(f.calls.some(c => c.url.endsWith('/start'))).toBe(false); expect(f.calls.some(c => c.url.endsWith('/cancel'))).toBe(true)
  })
  it('a lost start response never causes a second POST or a guessed unsent retry', async () => {
    let hash = ''; const key = 'ttrpg.voice.1.' + 'a'.repeat(64)
    const f = await fixture(url => {
      if (url.endsWith('/start')) throw new Error('start-return-unknown')
      return response({ jobKey: key, inputArtifactHash: 'a'.repeat(64), profileHash: hash, status: 'waiting-for-slot', canStart: true })
    }); hash = f.hash
    await expect(f.transport.execute({ jobKey: key, inputArtifactHash: 'a'.repeat(64), execution: {} as never, assertCurrentBeforeStart: async () => {} })).rejects.toThrow('start-return-unknown')
    expect(f.calls.filter(c => c.url.endsWith('/start'))).toHaveLength(1)
  })
  it('pre-aborted input sends no job and a mismatched profile or HTML fallback fails before dispatch', async () => {
    const f = await fixture(), controller = new AbortController(); controller.abort()
    await expect(f.transport.execute({ jobKey: 'unused', inputArtifactHash: 'a'.repeat(64), execution: {} as never, signal: controller.signal, assertCurrentBeforeStart: async () => {} })).rejects.toThrow()
    expect(f.calls).toHaveLength(1)
    vi.stubGlobal('fetch', vi.fn(async () => response({ kind: 'local-offline-speech-v1', profileHash: '0'.repeat(64), profile })))
    await expect(createTtrpgOpenLocalVoiceTransportV1()).rejects.toThrow(/版本/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>not enabled</html>', { headers: { 'Content-Type': 'text/html' } })))
    await expect(createTtrpgOpenLocalVoiceTransportV1()).rejects.toThrow(/未就绪/)
  })
  it('a lost raw response requests cancellation through the same job and never starts again', async () => {
    let hash = ''; const key = 'ttrpg.voice.1.' + 'a'.repeat(64)
    const f = await fixture(url => {
      if (url.endsWith('/raw')) throw new Error('raw-return-unknown')
      return response({ jobKey: key, inputArtifactHash: 'a'.repeat(64), profileHash: hash, status: 'generated', canStart: false })
    }); hash = f.hash
    await expect(f.transport.execute({ jobKey: key, inputArtifactHash: 'a'.repeat(64), execution: {} as never, assertCurrentBeforeStart: async () => {} })).rejects.toThrow('raw-return-unknown')
    expect(f.calls.some(c => c.url.endsWith('/start'))).toBe(false); expect(f.calls.some(c => c.url.endsWith('/cancel'))).toBe(true)
  })
  it('checks declared response budgets before allocating a huge status or audio body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, { 'Content-Length': '65537' })))
    await expect(createTtrpgOpenLocalVoiceTransportV1()).rejects.toThrow(/预算/)
  })
  it('rechecks the original owner for lease renewal and requests stop if authority was revoked during inference', async () => {
    let hash = '', checks = 0; const key = 'ttrpg.voice.1.' + 'a'.repeat(64)
    const f = await fixture(url => response({ jobKey: key, inputArtifactHash: 'a'.repeat(64), profileHash: hash,
      status: url.endsWith('/jobs') ? 'waiting-for-slot' : 'running', canStart: true })); hash = f.hash
    await expect(f.transport.execute({ jobKey: key, inputArtifactHash: 'a'.repeat(64), execution: {} as never,
      assertCurrentBeforeStart: async () => { if (++checks > 1) throw new Error('consent-revoked-during-inference') } })).rejects.toThrow('consent-revoked-during-inference')
    expect(checks).toBe(2); expect(f.calls.filter(c => c.url.endsWith('/start'))).toHaveLength(1)
    expect(f.calls.some(c => c.url.endsWith('/lease'))).toBe(false); expect(f.calls.some(c => c.url.endsWith('/cancel'))).toBe(true)
  })
  it('times out an unanswered profile request and propagates a pre-aborted probe without sending it', async () => {
    vi.useFakeTimers()
    let probeStarted!: () => void
    const started = new Promise<void>(resolve => { probeStarted = resolve })
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      probeStarted()
      return new Promise<Response>((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }) })
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = expect(createTtrpgOpenLocalVoiceTransportV1()).rejects.toThrow(/传输期限/)
    // Wait for the real asynchronous hash/probe to install its timer before
    // advancing the fake clock; do not weaken either production/test deadline.
    await started
    await vi.advanceTimersByTimeAsync(profile.statusRequestTimeoutMs); await pending
    expect(fetcher).toHaveBeenCalledTimes(1)
    const controller = new AbortController(); controller.abort()
    await expect(createTtrpgOpenLocalVoiceTransportV1(controller.signal)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('cancels a streaming body that exceeds the byte limit even when no content length was declared', async () => {
    const cancelled = vi.fn(), stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(40000)) }, cancel: cancelled,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } })))
    await expect(createTtrpgOpenLocalVoiceTransportV1()).rejects.toThrow(/预算/)
    expect(cancelled).toHaveBeenCalledTimes(1)
  })
})
