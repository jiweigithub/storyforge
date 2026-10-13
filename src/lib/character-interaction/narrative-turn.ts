import { assertInstanceBinding } from '../product/runtime-instances'
import {db} from '../db/schema'
import {readInstanceAgentRunV1} from '../agent/run/event-store'
import type { AIConfig, CharacterInteractionRuntimeState, WorkspaceScope } from '../types'
import type { ChatNarrativeTriggerV1 } from '../types/chat-narrative'
import { adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1 } from './harness'
import {chatSituationConstructionRequestV1} from './narrative-progression'
import {isImportedCompletedInteractionRunV1, readResumableInteractionRunsV1} from './runtime-run-recovery'
import { readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger } from './runtime-api'

export type ChatPlayerTriggerV1 = Exclude<ChatNarrativeTriggerV1, 'player-seed'>

/** Never infer acceptance of a suggestion from continuing or returning to chat. */
const objectives: Record<ChatPlayerTriggerV1, string> = {
  'scene-start': '开始当前情境。依角色自己的动机采取一次有意义的表达或行动，给玩家留下回应空间。',
  'player-response': '承接最新玩家消息，尤其是拒绝、改换办法或休息的要求。依当前情境和自身动机行动，不替玩家接受建议。',
  continue: '玩家明确请角色继续演绎，但没有因此接受任何建议。承接当前局面，必要时等待玩家，也可以留白或收束。',
  return: '玩家返回会话并明确继续。承接最后已发生的局面，不推定离线时间、玩家行为或关系惩罚。',
}

/** Read-only recovery view. It never grants a new trigger or resets its limits. */
export interface ChatNarrativeTurnResumeV1 {
  triggerSequence: number
  actorKey: string | null
  remainingActions: number
  blockedReason: string | null
}

export async function readChatNarrativeTurnResumeV1(scope: WorkspaceScope, sessionId: number, state: CharacterInteractionRuntimeState): Promise<ChatNarrativeTurnResumeV1 | null> {
  await assertInstanceBinding(sessionId, scope)
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  if (!state.activeScene || !story || story.pendingEdit || trigger?.status !== 'ready') return null
  const lastAction = trigger.actionSequences.slice(-1)[0]
  const actorKey = lastAction == null ? null : state.messages.find(m => m.eventSequence === lastAction && m.role === 'character')?.speakerKey ?? null
  const remainingActions = Math.max(0, story.permissions.maxActionsPerTrigger - trigger.actionSequences.length)
  const view = {triggerSequence: trigger.requestedSequence, actorKey, remainingActions, blockedReason: null as string | null}
  if (!remainingActions || state.remainingDirectorBudget < 2) return {...view, blockedReason: '本轮剩余额度不足，不能继续生成。'}
  if (lastAction != null && !actorKey) return {...view, blockedReason: '本轮原角色消息不完整，不能推定由谁继续。'}
  if (actorKey && !story.situation.goals.some(goal => goal.actorKey === actorKey && ['active', 'paused'].includes(goal.status))) return {...view, blockedReason: '本轮角色的目标已经结束，无需补齐行动。'}
  if (story.pendingSituation?.actorKey === actorKey && story.situation.seed.origin === 'continued-thread'
    && story.situation.seed.sourceEventSequence === trigger.requestedSequence) return {...view, blockedReason: '本轮已经发展过一次局面。新的角色方向需在下一轮明确继续。'}
  const [rows, events] = await Promise.all([
    db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray(),
    db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray(),
  ])
  for (const row of rows) {
    const contract = JSON.parse(row.contractJson)
    if (contract.scope?.runtime?.baseSequence < trigger.requestedSequence
      || !contract.executionBindings?.some((binding: {skillId?: string}) => ['character.chat-narrative-action', 'character.chat-narrative-options', 'character.chat-situation-construction'].includes(binding.skillId ?? ''))) continue
    const snapshot = await readInstanceAgentRunV1(scope, row.id!)
    if (isImportedCompletedInteractionRunV1(snapshot, events)) continue
    const adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
    if (snapshot.projection.state === 'completed' && adopted?.type === 'runtime.candidate.adopted' && adopted.payload.commandIds.length
      && adopted.payload.commandIds.every(id => events.some(event => event.commandId === id && event.sequence > adopted.payload.baseSequence && event.sequence <= adopted.payload.resultingSequence))) continue
    const unknown = snapshot.events.some(event => event.type === 'model.requested'
      && !snapshot.events.some(response => response.type === 'evidence.artifact.recorded' && response.payload.artifactKind === 'raw-response' && response.payload.stepId === event.payload.stepId))
    return {...view, blockedReason: unknown
      ? `本轮调用结果未知（运行 #${row.id}），补齐不会重发。请先处理原运行；需要新尝试时明确开始下一轮，原调用可能已经计费。`
      : `本轮有尚未采用、失败或取消的运行 #${row.id}。请先恢复已有候选；需要新尝试时明确开始下一轮。`}
  }
  return view
}

