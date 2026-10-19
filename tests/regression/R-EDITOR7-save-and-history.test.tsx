import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import CoordinationView from '../../src/components/editor/CoordinationView'
import LegacySettingHistory from '../../src/components/agent/LegacySettingHistory'
import { claimLegacySettingHistoryV1, LEGACY_SETTING_HISTORY_KEY, parseLegacySettingHistory } from '../../src/lib/agent/legacy-setting-history'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { getOrCreateAgentConversation, readAgentEvents } from '../../src/lib/agent/conversations'
import type { DetailedOutline, EmotionBeatCard } from '../../src/lib/types'
vi.mock('../../src/components/shared/Dialog', () => ({ useDialog: () => ({ confirm: async () => true }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>
beforeEach(async () => { await db.delete(); await db.open(); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); localStorage.clear() })
const props = {
  chapterTitle: '待保存', chapterIndex: 1, totalChapters: 3,
  detailedOutline: { id: 1, scenes: [{ summary: '平静', conflict: '', pace: 'slow', characters: [], location: '' }] } as DetailedOutline,
  emotionBeatCard: { id: 1, beats: [{ emotionTone: '紧张', readerFeeling: '紧张', sceneGoal: '', intensity: 5 }] } as EmotionBeatCard,
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  expect(button).toBeTruthy(); await act(async () => button!.click())
}
it('保存仍在等待时不显示成功，重复点击不重复保存，完成后才反馈', async () => {
  vi.useFakeTimers()
  let resolve!: () => void
  const save = vi.fn(() => new Promise<void>(done => { resolve = done }))
  await act(async () => root.render(createElement(CoordinationView, { ...props, onApplyBeats: save })))
  await click('细纲优先')
  await act(async () => vi.advanceTimersByTime(5000))
  expect(host.textContent).not.toContain('已根据场景细纲调整')
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => resolve())
  expect(host.textContent).toContain('已根据场景细纲调整')
})
it('失败可重试，切章后旧异步回调不能显示成功', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('写入失败')).mockResolvedValueOnce(undefined)
  await act(async () => root.render(createElement(CoordinationView, { ...props, onApplyBeats: save })))
  await click('细纲优先'); expect(host.textContent).toContain('保存失败')
  await click('细纲优先'); expect(host.textContent).toContain('已根据场景细纲调整')
  let resolve!: () => void
  const delayed = () => new Promise<void>(done => { resolve = done })
  await act(async () => root.render(createElement(CoordinationView, { ...props, onApplyBeats: delayed })))
  await click('细纲优先')
  await act(async () => root.render(createElement(CoordinationView, { ...props, chapterTitle: '另一章', onApplyBeats: delayed })))
  await act(async () => resolve())
  expect(host.textContent).not.toContain('已根据场景细纲调整')
})
it('旧全局历史默认不展示内容，也不自动写入当前作品', async () => {
  const raw = JSON.stringify([{ role: 'user', content: '作品甲独有设定：银色钟楼' }])
  localStorage.setItem(LEGACY_SETTING_HISTORY_KEY, raw)
  const { scope } = await seedCurrentWorkspace('作品乙')
  await act(async () => root.render(createElement(LegacySettingHistory, { projectId: scope.projectId, worldGroupId: null, onClaimed: vi.fn() })))
  expect(host.textContent).not.toContain('银色钟楼')
  expect(await db.agentEvents.count()).toBe(0)
  expect(localStorage.getItem(LEGACY_SETTING_HISTORY_KEY)).toBe(raw)
})
it('明确认领复制到当前作品，重复认领幂等，另一作品看不到，原始文件不变', async () => {
  const a = await seedCurrentWorkspace('甲'); const b = await seedCurrentWorkspace('乙')
  const raw = JSON.stringify([{ role: 'user', content: '银色钟楼' }, { role: 'assistant', content: '仅作讨论的草案' }])
  localStorage.setItem(LEGACY_SETTING_HISTORY_KEY, raw)
  const first = await claimLegacySettingHistoryV1(a.scope.projectId, null, raw, a.scope)
  expect(first.imported).toBe(2)
  expect((await claimLegacySettingHistoryV1(a.scope.projectId, null, raw, a.scope)).imported).toBe(0)
  expect(await readAgentEvents(first.conversationId, b.scope)).toEqual([])
  const other = await getOrCreateAgentConversation({ projectId: b.scope.projectId, worldGroupId: null, purpose: 'master-authoring' })
  expect(await readAgentEvents(other.id!, b.scope)).toEqual([])
  expect(localStorage.getItem(LEGACY_SETTING_HISTORY_KEY)).toBe(raw)
  expect(await db.codexEntries.count()).toBe(0)
  expect(() => parseLegacySettingHistory('{broken')).toThrow()
})

it('确认期间切换作品时拒绝认领，不创建另一作品的历史', async () => {
  const a = await seedCurrentWorkspace('甲'); const b = await seedCurrentWorkspace('乙')
  const raw = JSON.stringify([{ role: 'user', content: '甲的隐私' }])
  await expect(claimLegacySettingHistoryV1(b.scope.projectId, null, raw, a.scope)).rejects.toThrow('作品已切换')
  expect(await db.agentEvents.count()).toBe(0)
  expect(await db.agentConversations.count()).toBe(0)
})
