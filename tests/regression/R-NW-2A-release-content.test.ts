import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeFamily } from '../helpers/narrative-world-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { deriveRegisteredSemanticRowsV1 } from '../../src/lib/export/registry-export'
import { compileWorldReleaseContentV4, verifyWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { canonicalNarrativeJsonV1, hashNarrativeValueV1 } from '../../src/lib/world-engine/narrative-json'
import type { WorldReleaseSemanticContentV4 } from '../../src/lib/types/narrative-release'
import { readFileSync, writeFileSync } from 'node:fs'

describe('NW-2A · 原文、投影和索引的 v4 内容绑定', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  async function setup() {
    const fixture = await seedNarrativeFamily(corpus.families[0]!)
    const old = JSON.parse(fixture.release.manifestJson)
    const owner = { kind: 'world' as const, worldCode: fixture.release.sourceWorldCode, sourceWorkCode: null }
    for (const row of await db.characters.where('projectId').equals(fixture.scope.projectId).toArray()) {
      const capture = await captureNarrativeDomainV1({ scope: fixture.scope, owner })
      await confirmNarrativeDomainAnnotationsV1({ scope: fixture.scope, table: 'characters', recordId: row.id!,
        expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', row as unknown as Record<string, unknown>),
        annotations: { narrativeModalityV1: 'established', narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'test-v1' } } })
    }
    const capture = await captureNarrativeDomainV1({ scope: fixture.scope, owner })
    const { records } = deriveRegisteredSemanticRowsV1({ rows: new Map([['characters', capture.rows.get('characters')!]]),
      worldId: fixture.scope.worldId, workId: fixture.scope.workId })
    const input: Omit<WorldReleaseSemanticContentV4, 'narrative'> = {
      schema: 'storyforge.world-release', version: 4, semanticContract: 4,
      registryVersion: 'world-semantic-v4', compilerVersion: 'narrative-domain-v1', worldCode: fixture.release.sourceWorldCode,
      worldName: old.worldName, selectedTables: ['characters'], records, semanticSnapshot: old.semanticSnapshot,
      sourceManifest: { sourceKind: 'world-draft', sourceWorldCode: fixture.release.sourceWorldCode,
        sourceWorkspaceUid: old.sourceManifest.sourceWorkspaceUid, sourceWorkCode: null },
    }
    return { fixture, input, compiled: await compileWorldReleaseContentV4(input) }
  }

  it('固定 v4 原始包、语义根和索引 golden 可按同一版本离线重建', async () => {
    const path = 'tests/acceptance/narrative-world/worldrelease-v4-content-golden.json'
    if (process.env.NW_CAPTURE_V4_CONTENT_GOLDEN === '1') {
      const { compiled } = await setup()
      writeFileSync(path, `${JSON.stringify({ schema: 'storyforge.world-release-v4-content-golden', version: 1,
        evidenceLevel: 'deterministic-component-fixture; not-author-publishing-or-product-acceptance', modelCalls: 0, compiled }, null, 2)}\n`, { flag: 'wx' })
    }
    const { compiled } = JSON.parse(readFileSync(path, 'utf8'))
    const { semanticRootHash: _root, indexDescriptor: _descriptor, narrative: _projection, ...content } = compiled.manifest
    expect((await verifyWorldReleaseContentV4({ manifest: compiled.manifestJson, expectedContentHash: compiled.contentHash })).index).toEqual(compiled.index)
    expect(await compileWorldReleaseContentV4(content)).toEqual(compiled)
  })

  it('复用真实导出坐标，绑定原始来源、IR 和独立索引；删除原库仍可离线验读', async () => {
    const { compiled } = await setup()
    expect(compiled.manifest.narrative.bundle.records.length).toBeGreaterThan(0)
    expect(compiled.manifest.narrative.coverage.gaps).toEqual([])
    expect(compiled.manifestJson).toBe(canonicalNarrativeJsonV1(compiled.manifest))
    expect(compiled.manifest.semanticRootHash).toBe(compiled.index.inputRootHash)
    expect(compiled.manifest.indexDescriptor.indexHash).toBe(compiled.index.indexHash)
    await db.delete()
    const verified = await verifyWorldReleaseContentV4({ manifest: compiled.manifestJson,
      expectedContentHash: compiled.contentHash, index: compiled.index })
    expect(verified.readiness).toBe('ready')
    expect(verified.manifest).toEqual(compiled.manifest)
    const rebuilt = await verifyWorldReleaseContentV4({ manifest: compiled.manifestJson, expectedContentHash: compiled.contentHash })
    expect(rebuilt.readiness).toBe('rebuilt')
    expect(rebuilt.index).toEqual(compiled.index)
  })

  it('原文或权限、覆盖、依赖被修改，即使重算外层 hash 也不能冒充原来的投影', async () => {
    const { compiled } = await setup()
    const mutations = [
      (value: typeof compiled.manifest) => { value.records.characters[0].name = '篡改人物' },
      (value: typeof compiled.manifest) => { value.narrative.bundle.records[0].visibility.class = 'author-only' },
      (value: typeof compiled.manifest) => { value.narrative.coverage.eligibleSelected = [] },
      (value: typeof compiled.manifest) => { value.narrative.sources[0].text += '\r\n篡改' },
    ]
    for (const mutate of mutations) {
      const changed = structuredClone(compiled.manifest); mutate(changed)
      await expect(verifyWorldReleaseContentV4({ manifest: changed, expectedContentHash: await hashNarrativeValueV1(changed) }))
        .rejects.toThrow('release-projection')
    }
    await expect(verifyWorldReleaseContentV4({ manifest: { ...compiled.manifest, runtime: {} } })).rejects.toThrow('release-exact-keys')
    await expect(verifyWorldReleaseContentV4({ manifest: `${compiled.manifestJson}\n` })).rejects.toThrow('release-noncanonical')
  })

  it('编译在首次 await 前捕获输入；之后的外部改写不会污染冻结字节', async () => {
    const { input, compiled } = await setup()
    const pending = compileWorldReleaseContentV4(input)
    input.records.characters[0].name = '并发篡改'
    expect(await pending).toEqual(compiled)
  })

  it('私有快照不调用隐藏 toJSON；对象和规范字符串路径保留同一字节', async () => {
    const { input, compiled } = await setup()
    let invoked = false
    const hook = () => { invoked = true; return { substituted: true } }
    Object.defineProperty(input, 'toJSON', { value: hook, enumerable: false })
    Object.defineProperty(input.records.characters[0], 'toJSON', { value: hook, enumerable: false })
    expect(await compileWorldReleaseContentV4(input)).toEqual(compiled)
    const external = structuredClone(compiled.manifest)
    Object.defineProperty(external, 'toJSON', { value: hook, enumerable: false })
    const pending = verifyWorldReleaseContentV4({ manifest: external, expectedContentHash: compiled.contentHash, index: compiled.index })
    external.worldName = '调用后外部改写'
    expect((await pending).manifest).toEqual(compiled.manifest)
    expect(invoked).toBe(false)
  })

  it('原文缺失、跨 scope/Work owner、重复 UID 和未知表在编译前拒绝', async () => {
    const { input } = await setup()
    for (const mutation of [
      (value: typeof input) => { delete value.records.characters[0].name },
      (value: typeof input) => { value.records.characters[0]._worldOwnerExportId = 999 },
      (value: typeof input) => { value.records.characters[0]._workOwnerExportId = 0 },
      (value: typeof input) => { value.records.characters[1].ragDocumentId = value.records.characters[0].ragDocumentId },
      (value: typeof input) => { value.selectedTables.push('productRuntimeEvents'); value.records.productRuntimeEvents = [] },
    ]) {
      const changed = structuredClone(input); mutation(changed)
      if (changed.records.characters[0].name === undefined) {
        // Unreviewed/stale source remains explicitly unsupported, never a
        // fabricated atom. A frozen packet containing old atoms fails above.
        const result = await compileWorldReleaseContentV4(changed)
        expect(result.manifest.narrative.coverage.gaps.some(gap => gap.code === 'stale')).toBe(true)
      } else await expect(compileWorldReleaseContentV4(changed)).rejects.toThrow()
    }
  })

  it('未知配方只有显式 source-only；索引 hash 损坏不能用重建掩盖', async () => {
    const { compiled } = await setup()
    const unknown = structuredClone(compiled.manifest)
    unknown.indexDescriptor.recipeVersion = 'future-index-v99'
    await expect(verifyWorldReleaseContentV4({ manifest: unknown })).rejects.toThrow('release-recipe')
    expect(await verifyWorldReleaseContentV4({ manifest: unknown, mode: 'source-only' }))
      .toMatchObject({ index: null, readiness: 'unavailable' })
    const corrupt = structuredClone(compiled.manifest)
    corrupt.indexDescriptor.indexHash = '0'.repeat(64)
    await expect(verifyWorldReleaseContentV4({ manifest: corrupt })).rejects.toThrow('release-index-hash')
  })

})
