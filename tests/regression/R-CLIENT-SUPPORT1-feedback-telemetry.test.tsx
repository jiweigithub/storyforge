import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FailureFeedbackPanel from '../../src/components/shared/FailureFeedbackPanel'
import { TELEMETRY_KEY, setTelemetryPreferences, telemetryPreferences, recordClientActivity, recordClientError, flushClientTelemetry, deleteClientTelemetry } from '../../src/lib/feedback/client-telemetry'
import { APP_BUILD_ID } from '../../src/lib/version'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
beforeEach(() => { localStorage.clear(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
it('does not collect without consent, deduplicates active days, and drops pending data on opt out', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => { const body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ accepted: body.events.map((row: { id: string }) => row.id), discarded: [] })) })
  recordClientActivity(); await flushClientTelemetry(); expect(fetcher).not.toHaveBeenCalled(); expect(localStorage.getItem(TELEMETRY_KEY)).toBeNull()
  setTelemetryPreferences(true, false); recordClientActivity(); recordClientActivity(); await flushClientTelemetry()
  expect(fetcher).toHaveBeenCalledTimes(1)
  const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(sent.events).toHaveLength(1)
  expect(sent.events[0].kind).toBe('active'); expect(sent.events[0]).not.toHaveProperty('attempts')
  const identity = sent.installationId
  setTelemetryPreferences(true, true); recordClientError({ occurredAt: new Date().toISOString(), source: 'react', name: 'Error', build: APP_BUILD_ID, frames: [] })
  setTelemetryPreferences(false, false); await flushClientTelemetry()
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).id).toBe(identity)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toEqual([])
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('sanitizes forged persisted errors before sending and never records a background active day', async () => {
  setTelemetryPreferences(false, true)
  recordClientError({ occurredAt: new Date().toISOString(), source: 'react', name: 'Error', build: APP_BUILD_ID, frames: ['/storyforge/assets/index-abc.js:2:4'] })
  const state = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!); state.queue[0].error.message = 'sk-SECRET manuscript'; state.queue[0].client.apiKey = 'SECRET'; state.queue[0].payload = 'SECRET'; localStorage.setItem(TELEMETRY_KEY, JSON.stringify(state))
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: [], discarded: [] })))
  await flushClientTelemetry(); expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain('SECRET')
  setTelemetryPreferences(true, false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); recordClientActivity()
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toHaveLength(0)
})
it('backs off after a failed upload, keeps its event id, and forgets only after a deletion receipt', async () => {
  vi.useFakeTimers(); const time = Date.now()
  setTelemetryPreferences(true, false); recordClientActivity()
  const first = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!); const id = first.queue[0].id
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
  await flushClientTelemetry(); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue[0].id).toBe(id)
  vi.setSystemTime(time + 301000); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(2)
  await expect(deleteClientTelemetry()).rejects.toThrow(); expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).id).toBe(first.id)
  fetcher.mockResolvedValue(new Response(JSON.stringify({ deleted: true }))); await deleteClientTelemetry()
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).id).not.toBe(first.id)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).analytics).toBe(false)
})
it('stops this session when saving opt-out fails and does not falsely confirm durable deletion settings', async () => {
  setTelemetryPreferences(true, true); recordClientActivity()
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ deleted: true })))
  const storage = localStorage
  vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new DOMException('full', 'QuotaExceededError') } })
  try {
    expect(setTelemetryPreferences(false, false)).toBe(false)
    expect(telemetryPreferences()).toMatchObject({ analytics: false, errors: false })
    recordClientActivity(Date.now() + 86_400_000)
    recordClientError({ occurredAt: new Date().toISOString(), source: 'react', name: 'Error', build: APP_BUILD_ID, frames: [] })
    await flushClientTelemetry(); expect(fetcher).not.toHaveBeenCalled()
    await expect(deleteClientTelemetry()).rejects.toThrow('本机无法保存关闭选择')
    await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  } finally { vi.unstubAllGlobals(); setTelemetryPreferences(false, false) }
})
async function fill(label: string, value: string) {
  const wrapper = [...container!.querySelectorAll('label')].find(node => node.textContent?.startsWith(label))!
  const element = wrapper.querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement
  const prototype = element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
it('reports a non-crashing bug in-app, preserves input on failure, retries with the same id, and supports suggestions', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(FailureFeedbackPanel)))
  await act(async () => [...container!.querySelectorAll('button')].find(node => node.textContent === '报告问题')!.click())
  await fill('标题', '按钮没有响应'); await fill('问题描述', '点击导出按钮后没有任何变化')
  await act(async () => (container!.querySelector('input[required][type=checkbox]') as HTMLInputElement).click())
  const send = () => act(async () => container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await send(); expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('点击导出')
  const first = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(first.kind).toBe('bug'); expect(first).not.toHaveProperty('diagnostics')
  fetcher.mockImplementation(async (_url, init) => new Response(JSON.stringify({ accepted: true, id: JSON.parse(String(init?.body)).id })))
  await send(); expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).id).toBe(first.id); expect(container.textContent).toContain('提交成功')
  await act(async () => [...container!.querySelectorAll('button')].find(node => node.textContent === '功能建议')!.click())
  await fill('标题', '希望增加导出格式'); await fill('建议与使用场景', '我希望将作品导出为其他格式')
  await act(async () => (container!.querySelector('input[required][type=checkbox]') as HTMLInputElement).click())
  await send(); expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).kind).toBe('feature')
})
