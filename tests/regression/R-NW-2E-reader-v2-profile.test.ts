import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { db } from '../../src/lib/db/schema'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { verifyReaderEventAnnotation, seedReaderCompilerV2Profile, collectReaderCompilerV2Family } from '../helpers/narrative-reader-v2-profile'
import { irReaderContext, readerQuestions, READER_CONDITIONS } from '../helpers/narrative-reader-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import annotations from '../acceptance/narrative-world/reader-event-knowledge-annotations-20261015-v1.json'
import manifest from '../acceptance/narrative-world/manifest-v1.json'

describe('NW-2E compiler-v2 reader profile with explicit source-grounded acquisition boundaries', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    await db.delete(); await db.open()
  })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('checks exact original spans without consulting answer or edit gold', () => {
    for (const annotation of annotations.records) {
      const family = structuredClone(corpus.families.find(item => item.id === annotation.familyId)!)
      Object.defineProperty(family, 'queries', { get() { throw Error('Read question or answer gold') } })
      Object.defineProperty(family, 'edits', { get() { throw Error('Read edit gold') } })
      expect(() => verifyReaderEventAnnotation(family, annotation)).not.toThrow()
      for (const key of ['quote', 'sourceHash', 'spanHash'] as const) {
        const changed = structuredClone(annotation); changed.eventEvidence[key] = 'forged'
        expect(() => verifyReaderEventAnnotation(family, changed)).toThrow('original bytes')
      }
    }
  })

  it.each(annotations.records)('$familyId: an explicit event origin permits its own belief, never dates or private truth', async annotation => {
    const family = corpus.families.find(item => item.id === annotation.familyId)!
    const { fixture, knowledgeThrough, declaration } = await seedReaderCompilerV2Profile(family)
    expect(declaration).toBe('single-event-origin')
    expect(knowledgeThrough?.kind).toBe('event-anchor')
    if (knowledgeThrough?.kind !== 'event-anchor') throw Error('Expected explicit event cutoff')
    const question = readerQuestions(family).find(item => item.view === 'character')!
    const complete = await irReaderContext(fixture, question, 'ir-lexical', knowledgeThrough)
    const knowledge = complete.documents.filter(item => item.kind === 'epistemic-event')
    expect(knowledge).toHaveLength(1)
    expect(knowledge[0].atom).toMatchObject({ value: { projectionVersion: 2, assertedValue: { value: family.seed.belief } } })
    expect(knowledge[0].evidence.map(item => item.text)).toEqual(expect.arrayContaining(annotation.characterEvidence.map(item => item.quote)))
    for (const text of [family.seed.truth, '误以为', '过时消息', '被换入']) expect(JSON.stringify(complete.documents)).not.toContain(text)
    const removed = await irReaderContext(fixture, question, 'ir-no-knowledge', knowledgeThrough)
    expect(removed.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(JSON.stringify(removed.documents)).not.toContain(family.seed.belief)
    for (const cutoff of [null, { ...knowledgeThrough, side: 'before' as const }]) {
      const result = await irReaderContext(fixture, question, 'ir-lexical', cutoff)
      expect(result.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    }
    const context = fixture.projection.bundle.timeContext
    expect(context.anchors).toHaveLength(1); expect(context.anchors[0].value).toBe('0')
    expect(context.mappings).toEqual([]); expect(context.before).toEqual([])
    expect(context.timelines[0].calendar).toBe('single-event-reference-not-a-story-calendar')
    const events = await db.storyTimelineEvents.toArray()
    expect(events).toHaveLength(1); expect(events[0].description).toBe(annotation.eventEvidence.quote)
    const truth = fixture.projection.bundle.records.find(item => item.kind === 'assertion' && item.payload.value.kind === 'text'
      && item.payload.value.value === family.seed.truth)!
    expect(truth.visibility.class).toBe('author-only')
  }, 30_000)

  it('retains the original clock days and adds no event or coordinate for seven uncertain families', async () => {
    const clockFamily = corpus.families.find(item => item.id === 'clock-retelling')!
    const clock = await seedReaderCompilerV2Profile(clockFamily)
    expect(clock.declaration).toBe('original-day-labels'); expect(clock.knowledgeThrough).toMatchObject({ kind: 'tick', value: '6' })
    expect(await db.storyTimelineEvents.count()).toBe(0)
    for (const id of Object.keys(annotations.unchangedUnknownFamilies)) {
      await db.delete(); await db.open()
      const family = corpus.families.find(item => item.id === id)!, current = await seedReaderCompilerV2Profile(family)
      expect(current.declaration).toBe('unknown'); expect(current.knowledgeThrough).toBeNull()
      expect(await db.storyTimelineEvents.count()).toBe(0); expect(await db.worldGroups.count()).toBe(0)
      const result = await irReaderContext(current.fixture, readerQuestions(family).find(item => item.view === 'character')!, 'ir-lexical')
      expect(result.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    }
  }, 120_000)

  it('collects a separate complete matrix without replacing original questions, sources or historical materials', async () => {
    const paths = [...new Set([...manifest.sourceFingerprintPaths, 'tests/acceptance/narrative-world/corpus-v1.json',
      'tests/acceptance/narrative-world/reader-event-knowledge-annotations-20261015-v1.json',
      'tests/acceptance/narrative-world/reader-knowledge-annotations-20261015-v1.json',
      'tests/acceptance/narrative-world/reader-protocol-20261015-v3.json',
      'tests/helpers/narrative-reader-v2-profile.ts', 'tests/helpers/narrative-reader-knowledge-fixture.ts',
      'tests/regression/R-NW-2E-reader-v2-profile.test.ts'])].sort()
    const fingerprint = () => Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]))
    const sourceHashes = fingerprint(), families = process.env.NW_READER_V2_INPUTS ? corpus.families : corpus.families.slice(0, 1)
    const collected = []
    for (const family of families) {
      await db.delete(); await db.open()
      const result = await collectReaderCompilerV2Family(family), questions = readerQuestions(family)
      expect(result.cases).toHaveLength(10 * READER_CONDITIONS.length)
      for (const version of [3, 4] as const) {
        const snapshot = result.releaseSnapshots[version === 3 ? 'v3' : 'v4']
        expect((await verifyWorldReleaseRecordV1(JSON.parse(JSON.stringify(snapshot)))).version).toBe(version)
        for (const item of result.cases.filter(item => version === 3 ? item.condition === 'v3-provider' : item.condition.startsWith('ir-'))) {
          const provenance = item.context.provenance as { releaseHash?: string } | null
          if (provenance?.releaseHash) expect(provenance.releaseHash).toBe(snapshot.contentHash)
        }
      }
      for (const item of result.cases) {
        expect(item.question).toEqual(questions.find(question => question.id === item.question.id))
        if (item.condition === 'ir-no-evidence') expect(item.context.documents.every(doc => doc.text === null && doc.evidence.length === 0)).toBe(true)
        if (item.condition === 'ir-no-knowledge') expect(item.context.documents.every(doc => doc.kind !== 'epistemic-event')).toBe(true)
        if (item.question.view === 'character' && item.condition.startsWith('ir-')) expect(JSON.stringify(item.context.documents)).not.toContain(family.seed.truth)
      }
      collected.push(result)
    }
    expect(fingerprint()).toEqual(sourceHashes)
    if (process.env.NW_READER_V2_INPUTS) writeFileSync(process.env.NW_READER_V2_INPUTS, JSON.stringify({
      schema: 'storyforge.narrative-reader-inputs', version: 1, profile: 'compiler-v2-source-grounded-acquisition-v1',
      boundary: 'Unchanged synthetic original corpus and questions; explicit test-author source spans and per-event coordinate origins. Seven acquisition times remain unknown. Not automatic extraction, a fresh unseen holdout or independent author acceptance.',
      conditions: READER_CONDITIONS, questionCount: 120, inputCount: collected.flatMap(item => item.cases).length,
      independentHumanReviews: 0, sourceHashes, families: collected }, null, 2) + '\n', { flag: 'wx' })
  }, 120_000)
})
