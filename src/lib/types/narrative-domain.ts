import type { SemanticKindV1, VisibilityV1 } from './narrative-ir'

/** Typed physical FK vocabulary. PROJECT_TABLES declares which domain fields
 * carry these references and derives their portable/deletion lifecycle. This
 * vocabulary does not select projection sources or create another Canon store.
 */
export const NARRATIVE_SOURCE_FKS_V1 = {
  characterId: { table: 'characters', resourceKind: 'character', semanticKinds: ['entity'] },
  locationId: { table: 'importantLocations', resourceKind: 'location', semanticKinds: ['entity'] },
  codexEntryId: { table: 'codexEntries', resourceKind: 'codex-entry', semanticKinds: ['entity'] },
  worldGroupId: { table: 'worldGroups', resourceKind: 'world-group', semanticKinds: ['entity'] },
  factId: { table: 'temporalFacts', resourceKind: 'temporal-fact', semanticKinds: ['assertion', 'rule'] },
  knowledgeId: { table: 'knowledgeLedger', resourceKind: 'knowledge-event', semanticKinds: ['epistemic-event'] },
  storyEventId: { table: 'storyTimelineEvents', resourceKind: 'story-timeline-event', semanticKinds: ['event'] },
  historyEventId: { table: 'historicalTimelineEvents', resourceKind: 'historical-event', semanticKinds: ['event'] },
  relationId: { table: 'characterRelations', resourceKind: 'character-relation', semanticKinds: ['relation'] },
  storyArcId: { table: 'storyArcs', resourceKind: 'story-arc', semanticKinds: ['development'] },
  progressId: { table: 'storylineProgress', resourceKind: 'storyline-progress', semanticKinds: ['development'] },
  foreshadowId: { table: 'foreshadows', resourceKind: 'foreshadow', semanticKinds: ['development'] },
  chapterId: { table: 'chapters', resourceKind: 'chapter', semanticKinds: ['disclosure'] },
  worldviewId: { table: 'worldviews', resourceKind: 'worldview', semanticKinds: [] },
  powerSystemId: { table: 'powerSystems', resourceKind: 'power-system', semanticKinds: [] },
  cultivationSystemId: { table: 'cultivationSystems', resourceKind: 'cultivation-system', semanticKinds: [] },
  storyCoreId: { table: 'storyCores', resourceKind: 'story-core', semanticKinds: [] },
} as const

export type NarrativeSourceFkV1 = keyof typeof NARRATIVE_SOURCE_FKS_V1
export type NarrativeDomainSourceRefV1<K extends NarrativeSourceFkV1 = NarrativeSourceFkV1> = {
  [F in K]: { [P in F]: number | null } & {
    /** UID prevents a stale numeric ID from resolving to a different record.
     * A null FK retains this identity as a source-missing tombstone. */
    sourceUid: string
  }
}[K]
export type NarrativeDomainEntityRefV1 = NarrativeDomainSourceRefV1<'characterId' | 'locationId' | 'codexEntryId' | 'worldGroupId'>
export interface NarrativeDomainAtomRefV1<K extends SemanticKindV1 = SemanticKindV1> {
  kind: K
  source: NarrativeDomainSourceRefV1
  subKey: string
}
export type NarrativeDomainValueV1 =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'decimal'; value: string; unit: string | null }
  | { kind: 'text'; value: string }
  | { kind: 'enum'; value: string }
  | { kind: 'entity-ref'; value: NarrativeDomainEntityRefV1 }
  | { kind: 'ordered-set'; values: Exclude<NarrativeDomainValueV1, { kind: 'ordered-set' }>[] }

export type NarrativeDomainTimePointV1 =
  | { kind: 'tick'; timelineKey: string; value: string }
  | { kind: 'unknown'; label: string | null }
  | { kind: 'event-anchor'; event: NarrativeDomainAtomRefV1<'event'>; side: 'before' | 'at' | 'after' }
export interface NarrativeDomainIntervalV1 {
  start: NarrativeDomainTimePointV1
  end: NarrativeDomainTimePointV1 | null
  endMeaning: 'known' | 'open' | 'unknown'
}
export interface NarrativeDomainTimeV1 {
  occurred: NarrativeDomainIntervalV1 | null
  valid: NarrativeDomainIntervalV1 | null
  narratedAt: { chapter: NarrativeDomainSourceRefV1<'chapterId'>; spanStart: number } | null
  disclosedAt: Array<{ audienceKey: string; chapter: NarrativeDomainSourceRefV1<'chapterId'> }>
  acquiredAt: NarrativeDomainTimePointV1 | null
}

