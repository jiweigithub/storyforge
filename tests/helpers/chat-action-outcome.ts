/** Transport shape for injected engineering responses. This helper never runs
 * in production, validates no content, and leaves historical prompts unchanged.
 * Deliberately malformed wire-output tests must bypass it. */
export function chatActionOutcomeFixture(messages: ReadonlyArray<{content: string}>, value: unknown): unknown {
  if (!messages.some(message => message.content.includes('最终输出使用互斥结果外层：'))
    || (value && typeof value === 'object' && 'outcome' in value)) return value
  return {outcome: 'action', action: value, handoff: null}
}
