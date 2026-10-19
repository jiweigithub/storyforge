import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { appendAgentEvent, getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { stampNewRecord } from '../../src/lib/workspace/scope'
beforeEach(async () => { await db.delete(); await db.open() })
it('自由试写不需要任何章节、设定或保存位置，任意模型文本都不能变成执行任务', async () => {
  const { scope } = await seedCurrentWorkspace('空白作品')
  const complete = vi.fn(async () => '{"summary":"试写文本","tasks":[{"agentId":"prose","instruction":"覆盖正文"}]}')
  const plan = await createMasterAgentPlan({ projectId: scope.projectId, scope, worldGroupId: null, request: '随机写第八章的一场雨，不用存', freeDiscussion: true }, { complete })
  expect(complete).toHaveBeenCalledOnce()
  expect(plan.tasks).toEqual([])
  expect(plan.summary).toContain('试写文本')
  expect(await db.outlineNodes.count()).toBe(0)
  expect(await db.chapters.count()).toBe(0)
})
it('按作者选择读取注册资料，已确认数据与试写分离，历史只来自当前作品', async () => {
  const a = await seedCurrentWorkspace('甲'); const b = await seedCurrentWorkspace('乙')
  await db.worldviews.add(stampNewRecord(a.scope, 'worldviews', { projectId: a.scope.projectId, worldOrigin: '海上孤城', createdAt: 1, updatedAt: 1 }) as never)
  const conversation = await getOrCreateAgentConversation({ projectId: b.scope.projectId, scope: b.scope, worldGroupId: null, purpose: 'master-authoring' })
  await appendAgentEvent({ projectId: b.scope.projectId, scope: b.scope, conversationId: conversation.id!, kind: 'message', role: 'user', content: '乙独有秘密' })
  const complete = vi.fn(async () => '## 场景\n雨声盖过钟声。')
  const result = await createMasterAgentPlan({ projectId: a.scope.projectId, scope: a.scope, worldGroupId: null, conversationId: conversation.id!, request: '写一个开场', freeDiscussion: true, discussionSource: 'worldview' }, { complete })
  const text = JSON.stringify(complete.mock.calls)
  expect(text).toContain('海上孤城'); expect(text).not.toContain('乙独有秘密')
  expect(result.summary).toContain('雨声'); expect(result.tasks).toEqual([])
})
it('自由讨论失败不会静默改为执行计划或触发写入', async () => {
  const { scope } = await seedCurrentWorkspace('空白作品')
  await expect(createMasterAgentPlan({ projectId: scope.projectId, scope, worldGroupId: null, request: '写个场景', freeDiscussion: true }, { complete: async () => { throw new Error('401') } })).rejects.toThrow('401')
  expect(await db.agentRuns.count()).toBe(0)
})