/** Continue only the unspent part of the existing authorized turn. Failed or
 * unknown attempts require a new explicit trigger, never a hidden resend. */
export async function resumeChatNarrativeTurnV1(input: {
  scope: WorkspaceScope; sessionId: number; expectedSequence: number; participantKey?: string
  aiConfig: AIConfig; situationAiConfig?: AIConfig; signal?: AbortSignal; onRunCreated?: (id: number) => void
}): Promise<void> {
  await assertInstanceBinding(input.sessionId, input.scope)
  if (input.signal?.aborted) throw new Error('角色行动已取消。')
  const state = await readProductRuntimeState(input.sessionId)
  if (state.lastSequence !== input.expectedSequence || !state.interaction) throw new Error('当前情境已变化，请刷新后继续。')
  const view = await readChatNarrativeTurnResumeV1(input.scope, input.sessionId, state.interaction)
  if (!view) throw new Error('当前没有可以补齐的未完成轮次。')
  if (view.blockedReason) throw new Error(view.blockedReason)
  if (view.actorKey && input.participantKey && input.participantKey !== view.actorKey) throw new Error('补齐本轮须沿用原行动角色；换角色请开始下一轮。')
  const trigger = state.interaction.chatNarrative!.triggers.slice(-1)[0]!
  const actor = actorFor(state.interaction, trigger.kind === 'player-seed' ? 'continue' : trigger.kind, view.actorKey ?? input.participantKey)
  if (!actor) throw new Error('角色当前目标已经结束，无需补齐行动。')
  if ((await readProductRuntimeStateVersion(input.sessionId)).sequence !== input.expectedSequence) throw new Error('当前情境已变化，请刷新后继续。')
  const request = chatSituationConstructionRequestV1(state.interaction, actor)
  if (request?.origin === 'player-request') {
    if (state.interaction.remainingDirectorBudget < 4) throw new Error('当前预算不足以构建、审查并演绎新情境。')
    const generated = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
      skillId: 'character.chat-situation-construction', participantKey: 'player', narrativeTriggerSequence: trigger.requestedSequence,
      objective: '补齐本轮尚未发起的情境构建，承接原玩家请求与旧局面，保留玩家选择。',
      aiConfig: input.situationAiConfig ?? input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
    if (input.signal?.aborted) return
    await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: generated.snapshot.run.id})
  }
  await performPreparedTurn({...input, actor, triggerSequence: trigger.requestedSequence,
    objective: trigger.kind === 'player-seed' ? '承接本轮已经构建的情境，仅按自己的知识和动机演绎，不重建背景或替玩家决定。' : objectives[trigger.kind]})
}

/** Active run IDs only; an interrupted call with unknown outcome is not a retry instruction. */
export async function readPendingChatNarrativeRunsV1(scope: WorkspaceScope, sessionId: number, state: CharacterInteractionRuntimeState): Promise<number[]> {
  const trigger = state.chatNarrative?.triggers.slice(-1)[0]
  if (!trigger || trigger.status === 'cancelled') return []
  const rows = await readResumableInteractionRunsV1(scope, sessionId)
  const pending: number[] = []
  for (const row of rows) {
    if (['completed', 'failed', 'cancelled'].includes(row.status)) continue
    const contract = JSON.parse(row.contractJson)
    if (contract.scope?.runtime?.baseSequence < trigger.requestedSequence
      || !contract.executionBindings?.some((b: {skillId?: string}) => ['character.chat-narrative-action', 'character.chat-narrative-options', 'character.chat-situation-construction'].includes(b.skillId ?? ''))) continue
    pending.push(row.id!)
  }
  return pending
}

