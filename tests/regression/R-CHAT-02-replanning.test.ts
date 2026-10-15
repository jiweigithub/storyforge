import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_REPLANNING_ACTION_RULES_V1, CHAT_REPLANNING_REVIEW_RULES_V1, supportsChatReplanningPromptV1, supportsChatReplanningReviewV1} from '../../src/lib/character-interaction/narrative-replanning'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatSituationConstructionRequestV1} from '../../src/lib/character-interaction/narrative-progression'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const pause: ChatNarrativeActionV1 = {kind: 'pause', text: '铜印还没找到，这个办法暂时走不通，我先停一下。', goalKey: 'find-seal',
  evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused', nextPossibilities: []}
const text = '我可以先确认屋内是否有人愿意提供见闻，不需要你参加。'
const replan: ChatNarrativeActionV1 = {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'active',
  situationRequest: {threadKey: 'investigate', direction: '核查屋内是否有可接触且愿意提供见闻的人，不预定有人在场或回答。', evidenceFactKeys: ['lost'], evidenceExcerpt: text}}
async function paused() {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true}), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'replan.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具：角色自行暂缓',
    runAI: async () => JSON.stringify(pause), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const current = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'replan.continue', baseSequence: current.sequence, baseStateHash: current.stateHash, kind: 'continue', sourceEventSequence: current.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  return f
}

it.each([false, true])('records immutable legacy prompt bytes for a self-paused goal (options=%s)', async options => {
  const f = await paused(), original = skills.getAgentSkillV1
  const versions = {'character.chat-narrative-action': 'chat-narrative-action-v35', 'character.chat-narrative-options': 'chat-narrative-options-v25',
    'character.chat-narrative-action-review': 'chat-narrative-action-review-v28', 'character.chat-narrative-options-review': 'chat-narrative-options-review-v22'}
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id in versions ? {...original(id), promptVersion: versions[id as keyof typeof versions]} : original(id))
  const alternative = {...replan, text: '我想先确认还有哪些公共区域可以查看。', situationRequest: {...replan.situationRequest!, direction: '核实屋内其它可查看公共区域，不预定位置或发现。', evidenceExcerpt: '我想先确认还有哪些公共区域可以查看。'}}
  const hashes: string[] = []
  await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: options ? 'character.chat-narrative-options' : 'character.chat-narrative-action', objective: '工程夹具：原目标重规划',
    runAI: async messages => {hashes.push(createHash('sha256').update(messages[0].content).digest('hex')); return JSON.stringify(options ? {options: [replan, alternative]} : replan)},
    runReviewAI: async messages => {hashes.push(createHash('sha256').update(messages[0].content).digest('hex')); return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))} : chatActionReviewOutputFixture())}})
  expect(hashes).toEqual(options
    ? ['e0848ef2b2e3795896dd6f4f51e07634b1c47d6bfbdb3d63b6c654d800123d0c', '2b23767603c14a43d984a73b3acf4cabfba7f679095b815170b13ad0d1efdac0']
    : ['3974cf6b79d35e07ce958bd4300a7a020561c5382a054bfe4b79ad5b904a1711', '7cfb4958f9d3442c1f1c0cb057e5ef86e52e5a27acba0b2871336c5d262758b4'])
})

