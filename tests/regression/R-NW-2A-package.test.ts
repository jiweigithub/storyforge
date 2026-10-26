import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { createWorldPackage, importWorldPackage, inspectWorldPackage, type WorldPackageV4 } from '../../src/lib/world-engine/world-package'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { packNarrativeJsonV1, unpackNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-package-packing'
import { compressNarrativePackV1 } from '../../src/lib/world-engine/narrative-package-compression'

async function setup() {
  const created = await createWorkspace({ name: '离线铜铃世界', genres: [], status: 'drafting', description: '',
    targetWordCount: 1000, enableMultiWorld: false }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const { scope } = created, now = Date.now(), owner = { kind: 'world' as const, worldCode: created.world.code, sourceWorkCode: null }
  const id = await db.characters.add(stampNewRecord(scope, 'characters', { name: '老顾', shortDescription: '看守渡口',
    roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
  const capture = await captureNarrativeDomainV1({ scope, owner })
  const actor = capture.rows.get('characters')!.find(row => row.id === id)!
  await confirmNarrativeDomainAnnotationsV1({ scope, table: 'characters', recordId: id,
    expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', actor),
    annotations: { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'test-v1' } } })
  const revision = await createWorldRevision({ scope, formatVersion: 4, selectedTables: ['characters'], label: '完整索引封存' })
  const release = await publishWorldRevision(revision.id!)
  const pkg = await createWorldPackage(release.id!, { authorName: '隔离测试作者', license: 'CC-BY-4.0', allowedUses: {
    'world-remix': true, ttrpg: true, 'character-interaction': true, 'ai-town': false, 'text-adventure': false, avg: false, 'text-open-world': false,
  } })
  if (pkg.packageVersion !== 4) throw Error('Expected v4 package')
  return { ...created, release, pkg }
}
async function rehash(pkg: WorldPackageV4) {
  const { integrity: _integrity, ...payload } = pkg
  pkg.integrity.digest = await hashNarrativeBytesV1(canonicalNarrativeJsonV1(payload))
}

describe('NW-2A · v4 世界分享包的离线验证与导入', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks() })

  it('完整包带原文和索引；源库清空后导入新草稿，原封存字节不变并离线重建相同索引', async () => {
    const { pkg, release } = await setup()
    const original = JSON.stringify(pkg)
    expect((await inspectWorldPackage(pkg)).valid).toBe(true)
    expect(pkg.release.index.indexHash).toBe(pkg.release.manifest.indexDescriptor.indexHash)
    await db.delete(); await db.open()
    const projectId = await importWorldPackage(pkg)
    const project = (await db.projects.get(projectId))!, world = (await db.worlds.get(project.activeWorldId!))!
    expect(world.code).not.toBe(pkg.manifest.sourceWorldCode)
    expect(world.communityOrigin?.sourceWorldCode).toBe(pkg.manifest.sourceWorldCode)
    const restored = (await db.worldReleases.where('projectId').equals(projectId).toArray())[0]
    expect(restored.manifestJson).toBe(release.manifestJson)
    expect(restored.contentHash).toBe(release.contentHash)
    const verified = await verifyWorldReleaseRecordV1(restored)
    expect(verified.version).toBe(4)
    expect(verified.readiness).toBe('rebuilt')
    expect(verified.index).toEqual(pkg.release.index)
    expect(JSON.stringify(pkg)).toBe(original)
    expect((await db.characters.toArray()).map(row => row.name)).toEqual(['老顾'])
  })

  it('最后一步发布记录写入后故障，草稿、原文、来源回执和封存全部原子回滚', async () => {
    const { pkg, release } = await setup()
    const original = db.worldReleases.add.bind(db.worldReleases)
    vi.spyOn(db.worldReleases, 'add').mockImplementationOnce(async (...args) => {
      await original(...args)
      throw Error('package-final-write-failure')
    })
    await expect(importWorldPackage(pkg)).rejects.toThrow('package-final-write-failure')
    expect(await db.projects.count()).toBe(1)
    expect(await db.worlds.count()).toBe(1)
    expect(await db.works.count()).toBe(1)
    expect(await db.characters.count()).toBe(1)
    expect(await db.worldDerivations.count()).toBe(0)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.get(release.id!)).toEqual(release)
  })

  it('重签外层摘要也不能掩盖缺失/损坏的索引、未知包版本或混用旧内容版本', async () => {
    const { pkg } = await setup()
    const variants = [
      (p: any) => { delete p.release.index },
      (p: any) => { p.release.index.indexes.recordKeys = [] },
      (p: any) => { p.packageVersion = 5 },
      (p: any) => { p.packageVersion = 3 },
      (p: any) => { p.release.manifest.version = 3 },
      (p: any) => { p.release.extra = 'not allowed' },
    ]
    for (const mutate of variants) {
      const broken = structuredClone(pkg); mutate(broken); await rehash(broken)
      expect((await inspectWorldPackage(broken)).valid).toBe(false)
      const count = await db.projects.count()
      await expect(importWorldPackage(broken)).rejects.toThrow()
      expect(await db.projects.count()).toBe(count)
    }
  })

  it('原文或 UID/owner 篡改在任何新增项目之前拒绝', async () => {
    const { pkg } = await setup()
    for (const mutate of [
      (p: WorldPackageV4) => { p.release.manifest.records.characters[0].name = '冒名' },
      (p: WorldPackageV4) => { p.release.manifest.records.characters.push({ ...p.release.manifest.records.characters[0], _exportId: 1 }) },
      (p: WorldPackageV4) => { p.release.manifest.records.characters[0]._worldOwnerExportId = 99 },
    ]) {
      const broken = structuredClone(pkg); mutate(broken); await rehash(broken)
      await expect(importWorldPackage(broken)).rejects.toThrow()
      expect(await db.projects.count()).toBe(1)
    }
  })

  it('异步核验和导入捕获调用瞬间的包，调用方后续修改不改变已验证输入', async () => {
    const { pkg } = await setup()
    const checking = inspectWorldPackage(pkg)
    pkg.release.manifest.records.characters[0].name = '校验期间修改'
    expect((await checking).valid).toBe(true)
    expect((await inspectWorldPackage(pkg)).valid).toBe(false)
  })

  it('显式 v5 字典传输仍逐项核验完整 v4 内容，清空源库后恢复相同发布字节', async () => {
    const { pkg, release } = await setup()
    const packed = await createWorldPackage(release.id!, { authorName: pkg.manifest.authorName,
      allowedUses: pkg.manifest.allowedUses, license: pkg.manifest.license, transport: 'dictionary-v1' })
    expect(packed.packageVersion).toBe(5)
    if (packed.packageVersion !== 5) throw Error('Expected packed transport')
    expect((await inspectWorldPackage(packed)).valid).toBe(true)
    const broken = structuredClone(packed)
    const content = unpackNarrativeJsonV1(broken.release.packed) as { manifest: typeof pkg.release.manifest; index: typeof pkg.release.index }
    content.index.indexes.recordKeys = []
    broken.release.packed = packNarrativeJsonV1(content)
    const { integrity: _integrity, ...body } = broken
    broken.integrity.digest = await hashNarrativeBytesV1(canonicalNarrativeJsonV1(body))
    await expect(importWorldPackage(broken)).rejects.toThrow()
    expect(await db.projects.count()).toBe(1)
    packed.release.packed = await compressNarrativePackV1(packNarrativeJsonV1({ manifest: pkg.release.manifest, index: pkg.release.index }))
    const { integrity: _oldIntegrity, ...compressedBody } = packed
    packed.integrity.digest = await hashNarrativeBytesV1(canonicalNarrativeJsonV1(compressedBody))
    expect((await inspectWorldPackage(packed)).valid).toBe(true)
    await db.delete(); await db.open()
    const restoredId = await importWorldPackage(packed)
    const restored = (await db.worldReleases.where('projectId').equals(restoredId).first())!
    expect(restored.manifestJson).toBe(release.manifestJson)
    expect(restored.contentHash).toBe(release.contentHash)
    expect((await verifyWorldReleaseRecordV1(restored)).index).toEqual(pkg.release.index)
  })
})
