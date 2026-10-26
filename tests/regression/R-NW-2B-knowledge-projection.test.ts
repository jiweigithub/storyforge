import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { seedGroundedClockKnowledge } from '../helpers/narrative-reader-knowledge-fixture'
import { irReaderContext, readerQuestions } from '../helpers/narrative-reader-evaluation'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { captureWorldReleaseInputV4 } from '../../src/lib/world-engine/narrative-release-capture'
import { compileWorldReleaseContentV4, verifyWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { compileNarrativeReleaseIncrementalV1 } from '../../src/lib/world-engine/narrative-incremental'
import { hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { authorWorldQueryV1, bindWorldQueryResourcesV1, closeWorldQueryAccessV1, openAuthorWorldQueryAccessV1,
  queryWorldReleaseV1 } from '../../src/lib/context-gateway/world-query-client'
import { createNarrativeCompilationTaskV1, continueNarrativeCompilationTaskV1,
  sealNarrativeCompilationTaskV1 } from '../../src/lib/world-engine/narrative-compilation-task'

describe('NW-2B · versioned independent knowledge, never authority over private Canon', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    await db.delete(); await db.open()
  })
  afterEach(() => { db.close(); vi.useRealTimers() })

  async function current(setup: Awaited<ReturnType<typeof seedGroundedClockKnowledge>>) {
    const revision = await createWorldRevision({ scope: setup.fixture.scope, formatVersion: 4,
      includeWorkSources: true, label: '独立认知编译器 v2' })
    const release = await publishWorldRevision(revision.id!)
    const verified = await verifyWorldReleaseRecordV1(release)
    if (verified.version !== 4) throw Error('Expected v4')
    expect(verified.manifest.compilerVersion).toBe('narrative-domain-v2')
    return { ...setup.fixture, v4Release: release, projection: verified.manifest.narrative }
  }
  const questionFor = (setup: Awaited<ReturnType<typeof seedGroundedClockKnowledge>>) =>
    readerQuestions(setup.family).find(question => question.view === 'character')!

  it('new seals return authorized false belief with exact spans; old v1 bytes and private truth remain unchanged', async () => {
    const setup = await seedGroundedClockKnowledge(), question = questionFor(setup)
    const old = setup.fixture.v4Release
    const legacy = await irReaderContext(setup.fixture, question, 'ir-lexical', setup.through)
    expect(legacy.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    const fixture = await current(setup)
    const complete = await irReaderContext(fixture, question, 'ir-lexical', setup.through)
    const ablated = await irReaderContext(fixture, question, 'ir-no-knowledge', setup.through)
    const knowledge = complete.documents.filter(item => item.kind === 'epistemic-event')
    expect(knowledge).toHaveLength(1)
    expect(knowledge[0].atom).toMatchObject({ modality: 'belief', value: { projectionVersion: 2,
      holderKey: setup.holderKey, assertedValue: { kind: 'text', value: '停摆由雷击造成' }, attitude: 'believe' } })
    expect(knowledge[0].atom).not.toHaveProperty('value.subjectKey')
    expect(knowledge[0].atom).not.toHaveProperty('value.predicateKey')
    expect(knowledge[0].evidence.map(span => span.text)).toEqual(expect.arrayContaining(setup.annotation.characterEvidence.map(span => span.quote)))
    expect(ablated.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    const belief = fixture.projection.bundle.records.find(record => record.kind === 'epistemic-event'
      && record.payload.holderRef.semanticId === setup.holderKey)!
    expect(belief.visibility.class).toBe('restricted')
    if (belief.kind !== 'epistemic-event') throw Error('Expected knowledge')
    const proposition = fixture.projection.bundle.records.find(record => record.semanticId === belief.payload.propositionRef.semanticId)!
    expect(proposition.visibility.class).toBe('author-only')
    for (const secret of [setup.family.seed.truth, '误以为', '取下配重', proposition.semanticId]) {
      expect(JSON.stringify(complete.documents)).not.toContain(secret)
    }
    expect(await db.worldReleases.get(old.id!)).toEqual(old)
    const verifiedOld = await verifyWorldReleaseRecordV1(old)
    if (verifiedOld.version !== 4) throw Error('Expected old v4')
    expect(verifiedOld.manifest.compilerVersion).toBe('narrative-domain-v1')
    expect((await irReaderContext(setup.fixture, question, 'ir-lexical', setup.through)).documents).toEqual(legacy.documents)
    if (process.env.NW_KNOWLEDGE_V2_REPORT) {
      const paths = ['src/lib/types/narrative-release.ts', 'src/lib/types/world-query.ts',
        'src/lib/world-engine/narrative-domain-projection.ts', 'src/lib/world-engine/narrative-release-v4.ts',
        'src/lib/world-engine/narrative-release-capture.ts', 'src/lib/world-engine/releases.ts',
        'src/lib/world-engine/narrative-compilation-task.ts', 'src/lib/world-engine/narrative-derivation.ts',
        'src/lib/context-gateway/world-query-visibility.ts', 'src/lib/context-gateway/world-query-evaluator.ts',
        'src/lib/context-gateway/world-release-query-provider.ts', 'tests/helpers/narrative-reader-evaluation.ts',
        'tests/helpers/narrative-reader-knowledge-fixture.ts', 'tests/regression/R-NW-2B-knowledge-projection.test.ts',
        'tests/acceptance/narrative-world/corpus-v1.json', 'tests/acceptance/narrative-world/reader-knowledge-annotations-20261015-v1.json']
      writeFileSync(process.env.NW_KNOWLEDGE_V2_REPORT, JSON.stringify({
        schema: 'storyforge.narrative-independent-knowledge-diagnostic', version: 1,
        sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
        familyId: setup.family.id, split: setup.family.split, question, knowledgeThrough: setup.through,
        originalCompiler: 'narrative-domain-v1', currentCompiler: 'narrative-domain-v2',
        canonPermission: proposition.visibility, beliefPermission: belief.visibility,
        legacy, complete, ablated, counts: { legacyEpistemic: 0, currentEpistemic: 1, ablatedEpistemic: 0 },
        oldReleaseUnchanged: true, originalQuoteHashesVerified: true,
        boundary: 'One pre-existing source-grounded synthetic development family. Same source, annotation and private Canon; no invented time, public-permission workaround or new event. Compiler-v2 engineered projection, not a full reader matrix, real-model or author acceptance.',
        modelCalls: 0, independentHumanReviews: 0, accepted: false,
      }, null, 2) + '\n', { flag: 'wx' })
    }
  }, 30_000)

  it('keeps time, holder and explicit author-only permission independent of the Canon reference change', async () => {
    const setup = await seedGroundedClockKnowledge(), question = questionFor(setup), fixture = await current(setup)
    for (const cutoff of [null, { ...setup.through, value: '4' }]) {
      const result = await irReaderContext(fixture, question, 'ir-lexical', cutoff)
      expect(result.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    }
    const other = await irReaderContext(fixture, { ...question, holderId: `${setup.family.id}:character-b` }, 'ir-lexical', setup.through)
    expect(JSON.stringify(other.documents)).not.toContain('停摆由雷击造成')
    await setup.confirm('knowledgeLedger', setup.knowledgeId, {
      narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'v2-explicit-denial' } })
    expect((await irReaderContext(await current(setup), question, 'ir-lexical', setup.through)).documents
      .some(item => item.kind === 'epistemic-event')).toBe(false)
  }, 30_000)

  it('does not recover an entire narrator statement when explicit original spans are absent', async () => {
    const setup = await seedGroundedClockKnowledge()
    await setup.confirm('knowledgeLedger', setup.knowledgeId, { narrativeEvidenceV1: [] })
    const fixture = await current(setup)
    const access = await openAuthorWorldQueryAccessV1({ scope: fixture.scope, localReleaseRecordId: fixture.v4Release.id!,
      view: 'character', perspective: { kind: 'character', characterKey: setup.holderKey }, knowledgeThrough: setup.through, disclosedThrough: null })
    try {
      const query = { ...authorWorldQueryV1(access), kinds: ['epistemic-event' as const] }
      const atomic = await queryWorldReleaseV1(access, { ...query, evidenceDepth: 'atomic' })
      expect(atomic.items).toHaveLength(1)
      expect(atomic.items[0].originalAvailable).toBe(false)
      const belief = fixture.projection.bundle.records.find(record => record.semanticId === atomic.items[0].semanticId)!
      expect(atomic.items[0].evidence.every(span => span.sourceResourceKey !== belief.provenance.sourceResourceKey)).toBe(true)
      const original = await queryWorldReleaseV1(access, { ...query, evidenceDepth: 'original' })
      expect(original.items).toEqual([])
      expect(original.status).toBe('insufficient')
      expect(JSON.stringify(atomic)).not.toContain('误以为')
      expect((await queryWorldReleaseV1(access, { ...query, text: '误以为' })).items).toEqual([])
    } finally { await closeWorldQueryAccessV1(access) }
  }, 30_000)

  it.each(['explicit-dependency', 'evidence-source'] as const)('keeps private %s as a real permission dependency', async mode => {
    const setup = await seedGroundedClockKnowledge()
    const fact = (await db.temporalFacts.get(setup.fixture.factIds.get('confirmed')!))!
    const source = { factId: fact.id!, sourceUid: (fact as typeof fact & { ragDocumentId: string }).ragDocumentId }
    if (mode === 'explicit-dependency') await setup.confirm('knowledgeLedger', setup.knowledgeId, {
      narrativeDependenciesV1: [{ target: { kind: 'assertion', source, subKey: 'root' }, role: 'requires',
        evidenceKeys: [setup.annotations.narrativeEvidenceV1![0].evidenceKey] }],
    })
    else {
      const quote = String(fact.value), hash = await hashNarrativeBytesV1(quote)
      await setup.confirm('knowledgeLedger', setup.knowledgeId, {
        narrativeEvidenceV1: [...setup.annotations.narrativeEvidenceV1!, { evidenceKey: 'private-context', source,
          fieldPointer: '/value', sourceContentHash: hash, normalizationVersion: 'raw-utf8-v1', start: 0,
          end: new TextEncoder().encode(quote).length, spanHash: hash, supportRole: 'context' }],
      })
    }
    const fixture = await current(setup)
    const record = fixture.projection.bundle.records.find(item => item.kind === 'epistemic-event'
      && item.payload.holderRef.semanticId === setup.holderKey)!
    expect(record.visibility.class).toBe('author-only')
    const result = await irReaderContext(fixture, questionFor(setup), 'ir-lexical', setup.through)
    expect(result.documents.some(item => item.kind === 'epistemic-event')).toBe(false)
    expect(JSON.stringify(result.documents)).not.toContain(setup.family.seed.truth)
  }, 30_000)

  it('registered metadata and exact original reads share the narrow closure even after an author query', async () => {
    const setup = await seedGroundedClockKnowledge(), fixture = await current(setup)
    const request = { scope: fixture.scope, localReleaseRecordId: fixture.v4Release.id!, disclosedThrough: null }
    const author = await openAuthorWorldQueryAccessV1({ ...request, view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null })
    try { expect((await queryWorldReleaseV1(author, { ...authorWorldQueryV1(author), text: setup.family.seed.truth })).items.length).toBeGreaterThan(0) }
    finally { await closeWorldQueryAccessV1(author) }
    const access = await openAuthorWorldQueryAccessV1({ ...request, view: 'character',
      perspective: { kind: 'character', characterKey: setup.holderKey }, knowledgeThrough: setup.through })
    try {
      const provider = await bindWorldQueryResourcesV1(access)
      const metadata = await provider.listMetadata({ scope: access.scope, limit: 100 })
      const record = metadata.items.find(item => item.worldSemantic?.resourceKind === 'epistemic-event')!
      expect(record).toBeDefined()
      for (const sourceRef of record.sourceRefs) {
        const result = await provider.readOriginal!({ scope: access.scope, resourceKey: record.resourceKey, sourceRef, maxTokens: 10000 })
        expect(result.descriptor.contentHash).toBe(record.contentHash)
        expect(JSON.stringify(result)).not.toContain(setup.family.seed.truth)
        expect(JSON.stringify(result)).not.toContain('误以为')
      }
      expect((await queryWorldReleaseV1(access, { ...authorWorldQueryV1(access), text: setup.family.seed.truth })).items).toEqual([])
      expect(JSON.stringify(metadata)).not.toContain(setup.family.seed.truth)
    } finally { await closeWorldQueryAccessV1(access) }
  }, 30_000)

  it('full and incremental compilation agree across the explicit v1-to-v2 boundary, without rewriting the base', async () => {
    const setup = await seedGroundedClockKnowledge(), base = setup.fixture.v4Release
    const captured = await captureWorldReleaseInputV4({ scope: setup.fixture.scope, includeWorkSources: true })
    const full = await compileWorldReleaseContentV4(captured.input)
    const incremental = await compileNarrativeReleaseIncrementalV1(captured.input, { version: 1,
      manifestJson: base.manifestJson, contentHash: base.contentHash })
    expect(incremental.manifestJson).toBe(full.manifestJson)
    expect(incremental.index).toEqual(full.index)
    expect(await db.worldReleases.get(base.id!)).toEqual(base)
    const legacy = await captureWorldReleaseInputV4({ scope: setup.fixture.scope, includeWorkSources: true, compilerVersion: 'narrative-domain-v1' })
    expect((await compileWorldReleaseContentV4(legacy.input)).manifestJson).toBe(base.manifestJson)
    const changed = structuredClone(full.manifest)
    changed.compilerVersion = 'narrative-domain-v1'
    await expect(verifyWorldReleaseContentV4({ manifest: changed })).rejects.toThrow('release-projection')
    await expect(compileWorldReleaseContentV4({ ...captured.input, compilerVersion: 'narrative-domain-unknown' as never })).rejects.toThrow('release-version')
  }, 30_000)

  it('a captured v1 task survives refresh and seals using its own version after the default becomes v2', async () => {
    const setup = await seedGroundedClockKnowledge()
    const started = await createNarrativeCompilationTaskV1({ scope: setup.fixture.scope, includeWorkSources: true,
      compilerVersion: 'narrative-domain-v1' })
    expect(started.checkpoint.input.compilerVersion).toBe('narrative-domain-v1')
    db.close(); await db.open()
    const request = { scope: setup.fixture.scope, runId: started.snapshot.run.id }
    const completed = await continueNarrativeCompilationTaskV1(request)
    expect(completed.checkpoint.result!.manifest.compilerVersion).toBe('narrative-domain-v1')
    const sealed = await sealNarrativeCompilationTaskV1({ ...request, label: '保留旧编译器的检查点' })
    expect(JSON.parse(sealed.manifestJson).compilerVersion).toBe('narrative-domain-v1')
  }, 30_000)
})
