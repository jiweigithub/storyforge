import type { NarrativeRecordV1, SemanticKindV1, TypedValueV1 } from './narrative-ir'
import type { NarrativeIndexEdgeKindV1 } from './narrative-index'
import type { IntervalV1, TimePointV1 } from './narrative-time'
import type { WorldReferenceV1 } from './world-product-contracts'
import type { ContextResourceKind, ContextResourceProviderV1, FrozenResourceScopeV1 } from '../registry/types'

/** Same portable release identity as V1; V2 explicitly commits the v4 index.
 * The local locator still has no part in the reference hash. */
export interface WorldReferenceV2 extends Omit<WorldReferenceV1, 'version' | 'manifestIdentity' | 'capabilityIdentity'> {
  version: 2
  manifestIdentity: {
    schema: 'storyforge.world-release'
    version: 4
    semanticContract: 4
    registryVersion: string
    compilerVersion: string
  }
  indexIdentity: { inputRootHash: string; recipeVersion: string; indexHash: string }
}

export type WorldQueryViewV1 = 'canon' | 'character' | 'development' | 'author-plan' | 'hypothesis'
export type WorldQueryPerspectiveV1 = { kind: 'author' } | { kind: 'reader' }
  | { kind: 'character'; characterKey: string }
export type WorldQueryTimeV1 =
  | { axis: 'occurred' | 'valid' | 'acquired'; mode: 'at'; point: TimePointV1 }
  | { axis: 'occurred' | 'valid' | 'acquired'; mode: 'overlaps'; interval: IntervalV1 }
  | { axis: 'narrated' | 'disclosed'; sequenceKey: string; throughUnitKey: string; audienceKey: string | null }

export interface WorldQueryV1 {
  schema: 'storyforge.world-query'
  version: 1
  worldReference: WorldReferenceV1 | WorldReferenceV2
  sourcePlanHash: string | null
  view: WorldQueryViewV1
  perspective: WorldQueryPerspectiveV1
  branch: { kind: 'canon'; key: string } | { kind: 'hypothesis'; artifactRef: string }
  mode: 'search' | 'state-at' | 'events' | 'traverse'
  text: string | null
  kinds: SemanticKindV1[]
  entityKeys: string[]
  storyArcKeys: string[]
  time: WorldQueryTimeV1 | null
  evidenceDepth: 'metadata' | 'atomic' | 'original'
  relationExpansion: { kinds: NarrativeIndexEdgeKindV1[]; maxHops: number; maxNodes: number }
  causalDepth: number
  budget: { maxTokens: number; maxRecords: number; maxEvidenceBytes: number }
  cursor: string | null
}

/** Trusted, server/controller-derived policy, separate from model arguments.
 * The Gateway issues this only after validating the local author owner or a
 * frozen product plan. A requested perspective never grants this authority. */
export interface WorldQueryGrantV1 {
  version: 1
  releaseReferenceHash: string
  sourcePlanHash: string | null
  purpose: 'author-review' | 'product-preparation' | 'product-production' | 'product-runtime'
  views: WorldQueryViewV1[]
  perspective: WorldQueryPerspectiveV1
  audienceKeys: string[]
  allowedSemanticIds: string[] | null
  branchKey: string
  knowledgeThrough: TimePointV1 | null
  disclosedThrough: { sequenceKey: string; unitKey: string; audienceKey: string } | null
  maxTokens: number
  maxRecords: number
  maxEvidenceBytes: number
  policyRevision: string
}

export type WorldQueryDiagnosticCodeV1 = 'unsupported' | 'unknown-time' | 'incomparable-time'
  | 'missing' | 'insufficient' | 'budget' | 'conflict' | 'selection-incomplete'
export interface WorldQueryDiagnosticV1 {
  code: WorldQueryDiagnosticCodeV1
  /** Only previously authorized identities may appear here. */
  semanticIds: string[]
  reason: string
}

/** Directory metadata from the verified release, available only to an author
 * review grant. The release hash binds the title; sourceRevision identifies
 * the originating record. Neither is a new story assertion or evidence span. */
export interface WorldQueryAuthorSourceV1 {
  version: 1
  sourceResourceKey: string
  sourceRevision: string
  title: string
}