function actorFor(state: CharacterInteractionRuntimeState, kind: ChatPlayerTriggerV1, preferred?: string): string | null {
  const message = kind === 'player-response' ? state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null).slice(-1)[0] : null
  const active = state.activeScene!.activeParticipantKeys.filter(key => (!message?.audienceKeys || message.audienceKeys.includes(key))
    && state.chatNarrative!.situation.goals.some(g => g.actorKey === key && ['active', 'paused'].includes(g.status)))
  if (preferred) {
    if (!active.includes(preferred)) throw new Error('选定角色不在场、听不到此消息或当前目标已结束。')
    return preferred
  }
  if (active.length > 1) throw new Error('请选择本轮行动的角色。多人自动调度尚未开启。')
  return active[0] ?? null
}

/** Normal player path: explicit trigger → registered Harness candidate → atomic
 * action/consequences. It never runs on mount and never inserts a player message. */
export async function advanceChatNarrativeTurnV1(input: {
  scope: WorkspaceScope
  sessionId: number
  kind: ChatPlayerTriggerV1
  expectedSequence: number
  replyToSequence?: number
  participantKey?: string
  aiConfig: AIConfig
  /** Compare one next action after any explicitly authorized shared background. */
  compare?: boolean
  signal?: AbortSignal
  onRunCreated?: (id: number) => void
}): Promise<void> {
  await assertInstanceBinding(input.sessionId, input.scope)
  if (input.signal?.aborted) throw new Error('角色行动已取消。')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  const state = (await readProductRuntimeState(input.sessionId)).interaction
  if (version.sequence !== input.expectedSequence || !state?.activeScene || !state.chatNarrative) throw new Error('当前情境已变化，请刷新后继续。')
  if (state.remainingDirectorBudget < 2) throw new Error('当前预算不足以生成并审查角色行动。')
  const source = input.kind === 'scene-start' ? state.activeScene.startedAtSequence
    : input.kind === 'player-response' ? input.replyToSequence : version.sequence
  if (source == null) throw new Error('缺少玩家消息。')
  const previous = state.chatNarrative.triggers.find(t => t.kind === input.kind && t.sourceEventSequence === source)
  if (['scene-start', 'player-response'].includes(input.kind) && previous) {
    if (previous.status === 'complete' || previous.status === 'waiting-player') return
    throw new Error('这次开场或回应已发起。请恢复候选，或明确选择继续，不会重复发送同一请求。')
  }
  const pending = await readPendingChatNarrativeRunsV1(input.scope, input.sessionId, state)
  if (pending.length) throw new Error(`上次行动尚未结束（运行 #${pending.join('、#')}），请先恢复候选或取消该运行。`)
  // Do not spend a model call or consume a trigger when every role has concluded.
  const actor = actorFor(state, input.kind, input.participantKey)
  if (!actor) throw new Error('角色当前目标已经结束，可以结束场景或稍后设置新情境。')
  if (state.chatNarrative.pendingSituation?.actorKey === actor && ['continue', 'return'].includes(input.kind) && state.remainingDirectorBudget < 4) throw new Error('当前预算不足以发展角色方向并继续演绎。')
  const requested = await requestChatNarrativeTrigger({sessionId: input.sessionId,
    commandId: `chat.turn:${crypto.randomUUID()}`, baseSequence: version.sequence, baseStateHash: version.stateHash,
    kind: input.kind, sourceEventSequence: source})
  await performPreparedTurn({...input, actor, triggerSequence: requested.sequence, objective: objectives[input.kind]})
}

