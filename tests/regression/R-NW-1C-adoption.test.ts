import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as aiClient from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { makeRagEntryKey } from '../../src/lib/retrieval/rag-library'
import { generateNarrativeAnnotationCandidateV1, readNarrativeAnnotationRunV1, reviseNarrativeAnnotationCandidateV1,
  adoptNarrativeAnnotationCandidateV1, rejectNarrativeAnnotationCandidateV1 } from '../../src/lib/agent/run/narrative-annotation-durable'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { readNarrativeCanonContextV1 } from '../../src/lib/world-engine/narrative-domain-context'

async function setup() {
  const fixture = await seedConfirmedNarrativeDomainV1()
  const selection = { table: 'storyTimelineEvents', sourceUid: fixture.event.row.ragDocumentId as string, owner: fixture.input.owner,
    entryKeys: [makeRagEntryKey(fixture.event.row.ragDocumentId, 'description')] }
  const draft = JSON.stringify({ annotations: { narrativeModalityV1: 'intent', narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'review-v1' } }, clearFields: [] })
  const request = { scope: fixture.scope, selection, instruction: '检查这个事件是否只是计划；保持其他字段',
    modelIdentity: { provider: 'fixture', model: 'test-only' }, runAI: vi.fn(async () => ({ output: draft, durationMs: 1 })) }
  return { fixture, request, draft }
}

