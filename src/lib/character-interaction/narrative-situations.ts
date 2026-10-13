import {canonicalStringify} from '../agent/run/hash'
import type {CharacterInteractionRuntimeState} from '../types'
import {CHAT_SITUATION_REVIEW_CHECKS_V1} from '../types/chat-narrative'
import type {ChatSituationDraftV1, ChatSituationReviewV1} from '../types/chat-narrative'
import {parseChatNarrativeStateV1} from './narrative-contract'
import {chatRelationshipEvidenceV1} from './narrative-relationships'

function fail(message: string): never {throw new Error(`[chat-situation] ${message}`)}
function object(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('情境字段不在允许闭集')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 2000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('情境文本无效或超出预算')
}
function key(value: unknown): asserts value is string {
  text(value, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail('情境标识无效')
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('情境数组超出上限')
  return value
}
function keys(value: unknown, max = 200): string[] {
  const array = list(value, max); array.forEach(key)
  if (new Set(array).size !== array.length) fail('情境引用重复')
  return array as string[]
}

export function parseChatSituationDraftV1(value: unknown): ChatSituationDraftV1 {
  const draft = object(value, 'kind,title,location,timeLabel,newFacts,newGoals,newThreads,possibilities')
  if (draft.kind !== 'chat-situation') fail('情境候选类型无效')
  text(draft.title, 1000); text(draft.location, 1000); text(draft.timeLabel, 1000)
  for (const value of list(draft.newFacts, 5)) {
    const fact = object(value, 'factKey,kind,text,audienceKeys,evidenceFactKeys,seedExcerpt')
    key(fact.factKey); text(fact.text); text(fact.seedExcerpt)
    if (!['observation', 'object', 'place', 'temporary-character'].includes(String(fact.kind))) fail('情境事实类型无效')
    keys(fact.audienceKeys, 33); keys(fact.evidenceFactKeys)
  }
  for (const value of list(draft.newGoals, 8)) {
    const goal = object(value, 'goalKey,actorKey,desire,concern,boundary,evidenceFactKeys')
    key(goal.goalKey); key(goal.actorKey); text(goal.desire); text(goal.concern); text(goal.boundary); keys(goal.evidenceFactKeys)
  }
  for (const value of list(draft.newThreads, 3)) {
    const thread = object(value, 'threadKey,title,question,audienceKeys,participantKeys,evidenceFactKeys,closureSignals')
    key(thread.threadKey); text(thread.title, 1000); text(thread.question)
    keys(thread.audienceKeys, 33); keys(thread.participantKeys, 32); keys(thread.evidenceFactKeys)
    const signals = list(thread.closureSignals, 8)
    if (!signals.length) fail('新剧情线没有收束信号')
    signals.forEach(signal => text(signal, 1000))
  }
  for (const value of list(draft.possibilities, 32)) {
    const possibility = object(value, 'actorKey,text,evidenceFactKeys')
    key(possibility.actorKey); text(possibility.text); keys(possibility.evidenceFactKeys)
  }
  return structuredClone(value) as ChatSituationDraftV1
}

/** Review findings are evidence, not a claim of infallible semantic validation.
 * All five questions must be answered for this exact proposal before adoption. */
export function parseChatSituationReviewV1(value: unknown, draft: ChatSituationDraftV1): ChatSituationReviewV1 {
  const review = object(value, 'reviewedProposalJson,checks')
  if (review.reviewedProposalJson !== canonicalStringify(draft)) fail('情境审查绑定了另一份候选')
  const checks = list(review.checks, CHAT_SITUATION_REVIEW_CHECKS_V1.length)
  if (checks.length !== CHAT_SITUATION_REVIEW_CHECKS_V1.length) fail('情境语义审查不完整')
  const seen = new Set<string>()
  for (const item of checks) {
    const check = object(item, 'check,passed,reason')
    if (!CHAT_SITUATION_REVIEW_CHECKS_V1.includes(check.check as typeof CHAT_SITUATION_REVIEW_CHECKS_V1[number]) || seen.has(String(check.check))) fail('情境审查项目无效或重复')
    if (typeof check.passed !== 'boolean') fail('情境审查结果无效')
    text(check.reason); seen.add(String(check.check))
  }
  return structuredClone(value) as ChatSituationReviewV1
}

export function isChatSituationPreparedV1(state: CharacterInteractionRuntimeState): boolean {
  const story = state.chatNarrative, trigger = story?.triggers[story.triggers.length - 1]
  return !!story && !!trigger && (trigger.kind !== 'player-seed'
    || story.situation.seed.origin === 'player-request' && story.situation.seed.sourceEventSequence === trigger.requestedSequence)
}

/** Preserve every established fact, goal and unresolved thread. The constructor
 * may add authorized local background; it cannot execute the player's choices. */
export function applyChatSituationV1(stateValue: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: unknown; draft: unknown; review: unknown
}): CharacterInteractionRuntimeState {
  const draft = parseChatSituationDraftV1(input.draft), review = parseChatSituationReviewV1(input.review, draft)
  if (review.checks.some(check => !check.passed)) fail('情境语义审查未通过，原有局面保留')
  return previewChatSituationV1(stateValue, {...input, draft})
}

/** Deterministic dry-run only. Callers cannot persist this projection in place
 * of the reviewed situation command. */
