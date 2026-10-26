import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProductProductionStudio from '../../src/components/product/ProductProductionStudio'
import { listProductProductionWorkspaceV1 } from '../../src/lib/product-production/service'
import { WorldReferenceErrorV1 } from '../../src/lib/world-engine/world-reference'
import type { WorkspaceScope } from '../../src/lib/types'

vi.mock('../../src/lib/product-production/service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/product-production/service')>()
  return { ...actual, listProductProductionWorkspaceV1: vi.fn() }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const scope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }
const otherScope: WorkspaceScope = { projectId: 4, worldId: 5, workId: 6 }
const allowedProducts = ['avg'] as const
const listWorkspace = vi.mocked(listProductProductionWorkspaceV1)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot> | null

function deferredWorkspace() {
  let reject!: (error: Error) => void
  const promise = new Promise<Awaited<ReturnType<typeof listProductProductionWorkspaceV1>>>((_resolve, fail) => {
    reject = fail
  })
  return { promise, reject }
}

async function render(currentScope = scope) {
  await act(async () => root!.render(createElement(ProductProductionStudio, {
    scope: currentScope, allowedProducts,
  })))
}

async function drainWorkspace() {
  await act(async () => {
    await Promise.allSettled(listWorkspace.mock.results.map(result => result.value))
  })
}

beforeEach(() => {
  listWorkspace.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
    root = null
    await vi.dynamicImportSettled()
  })
  host.remove()
})

describe('PRODUCT-PROD-1E · workspace load lifecycle', () => {
  it('shows the current frozen-release load failure without an unhandled rejection', async () => {
    const error = new WorldReferenceErrorV1('release-missing', 'WorldRelease 不存在')
    listWorkspace.mockRejectedValueOnce(error)
    await render()
    await drainWorkspace()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(error.message)
    expect(listWorkspace).toHaveBeenCalledTimes(1)
  })

  it('does not replace the current scope error with an older scope failure', async () => {
    const previous = deferredWorkspace()
    listWorkspace.mockReturnValueOnce(previous.promise)
      .mockRejectedValueOnce(new Error('当前作品的来源已失效'))
    await render()
    await render(otherScope)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('当前作品的来源已失效')
    await act(async () => previous.reject(new Error('旧作品的延迟失败')))
    await drainWorkspace()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('当前作品的来源已失效')
    expect(listWorkspace).toHaveBeenCalledTimes(2)
  })

  it('settles a late rejection after unmount without reopening the page or retrying', async () => {
    const pending = deferredWorkspace()
    listWorkspace.mockReturnValueOnce(pending.promise)
    await render()
    await act(async () => { root!.unmount(); root = null })
    await act(async () => pending.reject(new WorldReferenceErrorV1('release-missing', 'WorldRelease 不存在')))
    await drainWorkspace()
    expect(host.childElementCount).toBe(0)
    expect(listWorkspace).toHaveBeenCalledTimes(1)
  })
})
