import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { seedReaderFamily } from './narrative-reader-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import annotation from '../acceptance/narrative-world/reader-knowledge-annotations-20261015-v1.json'
import type { NarrativeDomainFieldsV1, NarrativeDomainEvidenceV1 } from '../../src/lib/types/narrative-domain'
import type { TimePointV1 } from '../../src/lib/types/narrative-time'

const sha256 = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex')

/** Separate, explicit fixture declarations. The old seed and all frozen model
 * inputs are unchanged. Day labels and quotations come from input prose, not
 * answer gold. This is a diagnostic for one development family only. */
export async function seedGroundedClockKnowledge(propositionPermission: 'author-only' | 'public' = 'author-only') {
  if (sha256(readFileSync(annotation.corpusPath)) !== annotation.corpusSha256) throw Error('Knowledge annotation corpus changed')
  const family = corpus.families.find(item => item.id === annotation.familyId)!
  for (const span of [annotation.acquisitionEvidence, annotation.continuationEvidence, ...annotation.characterEvidence]) {
    const source = family.sources.find(item => item.id === span.sourceId)!
    const bytes = new TextEncoder().encode(source.text)
    const quote = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(span.start, span.end))
    if (sha256(bytes) !== span.sourceHash || quote !== span.quote || sha256(quote) !== span.spanHash) {
      throw Error('Knowledge annotation does not match the original source span')
    }
  }
  const source = await seedReaderFamily(family)
  const originalRelease = source.v4Release
  const work = (await db.works.get(source.scope.workId))!
  const input = { scope: source.scope, owner: { kind: 'work' as const, workCode: work.code }, branchKey: 'canon' }
  const holderKey = source.semanticFor(annotation.holderId)!
  const knowledgeId = source.localIds.get(annotation.recordId)!
  const knowledge = (await db.knowledgeLedger.get(knowledgeId))!
  const visibility = { class: 'restricted' as const, audienceKeys: [`character:${holderKey}`], policyVersion: 'reader-clock-grounded-v1' }
  async function confirm(table: string, recordId: number, annotations: Partial<NarrativeDomainFieldsV1>) {
    const capture = await captureNarrativeDomainV1(input)
    const row = capture.rows.get(table)!.find(item => item.id === recordId)!
    return confirmNarrativeDomainAnnotationsV1({ scope: source.scope, table, recordId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, table, row), annotations })
  }
  function evidence(text: string, field: string, quote: string, key: string): NarrativeDomainEvidenceV1 {
    if (text.split(quote).length !== 2) throw Error('Evidence must identify one exact input span')
    const start = new TextEncoder().encode(text.slice(0, text.indexOf(quote))).length
    return { evidenceKey: key, source: { self: true }, fieldPointer: `/${field}`,
      sourceContentHash: sha256(text), normalizationVersion: 'raw-utf8-v1', start,
      end: start + new TextEncoder().encode(quote).length, spanHash: sha256(quote), supportRole: 'supports' }
  }
  // Permission and character knowledge are separate controls. The default
  // preserves private Canon and demonstrates compiler-v1's conservative omission. The
  // explicit public control permits this proposition to the user, but must
  // still keep its truth out of the mistaken character's query result.
  if (propositionPermission === 'public') await confirm('temporalFacts', source.factIds.get('confirmed')!, {
    narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'reader-clock-permission-control-v1' },
  })
  // WorldGroup is the existing owner of an explicit chronology. This declares
  // only the source's ordinal days; it introduces no alternate world or clock map.
  const groupName = `${family.title}·原文日序`
  const groupId = await db.worldGroups.add(stampNewRecord(source.scope, 'worldGroups', {
    projectId: source.scope.projectId, name: groupName, description: annotation.timeline.boundary,
    type: 'primary' as const, order: 0, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000,
  }, { owner: 'world' })) as number
  await confirm('worldGroups', groupId, { narrativeModalityV1: 'established', narrativeVisibilityV1: visibility,
    narrativeEvidenceV1: [evidence(groupName, 'name', groupName, 'clock-name')],
    narrativeChronologyV1: { timelines: [{ timelineKey: annotation.timeline.timelineKey,
      calendar: annotation.timeline.calendar, unit: annotation.timeline.unit, epoch: annotation.timeline.epoch }], mappings: [] } })
  const acquiredAt: TimePointV1 = { kind: 'tick', timelineKey: annotation.timeline.timelineKey, value: annotation.acquiredDay }
  const through: TimePointV1 = { ...acquiredAt, value: annotation.throughDay }
  const annotations: Partial<NarrativeDomainFieldsV1> = {
    narrativeVisibilityV1: visibility,
    narrativeTimeV1: { occurred: null, valid: null, narratedAt: null, disclosedAt: [], acquiredAt },
    // Do not expose the adjacent clause about the other person's truth, or
    // the narrator's "misbelieves" label, in the character's original spans.
    narrativeEvidenceV1: annotation.characterEvidence.map((span, index) =>
      evidence(knowledge.sourceQuote!, 'sourceQuote', span.quote, `holder-${index}`)),
  }
  await confirm('knowledgeLedger', knowledgeId, annotations)
  async function freeze() {
    const revision = await createWorldRevision({ scope: source.scope, formatVersion: 4, compilerVersion: 'narrative-domain-v1', includeWorkSources: true,
      label: '补充诊断：原文第五日获知与第六日保留信念' })
    const release = await publishWorldRevision(revision.id!)
    const verified = await verifyWorldReleaseRecordV1(release)
    if (verified.version !== 4) throw Error('Grounded knowledge fixture requires v4')
    return { ...source, v4Release: release, projection: verified.manifest.narrative }
  }
  return { family, annotation, propositionPermission, originalRelease, originalFixture: source, fixture: await freeze(), holderKey,
    knowledgeId, annotations, acquiredAt, through, confirm, freeze }
}
