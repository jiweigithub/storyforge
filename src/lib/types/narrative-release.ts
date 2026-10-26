import type { NarrativeDomainProjectionV1 } from './narrative-projection'
import type { NarrativeIndexV1 } from './narrative-index'
import type { WorldSemanticSnapshotV1 } from './world-release'
import type { NarrativeLineageV1 } from './narrative-lineage'

export const NARRATIVE_DOMAIN_COMPILERS_V4 = ['narrative-domain-v1', 'narrative-domain-v2'] as const
export type NarrativeDomainCompilerV4 = typeof NARRATIVE_DOMAIN_COMPILERS_V4[number]
export const CURRENT_NARRATIVE_DOMAIN_COMPILER_V4: NarrativeDomainCompilerV4 = 'narrative-domain-v2'

/** Original selected semantic rows use the existing registry export wire.
 * The neutral roots are scaffolding for explicit import into a new draft. */
export interface WorldReleaseSemanticContentV4 {
  schema: 'storyforge.world-release'
  version: 4
  semanticContract: 4
  registryVersion: 'world-semantic-v4'
  compilerVersion: NarrativeDomainCompilerV4
  worldCode: string
  worldName: string
  selectedTables: string[]
  records: Record<string, Record<string, unknown>[]>
  semanticSnapshot: WorldSemanticSnapshotV1
  sourceManifest: {
    sourceKind: 'world-draft'
    sourceWorkspaceUid: string
    sourceWorldCode: string
    /** Explicitly selected Work in this world-engine workspace, or no Work
     * sources. Frozen IR always belongs to the World namespace. */
    sourceWorkCode: string | null
    /** Optional versioned provenance; absence preserves all prior v4 bytes. */
    lineage?: NarrativeLineageV1
  }
  narrative: NarrativeDomainProjectionV1
}

export interface WorldReleaseManifestV4 extends WorldReleaseSemanticContentV4 {
  semanticRootHash: string
  indexDescriptor: {
    inputRootHash: string
    recipeVersion: string
    indexHash: string
  }
}

/** Index bytes are transportable derived data, outside the manifest hash. */
export interface WorldReleaseCompiledV4 {
  manifest: WorldReleaseManifestV4
  manifestJson: string
  contentHash: string
  index: NarrativeIndexV1
}