export function previewChatSituationV1(stateValue: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: unknown; draft: unknown
}): CharacterInteractionRuntimeState {
  const state = structuredClone(stateValue), story = state.chatNarrative, scene = state.activeScene
  if (!story || !scene || story.situation.sceneKey !== scene.sceneKey) fail('缺少已衔接的当前情境')
  const trigger = story.triggers[story.triggers.length - 1]
  if (!trigger || trigger.kind !== 'player-seed' || trigger.status !== 'ready' || trigger.requestedSequence !== input.triggerSequence
    || trigger.actionSequences.length || !trigger.seed) fail('情境构建必须来自尚未执行的明确玩家请求')
  if (story.situation.seed.origin === 'player-request' && story.situation.seed.sourceEventSequence === trigger.requestedSequence) fail('该请求已经构建情境')
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0 || input.sequence <= story.lastEventSequence) fail('情境提交事件无效')
  if (state.remainingDirectorBudget < 2) fail('情境构建与审查预算不足')
  const draft = parseChatSituationDraftV1(input.draft)
  if (draft.newFacts.length > story.permissions.maxNewFactsPerAction) fail('新增情境事实超出授权数量')
  if (!draft.newFacts.length && !draft.newGoals.length && !draft.newThreads.length && !draft.possibilities.length) fail('情境候选没有可执行的新方向')
  const viewers = [state.playerKey, ...scene.activeParticipantKeys]
  const initialFacts = new Map(story.situation.facts.map(fact => [fact.factKey, fact]))
  for (const item of draft.newFacts) {
    if (!story.permissions.allowedNewFactKinds.includes(item.kind)) fail('新增情境事实类型未经作品授权')
    if (story.situation.facts.some(f => f.factKey === item.factKey || f.text === item.text)) fail('不得重写或重复创建既有事实')
    if (item.audienceKeys.some(viewer => !viewers.includes(viewer))) fail('新增事实引用场外人物')
    if (!trigger.seed.includes(item.seedExcerpt)) fail('新增情境事实缺少真实请求依据')
    for (const factKey of item.evidenceFactKeys) {
      const fact = initialFacts.get(factKey)
      if (!fact || item.audienceKeys.some(viewer => !fact.audienceKeys.includes(viewer))) fail('新增事实不能传播不可知的依据')
    }
    story.situation.facts.push({factKey: item.factKey, text: item.text, audienceKeys: item.audienceKeys,
      origin: 'runtime-situation', sourceKnowledgeKey: null, sourceEventSequence: input.sequence})
  }
  if (draft.location !== story.situation.location && (!story.permissions.allowedNewFactKinds.includes('place')
    || !trigger.seed.includes(draft.location) || !draft.newFacts.some(f => f.kind === 'place' && f.text.includes(draft.location) && viewers.every(v => f.audienceKeys.includes(v))))) fail('地点变化缺少明确请求及授权的公开地点事实')
  if (draft.timeLabel !== story.situation.timeLabel && (!trigger.seed.includes(draft.timeLabel)
    || !draft.newFacts.some(f => f.kind === 'observation' && f.text.includes(draft.timeLabel) && viewers.every(v => f.audienceKeys.includes(v))))) fail('时间变化缺少明确请求及公开观察')
  for (const goal of draft.newGoals) {
    if (!scene.activeParticipantKeys.includes(goal.actorKey)) fail('不能替玩家或场外角色设定目标')
    if (story.situation.goals.some(g => g.goalKey === goal.goalKey || g.actorKey === goal.actorKey && g.desire === goal.desire)) fail('不得重复或覆写旧目标')
    story.situation.goals.push({...goal, status: 'active', updatedSequence: input.sequence})
  }
  for (const thread of draft.newThreads) {
    if (story.situation.threads.some(t => t.threadKey === thread.threadKey || t.question === thread.question)) fail('不得重复或覆写旧剧情线')
    if (thread.participantKeys.some(actor => !scene.activeParticipantKeys.includes(actor)) || thread.audienceKeys.some(viewer => !viewers.includes(viewer))) fail('新剧情线引用了场外人物')
    story.situation.threads.push({...thread, status: 'open', updatedSequence: input.sequence})
  }
  if (draft.possibilities.some(p => !scene.activeParticipantKeys.includes(p.actorKey))) fail('不能替玩家或场外角色预定行动')
  story.situation.possibilities = draft.possibilities
  story.situation.title = draft.title
  story.situation.location = draft.location; story.situation.timeLabel = draft.timeLabel
  story.situation.seed = {text: trigger.seed, origin: 'player-request', sourceEventSequence: trigger.requestedSequence, sourceThreadKey: null}
  story.revision++; story.lastEventSequence = input.sequence
  state.chatNarrative = parseChatNarrativeStateV1(story, {participantKeys: state.profiles.map(p => p.participantKey), characterKeys: state.profiles.map(p => p.characterKey), sceneKeys: state.sceneTemplates.map(s => s.sceneKey)})
  scene.title = draft.title; scene.location = draft.location; scene.timeLabel = draft.timeLabel
  state.remainingDirectorBudget -= 2
  return state
}

/** Coordinator-only material from this immutable product instance. Never use
 * this source for a role's expression; the role reader remains independently filtered. */
export function chatSituationCoordinatorViewV1(state: CharacterInteractionRuntimeState) {
  if (!state.chatNarrative || !state.activeScene) fail('当前实例没有叙事情境')
  return structuredClone({
    profiles: state.profiles, knowledge: state.knowledge, persona: state.chatNarrative.persona,
    relationships: state.relationships,
    relationshipEvidence: state.profiles.flatMap(p => chatRelationshipEvidenceV1(state, p.participantKey)),
    permissions: state.chatNarrative.permissions, situation: state.chatNarrative.situation,
    activeParticipantKeys: state.activeScene.activeParticipantKeys, remainingBudget: state.remainingDirectorBudget,
    trigger: state.chatNarrative.triggers[state.chatNarrative.triggers.length - 1] ?? null,
    messages: state.messages.filter(m => m.eventSequence > state.activeScene!.startedAtSequence && m.supersededBySequence == null),
  })
}
