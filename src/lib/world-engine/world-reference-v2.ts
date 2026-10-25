import type { WorldRelease, WorkspaceScope, WorldReferenceCatalogEntry } from '../types'
import type { WorldReferenceV2 } from '../types/world-query'
import type { WorldReleaseManifestV4 } from '../types/narrative-release'
import { hashCanonicalValue } from '../agent/run/hash'
import { ensureWorldReleaseUidV1 } from './world-reference'
import { worldReleaseUidV1, listWorldReleases } from './releases'
import { worldQueryReferenceDecoderV1, worldQueryFailV1 } from '../context-gateway/world-query-contract'
import { db } from '../db/schema'
import type { WorldReferenceV1 } from '../types/world-product-contracts'
import type { FrozenResourceScopeV1 } from '../registry/types'
import { createWorldReferenceV1, validatePortableWorldReferenceV1, resolveWorldReferenceResourceScopeV1 } from './world-reference'
import { verifyWorldReleaseRecordV1 } from './release-codec'

const portableBody = ({ localReleaseRecordId: _local, ...value }: Omit<WorldReferenceV2, 'referenceHash'>) => value

/** Called by the provider only after verifying the v4 record/index. Reuses the
 * existing release UID recipe; changing wire versions does not create a second
 * identity for the same immutable world release. */
export async function referenceForVerifiedWorldReleaseV2(release: WorldRelease & { id: number }, manifest: WorldReleaseManifestV4): Promise<WorldReferenceV2> {
  const releaseUid = await ensureWorldReleaseUidV1(release)
  const body: Omit<WorldReferenceV2, 'referenceHash'> = { schema: 'storyforge.world-reference', version: 2,
    worldCode: release.sourceWorldCode, releaseUid, releaseVersion: release.version, releaseHash: release.contentHash,
    localReleaseRecordId: release.id, manifestIdentity: { schema: manifest.schema, version: manifest.version,
      semanticContract: manifest.semanticContract, registryVersion: manifest.registryVersion, compilerVersion: manifest.compilerVersion },
    indexIdentity: { ...manifest.indexDescriptor } }
  return { ...body, referenceHash: await hashCanonicalValue(portableBody(body)) }
}

export async function validatePortableWorldReferenceV2(input: WorldReferenceV2): Promise<WorldReferenceV2> {
  const parsed = worldQueryReferenceDecoderV1(input, 'worldReference')
  if (parsed.version !== 2) worldQueryFailV1('reference-version', '此入口要求 v4 世界引用')
  const { referenceHash, ...body } = parsed
  if (parsed.releaseUid !== worldReleaseUidV1({ worldCode: parsed.worldCode, version: parsed.releaseVersion, contentHash: parsed.releaseHash })
    || referenceHash !== await hashCanonicalValue(portableBody(body))) worldQueryFailV1('reference-hash', '世界引用身份校验失败')
  return parsed
}

export async function portableWorldReferenceV2(input: WorldReferenceV2): Promise<WorldReferenceV2> {
  return { ...await validatePortableWorldReferenceV2(input), localReleaseRecordId: 0 }
}

/** Explicit dispatch for enhanced callers. Legacy V1 entry points keep their
 * strict v3 contract and cannot silently acquire narrative-index authority. */
export async function createWorldReference(localReleaseRecordId: number): Promise<WorldReferenceV1 | WorldReferenceV2> {
  if (!Number.isSafeInteger(localReleaseRecordId) || localReleaseRecordId < 1) worldQueryFailV1('reference', '本地世界 locator 无效')
  const release = await db.worldReleases.get(localReleaseRecordId)
  if (!release?.id) worldQueryFailV1('reference', '冻结世界不存在')
  const verified = await verifyWorldReleaseRecordV1(release)
  return verified.version === 3 ? createWorldReferenceV1(release.id)
    : referenceForVerifiedWorldReleaseV2({ ...release, id: release.id }, verified.manifest)
}

export async function listWorldReferenceCatalog(scope: WorkspaceScope): Promise<WorldReferenceCatalogEntry[]> {
  const releases = await listWorldReleases(scope)
  return Promise.all(releases.map(async release => {
    if (!release.id) worldQueryFailV1('reference', '世界目录存在无本地 locator 的记录')
    return { reference: await createWorldReference(release.id), label: release.label, createdAt: release.createdAt }
  }))
}

export async function validatePortableWorldReference(input: WorldReferenceV1 | WorldReferenceV2) {
  return input.version === 2 ? validatePortableWorldReferenceV2(input) : validatePortableWorldReferenceV1(input)
}

export async function portableWorldReference(input: WorldReferenceV1 | WorldReferenceV2) {
  return { ...await validatePortableWorldReference(input), localReleaseRecordId: 0 }
}

export async function resolveWorldReferenceResourceScope(input: WorldReferenceV1 | WorldReferenceV2): Promise<FrozenResourceScopeV1> {
  if (input.version === 1) return resolveWorldReferenceResourceScopeV1(input)
  await validatePortableWorldReferenceV2(input)
  const current = await createWorldReference(input.localReleaseRecordId)
  if (current.version !== 2 || current.referenceHash !== input.referenceHash) worldQueryFailV1('stale', '冻结世界引用与本地版本不匹配')
  const release = await db.worldReleases.get(input.localReleaseRecordId)
  if (!release?.id) worldQueryFailV1('reference', '冻结世界不存在')
  return { projectId: release.projectId, worldId: release.worldId, worldReleaseId: release.id, worldReleaseHash: release.contentHash }
}
