import {createContextTextScorerV1} from '../context-gateway/lexical-query'
import type {InteractionRuntimeProfile} from '../types'
import type {InteractionContextWindow, InteractionVisibilityView} from './runtime'
import {formatInteractionRuntimeContextV1} from './context-format'
import {estimateTokens} from '../ai/context-budget'

export const CHAT_CONTEXT_READER_VERSION_V1 = 'chat-narrative-runtime-view-v5'
export const CHAT_CONTEXT_READER_VERSION_V2 = 'chat-narrative-runtime-view-v6'
export type ChatRetrievalVersion = 'legacy' | 'chat-relevance-v1' | 'chat-relevance-v2'
export function chatRetrievalVersionForReader(reader: string | undefined): ChatRetrievalVersion | null {
  if (reader === 'chat-narrative-runtime-view-v3') return 'legacy'
  if (reader === 'chat-narrative-runtime-view-v4' || reader === CHAT_CONTEXT_READER_VERSION_V1) return 'chat-relevance-v1'
  return reader === CHAT_CONTEXT_READER_VERSION_V2 ? 'chat-relevance-v2' : null
}
export const CHAT_CONTEXT_SOURCE_TOKENS_V1 = 8000

export type ChatContextSelectionReasonV1 = 'current-fact' | 'protected-memory' | 'player-pin' | 'dialogue' | 'goal' | 'thread' | 'scene' | 'importance'
export interface ChatContextSelectionV1 {
  version: 1 | 2
  knowledge: Array<{key: string; included: boolean; reason: ChatContextSelectionReasonV1}>
  memories: Array<{key: string; included: boolean; reason: ChatContextSelectionReasonV1}>
}

/** Input must already be the role's authorized retrieval view. Never search
 * the coordinator state, omitted dialogue, other roles or unaccepted memories. */
export function selectChatContextWindowV1(
  view: InteractionVisibilityView & {excludedMessageCount?: number},
  profile: InteractionRuntimeProfile,
  limits: {maxCharacters: number; maxRecentMessages: number; retrievalVersion?: ChatRetrievalVersion},
): InteractionContextWindow {
  const modern = limits.retrievalVersion === 'chat-relevance-v2'
  const narrative = view.chatNarrative!
  const lastPlayer = [...view.messages].reverse().find(m => m.speakerKey === 'player')
  const queries = [
    ['dialogue', lastPlayer?.text ?? view.messages[view.messages.length - 1]?.text ?? '', 4],
    ['goal', narrative.goals.filter(g => g.status === 'active').map(g => `${g.desire}\n${g.concern}\n${g.boundary}`).join('\n'), 3],
    ['thread', narrative.threads.filter(t => t.status === 'open' || t.status === 'blocked').map(t => `${t.title}\n${t.question}`).join('\n'), 2],
    ['scene', `${narrative.title}\n${narrative.location}\n${narrative.timeLabel}`, 1],
  ] as const
  const scorers = queries.map(([reason, query, weight]) => ({reason, score: createContextTextScorerV1(query), weight}))
  const relevance = (text: string) => {
    let score = 0; let strongest = 0; let reason: ChatContextSelectionReasonV1 = 'importance'
    for (const scorer of scorers) {
      const match = scorer.score(text) * scorer.weight
      score += match
      if (match > strongest) {strongest = match; reason = scorer.reason}
    }
    return {score, reason}
  }
  const requiredKnowledge = new Set(narrative.facts.map(f => f.sourceKnowledgeKey).filter(Boolean))
  const candidates = [
    ...view.knowledge.map((item, index) => ({kind: 'knowledge' as const, key: item.knowledgeKey, index, importance: item.importance,
      required: requiredKnowledge.has(item.knowledgeKey), ...relevance(item.content)})),
    ...view.memories.map((item, index) => ({kind: 'memories' as const, key: item.memoryId, index, importance: item.importance,
      required: modern ? item.playerPinned === true : ['commitment', 'key-memory'].includes(item.kind) || item.importance >= 90, ...relevance(item.content)})),
  ]
  const result: InteractionContextWindow = {...view, knowledge: [], memories: [],
    messages: view.messages.slice(-limits.maxRecentMessages), omittedMessageCount: 0, characterCount: 0}
  if (modern) result.selection = {version: 2,
    knowledge: candidates.filter(c => c.kind === 'knowledge').map(c => ({key: c.key, included: false, reason: c.reason})),
    memories: candidates.filter(c => c.kind === 'memories').map(c => ({key: c.key, included: false, reason: c.reason}))}
  // Reserve room for the profile, source labels and selection summary; the
  // Gateway still enforces its final token budget on the exact rendered input.
  const rendered = () => formatInteractionRuntimeContextV1(profile, modern ? {...result, characterCount: 0,
    omittedMessageCount: view.messages.length - result.messages.length} : result)
  const size = () => modern ? rendered().length + 200
    : JSON.stringify({...result, characterCount: 0}).length + profile.voiceRules.length + profile.name.length + 400
  const fits = () => size() <= limits.maxCharacters
    && estimateTokens(rendered()) + 200 <= CHAT_CONTEXT_SOURCE_TOKENS_V1
  const selected = new Set<string>()
  const include = (candidate: typeof candidates[number]) => {
    if (candidate.kind === 'knowledge') result.knowledge.push(view.knowledge[candidate.index])
    else result.memories.push(view.memories[candidate.index])
    if (modern) result.selection![candidate.kind].find(d => d.key === candidate.key)!.included = true
  }
  for (const candidate of candidates.filter(c => c.required)) {
    include(candidate); selected.add(`${candidate.kind}:${candidate.key}`)
  }
  while (!fits() && result.messages.length > 1) result.messages.shift()
  if (!fits()) throw new Error(modern ? '当前事实、玩家固定记忆或安全上下文超过预算，请调整固定范围后继续；不会静默省略固定记忆。' : '当前事实、已确认承诺或安全上下文超过预算，请调整配置后继续；不会静默省略关键记忆。')
  for (const candidate of candidates.filter(c => !c.required).sort((a, b) => b.score - a.score || b.importance - a.importance || a.kind.localeCompare(b.kind) || a.index - b.index)) {
    include(candidate)
    if (fits()) selected.add(`${candidate.kind}:${candidate.key}`)
    else {
      result[candidate.kind].pop()
      if (modern) result.selection![candidate.kind].find(d => d.key === candidate.key)!.included = false
    }
  }
  // Selection is ranked, but retained passages keep their original source order.
  result.knowledge = view.knowledge.filter(item => selected.has(`knowledge:${item.knowledgeKey}`))
  result.memories = view.memories.filter(item => selected.has(`memories:${item.memoryId}`))
  result.omittedMessageCount = view.messages.length - result.messages.length
  result.characterCount = size()
  const decisions = (kind: 'knowledge' | 'memories') => candidates.filter(c => c.kind === kind).map(c => ({
    key: c.key, included: selected.has(`${kind}:${c.key}`),
    reason: c.required ? kind === 'knowledge' ? 'current-fact' as const : modern ? 'player-pin' as const : 'protected-memory' as const : c.reason,
  }))
  result.selection = {version: modern ? 2 : 1, knowledge: decisions('knowledge'), memories: decisions('memories')}
  if (modern) {
    result.characterCount = size()
    if (!fits()) throw new Error('本轮记忆选择证据超过预算，已停止发送。')
  }
  return result
}
