import { buildNarrativeScaleInputV1 } from './narrative-scale-fixture'
import { captureFrozenNarrativeSourcesV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { hashNarrativeDomainSourceV1, type NarrativeDomainRowV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { deriveRegisteredSemanticRowsV1 } from '../../src/lib/export/registry-export'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'

const STAMP = 1_900_000_000_000
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

/** Separate, deterministic engineering fixture for compiler v2. These are
 * synthetic declarations, never extracted candidates or real author receipts.
 * Source generation is outside measured compile time. The original v1 fixture
 * and every historical input/output vector remain unchanged. */
export async function buildNarrativeScaleInputV2(characterCount: number) {
  if (!Number.isSafeInteger(characterCount) || characterCount < 2000 || characterCount > 1_000_000) throw Error('v2 scale character count out of range')
  const knowledgeCount = Math.max(2, Math.floor(characterCount / 2000))
  const declared = Array.from({ length: knowledgeCount }, (_, index) => {
    const holder = index % 50 + 1, number = String(index + 1).padStart(5, '0')
    const truth = `西库第${number}间`, belief = `东库第${number}间`
    return { holder, truth, belief, statement: `行者${String(holder).padStart(3, '0')}指着河对面的屋檐说：“我的值房在${belief}。”` }
  })
  const additionalCharacters = declared.reduce((sum, row) => sum + [...row.truth].length + [...row.statement].length, 0)
  const base = await buildNarrativeScaleInputV1(characterCount - additionalCharacters)
  const input = base.input
  input.compilerVersion = 'narrative-domain-v2'
  input.worldName = `规模场景 v2 ${characterCount}`
  input.semanticSnapshot.project.name = input.worldName
  input.semanticSnapshot.worlds[0].name = input.worldName
  input.semanticSnapshot.works[0].title = input.worldName
  input.sourceManifest.sourceWorkCode = input.semanticSnapshot.works[0].code as string
  input.selectedTables = ['characters', 'historicalTimelineEvents', 'knowledgeLedger', 'temporalFacts']
  input.records.knowledgeLedger = []; input.records.temporalFacts = []
  const capture = captureFrozenNarrativeSourcesV4({ ...input, sourceWorkCode: input.sourceManifest.sourceWorkCode })
  const knowledge = capture.rows.get('knowledgeLedger')!, facts = capture.rows.get('temporalFacts')!
  const visibility = { class: 'public' as const, audienceKeys: [], policyVersion: 'scale-independent-knowledge-v2' }
  async function evidence(text: string, field: string) {
    const hash = await hashNarrativeBytesV1(text)
    return [{ evidenceKey: 'declared-span', source: { self: true as const }, fieldPointer: `/${field}`, sourceContentHash: hash,
      start: 0, end: new TextEncoder().encode(text).length, normalizationVersion: 'raw-utf8-v1' as const, spanHash: hash, supportRole: 'supports' as const }]
  }
  for (const [index, declaration] of declared.entries()) {
    const common = { id: index + 1, projectId: 1, worldId: 1, workId: 1, characterId: declaration.holder,
      sourceType: 'manual', status: 'confirmed', createdAt: STAMP, updatedAt: STAMP }
    facts.push({ ...common, ragDocumentId: `res:v1:temporal-fact:${uuid(index + 1)}`,
      subjectName: `行者${String(declaration.holder).padStart(3, '0')}`, predicate: 'location', factKind: 'state',
      value: declaration.truth, locked: false, narrativeModalityV1: 'established',
      narrativeVisibilityV1: { ...visibility, class: 'author-only' }, narrativeAssertionV1: { polarity: 'positive' },
      narrativeEvidenceV1: await evidence(declaration.truth, 'value') })
    knowledge.push({ ...common, ragDocumentId: `res:v1:knowledge-event:${uuid(index + 1)}`,
      knowledgeKey: `scale-v2:room:${index + 1}`, statement: declaration.statement,
      factId: index + 1, action: 'mislearn', belief: declaration.belief,
      narrativeModalityV1: 'belief', narrativeVisibilityV1: visibility,
      narrativeEvidenceV1: await evidence(declaration.statement, 'statement'),
      narrativeEpistemicV1: { attitude: 'believe', transition: 'acquire', assertedValue: { kind: 'text', value: declaration.belief },
        sourceEvent: null, revises: null } })
  }
  for (const [table, rows] of [['temporalFacts', facts], ['knowledgeLedger', knowledge]] as const) for (const row of rows) {
    row.narrativeAuthorityV1 = { version: 1, mode: 'author-declaration', confirmedAt: STAMP,
      confirmationUid: `confirmation:v1:${uuid(100_000 + (table === 'knowledgeLedger' ? knowledgeCount : 0) + Number(row.id))}`,
      contentHash: await hashNarrativeDomainSourceV1(capture, table, row) }
  }
  const selected = new Map<string, NarrativeDomainRowV1[]>(input.selectedTables.map(table => [table, capture.rows.get(table)!]))
  input.records = deriveRegisteredSemanticRowsV1({ rows: selected, worldId: 1, workId: 1 }).records
  const texts = [
    ...capture.rows.get('characters')!.map(row => String(row.name)),
    ...capture.rows.get('historicalTimelineEvents')!.map(row => String(row.description)),
    ...facts.map(row => String(row.value)), ...knowledge.map(row => String(row.statement)),
  ]
  const unicodeCharacters = texts.reduce((sum, text) => sum + [...text].length, 0)
  const distinctTextCharacters = [...new Set(texts)].reduce((sum, text) => sum + [...text].length, 0)
  if (unicodeCharacters !== characterCount) throw Error('v2 scale source character accounting mismatch')
  return { input, needles: base.needles,
    stats: { ...base.stats, generatorVersion: 'narrative-scale-independent-knowledge-v2', unicodeCharacters, distinctTextCharacters,
      duplicateExactTextCharacters: unicodeCharacters - distinctTextCharacters, sourceFields: texts.length, uniqueTexts: new Set(texts).size,
      declaredRecords: base.stats.declaredRecords + knowledgeCount * 2,
      declaredParticipantEdges: base.stats.declaredParticipantEdges, declaredKnowledgeRecords: knowledgeCount,
      declaredPrivateAssertions: knowledgeCount, declaredReferenceEdges: base.stats.declaredParticipantEdges + knowledgeCount * 3,
      inputBytes: new TextEncoder().encode(canonicalNarrativeJsonV1(input)).length,
      characterAccounting: 'Registered source text fields only: character names, event descriptions, private assertion values and public belief statements. Serialized copies, metadata and evidence duplicate bytes are not counted as new source characters.',
      acquisitionTime: 'unknown; no calendar or event invented for a scale benchmark',
      contentNature: 'varied synthetic engineering scenes and declared contradictory beliefs; not literary or independent author evidence' } }
}
