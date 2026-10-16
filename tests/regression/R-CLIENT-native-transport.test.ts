import { describe, expect, it, vi } from 'vitest'
import { createAndroidFetch } from '../../src/lib/platform/android-fetch'

function fixture() {
  const native = {
    open: vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/event-stream' } })),
    read: vi.fn<() => Promise<{ done: boolean; data?: string }>>(),
    cancel: vi.fn(async () => {}),
  }
  const browser = vi.fn(async () => new Response('local'))
  return { native, browser, fetch: createAndroidFetch(native, browser, 'https://localhost') }
}
describe('Android native streaming boundary', () => {
  it('streams split UTF-8 chunks and propagates credentials only to the configured HTTPS request', async () => {
    const f = fixture()
    const encoded = new TextEncoder().encode('data: 中文\n\n')
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    f.native.read.mockResolvedValueOnce({ done: false, data: encode(encoded.slice(0, 7)) })
      .mockResolvedValueOnce({ done: false, data: encode(encoded.slice(7)) }).mockResolvedValue({ done: true })
    const response = await f.fetch('https://api.example.com/v1', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: '{}' })
    expect(await response.text()).toBe('data: 中文\n\n')
    expect(f.native.open).toHaveBeenCalledTimes(1)
    expect(f.native.open.mock.calls[0][0]).toMatchObject({ url: 'https://api.example.com/v1', method: 'POST' })
    expect(new Headers(f.native.open.mock.calls[0][0].headers).get('authorization')).toBe('Bearer test-only')
    expect(f.browser).not.toHaveBeenCalled()
  })
  it('cancels a dispatched stream without replaying it', async () => {
    const f = fixture(); const controller = new AbortController()
    f.native.read.mockImplementation(() => new Promise(() => {}))
    const response = await f.fetch('https://api.example.com/v1', { signal: controller.signal })
    const reading = response.text(); controller.abort()
    await expect(reading).rejects.toThrow()
    expect(f.native.cancel).toHaveBeenCalled(); expect(f.native.open).toHaveBeenCalledTimes(1)
  })
  it('never submits an already aborted request or falls back after an unknown native error', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort()
    await expect(f.fetch('https://api.example.com/v1', { signal: controller.signal })).rejects.toThrow()
    expect(f.native.open).not.toHaveBeenCalled()
    f.native.open.mockRejectedValueOnce(new Error('unknown'))
    await expect(f.fetch('https://api.example.com/v1')).rejects.toThrow('unknown')
    expect(f.native.open).toHaveBeenCalledTimes(1); expect(f.browser).not.toHaveBeenCalled()
  })
  it('keeps local assets in WebView and refuses cleartext credential transport', async () => {
    const f = fixture()
    expect(await (await f.fetch('/storyforge/assets/file.json')).text()).toBe('local')
    await expect(f.fetch('http://example.com/v1')).rejects.toThrow('HTTPS')
    expect(f.native.open).not.toHaveBeenCalled()
  })
})