export interface NarrativeDomainEvidenceV1 {
  evidenceKey: string
  source: NarrativeDomainSourceRefV1 | { self: true }
  fieldPointer: string
  sourceContentHash: string
  normalizationVersion: 'raw-utf8-v1'
  start: number
  end: number
  spanHash: string
  supportRole: 'supports' | 'contradicts' | 'context'
}
export interface NarrativeDomainDependencyV1 {
  /** The referenced source supports/contradicts/causes the declaring atom;
   * derived-from/requires means the declaring atom depends on this target. */
  target: NarrativeDomainAtomRefV1
  role: 'supports' | 'contradicts' | 'derived-from' | 'causes' | 'requires'
  evidenceKeys: string[]
}

/** System-owned receipt. Models may propose the annotation fields, but cannot
 * mint this receipt through FIELD_REGISTRY. The content hash binds both the
 * registered source fields and annotations after portable FK normalization. */
export interface NarrativeDomainAuthorityV1 {
  version: 1
  confirmationUid: string
  mode: 'author-declaration' | 'candidate-adoption'
  confirmedAt: number
  contentHash: string
}
export interface NarrativeDomainMetadataV1 {
  narrativeTimeV1?: NarrativeDomainTimeV1
  narrativeEvidenceV1?: NarrativeDomainEvidenceV1[]
  narrativeVisibilityV1?: VisibilityV1
  narrativeModalityV1?: 'established' | 'belief' | 'intent'
  narrativeDependenciesV1?: NarrativeDomainDependencyV1[]
  narrativeAuthorityV1?: NarrativeDomainAuthorityV1
}

export interface NarrativeDomainEventV1 {
  eventType: 'action' | 'observation' | 'communication'
  participants: Array<{ entity: NarrativeDomainEntityRefV1; role: string }>
  locations: NarrativeDomainSourceRefV1<'locationId'>[]
  propositions: NarrativeDomainAtomRefV1<'assertion'>[]
  effects: NarrativeDomainAtomRefV1[]
  communication: { sender: NarrativeDomainEntityRefV1; recipients: NarrativeDomainEntityRefV1[]; channel: string } | null
  observer: NarrativeDomainEntityRefV1 | null
  before: NarrativeDomainAtomRefV1<'event'>[]
}
export interface NarrativeDomainEpistemicV1 {
  attitude: 'know' | 'believe' | 'doubt' | 'unaware'
  transition: 'acquire' | 'revise' | 'forget' | 'deny-awareness'
  assertedValue: NarrativeDomainValueV1
  sourceEvent: NarrativeDomainAtomRefV1<'event'> | null
  revises: NarrativeDomainSourceRefV1<'knowledgeId'> | null
}
export interface NarrativeDomainDevelopmentV1 extends Omit<NarrativeDomainMetadataV1, 'narrativeAuthorityV1'> {
  semanticSubKey: string
  statement: string
  developmentType: 'thread' | 'goal' | 'conflict' | 'commitment' | 'foreshadow'
  owners: NarrativeDomainEntityRefV1[]
  members: NarrativeDomainAtomRefV1[]
  state: 'open' | 'advancing' | 'blocked' | 'resolved' | 'fulfilled' | 'abandoned'
  transitions: NarrativeDomainAtomRefV1<'event'>[]
  resolutionEvidenceKeys: string[]
}
export interface NarrativeDomainDisclosureV1 extends Omit<NarrativeDomainMetadataV1, 'narrativeAuthorityV1'> {
  semanticSubKey: string
  subjects: NarrativeDomainAtomRefV1[]
  audienceKeys: string[]
  evidenceKey: string
}

/** Calendar definitions belong to the existing WorldGroup. Runtime clocks do
 * not belong here. Event anchors and narrative sequences are compiled from
 * the selected domain records, never copied from an active product session. */
export interface NarrativeDomainChronologyV1 {
  timelines: Array<{ timelineKey: string; calendar: string; unit: string; epoch: string }>
  mappings: Array<{
    mappingKey: string
    targetWorldGroup: NarrativeDomainSourceRefV1<'worldGroupId'>
    fromTimelineKey: string
    toTimelineKey: string
    fromStart: string
    fromEnd: string | null
    numerator: string
    denominator: string
    offset: string
    evidenceKeys: string[]
  }>
}

/** Finite projector inputs. These are optional annotations on their existing
 * domain rows; no typed IR record or compiled hash is a writable domain field. */
export interface NarrativeDomainFieldsV1 extends NarrativeDomainMetadataV1 {
  narrativeAliasesV1?: string[]
  narrativeEventV1?: NarrativeDomainEventV1
  narrativeAssertionV1?: { polarity: 'positive' | 'negative' }
  narrativeRuleV1?: { preconditions: NarrativeDomainAtomRefV1<'assertion'>[] }
  narrativeRelationV1?: { causeEvent: NarrativeDomainAtomRefV1<'event'> | null }
  narrativeEpistemicV1?: NarrativeDomainEpistemicV1
  narrativeDevelopmentsV1?: NarrativeDomainDevelopmentV1[]
  narrativeDisclosuresV1?: NarrativeDomainDisclosureV1[]
  narrativeChronologyV1?: NarrativeDomainChronologyV1
}
