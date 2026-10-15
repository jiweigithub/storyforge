/** Pure formal-purpose identity and source grants. No DB or model execution. */
export const TTRPG_OPEN_CONTEXT_CONSUMERS_V1 = ['actor', 'party-narrator', 'gm-assistant'] as const
export type TtrpgOpenContextConsumerV1 = typeof TTRPG_OPEN_CONTEXT_CONSUMERS_V1[number]
export const TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1 = { actor: 'ttrpgOpenActorContext', 'party-narrator': 'ttrpgOpenPartyContext', 'gm-assistant': 'ttrpgOpenGmContext' } as const
export const TTRPG_OPEN_BASE_CONTEXT_SOURCES_V1 = { actor: ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'],
  'party-narrator': ['ttrpgOpenKpInput'], 'gm-assistant': ['ttrpgOpenGmOracleInput'] } as const
export const TTRPG_OPEN_P7_CONTEXT_SOURCES_V1 = {
  actor: [...TTRPG_OPEN_BASE_CONTEXT_SOURCES_V1.actor, TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1.actor],
  'party-narrator': [...TTRPG_OPEN_BASE_CONTEXT_SOURCES_V1['party-narrator'], TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1['party-narrator']],
  'gm-assistant': [...TTRPG_OPEN_BASE_CONTEXT_SOURCES_V1['gm-assistant'], TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1['gm-assistant']],
} as const
export const TTRPG_OPEN_MEMORY_SOURCE_KEYS_V1 = { actor: 'ttrpgOpenMemory', 'party-narrator': 'ttrpgOpenPartyMemory' } as const
export const TTRPG_OPEN_CURRENT_CONTEXT_SOURCES_V1 = {
  actor: [...TTRPG_OPEN_P7_CONTEXT_SOURCES_V1.actor, TTRPG_OPEN_MEMORY_SOURCE_KEYS_V1.actor],
  'party-narrator': [...TTRPG_OPEN_P7_CONTEXT_SOURCES_V1['party-narrator'], TTRPG_OPEN_MEMORY_SOURCE_KEYS_V1['party-narrator']],
  'gm-assistant': TTRPG_OPEN_P7_CONTEXT_SOURCES_V1['gm-assistant'],
} as const
export const TTRPG_OPEN_MODEL_PURPOSES_V1 = {
  intent: { skillId: 'prose.ttrpg-open-intent', entryId: 'ttrpg.open.intent', stepId: 'ttrpg.open.intent',
    sourceKeys: TTRPG_OPEN_CURRENT_CONTEXT_SOURCES_V1.actor, actorRole: 'player' },
  companion: { skillId: 'prose.ttrpg-open-companion', entryId: 'ttrpg.open.companion', stepId: 'ttrpg.open.companion',
    sourceKeys: TTRPG_OPEN_CURRENT_CONTEXT_SOURCES_V1.actor, actorRole: 'player' },
  'kp-narration': { skillId: 'prose.ttrpg-open-kp', entryId: 'ttrpg.open.kp', stepId: 'ttrpg.open.kp',
    sourceKeys: TTRPG_OPEN_CURRENT_CONTEXT_SOURCES_V1['party-narrator'], actorRole: 'gm' },
  'oracle-interpret': { skillId: 'prose.ttrpg-open-oracle-interpret', entryId: 'ttrpg.open.oracle-interpret', stepId: 'ttrpg.open.oracle-interpret',
    sourceKeys: TTRPG_OPEN_CURRENT_CONTEXT_SOURCES_V1['gm-assistant'], actorRole: 'gm' },
  'fact-normalize': { skillId: 'prose.ttrpg-open-fact-normalize', entryId: 'ttrpg.open.fact-normalize', stepId: 'ttrpg.open.fact-normalize',
    sourceKeys: TTRPG_OPEN_CURRENT_CONTEXT_SOURCES_V1['gm-assistant'], actorRole: 'gm' },
} as const
export type TtrpgOpenModelPurposeV1 = keyof typeof TTRPG_OPEN_MODEL_PURPOSES_V1
export function ttrpgOpenContextConsumerForPurposeV1(purpose: TtrpgOpenModelPurposeV1): TtrpgOpenContextConsumerV1 {
  return purpose === 'intent' || purpose === 'companion' ? 'actor' : purpose === 'kp-narration' ? 'party-narrator' : 'gm-assistant'
}
/** Frozen runs retain their exact historical grant. Only explicitly supported closed protocol generations are valid. */
export function assertTtrpgOpenFrozenContextSourcesV1(skillId: string, actual: readonly string[]): readonly string[] {
  const definition = ttrpgOpenModelPurposeForSkillV1(skillId)
  const consumer = ttrpgOpenContextConsumerForPurposeV1(definition.purpose)
  const legacy = TTRPG_OPEN_BASE_CONTEXT_SOURCES_V1[consumer]
  const modern = TTRPG_OPEN_P7_CONTEXT_SOURCES_V1[consumer]
  const current = TTRPG_OPEN_CURRENT_CONTEXT_SOURCES_V1[consumer]
  const key = [...actual].sort().join(',')
  if (new Set(actual).size !== actual.length || ![legacy, modern, current].some(keys => [...keys].sort().join(',') === key)) {
    throw new Error('[ttrpg-open-call] 冻结来源不是此目的登记的准确协议权限')
  }
  return actual
}
export function ttrpgOpenModelPurposeForSkillV1(skillId: string) {
  const pair = Object.entries(TTRPG_OPEN_MODEL_PURPOSES_V1).find(([, definition]) => definition.skillId === skillId)
  if (!pair) throw new Error('[ttrpg-open-call] Skill 没有登记的正式运行目的')
  return { purpose: pair[0] as TtrpgOpenModelPurposeV1, ...pair[1] }
}
