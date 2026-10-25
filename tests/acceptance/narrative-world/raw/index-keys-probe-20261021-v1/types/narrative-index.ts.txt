import type { NarrativeTimeV1 } from './narrative-time'
import type { NarrativeRecordV1, SemanticKindV1, VisibilityV1 } from './narrative-ir'

export const NARRATIVE_INDEX_RECIPE_V1 = 'narrative-index-v1:raw-utf8:scalar-order:1024-byte-chunks:ascii-words-unicode-pairs' as const
export const NARRATIVE_INDEX_EDGE_KINDS_V1 = [
  'participant', 'location', 'proposition', 'effect', 'sender', 'recipient', 'observer',
  'subject', 'relation', 'rule-scope', 'precondition', 'belief-holder', 'belief-proposition',
  'knowledge-source', 'revision', 'owner', 'member', 'transition', 'discloses', 'supersedes',
  'supports', 'contradicts', 'derived-from', 'causes', 'requires', 'before',
] as const
export type NarrativeIndexEdgeKindV1 = typeof NARRATIVE_INDEX_EDGE_KINDS_V1[number]

/** A deterministic derived file, not a writable Canon table. Numeric indexes
 * address this file's sorted arrays only; they are never physical database IDs. */
export interface NarrativeIndexV1 {
  schema: 'storyforge.narrative-index'
  version: 1
  inputRootHash: string
  recipeVersion: typeof NARRATIVE_INDEX_RECIPE_V1
  indexes: {
    recordKeys: string[]
    byKind: Array<{ kind: SemanticKindV1; recordIndexes: number[] }>
    bySource: Array<{ sourceResourceKey: string; recordIndexes: number[] }>
    byEntity: Array<{ entityIndex: number; recordIndexes: number[] }>
    adjacency: Array<{
      fromIndex: number
      toIndex: number
      kind: NarrativeIndexEdgeKindV1
      role: string | null
      evidenceIds: string[]
      basis: 'declared' | 'structural'
    }>
    /** Direct reference/dependency table; the bounded resolver computes its
     * transitive union without materializing an unbounded quadratic matrix. */
    dependencies: Array<{ recordIndex: number; requiredIndexes: number[] }>
    time: Array<{ recordIndex: number; time: NarrativeTimeV1 }>
    epistemic: Array<{
      recordIndex: number; holderIndex: number; propositionIndex: number
      sourceEventIndex: number | null
      attitude: Extract<NarrativeRecordV1, { kind: 'epistemic-event' }>['payload']['attitude']
      transition: Extract<NarrativeRecordV1, { kind: 'epistemic-event' }>['payload']['transition']
      acquiredAt: NarrativeTimeV1['acquiredAt']
    }>
    disclosures: Array<{
      recordIndex: number; subjectIndexes: number[]; audienceKeys: string[]
      sequenceKey: string; unitKey: string; evidenceId: string
    }>
    developments: Array<{
      recordIndex: number; type: Extract<NarrativeRecordV1, { kind: 'development' }>['payload']['developmentType']
      state: Extract<NarrativeRecordV1, { kind: 'development' }>['payload']['state']
      ownerIndexes: number[]; memberIndexes: number[]; transitionEventIndexes: number[]
      modality: NarrativeRecordV1['modality']
    }>
    chunks: Array<{
      sourceResourceKey: string; sourceRevision: string; fieldPointer: string
      sourceContentHash: string; start: number; end: number; spanHash: string
      recordIndexes: number[]; evidenceIds: string[]; visibility: VisibilityV1
    }>
    /** Posting permissions include every chunk touched by the whole term;
     * a term spanning a public/private boundary cannot match as public. */
    sourcePostings: Array<{ term: string; groups: Array<{ visibility: VisibilityV1; chunkIndexes: number[] }> }>
    atomPostings: Array<{ term: string; recordIndexes: number[] }>
    unknownTime: Array<{ axis: 'occurred' | 'valid' | 'acquired' | 'narrated' | 'disclosed'; recordIndexes: number[] }>
    /** Intent is a separate set, never merged into established occurrences. */
    intentIndexes: number[]
    coverageHash: string
  }
  indexHash: string
}
