/** Transport shape for injected engineering responses. This helper never runs
 * in production, validates no content, and leaves historical prompts unchanged.
 * Deliberately malformed wire-output tests must bypass it. */
export function chatActionOutcomeFixture(messages: ReadonlyArray<{content: string}>, value: unknown): unknown {
  if (!messages.some(message => message.content.includes('最终输出使用互斥结果外层：'))
    || (value && typeof value === 'object' && 'outcome' in value)) return value
  return {outcome: 'action', action: value, handoff: null}
}

/** Match injected selector fixtures to the explicitly requested wire version.
 * Production parsing never uses this helper or repairs missing evidence. */
export function chatActionChoiceFixture(messages: ReadonlyArray<{content: string}>, value: unknown): unknown {
  if (!messages[0]?.content.startsWith('这是尚未发生的角色行动选择草稿') || !value || typeof value !== 'object'
    || !('directions' in value) || !Array.isArray(value.directions)) return value
  const current = messages[0].content.includes('evidenceMessageIds')
  return {...value, directions: value.directions.map((direction: Record<string, unknown>) => {
    const {evidenceMessageIds, ...old} = direction
    return current ? {...old, evidenceMessageIds: evidenceMessageIds ?? []} : old
  })}
}
