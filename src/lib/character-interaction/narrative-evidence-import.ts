import {parseChatResolutionEvidenceVersionV1} from './resolution-evidence'
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
export function validateImportedChatNarrativeEvidenceStateV1(value: unknown, productKind: unknown): void {
  const interaction = object(serializedObject(value)?.interaction), story = object(interaction?.chatNarrative)
  if (!story || !['factEvidence', 'resolutionEvidence'].some(key => Object.prototype.hasOwnProperty.call(story, key))) return
  if (productKind !== 'character-interaction') throw new Error('[chat-fact-evidence] 事实来源索引不能归入其他产品')
  parseInteractionState(interaction)
}
export function validateImportedChatNarrativeEvidenceEventV1(value: unknown, productKind: unknown, eventType: unknown): void {
  const body = serializedObject(value)
  if (!body || !['factEvidenceVersion', 'resolutionEvidenceVersion'].some(key => Object.prototype.hasOwnProperty.call(body, key))) return
  if (productKind !== 'character-interaction' || !['interaction.narrative.action-reviewed.committed', 'interaction.narrative.situation.committed'].includes(String(eventType))) {
    throw new Error('[chat-fact-evidence] 叙事依据提交路径无效')
  }
  parseChatFactEvidenceVersionV1(body.factEvidenceVersion)
  if (Object.prototype.hasOwnProperty.call(body, 'resolutionEvidenceVersion')) {
    if (eventType !== 'interaction.narrative.action-reviewed.committed') throw new Error('[chat-resolution-evidence] 收束依据只能来自已审查行动')
    parseChatResolutionEvidenceVersionV1(body.resolutionEvidenceVersion)
  }
}
