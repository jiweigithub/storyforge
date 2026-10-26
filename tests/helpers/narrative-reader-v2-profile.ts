import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { seedReaderFamily, readerQuestions, READER_CONDITIONS, lexicalReaderContext, v3ReaderContext,
  irReaderContext } from './narrative-reader-evaluation'
import { seedGroundedClockKnowledge } from './narrative-reader-knowledge-fixture'
import annotations from '../acceptance/narrative-world/reader-event-knowledge-annotations-20261015-v1.json'
import type { NarrativeFamily } from './narrative-world-evaluation'
import type { NarrativeDomainFieldsV1, NarrativeDomainEvidenceV1, NarrativeDomainAtomRefV1 } from '../../src/lib/types/narrative-domain'
import type { TimePointV1 } from '../../src/lib/types/narrative-time'

type Annotation = typeof annotations.records[number]
const sha256 = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex')

/** Explicit test-author declarations, checked against input prose only.
 * No questions, expected answers, forbidden atoms or edit gold are read. */
export function verifyReaderEventAnnotation(family: NarrativeFamily, annotation: Annotation) {
  if (family.id !== annotation.familyId || annotation.holderId !== `${family.id}:character-a`
    || annotation.recordId !== `${family.id}:knowledge-a`) throw Error('Knowledge annotation identity mismatch')
  for (const span of [annotation.acquisitionEvidence, annotation.eventEvidence, ...annotation.characterEvidence]) {
    const source = family.sources.find(item => item.id === span.sourceId)
    if (!source || source.kind !== 'chapter' || source.branch !== 'canon') throw Error('Knowledge annotation source unavailable')
    const bytes = new TextEncoder().encode(source.text)
    if (sha256(bytes) !== span.sourceHash || span.start < 0 || span.end <= span.start || span.end > bytes.length
      || new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(span.start, span.end)) !== span.quote
      || sha256(span.quote) !== span.spanHash) throw Error('Knowledge annotation does not match original bytes')
  }
  if (annotation.timeDeclaration.kind !== 'single-event-origin' || annotation.timeDeclaration.coordinate !== '0'
    || annotation.timeDeclaration.queryCutoff !== 'at-the-same-acquisition-event') throw Error('Unknown event coordinate declaration')
}

async function spanEvidence(text: string, field: string, quote: string, evidenceKey: string): Promise<NarrativeDomainEvidenceV1> {
  if (text.split(quote).length !== 2) throw Error('Expected one exact evidence occurrence')
  const start = new TextEncoder().encode(text.slice(0, text.indexOf(quote))).length
  return { evidenceKey, source: { self: true }, fieldPointer: `/${field}`, sourceContentHash: sha256(text),
    normalizationVersion: 'raw-utf8-v1', start, end: start + new TextEncoder().encode(quote).length,
    spanHash: sha256(quote), supportRole: 'supports' }
}

/** New collection only. Historical v1 seeds, packages and model materials
 * remain unchanged. A local coordinate origin names one real reading/hearing
 * event; it does not date it or order it against any other event. */
