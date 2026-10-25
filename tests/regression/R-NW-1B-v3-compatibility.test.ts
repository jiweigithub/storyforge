import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { hashWorldReleaseValueV1 } from '../../src/lib/world-engine/release-hash'
import { verifyPureWorldReleaseManifestV3 } from '../../src/lib/world-engine/release-codec'
import { seedNarrativeFamily } from '../helpers/narrative-world-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { buildWorldReleaseManifest } from '../../src/lib/world-engine/releases'
import { WORLD_SEMANTIC_REGISTRY_V3 } from '../../src/lib/world-engine/semantic-registry-v3'

const goldenPath = 'tests/acceptance/narrative-world/worldrelease-v3-golden.json'

describe('NW-1B · 历史 v3 wire contract', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => {
    vi.doUnmock('../../src/lib/registry/project-tables')
    vi.resetModules()
    db.close()
  })

  it('保留整合基线产生的真实 v3 发布字节与 hash', async () => {
    if (process.env.NW_CAPTURE_V3_GOLDEN === '1') {
      if (fs.existsSync(goldenPath)) throw new Error('历史 v3 golden 已存在；禁止覆盖')
      const fixture = await seedNarrativeFamily(corpus.families[0]!)
      fs.writeFileSync(goldenPath, JSON.stringify({
        schema: 'storyforge.narrative-world-v3-compatibility-golden', version: 1,
        capturedFromCommit: 'f52f5d4d', evidenceLevel: 'deterministic-original-corpus-fixture',
        manifestJson: fixture.release.manifestJson, contentHash: fixture.release.contentHash,
      }, null, 2) + '\n')
    }
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'))
    const decoded = await verifyPureWorldReleaseManifestV3({
      manifest: golden.manifestJson, expectedContentHash: golden.contentHash,
    })
    expect(await hashWorldReleaseValueV1(decoded)).toBe(golden.contentHash)
    expect(decoded.records.temporalFacts).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'superseded' })]))
    expect(decoded.records.knowledgeLedger).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'mislearn' })]))
  })

  it.each(['new-domain', 'changed-area-and-policy'] as const)('当前注册表扩展后冷启动仍按历史合同读同一 v3：%s', async mutation => {
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'))
    const future = PROJECT_TABLES.map(spec => ({ ...spec, worldSemantic: spec.worldSemantic && { ...spec.worldSemantic } }))
    if (mutation === 'new-domain') {
      future.find(spec => spec.name === 'notes')!.worldSemantic = {
        version: 1, area: 'story', resourceKind: 'future-semantic-domain', canonPolicy: 'authoritative-table',
      }
    } else {
      future.find(spec => spec.name === 'temporalFacts')!.worldSemantic = {
        version: 1, area: 'entities', resourceKind: 'future-assertion', canonPolicy: 'confirmed-rows-only',
        statusField: 'status', confirmedStatusValues: ['confirmed', 'superseded'],
      }
    }
    vi.doMock('../../src/lib/registry/project-tables', () => ({ PROJECT_TABLES: future }))
    vi.resetModules()
    const codec = await import('../../src/lib/world-engine/release-codec')
    const decoded = await codec.verifyPureWorldReleaseManifestV3({ manifest: golden.manifestJson, expectedContentHash: golden.contentHash })
    expect(await hashWorldReleaseValueV1(decoded)).toBe(golden.contentHash)
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(JSON.parse(golden.manifestJson)))
  })

  it('继续封存 v3 时也使用旧状态筛选，不把新历史政策偷偷装进旧协议', async () => {
    const fixture = await seedNarrativeFamily(corpus.families[0]!)
    // Publishing increments the world version; compare the same current
    // source snapshot before/after the registry change, not against its parent.
    const before = await buildWorldReleaseManifest({ scope: fixture.scope })
    const spec = PROJECT_TABLES.find(item => item.name === 'temporalFacts')!
    const prior = spec.worldSemantic!
    spec.worldSemantic = { ...prior, confirmedStatusValues: ['confirmed', 'superseded', 'candidate'] }
    try {
      const manifest = await buildWorldReleaseManifest({ scope: fixture.scope })
      expect(await hashWorldReleaseValueV1(manifest)).toBe(await hashWorldReleaseValueV1(before))
      expect(manifest.records.temporalFacts).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'superseded' })]))
      expect((await db.worldReleases.get(fixture.release.id!))!.manifestJson).toBe(fixture.release.manifestJson)
    } finally { spec.worldSemantic = prior }
  })

  it('历史快照不可变，未来版本和篡改目录仍被拒绝', async () => {
    expect(Object.isFrozen(WORLD_SEMANTIC_REGISTRY_V3)).toBe(true)
    expect(WORLD_SEMANTIC_REGISTRY_V3).toHaveLength(31)
    for (const spec of WORLD_SEMANTIC_REGISTRY_V3) {
      expect(Object.isFrozen(spec)).toBe(true)
      expect(Object.isFrozen(spec.worldSemantic)).toBe(true)
      if (spec.worldSemantic.confirmedStatusValues) expect(Object.isFrozen(spec.worldSemantic.confirmedStatusValues)).toBe(true)
    }
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'))
    const future = JSON.parse(golden.manifestJson)
    future.version = 4
    await expect(verifyPureWorldReleaseManifestV3({ manifest: future })).rejects.toThrow('只允许 semanticContract=3')
    const tampered = JSON.parse(golden.manifestJson)
    tampered.resourceCatalog[0].resourceKind = 'forged-domain'
    await expect(verifyPureWorldReleaseManifestV3({ manifest: tampered })).rejects.toThrow('语义身份不一致')
  })
})
