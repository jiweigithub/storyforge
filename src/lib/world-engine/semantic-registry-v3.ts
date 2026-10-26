import type { WorldCapabilityArea } from '../registry/types'

/** Historical wire contract captured from PROJECT_TABLES at f52f5d4d.
 * This is not the current registry. Never extend it for v4 or new domains:
 * existing v3 bytes, source partitions and hashes must retain their meaning.
 * The matching release fixture was captured before introducing this snapshot.
 */
export interface WorldSemanticTableV3 {
  readonly name: string
  readonly worldSemantic: {
    readonly version: 1
    readonly area: WorldCapabilityArea
    readonly resourceKind: string
    readonly canonPolicy: 'authoritative-table' | 'confirmed-rows-only'
    readonly statusField?: string
    readonly confirmedStatusValues?: readonly string[]
  }
}

export const WORLD_CAPABILITY_AREAS_V3: readonly WorldCapabilityArea[] = Object.freeze([
  'foundation', 'story', 'characters', 'relations', 'entities', 'storylines',
  'outline', 'detailed-outline', 'manuscript', 'multi-world',
])

const captured: WorldSemanticTableV3[] = [
  { name: 'workCharacterBindings', worldSemantic: { version: 1, area: 'characters', resourceKind: 'work-character-binding', canonPolicy: 'authoritative-table' } },
  { name: 'worldviews', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'worldview', canonPolicy: 'authoritative-table' } },
  { name: 'storyCores', worldSemantic: { version: 1, area: 'story', resourceKind: 'story-core', canonPolicy: 'authoritative-table' } },
  { name: 'powerSystems', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'power-system', canonPolicy: 'authoritative-table' } },
  { name: 'cultivationSystems', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'cultivation-system', canonPolicy: 'authoritative-table' } },
  { name: 'cultivationProgress', worldSemantic: { version: 1, area: 'story', resourceKind: 'cultivation-progress', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'] } },
  { name: 'geographies', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'geography', canonPolicy: 'authoritative-table' } },
  { name: 'histories', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'history', canonPolicy: 'authoritative-table' } },
  { name: 'worldNodes', worldSemantic: { version: 1, area: 'entities', resourceKind: 'world-node', canonPolicy: 'authoritative-table' } },
  { name: 'historicalTimelineEvents', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'historical-event', canonPolicy: 'authoritative-table' } },
  { name: 'historicalKeywords', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'historical-keyword', canonPolicy: 'authoritative-table' } },
  { name: 'importantLocations', worldSemantic: { version: 1, area: 'entities', resourceKind: 'location', canonPolicy: 'authoritative-table' } },
  { name: 'worldRulesProfiles', worldSemantic: { version: 1, area: 'foundation', resourceKind: 'world-rules', canonPolicy: 'authoritative-table' } },
  { name: 'characters', worldSemantic: { version: 1, area: 'characters', resourceKind: 'character', canonPolicy: 'authoritative-table' } },
  { name: 'characterRelations', worldSemantic: { version: 1, area: 'relations', resourceKind: 'character-relation', canonPolicy: 'authoritative-table' } },
  { name: 'outlineNodes', worldSemantic: { version: 1, area: 'outline', resourceKind: 'outline-node', canonPolicy: 'authoritative-table' } },
  { name: 'chapters', worldSemantic: { version: 1, area: 'manuscript', resourceKind: 'chapter', canonPolicy: 'authoritative-table' } },
  { name: 'detailedOutlines', worldSemantic: { version: 1, area: 'detailed-outline', resourceKind: 'detailed-outline', canonPolicy: 'authoritative-table' } },
  { name: 'foreshadows', worldSemantic: { version: 1, area: 'story', resourceKind: 'foreshadow', canonPolicy: 'authoritative-table' } },
  { name: 'storyArcs', worldSemantic: { version: 1, area: 'storylines', resourceKind: 'story-arc', canonPolicy: 'authoritative-table' } },
  { name: 'storylineProgress', worldSemantic: { version: 1, area: 'storylines', resourceKind: 'storyline-progress', canonPolicy: 'authoritative-table' } },
  { name: 'storylineCrossings', worldSemantic: { version: 1, area: 'storylines', resourceKind: 'storyline-crossing', canonPolicy: 'authoritative-table' } },
  { name: 'stateCards', worldSemantic: { version: 1, area: 'entities', resourceKind: 'state-card', canonPolicy: 'authoritative-table' } },
  { name: 'itemLedger', worldSemantic: { version: 1, area: 'entities', resourceKind: 'item-event', canonPolicy: 'authoritative-table' } },
  { name: 'storyTimelineEvents', worldSemantic: { version: 1, area: 'story', resourceKind: 'story-timeline-event', canonPolicy: 'authoritative-table' } },
  { name: 'codexCategories', worldSemantic: { version: 1, area: 'entities', resourceKind: 'codex-category', canonPolicy: 'authoritative-table' } },
  { name: 'codexEntries', worldSemantic: { version: 1, area: 'entities', resourceKind: 'codex-entry', canonPolicy: 'authoritative-table' } },
  { name: 'temporalFacts', worldSemantic: { version: 1, area: 'story', resourceKind: 'temporal-fact', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'] } },
  { name: 'knowledgeLedger', worldSemantic: { version: 1, area: 'relations', resourceKind: 'knowledge-event', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'] } },
  { name: 'worldGroups', worldSemantic: { version: 1, area: 'multi-world', resourceKind: 'world-group', canonPolicy: 'authoritative-table' } },
  { name: 'worldGroupLinks', worldSemantic: { version: 1, area: 'multi-world', resourceKind: 'world-link', canonPolicy: 'authoritative-table' } },
]
export const WORLD_SEMANTIC_REGISTRY_V3: readonly WorldSemanticTableV3[] = Object.freeze(captured.map(spec => Object.freeze({
  name: spec.name,
  worldSemantic: Object.freeze({ ...spec.worldSemantic,
    ...(spec.worldSemantic.confirmedStatusValues ? { confirmedStatusValues: Object.freeze([...spec.worldSemantic.confirmedStatusValues]) } : {}),
  }),
})))
