import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { deleteWorld } from '../../src/lib/workspace/lifecycle'
import { seedNarrativeRelationReleaseV4 } from '../helpers/narrative-release-fixture'
import { createChatDraftV1, selectChatWorldV1, readChatDraftV1 } from '../../src/lib/character-interaction/draft-service'
import { createAvgDraftV1, selectAvgWorldV1, readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { readWorldNarrativeIndexV1, clearWorldNarrativeIndexMemoryV1 } from '../../src/lib/world-engine/narrative-index-cache'
import { openProductPreparationWorldQueryV1, bindWorldQueryResourcesV1, describeWorldQueryAccessV1 } from '../../src/lib/context-gateway/world-query-client'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'

describe('NW-2E · 删除隔离与事务退化（无作者数据）', () => {
  beforeEach(async () => { clearWorldNarrativeIndexMemoryV1(); await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); clearWorldNarrativeIndexMemoryV1(); db.close() })

  it('删除原世界须确认；两产品自己的冻结副本在原件删除和冷重开后仍可读', async () => {
    const source = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    const consumers = []
    for (const type of ['character-interaction', 'avg'] as const) {
      const product = type === 'avg' ? await createAvgDraftV1('删除隔离 AVG') : await createChatDraftV1('删除隔离聊天')
      const draft = await (type === 'avg' ? readAvgDraftV1 : readChatDraftV1)(product.scope)
      const selected = await (type === 'avg' ? selectAvgWorldV1 : selectChatWorldV1)(product.scope, draft.revision, source.release.id!)
      const release = (await db.worldReleases.get(selected.worldReleaseId!))!
      await readWorldNarrativeIndexV1({ ...product.scope, releaseId: release.id! })
      consumers.push({ type, scope: product.scope, release })
    }
    const priorAccess = await openProductPreparationWorldQueryV1({ scope: source.scope,
      localReleaseRecordId: source.release.id!, productType: 'avg' })
    await expect(deleteWorld(source.scope.worldId)).rejects.toThrow('必须显式确认')
    expect(await db.worldReleases.get(source.release.id!)).toEqual(source.release)
    await deleteWorld(source.scope.worldId, { confirm: true })
    expect(await db.worldReleases.where('worldId').equals(source.scope.worldId).count()).toBe(0)
    expect(await db.worldNarrativeIndexCaches.where('worldId').equals(source.scope.worldId).count()).toBe(0)
    await expect(describeWorldQueryAccessV1(priorAccess)).rejects.toThrow()
    clearWorldNarrativeIndexMemoryV1(); db.close(); await db.open()
    for (const consumer of consumers) {
      expect(await db.worldReleases.get(consumer.release.id!)).toEqual(consumer.release)
      const verified = await verifyWorldReleaseRecordV1(consumer.release)
      expect(verified.version).toBe(4)
      const access = await openProductPreparationWorldQueryV1({ scope: consumer.scope,
        localReleaseRecordId: consumer.release.id!, productType: consumer.type })
      const provider = await bindWorldQueryResourcesV1(access)
      expect((await provider.listMetadata({ scope: access.scope, limit: 100 })).items).toHaveLength(3)
    }
  })

  it('World 最后一步删除失败时，作品、原文、发布和缓存一并回滚，旧发布还能重建验证', async () => {
    const source = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    await readWorldNarrativeIndexV1({ ...source.scope, releaseId: source.release.id! })
    const before = { world: await db.worlds.get(source.scope.worldId), work: await db.works.get(source.scope.workId),
      characters: await db.characters.toArray(), releases: await db.worldReleases.toArray(), caches: await db.worldNarrativeIndexCaches.toArray() }
    vi.spyOn(db.worlds, 'delete').mockRejectedValueOnce(Error('injected final World delete failure'))
    await expect(deleteWorld(source.scope.worldId, { confirm: true })).rejects.toThrow('injected final World delete failure')
    expect({ world: await db.worlds.get(source.scope.worldId), work: await db.works.get(source.scope.workId),
      characters: await db.characters.toArray(), releases: await db.worldReleases.toArray(), caches: await db.worldNarrativeIndexCaches.toArray() }).toEqual(before)
    clearWorldNarrativeIndexMemoryV1(); db.close(); await db.open()
    expect((await readWorldNarrativeIndexV1({ ...source.scope, releaseId: source.release.id! })).verified.version).toBe(4)
  })
})