async function performPreparedTurn(input: {
  scope: WorkspaceScope; sessionId: number; actor: string; triggerSequence: number; objective: string; aiConfig: AIConfig
  signal?: AbortSignal; onRunCreated?: (id: number) => void
  compare?: boolean
}): Promise<void> {
  const initial = (await readProductRuntimeState(input.sessionId)).interaction!
  const remaining = initial.chatNarrative!.permissions.maxActionsPerTrigger - (initial.chatNarrative!.triggers.slice(-1)[0]?.actionSequences.length ?? 0)
  for (let i = 0; i < remaining; i++) {
    if (input.signal?.aborted) return
    let current = (await readProductRuntimeState(input.sessionId)).interaction!
    const trigger = current.chatNarrative!.triggers.slice(-1)[0]!
    if (trigger.requestedSequence !== input.triggerSequence || trigger.status !== 'ready' || current.remainingDirectorBudget < 2) return
    if (!current.chatNarrative!.situation.goals.some(g => g.actorKey === input.actor && ['active', 'paused'].includes(g.status))) return
    const story = current.chatNarrative!
    if (story.pendingSituation?.actorKey === input.actor && story.situation.seed.origin === 'continued-thread'
      && story.situation.seed.sourceEventSequence === trigger.requestedSequence) return
    const request = chatSituationConstructionRequestV1(current, input.actor)
    if (request?.actorKey === input.actor) {
      if (current.remainingDirectorBudget < 4) throw new Error('当前预算不足以发展角色方向并继续演绎。')
      const situation = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
        skillId: 'character.chat-situation-construction', participantKey: 'player', narrativeTriggerSequence: input.triggerSequence,
        objective: '依已经审查的角色方向补足当前局面中的开放条件，承接自己的未完成事项，保留其他角色的打算与玩家选择。',
        aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
      if (input.signal?.aborted) return
      await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: situation.snapshot.run.id})
      current = (await readProductRuntimeState(input.sessionId)).interaction!
      if (input.signal?.aborted || current.chatNarrative!.triggers.slice(-1)[0]?.requestedSequence !== input.triggerSequence
        || current.chatNarrative!.triggers.slice(-1)[0]?.status !== 'ready') return
    }
    const generated = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
      skillId: input.compare ? 'character.chat-narrative-options' : 'character.chat-narrative-action', participantKey: input.actor, narrativeTriggerSequence: input.triggerSequence,
      objective: input.objective, aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
    if (input.signal?.aborted) return
    // Comparison ends at the reviewed checkpoint. Even a multi-action trigger
    // cannot select an alternative or execute a sequel without player input.
    if (input.compare) return
    await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: generated.snapshot.run.id})
  }
}

/** An explicit backstage request is neither player dialogue nor an event that
 * has happened. Construct and review first, then let one selected role act. */
export async function createChatNarrativeSituationV1(input: {
  scope: WorkspaceScope; sessionId: number; expectedSequence: number; seed: string; participantKey?: string
  aiConfig: AIConfig; actionAiConfig?: AIConfig; signal?: AbortSignal; onRunCreated?: (id: number) => void
}): Promise<void> {
  await assertInstanceBinding(input.sessionId, input.scope)
  if (input.signal?.aborted) throw new Error('情境构建已取消。')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  const state = (await readProductRuntimeState(input.sessionId)).interaction
  if (version.sequence !== input.expectedSequence || !state?.activeScene || !state.chatNarrative) throw new Error('当前情境已变化，请刷新后继续。')
  const active = state.activeScene.activeParticipantKeys
  const actor = input.participantKey || (active.length === 1 ? active[0] : null)
  if (!actor || !active.includes(actor)) throw new Error('请选择新情境中行动的在场角色。')
  if (state.remainingDirectorBudget < 4) throw new Error('当前预算不足以构建、审查并演绎新情境。')
  if ((await readPendingChatNarrativeRunsV1(input.scope, input.sessionId, state)).length) throw new Error('请先恢复或取消尚未完成的行动。')
  const trigger = await requestChatNarrativeTrigger({sessionId: input.sessionId, commandId: `chat.seed:${crypto.randomUUID()}`,
    baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'player-seed', sourceEventSequence: version.sequence, seed: input.seed})
  const generated = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
    skillId: 'character.chat-situation-construction', participantKey: 'player', narrativeTriggerSequence: trigger.sequence,
    objective: '将玩家最新情境请求内化为当前背景与开放方向，承接旧问题，保留玩家选择。',
    aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
  if (input.signal?.aborted) return
  await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: generated.snapshot.run.id})
  await performPreparedTurn({...input, aiConfig: input.actionAiConfig ?? input.aiConfig, actor, triggerSequence: trigger.sequence,
    objective: '情境已经审查并更新。只根据你可知的新旧事实和自身动机采取一次合理行动，不替玩家作决定，不把未来打算当成已发生。'})
}
