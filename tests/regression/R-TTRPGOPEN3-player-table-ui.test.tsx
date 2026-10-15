import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenPlayTable from '../../src/components/ttrpg/TtrpgOpenPlayTable'
import TtrpgPlayTable from '../../src/components/ttrpg/TtrpgPlayTable'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN3 real player desk identity and preview boundary', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(async () => { await db.delete();await db.open();host = document.createElement('div');document.body.append(host);root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount());host.remove();db.close();vi.unstubAllEnvs() })
  async function until(check: () => boolean) {
    for (let n = 0; n < 200; n++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) });if (check()) return }
    throw new Error(`view did not resolve: ${host.textContent}`)
  }
  async function fixture() {
    const f = await readyOpenTtrpgSessionV1('scoped player screen', pkg => {
      pkg.ttrpg!.campaign.characterTemplates[0].playerProfile!.secret = 'HERO-PRIVATE-SCREEN'
      pkg.ttrpg!.campaign.characterTemplates[1].playerProfile!.secret = 'AI-PRIVATE-SCREEN'
    })
    const props = { session: (await db.productRuntimeSessions.get(f.sessionId))!, scope: f.scope, state: await readProductRuntimeState(f.sessionId), onChanged: vi.fn(async () => {}), onCheckpoint: vi.fn(async () => {}) }
    return { f, props }
  }
  it('keeps the unfinished public open player disabled by default without passing V2 to the old scripted runner', async () => {
    vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW', '')
    const { props } = await fixture()
    await act(async () => root.render(createElement(TtrpgPlayTable, props)))
    expect(host.textContent).toContain('此冒险尚未开放游玩');expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN')
    expect(host.querySelector('[data-testid="ttrpg-open-player-table"]')).toBeNull();expect(props.onChanged).not.toHaveBeenCalled()
  })
  it('requires identity confirmation, renders only the owned secret and clears private state during handoff', async () => {
    const { props } = await fixture()
    await act(async () => root.render(createElement(TtrpgOpenPlayTable, props)))
    await until(() => Boolean(host.querySelector('select')))
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN');expect(host.textContent).not.toContain('AI-PRIVATE-SCREEN')
    const select = host.querySelector('select')!
    await act(async () => { select.value = OPEN_HUMAN_VIEWER;select.dispatchEvent(new Event('change', { bubbles: true })) })
    const enter = [...host.querySelectorAll('button')].find(b => b.textContent === '确认身份并进入')!
    await act(async () => enter.click())
    await until(() => (host.textContent ?? '').includes('HERO-PRIVATE-SCREEN'))
    expect(host.textContent).not.toContain('AI-PRIVATE-SCREEN')
    const leave = [...host.querySelectorAll('button')].find(b => b.textContent === '交接给另一位玩家')!
    await act(async () => leave.click())
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN')
    await until(() => Boolean(host.querySelector('select')))
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN');expect(host.querySelector('textarea')).toBeNull()
  })
})
