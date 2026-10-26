import type { NarrativeTimeContextV1, NarrativeTimeV1 } from './narrative-time'

export const NARRATIVE_KINDS_V1 = [
  'entity', 'event', 'assertion', 'relation', 'rule', 'epistemic-event', 'development', 'disclosure',
] as const
export type SemanticKindV1 = typeof NARRATIVE_KINDS_V1[number]
export type NarrativeOwnerV1 =
  | { kind: 'world'; worldCode: string; sourceWorkCode: string | null }
  | { kind: 'work'; workCode: string }
export interface NarrativeScopeV1 {
  owner: NarrativeOwnerV1
  worldGroupKey: string | null
  branchKey: string
  revisionVectorHash: string
}
export interface VisibilityV1 {
  class: 'public' | 'restricted' | 'author-only' | 'unclassified'
  audienceKeys: string[]
  policyVersion: string
}
export interface SemanticRefV1<K extends SemanticKindV1 = SemanticKindV1> {
  kind: K
  semanticId: string
  revisionHash: string
}
export type TypedValueV1 =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'decimal'; value: string; unit: string | null }
  | { kind: 'text'; value: string }
  | { kind: 'enum'; value: string }
  | { kind: 'entity-ref'; value: SemanticRefV1<'entity'> }
  | { kind: 'ordered-set'; values: TypedValueV1[] }
export interface NarrativeSourceIdentityV1 {
  resourceKind: string
  sourceUid: string
  subKey: string
}

export interface NarrativePayloadsV1 {
  entity: {
    entityType: 'character' | 'location' | 'codex-entry' | 'world-group'
    canonicalLabel: string
    aliases: string[]
    sourceIdentity: NarrativeSourceIdentityV1
  }
  event: {
    eventType: 'action' | 'observation' | 'communication'
    participants: Array<{ entityRef: SemanticRefV1<'entity'>; role: string }>
    locationRefs: SemanticRefV1<'entity'>[]
    propositionRefs: SemanticRefV1<'assertion'>[]
    effectRefs: SemanticRefV1[]
    communication: { senderRef: SemanticRefV1<'entity'>; recipientRefs: SemanticRefV1<'entity'>[]; channel: string } | null
    observerRef: SemanticRefV1<'entity'> | null
  }
  assertion: {
    subjectRef: SemanticRefV1<'entity'>
    predicateKey: string
    value: TypedValueV1
    polarity: 'positive' | 'negative'
    supersedesRefs: SemanticRefV1<'assertion'>[]
  }
  relation: {
    fromRef: SemanticRefV1<'entity'>
    toRef: SemanticRefV1<'entity'>
    relationType: string
    direction: 'directed' | 'symmetric'
    value: TypedValueV1
    causeEventRef: SemanticRefV1<'event'> | null
  }
  rule: {
    scopeRefs: SemanticRefV1[]
    statement: string
    strength: 'hard' | 'advisory'
    validatorRef: { key: string; version: string } | null
    preconditionRefs: SemanticRefV1<'assertion'>[]
  }
  'epistemic-event': {
    holderRef: SemanticRefV1<'entity'>
    propositionRef: SemanticRefV1<'assertion'>
    assertedValue: TypedValueV1
    transition: 'acquire' | 'revise' | 'forget' | 'deny-awareness'
    attitude: 'know' | 'believe' | 'doubt' | 'unaware'
    sourceEventRef: SemanticRefV1<'event'> | null
    revisesRef: SemanticRefV1<'epistemic-event'> | null
  }
  development: {
    developmentType: 'thread' | 'goal' | 'conflict' | 'commitment' | 'foreshadow'
    ownerRefs: SemanticRefV1<'entity'>[]
    memberRefs: SemanticRefV1[]
    state: 'open' | 'advancing' | 'blocked' | 'resolved' | 'fulfilled' | 'abandoned'
    transitionEventRefs: SemanticRefV1<'event'>[]
    resolutionEvidenceIds: string[]
  }
  disclosure: {
    subjectRefs: SemanticRefV1[]
    audienceKeys: string[]
    sequenceKey: string
    unitKey: string
    spanRef: string
  }
}

export interface NarrativeEnvelopeV1 {
  irVersion: 1
  semanticId: string
  revisionHash: string
  kind: SemanticKindV1
  scope: NarrativeScopeV1
  modality: 'established' | 'belief' | 'intent' | 'hypothesis'
  reviewState: 'accepted' | 'candidate' | 'conflict' | 'stale' | 'rejected' | 'source-missing' | 'historical'
  authority: 'author-confirmed' | 'author-declared' | 'derived' | 'model-proposed'
  confidence: number | null
  time: NarrativeTimeV1
  perspectiveKeys: string[]
  visibility: VisibilityV1
  evidenceIds: string[]
  dependencies: Array<{
    semanticId: string
    revisionHash: string
    role: 'supports' | 'contradicts' | 'derived-from' | 'causes' | 'requires'
  }>
  provenance: {
    sourceResourceKey: string
    sourceField: string
    sourceRevision: string
    sourceContentHash: string
    adoptionReceiptRef: string | null
    manualDeclarationRef: string | null
  }
  authorCreatedAt: number
  authorUpdatedAt: number
}

export type NarrativeRecordV1 = {
  [K in SemanticKindV1]: NarrativeEnvelopeV1 & { kind: K; payload: NarrativePayloadsV1[K] }
}[SemanticKindV1]

export interface EvidenceSpanV1 {
  evidenceId: string
  sourceResourceKey: string
  fieldPointer: string
  sourceRevision: string
  sourceContentHash: string
  normalizationVersion: 'raw-utf8-v1'
  start: number
  end: number
  spanHash: string
  supportRole: 'supports' | 'contradicts' | 'context'
}

export interface NarrativeEvidenceSourceV1 {
  sourceResourceKey: string
  sourceRevision: string
  fieldPointer: string
  text: string
}

export interface NarrativeIdentityAliasV1 {
  version: 1
  from: { kind: 'semantic'; semanticId: string; revisionHash: string }
    | { kind: 'legacy-release'; worldCode: string; releaseHash: string; resourceKey: string }
  toSemanticId: string
  reason: 'merge' | 'derivation' | 'legacy'
  confirmationRef: string
}

/** Compiler artifact only. Not a WorldReference, database table or v4 release. */
export interface NarrativeIRBundleV1 {
  schema: 'storyforge.narrative-ir'
  irVersion: 1
  scope: NarrativeScopeV1
  records: NarrativeRecordV1[]
  evidence: EvidenceSpanV1[]
  timeContext: NarrativeTimeContextV1
  aliases: NarrativeIdentityAliasV1[]
  semanticRootHash: string
}

/** Contract for future domain subrecords. Not a new persistable/AI-writable field. */
export interface NarrativeSystemMetadataV1 {
  semanticSubKey?: string
}
