import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { inspectStages, parseStages } from '../../src/lib/types/story-arc'
import { useStoryArcStore } from '../../src/stores/story-arc'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { updateStoryArcStagesLifecycle } from '../../src/lib/storyline/lifecycle'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { prepareStoryArcCopilot } from '../../src/lib/agent/story-arc-copilot'

const validStage = { id: 'author-stage', title: '起点', description: '作者原文', keyEvents: ['事件'] }

async function seedMalformedArc() {
  const { scope } = await seedCurrentWorkspace('异常阶段保存隔离测试')
  const stages = ' [ { "id":"author-stage", "title":"起点", "description":"作者原文", "extra":{"keep":"扩展字段"} } ] '
  const id = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', {
    projectId: scope.projectId, name: '保留原线', type: 'main', stages, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }) as never) as number
  await useStoryArcStore.getState().loadAll(scope)
  return { scope, stages, id }
}

describe('故事线异常阶段读取与保留', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useStoryArcStore.setState({ arcs: [], activeArcId: null, intentAlignmentByArcId: {} })
  })
  afterEach(() => db.close())

  it.each([undefined, null])('上下文读取不会因关键事件 %s 崩溃或改写原始记录', async keyEvents => {
    const { scope } = await seedCurrentWorkspace('异常阶段隔离测试')
    const stages = JSON.stringify([{ ...validStage, keyEvents }])
    const id = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', {
      projectId: scope.projectId, name: '保留原线', type: 'main', stages, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }) as never) as number
    await useStoryArcStore.getState().loadAll(scope)
    expect(useStoryArcStore.getState().activeArcId).toBe(id)
    expect(() => useStoryArcStore.getState().buildStoryArcContext()).not.toThrow()
    expect((await db.storyArcs.get(id))?.stages).toBe(stages)
    expect((await db.storyArcs.get(id))?.updatedAt).toBe(1)
  })

  it.each([null, 'stage', 17, [], { ...validStage, keyEvents: null }, { ...validStage, keyEvents: [null] }])(
    '异常成员不能被解析成可编辑的合法阶段：%s', stage => {
      expect(parseStages(JSON.stringify([stage]))).toEqual([])
    },
  )

  it('合法单阶段与未知扩展字段逐值保留，不套用 AI 生成的最少阶段数量', () => {
    const stage = { ...validStage, authorExtension: { note: '额外作者字段' } }
    expect(parseStages(JSON.stringify([stage]))).toEqual([stage])
    expect(parseStages('[]')).toEqual([])
  })

  it('正式故事线生成在模型调用前报告坏阶段，不以空数组伪装来源', async () => {
    const { scope, stages, id } = await seedMalformedArc()
    const runAI = vi.fn()
    await expect(prepareStoryArcCopilot({
      projectId: scope.projectId, scope, worldGroupId: null, authorRequest: '扩写现有故事线',
      mutationRequest: { operation: 'expand', targetArcId: id },
    }, { runAI })).rejects.toThrow('故事线阶段数据格式异常')
    expect(runAI).not.toHaveBeenCalled()
    expect((await db.storyArcs.get(id))?.stages).toBe(stages)
  })

  it.each([
    '[', '{}', '[null]',
    JSON.stringify([{ ...validStage, id: '' }]),
    JSON.stringify([validStage, validStage]),
    JSON.stringify([{ ...validStage, description: 1 }]),
    JSON.stringify([{ ...validStage, turningPoint: {} }]),
    JSON.stringify([{ ...validStage, startVolume: '1' }]),
  ])('可见诊断区分错误数据与合法空阶段：%s', raw => {
    expect(inspectStages(raw).valid).toBe(false)
  })

  it('普通编辑与非法修复不能覆盖坏数据，显式修复保留身份、扩展字段和进度引用', async () => {
    const { scope, stages, id } = await seedMalformedArc()
    const progressId = await db.storylineProgress.add(stampNewRecord(scope, 'storylineProgress', {
      projectId: scope.projectId, arcId: id, currentStageId: validStage.id,
      status: 'active', progressNote: '作者进度', involvedEntities: '[]', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }) as never) as number
    await expect(useStoryArcStore.getState().updateStages(id, [])).rejects.toThrow('显式保存修复')
    await expect(updateStoryArcStagesLifecycle({ arcId: id, stages: '[null]', validStageIds: [], expectedStagesJson: stages }))
      .rejects.toThrow('阶段 1')
    expect((await db.storyArcs.get(id))?.stages).toBe(stages)
    const repaired = [{ ...JSON.parse(stages)[0], keyEvents: ['保留的事件'] }]
    await useStoryArcStore.getState().updateStages(id, repaired, stages)
    expect(JSON.parse((await db.storyArcs.get(id))!.stages)).toEqual(repaired)
    expect((await db.storyArcs.get(id))?.workId).toBe(scope.workId)
    expect((await db.storylineProgress.get(progressId))?.currentStageId).toBe(validStage.id)
    await useStoryArcStore.getState().loadAll(scope)
    expect(useStoryArcStore.getState().getActiveStages()).toEqual(repaired)
    expect(useStoryArcStore.getState().buildStoryArcContext()).toContain('保留的事件')
    // Explicitly deleting a stage still detaches only the corresponding progress reference.
    await useStoryArcStore.getState().updateStages(id, [])
    expect((await db.storylineProgress.get(progressId))?.currentStageId).toBeNull()
    expect((await db.storylineProgress.get(progressId))?.progressNote).toBe('作者进度')
  })

  it('读取后底层数据变化时拒绝旧修复，失败事务不写入或解除进度', async () => {
    const { stages, id } = await seedMalformedArc()
    const newer = JSON.stringify([{ ...validStage, keyEvents: ['另一窗口的新事件'] }])
    await db.storyArcs.update(id, { stages: newer })
    await expect(useStoryArcStore.getState().updateStages(id, [validStage], stages)).rejects.toThrow('阶段已变化')
    expect((await db.storyArcs.get(id))?.stages).toBe(newer)
  })

  it('进度更新失败时回滚阶段写入，原始数据与编辑前 Store 不变', async () => {
    const { scope, stages, id } = await seedMalformedArc()
    const progressId = await db.storylineProgress.add(stampNewRecord(scope, 'storylineProgress', {
      arcId: id, currentStageId: validStage.id, status: 'active', progressNote: '保留进度',
      involvedEntities: '[]', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }) as never) as number
    const failure = vi.spyOn(db.storylineProgress, 'update').mockRejectedValueOnce(new Error('隔离事务失败'))
    try {
      await expect(useStoryArcStore.getState().updateStages(id, [], stages)).rejects.toThrow('隔离事务失败')
      expect((await db.storyArcs.get(id))?.stages).toBe(stages)
      expect(useStoryArcStore.getState().arcs.find(arc => arc.id === id)?.stages).toBe(stages)
      expect((await db.storylineProgress.get(progressId))?.currentStageId).toBe(validStage.id)
    } finally {
      failure.mockRestore()
    }
  })

  it('切换活动作品后不能保存旧作品的阶段修复', async () => {
    const { scope, stages, id } = await seedMalformedArc()
    const otherWork = await addCurrentWorkFixtureV1({
      projectId: scope.projectId, worldId: scope.worldId!, create: { kind: 'novel', title: '其他作品' },
    })
    await db.projects.update(scope.projectId, { activeWorkId: otherWork.id })
    await expect(useStoryArcStore.getState().updateStages(id, [validStage], stages)).rejects.toThrow('不属于当前作品')
    expect((await db.storyArcs.get(id))?.stages).toBe(stages)
  })

  it('原始坏阶段仍能导出导入，Gateway 保留父记录但不发布虚假的阶段资源', async () => {
    const { scope, stages, id } = await seedMalformedArc()
    const frozenScope = { ...scope, worldGroupId: null }
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: frozenScope, limit: 100 })
    expect(page.nextCursor).toBeNull()
    const records = page.items.filter(resource => resource.sourceRefs.some(ref => ref.table === 'storyArcs' && ref.recordId === id))
    expect(records.length).toBeGreaterThan(0)
    expect(records.some(resource => resource.resourceKey.includes(':stage:'))).toBe(false)
    const original = records.find(resource => resource.resourceKey.endsWith(':field:stages'))!
    expect(original).toBeDefined()
    const read = await CANON_RESOURCE_PROVIDER_V1.readOriginal({
      scope: frozenScope, resourceKey: original.resourceKey, sourceRef: original.sourceRefs[0], maxTokens: 2000,
    })
    expect(read.content).toBe(stages)
    const exported = await deriveExportProjectJSON(scope.projectId)
    const importedId = await deriveImportProjectJSON(exported)
    const imported = await db.storyArcs.where('projectId').equals(importedId).first()
    expect(imported?.stages).toBe(stages)
    expect((await db.storyArcs.get(id))?.stages).toBe(stages)
  })
})
