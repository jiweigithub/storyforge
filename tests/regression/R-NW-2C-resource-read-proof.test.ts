import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedNarrativeRelationReleaseV4} from '../helpers/narrative-release-fixture'
import {assertVerifiedProductWorldResourceSnapshotV2, closeProductWorldResourceCatalogV2,
  openProductWorldResourceCatalogV2, readProductWorldResourcesV2} from '../../src/lib/context-gateway/world-release-client'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('keeps a full v4 read witness and rejects copied or subsequently altered source data', async () => {
  const world = await seedNarrativeRelationReleaseV4({explicitEntityEvidence: true})
  const catalog = await openProductWorldResourceCatalogV2({localReleaseRecordId: world.release.id!,
    expectedProjectId: world.scope.projectId, expectedWorldId: world.scope.worldId, productType: 'character-interaction', authorReview: true})
  try {
    const descriptor = catalog.resources.find(row => row.kind === 'character')!
    const originalTitle = descriptor.title
    const reading = readProductWorldResourcesV2({catalog, descriptors: [descriptor]})
    descriptor.title = '读取期间修改调用方目录'
    const [read] = await reading
    expect(read.descriptor.title).toBe(originalTitle)
    expect(read.value.atom).toMatchObject({entityType: 'character'})
    expect(() => assertVerifiedProductWorldResourceSnapshotV2(read)).not.toThrow()
    expect(() => assertVerifiedProductWorldResourceSnapshotV2(structuredClone(read))).toThrow('完整读取证据')
    ;(read.value.atom as Record<string, unknown>).canonicalLabel = '篡改的人名'
    expect(() => assertVerifiedProductWorldResourceSnapshotV2(read)).toThrow('读取后已变化')
  } finally {await closeProductWorldResourceCatalogV2(catalog)}
})

it('does not certify caller-forged metadata even when the frozen resource hash is unchanged', async () => {
  const world = await seedNarrativeRelationReleaseV4({explicitEntityEvidence: true})
  const catalog = await openProductWorldResourceCatalogV2({localReleaseRecordId: world.release.id!,
    expectedProjectId: world.scope.projectId, expectedWorldId: world.scope.worldId, productType: 'character-interaction', authorReview: true})
  try {
    const descriptor = catalog.resources.find(row => row.kind === 'character')!
    await expect(readProductWorldResourcesV2({catalog, descriptors: [{...descriptor, title: '伪造的冻结名称'}]}))
      .rejects.toThrow('读取元数据已变化')
  } finally {await closeProductWorldResourceCatalogV2(catalog)}
})

it('keeps ordinary preparation metadata-only and forbids using author review as a production grant', async () => {
  const world = await seedNarrativeRelationReleaseV4({explicitEntityEvidence: true})
  const input = {localReleaseRecordId: world.release.id!, expectedProjectId: world.scope.projectId,
    expectedWorldId: world.scope.worldId, productType: 'character-interaction'}
  const catalog = await openProductWorldResourceCatalogV2(input)
  try {
    await expect(readProductWorldResourcesV2({catalog, descriptors: [catalog.resources[0]]})).rejects.toThrow('产品定向目录')
    await expect(openProductWorldResourceCatalogV2({...input, authorReview: true, sourcePlan: {} as never}))
      .rejects.toThrow('不能替代正式来源计划')
    await expect(openProductWorldResourceCatalogV2({...input, productType: 'avg', authorReview: true}))
      .rejects.toThrow('仅用于聊天确认')
  } finally {await closeProductWorldResourceCatalogV2(catalog)}
})
