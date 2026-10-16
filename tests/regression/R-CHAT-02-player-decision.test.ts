import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_PLAYER_DECISION_ACTION_RULE_V1, CHAT_PLAYER_DECISION_REVIEW_RULE_V1, supportsChatPlayerDecisionPromptV1, supportsChatPlayerDecisionReviewV1} from '../../src/lib/character-interaction/player-decision-prompt'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it.each([false, true])('preserves a reviewer rejection of a false player dependency without committing an action (options=%s)', async options => {
  const f = await seedChatNarrativeRuntimeFixture(), version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'decision.start', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const action: ChatNarrativeActionV1 = {kind: 'attempt', text: '你不用参与，我自己换个办法。想加入时再告诉我。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
    audienceKeys: ['guard', 'player'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
  const review = chatActionReviewOutputFixture()
  Object.assign(review.checks.find(c => c.check === 'player-agency')!, {passed: false, reason: '工程注入：该独立办法不依赖玩家加入，旧邀请不能阻塞它。'})
  let calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: options ? 'character.chat-narrative-options' : 'character.chat-narrative-action', objective: '工程反例，不能当作模型语义判断准确率',
    runAI: async messages => {
      calls++; expect(messages[0].content).toContain(CHAT_PLAYER_DECISION_ACTION_RULE_V1)
      expect(messages[1].content).not.toContain('铜印在柜台下')
      return JSON.stringify(options ? {options: [action, {...action, text: '我自己先想别的办法，不用你参加。'}]} : action)
    }, runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain(CHAT_PLAYER_DECISION_REVIEW_RULE_V1)
      return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...review}))} : review)
    }})).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content.includes(action.text))).toBe(true)
})

it.each([true, false])('keeps a real player decision blocking, while a reviewed independent action commits its consequences (waiting=%s)', async waiting => {
  const f = await seedChatNarrativeRuntimeFixture(), version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'decision.positive', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const text = waiting ? '你愿意陪我一起找铜印吗？我先等你的决定。' : '我在纸上记下了铜印失踪这件事。'
  const action: ChatNarrativeActionV1 = {kind: waiting ? 'attempt' : 'complete', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
    waitingForPlayer: waiting, newFacts: waiting ? [] : [{factKey: 'own-note', kind: 'observation', text, evidenceFactKeys: ['lost'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null}
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程正例，不扩张行动权限',
    runAI: async () => JSON.stringify(action), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  expect(generated.snapshot.contract.executionBindings!.map(binding => binding.promptVersion)).toEqual(expect.arrayContaining(['chat-narrative-action-v37', 'chat-narrative-action-review-v31']))
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers.at(-1)!.status).toBe(waiting ? 'waiting-player' : 'complete')
  expect(state.chatNarrative!.situation.facts.some(fact => fact.factKey === 'own-note')).toBe(!waiting)
  expect(state.messages.at(-1)!.text).toBe(text)
})

it('does not retrofit new decision guidance into old producers, revisions, or unknown future versions', () => {
  for (const version of [undefined, 'chat-narrative-action-v36', 'chat-narrative-options-v26', 'chat-action-revision-v16', 'chat-narrative-action-v999']) expect(supportsChatPlayerDecisionPromptV1(version)).toBe(false)
  for (const version of [undefined, 'chat-narrative-action-review-v30', 'chat-narrative-options-review-v24', 'chat-narrative-action-review-v999']) expect(supportsChatPlayerDecisionReviewV1(version)).toBe(false)
})
