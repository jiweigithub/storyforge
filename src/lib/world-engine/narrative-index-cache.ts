import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorldRelease } from '../types'
import type { WorldNarrativeIndexCacheV1 } from '../types/narrative-index-cache'
import { verifyWorldReleaseManifestV1, type VerifiedWorldReleaseV1 } from './release-codec'
import { boundedCanonicalNarrativeJsonV1, canonicalNarrativeJsonV1, narrativeUtf8ByteLengthV1 } from './narrative-json'

export const NARRATIVE_INDEX_CACHE_LIMITS_V1 = Object.freeze({ maxEntries: 8, maxBytes: 64 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024 })
type Scope = { projectId: number; worldId: number }
type VerifiedV4 = Extract<VerifiedWorldReleaseV1, { version: 4 }>
export type NarrativeIndexCacheStateV1 = 'memory' | 'stored' | 'rebuilt' | 'unavailable' | 'budget-exceeded'
export interface WorldNarrativeIndexReadV1 {
  release: WorldRelease
  verified: VerifiedV4
  cacheState: NarrativeIndexCacheStateV1
  diagnostics: string[]
}
const memory = new Map<string, { releaseJson: string; verifiedJson: string; bytes: number }>()
const size = narrativeUtf8ByteLengthV1
const key = (scope: Scope, releaseId: number) => `${scope.projectId}:${scope.worldId}:${releaseId}`
class StaleReleaseError extends Error {}

async function assertScope(scope: Scope): Promise<void> {
  const world = await db.worlds.get(scope.worldId)
  if (!world || world.projectId !== scope.projectId || !await db.projects.get(scope.projectId)) throw Error('[narrative-index-cache] World 不属于请求工作区')
}
function releaseMatches(a: WorldRelease | undefined, b: WorldRelease): boolean {
  return !!a && a.id === b.id && a.projectId === b.projectId && a.worldId === b.worldId
    && a.releaseUid === b.releaseUid && a.contentHash === b.contentHash && a.sourceWorldCode === b.sourceWorldCode
    && a.manifestJson === b.manifestJson
}
async function assertCurrent(release: WorldRelease): Promise<void> {
  if (!releaseMatches(await db.worldReleases.get(release.id!), release)) throw new StaleReleaseError('[narrative-index-cache] 核验期间封存记录已变化或删除')
}
async function readRelease(scope: Scope, releaseId: number): Promise<WorldRelease> {
  return db.transaction('r', db.projects, db.worlds, db.worldReleases, async () => {
    await Dexie.Promise.resolve(assertScope(scope))
    const release = await db.worldReleases.get(releaseId)
    if (!release || release.projectId !== scope.projectId || release.worldId !== scope.worldId) throw Error('[narrative-index-cache] Release 不属于请求 World')
    return release
  })
}
function remember(scope: Scope, release: WorldRelease, verified: VerifiedV4): void {
  const cacheKey = key(scope, release.id!), limit = NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntryBytes
  memory.delete(cacheKey)
  // UTF-16 length is a lower bound on canonical UTF-8 bytes. Do not encode
  // an already oversized manifest just to discard its disposable cache.
  if (release.manifestJson.length > limit) return
  const releaseJson = boundedCanonicalNarrativeJsonV1(release, limit)
  if (releaseJson === null) return
  const releaseBytes = size(releaseJson)
  const verifiedJson = boundedCanonicalNarrativeJsonV1(verified, limit - releaseBytes)
  if (verifiedJson === null) return
  const bytes = releaseBytes + size(verifiedJson)
  memory.set(cacheKey, { releaseJson, verifiedJson, bytes })
  let total = [...memory.values()].reduce((sum, row) => sum + row.bytes, 0)
  while (memory.size > NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntries || total > NARRATIVE_INDEX_CACHE_LIMITS_V1.maxBytes) {
    const oldest = memory.keys().next().value as string
    total -= memory.get(oldest)!.bytes
    memory.delete(oldest)
  }
}
async function storeVerified(release: WorldRelease, verified: VerifiedV4): Promise<'stored' | 'budget-exceeded'> {
  if (!verified.index) return 'budget-exceeded'
  const indexJson = boundedCanonicalNarrativeJsonV1(verified.index, NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntryBytes)
  if (indexJson === null) return 'budget-exceeded'
  const byteLength = size(indexJson)
  return db.transaction('rw', db.worldNarrativeIndexCaches, db.worldReleases, async () => {
    await Dexie.Promise.resolve(assertCurrent(release))
    const previous = await db.worldNarrativeIndexCaches.where('releaseId').equals(release.id!).first(), now = Date.now()
    const row: WorldNarrativeIndexCacheV1 = { id: previous?.id, projectId: release.projectId, worldId: release.worldId,
      releaseId: release.id!, releaseUid: release.releaseUid!, contentHash: release.contentHash,
      inputRootHash: verified.manifest.semanticRootHash, recipeVersion: verified.index!.recipeVersion,
      indexHash: verified.index!.indexHash, indexJson, byteLength, createdAt: previous?.createdAt ?? now, lastAccessedAt: now }
    const id = await db.worldNarrativeIndexCaches.put(row)
    const rows = (await db.worldNarrativeIndexCaches.toArray()).sort((a, b) => b.lastAccessedAt - a.lastAccessedAt || b.id! - a.id!)
    let bytes = 0, count = 0
    const remove: number[] = []
    for (const item of rows) {
      // Never trust a persisted byteLength for eviction accounting.
      const actualBytes = typeof item.indexJson === 'string' ? size(item.indexJson) : Infinity
      if (actualBytes > NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntryBytes || count >= NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntries
        || bytes + actualBytes > NARRATIVE_INDEX_CACHE_LIMITS_V1.maxBytes) remove.push(item.id!)
      else { bytes += actualBytes; count++ }
    }
    await db.worldNarrativeIndexCaches.bulkDelete(remove)
    return remove.includes(id) ? 'budget-exceeded' : 'stored'
  })
}

