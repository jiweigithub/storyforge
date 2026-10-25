import type { NarrativeLineageV1 } from '../types/narrative-lineage'
import type { NarrativeDomainProjectionV1 } from '../types/narrative-projection'
import type { NarrativeOwnerV1 } from '../types/narrative-ir'
import { isWorkspaceUid } from '../memory/identity'
import { isPublicWorldCode } from '../workspace/identity'
import { canonicalNarrativeJsonV1, compareUnicodeCodePointsV1, enumV1, hashNarrativeValueV1, hashV1, keyV1, narrativeFail, nullableV1, objectV1 } from './narrative-json'
import { createNarrativeSemanticIdV1, narrativeOwnerKeyV1, ownerDecoderV1, parseNarrativeSemanticIdV1 } from './narrative-identity'
import { parseNarrativeIdentityAliasV1 } from './narrative-ir-codec'
import { compileImmutableNarrativeIRV1, compileNarrativeIRBundleV1 } from './narrative-ir'
import { WORLD_SEMANTIC_REGISTRY_V4 } from './semantic-registry-v4'

export function parseNarrativeLineageV1(value: unknown): NarrativeLineageV1 {
  canonicalNarrativeJsonV1(value)
  const result = objectV1<NarrativeLineageV1>({ schema: enumV1(['storyforge.narrative-lineage']), version: enumV1([1]),
    kind: enumV1(['work-derivation', 'world-copy']), sourceOwner: ownerDecoderV1, sourceWorkspaceUid: keyV1,
    sourceContentHash: hashV1, sourceRevisionVectorHash: hashV1, sourceReleaseUid: nullableV1(keyV1), targetWorldCode: keyV1,
    confirmationRef: keyV1, receiptHash: hashV1, aliases: input => {
      if (!Array.isArray(input)) narrativeFail('lineage', '派生身份对照必须是数组')
      return input.map(parseNarrativeIdentityAliasV1)
    } })(value, 'lineage')
  const sourceOwnerKey = narrativeOwnerKeyV1(result.sourceOwner), targetOwnerKey = `world/${result.targetWorldCode}`
  if (!isWorkspaceUid(result.sourceWorkspaceUid) || !isPublicWorldCode(result.targetWorldCode)
    || sourceOwnerKey === targetOwnerKey
    || (result.kind === 'work-derivation' ? result.sourceOwner.kind !== 'work' || result.sourceReleaseUid !== null
      : result.sourceOwner.kind !== 'world' || !result.sourceReleaseUid)) narrativeFail('lineage', '派生来源、目标或发布身份不闭合')
  const seen = new Set<string>(), targets = new Set<string>()
  let prior = ''
  for (const alias of result.aliases) {
    if (alias.from.kind !== 'semantic' || alias.reason !== 'derivation' || alias.confirmationRef !== result.confirmationRef) narrativeFail('lineage', '只接受本次显式复制的语义身份对照')
    const from = parseNarrativeSemanticIdV1(alias.from.semanticId), to = parseNarrativeSemanticIdV1(alias.toSemanticId)
    if (from.ownerKey !== sourceOwnerKey || to.ownerKey !== targetOwnerKey || from.kind !== to.kind
      || canonicalNarrativeJsonV1(from.source) !== canonicalNarrativeJsonV1(to.source)
      || seen.has(alias.from.semanticId) || targets.has(alias.toSemanticId)
      || (prior && compareUnicodeCodePointsV1(prior, alias.from.semanticId) >= 0)) narrativeFail('lineage', '复制对照必须按稳定 UID 一对一映射，不能猜测合并身份')
    seen.add(alias.from.semanticId); targets.add(alias.toSemanticId); prior = alias.from.semanticId
  }
  return result
}

