import type { NarrativeEvidenceSourceV1, NarrativeIRBundleV1, NarrativeOwnerV1, NarrativePayloadsV1, NarrativeRecordV1, SemanticKindV1, SemanticRefV1 } from '../../src/lib/types/narrative-ir'
import { createNarrativeSemanticIdV1, narrativeOwnerKeyV1 } from '../../src/lib/world-engine/narrative-identity'
import { compileNarrativeIRBundleV1 } from '../../src/lib/world-engine/narrative-ir'
import { hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { unknownNarrativeTimeV1 } from '../../src/lib/world-engine/narrative-time'

export const NW_HASH = '0'.repeat(64)
export const NW_OWNER: NarrativeOwnerV1 = { kind: 'work', workCode: 'WORK-00000000-0000-4000-8000-000000000001' }
export function irSourceIdentity(resourceKind: string, n: number) {
  return { resourceKind, sourceUid: `res:v1:${resourceKind}:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, subKey: 'root' }
}

/** Deterministic annotations for codec tests, not a story extractor. */
export async function narrativeIRFixture(owner: NarrativeOwnerV1 = NW_OWNER) {
  const sourceSpecs = [
    ['entity', 'character', 'character'], ['entity', 'character', 'character'],
    ['event', 'historical-event', 'fact'], ['assertion', 'temporal-fact', 'fact'],
    ['relation', 'character-relation', 'character-relation'], ['rule', 'temporal-fact', 'fact'],
    ['epistemic-event', 'knowledge-event', 'fact'], ['development', 'story-arc', 'story-arc'],
    ['disclosure', 'chapter', 'chapter'],
  ] as const
  const identities = sourceSpecs.map((spec, i) => irSourceIdentity(spec[1], i + 1))
  const ids = identities.map((identity, i) => createNarrativeSemanticIdV1(owner, sourceSpecs[i][0], identity))
  const reference = <K extends SemanticKindV1>(index: number, kind: K): SemanticRefV1<K> => ({ kind, semanticId: ids[index], revisionHash: NW_HASH })
  const sourceText = '沈青把铜钥匙交给另一位沈青。\r\n🗝️ 未公开的去向。'
  const sourceHash = await hashNarrativeBytesV1(sourceText)
  const sources: NarrativeEvidenceSourceV1[] = sourceSpecs.map((spec, i) => ({
    sourceResourceKey: `${spec[2]}:${identities[i].sourceUid}`, sourceRevision: 'source-r1', fieldPointer: '/text', text: sourceText,
  }))
  const payloads: NarrativePayloadsV1[SemanticKindV1][] = [
    { entityType: 'character', canonicalLabel: '沈青', aliases: ['青篙'], sourceIdentity: identities[0] },
    { entityType: 'character', canonicalLabel: '沈青', aliases: ['桥匠'], sourceIdentity: identities[1] },
    { eventType: 'action', participants: [{ entityRef: reference(0, 'entity'), role: 'giver' }, { entityRef: reference(1, 'entity'), role: 'receiver' }],
      locationRefs: [], propositionRefs: [reference(3, 'assertion')], effectRefs: [], communication: null, observerRef: null },
    { subjectRef: reference(1, 'entity'), predicateKey: 'location', value: { kind: 'text', value: '工具箱旁' }, polarity: 'positive', supersedesRefs: [] },
    { fromRef: reference(0, 'entity'), toRef: reference(1, 'entity'), relationType: 'entrusts', direction: 'directed',
      value: { kind: 'boolean', value: true }, causeEventRef: reference(2, 'event') },
    { scopeRefs: [reference(0, 'entity')], statement: '东闸只能用铜钥匙开启', strength: 'advisory', validatorRef: null, preconditionRefs: [reference(3, 'assertion')] },
    { holderRef: reference(0, 'entity'), propositionRef: reference(3, 'assertion'), assertedValue: { kind: 'text', value: '茶摊' },
      transition: 'acquire', attitude: 'believe', sourceEventRef: reference(2, 'event'), revisesRef: null },
    { developmentType: 'commitment', ownerRefs: [reference(1, 'entity')], memberRefs: [reference(2, 'event')], state: 'open', transitionEventRefs: [], resolutionEvidenceIds: [] },
    { subjectRefs: [reference(2, 'event')], audienceKeys: ['reader'], sequenceKey: 'main-sequence', unitKey: identities[8].sourceUid, spanRef: 'evidence-9' },
  ]
  const scope = { owner, worldGroupKey: null, branchKey: 'canon', revisionVectorHash: 'a'.repeat(64) }
  const records = sourceSpecs.map((spec, i) => ({
    irVersion: 1, semanticId: ids[i], revisionHash: NW_HASH, kind: spec[0], scope: structuredClone(scope),
    modality: i === 6 ? 'belief' : i === 7 ? 'intent' : 'established', reviewState: 'accepted', authority: 'author-confirmed', confidence: null,
    time: unknownNarrativeTimeV1(), perspectiveKeys: [], visibility: { class: 'author-only', audienceKeys: [], policyVersion: 'policy-1' },
    evidenceIds: [`evidence-${i + 1}`], dependencies: [], provenance: { sourceResourceKey: sources[i].sourceResourceKey,
      sourceField: '/text', sourceRevision: 'source-r1', sourceContentHash: sourceHash, adoptionReceiptRef: 'author-confirmation-1', manualDeclarationRef: null },
    authorCreatedAt: 1, authorUpdatedAt: 2, payload: payloads[i],
  })) as NarrativeRecordV1[]
  const input: Omit<NarrativeIRBundleV1, 'schema' | 'irVersion' | 'semanticRootHash'> = {
    scope, records,
    evidence: sources.map((source, i) => ({ evidenceId: `evidence-${i + 1}`, sourceResourceKey: source.sourceResourceKey,
      fieldPointer: source.fieldPointer, sourceRevision: source.sourceRevision, sourceContentHash: sourceHash,
      normalizationVersion: 'raw-utf8-v1', start: 0, end: new TextEncoder().encode(sourceText).length, spanHash: sourceHash, supportRole: 'supports' })),
    aliases: [], timeContext: { version: 1,
      timelines: [{ timelineKey: 'days', worldKey: narrativeOwnerKeyV1(owner), branchKey: 'canon', calendar: 'fictional-days', unit: 'day', epoch: 'day-zero' }],
      sequences: [{ sequenceKey: 'main-sequence', ownerKey: narrativeOwnerKeyV1(owner), revision: 'sequence-1', units: [{ unitKey: identities[8].sourceUid, ordinal: 7 }] }],
      anchors: [{ eventKey: ids[2], timelineKey: 'days', value: '2' }], before: [], mappings: [],
    },
  }
  input.records[2].time.occurred = { start: { kind: 'tick', timelineKey: 'days', value: '2' }, end: { kind: 'tick', timelineKey: 'days', value: '2' }, endMeaning: 'known' }
  input.records[2].time.disclosedAt = [{ audienceKey: 'reader', sequenceKey: 'main-sequence', unitKey: identities[8].sourceUid }]
  input.records[6].time.acquiredAt = { kind: 'tick', timelineKey: 'days', value: '5' }
  return { input, sources, ids, identities, bundle: await compileNarrativeIRBundleV1(input, sources) }
}