export async function seedReaderCompilerV2Profile(family: NarrativeFamily) {
  if (sha256(readFileSync(annotations.corpusPath)) !== annotations.corpusSha256) throw Error('Original corpus changed')
  let fixture: Awaited<ReturnType<typeof seedReaderFamily>>, knowledgeThrough: TimePointV1 | null = null
  let declaration: 'original-day-labels' | 'single-event-origin' | 'unknown' = 'unknown'
  let eventUid: string | null = null
  if (family.id === 'clock-retelling') {
    const clock = await seedGroundedClockKnowledge()
    fixture = clock.fixture; knowledgeThrough = clock.through; declaration = 'original-day-labels'
  } else {
    fixture = await seedReaderFamily(family)
    const annotation = annotations.records.find(item => item.familyId === family.id)
    if (annotation) {
      verifyReaderEventAnnotation(family, annotation)
      const work = (await db.works.get(fixture.scope.workId))!
      const input = { scope: fixture.scope, owner: { kind: 'work' as const, workCode: work.code }, branchKey: 'canon' }
      async function confirm(table: string, recordId: number, values: Partial<NarrativeDomainFieldsV1>) {
        const capture = await captureNarrativeDomainV1(input), row = capture.rows.get(table)!.find(item => item.id === recordId)!
        await confirmNarrativeDomainAnnotationsV1({ scope: fixture.scope, table, recordId,
          expectedSourceHash: await hashNarrativeDomainSourceV1(capture, table, row), annotations: values })
      }
      const holderKey = fixture.semanticFor(annotation.holderId)!, actorId = fixture.localIds.get(annotation.holderId)!
      const actor = (await db.characters.get(actorId))!
      const actorRef = { characterId: actorId, sourceUid: (actor as typeof actor & { ragDocumentId: string }).ragDocumentId }
      const visibility = { class: 'restricted' as const, audienceKeys: [`character:${holderKey}`], policyVersion: 'reader-event-origin-v1' }
      const metadata = { narrativeModalityV1: 'established' as const, narrativeVisibilityV1: visibility }
      const now = 1_800_000_000_000, timelineKey = `${family.id}-acquisition-event-origin`
      const name = `事件局部坐标：${annotation.eventEvidence.quote}`
      const groupId = await db.worldGroups.add(stampNewRecord(fixture.scope, 'worldGroups', {
        projectId: fixture.scope.projectId, name, description: annotation.timeDeclaration.meaning,
        type: 'primary' as const, order: 0, createdAt: now, updatedAt: now,
      }, { owner: 'world' })) as number
      await confirm('worldGroups', groupId, { ...metadata, narrativeChronologyV1: { timelines: [{ timelineKey,
        calendar: 'single-event-reference-not-a-story-calendar', unit: 'reference-coordinate', epoch: 'the-named-acquisition-event' }], mappings: [] },
        narrativeEvidenceV1: [await spanEvidence(name, 'name', name, 'coordinate-definition')] })
      const description = annotation.eventEvidence.quote
      const event = stampNewRecord(fixture.scope, 'storyTimelineEvents', { projectId: fixture.scope.projectId,
        title: description, description, importance: 1, order: 0, createdAt: now, updatedAt: now }, { owner: 'work' })
      const eventId = await db.storyTimelineEvents.add(event) as number
      eventUid = (event as typeof event & { ragDocumentId: string }).ragDocumentId
      const eventRef: NarrativeDomainAtomRefV1<'event'> = { kind: 'event', source: { storyEventId: eventId, sourceUid: eventUid }, subKey: 'root' }
      await confirm('storyTimelineEvents', eventId, { ...metadata,
        narrativeEvidenceV1: [await spanEvidence(description, 'description', description, 'literal-acquisition')],
        narrativeEventV1: { eventType: 'observation', participants: [{ entity: actorRef, role: 'observer' }],
          observer: actorRef, locations: [], propositions: [], effects: [], communication: null, before: [] },
        narrativeTimeV1: { occurred: { start: { kind: 'tick', timelineKey, value: '0' }, end: null, endMeaning: 'unknown' },
          valid: null, narratedAt: null, disclosedAt: [], acquiredAt: null } })
      const knowledgeId = fixture.localIds.get(annotation.recordId)!, knowledge = (await db.knowledgeLedger.get(knowledgeId))!
      const prior = (knowledge as typeof knowledge & NarrativeDomainFieldsV1).narrativeEpistemicV1!
      await confirm('knowledgeLedger', knowledgeId, { narrativeVisibilityV1: visibility,
        narrativeEpistemicV1: { ...prior, sourceEvent: eventRef },
        narrativeTimeV1: { occurred: null, valid: null, narratedAt: null, disclosedAt: [],
          acquiredAt: { kind: 'event-anchor', event: eventRef, side: 'at' } },
        narrativeEvidenceV1: await Promise.all(annotation.characterEvidence.map((span, index) =>
          spanEvidence(knowledge.sourceQuote!, 'sourceQuote', span.quote, `holder-${index}`))) })
      declaration = 'single-event-origin'
    }
  }
  const revision = await createWorldRevision({ scope: fixture.scope, formatVersion: 4, compilerVersion: 'narrative-domain-v2',
    includeWorkSources: true, label: '单独版本化的编译器 v2 读取评测' })
  const release = await publishWorldRevision(revision.id!), verified = await verifyWorldReleaseRecordV1(release)
  if (verified.version !== 4 || verified.manifest.compilerVersion !== 'narrative-domain-v2') throw Error('Expected compiler-v2 release')
  const projection = verified.manifest.narrative
  if (eventUid) {
    const event = projection.bundle.records.find(record => record.kind === 'event' && record.provenance.sourceResourceKey.endsWith(`:${eventUid}`))
    if (!event) throw Error('The source-grounded acquisition event was not projected')
    knowledgeThrough = { kind: 'event-anchor', eventKey: event.semanticId, side: 'at' }
  }
  return { fixture: { ...fixture, v4Release: release, projection }, knowledgeThrough, declaration }
}

export async function collectReaderCompilerV2Family(family: NarrativeFamily) {
  const { fixture, knowledgeThrough, declaration } = await seedReaderCompilerV2Profile(family)
  const cases = []
  for (const question of readerQuestions(family)) for (const condition of READER_CONDITIONS) {
    const context = condition === 'v3-provider' ? await v3ReaderContext(fixture, question)
      : condition === 'lexical-original' ? lexicalReaderContext(family, question)
        : await irReaderContext(fixture, question, condition, knowledgeThrough)
    cases.push({ id: `${question.id}/${condition}`, familyId: family.id, split: family.split, condition, question, context })
  }
  return { familyId: family.id, compilerVersion: 'narrative-domain-v2', declaration, knowledgeThrough,
    // Preserve exact immutable releases behind every query hash. These are
    // replay/audit material only; readerMessages receives cases, never this
    // family envelope or its author-private manifest.
    releaseSnapshots: { v3: structuredClone(fixture.release), v4: structuredClone(fixture.v4Release),
      scope: fixture.scope, logicalSourcesByUid: Object.fromEntries(fixture.uidToSource) },
    annotationBoundary: 'Versioned test-author profile; source spans and coordinate definitions are explicit. No invented calendar date, other-event order, cause or sender. Unknown families remain unknown. Not independent semantic acceptance.',
    coverage: fixture.projection.coverage, cases }
}
