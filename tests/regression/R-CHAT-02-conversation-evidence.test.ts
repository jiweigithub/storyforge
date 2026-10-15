import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {createInitialInteractionState, buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatConversationEvidenceV1, assertChatConversationEvidenceReviewVersionV1} from '../../src/lib/character-interaction/narrative-conversation-evidence'
import {chatActionReviewPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture, chatActionReviewFixture, chatActionReviewOutputFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const ack = (): ChatNarrativeActionV1 => ({kind: 'speak', text: '好，我听着。', goalKey: 'find-seal', evidenceFactKeys: [], audienceKeys: ['guard', 'player'], waitingForPlayer: true,
  newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null, nextPossibilities: null})
function initial() {
  const s = createInitialInteractionState(chatNarrativeFixture())
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.remainingDirectorBudget = 100
  s.messages.push({messageId: 'fresh-player', eventSequence: 2, role: 'player', speakerKey: 'player', audienceKeys: ['player', 'guard'], text: '我想先说句话。', replyToSequence: null, supersededBySequence: null})
  return requestChatNarrativeTriggerV1(s, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(s = initial(), a = ack()) {
  return applyReviewedChatNarrativeActionV1(s, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'ack', action: a, review: chatActionReviewFixture(a)})
}
it('grounds a bounded acknowledgement in the actual delivered player message without altering narrative state', () => {
  const s = initial(), before = structuredClone(s), out = apply(s)
  expect(chatConversationEvidenceV1(s, 'guard', s.chatNarrative!.triggers[0], ack())).toBe('player-message')
  expect(out.chatNarrative!.situation).toEqual(s.chatNarrative!.situation)
  expect(out.relationships).toEqual(s.relationships); expect(out.knowledge).toEqual(s.knowledge)
  expect(out.chatNarrative!.triggers[0].status).toBe('waiting-player'); expect(s).toEqual(before)
  const window = buildInteractionContextWindow(s, 'guard', {maxCharacters: 12000, maxRecentMessages: 1, retrievalVersion: 'chat-relevance-v4'})
  expect(window.messages.map(m => m.messageId)).toEqual(['fresh-player'])
})
it('allows ordinary conversation after personal closure without fabricating a replacement goal', () => {
  const s = initial(); s.chatNarrative!.situation.goals[0].status = 'fulfilled'; s.chatNarrative!.situation.possibilities = []
  const out = apply(s, {...ack(), goalKey: null, waitingForPlayer: false})
  expect(out.chatNarrative!.situation).toEqual(s.chatNarrative!.situation)
  expect(out.chatNarrative!.triggers[0].status).toBe('complete')
})
it.each(['continue', 'scene-start', 'not-first', 'excluded', 'superseded', 'old-source', 'later-role-message', 'audience-expansion', 'unknown-actor', 'complete', 'attempt', 'not-waiting', 'fact', 'disclosure', 'goal-status', 'goal-update', 'thread-update', 'relation', 'belief', 'promise', 'plan-clear', 'plan-new', 'resume'] as const)('refuses unsupported fact-free %s without partial effects', kind => {
  const s = initial(), a = ack(), n = s.chatNarrative!
  if (kind === 'continue' || kind === 'scene-start') n.triggers[0].kind = kind
  if (kind === 'not-first') {n.triggers[0].actionSequences = [1]; n.permissions.maxActionsPerTrigger = 3}
  if (kind === 'excluded') n.excludedMessageIds = ['fresh-player']
  if (kind === 'superseded') s.messages[0].supersededBySequence = 3
  if (kind === 'old-source') n.triggers[0].sourceEventSequence = 1
  if (kind === 'later-role-message') s.messages.push({...s.messages[0], messageId: 'later-role', role: 'character', speakerKey: 'guard', eventSequence: 3})
  if (kind === 'audience-expansion') a.audienceKeys.push('artisan')
  if (kind === 'unknown-actor') a.goalKey = 'fix-road'
  if (kind === 'complete' || kind === 'attempt') a.kind = kind
  if (kind === 'not-waiting') a.waitingForPlayer = false
  if (kind === 'fact') a.newFacts = [{factKey: 'new', kind: 'observation', text: a.text, evidenceFactKeys: ['lost'], evidenceExcerpt: a.text}]
  if (kind === 'disclosure') a.disclosures = [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: a.text}]
  if (kind === 'goal-status') a.goalStatus = 'paused'
  if (kind === 'goal-update') a.goalUpdates = [{goalKey: 'find-seal', status: 'paused', evidenceFactKeys: ['lost'], evidenceExcerpt: a.text}]
  if (kind === 'thread-update') a.threadUpdates = [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: a.text}]
  if (kind === 'relation') a.relationshipUpdates = [{dimensionKey: 'trust', delta: 1, sourceEventSequence: 2, playerExcerpt: s.messages[0].text, evidenceExcerpt: a.text}]
  if (kind === 'belief') a.beliefUpdates = [{beliefKey: 'borrowed', text: null, evidenceFactKeys: ['lost']}]
  if (kind === 'promise') a.commitmentEffects = [{kind: 'promise', terms: a.text, evidenceExcerpt: a.text}]
  if (kind === 'plan-clear') a.nextPossibilities = []
  if (kind === 'plan-new') a.nextPossibilities = [{text: a.text, evidenceFactKeys: ['lost']}]
  if (kind === 'resume') a.resumeGoal = {playerEventSequence: 2, playerExcerpt: s.messages[0].text}
  const before = structuredClone(s); expect(() => apply(s, a)).toThrow(); expect(s).toEqual(before)
})
it('keeps the legacy event and frozen reviewer closed, including mixed candidate groups', () => {
  const a = ack(), withFacts = {...a, evidenceFactKeys: ['lost']}
  expect(() => applyChatNarrativeActionV1(initial(), {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'legacy', action: a})).toThrow('独立审查')
  expect(() => assertChatConversationEvidenceReviewVersionV1([withFacts, a], 'chat-narrative-options-review-v16')).toThrow('旧审查')
  expect(() => assertChatConversationEvidenceReviewVersionV1([withFacts, a], 'chat-narrative-options-review-v17')).not.toThrow()
  const old = chatActionReviewPromptRulesV1({actions: [a], options: false, compact: false, playerPause: true})
  expect(old.join('\n')).not.toContain('无事实引用的对话回应专审')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const message = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'message', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'fresh', text: '我想先说句话。'})
  const next = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'reply', baseSequence: next.sequence, baseStateHash: next.stateHash, kind: 'player-response', sourceEventSequence: message.sequence})
  return f
}
function input(f: Awaited<ReturnType<typeof prepared>>, a = ack()) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '工程注入：有对话依据的自然回应', runAI: async () => JSON.stringify(a), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}
}
it('saves and resumes the actual source-bound acknowledgement, adopts once, and retains a semantic refusal of concealed factual claims', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId); let id = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async messages => {calls++; expect(messages[0].content).toContain('自然回应也可以有对话依据'); expect(messages[1].content).toContain('我想先说句话'); return JSON.stringify(ack())}, onNarrativeActionSaved: runId => {id = runId; throw Error('saved')}})).rejects.toThrow('saved')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before); db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId: id, runReviewAI: async messages => {calls++; expect(messages[0].content).toContain('无事实引用的对话回应专审'); return JSON.stringify(chatActionReviewOutputFixture())}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: id}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: id})
  expect(calls).toBe(2); expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  const next = await prepared(), rejected = chatActionReviewOutputFixture(); rejected.checks.find(c => c.check === 'visibility')!.passed = false
  const prior = await readProductRuntimeState(next.sessionId)
  await expect(generateInteractionRuntimeCandidateV1({...input(next, {...ack(), text: '铜印就在柜台下的木箱里。'}), runReviewAI: async () => JSON.stringify(rejected)})).rejects.toThrow('语义审查')
  expect(await readProductRuntimeState(next.sessionId)).toEqual(prior)
})
it('does not call an old frozen reviewer for a new fact-free response', async () => {
  const f = await prepared(), original = skills.getAgentSkillV1; let reviews = 0
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action-review' ? {...original(id), promptVersion: 'chat-narrative-action-review-v22'} : original(id))
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => {reviews++; return JSON.stringify(chatActionReviewOutputFixture())}})).rejects.toThrow('旧审查')
  expect(reviews).toBe(0)
})
