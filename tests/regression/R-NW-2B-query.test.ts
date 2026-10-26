import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { compileNarrativeIndexV1 } from '../../src/lib/world-engine/narrative-index'
import { hashNarrativeValueV1 } from '../../src/lib/world-engine/narrative-json'
import { createWorldQueryEvaluatorV1 } from '../../src/lib/context-gateway/world-query-evaluator'
import { parseWorldQueryV1 } from '../../src/lib/context-gateway/world-query-contract'
import type { WorldQueryGrantV1, WorldQueryV1, WorldReferenceV2 } from '../../src/lib/types/world-query'
import { matchWorldQueryTimeV1 } from '../../src/lib/context-gateway/world-query-time'
import type { NarrativeRecordV1 } from '../../src/lib/types/narrative-ir'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { canonicalNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-json'

describe('NW-2B · deterministic query kernel (not product or human acceptance)', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  async function setup() {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const build = async () => {
      const projection = await projectNarrativeDomainsV1(fixture.input)
      const index = await compileNarrativeIndexV1({ projection, inputRootHash: await hashNarrativeValueV1(projection) })
      // Component fixture reference only. Real release identity/owner validation
      // is tested separately at the registered provider/Gateway boundary.
      const reference: WorldReferenceV2 = { schema: 'storyforge.world-reference', version: 2,
        worldCode: fixture.release.sourceWorldCode, releaseUid: fixture.release.releaseUid!, releaseVersion: 1,
        releaseHash: 'a'.repeat(64), localReleaseRecordId: fixture.release.id!, referenceHash: 'b'.repeat(64),
        manifestIdentity: { schema: 'storyforge.world-release', version: 4, semanticContract: 4,
          registryVersion: 'world-semantic-v4', compilerVersion: 'narrative-domain-v1' },
        indexIdentity: { inputRootHash: index.inputRootHash, recipeVersion: index.recipeVersion, indexHash: index.indexHash } }
      const grant: WorldQueryGrantV1 = { version: 1, releaseReferenceHash: reference.referenceHash, sourcePlanHash: null,
        purpose: 'author-review', views: ['canon', 'development', 'author-plan'], perspective: { kind: 'author' },
        audienceKeys: ['author'], allowedSemanticIds: null, branchKey: 'canon', knowledgeThrough: null, disclosedThrough: null,
        maxTokens: 100000, maxRecords: 500, maxEvidenceBytes: 4 * 1024 * 1024, policyRevision: 'test-author-v1' }
      const query: WorldQueryV1 = { schema: 'storyforge.world-query', version: 1, worldReference: reference, sourcePlanHash: null,
        view: 'canon', perspective: { kind: 'author' }, branch: { kind: 'canon', key: 'canon' }, mode: 'search', text: null,
        kinds: [], entityKeys: [], storyArcKeys: [], time: null, evidenceDepth: 'metadata', relationExpansion: { kinds: [], maxHops: 0, maxNodes: 500 },
        causalDepth: 0, budget: { maxTokens: 100000, maxRecords: 500, maxEvidenceBytes: 4 * 1024 * 1024 }, cursor: null }
      return { projection, index, reference, grant, query, evaluate: createWorldQueryEvaluatorV1({ reference, projection, index }) }
    }
    return { fixture, build, ...await build() }
  }

  it('enforces exact entity + thread + occurred-time intersection, with stable same-name identities', async () => {
    const initial = await setup(), { fixture } = initial
    const arc = (await db.storyArcs.where('projectId').equals(fixture.scope.projectId).toArray())[0]
    await fixture.confirm('storyArcs', arc.id!, { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'thread-v1' },
      narrativeDevelopmentsV1: [{ ...fixture.development,
      developmentType: 'thread', members: [fixture.eventRef], narrativeModalityV1: 'established',
      narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'thread-v1' } }] })
    const { query, grant, evaluate, projection } = await initial.build()
    const event = projection.bundle.records.find(record => record.kind === 'event')!
    const thread = projection.bundle.records.find(record => record.kind === 'development' && record.payload.developmentType === 'thread')!
    const actor = projection.bundle.records.find(record => record.kind === 'entity' && record.payload.entityType === 'character')!
    const point = event.time.occurred!.start
    const result = await evaluate({ ...query, kinds: ['event'], entityKeys: [actor.semanticId], storyArcKeys: [thread.semanticId],
      time: { axis: 'occurred', mode: 'at', point } }, grant)
    expect(result.items.map(item => item.semanticId)).toEqual([event.semanticId])
    expect(projection.bundle.records.filter(record => record.kind === 'entity' && record.payload.entityType === 'character')).toHaveLength(2)
    expect((await evaluate({ ...query, kinds: ['entity'], entityKeys: [actor.semanticId] }, grant)).items.map(item => item.semanticId)).toEqual([actor.semanticId])
    await expect(evaluate({ ...query, kinds: ['event'], entityKeys: [thread.semanticId] }, grant)).rejects.toThrow('access-unavailable')
  })

  it('rejects unknown keys exactly like unauthorized keys, with no hidden identity in errors', async () => {
    const { query, grant, evaluate, projection } = await setup()
    const actor = projection.bundle.records.find(record => record.kind === 'entity')!
    for (const key of [actor.semanticId, 'sem:unknown']) {
      await expect(evaluate({ ...query, entityKeys: [key] }, { ...grant, allowedSemanticIds: [] }))
        .rejects.toThrow('[world-query:access-unavailable] 请求的资源身份不可用')
    }
  })

  it('selects historical/current states with half-open validity, never author timestamps', async () => {
    const { query, grant, evaluate, projection } = await setup()
    const historical = projection.bundle.records.find(record => record.kind === 'assertion' && record.reviewState === 'historical')!
    const timeline = projection.bundle.timeContext.timelines[0].timelineKey
    const run = (day: string) => evaluate({ ...query, mode: 'state-at', time: { axis: 'valid', mode: 'at', point: { kind: 'tick', timelineKey: timeline, value: day } } }, grant)
    expect((await run('0')).items.map(item => item.semanticId)).toContain(historical.semanticId)
    const current = await run('1')
    expect(current.items.map(item => item.semanticId)).not.toContain(historical.semanticId)
    expect(current.items.some(item => item.reviewState === 'accepted')).toBe(true)
    expect(current.diagnostics.some(item => item.code === 'unknown-time')).toBe(true)
  })

  it('preserves false beliefs and excludes Canon truth, other holders and planned material from character output', async () => {
    const { query, grant, evaluate, projection } = await setup()
    const belief = projection.bundle.records.find(record => record.kind === 'epistemic-event')!
    if (belief.kind !== 'epistemic-event') throw Error('fixture')
    const characterKey = belief.payload.holderRef.semanticId
    const perspective = { kind: 'character' as const, characterKey }
    const characterGrant: WorldQueryGrantV1 = { ...grant, views: ['character'], perspective, audienceKeys: [`character:${characterKey}`],
      knowledgeThrough: belief.time.acquiredAt }
    const result = await evaluate({ ...query, view: 'character', perspective, evidenceDepth: 'atomic' }, characterGrant)
    const item = result.items.find(item => item.semanticId === belief.semanticId)
    expect(item?.atom).toMatchObject({ assertedValue: belief.payload.assertedValue, attitude: 'believe' })
    const truth = projection.bundle.records.find(record => record.semanticId === belief.payload.propositionRef.semanticId)!
    expect(result.items.map(item => item.semanticId)).not.toContain(truth.semanticId)
    expect(JSON.stringify(result)).not.toContain(truth.semanticId)
    const plan = projection.bundle.records.find(record => record.modality === 'intent')!
    expect(JSON.stringify(result)).not.toContain(plan.semanticId)
    await expect(evaluate({ ...query, perspective: { kind: 'author' } }, characterGrant)).rejects.toThrow('access-unavailable')
    const before = await evaluate({ ...query, view: 'character', perspective }, { ...characterGrant,
      knowledgeThrough: { kind: 'tick', timelineKey: projection.bundle.timeContext.timelines[0].timelineKey, value: '1' } })
    expect(before.items.some(item => item.semanticId === belief.semanticId)).toBe(false)
  })

  it('reader reveals use frozen sequence positions; an author-plan request needs explicit purpose/view authority', async () => {
    const { query, grant, evaluate, projection } = await setup()
    const disclosure = projection.bundle.records.find(record => record.kind === 'disclosure')!
    if (disclosure.kind !== 'disclosure') throw Error('fixture')
    const sequence = projection.bundle.timeContext.sequences.find(sequence => sequence.sequenceKey === disclosure.payload.sequenceKey)!
    const makeGrant = (unitKey: string): WorldQueryGrantV1 => ({ ...grant, views: ['canon'], perspective: { kind: 'reader' },
      audienceKeys: ['reader'], disclosedThrough: { sequenceKey: sequence.sequenceKey, unitKey, audienceKey: 'reader' } })
    const result = await evaluate({ ...query, perspective: { kind: 'reader' } }, makeGrant(disclosure.payload.unitKey))
    expect(result.items.some(item => item.kind === 'assertion')).toBe(true)
    const first = sequence.units[0].unitKey
    expect(first).not.toBe(disclosure.payload.unitKey)
    const earlier = await evaluate({ ...query, perspective: { kind: 'reader' } }, makeGrant(first))
    expect(earlier.items.some(item => item.kind === 'assertion')).toBe(false)
    expect((await evaluate({ ...query, view: 'author-plan' }, grant)).items.map(item => item.modality)).toEqual(['intent'])
    await expect(evaluate({ ...query, view: 'author-plan' }, { ...grant, views: ['canon'] })).rejects.toThrow('access-unavailable')
  })

  for (const view of ['development', 'author-plan'] as const) it(`${view} can quote an authorized canonical chapter without adding it as a search hit`, async () => {
    const initial = await setup(), { fixture } = initial
    const arc = (await db.storyArcs.where('projectId').equals(fixture.scope.projectId).toArray())[0]
    const proof = await fixture.selfEvidence('chapters', fixture.ids.chapter, 'content', 'chapter-proof')
    await fixture.confirm('storyArcs', arc.id!, { narrativeDevelopmentsV1: [{
      ...fixture.development, owners: [], members: [], transitions: [], developmentType: 'commitment',
      narrativeModalityV1: view === 'development' ? 'established' : 'intent',
      narrativeEvidenceV1: [{ ...proof, source: { chapterId: fixture.ids.chapter, sourceUid: fixture.chapter.ragDocumentId! } }],
    }] })
    const { evaluate, projection, query, grant } = await initial.build()
    const target = projection.bundle.records.find(record => record.kind === 'development' && record.payload.developmentType === 'commitment')!
    const request = { ...query, view, kinds: ['development' as const], evidenceDepth: 'original' as const }
    const result = await evaluate(request, grant, target.semanticId)
    expect(result.items.map(item => item.semanticId)).toEqual([target.semanticId])
    expect(result.items[0].evidence.some(span => span.text === fixture.chapter.content)).toBe(true)
    expect(result.items[0].supportingAtoms).toEqual([])
    expect(result.items.some(item => item.kind === 'disclosure')).toBe(false)

    // A view filter is not an authorization filter. Exact plan selection and
    // source restrictions still apply independently to every touched chunk.
    const narrowed = await evaluate(request, { ...grant, allowedSemanticIds: [target.semanticId] }, target.semanticId)
    expect(narrowed.items).toEqual([])
    expect(narrowed.diagnostics.some(item => item.reason === 'evidence-closure-unavailable')).toBe(true)
    const planHash = 'c'.repeat(64)
    const product = await evaluate({ ...request, sourcePlanHash: planHash }, { ...grant,
      purpose: 'product-production', sourcePlanHash: planHash }, target.semanticId)
    expect(product.items).toEqual([])
    expect(product.diagnostics.some(item => item.reason === 'evidence-closure-unavailable')).toBe(true)

    const noEvidenceBudget = await evaluate({ ...request, budget: { ...request.budget, maxEvidenceBytes: 1 } }, grant, target.semanticId)
    expect(noEvidenceBudget.items).toEqual([])
    expect(noEvidenceBudget.diagnostics.some(item => item.reason === 'complete-item-exceeds-remaining-budget')).toBe(true)
    const canonical = await evaluate({ ...query, evidenceDepth: 'original' }, grant)
    expect(canonical.items.every(item => item.modality !== 'intent')).toBe(true)
  })

  for (const view of ['canon', 'development'] as const) it(`${view} keeps shared intent evidence separate from canonical search hits`, async () => {
    const initial = await setup(), { fixture } = initial
    const arc = (await db.storyArcs.where('projectId').equals(fixture.scope.projectId).toArray())[0]
    const proof = await fixture.selfEvidence('chapters', fixture.ids.chapter, 'content', 'shared-story')
    const pending = { ...fixture.development, owners: [], members: [], transitions: [],
      developmentType: 'commitment' as const, state: 'blocked' as const }
    const fulfilled = { ...pending, semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000003',
      statement: '另一项承诺已经兑现', state: 'fulfilled' as const, narrativeModalityV1: 'established' as const,
      narrativeVisibilityV1: { class: 'public' as const, audienceKeys: [], policyVersion: 'shared-source-fixture-v1' },
      resolutionEvidenceKeys: ['shared-story'] }
    await fixture.confirm('storyArcs', arc.id!, { narrativeDevelopmentsV1: [pending, fulfilled],
      narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'shared-source-fixture-v1' },
      narrativeEvidenceV1: [{ ...proof, source: { chapterId: fixture.ids.chapter, sourceUid: fixture.chapter.ragDocumentId! } }] })
    const { evaluate, projection, index, query, grant } = await initial.build()
    const target = projection.bundle.records.find(record => record.kind === 'development' && record.payload.state === 'fulfilled')!
    const plan = projection.bundle.records.find(record => record.kind === 'development' && record.payload.state === 'blocked')!
    expect(target.visibility.class).toBe('public')
    const targetIndex = index.indexes.recordKeys.indexOf(target.semanticId), planIndex = index.indexes.recordKeys.indexOf(plan.semanticId)
    expect(index.indexes.chunks.some(chunk => chunk.recordIndexes.includes(targetIndex) && chunk.recordIndexes.includes(planIndex))).toBe(true)
    const request = { ...query, view, kinds: ['development' as const], evidenceDepth: 'original' as const }
    // A real author capability grants the selected view only. Original bytes
    // shared by its hit and a plan do not turn that plan into a readable hit.
    const author = { ...grant, views: [view] }
    const result = await evaluate(request, author, target.semanticId)
    expect(result.items.map(item => item.semanticId)).toEqual([target.semanticId])
    expect(result.items[0].evidence.some(span => span.text === fixture.chapter.content)).toBe(true)
    expect(result.items[0].supportingAtoms).toEqual([])
    expect(result.items[0].originalAvailable).toBe(true)
    expect((await evaluate(request, author)).items.map(item => item.semanticId)).toEqual([target.semanticId])
    await expect(evaluate({ ...request, view: 'author-plan' }, author)).rejects.toThrow('access-unavailable')
    const plans = await evaluate({ ...request, view: 'author-plan' }, grant, plan.semanticId)
    expect(plans.items.map(item => item.semanticId)).toEqual([plan.semanticId])

    const denied = await evaluate(request, { ...author,
      allowedSemanticIds: projection.bundle.records.filter(record => record.semanticId !== plan.semanticId).map(record => record.semanticId) }, target.semanticId)
    expect(denied.items).toEqual([])
    expect(denied.diagnostics.some(item => item.reason === 'evidence-closure-unavailable')).toBe(true)
    expect(JSON.stringify(denied)).not.toContain(plan.semanticId)
    const planHash = 'c'.repeat(64)
    const product = await evaluate({ ...request, sourcePlanHash: planHash }, { ...grant,
      purpose: 'product-production', sourcePlanHash: planHash }, target.semanticId)
    expect(product.items).toEqual([])
    expect(product.diagnostics.some(item => item.reason === 'evidence-closure-unavailable')).toBe(true)
    const small = await evaluate({ ...request, budget: { ...request.budget, maxEvidenceBytes: 1 } }, author, target.semanticId)
    expect(small.items).toEqual([])
    expect(small.diagnostics.some(item => item.reason === 'complete-item-exceeds-remaining-budget')).toBe(true)
  })

  it('unknown and unrelated time axes produce diagnostics instead of false matches', async () => {
    const { query, grant, evaluate, projection } = await setup()
    const result = await evaluate({ ...query, kinds: ['entity'], time: { axis: 'occurred', mode: 'at',
      point: { kind: 'tick', timelineKey: projection.bundle.timeContext.timelines[0].timelineKey, value: '1' } } }, grant)
    expect(result.items).toEqual([])
    expect(result.status).toBe('insufficient')
    expect(result.diagnostics.every(item => item.code === 'unknown-time')).toBe(true)
    const record = projection.bundle.records.find(record => record.kind === 'event')!
    const context = structuredClone(projection.bundle.timeContext)
    context.timelines.push({ ...context.timelines[0], timelineKey: 'unmapped-calendar' })
    expect(matchWorldQueryTimeV1(record, { axis: 'occurred', mode: 'at', point: { kind: 'tick', timelineKey: 'unmapped-calendar', value: '1' } }, context)).toBe('incomparable-time')
  })

  it('disclosed-time filters join authorized disclosure subjects and preserve the earlier cutoff', async () => {
    const { query, grant, evaluate, projection } = await setup()
    const disclosure = projection.bundle.records.find(record => record.kind === 'disclosure')!
    if (disclosure.kind !== 'disclosure') throw Error('fixture')
    const sequence = projection.bundle.timeContext.sequences.find(item => item.sequenceKey === disclosure.payload.sequenceKey)!
    const time = { axis: 'disclosed' as const, audienceKey: 'reader', sequenceKey: sequence.sequenceKey, throughUnitKey: disclosure.payload.unitKey }
    const at = await evaluate({ ...query, kinds: ['assertion'], time }, grant)
    const proposition = disclosure.payload.subjectRefs.find(ref => ref.kind === 'assertion')!
    expect(at.items.map(item => item.semanticId)).toContain(proposition.semanticId)
    const before = await evaluate({ ...query, kinds: ['assertion'], time: { ...time, throughUnitKey: sequence.units[0].unitKey } }, grant)
    expect(before.items.map(item => item.semanticId)).not.toContain(proposition.semanticId)
    const withoutDisclosure = { ...grant, allowedSemanticIds: projection.bundle.records
      .filter(record => record.semanticId !== disclosure.semanticId).map(record => record.semanticId) }
    expect((await evaluate({ ...query, kinds: ['assertion'], time }, withoutDisclosure)).items.map(item => item.semanticId)).not.toContain(proposition.semanticId)
  })

  it('an expanded causal endpoint reports its own time basis instead of impersonating a direct time match', async () => {
    const { query, grant, evaluate, projection } = await setup()
    const event = projection.bundle.records.find(record => record.kind === 'event')!
    const result = await evaluate({ ...query, kinds: ['event'], causalDepth: 1,
      time: { axis: 'occurred', mode: 'at', point: event.time.occurred!.start } }, grant)
    expect(result.items.find(item => item.semanticId === event.semanticId)?.match).toMatchObject({ selection: 'direct', time: 'matched' })
    const relation = result.items.find(item => item.kind === 'relation')!
    expect(relation.match).toMatchObject({ selection: 'expansion', time: 'unknown-time' })
  })

  it('no causality is invented from temporal order; undeclared hypotheses stay unsupported', async () => {
    const { query, grant, evaluate } = await setup()
    const result = await evaluate({ ...query, kinds: ['event'], causalDepth: 3, relationExpansion: { kinds: ['before'], maxHops: 3, maxNodes: 50 } }, grant)
    expect(result.edges.filter(edge => edge.kind === 'causes')).toHaveLength(1) // explicit relation cause in fixture
    expect(result.edges.some(edge => edge.kind === 'before')).toBe(false)
    expect(await evaluate({ ...query, view: 'hypothesis', branch: { kind: 'hypothesis', artifactRef: 'unused' } }, { ...grant, views: ['hypothesis'] }))
      .toMatchObject({ status: 'unsupported', items: [], edges: [] })
  })

  it('original spans are complete or explicitly insufficient; budgets never silently clip them', async () => {
    const { query, grant, evaluate } = await setup()
    const normal = await evaluate({ ...query, kinds: ['event'], evidenceDepth: 'original' }, grant)
    expect(normal.items).toHaveLength(1)
    expect(normal.items[0].evidence.some(span => span.text && new TextEncoder().encode(span.text).length === span.end - span.start)).toBe(true)
    const small = await evaluate({ ...query, kinds: ['event'], evidenceDepth: 'original', budget: { ...query.budget, maxEvidenceBytes: 1 } }, grant)
    expect(small).toMatchObject({ status: 'insufficient', items: [] })
    expect(JSON.stringify(small)).not.toContain('…')
  })

  it('pagination is deterministic and bound to all filters, budget, policy and index', async () => {
    const { query, grant, evaluate } = await setup()
    const pageQuery = { ...query, budget: { ...query.budget, maxRecords: 1 } }
    const first = await evaluate(pageQuery, grant)
    expect(first.nextCursor).not.toBeNull()
    expect(await evaluate(pageQuery, grant)).toEqual(first)
    const second = await evaluate({ ...pageQuery, cursor: first.nextCursor }, grant)
    expect(second.items[0].semanticId).not.toBe(first.items[0].semanticId)
    await expect(evaluate({ ...pageQuery, cursor: first.nextCursor, text: '变更条件' }, grant)).rejects.toThrow('cursor')
    await expect(evaluate({ ...pageQuery, cursor: first.nextCursor, budget: { ...query.budget, maxRecords: 2 } }, grant)).rejects.toThrow('cursor')
    await expect(evaluate({ ...pageQuery, cursor: first.nextCursor }, { ...grant, policyRevision: 'changed-v2' })).rejects.toThrow('cursor')
  })

  it('rejects unsupported/unknown fields, invalid state-at, missing audience and oversized expansion at the codec', async () => {
    const { query } = await setup()
    const invalid = [ { ...query, authority: 'author' }, { ...query, mode: 'state-at' }, { ...query, text: '' },
      { ...query, entityKeys: ['a', 'a'] }, { ...query, relationExpansion: { ...query.relationExpansion, maxHops: 4 } },
      { ...query, time: { axis: 'disclosed', sequenceKey: 'x', throughUnitKey: 'y', audienceKey: null } } ]
    for (const value of invalid) expect(() => parseWorldQueryV1(value)).toThrow()
  })

  it('acquired time is independent of occurrence time and does not convert an unknown end to infinity', async () => {
    const { projection } = await setup()
    const belief = projection.bundle.records.find(record => record.kind === 'epistemic-event')!
    const context = projection.bundle.timeContext, timelineKey = context.timelines[0].timelineKey
    expect(matchWorldQueryTimeV1(belief, { axis: 'acquired', mode: 'at', point: { kind: 'tick', timelineKey, value: '2' } }, context)).toBe('matched')
    expect(matchWorldQueryTimeV1(belief, { axis: 'acquired', mode: 'at', point: { kind: 'tick', timelineKey, value: '3' } }, context)).toBe('outside')
    const unknown = { ...belief, time: { ...belief.time, valid: { start: { kind: 'tick' as const, timelineKey, value: '0' }, end: null, endMeaning: 'unknown' as const } } } as NarrativeRecordV1
    expect(matchWorldQueryTimeV1(unknown, { axis: 'valid', mode: 'at', point: { kind: 'tick', timelineKey, value: '2' } }, context)).toBe('unknown-time')
  })

  it('detects overlapping accepted state conflicts before pagination, rather than choosing the first result', async () => {
    const initial = await setup(), { fixture } = initial
    await fixture.confirm('temporalFacts', fixture.ids.historical, { narrativeTimeV1: {
      occurred: null, valid: { start: { kind: 'tick', timelineKey: 'postal-days', value: '0' },
        end: { kind: 'tick', timelineKey: 'postal-days', value: '3' }, endMeaning: 'known' },
      narratedAt: null, disclosedAt: [], acquiredAt: null } })
    const { query, grant, evaluate, projection } = await initial.build()
    const result = await evaluate({ ...query, mode: 'state-at', budget: { ...query.budget, maxRecords: 1 },
      time: { axis: 'valid', mode: 'at', point: { kind: 'tick', timelineKey: projection.bundle.timeContext.timelines[0].timelineKey, value: '2' } } }, grant)
    expect(result.status).toBe('conflict')
    expect(result.items).toHaveLength(1)
    expect(result.diagnostics.some(item => item.code === 'conflict')).toBe(true)
  })

  it('a secret entity removes its relations, original spans, text matches and diagnostic identities', async () => {
    const initial = await setup(), { fixture } = initial
    await fixture.confirm('characters', fixture.ids.b, { narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'secret-v1' } })
    const { query, grant, evaluate, projection } = await initial.build()
    const belief = projection.bundle.records.find(record => record.kind === 'epistemic-event')!
    if (belief.kind !== 'epistemic-event') throw Error('fixture')
    const perspective = { kind: 'character' as const, characterKey: belief.payload.holderRef.semanticId }
    const policy = { ...grant, views: ['character' as const], perspective, knowledgeThrough: belief.time.acquiredAt }
    const secretUid = (await db.characters.get(fixture.ids.b))!.ragDocumentId!
    const secret = projection.bundle.records.find(record => record.provenance.sourceResourceKey.endsWith(secretUid))!
    const publicResult = await evaluate({ ...query, view: 'character', perspective, evidenceDepth: 'original',
      relationExpansion: { kinds: ['participant', 'relation'], maxHops: 3, maxNodes: 100 } }, policy)
    expect(JSON.stringify(publicResult)).not.toContain(secret.semanticId)
    expect(JSON.stringify(publicResult)).not.toContain(secretUid)
    await expect(evaluate({ ...query, view: 'character', perspective, entityKeys: [secret.semanticId] }, policy)).rejects.toThrow('access-unavailable')
  })

  it('multi predicates coexist; opposite polarities of the same value still conflict', async () => {
    const initial = await setup(), { fixture } = initial
    await db.temporalFacts.update(fixture.ids.historical, { predicate: 'knows', factKind: 'event' })
    await db.temporalFacts.update(fixture.current.id!, { predicate: 'knows', factKind: 'event' })
    await fixture.confirm('temporalFacts', fixture.ids.historical, { narrativeTimeV1: {
      occurred: null, valid: { start: { kind: 'tick', timelineKey: 'postal-days', value: '0' },
        end: { kind: 'tick', timelineKey: 'postal-days', value: '3' }, endMeaning: 'known' },
      narratedAt: null, disclosedAt: [], acquiredAt: null } })
    await fixture.confirm('temporalFacts', fixture.current.id!, { narrativeAssertionV1: { polarity: 'positive' } })
    const run = async () => {
      const { query, grant, evaluate, projection } = await initial.build()
      return evaluate({ ...query, mode: 'state-at', time: { axis: 'valid', mode: 'at',
        point: { kind: 'tick', timelineKey: projection.bundle.timeContext.timelines[0].timelineKey, value: '2' } } }, grant)
    }
    const coexist = await run()
    expect(coexist.status).toBe('matched')
    expect(coexist.items).toHaveLength(2)
    await db.temporalFacts.update(fixture.current.id!, { value: (await db.temporalFacts.get(fixture.ids.historical))!.value })
    await fixture.confirm('temporalFacts', fixture.current.id!, { narrativeAssertionV1: { polarity: 'negative' } })
    expect((await run()).status).toBe('conflict')
  })

  it('counts the complete query receipt against the token ceiling and rejects an impossible envelope budget', async () => {
    const { query, grant, evaluate } = await setup()
    const result = await evaluate({ ...query, budget: { ...query.budget, maxTokens: 2400 } }, grant)
    expect(result.budgetUsed.tokens).toBe(estimateTokens(canonicalNarrativeJsonV1(result)))
    expect(result.budgetUsed.tokens).toBeLessThanOrEqual(2400)
    await expect(evaluate({ ...query, budget: { ...query.budget, maxTokens: 1 } }, grant)).rejects.toThrow('budget')
  })
})
