import type { NarrativeIdentityAliasV1, NarrativeOwnerV1 } from './narrative-ir'

/** System-issued evidence for an explicit copy. It never grants visibility or
 * turns an unreviewed source into Canon. Numeric database IDs are excluded. */
export interface NarrativeLineageV1 {
  schema: 'storyforge.narrative-lineage'
  version: 1
  kind: 'work-derivation' | 'world-copy'
  sourceOwner: NarrativeOwnerV1
  sourceWorkspaceUid: string
  sourceContentHash: string
  sourceRevisionVectorHash: string
  sourceReleaseUid: string | null
  targetWorldCode: string
  confirmationRef: string
  aliases: NarrativeIdentityAliasV1[]
  receiptHash: string
}
