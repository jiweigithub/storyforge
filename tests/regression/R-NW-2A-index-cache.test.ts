import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeReleaseV4 } from '../helpers/narrative-release-fixture'
import { readWorldNarrativeIndexV1, clearWorldNarrativeIndexCachesV1, clearWorldNarrativeIndexMemoryV1, NARRATIVE_INDEX_CACHE_LIMITS_V1 } from '../../src/lib/world-engine/narrative-index-cache'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { deleteWork, deleteWorld, cascadeRegisteredReferences } from '../../src/lib/workspace/lifecycle'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { createWorldWork } from '../../src/lib/workspace/works'

describe('NW-2A · 可丢弃索引缓存', () => {
  beforeEach(async () => { clearWorldNarrativeIndexMemoryV1(); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks(); clearWorldNarrativeIndexMemoryV1() })

  it('缓存命中返回隔离副本；清空或损坏后同原件离线恢复，不修改原封存', async () => {
    const { request, release } = await seedNarrativeReleaseV4()
    const first = await readWorldNarrativeIndexV1(request)
    expect(first.cacheState).toBe('rebuilt')
    const expected = structuredClone(first.verified.index)
    const expectedManifest = structuredClone(first.verified.manifest)
    first.verified.index!.indexes.recordKeys.length = 0
    first.verified.manifest.worldName = '调用方修改的副本'
    first.verified.manifest.narrative.sources[0].text = '调用方修改的原文副本'
    expect((await readWorldNarrativeIndexV1(request)).verified.index).toEqual(expected)
    expect((await readWorldNarrativeIndexV1(request)).verified.manifest).toEqual(expectedManifest)
    expect((await readWorldNarrativeIndexV1(request)).cacheState).toBe('memory')
    clearWorldNarrativeIndexMemoryV1()
    expect((await readWorldNarrativeIndexV1(request)).cacheState).toBe('stored')
    const row = (await db.worldNarrativeIndexCaches.toArray())[0]
    await db.worldNarrativeIndexCaches.update(row.id!, { indexJson: '{}', byteLength: 2 })
    clearWorldNarrativeIndexMemoryV1()
    const rebuilt = await readWorldNarrativeIndexV1(request)
    expect(rebuilt.diagnostics).toContain('cache-corrupt-or-stale-rebuilt')
    expect(rebuilt.verified.index).toEqual(expected)
    await clearWorldNarrativeIndexCachesV1(request)
    expect(await db.worldNarrativeIndexCaches.count()).toBe(0)
    expect((await readWorldNarrativeIndexV1(request)).verified.index).toEqual(expected)
    expect(await db.worldReleases.get(release.id!)).toEqual(release)
  })

  it('配额失败仍交付验证过的索引，跨 World/工作区请求拒绝，原件篡改不能用旧缓存遮蔽', async () => {
    const { request, release } = await seedNarrativeReleaseV4(), other = await seedNarrativeReleaseV4()
    vi.spyOn(db.worldNarrativeIndexCaches, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    const result = await readWorldNarrativeIndexV1(request)
    expect(result.cacheState).toBe('unavailable')
    expect(result.verified.index).not.toBeNull()
    expect(await db.worldNarrativeIndexCaches.count()).toBe(0)
    await expect(readWorldNarrativeIndexV1({ ...request, worldId: other.scope.worldId })).rejects.toThrow('工作区')
    await expect(readWorldNarrativeIndexV1({ ...other.request, releaseId: release.id! })).rejects.toThrow('Release')
    await db.worldReleases.update(release.id!, { manifestJson: release.manifestJson.replace('守渡人', '冒名者') })
    await expect(readWorldNarrativeIndexV1(request)).rejects.toThrow('hash')
  })

  it('全局条数和字节限制只回收缓存，不删除仍被调用方引用的原件', async () => {
    const fixture = await seedNarrativeReleaseV4(), releases = [fixture.release]
    for (let i = 0; i < NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntries + 1; i++) {
      const revision = await createWorldRevision({ ...fixture.input, label: `版本 ${i}` })
      releases.push(await publishWorldRevision(revision.id!))
    }
    for (const release of releases) await readWorldNarrativeIndexV1({ ...fixture.request, releaseId: release.id! })
    const rows = await db.worldNarrativeIndexCaches.toArray()
    expect(rows.length).toBeLessThanOrEqual(NARRATIVE_INDEX_CACHE_LIMITS_V1.maxEntries)
    expect(rows.reduce((sum, row) => sum + row.byteLength, 0)).toBeLessThanOrEqual(NARRATIVE_INDEX_CACHE_LIMITS_V1.maxBytes)
    expect(await db.worldReleases.count()).toBe(releases.length)
    expect(await db.worldNarrativeIndexCaches.where('releaseId').equals(releases[0].id!).count()).toBe(0)
    expect((await readWorldNarrativeIndexV1(fixture.request)).verified.index).not.toBeNull()
  })

  it('备份不含缓存；删除 Work 不删 World 缓存；World、项目与 release 引用清理遵循注册表', async () => {
    const a = await seedNarrativeReleaseV4(), b = await seedNarrativeReleaseV4()
    await readWorldNarrativeIndexV1(a.request); await readWorldNarrativeIndexV1(b.request)
    const backup = await deriveExportProjectJSON(a.scope.projectId)
    expect(backup).not.toHaveProperty('worldNarrativeIndexCaches')
    const restoredId = await deriveImportProjectJSON(backup)
    expect(await db.worldNarrativeIndexCaches.where('projectId').equals(restoredId).count()).toBe(0)
    // The existing World deletion entry requires a valid current Work root.
    // Keep one while testing that deleting another Work cannot own this cache.
    await createWorldWork(a.scope.projectId, { title: '保留的工作区根' })
    await deleteWork(a.scope.workId)
    expect(await db.worldNarrativeIndexCaches.where('worldId').equals(a.scope.worldId).count()).toBe(1)
    await cascadeRegisteredReferences('worldReleases', b.release.id!)
    expect(await db.worldNarrativeIndexCaches.where('worldId').equals(b.scope.worldId).count()).toBe(0)
    clearWorldNarrativeIndexMemoryV1(); await readWorldNarrativeIndexV1(b.request)
    await deleteWorld(a.scope.worldId, { confirm: true })
    expect(await db.worldNarrativeIndexCaches.where('worldId').equals(a.scope.worldId).count()).toBe(0)
    expect(await db.worldReleases.get(b.release.id!)).toEqual(b.release)
    await cascadeDeleteProject(b.scope.projectId)
    expect(await db.worldNarrativeIndexCaches.count()).toBe(0)
  })
})
