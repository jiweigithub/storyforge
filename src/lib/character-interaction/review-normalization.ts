import {CHAT_NARRATIVE_OPTION_KEYS_V1} from './narrative-options'
import type {ChatNarrativeActionV1} from '../types/chat-narrative'

export function supportsChatReviewNormalizationV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v24', 'chat-narrative-options-review-v18', 'chat-narrative-action-review-v25', 'chat-narrative-options-review-v19'].includes(version ?? '')
}

/** The stored review contract requires per-fact checks for paraphrases only.
 * A new reviewer may redundantly approve an exact quotation. Remove only that
 * well-formed affirmative annotation; never invent a required check, erase a
 * rejection, change an action, or reinterpret an older frozen response. The
 * caller retains the raw response and records the deterministic conversion. */
export function normalizeChatReviewResponseV1(input: {
  output: Record<string, unknown>; actions: readonly ChatNarrativeActionV1[]; options: boolean; promptVersion: string | undefined
}): {output: Record<string, unknown>; removed: Array<{optionKey: string | null; factKey: string}>} {
  const removed: Array<{optionKey: string | null; factKey: string}> = []
  if (!supportsChatReviewNormalizationV1(input.promptVersion)) return {output: input.output, removed}
  const fail = (message: string): never => {throw new Error(`[chat-review-normalization] ${message}`)}
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('审查条目无效')
    return value as Record<string, unknown>
  }
  const normalize = (row: Record<string, unknown>, action: ChatNarrativeActionV1, optionKey: string | null) => {
    if (!Object.prototype.hasOwnProperty.call(row, 'disclosureChecks')) return row
    if (!Array.isArray(row.disclosureChecks) || row.disclosureChecks.length > 12) fail('披露审查数量无效')
    const checks = row.disclosureChecks as unknown[], seen = new Set<string>(), retained: unknown[] = []
    for (const value of checks) {
      const check = object(value), factKey = check.factKey
      if (Object.keys(check).sort().join(',') !== 'factKey,passed,reason'
        || typeof factKey !== 'string' || factKey.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(factKey)
        || typeof check.passed !== 'boolean' || typeof check.reason !== 'string' || !check.reason.trim() || check.reason.length > 2000) fail('披露审查字段无效')
      const matches = action.disclosures.filter(d => d.factKey === factKey)
      if (seen.has(factKey as string) || matches.length !== 1) fail('披露审查重复或不属于当前候选')
      seen.add(factKey as string)
      if (matches[0].wording === undefined) {
        if (check.passed !== true) fail('逐字披露审查未通过，不能忽略失败判定')
        removed.push({optionKey, factKey: factKey as string})
      } else retained.push(value)
    }
    return retained.length === checks.length ? row : {...row, disclosureChecks: retained}
  }
  if (!input.options) {
    if (input.actions.length !== 1) fail('单条审查缺少精确行动')
    return {output: normalize(input.output, input.actions[0], null), removed}
  }
  if (input.actions.length !== 2 || !Array.isArray(input.output.options) || input.output.options.length !== 2) fail('候选组审查数量无效')
  const seen = new Set<string>()
  const options = (input.output.options as unknown[]).map(value => {
    const row = object(value), optionKey = row.optionKey
    const index = CHAT_NARRATIVE_OPTION_KEYS_V1.findIndex(key => key === optionKey)
    if (index < 0 || seen.has(String(optionKey))) fail('候选组审查身份无效或重复')
    seen.add(String(optionKey))
    return normalize(row, input.actions[index], String(optionKey))
  })
  return {output: removed.length ? {...input.output, options} : input.output, removed}
}
