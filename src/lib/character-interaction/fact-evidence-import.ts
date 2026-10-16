import {parseInteractionState} from './runtime'
import {parseChatFactEvidenceVersionV1} from './fact-evidence'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function serializedObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined
  // Existing product import/replay owns the surrounding format. This hook
  // validates recognized new provenance without rewriting historical payloads.
  try {return object(JSON.parse(value))} catch {return undefined}
}
export function validateImportedChatFactEvidenceStateV1(value: unknown, productKind: unknown): void {
  const interaction = object(serializedObject(value)?.interaction), story = object(interaction?.chatNarrative)
  if (!story || !Object.prototype.hasOwnProperty.call(story, 'factEvidence')) return
  if (productKind !== 'character-interaction') throw new Error('[chat-fact-evidence] 事实来源索引不能归入其他产品')
  parseInteractionState(interaction)
}
export function validateImportedChatFactEvidenceEventV1(value: unknown, productKind: unknown, eventType: unknown): void {
  const body = serializedObject(value)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'factEvidenceVersion')) return
  if (productKind !== 'character-interaction' || !['interaction.narrative.action-reviewed.committed', 'interaction.narrative.situation.committed'].includes(String(eventType))) {
    throw new Error('[chat-fact-evidence] 事实来源提交路径无效')
  }
  parseChatFactEvidenceVersionV1(body.factEvidenceVersion)
}
