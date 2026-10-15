import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, correctChatMemory, deleteProductRuntimeSession, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {pendingChatMemoryCorrectionsV1} from '../../src/lib/character-interaction/memory-reconciliation'
import {readChatActionRevisionSourceV1} from '../../src/lib/character-interaction/action-revision'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {vi.restoreAllMocks(); await db.delete()})
const command = async (sessionId: number) => {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
const action: ChatNarrativeActionV1 = {kind: 'speak', text: '你没有答应协助，我自己去看看门口。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
  waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}

async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture()
  const sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'correction-source', text: '我只是暂借地图，没有答应帮忙寻找铜印。'})
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'original', participantKey: 'guard', kind: 'key-memory', content: '旧的错误摘要', importance: 1,
    sourceEventSequences: [sent.sequence], evidenceExcerpt: '没有答应帮忙'})
  const correction = await correctChatMemory({...await command(f.sessionId), memoryId: 'original', replacementMemoryId: 'corrected', content: '玩家只是暂借地图，没有答应帮忙。',
    sourceEventSequences: [sent.sequence], evidenceExcerpt: '没有答应帮忙', reason: '依据原话修正'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: sent.sequence})
  return {...f, correctionSequence: correction.sequence}
}
function output(f: Awaited<ReturnType<typeof prepared>>, passed = true) {
  return {...chatActionReviewOutputFixture(), memoryChecks: [{memoryId: 'corrected', sourceSequence: f.correctionSequence, passed, reason: '注入判定仅验证合同链路，不是真实模型审查。'}]}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '记忆核对合同工程检查',
    runAI: async () => JSON.stringify(action), runReviewAI: async () => JSON.stringify(output(f))}
}
/** This future binding is test-only. Production registry stays on v19 until
 * required context, prompts and historical reader compatibility are delivered. */
function enableContractFixture() {
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = original(id)
    return id === 'character.chat-narrative-action-review' ? {...skill, promptVersion: 'chat-narrative-action-review-v20'} : skill
  })
}

it('rejects a new reconciliation field under the current production binding without any commit or hidden replay', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => {calls++; return JSON.stringify(output(f))}})).rejects.toThrow('旧审查合同')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toBe(1)
})

it('recovers a saved candidate and records only an exact successful reviewed correction, then preserves it after nested branch deletion and import', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  enableContractFixture()
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => {calls++; return JSON.stringify(action)}, onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(output(f))}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const result = await readProductRuntimeState(f.sessionId), receipt = result.interaction!.chatNarrative!.memoryReconciliations![0]
  expect(receipt).toMatchObject({memoryId: 'corrected', sourceSequence: f.correctionSequence, actorKey: 'guard', messageId: `message:harness:${runId}`})
  expect(pendingChatMemoryCorrectionsV1(result.interaction!, 'guard')).toEqual([])
  expect(result.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(calls).toBe(2)
  const earlier = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.lastSequence, title: '核对之前'})
  expect(pendingChatMemoryCorrectionsV1((await readProductRuntimeState(earlier.id!)).interaction!, 'guard')).toHaveLength(1)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: result.lastSequence, title: '核对之后'})
  const nested = await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, title: '核对继承'})
  const nestedState = await readProductRuntimeState(nested.id!)
  await deleteProductRuntimeSession(child.id!); await deleteProductRuntimeSession(f.sessionId)
  expect(await readProductRuntimeState(nested.id!)).toEqual(nestedState)
  expect(nestedState.interaction!.chatNarrative!.memoryReconciliations![0].sourceSequence).toBeLessThan(0)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === '核对继承')!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(nestedState.interaction)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  await deleteProductRuntimeSession(imported.id!)
  expect(await db.productRuntimeEvents.where('sessionId').equals(imported.id!).count()).toBe(0)
})

it('does not allow consequence-only revision to bypass a failed correction review', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  enableContractFixture()
  const rejected = output(f, false); rejected.checks.find(c => c.check === 'consequences')!.passed = false
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => JSON.stringify(rejected)})).rejects.toThrow('语义审查未通过')
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId, actorKey: 'guard'})).toBeNull()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(pendingChatMemoryCorrectionsV1(before.interaction!, 'guard')).toHaveLength(1)
})

it('stales saved coverage when a newer correction replaces it and preserves both corrections', async () => {
  const f = await prepared(); enableContractFixture()
  const generated = await generateInteractionRuntimeCandidateV1(input(f))
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, corrected = state.memories.find(m => m.memoryId === 'corrected')!
  await correctChatMemory({...await command(f.sessionId), memoryId: 'corrected', replacementMemoryId: 'again', content: '没有承诺帮忙找铜印。',
    sourceEventSequences: corrected.sourceEventSequences, evidenceExcerpt: corrected.evidenceExcerpt, reason: '进一步核对原话'})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.chatNarrative).not.toHaveProperty('memoryReconciliations')
  expect(pendingChatMemoryCorrectionsV1(after, 'guard').map(m => m.memoryId)).toEqual(['again'])
  expect(after.memories.find(m => m.memoryId === 'corrected')?.supersededByMemoryId).toBe('again')
})

it('rejects incorrect reconciliation coverage before persisting an approved candidate', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId); enableContractFixture()
  const wrong = output(f); wrong.memoryChecks[0].sourceSequence--
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => JSON.stringify(wrong)})).rejects.toThrow('待处理记忆不一致')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
