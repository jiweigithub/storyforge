import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatActorGoalV1, ChatNarrativeActionV1, ChatNarrativeTriggerStateV1, ChatPlayerRequestEvidenceV1} from '../types/chat-narrative'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

function fail(message: string): never {throw new Error(`[chat-player-pause] ${message}`)}
function row(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('暂停依据字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('暂停依据文本无效')
}
function sequence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || value === 0) fail('暂停依据必须来自实际事件')
}
export function validateChatPlayerRequestEvidenceV1(value: unknown): void {
  const r = row(value, 'playerEventSequence,playerExcerpt')
  sequence(r.playerEventSequence); text(r.playerExcerpt, 1200)
}
export function validateChatGoalPlayerPauseV1(value: unknown, input: {initial: boolean; status: string; updatedSequence: number; threadKeys: string[]}): void {
  if (value === undefined) return
  if (input.initial || input.status !== 'paused') fail('玩家暂停只能属于运行中的暂停目标')
  const p = row(value, 'threadKey,requested,acknowledged')
  if (!input.threadKeys.includes(String(p.threadKey))) fail('暂停引用的原事项不存在')
  for (const item of [p.requested, p.acknowledged]) {
    const e = row(item, 'messageId,sequence,excerpt'); text(e.messageId, 200); text(e.excerpt, 2000); sequence(e.sequence)
  }
  const requested = p.requested as {sequence: number; messageId: string}, acknowledged = p.acknowledged as {sequence: number; messageId: string}
  if (requested.sequence >= acknowledged.sequence || acknowledged.sequence > input.updatedSequence || requested.messageId === acknowledged.messageId) fail('暂停请求和确认的事件顺序无效')
}

/** The semantic reviewer decides whether the quote actually grants a hold or
 * release. Domain checks bind it to this turn and to the entire audience. */
export function requireChatPlayerRequestV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: ChatNarrativeTriggerStateV1, request: ChatPlayerRequestEvidenceV1, audiences: string[]) {
  const source = state.messages.find(m => m.role === 'player' && m.eventSequence === request.playerEventSequence)
  if (trigger.kind !== 'player-response' || trigger.actionSequences.length || trigger.sourceEventSequence !== request.playerEventSequence
    || !source || source.supersededBySequence != null || !isChatMessageRetrievableV1(state, source)
    || state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null).slice(-1)[0] !== source
    || !source.text.includes(request.playerExcerpt) || source.audienceKeys != null && [actorKey, ...audiences.filter(k => k !== state.playerKey)].some(k => !source.audienceKeys!.includes(k))) fail('暂停或恢复必须引用本轮真实可见的最新玩家消息，不以继续操作代替')
  return source
}

export function assertChatPlayerPauseSourcesV1(state: CharacterInteractionRuntimeState): void {
  for (const goal of state.chatNarrative?.situation.goals ?? []) {
    const pause = goal.playerPause
    if (!pause) continue
    const request = state.messages.find(m => m.messageId === pause.requested.messageId && m.eventSequence === pause.requested.sequence)
    const ack = state.messages.find(m => m.messageId === pause.acknowledged.messageId && m.eventSequence === pause.acknowledged.sequence)
    if (!request || request.role !== 'player' || request.supersededBySequence != null || !request.text.includes(pause.requested.excerpt)
      || !ack || ack.role !== 'character' || ack.speakerKey !== goal.actorKey || ack.supersededBySequence != null || !ack.text.includes(pause.acknowledged.excerpt)
      || !ack.audienceKeys?.includes(goal.actorKey) || !ack.audienceKeys.includes(state.playerKey)
      || request.audienceKeys != null && ack.audienceKeys.some(k => k !== state.playerKey && !request.audienceKeys!.includes(k))) fail('暂停缺少同一玩家请求与角色实际确认的消息依据')
    const thread = state.chatNarrative!.situation.threads.find(t => t.threadKey === pause.threadKey)
    if (!thread?.participantKeys.includes(goal.actorKey) || !thread.audienceKeys.includes(goal.actorKey)) fail('暂停不能接管其他角色或不可知事项')
  }
}

/** Run before a new followup goal is previewed. No background, ownership,
 * message or event is created here; the existing reviewed action commits it. */
