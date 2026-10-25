import type { NarrativeIRBundleV1, NarrativeEvidenceSourceV1 } from './narrative-ir'

export interface NarrativeProjectionGapV1 { sourceKey: string; table: string; code: string; detail: string }
export interface NarrativeProjectionCoverageV1 {
  version: 1
  eligibleSelected: string[]
  projectedSourceKeys: string[]
  explicitlyUnsupportedSourceKeys: string[]
  gaps: NarrativeProjectionGapV1[]
  excluded: NarrativeProjectionGapV1[]
  fields: Array<{ sourceKey: string; projected: string[]; unknown: string[] }>
  declaredAtoms: number
  projectedAtoms: number
  /** Unannotated prose remains visible as a gap; row coverage isn't recall. */
  sourceSpans: Array<{ sourceKey: string; fieldPointer: string; byteLength: number;
    covered: Array<{ start: number; end: number }>; uncovered: Array<{ start: number; end: number }> }>
}
export interface NarrativeDomainProjectionV1 {
  version: 1
  bundle: NarrativeIRBundleV1
  sources: NarrativeEvidenceSourceV1[]
  coverage: NarrativeProjectionCoverageV1
  /** Origin groups remain explicit within an owner-wide projection scope. */
  sourceGroups: Array<{ semanticId: string; worldGroupSourceUid: string | null }>
  dependencyEvidence: Array<{ fromSemanticId: string; toSemanticId: string; role: string; evidenceIds: string[] }>
}