describe('NW-1C · 持久候选、审核与原子采纳', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('候选不改领域数据，刷新恢复同一版本，作者采纳后影响正式投影并且重复采纳幂等', async () => {
    const { fixture, request } = await setup()
    const before = await db.storyTimelineEvents.get(fixture.event.id)
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    expect(generated.candidate.artifact.originalText).toContain('intent')
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(await db.storyTimelineEvents.get(fixture.event.id)).toEqual(before)
    db.close(); await db.open()
    const restored = await readNarrativeAnnotationRunV1(fixture.scope, generated.snapshot.run.id)
    expect(restored.candidate).toEqual(generated.candidate)
    const input = { scope: fixture.scope, runId: generated.snapshot.run.id, candidateHash: generated.candidate.candidateHash }
    const first = await adoptNarrativeAnnotationCandidateV1(input)
    expect(first.snapshot.projection.state).toBe('completed')
    const row = (await db.storyTimelineEvents.get(fixture.event.id))!
    expect(row.narrativeAuthorityV1?.mode).toBe('candidate-adoption')
    expect(row.narrativeModalityV1).toBe('intent')
    const projection = await projectNarrativeDomainsV1(fixture.input)
    expect(projection.bundle.records.find(item => item.kind === 'event')?.modality).toBe('intent')
    expect(await readNarrativeCanonContextV1({ scope: fixture.scope })).toContain('作者意图，尚未兑现')
    const second = await adoptNarrativeAnnotationCandidateV1(input)
    expect(second.snapshot.projection.terminalReceiptHash).toBe(first.snapshot.projection.terminalReceiptHash)
    expect(await db.storyTimelineEvents.get(fixture.event.id)).toEqual(row)
    expect(request.runAI).toHaveBeenCalledTimes(1)
  })

  it('刷新后拒绝采纳引用了已改角色简介的旧候选，不重发模型或改写目标', async () => {
    const { fixture, request } = await setup()
    const actor = (await db.characters.get(fixture.ids.a))!
    request.selection.entryKeys.push(makeRagEntryKey(actor.ragDocumentId!, 'shortDescription'))
    const before = await db.storyTimelineEvents.get(fixture.event.id)
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    await db.characters.update(actor.id!, { shortDescription: '作者已重新定义此角色的身份' })
    db.close(); await db.open()
    const restored = await readNarrativeAnnotationRunV1(fixture.scope, generated.snapshot.run.id)
    expect(restored.staleReason).toContain('原文已变化')
    await expect(adoptNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id,
      candidateHash: generated.candidate.candidateHash })).rejects.toThrow('原文已变化')
    expect(await db.storyTimelineEvents.get(fixture.event.id)).toEqual(before)
    expect(request.runAI).toHaveBeenCalledTimes(1)
  })

  it('只做一次确定性修复，保留第一次响应；连续失败保留可编辑候选但不能采纳', async () => {
    const { request, fixture, draft } = await setup()
    request.runAI.mockResolvedValueOnce({ output: '{bad', durationMs: 1 }).mockResolvedValueOnce({ output: draft, durationMs: 1 })
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    expect(request.runAI).toHaveBeenCalledTimes(2)
    expect(generated.candidate.artifact.originalText).toBe('{bad')
    expect(generated.candidate.artifact.repair?.result).toBe('repaired')
    const failed = await generateNarrativeAnnotationCandidateV1({ ...request, runAI: async () => ({ output: '{bad', durationMs: 1 }) })
    await expect(adoptNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: failed.snapshot.run.id, candidateHash: failed.candidate.candidateHash })).rejects.toThrow('不可采纳')
    const repaired = await reviseNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: failed.snapshot.run.id,
      expectedCandidateHash: failed.candidate.candidateHash, draft })
    expect(repaired.candidate.revision).toBe(2)
    expect(repaired.candidate.artifact.originalText).toBe('{bad')
    await adoptNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: failed.snapshot.run.id, candidateHash: repaired.candidate.candidateHash })
  })

  it('误信候选漏掉必需认知结构时给出精确修复要求，补齐后仍保留错误信念原值', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    await db.knowledgeLedger.update(fixture.ids.knowledge, { narrativeEpistemicV1: undefined, narrativeAuthorityV1: undefined })
    const row = (await db.knowledgeLedger.get(fixture.ids.knowledge))!
    const incomplete = { annotations: { narrativeModalityV1: 'belief' }, clearFields: [] }
    const complete = { annotations: { ...incomplete.annotations, narrativeEpistemicV1: {
      attitude: 'believe', transition: 'acquire', assertedValue: { kind: 'text', value: row.belief }, sourceEvent: null, revises: null,
    } }, clearFields: [] }
    const responses = [incomplete, complete]
    const runAI = vi.fn(async (_messages: import('../../src/lib/types').ChatMessage[]) => ({ output: JSON.stringify(responses.shift()), durationMs: 1 }))
    const result = await generateNarrativeAnnotationCandidateV1({ scope: fixture.scope,
      selection: { table: 'knowledgeLedger', sourceUid: row.ragDocumentId!, owner: fixture.input.owner,
        entryKeys: [makeRagEntryKey(row.ragDocumentId!, 'belief')] },
      instruction: '明确区分角色的错误信念与事实', modelIdentity: { provider: 'fixture', model: 'test-only' }, runAI })
    expect(runAI).toHaveBeenCalledTimes(2)
    const repairMessages = runAI.mock.calls[1][0]
    expect(repairMessages[repairMessages.length - 1]?.content).toContain('必须包含 narrativeEpistemicV1')
    expect(result.candidate.artifact.status).toBe('ready')
    expect(result.candidate.artifact.originalText).toBe(JSON.stringify(incomplete))
    expect(result.candidate.proposal?.annotations.narrativeEpistemicV1).toEqual(complete.annotations.narrativeEpistemicV1)
    expect(await db.knowledgeLedger.get(fixture.ids.knowledge)).toEqual(row)
    const wrongValue = JSON.stringify({ ...complete, annotations: { ...complete.annotations, narrativeEpistemicV1: {
      ...complete.annotations.narrativeEpistemicV1, assertedValue: { kind: 'text', value: '用客观事实替换角色误信' },
    } } })
    await expect(reviseNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: result.snapshot.run.id,
      expectedCandidateHash: result.candidate.candidateHash, draft: wrongValue })).rejects.toThrow('误信原值冲突')
  })

  it('拒绝不写领域；旧窗口的候选 hash 不能覆盖作者修订', async () => {
    const { fixture, request, draft } = await setup()
    const before = await db.storyTimelineEvents.get(fixture.event.id)
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    const revised = await reviseNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id,
      expectedCandidateHash: generated.candidate.candidateHash, draft: draft.replace('intent', 'belief') })
    await expect(adoptNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id, candidateHash: generated.candidate.candidateHash })).rejects.toThrow('审核版本')
    await rejectNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id, candidateHash: revised.candidate.candidateHash })
    expect(await db.storyTimelineEvents.get(fixture.event.id)).toEqual(before)
  })

  it('来源改写、删除或权限改变后拒绝采纳，原候选和领域数据都保留', async () => {
    const { fixture, request } = await setup()
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    let input = { scope: fixture.scope, runId: generated.snapshot.run.id, candidateHash: generated.candidate.candidateHash }
    const before = (await db.storyTimelineEvents.get(fixture.event.id))!
    await db.storyTimelineEvents.update(fixture.event.id, { description: '已经改写' })
    expect((await readNarrativeAnnotationRunV1(fixture.scope, input.runId)).staleReason).toContain('已变化')
    await expect(adoptNarrativeAnnotationCandidateV1(input)).rejects.toThrow('已变化')
    expect((await readNarrativeAnnotationRunV1(fixture.scope, input.runId)).snapshot.projection.state).toBe('paused')
    await db.storyTimelineEvents.put(before)
    const policyCandidate = await generateNarrativeAnnotationCandidateV1(request)
    input = { scope: fixture.scope, runId: policyCandidate.snapshot.run.id, candidateHash: policyCandidate.candidate.candidateHash }
    await db.storyTimelineEvents.put({ ...before, ragPolicy: { enabled: false } })
    await expect(adoptNarrativeAnnotationCandidateV1(input)).rejects.toThrow('策略已变化')
    await db.storyTimelineEvents.put(before)
    const deletionCandidate = await generateNarrativeAnnotationCandidateV1(request)
    input = { scope: fixture.scope, runId: deletionCandidate.snapshot.run.id, candidateHash: deletionCandidate.candidate.candidateHash }
    await db.storyTimelineEvents.delete(fixture.event.id)
    await expect(adoptNarrativeAnnotationCandidateV1(input)).rejects.toThrow('来源不存在')
  })

  it('写入后的账本故障回滚领域写入和作者确认，重试只提交一次', async () => {
    const { fixture, request } = await setup()
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    const before = await db.storyTimelineEvents.get(fixture.event.id)
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'adoption.committed') throw new Error('injected-storage-failure')
      return add(...args)
    })
    const input = { scope: fixture.scope, runId: generated.snapshot.run.id, candidateHash: generated.candidate.candidateHash }
    await expect(adoptNarrativeAnnotationCandidateV1(input)).rejects.toThrow('injected-storage-failure')
    expect(await db.storyTimelineEvents.get(fixture.event.id)).toEqual(before)
    expect((await readNarrativeAnnotationRunV1(fixture.scope, input.runId)).state.intent).toBeNull()
    spy.mockRestore()
    expect((await adoptNarrativeAnnotationCandidateV1(input)).snapshot.projection.state).toBe('completed')
  })

  it('未知调用停止且刷新不会重新发送；已知原始响应仍可检查', async () => {
    const { fixture, request } = await setup()
    request.runAI.mockRejectedValue(new Error('transport-unknown'))
    await expect(generateNarrativeAnnotationCandidateV1(request)).rejects.toThrow('transport-unknown')
    const run = (await db.agentRuns.toArray())[0]
    const loaded = await readNarrativeAnnotationRunV1(fixture.scope, run.id!)
    expect(loaded.snapshot.projection.state).toBe('paused')
    expect(loaded.candidate).toBeNull()
    expect(loaded.state.calls[0].output).toBeNull()
    expect(request.runAI).toHaveBeenCalledTimes(1)
  })

  it('真实时钟的毫秒小数先规范化，Codex 用量不伪装成已知 API 费用', async () => {
    const { request, draft } = await setup()
    vi.spyOn(aiClient, 'chat').mockResolvedValue(draft)
    let tick = 100.4
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => { tick += 0.65; return tick })
    const result = await generateNarrativeAnnotationCandidateV1({ ...request, runAI: undefined,
      aiConfig: { provider: 'codex', model: 'gpt-6.1-sol', apiKey: '', baseUrl: '/storyforge/local-codex/v1', maxTokens: 6000, temperature: 0.2 } })
    expect(Number.isInteger(result.candidate.artifact.callEvidence[0].latencyMs)).toBe(true)
    expect(result.candidate.artifact.callEvidence[0].estimatedCostUsd).toBeNull()
    expect(result.candidate.artifact.callEvidence[0].provider).toBe('codex')
    clock.mockRestore()
  })

  it('不能把公开事件只改成计划却保留公开权限；投影失败的候选禁止正式采纳', async () => {
    const { request, fixture } = await setup()
    const raw = JSON.stringify({ annotations: { narrativeModalityV1: 'intent' }, clearFields: [] })
    const generated = await generateNarrativeAnnotationCandidateV1({ ...request, runAI: async () => ({ output: raw, durationMs: 1 }) })
    expect(generated.candidate.artifact.status).toBe('blocked')
    expect(generated.candidate.artifact.issues[0].message).toContain('author-only')
    await expect(adoptNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id,
      candidateHash: generated.candidate.candidateHash })).rejects.toThrow('不可采纳')
  })

  it('完整备份往返后以稳定身份重绑待审核候选，原作品不受恢复后的采纳影响', async () => {
    const { fixture, request } = await setup()
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    const backup = await deriveExportProjectJSON(fixture.scope.projectId)
    const projectId = await deriveImportProjectJSON(backup)
    const work = (await db.works.where('projectId').equals(projectId).toArray()).find(row => row.code === fixture.input.owner.workCode)!
    const scope = { projectId, workId: work.id!, worldId: work.worldId }
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    expect(run.id).not.toBe(generated.snapshot.run.id)
    const loaded = await readNarrativeAnnotationRunV1(scope, run.id!)
    expect(loaded.candidate?.candidateHash).toBe(generated.candidate.candidateHash)
    await adoptNarrativeAnnotationCandidateV1({ scope, runId: run.id!, candidateHash: loaded.candidate!.candidateHash })
    const restored = (await db.storyTimelineEvents.where('projectId').equals(projectId).toArray()).find(row => row.ragDocumentId === request.selection.sourceUid)!
    expect(restored.narrativeModalityV1).toBe('intent')
    expect((await db.storyTimelineEvents.get(fixture.event.id))!.narrativeModalityV1).toBe('established')
  })

  it('已采纳记录导入后重新核验，不重写领域或重复模型；当前内容变化就拒绝旧回执', async () => {
    const { fixture, request } = await setup()
    const generated = await generateNarrativeAnnotationCandidateV1(request)
    const original = await adoptNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id, candidateHash: generated.candidate.candidateHash })
    const projectId = await deriveImportProjectJSON(await deriveExportProjectJSON(fixture.scope.projectId))
    const work = (await db.works.where('projectId').equals(projectId).toArray())[0]
    const scope = { projectId, workId: work.id!, worldId: work.worldId }
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    const loaded = await readNarrativeAnnotationRunV1(scope, run.id!)
    expect(loaded.needsReverification).toBe(true)
    expect(loaded.staleReason).toBeNull()
    const row = (await db.storyTimelineEvents.where('projectId').equals(projectId).toArray()).find(row => row.ragDocumentId === request.selection.sourceUid)!
    const accepted = await adoptNarrativeAnnotationCandidateV1({ scope, runId: run.id!, candidateHash: loaded.candidate!.candidateHash })
    expect(accepted.snapshot.projection.state).toBe('completed')
    expect(accepted.snapshot.projection.terminalReceiptHash).not.toBe(original.snapshot.projection.terminalReceiptHash)
    expect(await db.storyTimelineEvents.get(row.id!)).toEqual(row)
    expect(accepted.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    expect(request.runAI).toHaveBeenCalledTimes(1)
    await db.storyTimelineEvents.update(row.id!, { description: '导入后编辑了原文' })
    expect((await readNarrativeAnnotationRunV1(scope, run.id!)).staleReason).toContain('已变化')
    await expect(adoptNarrativeAnnotationCandidateV1({ scope, runId: run.id!, candidateHash: loaded.candidate!.candidateHash })).rejects.toThrow('已变化')
    expect((await readNarrativeAnnotationRunV1(scope, run.id!)).snapshot.projection.state).toBe('paused')
  })
})
