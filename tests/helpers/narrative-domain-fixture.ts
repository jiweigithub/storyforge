import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { seedNarrativeFamily } from './narrative-world-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import type { NarrativeDomainFieldsV1, NarrativeDomainMetadataV1 } from '../../src/lib/types/narrative-domain'

/** Explicit fixture author annotations, not extraction output or hidden eval
 * gold injected into a provider. Each is confirmed through the real boundary. */
export async function seedConfirmedNarrativeDomainV1(family = corpus.families[0]!) {
  const source = await seedNarrativeFamily(family)
  const work = (await db.works.get(source.scope.workId))!
  const owner = { kind: 'work' as const, workCode: work.code }
  const input = { scope: source.scope, owner, branchKey: 'canon' }
  const metadata: NarrativeDomainMetadataV1 = {
    narrativeModalityV1: 'established',
    narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'fixture-author-v1' },
  }
  const ids = {
    a: source.localIds.get(`${family.id}:character-a`)!, b: source.localIds.get(`${family.id}:character-b`)!,
    chapter: source.localIds.get(`${family.id}:chapter-2`)!, fact: source.factIds.get('confirmed')!,
    knowledge: source.localIds.get(`${family.id}:knowledge-a`)!, historical: source.factIds.get('superseded')!,
  }
  const a = (await db.characters.get(ids.a))!, b = (await db.characters.get(ids.b))!
  const chapter = (await db.chapters.get(ids.chapter))!, fact = (await db.temporalFacts.get(ids.fact))! as any
  const actorA = { characterId: ids.a, sourceUid: a.ragDocumentId! }, actorB = { characterId: ids.b, sourceUid: b.ragDocumentId! }
  const proposition = { kind: 'assertion' as const, source: { factId: ids.fact, sourceUid: fact.ragDocumentId! }, subKey: 'root' }
  async function add(table: string, row: Record<string, unknown>, owner: 'work' | 'world' = 'work') {
    const spec = PROJECT_TABLES.find(item => item.name === table)!
    const id = await spec.table.add(stampNewRecord(source.scope, table, {
      projectId: source.scope.projectId, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, ...row,
    }, { owner })) as number
    return { id, row: await spec.table.get(id) as Record<string, any> }
  }
  async function confirm(table: string, recordId: number, annotations: Partial<NarrativeDomainFieldsV1>) {
    const snapshot = await captureNarrativeDomainV1(input)
    const row = snapshot.rows.get(table)!.find(item => item.id === recordId)!
    return confirmNarrativeDomainAnnotationsV1({ scope: source.scope, table, recordId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(snapshot, table, row), annotations })
  }
  async function selfEvidence(table: string, id: number, field: string, evidenceKey = 'self') {
    const spec = PROJECT_TABLES.find(item => item.name === table)!, row = await spec.table.get(id)
    const text = String(row![field]), hash = await hashNarrativeBytesV1(text)
    return { evidenceKey, source: { self: true as const }, fieldPointer: `/${field}`, sourceContentHash: hash,
      start: 0, end: new TextEncoder().encode(text).length, normalizationVersion: 'raw-utf8-v1' as const,
      spanHash: hash, supportRole: 'supports' as const }
  }
  await confirm('characters', ids.a, metadata)
  await confirm('characters', ids.b, metadata)
  const group = await add('worldGroups', { name: '驿站历世界', description: '原创新世界的声明纪年', type: 'primary', order: 0 }, 'world')
  await confirm('worldGroups', group.id, { ...metadata, narrativeChronologyV1: {
    timelines: [{ timelineKey: 'postal-days', calendar: '驿站历', unit: 'day', epoch: '建站日' }], mappings: [],
  } })
  const interval = (start: string, end: string | null) => ({ start: { kind: 'tick' as const, timelineKey: 'postal-days', value: start },
    end: end === null ? null : { kind: 'tick' as const, timelineKey: 'postal-days', value: end }, endMeaning: end === null ? 'open' as const : 'known' as const })
  const time = { occurred: null, valid: null, narratedAt: null, disclosedAt: [], acquiredAt: null }
  await confirm('temporalFacts', ids.fact, { ...metadata, narrativeAssertionV1: { polarity: 'positive' } })
  await confirm('temporalFacts', ids.historical, { ...metadata, narrativeTimeV1: { ...time, valid: interval('0', '1') } })
  const current = (await db.temporalFacts.where('projectId').equals(source.scope.projectId).toArray()).find(row => row.supersedesFactId === ids.historical)!
  await confirm('temporalFacts', current.id!, { ...metadata, narrativeTimeV1: { ...time, valid: interval('1', null) } })
  const event = await add('storyTimelineEvents', { title: '传递消息', description: family.seed.knowledgeQuote, importance: 2, order: 0, chapterId: ids.chapter })
  await confirm('storyTimelineEvents', event.id, { ...metadata, narrativeEventV1: {
    eventType: 'communication', participants: [{ entity: actorA, role: 'recipient' }, { entity: actorB, role: 'sender' }],
    locations: [], propositions: [proposition], effects: [], communication: { sender: actorB, recipients: [actorA], channel: '信件' }, observer: null, before: [],
  }, narrativeTimeV1: { ...time, occurred: interval('1', '1') }, narrativeEvidenceV1: [await selfEvidence('storyTimelineEvents', event.id, 'description')] })
  const eventRef = { kind: 'event' as const, source: { storyEventId: event.id, sourceUid: event.row.ragDocumentId! }, subKey: 'root' }
  const relation = await add('characterRelations', { fromCharacterId: ids.a, toCharacterId: ids.b,
    relationType: 'ally', label: '盟友', description: '共同守护驿站', isBidirectional: false }, 'world')
  await confirm('characterRelations', relation.id, { ...metadata, narrativeRelationV1: { causeEvent: eventRef },
    narrativeEvidenceV1: [await selfEvidence('characterRelations', relation.id, 'description')] })
  await db.knowledgeLedger.update(ids.knowledge, { factId: ids.fact })
  await confirm('knowledgeLedger', ids.knowledge, { ...metadata, narrativeModalityV1: 'belief', narrativeEpistemicV1: {
    attitude: 'believe', transition: 'acquire', assertedValue: { kind: 'text', value: family.seed.belief }, sourceEvent: eventRef, revises: null,
  }, narrativeTimeV1: { ...time, acquiredAt: { kind: 'tick', timelineKey: 'postal-days', value: '2' } } })
  const rule = await add('temporalFacts', { subjectWorldGroupId: group.id, subjectName: group.row.name, predicate: 'magicSource',
    factKind: 'state', value: '誓言驱动魔法', sourceType: 'manual', status: 'confirmed', locked: false })
  await confirm('temporalFacts', rule.id, { ...metadata, narrativeRuleV1: { preconditions: [proposition] } })
  const foreshadow = (await db.foreshadows.where('projectId').equals(source.scope.projectId).toArray())[0]!
  const development = { semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000001', statement: family.seed.plannedText,
    developmentType: 'foreshadow' as const, owners: [actorA], members: [], state: 'open' as const, transitions: [], resolutionEvidenceKeys: [],
    narrativeModalityV1: 'intent' as const, narrativeVisibilityV1: { class: 'author-only' as const, audienceKeys: [], policyVersion: 'fixture-author-v1' } }
  await confirm('foreshadows', foreshadow.id!, { narrativeDevelopmentsV1: [development] })
  await confirm('chapters', ids.chapter, { ...metadata, narrativeDisclosuresV1: [{
    semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000002', subjects: [proposition, eventRef], audienceKeys: ['reader'], evidenceKey: 'text',
    narrativeEvidenceV1: [await selfEvidence('chapters', ids.chapter, 'content', 'text')],
  }] })
  return { ...source, input, ids, group, event, eventRef, relation, rule, current, foreshadow, development, confirm, selfEvidence, chapter }
}
