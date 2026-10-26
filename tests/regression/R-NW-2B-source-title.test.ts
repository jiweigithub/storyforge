import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { authorWorldQueryV1, openAuthorWorldQueryAccessV1, openProductPreparationWorldQueryV1, bindWorldQueryResourcesV1,
  queryWorldReleaseV1, closeWorldQueryAccessV1 } from '../../src/lib/context-gateway/world-query-client'
import { createWorldQueryEvaluatorV1 } from '../../src/lib/context-gateway/world-query-evaluator'
import { frozenAuthorSourceTitlesV1 } from '../../src/lib/context-gateway/world-query-source-titles'
import { assertContextResourceDescriptorV1 } from '../../src/lib/context-gateway/contracts'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import type { WorldQueryGrantV1 } from '../../src/lib/types/world-query'
import { irReaderContext, readerQuestions, seedReaderFamily } from '../helpers/narrative-reader-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import readerProtocol from '../acceptance/narrative-world/reader-protocol-20261015-v3.json'
import { readerMessages } from '../../scripts/narrative-reader-contract.mjs'

describe('NW-2B · frozen author source titles, not semantic evidence', () => {
  const observations: unknown[] = []
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    await db.delete(); await db.open()
  })
  afterEach(() => { db.close(); vi.useRealTimers() })
  afterAll(() => {
    if (!process.env.NW_SOURCE_TITLE_REPORT) return
    const paths = ['src/lib/context-gateway/world-query-evaluator.ts',
      'src/lib/context-gateway/world-release-query-provider.ts',
      'src/lib/context-gateway/world-query-source-titles.ts',
      'src/lib/context-gateway/world-query-contract.ts',
      'tests/helpers/narrative-reader-evaluation.ts',
      'tests/regression/R-NW-2B-source-title.test.ts', 'tests/acceptance/narrative-world/corpus-v1.json']
    writeFileSync(process.env.NW_SOURCE_TITLE_REPORT, JSON.stringify({
      schema: 'storyforge.narrative-source-title-diagnostic', version: 1,
      boundary: 'Original frozen corpus requests through the registered provider. No gold routing, model calls, author review or semantic acceptance.',
      sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
      observations, modelCalls: 0, independentHumanReviews: 0, accepted: false,
    }, null, 2) + '\n', { flag: 'wx' })
  })

  for (const family of corpus.families) it(`${family.id}: exact stored source title retrieves its authorized original`, async () => {
    const fixture = await seedReaderFamily(family)
    expect(fixture.projection.bundle.records.filter(record => record.kind === 'disclosure')).toHaveLength(4)
    const question = readerQuestions(family).find(item => item.operation === 'metadata-search')!
    const context = await irReaderContext(fixture, question, 'ir-lexical')
    observations.push({ familyId: family.id, projectedRecords: fixture.projection.bundle.records.length, question, context })
    expect(context.documents).toHaveLength(1)
    expect(context.documents[0]).toHaveProperty('authorSource.title', question.search)
    expect(context.documents[0].title).toBe(`已确认揭示｜封存来源：${question.search}`)
    const material = readerMessages({ question, context }, readerProtocol)
    expect(JSON.parse(material.messages[1].content).documents[0].title).toBe(context.documents[0].title)
    expect(material.messages[1].content).not.toContain('sourceResourceKey')
    expect(context.provenance).toMatchObject({ query: { text: question.search } })
    expect(context.documents[0].evidence.some(span => span.sourceId === `${family.id}:chapter-1`
      && span.text === family.sources.find(source => source.id === `${family.id}:chapter-1`)!.text)).toBe(true)
  }, 30_000)

  async function setup() {
    const fixture = await seedReaderFamily(corpus.families[0])
    const verified = await verifyWorldReleaseRecordV1(fixture.v4Release)
    if (verified.version !== 4 || !verified.index) throw Error('Expected verified v4 index')
    const access = await openAuthorWorldQueryAccessV1({ scope: fixture.scope, localReleaseRecordId: fixture.v4Release.id!,
      view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
    return { fixture, verified, access, query: authorWorldQueryV1(access) }
  }

  it('carries frozen source metadata into real provider reads without changing semantic identity or exact original bytes', async () => {
    const { fixture, access, query } = await setup()
    const preparation = await openProductPreparationWorldQueryV1({ scope: fixture.scope,
      localReleaseRecordId: fixture.v4Release.id!, productType: 'avg' })
    try {
      const title = corpus.families[0].sources[0].title
      const result = await queryWorldReleaseV1(access, { ...query, text: title, kinds: ['disclosure'] })
      const record = fixture.projection.bundle.records.find(row => row.semanticId === result.items[0].semanticId)!
      const authorSource = { version: 1, sourceResourceKey: record.provenance.sourceResourceKey,
        sourceRevision: record.provenance.sourceRevision, title }
      expect(result.items[0]).toHaveProperty('authorSource', authorSource)
      const provider = await bindWorldQueryResourcesV1(access)
      const found = await provider.queryWorldMetadata!({ scope: access.scope, query: { ...query, text: title } })
      const descriptor = found.descriptors[0]
      expect(descriptor).toHaveProperty('worldSemantic.authorSource', authorSource)
      const source = CONTEXT_SOURCES.find(row => row.key === 'worldRelease')!
      expect(() => assertContextResourceDescriptorV1({ descriptor, source })).not.toThrow()
      for (const patch of [{ title: '' }, { version: 99 }, { sourceResourceKey: '' }, { sourceRevision: '' }, { body: '夹带正文' }]) {
        const invalid = structuredClone(descriptor)
        Object.assign(invalid.worldSemantic!.authorSource!, patch)
        expect(() => assertContextResourceDescriptorV1({ descriptor: invalid, source })).toThrow('作者来源目录合同')
      }
      const product = await bindWorldQueryResourcesV1(preparation)
      const productDescriptor = (await product.listMetadata({ scope: preparation.scope, limit: 100 })).items
        .find(row => row.resourceKey === descriptor.resourceKey)!
      expect(productDescriptor.contentHash).toBe(descriptor.contentHash)
      expect(productDescriptor).not.toHaveProperty('worldSemantic.authorSource')
      for (const depth of ['index', 'summary', 'focused', 'full'] as const) {
        const read = await provider.read({ scope: access.scope, resourceKey: descriptor.resourceKey, depth, maxTokens: 10000 })
        expect(read.content).toContain(title)
        expect(read.descriptor.contentHash).toBe(descriptor.contentHash)
      }
      const span = await provider.readOriginal!({ scope: access.scope, resourceKey: descriptor.resourceKey,
        sourceRef: descriptor.sourceRefs[0], maxTokens: 10000 })
      expect(span.content).toBe(corpus.families[0].sources[0].text)
      expect(span.content).not.toContain(title)
      const narrowed = await bindWorldQueryResourcesV1(access, { allowedResourceKeys: [], allowedKinds: ['chapter'], maxTokens: 10000 })
      await expect(narrowed.read({ scope: access.scope, resourceKey: descriptor.resourceKey,
        depth: 'full', maxTokens: 10000 })).rejects.toThrow()
    } finally { await closeWorldQueryAccessV1(access); await closeWorldQueryAccessV1(preparation) }
  })

  it('counts the complete author source metadata in the query budget', async () => {
    const { fixture, verified, access, query } = await setup()
    try {
      const actor = verified.manifest.narrative.bundle.records.find(record => record.semanticId === fixture.semanticFor('ferry-names:character-a'))!
      const evaluate = createWorldQueryEvaluatorV1({ reference: access.reference, projection: verified.manifest.narrative,
        index: verified.index!, authorSourceTitles: new Map([[actor.provenance.sourceResourceKey, '长目录标题'.repeat(3000)]]) })
      const grant: WorldQueryGrantV1 = { version: 1, releaseReferenceHash: access.reference.referenceHash, sourcePlanHash: null,
        purpose: 'author-review', views: ['canon'], perspective: { kind: 'author' }, audienceKeys: ['author'],
        allowedSemanticIds: [actor.semanticId], branchKey: 'canon', knowledgeThrough: null, disclosedThrough: null,
        maxTokens: 100000, maxRecords: 500, maxEvidenceBytes: 4 * 1024 * 1024, policyRevision: 'source-budget-test-v1' }
      const result = await evaluate({ ...query, budget: { ...query.budget, maxTokens: 2000 } }, grant)
      expect(result.items).toEqual([])
      expect(result.diagnostics.some(row => row.reason === 'complete-item-exceeds-remaining-budget')).toBe(true)
    } finally { await closeWorldQueryAccessV1(access) }
  })

  it('uses frozen title bytes after draft rename, preserves release bytes and combines title with other filters', async () => {
    const { fixture, verified, access, query } = await setup()
    try {
      const original = fixture.v4Release.manifestJson, title = corpus.families[0].sources[0].title
      const before = await queryWorldReleaseV1(access, { ...query, text: title, kinds: ['disclosure'] })
      expect(before.items).toHaveLength(1)
      await db.chapters.update(fixture.localIds.get('ferry-names:chapter-1')!, { title: '仅在活动草稿里改名的章节' })
      expect(await queryWorldReleaseV1(access, { ...query, text: title, kinds: ['disclosure'] })).toEqual(before)
      expect((await queryWorldReleaseV1(access, { ...query, text: '仅在活动草稿里改名的章节' })).items).toEqual([])
      expect((await queryWorldReleaseV1(access, { ...query, text: title, kinds: ['entity'] })).items).toEqual([])
      expect((await queryWorldReleaseV1(access, { ...query, text: title,
        entityKeys: [fixture.semanticFor('ferry-names:character-a')!] })).items).toEqual([])
      expect((await db.worldReleases.get(fixture.v4Release.id!))!.manifestJson).toBe(original)
      expect(verified.manifest.indexDescriptor.indexHash).toBe(access.reference.indexIdentity.indexHash)
      // A directory label is not promoted to evidence in any depth.
      expect(before.items[0].evidence.every(span => span.text === null)).toBe(true)
    } finally { await closeWorldQueryAccessV1(access) }
  })

  it('does not disclose private directory labels via public atoms, purpose changes, denied selections or evidence', async () => {
    const { fixture, verified, access, query } = await setup()
    try {
      const actor = verified.manifest.narrative.bundle.records.find(record => record.semanticId === fixture.semanticFor('ferry-names:character-a'))!
      const canary = '作者目录中未向角色公布的代号'
      const sourceTitles = new Map([[actor.provenance.sourceResourceKey, canary]])
      const evaluate = createWorldQueryEvaluatorV1({ reference: access.reference, projection: verified.manifest.narrative,
        index: verified.index!, authorSourceTitles: sourceTitles })
      const grant: WorldQueryGrantV1 = { version: 1, releaseReferenceHash: access.reference.referenceHash, sourcePlanHash: null,
        purpose: 'author-review', views: ['canon'], perspective: { kind: 'author' }, audienceKeys: ['author'],
        allowedSemanticIds: null, branchKey: 'canon', knowledgeThrough: null, disclosedThrough: null,
        maxTokens: 100000, maxRecords: 500, maxEvidenceBytes: 4 * 1024 * 1024, policyRevision: 'source-title-test-v1' }
      const author = await evaluate({ ...query, text: canary }, grant)
      expect(author.items.map(item => item.semanticId)).toEqual([actor.semanticId])
      expect(JSON.stringify(author.items[0].evidence)).not.toContain(canary)
      expect(JSON.stringify(author.items[0].atom)).not.toContain(canary)
      expect((await evaluate({ ...query, text: canary }, { ...grant, allowedSemanticIds: [] })).items).toEqual([])
      for (const purpose of ['product-preparation', 'product-production', 'product-runtime'] as const) {
        const sourcePlanHash = purpose === 'product-preparation' ? null : 'c'.repeat(64)
        const scoped = { ...grant, purpose, sourcePlanHash, allowedSemanticIds: [actor.semanticId] }
        expect((await evaluate({ ...query, text: canary, sourcePlanHash }, scoped)).items).toEqual([])
        const listing = await evaluate({ ...query, text: null, sourcePlanHash }, scoped)
        expect(listing.items.some(item => item.semanticId === actor.semanticId)).toBe(true)
        expect(JSON.stringify(listing)).not.toContain(canary)
      }
      for (const perspective of [{ kind: 'reader' as const }, { kind: 'character' as const, characterKey: actor.semanticId }]) {
        const sequence = verified.manifest.narrative.bundle.timeContext.sequences[0]
        const view = perspective.kind === 'character' ? 'character' as const : 'canon' as const
        const scoped = { ...grant, perspective, views: [view], audienceKeys: [perspective.kind],
          disclosedThrough: perspective.kind === 'reader' ? { sequenceKey: sequence.sequenceKey,
            unitKey: sequence.units.at(-1)!.unitKey, audienceKey: 'reader' } : null,
          knowledgeThrough: perspective.kind === 'character' ? { kind: 'unknown' as const, label: null } : null }
        expect((await evaluate({ ...query, view, perspective, text: canary }, scoped)).items).toEqual([])
        const listing = await evaluate({ ...query, view, perspective, text: null }, scoped)
        expect(listing.items.some(item => item.semanticId === actor.semanticId)).toBe(true)
        expect(JSON.stringify(listing)).not.toContain(canary)
      }
      sourceTitles.set(actor.provenance.sourceResourceKey, '外部修改不能改变已建立查询器')
      expect(await evaluate({ ...query, text: canary }, grant)).toEqual(author)
    } finally { await closeWorldQueryAccessV1(access) }
  })

  it('catalog interpretation admits only registered frozen origins and explicit labels, without fabricating evidence or titles', async () => {
    const { verified, access } = await setup()
    try {
      const manifest = structuredClone(verified.manifest), chapter = manifest.records.chapters[0]
      const titles = frozenAuthorSourceTitlesV1(manifest)
      const identity = `chapter:${chapter.ragDocumentId}`
      expect(titles.get(identity)).toBe(chapter.title)
      delete chapter.title
      chapter.summary = '摘要不应自动成为目录标题'
      expect(frozenAuthorSourceTitlesV1(manifest).has(identity)).toBe(false)
      chapter.title = '目录标签与原文证据分离'
      manifest.records.chapters.push({ ...chapter, ragDocumentId: 'not-a-projected-origin', title: '未投影目录项' })
      expect([...frozenAuthorSourceTitlesV1(manifest).values()]).not.toContain('未投影目录项')
      manifest.records.chapters.push({ ...chapter })
      expect(() => frozenAuthorSourceTitlesV1(manifest)).toThrow('source-title')
    } finally { await closeWorldQueryAccessV1(access) }
  })

  it('invalidates a cursor carrying the previous lexical interpretation', async () => {
    const { access, query } = await setup()
    try {
      const paged = { ...query, budget: { ...query.budget, maxRecords: 1 } }
      const first = await queryWorldReleaseV1(access, paged)
      expect(first.nextCursor).not.toBeNull()
      const old = JSON.parse(decodeURIComponent(first.nextCursor!))
      for (const version of ['authorized-lexical-scalar-v1', 'authorized-lexical-source-title-v2', 'authorized-lexical-author-source-v3']) {
        old.sortVersion = version
        await expect(queryWorldReleaseV1(access, { ...paged, cursor: encodeURIComponent(JSON.stringify(old)) })).rejects.toThrow('cursor')
      }
      expect((await queryWorldReleaseV1(access, { ...paged, cursor: first.nextCursor })).items).toHaveLength(1)
    } finally { await closeWorldQueryAccessV1(access) }
  })
})