it.each([false, true])('new frozen rules recover the same goal and preserve an unexecuted context request through import (options=%s)', async options => {
  const f = await paused(), before = await readProductRuntimeState(f.sessionId), goal = before.interaction!.chatNarrative!.situation.goals.find(g => g.goalKey === replan.goalKey)!
  expect(goal.status).toBe('paused'); expect(goal.playerPause).toBeUndefined()
  const alternative = {...replan, text: '先核实还有哪些公共区域能查看。', situationRequest: {...replan.situationRequest!, evidenceExcerpt: '先核实还有哪些公共区域能查看。'}}
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: options ? 'character.chat-narrative-options' : 'character.chat-narrative-action', objective: '工程夹具：同一未完成目标换办法',
    runAI: async messages => {
      calls++; for (const rule of CHAT_REPLANNING_ACTION_RULES_V1) expect(messages[0].content).toContain(rule)
      expect(messages[1].content).not.toContain('柜台下'); expect(messages[1].content).toContain('paused')
      return JSON.stringify(options ? {options: [replan, alternative]} : replan)
    }, runReviewAI: async messages => {
      calls++; for (const rule of CHAT_REPLANNING_REVIEW_RULES_V1) expect(messages[0].content).toContain(rule)
      return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))} : chatActionReviewOutputFixture())
    }})
  expect(calls).toBe(2); expect(generated.snapshot.contract.budget.maxModelCalls).toBe(2)
  expect(generated.snapshot.contract.executionBindings!.map(b => b.promptVersion)).toContain(options ? 'chat-narrative-options-v26' : 'chat-narrative-action-v36')
  expect(generated.snapshot.contract.executionBindings!.map(b => b.promptVersion)).toContain(options ? 'chat-narrative-options-review-v23' : 'chat-narrative-action-review-v29')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, ...(options ? {optionKey: 'option-1'} : {})})
  const after = (await readProductRuntimeState(f.sessionId)).interaction!, story = after.chatNarrative!
  expect(story.situation.goals).toHaveLength(before.interaction!.chatNarrative!.situation.goals.length)
  expect(story.situation.goals.find(g => g.goalKey === goal.goalKey)).toMatchObject({...goal, status: 'active', updatedSequence: story.lastEventSequence})
  expect(story.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  expect(story.pendingSituation?.direction).toBe(replan.situationRequest!.direction)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  db.close(); await db.open()
  expect((await readProductRuntimeState(session.id!)).interaction).toEqual(after)
  const v = await readProductRuntimeStateVersion(session.id!)
  await requestChatNarrativeTrigger({sessionId: session.id!, commandId: 'restored.continue', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'continue', sourceEventSequence: v.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  expect(chatSituationConstructionRequestV1((await readProductRuntimeState(session.id!)).interaction!, 'guard')?.text).toBe(replan.situationRequest!.direction)
  expect(calls).toBe(2)
})

it('retains a repeated-wait rejection without adopting or silently repairing it', async () => {
  const f = await paused(), before = await readProductRuntimeState(f.sessionId), repeated = {...pause, goalStatus: null}, review = chatActionReviewOutputFixture()
  review.checks.find(c => c.check === 'meaningful-direction')!.passed = false
  review.checks.find(c => c.check === 'meaningful-direction')!.reason = '工程模拟：重复相同等待，未评估仍可有据核实的替代方向。'
  const raw = JSON.stringify(repeated); let calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具：跨轮审查拒绝',
    runAI: async () => {calls++; return raw}, runReviewAI: async () => {calls++; return JSON.stringify(review)}})).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === raw)).toBe(true)
})

it.each(['still-paused', 'hidden-evidence'])('new guidance cannot bypass %s authority', async kind => {
  const f = await paused(), before = await readProductRuntimeState(f.sessionId), action = structuredClone(replan)
  if (kind === 'still-paused') action.goalStatus = null
  else action.evidenceFactKeys = ['secret']
  let calls = 0, reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具：既有硬边界',
    runAI: async () => {calls++; return JSON.stringify(action)}, runReviewAI: async () => {reviews++; return JSON.stringify(chatActionReviewOutputFixture())}})).rejects.toThrow()
  expect([calls, reviews]).toEqual([1, 0]); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('only enables replanning instructions on exact new bindings, not saved consequence revisions', () => {
  for (const v of ['chat-narrative-action-v36', 'chat-narrative-options-v26']) expect(supportsChatReplanningPromptV1(v)).toBe(true)
  for (const v of ['chat-narrative-action-review-v29', 'chat-narrative-options-review-v23']) expect(supportsChatReplanningReviewV1(v)).toBe(true)
  for (const v of [undefined, 'chat-narrative-action-v35', 'chat-narrative-options-v25', 'chat-action-revision-v16', 'chat-narrative-action-v999']) expect(supportsChatReplanningPromptV1(v)).toBe(false)
  for (const v of [undefined, 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v999']) expect(supportsChatReplanningReviewV1(v)).toBe(false)
})
