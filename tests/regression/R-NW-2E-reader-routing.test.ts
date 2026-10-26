import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { authorWorldQueryV1, openAuthorWorldQueryAccessV1, queryWorldReleaseV1, closeWorldQueryAccessV1 } from '../../src/lib/context-gateway/world-query-client'
import { seedReaderFamily, readerQuestions, readerIrTextRoute, irReaderContext } from '../helpers/narrative-reader-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'

describe('NW-2E · 查询路由与已确认范围诊断，不替换冻结读者实验', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    await db.delete(); await db.open()
  })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('只有明确结构化选择和同一冻结世界标签同时成立时才消费范围词；正文词仍是过滤条件', () => {
    const family = corpus.families[0], questions = readerQuestions(family)
    for (const operation of ['entity-filter', 'arc-filter', 'chapter-cutoff']) {
      const question = questions.find(item => item.operation === operation)!
      expect(readerIrTextRoute(question, family.title)).toMatchObject({ semanticText: null, consumedWorldLabel: family.title })
      expect(readerIrTextRoute(question, '另一世界')).toMatchObject({ semanticText: question.search, consumedWorldLabel: null })
      expect(readerIrTextRoute({ ...question, entityId: null, arcId: null, throughId: null }, family.title))
        .toMatchObject({ semanticText: question.search, consumedWorldLabel: null, kinds: [] })
    }
    const body = questions.find(item => item.operation === 'body-search')!
    expect(readerIrTextRoute({ ...body, search: family.title }, family.title)).toMatchObject({ semanticText: family.title, consumedWorldLabel: null })
    const metadata = questions.find(item => item.operation === 'metadata-search')!
    expect(readerIrTextRoute(metadata, metadata.search!)).toMatchObject({ semanticText: metadata.search, consumedWorldLabel: null })
  })

  it('评测使用实际冻结范围和正式查询：截止消融有材料差异，实体不串人，未匹配正文约束不丢弃', async () => {
    const family = corpus.families[0], fixture = await seedReaderFamily(family), questions = readerQuestions(family)
    const cutoff = questions.find(item => item.operation === 'chapter-cutoff')!
    const withTime = await irReaderContext(fixture, cutoff, 'ir-lexical')
    const noTime = await irReaderContext(fixture, cutoff, 'ir-no-time')
    expect(withTime.documents).toHaveLength(1)
    expect(withTime.documents[0].evidence.some(span => span.text === family.sources[0].text)).toBe(true)
    expect(noTime.documents).toHaveLength(4)
    expect(withTime.provenance).toMatchObject({ frozenWorldName: family.title,
      route: { semanticText: null, kinds: ['disclosure'], consumedWorldLabel: family.title } })
    expect(noTime.provenance).toMatchObject({ query: { text: null, kinds: ['disclosure'], time: null } })
    const entity = questions.find(item => item.operation === 'entity-filter')!
    expect((await irReaderContext(fixture, entity, 'ir-lexical')).documents.map(item => item.id)).toEqual([fixture.semanticFor(entity.entityId!)])
    const missing = await irReaderContext(fixture, { ...entity, search: '正文并无此约束词' }, 'ir-lexical')
    expect(missing.documents).toEqual([])
    expect(missing.provenance).toMatchObject({ query: { text: '正文并无此约束词' }, route: { consumedWorldLabel: null } })
    const character = questions.find(item => item.view === 'character')!
    const knowledge = await irReaderContext(fixture, character, 'ir-lexical')
    expect(knowledge.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(JSON.stringify(knowledge.documents)).not.toContain(family.seed.truth)
  }, 30_000)

  it('同一实际世界的结构化章节截止和实体选择独立生效；文本是额外 AND 条件', async () => {
    const family = corpus.families[0], fixture = await seedReaderFamily(family)
    const access = await openAuthorWorldQueryAccessV1({ scope: fixture.scope, localReleaseRecordId: fixture.v4Release.id!,
      view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
    try {
      const question = readerQuestions(family).find(item => item.operation === 'chapter-cutoff')!
      const unitKey = [...fixture.uidToSource].find(([, logical]) => logical === question.throughId)![0]
      const sequence = fixture.projection.bundle.timeContext.sequences.find(item => item.units.some(unit => unit.unitKey === unitKey))!
      const query = { ...authorWorldQueryV1(access), evidenceDepth: 'original' as const,
        kinds: ['disclosure' as const], time: { axis: 'narrated' as const, sequenceKey: sequence.sequenceKey, throughUnitKey: unitKey, audienceKey: null },
        budget: { maxTokens: 100000, maxRecords: 12, maxEvidenceBytes: 32768 } }
      const temporal = await queryWorldReleaseV1(access, query)
      expect(temporal.status).toBe('matched')
      expect(temporal.items).toHaveLength(1)
      expect(temporal.items[0].evidence.some(span => span.text === family.sources[0].text)).toBe(true)
      expect(temporal.items.every(item => item.match.time === 'matched')).toBe(true)
      const later = family.sources.filter(source => source.kind === 'chapter' && source.id !== question.throughId)
      for (const source of later) expect(JSON.stringify(temporal.items)).not.toContain(source.text)

      const withoutTime = await queryWorldReleaseV1(access, { ...query, time: null })
      expect(withoutTime.items.length).toBeGreaterThan(temporal.items.length)
      const scopedText = await queryWorldReleaseV1(access, { ...query, text: question.search })
      // Do not freeze today's empty result as desired behavior. Its measured
      // count is diagnostic; the contract is the intersection of filters.
      expect(scopedText.items.every(item => temporal.items.some(allowed => allowed.semanticId === item.semanticId))).toBe(true)

      const a = fixture.semanticFor(`${family.id}:character-a`)!, b = fixture.semanticFor(`${family.id}:character-b`)!
      const entity = await queryWorldReleaseV1(access, { ...query, kinds: ['entity'], time: null, entityKeys: [a] })
      expect(entity.items.map(item => item.semanticId)).toEqual([a])
      expect(JSON.stringify(entity.items)).not.toContain(b)

      if (process.env.NW_READER_ROUTING_REPORT) {
        const paths = ['tests/regression/R-NW-2E-reader-routing.test.ts', 'tests/helpers/narrative-reader-evaluation.ts',
          'src/lib/context-gateway/world-query-evaluator.ts', 'src/lib/context-gateway/world-query-time.ts',
          'src/lib/world-engine/semantic-registry-v4.json', 'tests/acceptance/narrative-world/corpus-v1.json']
        writeFileSync(process.env.NW_READER_ROUTING_REPORT, JSON.stringify({ schema: 'storyforge.narrative-reader-routing-diagnostic', version: 1,
          familyId: family.id, questionId: question.id, releaseHash: access.reference.releaseHash,
          sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
          counts: { narratedCutoffOnly: temporal.items.length, noCutoff: withoutTime.items.length,
            sameCutoffPlusSceneTitleText: scopedText.items.length, explicitEntityOnly: entity.items.length },
          receipts: { narratedCutoffOnly: temporal, noCutoff: withoutTime, sameCutoffPlusSceneTitleText: scopedText, explicitEntityOnly: entity },
          boundary: 'Synthetic fixture and actual registered deterministic queries. No model calls, new story facts, human acceptance or replacement of the v2 frozen comparison.',
          conclusion: 'Scene-title text is an additional filter over authorized semantic material; source-title search is not interchangeable with semantic text search. Structured time and identity selection work separately.',
          modelCalls: 0, independentHumanReviews: 0, semanticQualityAccepted: false }, null, 2) + '\n', { flag: 'wx' })
      }
    } finally { await closeWorldQueryAccessV1(access) }
  }, 30_000)
})
