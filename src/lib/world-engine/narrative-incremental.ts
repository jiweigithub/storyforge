import type { WorldReleaseCompiledV4, WorldReleaseSemanticContentV4, WorldReleaseManifestV4 } from '../types/narrative-release'
import type { WorldImpactPlanV1 } from '../types/world-impact'
import type { NarrativeIndexReuseReceiptV1 } from './narrative-index'
import { buildWorldImpactPlanV1 } from '../consistency/world-impact'
import { prepareNarrativeReleaseContentV4, verifyWorldReleaseContentV4 } from './narrative-release-v4'
import { compileNarrativeIndexIncrementalV1 } from './narrative-index'
import { WORLD_SEMANTIC_REGISTRY_V4 } from './semantic-registry-v4'
import { canonicalNarrativeJsonV1, hashNarrativeValueV1, narrativeFail } from './narrative-json'

export interface NarrativeIncrementalBaseV1 { version: 1; manifestJson: string; contentHash: string }
export interface NarrativeUpdateReceiptV1 {
  version: 1
  baseContentHash: string
  baseVerification: 'full-frozen-recipe'
  impact: WorldImpactPlanV1
  indexReuse: NarrativeIndexReuseReceiptV1
  automaticCanonWrites: 0
}
export type NarrativeCompilationResultV1 = WorldReleaseCompiledV4 & { update?: NarrativeUpdateReceiptV1 }

function impactSnapshot(content: WorldReleaseSemanticContentV4, semanticRootHash: string) {
  const lockedSources = new Set<string>()
  const originals: Array<{ sourceKey: string; fields: Record<string, unknown> }> = []
  for (const spec of WORLD_SEMANTIC_REGISTRY_V4.tables) {
    for (const row of content.records[spec.name] ?? []) if (spec.resourceIdentity) {
      const sourceKey = `${spec.resourceIdentity.contextKind}:${row[spec.resourceIdentity.field]}`
      if (row.locked === true) lockedSources.add(sourceKey)
      // Portable FK locators and annotation bindings are handled by verified
      // IR references. Keep non-IR original business fields visible as gaps.
      originals.push({ sourceKey, fields: Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')
        && !key.startsWith('narrative') && ![spec.resourceIdentity!.field, 'createdAt', 'updatedAt'].includes(key))) })
    }
  }
  return { projection: content.narrative, semanticRootHash, originals,
    lockedSemanticIds: content.narrative.bundle.records.filter(record => lockedSources.has(record.provenance.sourceResourceKey)).map(record => record.semanticId) }
}

export async function planNarrativeReleaseUpdateV1(base: WorldReleaseManifestV4, next: WorldReleaseSemanticContentV4, nextRootHash: string) {
  return buildWorldImpactPlanV1({ base: impactSnapshot(base, base.semanticRootHash), next: impactSnapshot(next, nextRootHash),
    predicates: WORLD_SEMANTIC_REGISTRY_V4.predicates })
}

/** A cold worker verifies/rebuilds the old recipe once to obtain private shard
 * capabilities. New chunks and lexical shards are then computed only where
 * their exact inputs changed. IR validation and global graph assembly remain
 * full, and are honestly recorded in the receipt. Nothing is persisted here. */
export async function compileNarrativeReleaseIncrementalV1(input: Omit<WorldReleaseSemanticContentV4, 'narrative'>,
  baseline: NarrativeIncrementalBaseV1): Promise<NarrativeCompilationResultV1> {
  if (baseline.version !== 1) narrativeFail('incremental-version', '增量基线版本不受支持')
  const base = await verifyWorldReleaseContentV4({ manifest: baseline.manifestJson, expectedContentHash: baseline.contentHash,
    expectedWorldCode: input.worldCode, retainIncrementalShards: true })
  const { content, semanticRootHash } = await prepareNarrativeReleaseContentV4(input)
  const impact = await planNarrativeReleaseUpdateV1(base.manifest, content, semanticRootHash)
  const incremental = await compileNarrativeIndexIncrementalV1({ inputRootHash: semanticRootHash, projection: content.narrative,
    predicates: WORLD_SEMANTIC_REGISTRY_V4.predicates }, base.index!)
  const index = incremental.index
  const manifest: WorldReleaseManifestV4 = { ...content, semanticRootHash,
    indexDescriptor: { inputRootHash: semanticRootHash, recipeVersion: index.recipeVersion, indexHash: index.indexHash } }
  return { manifest, manifestJson: canonicalNarrativeJsonV1(manifest), contentHash: await hashNarrativeValueV1(manifest), index,
    update: { version: 1, baseContentHash: baseline.contentHash, baseVerification: 'full-frozen-recipe', impact,
      indexReuse: incremental.receipt, automaticCanonWrites: 0 } }
}