export function applyChatPlayerGoalResumeV1(state: CharacterInteractionRuntimeState, input: {action: ChatNarrativeActionV1; actorKey: string; trigger: ChatNarrativeTriggerStateV1}): void {
  const {action, actorKey, trigger} = input, goals = state.chatNarrative!.situation.goals
  const held = goals.filter(g => g.actorKey === actorKey && g.playerPause)
  if (held.some(g => g.goalKey !== action.goalKey && (action.goalUpdates?.some(e => e.goalKey === g.goalKey) || action.threadUpdates.some(e => e.threadKey === g.playerPause!.threadKey)))) fail('不能用另一个目标或附带变化绕过玩家暂停')
  const goal = held.find(g => g.goalKey === action.goalKey)
  if (!goal) {if (action.resumeGoal != null) fail('当前目标没有待恢复的玩家暂停'); return}
  if (action.resumeGoal == null) {
    if (!['speak', 'pause'].includes(action.kind) || !action.waitingForPlayer || action.goalStatus !== null || action.goalUpdates?.length
      || action.newFacts.length || action.threadUpdates.length || action.commitmentEffects?.length || action.nextPossibilities?.length || action.situationRequest != null) fail('玩家暂停尚未解除，只能等待或回应，不能执行和改写暂停事项')
    return
  }
  const source = requireChatPlayerRequestV1(state, actorKey, trigger, action.resumeGoal, action.audienceKeys)
  if (source.eventSequence <= goal.playerPause!.acknowledged.sequence || !['active', 'fulfilled', 'abandoned'].includes(action.goalStatus ?? '')
    || action.followupGoal != null || action.threadFollowupGoal != null) fail('恢复须来自确认暂停后的新玩家依据，并明确处置原目标')
  delete goal.playerPause
}

export function chatPlayerPauseSequencesV1(goals: ChatActorGoalV1[]): number[] {
  return goals.flatMap(g => g.playerPause ? [g.playerPause.requested.sequence, g.playerPause.acknowledged.sequence] : [])
}
export function rebaseChatPlayerPausesV1(goals: ChatActorGoalV1[], rebase: (sequence: number) => number): void {
  for (const g of goals) if (g.playerPause) {
    g.playerPause.requested.sequence = rebase(g.playerPause.requested.sequence)
    g.playerPause.acknowledged.sequence = rebase(g.playerPause.acknowledged.sequence)
  }
}
export function supportsChatPlayerPauseV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v22', 'chat-narrative-options-review-v16', 'chat-narrative-action-review-v23', 'chat-narrative-options-review-v17', 'chat-narrative-action-review-v24', 'chat-narrative-options-review-v18', 'chat-narrative-action-review-v25', 'chat-narrative-options-review-v19', 'chat-narrative-action-review-v26', 'chat-narrative-options-review-v20'].includes(version ?? '')
}

export const CHAT_PLAYER_PAUSE_ACTION_RULE_V1 = '以下明确暂停路径是原线接续首步须实际行动的唯一例外：若符合 threadFollowupGoal 的原线接续条件，但本轮玩家明确要求暂缓角色尚负责的剩余事项，可在该字段加 pauseRequest:{playerEventSequence:trigger.sourceEventSequence,playerExcerpt:"本轮要求暂缓的逐字摘录"}。新目标只描述原责任剩余部分，不能复活旧目标或将拒绝变成新任务；kind=speak、waitingForPlayer=true、goalStatus=paused，只表达接受暂缓，newFacts/disclosures/goalUpdates/relationshipUpdates/beliefUpdates=[]，nextPossibilities=null或[]，situationRequest=null，不作实际推进。threadUpdates 只能按实际表达与知情范围把原线设为 paused，个人暂停不强制暂停共同行动。若明确答应等待，完整条款仍登记 commitmentEffects.promise；不得登记履行。系统保存真实请求和确认到新目标 playerPause。原线不存在角色自己的剩余责任时，不能为了存暂停强造目标，应自然回应。'
export const CHAT_PLAYER_RESUME_ACTION_RULE_V1 = 'resumeGoal 默认为 null。自己的目标含 playerPause 时，其 requested 和 acknowledged 是已发生的暂停依据，不能由继续/返回解除。未获解除依据，只可 speak/pause、waitingForPlayer=true、goalStatus=null，不能推进、处置约定、改目标/原线或生成新的打算与情境。只有确认暂停之后的新 player-response 首步，玩家本轮确实解除原条件、允许恢复或明确取消该责任时，才填 resumeGoal:{playerEventSequence:trigger.sourceEventSequence,playerExcerpt:"本轮解除或取消的逐字摘录"}，goalKey 引用该原目标、goalStatus=active/fulfilled/abandoned，并按真实结果更新原线和处理原约。普通“嗯”、无关消息或简单继续不是解除；不能用附带目标更新或另建目标绕过。恢复只解除原限制，不替玩家做事、不等于已有成果或履约。'
export const CHAT_PLAYER_PAUSE_REVIEW_RULE_V1 = '玩家暂停及恢复专审：明确接受暂停是上述原线接续须实际行动的唯一例外；pauseRequest 须是本轮真实明确暂缓原事项的请求，角色仍有自己的剩余责任；新目标不能重做旧目标、把拒绝变成新任务或只是为回应而造目标。核对实际确认、暂停范围、完整约定和知情范围。含 playerPause 的原目标在没有真实解除依据时仍须保持等待；resumeGoal 的本轮玩家原话须明确解除记录的具体条件或明确取消原责任，不能仅凭消息较新、字段合法、简单“嗯”或继续操作放行。核对是否还存在其他未解除限制；恢复不是完成或履约。不能通过其他目标、无目标回应、附带变化或新情境绕过；确认暂停的表达用 speak 并可记录已明确作出的等待承诺，不能要求虚构实际进展。'
