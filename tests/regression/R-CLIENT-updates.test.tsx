import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ClientUpdatePanel from '../../src/components/settings/ClientUpdatePanel'
import type { ClientUpdateState } from '../../src/lib/platform/client-updates'
import { registerPendingDraftFlusherV1 } from '../../src/lib/authoring/pending-edit-coordinator'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { delete window.storyforgeClient; vi.useRealTimers(); document.body.innerHTML = '' })
it('web builds render no native updater', async () => {
  const div = document.createElement('div'); const root = createRoot(div)
  await act(async () => root.render(<ClientUpdatePanel />))
  expect(div.textContent).toBe(''); await act(async () => root.unmount())
})
it('startup checks once and waits for user action before downloading', async () => {
  vi.useFakeTimers()
  const state: ClientUpdateState = { platform: 'windows', currentVersion: '4.0.0', status: 'idle' }
  const check = vi.fn(async () => ({ ...state, status: 'available' as const, version: '4.0.1' }))
  const download = vi.fn(async () => state)
  window.storyforgeClient = { getState: async () => state, check, download, install: async () => state, subscribe: () => () => {} }
  const div = document.createElement('div'); const root = createRoot(div)
  await act(async () => root.render(<ClientUpdatePanel notice />))
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(check).toHaveBeenCalledTimes(1); expect(download).not.toHaveBeenCalled()
  expect(div.textContent).toContain('4.0.1')
  await act(async () => root.unmount())
})
it('waits for pending author edits before handing installation to the native client', async () => {
  let finish!: () => void
  const unregister = registerPendingDraftFlusherV1(() => new Promise(resolve => { finish = resolve }))
  const state: ClientUpdateState = { platform: 'windows', currentVersion: '4.0.0', status: 'downloaded', version: '4.0.1' }
  const install = vi.fn(async () => state)
  window.storyforgeClient = { getState: async () => state, check: async () => state, download: async () => state, install, subscribe: () => () => {} }
  const div = document.createElement('div'); const root = createRoot(div)
  try {
    await act(async () => root.render(<ClientUpdatePanel />))
    await act(async () => { [...div.querySelectorAll('button')].find(button => button.textContent === '安装更新')!.click() })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(install).not.toHaveBeenCalled()
    await act(async () => { finish(); await Promise.resolve() })
    expect(install).toHaveBeenCalledTimes(1)
  } finally { unregister(); await act(async () => root.unmount()) }
})
it('failed author saves block installation', async () => {
  const unregister = registerPendingDraftFlusherV1(async () => { throw new Error('disk full') })
  const state: ClientUpdateState = { platform: 'android', currentVersion: '4.0.0', status: 'downloaded', version: '4.0.1' }
  const install = vi.fn(async () => state)
  window.storyforgeClient = { getState: async () => state, check: async () => state, download: async () => state, install, subscribe: () => () => {} }
  const div = document.createElement('div'); const root = createRoot(div)
  try {
    await act(async () => root.render(<ClientUpdatePanel />))
    await act(async () => { [...div.querySelectorAll('button')].find(button => button.textContent === '安装更新')!.click() })
    expect(install).not.toHaveBeenCalled(); expect(div.textContent).toContain('客户端未更新')
  } finally { unregister(); await act(async () => root.unmount()) }
})
