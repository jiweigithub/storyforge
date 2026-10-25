import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { readerQuestions, irReaderContext } from '../helpers/narrative-reader-evaluation'
import { seedGroundedClockKnowledge } from '../helpers/narrative-reader-knowledge-fixture'

describe('NW-2E · one source-grounded knowledge contrast, not a completed model comparison', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    await db.delete(); await db.open()
  })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('with explicitly public user permission, returns only the holder belief, preserves the old release and removes it under knowledge ablation', async () => {
    const setup = await seedGroundedClockKnowledge('public')
    const { family, fixture, through, originalFixture, originalRelease } = setup
    const question = readerQuestions(family).find(item => item.view === 'character')!
    const oldBytes = JSON.stringify(originalRelease)
    const original = await irReaderContext(originalFixture, question, 'ir-lexical')
    const complete = await irReaderContext(fixture, question, 'ir-lexical', through)
    const ablated = await irReaderContext(fixture, question, 'ir-no-knowledge', through)
    const epistemic = complete.documents.filter(item => item.kind === 'epistemic-event')
    expect(original.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(epistemic, JSON.stringify({ diagnostics: complete.diagnostics, holderKey: setup.holderKey,
      clocks: fixture.projection.bundle.timeContext.timelines,
      records: fixture.projection.bundle.records.filter(record => record.kind === 'epistemic-event'
        || record.kind === 'entity' && record.payload.entityType === 'world-group')
        .map(record => ({ kind: record.kind, id: record.semanticId, visibility: record.visibility, time: record.time,
          dependencies: record.dependencies, payload: record.payload })),
      gaps: fixture.projection.coverage.gaps.filter(gap => ['knowledgeLedger', 'worldGroups'].includes(gap.table)) })).toHaveLength(1)
    expect(epistemic[0].atom).toMatchObject({ modality: 'belief', value: {
      assertedValue: { kind: 'text', value: '停摆由雷击造成' }, attitude: 'believe',
    } })
    expect(epistemic[0].evidence.map(span => span.text)).toEqual(expect.arrayContaining(setup.annotation.characterEvidence.map(span => span.quote)))
    expect(ablated.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(JSON.stringify(complete.documents)).not.toContain(family.seed.truth)
    expect(JSON.stringify(complete.documents)).not.toContain('误以为')
    expect(JSON.stringify(complete.documents)).not.toContain('取下配重')
    expect(JSON.stringify(await db.worldReleases.get(originalRelease.id!))).toBe(oldBytes)
    expect(await db.storyTimelineEvents.count()).toBe(0)

    if (process.env.NW_GROUNDED_KNOWLEDGE_REPORT) {
      const paths = ['tests/helpers/narrative-reader-knowledge-fixture.ts', 'tests/helpers/narrative-reader-evaluation.ts',
        'tests/regression/R-NW-2E-grounded-knowledge.test.ts', 'tests/acceptance/narrative-world/corpus-v1.json',
        'tests/acceptance/narrative-world/reader-knowledge-annotations-20261015-v1.json',
        'src/lib/context-gateway/world-query-visibility.ts', 'src/lib/context-gateway/world-query-evaluator.ts']
      writeFileSync(process.env.NW_GROUNDED_KNOWLEDGE_REPORT, JSON.stringify({
        schema: 'storyforge.narrative-grounded-knowledge-diagnostic', version: 1,
        familyId: family.id, split: family.split, question, through, propositionPermission: setup.propositionPermission,
        sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
        original, complete, ablated,
        counts: { originalEpistemic: 0, completeEpistemic: epistemic.length, ablatedEpistemic: 0 },
        boundary: 'One synthetic development family, explicit test-author day labels, holder-only belief permission and a separate public-proposition permission control. Public user permission must not become character knowledge. Historical compiler-v1 private-proposition reads remain unsupported. Existing corpus, original release and historical model inputs unchanged. No extra event, sender or causal relation. No holdout or model-quality conclusion.',
        modelCalls: 0, independentHumanReviews: 0, accepted: false,
      }, null, 2) + '\n', { flag: 'wx' })
    }
  }, 30_000)

  it('does not infer acquisition from chapter order: unknown and before-acquisition cutoffs still hide it', async () => {
    const { family, fixture, through } = await seedGroundedClockKnowledge('public')
    const question = readerQuestions(family).find(item => item.view === 'character')!
    const unknown = await irReaderContext(fixture, question, 'ir-lexical')
    const before = await irReaderContext(fixture, question, 'ir-lexical', { ...through, value: '4' })
    expect(unknown.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(before.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
  }, 30_000)

  it('the same source time does not grant another character access to this holder belief', async () => {
    const { family, fixture, through } = await seedGroundedClockKnowledge('public')
    const question = readerQuestions(family).find(item => item.view === 'character')!
    const other = await irReaderContext(fixture, { ...question, holderId: `${family.id}:character-b` }, 'ir-lexical', through)
    expect(other.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(JSON.stringify(other.documents)).not.toContain('停摆由雷击造成')
  }, 30_000)

  it('an explicit acquired day cannot override author-only visibility', async () => {
    const setup = await seedGroundedClockKnowledge('public')
    await setup.confirm('knowledgeLedger', setup.knowledgeId, {
      narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'grounded-denial-v1' },
    })
    const question = readerQuestions(setup.family).find(item => item.view === 'character')!
    const result = await irReaderContext(await setup.freeze(), question, 'ir-lexical', setup.through)
    expect(result.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
  }, 30_000)

  it('a visible typed belief without original evidence stays insufficient at original depth', async () => {
    const setup = await seedGroundedClockKnowledge('public')
    await setup.confirm('knowledgeLedger', setup.knowledgeId, { narrativeEvidenceV1: [] })
    const question = readerQuestions(setup.family).find(item => item.view === 'character')!
    const result = await irReaderContext(await setup.freeze(), question, 'ir-lexical', setup.through)
    expect(result.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(result.diagnostics.some(reason => reason.includes('evidence-closure-unavailable'))).toBe(true)
  }, 30_000)

  it('records the historical compiler-v1 private-proposition limitation without changing its inherited permission', async () => {
    const setup = await seedGroundedClockKnowledge()
    const question = readerQuestions(setup.family).find(item => item.view === 'character')!
    const result = await irReaderContext(setup.fixture, question, 'ir-lexical', setup.through)
    const belief = setup.fixture.projection.bundle.records.find(record => record.kind === 'epistemic-event'
      && record.payload.holderRef.semanticId === setup.holderKey)!
    expect(belief.visibility.class).toBe('author-only')
    expect(result.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(JSON.stringify(result.documents)).not.toContain(setup.family.seed.truth)
  }, 30_000)
})
