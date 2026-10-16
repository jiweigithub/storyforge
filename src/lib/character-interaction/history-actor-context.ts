import type {CharacterInteractionRuntimeState, InteractionRuntimeProfile} from '../types'
import type {InteractionContextWindow, InteractionVisibilityView} from './runtime'
import {createContextTextScorerV1} from '../context-gateway/lexical-query'
import {estimateTokens} from '../ai/context-budget'
import {formatInteractionRuntimeContextV1} from './context-format'
import {projectChatGoalCommitmentsV1} from './commitment-context'
import {createChatHistoryPlanV1, chatHistoryIdV1, CHAT_HISTORY_POLICY_V1} from './history-selection'
import {CHAT_CONTEXT_SOURCE_TOKENS_V1, type ChatContextSelectionReasonV1} from './context-selection'

/** v8 reads only the role-filtered scope. Every optional unit enters together
 * with its dependency closure; rejection rolls back the whole trial. */
export function selectChatHistoryActorContextV1(state: CharacterInteractionRuntimeState,
  view: InteractionVisibilityView & {excludedMessageCount?: number}, profile: InteractionRuntimeProfile,
  limits: {maxCharacters: number; maxRecentMessages: number}): InteractionContextWindow {
  const narrative = view.chatNarrative!, commitments = [...narrative.goals.flatMap(g => g.commitments ?? []), ...(view.sharedCommitments ?? [])]
  const plan = createChatHistoryPlanV1(state, {...narrative, commitments}), id = chatHistoryIdV1
  const pending = new Set(view.memoryCorrections?.map(m => m.memoryId))
  const latestCommitments = new Set(narrative.goals.flatMap(g => [...(g.commitments ?? [])].reverse().find(c => c.resolution)?.commitmentKey ?? []))
  for (const e of plan.entries.values()) if (e.kind === 'commitments' && e.required.includes('latest-shared-resolution')) latestCommitments.add(e.key)
  for (const k of view.knowledge) {plan.add('knowledge', k.knowledgeKey, k.content, [], k.importance); plan.linkKnowledge(k.knowledgeKey)}
  for (const m of view.memories) {
    plan.add('memories', m.memoryId, m.content, pending.has(m.memoryId) ? ['pending-correction'] : m.playerPinned ? ['player-pin'] : [], m.importance)
    plan.linkMemory(m)
  }
  const current = view.messages.filter(m => m.eventSequence > (view.activeScene?.startedAtSequence ?? -Infinity))
  const recent = view.messages.slice(-limits.maxRecentMessages)
  const eligible = view.messages.filter(m => recent.includes(m) || current.includes(m) && m.role === 'player')
  const latest = view.messages.slice(-1)[0]
  for (const m of eligible) {
    const required = m === latest ? ['latest-dialogue'] : m.role === 'player' && current.includes(m) ? ['current-player'] : []
    plan.add('messages', m.messageId, m.text, required); plan.linkMessage(m)
  }
  for (const r of view.relationshipEvidence ?? []) {plan.protectSequence(r.eventSequence, 'relationship-evidence'); plan.protectSequence(r.sourceEventSequence, 'relationship-source')}
  const lastPlayer = [...view.messages].reverse().find(m => m.role === 'player')
  const scorers = [
    {reason: 'dialogue', weight: 4, query: lastPlayer?.text ?? latest?.text ?? ''},
    {reason: 'goal', weight: 3, query: narrative.goals.filter(g => ['active', 'paused'].includes(g.status)).map(g => `${g.desire}\n${g.concern}\n${g.boundary}`).join('\n')},
    {reason: 'thread', weight: 2, query: narrative.threads.filter(t => ['open', 'blocked', 'paused'].includes(t.status)).map(t => `${t.title}\n${t.question}`).join('\n')},
    {reason: 'scene', weight: 1, query: `${narrative.title}\n${narrative.location}\n${narrative.timeLabel}`},
  ].map(q => ({...q, score: createContextTextScorerV1(q.query)}))
  const relevance = (text: string) => {
    let score = 0, strongest = 0; let reason: ChatContextSelectionReasonV1 = 'importance'
    for (const q of scorers) {const value = q.score(text) * q.weight; score += value; if (value > strongest) {strongest = value; reason = q.reason as ChatContextSelectionReasonV1}}
    return {score, reason}
  }
  const reasonFor = (kind: Parameters<typeof id>[0], key: string) => relevance(plan.entries.get(id(kind, key))!.text).reason
  const project = (selected: ReadonlySet<string>): InteractionContextWindow => {
    const has = (kind: Parameters<typeof id>[0], key: string) => selected.has(id(kind, key))
    const goalKeys = new Set(commitments.filter(c => has('commitments', c.commitmentKey)).map(c => c.commitmentKey))
    const decisions = plan.evidence(selected)
    return {...view,
      knowledge: view.knowledge.filter(k => has('knowledge', k.knowledgeKey)), memories: view.memories.filter(m => has('memories', m.memoryId)),
      messages: eligible.filter(m => has('messages', m.messageId)),
      chatNarrative: {...narrative, facts: narrative.facts.filter(f => has('facts', f.factKey)),
        goals: projectChatGoalCommitmentsV1(narrative.goals.filter(g => has('goals', g.goalKey)), goalKeys),
        threads: narrative.threads.filter(t => has('threads', t.threadKey))},
      sharedCommitments: view.sharedCommitments?.filter(c => has('commitments', c.commitmentKey)),
      historyContext: {version: 1, policy: CHAT_HISTORY_POLICY_V1, resolutions: plan.resolutions(selected),
        omitted: {facts: narrative.facts.filter(f => !has('facts', f.factKey)).length,
          goals: narrative.goals.filter(g => !has('goals', g.goalKey)).length, threads: narrative.threads.filter(t => !has('threads', t.threadKey)).length}},
      selection: {version: 5,
        knowledge: decisions.filter(d => d.kind === 'knowledge').map(d => ({key: d.key, included: d.included, reason: reasonFor('knowledge', d.key)})),
        memories: decisions.filter(d => d.kind === 'memories').map(d => ({key: d.key, included: d.included, reason: pending.has(d.key) ? 'pending-correction' : view.memories.find(m => m.memoryId === d.key)?.playerPinned ? 'player-pin' : reasonFor('memories', d.key)})),
        commitments: decisions.filter(d => d.kind === 'commitments').map(d => ({key: d.key, included: d.included, reason: commitments.find(c => c.commitmentKey === d.key)?.resolution === null ? 'open-commitment' : latestCommitments.has(d.key) ? 'latest-resolution' : reasonFor('commitments', d.key)})),
        history: decisions},
      omittedMessageCount: view.messages.length - eligible.filter(m => has('messages', m.messageId)).length, characterCount: 0}
  }
  const size = (result: InteractionContextWindow) => formatInteractionRuntimeContextV1(profile, result).length + 200
  const measured = (keys: ReadonlySet<string>) => {const result = project(keys); result.characterCount = size(result); result.characterCount = size(result); return result}
  const selected = plan.choose(keys => {
    const result = measured(keys), text = formatInteractionRuntimeContextV1(profile, result)
    return size(result) <= limits.maxCharacters && estimateTokens(text) + 200 <= CHAT_CONTEXT_SOURCE_TOKENS_V1
  }, text => relevance(text).score)
  const result = measured(selected)
  const rendered = formatInteractionRuntimeContextV1(profile, result)
  if (rendered.length + 200 > limits.maxCharacters || estimateTokens(rendered) + 200 > CHAT_CONTEXT_SOURCE_TOKENS_V1) throw new Error('本轮历史选择证据超过预算，已停止发送。')
  return result
}
