import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ClientAgreement from '../../src/components/settings/ClientAgreement'
import { CLIENT_AGREEMENT_KEY, CLIENT_LEGAL_VERSION, acceptClientAgreement, clientAgreementAccepted } from '../../src/lib/feedback/client-legal'
import { TELEMETRY_KEY, flushClientTelemetry, recordClientActivity, setTelemetryPreferences, telemetryPreferences } from '../../src/lib/feedback/client-telemetry'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
beforeEach(() => {
  localStorage.clear(); vi.stubEnv('MODE', 'portable'); vi.stubEnv('DEV', false)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const render = () => act(async () => root.render(createElement(ClientAgreement, {}, createElement('div', { 'data-editor': true }, '编辑器'))))
const click = (text: string) => act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === text)!.click())
const check = (index: number) => act(async () => (container.querySelectorAll('input')[index] as HTMLInputElement).click())
it('gates the editor with one offline agreement and no separate reporting controls', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  await render(); expect(container.querySelector('[data-editor]')).toBeNull()
  expect(container.querySelectorAll('details')).toHaveLength(0)
  expect(container.querySelectorAll('[aria-label="用户协议正文"]')).toHaveLength(1)
  expect(container.textContent).toContain('API 密钥')
  expect(container.querySelectorAll('input')).toHaveLength(1)
  expect(container.textContent).not.toContain('帮助改进软件')
  expect(container.textContent).not.toContain('分享日常使用情况')
  expect(container.textContent).not.toContain('日常活跃')
  expect([...container.querySelectorAll('input')].every(input => !input.checked)).toBe(true)
  await click('同意协议并继续'); expect(clientAgreementAccepted()).toBe(false)
  await click('不同意，停止使用'); expect(container.textContent).toContain('本地作品不会被删除')
  await click('返回阅读'); await check(0); await click('同意协议并继续')
  expect(container.querySelector('[data-editor]')).not.toBeNull()
  expect(clientAgreementAccepted()).toBe(true)
  expect(JSON.parse(localStorage.getItem(CLIENT_AGREEMENT_KEY)!)).toMatchObject({ terms: CLIENT_LEGAL_VERSION })
  expect(telemetryPreferences()).toMatchObject({ analytics: true, errors: true })
  expect(fetcher).not.toHaveBeenCalled()
})
it('blocks reporting until the unified agreement, then enables the disclosed support processing', async () => {
  setTelemetryPreferences(true, true)
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(JSON.stringify({ accepted: JSON.parse(String(init?.body)).events.map((e: {id: string}) => e.id), discarded: [] })))
  recordClientActivity(); await flushClientTelemetry(); expect(fetcher).not.toHaveBeenCalled()
  await render(); await check(0); await click('同意协议并继续')
  expect(telemetryPreferences()).toMatchObject({ analytics: true, errors: true })
  recordClientActivity(); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  localStorage.setItem(CLIENT_AGREEMENT_KEY, JSON.stringify({ terms: 'old', privacy: 'old', acceptedAt: new Date().toISOString() }))
  recordClientActivity(Date.now() + 86400000); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toHaveLength(0)
})
it('does not bypass agreement on failed storage; clearing a receipt returns the visible editor to consent', async () => {
  await render(); await check(0)
  const storage = localStorage
  vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('full') } })
  await click('同意协议并继续'); expect(container.querySelector('[data-editor]')).toBeNull()
  expect(container.textContent).toContain('无法保存同意记录')
  vi.unstubAllGlobals(); await click('同意协议并继续'); expect(container.querySelector('[data-editor]')).not.toBeNull()
  localStorage.removeItem(CLIENT_AGREEMENT_KEY)
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: CLIENT_AGREEMENT_KEY })))
  expect(container.querySelector('[data-editor]')).toBeNull()
})
it('validates receipts and keeps development/web previews outside the packaged startup gate', async () => {
  for (const value of ['broken', '{}', JSON.stringify({ terms: CLIENT_LEGAL_VERSION, privacy: CLIENT_LEGAL_VERSION, acceptedAt: 'bad' })]) { localStorage.setItem(CLIENT_AGREEMENT_KEY, value); expect(clientAgreementAccepted()).toBe(false) }
  expect(acceptClientAgreement()).toBe(true)
  localStorage.clear(); vi.stubEnv('DEV', true); await render(); expect(container.querySelector('[data-editor]')).not.toBeNull()
})