export async function verifyNarrativeLineageV1(value: unknown, targetWorldCode?: string): Promise<NarrativeLineageV1> {
  const parsed = parseNarrativeLineageV1(value)
  const { receiptHash, ...body } = parsed
  if (await hashNarrativeValueV1(body) !== receiptHash || (targetWorldCode !== undefined && parsed.targetWorldCode !== targetWorldCode)) narrativeFail('lineage', '派生回执摘要或目标世界不匹配')
  return parsed
}

/** Every alias comes from a verified projection, never a name match. */
export async function createNarrativeLineageV1(input: {
  source: NarrativeDomainProjectionV1; targetOwner: Extract<NarrativeOwnerV1, { kind: 'world' }>
  sourceWorkspaceUid: string; sourceContentHash: string; sourceReleaseUid?: string
}): Promise<NarrativeLineageV1> {
  const confirmationRef = `derivation:v1:${crypto.randomUUID()}`
  const aliases = input.source.bundle.records.map(record => ({ version: 1 as const,
    from: { kind: 'semantic' as const, semanticId: record.semanticId, revisionHash: record.revisionHash },
    toSemanticId: createNarrativeSemanticIdV1(input.targetOwner, record.kind, parseNarrativeSemanticIdV1(record.semanticId).source),
    reason: 'derivation' as const, confirmationRef })).sort((a, b) => compareUnicodeCodePointsV1(a.from.semanticId, b.from.semanticId))
  const body: Omit<NarrativeLineageV1, 'receiptHash'> = { schema: 'storyforge.narrative-lineage', version: 1,
    kind: input.source.bundle.scope.owner.kind === 'work' ? 'work-derivation' : 'world-copy',
    sourceOwner: input.source.bundle.scope.owner, sourceWorkspaceUid: input.sourceWorkspaceUid,
    sourceContentHash: input.sourceContentHash, sourceRevisionVectorHash: input.source.bundle.scope.revisionVectorHash,
    sourceReleaseUid: input.sourceReleaseUid ?? null, targetWorldCode: input.targetOwner.worldCode, confirmationRef, aliases }
  return verifyNarrativeLineageV1({ ...body, receiptHash: await hashNarrativeValueV1(body) })
}

/** Aliases are historical identity provenance, not current assertions. Deleted
 * targets stay in the receipt but cannot become dangling active IR aliases. */
export async function attachNarrativeLineageV1(projection: NarrativeDomainProjectionV1, lineage: NarrativeLineageV1 | undefined,
  options: { immutableIR?: boolean } = {}): Promise<NarrativeDomainProjectionV1> {
  if (!lineage) return projection
  if (projection.bundle.scope.owner.kind !== 'world') narrativeFail('lineage', '派生对照只附着到目标 World')
  const verified = await verifyNarrativeLineageV1(lineage, projection.bundle.scope.owner.worldCode)
  const ids = new Set(projection.bundle.records.map(row => row.semanticId))
  // sourceWorkCode binds the Work actually read by this projection. After
  // the author replaces that Work, a historical copy receipt must not claim
  // that the new Work is its old source. Preserve the complete receipt in the
  // manifest, while omitting those aliases from this active IR bundle. The
  // standalone IR verifier's cross-Work alias check remains strict.
  const sourceMatches = verified.sourceOwner.kind !== 'work'
    || verified.sourceOwner.workCode === projection.bundle.scope.owner.sourceWorkCode
  const { schema: _schema, irVersion: _version, semanticRootHash: _root, ...bundle } = projection.bundle
  const input = { ...bundle, aliases: sourceMatches ? verified.aliases.filter(alias => ids.has(alias.toSemanticId)) : [] }
  const compiled = options.immutableIR
    ? await compileImmutableNarrativeIRV1(input, projection.sources, WORLD_SEMANTIC_REGISTRY_V4.predicates)
    : { bundle: await compileNarrativeIRBundleV1(input, projection.sources, WORLD_SEMANTIC_REGISTRY_V4.predicates), sources: projection.sources }
  return { ...projection, ...compiled }
}