/** Internal frozen-world loading boundary. Readers must still apply their
 * Context Gateway audience/policy before exposing any content. Persistent
 * cache bytes are fully verified once per process; only a bounded immutable
 * memory copy avoids repeated compilation. No model or network is used. */
export async function readWorldNarrativeIndexV1(input: Scope & { releaseId: number }): Promise<WorldNarrativeIndexReadV1> {
  const request = { ...input }, scope = { projectId: input.projectId, worldId: input.worldId }
  const release = await readRelease(scope, request.releaseId), cacheKey = key(scope, request.releaseId)
  const memo = memory.get(cacheKey)
  if (memo && memo.releaseJson === canonicalNarrativeJsonV1(release)) {
    memory.delete(cacheKey); memory.set(cacheKey, memo)
    return { release, verified: JSON.parse(memo.verifiedJson) as VerifiedV4, cacheState: 'memory', diagnostics: [] }
  }
  memory.delete(cacheKey)
  const diagnostics: string[] = []
  let cached: WorldNarrativeIndexCacheV1 | undefined
  try { cached = await db.worldNarrativeIndexCaches.where('releaseId').equals(request.releaseId).first() }
  catch { diagnostics.push('cache-read-unavailable') }
  let verified: VerifiedWorldReleaseV1 | null = null
  if (cached) {
    try {
      if (cached.projectId !== release.projectId || cached.worldId !== release.worldId || cached.releaseUid !== release.releaseUid
        || cached.contentHash !== release.contentHash || typeof cached.indexJson !== 'string'
        || size(cached.indexJson) > NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntryBytes) throw Error('cache binding mismatch')
      verified = await verifyWorldReleaseManifestV1({ manifest: release.manifestJson, expectedContentHash: release.contentHash,
        expectedWorldCode: release.sourceWorldCode, index: JSON.parse(cached.indexJson) })
      if (verified.version !== 4 || !verified.index || cached.inputRootHash !== verified.manifest.semanticRootHash
        || cached.recipeVersion !== verified.index.recipeVersion || cached.indexHash !== verified.index.indexHash
        || cached.byteLength !== size(cached.indexJson)) throw Error('cache descriptor mismatch')
    } catch { verified = null; diagnostics.push('cache-corrupt-or-stale-rebuilt') }
  }
  const usedStored = verified !== null
  verified ??= await verifyWorldReleaseManifestV1({ manifest: release.manifestJson, expectedContentHash: release.contentHash, expectedWorldCode: release.sourceWorldCode })
  if (verified.version !== 4 || !verified.index) throw Error('[narrative-index-cache] 该版本不提供可用的 v4 索引')
  await assertCurrent(release)
  let cacheState: NarrativeIndexCacheStateV1 = usedStored ? 'stored' : 'rebuilt'
  try {
    if (await storeVerified(release, verified) === 'budget-exceeded') { cacheState = 'budget-exceeded'; diagnostics.push('cache-budget-exceeded') }
  } catch (error) {
    if (error instanceof StaleReleaseError) throw error
    cacheState = 'unavailable'; diagnostics.push('cache-write-unavailable')
    await assertCurrent(release)
  }
  remember(scope, release, verified)
  // Verification created this caller-private object. Stored and memory caches
  // own only serialized bytes, so returning it cannot poison another reader.
  return { release, verified, cacheState, diagnostics }
}

/** Cache eviction never follows references into releases, products or sessions.
 * All callers holding an index receive detached copies and can continue using
 * their immutable snapshot; later callers rebuild from the same release. */
export async function clearWorldNarrativeIndexCachesV1(input: Scope): Promise<void> {
  const scope = { ...input }
  await db.transaction('rw', db.projects, db.worlds, db.worldNarrativeIndexCaches, async () => {
    await Dexie.Promise.resolve(assertScope(scope))
    await db.worldNarrativeIndexCaches.where('worldId').equals(scope.worldId).and(row => row.projectId === scope.projectId).delete()
  })
  for (const cacheKey of memory.keys()) if (cacheKey.startsWith(`${scope.projectId}:${scope.worldId}:`)) memory.delete(cacheKey)
}
export function clearWorldNarrativeIndexMemoryV1(): void { memory.clear() }
