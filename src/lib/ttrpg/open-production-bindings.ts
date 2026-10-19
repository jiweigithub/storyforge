/** New Plans opt into this exact prompt generation. Historical Plan/Run IDs
 * remain valid and never acquire a different wire format during recovery. */
export const TTRPG_OPEN_PRODUCTION_BINDINGS_V2 = {
  'ttrpg.open.source-facts': {
    skillId: 'product-production.ttrpg-open-source-facts.v2',
    promptVersion: 'ttrpg-open-source-facts-v2',
  },
  'ttrpg.open.rule-system': {
    skillId: 'product-production.ttrpg-open-rule-system.v2',
    promptVersion: 'ttrpg-open-rule-system-v2',
  },
  'ttrpg.open.situation-layer': {
    skillId: 'product-production.ttrpg-open-situation-layer.v2',
    promptVersion: 'ttrpg-open-situation-layer-v3',
  },
} as const

export type TtrpgOpenProductionTaskKeyV2 = keyof typeof TTRPG_OPEN_PRODUCTION_BINDINGS_V2

/** Retained whole generation; a mixed Plan is never inferred as compatible. */
export const TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1 = {
  'ttrpg.open.source-facts': 'product-production.ttrpg-open-source-facts.v1',
  'ttrpg.open.rule-system': 'product-production.ttrpg-open-rule-system.v1',
  'ttrpg.open.situation-layer': 'product-production.ttrpg-open-situation-layer.v1',
} as const

export function isTtrpgOpenProductionTaskV2(task: {
  taskKey: string; skillId: string | null; executionMode: string
}): task is typeof task & { taskKey: TtrpgOpenProductionTaskKeyV2 } {
  const binding = Object.prototype.hasOwnProperty.call(TTRPG_OPEN_PRODUCTION_BINDINGS_V2, task.taskKey)
    ? TTRPG_OPEN_PRODUCTION_BINDINGS_V2[task.taskKey as TtrpgOpenProductionTaskKeyV2] : null
  return task.executionMode === 'model' && binding !== null && binding.skillId === task.skillId
}