export interface WorldQueryItemV1 {
  semanticId: string
  revisionHash: string
  kind: SemanticKindV1
  title: string
  summary: string
  authorSource?: WorldQueryAuthorSourceV1
  modality: NarrativeRecordV1['modality']
  authority: NarrativeRecordV1['authority']
  reviewState: NarrativeRecordV1['reviewState']
  depth: WorldQueryV1['evidenceDepth']
  /** Atomic payload is a perspective projection. In character view a belief
   * has its asserted value, never the referenced Canon proposition's value. */
  atom: NarrativeRecordV1['payload'] | {
    holderKey: string; subjectKey: string; predicateKey: string
    assertedValue: TypedValueV1; attitude: string; transition: string
  } | {
    /** Compiler-v2 character projection contains only independently granted
     * knowledge material, never private Canon identity/subject/predicate. */
    projectionVersion: 2; holderKey: string
    assertedValue: TypedValueV1; attitude: string; transition: string
  } | null
  supportingAtoms: Array<{ semanticId: string; revisionHash: string; kind: SemanticKindV1;
    modality: NarrativeRecordV1['modality']; payload: NonNullable<WorldQueryItemV1['atom']> }>
  evidence: Array<{ evidenceId: string; sourceResourceKey: string; fieldPointer: string; sourceRevision: string;
    sourceContentHash: string; spanHash: string;
    start: number; end: number; text: string | null }>
  match: { selection: 'direct' | 'expansion'; entityKeys: string[]; storyArcKeys: string[];
    time: 'matched' | 'not-requested' | 'outside' | 'unknown-time' | 'incomparable-time' }
  closure: 'complete' | 'insufficient'
  originalAvailable: boolean
}

export interface WorldQueryResultV1 {
  schema: 'storyforge.world-query-result'
  version: 1
  queryHash: string
  releaseRef: string
  indexRef: string | null
  viewFingerprint: string
  status: 'matched' | 'missing' | 'unsupported' | 'insufficient' | 'conflict'
  items: WorldQueryItemV1[]
  /** Edges are emitted only when both endpoints were delivered in this page. */
  edges: Array<{ from: string; to: string; kind: NarrativeIndexEdgeKindV1; evidenceIds: string[] }>
  diagnostics: WorldQueryDiagnosticV1[]
  budgetUsed: { tokens: number; records: number; evidenceBytes: number }
  nextCursor: string | null
  receiptRef: string
}

/** Opaque host capability. Copying these fields does not copy authority. */
export interface WorldQueryAccessV1 {
  version: 1
  scope: FrozenResourceScopeV1
  reference: WorldReferenceV2
  view: WorldQueryViewV1
  perspective: WorldQueryPerspectiveV1
  branchKey: string
  purpose: WorldQueryGrantV1['purpose']
  sourcePlanHash: string | null
  policyHash: string
  scopeFingerprint: string
  capabilities: {
    queryVersion: 'world-query-v1'
    operations: Array<WorldQueryV1['mode']>
    axes: Array<WorldQueryTimeV1['axis']>
    deterministic: true
    embeddingsRequired: false
    simulation: false
    coverage: { declaredAtoms: number; projectedAtoms: number; unsupportedSources: number; unannotatedBytes: number } | null
    timeChoices: { timelines: Array<{ key: string; label: string }>; sequences: Array<{ key: string; units: Array<{ key: string; ordinal: number }> }> } | null
  }
}
export interface OpenAuthorWorldQueryInputV1 {
  scope: FrozenResourceScopeV1 & { worldId: number }
  localReleaseRecordId: number
  view: WorldQueryViewV1
  perspective: WorldQueryPerspectiveV1
  knowledgeThrough: TimePointV1 | null
  disclosedThrough: WorldQueryGrantV1['disclosedThrough']
}
export interface WorldQueryProviderProtocolV1 {
  openAuthor(input: OpenAuthorWorldQueryInputV1): Promise<WorldQueryAccessV1>
  /** Host S2 controller only: metadata preparation has product visibility,
   * and does not grant a formal production run or a runtime authority. */
  openPreparation(input: Pick<OpenAuthorWorldQueryInputV1, 'scope' | 'localReleaseRecordId'> & {
    productType: 'character-interaction' | 'avg'
  }): Promise<WorldQueryAccessV1>
  openProduction(input: { scope: FrozenResourceScopeV1 & { worldId: number };
    sourcePlan: import('./world-product-contracts').ProductSourcePlanV2 }): Promise<WorldQueryAccessV1>
  describe(access: WorldQueryAccessV1): Promise<{
    sourceManifestHash: string
    identity: { worldCode: string; worldName: string; workTitle: string; releaseVersion: number;
      releaseLabel: string; releaseHash: string; releasedAt: number }
  }>
  bind(access: WorldQueryAccessV1, narrowing?: { allowedResourceKeys: readonly string[] | null;
    allowedKinds: readonly ContextResourceKind[]; maxTokens: number }): Promise<ContextResourceProviderV1>
  query(access: WorldQueryAccessV1, query: WorldQueryV1): Promise<WorldQueryResultV1>
  close(access: WorldQueryAccessV1): Promise<void>
}
