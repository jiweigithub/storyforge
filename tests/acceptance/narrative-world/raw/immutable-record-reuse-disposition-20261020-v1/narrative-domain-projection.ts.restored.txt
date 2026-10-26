import { narrativeDomainTableV1 } from './narrative-domain-registry'
import type { NarrativeDomainRegistryV1 } from '../types/narrative-domain-registry'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import type { Chapter, OutlineNode } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import type { NarrativeDomainAtomRefV1, NarrativeDomainMetadataV1, NarrativeDomainValueV1, NarrativeDomainTimePointV1 } from '../types/narrative-domain'
import type { NarrativeEvidenceSourceV1, EvidenceSpanV1, NarrativeOwnerV1, NarrativeRecordV1,
  SemanticKindV1, SemanticRefV1, TypedValueV1, NarrativeEnvelopeV1 } from '../types/narrative-ir'
import type { NarrativeTimeContextV1, NarrativeTimeV1, TimePointV1 } from '../types/narrative-time'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1, resolveNarrativeDomainGroupV1, type NarrativeDomainCaptureV1, type NarrativeDomainRowV1 } from './narrative-domain-capture'
import { compileNarrativeDomainEvidenceV1, narrativeDomainEvidenceSourceV1, resolveNarrativeDomainReferenceV1,
  narrativeDevelopmentStatementPointerV1, narrativeDomainEvidenceVisibilityV1 } from './narrative-domain-evidence'
import { createNarrativeSemanticIdV1, freezeNarrativeChapterSequenceV1, narrativeOwnerKeyV1 } from './narrative-identity'
import { compileImmutableNarrativeIRV1, compileNarrativeIRBundleV1 } from './narrative-ir'
import { forEachNarrativeReferenceV1, parseNarrativeRecordV1 } from './narrative-ir-codec'
import { mapNarrativeDomainReferencesV1 } from '../narrative-domain/codec'
import { canonicalNarrativeJsonV1, compareUnicodeCodePointsV1, hashNarrativeBytesV1, hashNarrativeValueV1,
  NarrativeContractErrorV1, narrativeFail } from './narrative-json'
import { parseNarrativeTimeContextV1, validateNarrativeTimeReferencesV1 } from './narrative-time'
import { intersectNarrativeVisibilityV1 } from '../narrative-domain/visibility'

const UNBOUND = '0'.repeat(64)
const emptyTime = (): NarrativeTimeV1 => ({ occurred: null, valid: null, narratedAt: null, disclosedAt: [], acquiredAt: null })
type Source = { table: string; key: string; row: NarrativeDomainRowV1; hash: string }
export type { NarrativeProjectionGapV1, NarrativeProjectionCoverageV1, NarrativeDomainProjectionV1 } from '../types/narrative-projection'
import { NARRATIVE_DOMAIN_COMPILERS_V4, type NarrativeDomainCompilerV4 } from '../types/narrative-release'
import type { NarrativeProjectionCoverageV1, NarrativeDomainProjectionV1 } from '../types/narrative-projection'

function reason(error: unknown): { code: string; detail: string } {
  if (!(error instanceof NarrativeContractErrorV1)) throw error
  return { code: error.code, detail: error.message }
}
function pointer(field: string): string { return `/${field.replace(/~/g, '~0').replace(/\//g, '~1')}` }
function knownSourceKey(registry: NarrativeDomainRegistryV1, table: string, row: NarrativeDomainRowV1): string {
  const identity = narrativeDomainTableV1(registry, table).resourceIdentity
  const uid = identity && row[identity.field]
  if (!identity || !isPortableResourceUidV1(uid, identity.resourceKind)) narrativeFail('source-uid', `${table} 来源缺少稳定 UID`)
  return `${identity.contextKind}:${uid}`
}


/** Deterministic domain compilation. It never calls a provider, allocates IDs,
 * adopts a candidate, repairs author data or reads a product runtime. */
export async function projectNarrativeDomainsV1(input: {
  scope: WorkspaceScope; owner: NarrativeOwnerV1; branchKey: string; selectedSourceKeys?: readonly string[]
  compilerVersion?: NarrativeDomainCompilerV4
}): Promise<NarrativeDomainProjectionV1> {
  return projectNarrativeDomainCaptureV1(await captureNarrativeDomainV1(input), input)
}

export async function projectNarrativeDomainCaptureV1(capture: NarrativeDomainCaptureV1, input: {
  branchKey: string; selectedSourceKeys?: readonly string[]
  /** Omission preserves the historical standalone projection. Release entry
   * points always pass the compiler committed in their frozen input. */
  compilerVersion?: NarrativeDomainCompilerV4
  /** Internal compiler ownership only; never changes the projection bytes. */
  immutableIR?: boolean
}): Promise<NarrativeDomainProjectionV1> {
  if (input.compilerVersion !== undefined && !NARRATIVE_DOMAIN_COMPILERS_V4.includes(input.compilerVersion)) {
    narrativeFail('compiler-version', '叙事投影编译器版本不受支持')
  }
  // This index belongs to this one captured projection, never to mutable DB
  // state. Keep all project peers so a collision in another Work still fails.
  const peerUidCounts = new Map<string, Map<string, number>>()
  const semanticId = (table: string, row: NarrativeDomainRowV1, kind: SemanticKindV1, subKey = 'root'): string => {
    knownSourceKey(capture.registry, table, row)
    const spec = narrativeDomainTableV1(capture.registry, table)
    const sourceUid = row[spec.resourceIdentity!.field] as string
    let counts = peerUidCounts.get(table)
    if (!counts) {
      counts = new Map()
      for (const peer of capture.peers.get(table) ?? []) {
        const uid = String(peer[spec.resourceIdentity!.field]).toLowerCase()
        counts.set(uid, (counts.get(uid) ?? 0) + 1)
      }
      peerUidCounts.set(table, counts)
    }
    if (counts.get(sourceUid.toLowerCase()) !== 1) narrativeFail('duplicate-uid', '来源 UID 在当前工作区不唯一')
    return createNarrativeSemanticIdV1(capture.owner, kind, { resourceKind: spec.resourceIdentity!.resourceKind, sourceUid, subKey })
  }
  const coverage: NarrativeProjectionCoverageV1 = { version: 1, eligibleSelected: [], projectedSourceKeys: [],
    explicitlyUnsupportedSourceKeys: [], gaps: [], excluded: [], fields: [], declaredAtoms: 0, projectedAtoms: 0, sourceSpans: [] }
  const selected = input.selectedSourceKeys && new Set(input.selectedSourceKeys)
  if (selected && selected.size !== input.selectedSourceKeys!.length) narrativeFail('selection', '来源选择重复')
  const seenKeys = new Set<string>(), inputs: Source[] = []
  const eligibleRows: Array<{ key: string; table: string; row: NarrativeDomainRowV1 }> = []
  for (const spec of capture.registry.tables.filter(item => item.worldSemantic)) for (const row of capture.rows.get(spec.name) ?? []) {
    let key: string
    try { key = knownSourceKey(capture.registry, spec.name, row) } catch (error) {
      coverage.excluded.push({ sourceKey: `unaddressable:${spec.name}`, table: spec.name, ...reason(error) }); continue
    }
    if (seenKeys.has(key)) narrativeFail('duplicate-uid', '同一来源 key 不能对应多条记录')
    seenKeys.add(key)
    if (selected && !selected.has(key)) continue
    const gap = (code: string, detail: string) => ({ sourceKey: key, table: spec.name, code, detail })
    const status = spec.worldSemantic!.statusField ? row[spec.worldSemantic!.statusField!] : undefined
    const allowedStatus = status === 'confirmed' || (spec.name === 'temporalFacts' && status === 'superseded')
    if (spec.worldSemantic!.canonPolicy === 'confirmed-rows-only' && !allowedStatus) {
      coverage.excluded.push(gap('not-confirmed', `来源状态 ${String(status)} 不可作为已确认语义`)); continue
    }
    coverage.eligibleSelected.push(key)
    eligibleRows.push({ key, table: spec.name, row })
    if (!spec.worldSemantic!.projector) {
      coverage.gaps.push(gap('projector-unavailable', '此领域仍只有原始资料，尚无已登记原子投影')); continue
    }
    try {
      const hash = await hashNarrativeDomainSourceV1(capture, spec.name, row)
      if (!row.narrativeAuthorityV1) narrativeFail('review-required', '旧来源缺少显式语义确认；不能推断已发生、可见范围或因果')
      if (row.narrativeAuthorityV1.contentHash !== hash) narrativeFail('stale', '确认后来源或注释发生变化')
      for (const field of spec.worldSemantic!.projector!.annotationFields) if (row[field] !== undefined) {
        mapNarrativeDomainReferencesV1(field, row[field], reference => { resolveNarrativeDomainReferenceV1(capture, reference); return reference })
      }
      inputs.push({ table: spec.name, key, row, hash })
    } catch (error) { coverage.gaps.push({ sourceKey: key, table: spec.name, ...reason(error) }) }
  }
  if (selected && [...selected].some(key => !seenKeys.has(key))) narrativeFail('selection', '选择包含不存在或越界来源')
  const sequenceKey = `chapters:${narrativeOwnerKeyV1(capture.owner)}`
  const frozen = freezeNarrativeChapterSequenceV1({ owner: capture.owner, sequenceKey, revision: 'preparing',
    chapters: (capture.rows.get('chapters') ?? []) as unknown as Chapter[],
    outlineNodes: (capture.rows.get('outlineNodes') ?? []) as unknown as OutlineNode[] })
  if (frozen.sequence) frozen.sequence.revision = await hashNarrativeValueV1(frozen.sequence.units)
  const vector = await Promise.all(inputs.map(async source => {
    const proofs: unknown[] = []
    const metadata = [source.row, ...(source.row.narrativeDevelopmentsV1 ?? []), ...(source.row.narrativeDisclosuresV1 ?? [])]
    for (const group of metadata) for (const annotation of group.narrativeEvidenceV1 ?? []) {
      try {
        const target = 'self' in annotation.source ? { table: source.table, row: source.row }
          : resolveNarrativeDomainReferenceV1(capture, annotation.source)
        const current = await narrativeDomainEvidenceSourceV1(target.table, target.row, annotation.fieldPointer, capture.registry)
        proofs.push([annotation.evidenceKey, current.sourceResourceKey, current.fieldPointer, current.sourceRevision,
          narrativeDomainEvidenceVisibilityV1(target.table, target.row, annotation.fieldPointer, capture.registry)])
      } catch (error) { proofs.push([annotation.evidenceKey, reason(error).code]) }
    }
    return { key: source.key, hash: source.hash, receipt: source.row.narrativeAuthorityV1!,
      createdAt: source.row.createdAt ?? null, updatedAt: source.row.updatedAt ?? source.row.createdAt ?? null, proofs }
  }))
  vector.sort((a, b) => compareUnicodeCodePointsV1(a.key, b.key))
  const revisionVectorHash = await hashNarrativeValueV1({ vector, sequence: frozen.sequence })
  const scope = { owner: capture.owner, worldGroupKey: null, branchKey: input.branchKey, revisionVectorHash }
  const timeContext: NarrativeTimeContextV1 = { version: 1, timelines: [], sequences: frozen.sequence ? [frozen.sequence] : [],
    anchors: [], before: [], mappings: [] }
  const records: NarrativeRecordV1[] = [], evidence: EvidenceSpanV1[] = [], sources: NarrativeEvidenceSourceV1[] = []
  const sourceForRecord = new Map<string, Source>()
  const dependencyEvidence: NarrativeDomainProjectionV1['dependencyEvidence'] = []
  const ref = <K extends SemanticKindV1>(atom: NarrativeDomainAtomRefV1<K>): SemanticRefV1<K> => {
    const target = resolveNarrativeDomainReferenceV1(capture, atom.source)
    return { kind: atom.kind, semanticId: semanticId(target.table, target.row, atom.kind, atom.subKey), revisionHash: UNBOUND }
  }
  const entity = (value: Parameters<typeof resolveNarrativeDomainReferenceV1>[1]): SemanticRefV1<'entity'> => ref({ kind: 'entity', source: value, subKey: 'root' })
  const registeredFk = <K extends SemanticKindV1>(source: Source, field: string, kind: K): SemanticRefV1<K> => {
    const remap = narrativeDomainTableV1(capture.registry, source.table).exportRemap?.find(item => item.field === field)
    const target = remap && capture.rows.get(remap.remapVia)?.find(row => row.id === source.row[field])
    if (!remap || !target) narrativeFail('source-missing', `${source.table}.${field} 没有可解析的同作用域来源`)
    return { kind, semanticId: semanticId(remap.remapVia, target, kind), revisionHash: UNBOUND }
  }
  const value = (input: NarrativeDomainValueV1): TypedValueV1 => input.kind === 'entity-ref' ? { kind: 'entity-ref', value: entity(input.value) }
    : input.kind === 'ordered-set' ? { kind: 'ordered-set', values: input.values.map(value) } : input
  const point = (input: NarrativeDomainTimePointV1 | null): TimePointV1 | null => input?.kind === 'event-anchor'
    ? { kind: 'event-anchor', eventKey: ref(input.event).semanticId, side: input.side } : input
  const time = (metadata: NarrativeDomainMetadataV1): NarrativeTimeV1 => {
    const input = metadata.narrativeTimeV1
    if (!input) return emptyTime()
    const chapter = (reference: Parameters<typeof resolveNarrativeDomainReferenceV1>[1]) => {
      const target = resolveNarrativeDomainReferenceV1(capture, reference)
      if (!frozen.sequence || !frozen.sequence.units.some(unit => unit.unitKey === target.row.ragDocumentId)) {
        narrativeFail('sequence-unavailable', '章节不在有效的冻结规范章序中')
      }
      return { sequenceKey, unitKey: target.row.ragDocumentId as string }
    }
    return { occurred: input.occurred && { ...input.occurred, start: point(input.occurred.start)!, end: point(input.occurred.end) },
      valid: input.valid && { ...input.valid, start: point(input.valid.start)!, end: point(input.valid.end) },
      narratedAt: input.narratedAt && { ...chapter(input.narratedAt.chapter), spanStart: input.narratedAt.spanStart },
      disclosedAt: input.disclosedAt.map(item => ({ ...chapter(item.chapter), audienceKey: item.audienceKey })), acquiredAt: point(input.acquiredAt) }
  }
  const envelope = async (source: Source, kind: SemanticKindV1, metadata: NarrativeDomainMetadataV1, subKey = 'root'): Promise<NarrativeEnvelopeV1> => {
    const spec = narrativeDomainTableV1(capture.registry, source.table), id = semanticId(source.table, source.row, kind, subKey)
    const provenance = await narrativeDomainEvidenceSourceV1(source.table, source.row, kind === 'development'
      ? narrativeDevelopmentStatementPointerV1(subKey) : pointer(spec.worldSemantic!.projector!.provenanceField), capture.registry)
    provenance.sourceRevision = source.hash
    sources.push(provenance)
    const receipt = source.row.narrativeAuthorityV1!
    const localEvidence = new Map<string, string>()
    const inheritedVisibility = [source.row.narrativeVisibilityV1 ?? { class: 'unclassified' as const, audienceKeys: [], policyVersion: 'unclassified-v1' }]
    for (const annotation of metadata.narrativeEvidenceV1 ?? []) {
      const id = `evidence:v1:${encodeURIComponent(source.key)}:${encodeURIComponent(subKey)}:${encodeURIComponent(annotation.evidenceKey)}`
      const compiled = await compileNarrativeDomainEvidenceV1(capture, source.table, source.row, annotation, id)
      evidence.push(compiled.evidence); sources.push(compiled.source); localEvidence.set(annotation.evidenceKey, id)
      const target = 'self' in annotation.source ? source : resolveNarrativeDomainReferenceV1(capture, annotation.source)
      inheritedVisibility.push(narrativeDomainEvidenceVisibilityV1(target.table, target.row, annotation.fieldPointer, capture.registry))
    }
    if ((metadata.narrativeEvidenceV1 ?? []).some(item => item.supportRole === 'contradicts')) narrativeFail('evidence-conflict', '反证尚未裁决，不能当成已确认 Canon')
    const dependencies = (metadata.narrativeDependenciesV1 ?? []).map(dependency => {
      if (!dependency.evidenceKeys.length || dependency.evidenceKeys.some(key => !localEvidence.has(key))) {
        narrativeFail('dependency-evidence', '依赖/因果边必须绑定本记录的明确证据')
      }
      if (dependency.evidenceKeys.some(key => !metadata.narrativeEvidenceV1?.some(item => item.evidenceKey === key && item.supportRole === 'supports'))) {
        narrativeFail('dependency-evidence', '背景资料不能单独充当确定性依赖/因果支持')
      }
      const target = ref(dependency.target)
      dependencyEvidence.push({ fromSemanticId: id, toSemanticId: target.semanticId, role: dependency.role,
        evidenceIds: dependency.evidenceKeys.map(key => localEvidence.get(key)!) })
      return { semanticId: target.semanticId, revisionHash: UNBOUND, role: dependency.role }
    })
    // Structural references are requirements, not inferred causal claims. They
    // bind chronology and group visibility just like typed payload references.
    const requires = (semanticId: string) => {
      if (semanticId !== id && !dependencies.some(item => item.semanticId === semanticId && item.role === 'requires')) {
        dependencies.push({ semanticId, revisionHash: UNBOUND, role: 'requires' })
      }
    }
    const requireGroup = (group: NarrativeDomainRowV1) => requires(semanticId('worldGroups', group, 'entity'))
    const originGroup = resolveNarrativeDomainGroupV1(capture, source.table, source.row)
    if (originGroup) requireGroup(originGroup)
    const temporal = metadata.narrativeTimeV1
    const points = [temporal?.occurred?.start, temporal?.occurred?.end, temporal?.valid?.start, temporal?.valid?.end, temporal?.acquiredAt]
    for (const point of points) {
      if (point?.kind === 'event-anchor') requires(ref(point.event).semanticId)
      if (point?.kind === 'tick') {
        const groups = (capture.rows.get('worldGroups') ?? []).filter(group => group.narrativeChronologyV1?.timelines
          .some(timeline => timeline.timelineKey === point.timelineKey))
        if (groups.length !== 1) narrativeFail('time-reference', '时间点必须引用唯一显式时制')
        requireGroup(groups[0])
      }
    }
    for (const mapping of source.row.narrativeChronologyV1?.mappings ?? []) {
      requireGroup(resolveNarrativeDomainReferenceV1(capture, mapping.targetWorldGroup).row)
      if (!mapping.evidenceKeys.length || mapping.evidenceKeys.some(key => !metadata.narrativeEvidenceV1?.some(
        item => item.evidenceKey === key && item.supportRole === 'supports'))) narrativeFail('mapping-evidence', '时制映射必须绑定明确支持证据')
    }
    const modality = metadata.narrativeModalityV1 ?? (kind === 'development' ? 'intent' : kind === 'epistemic-event' ? 'belief' : 'established')
    const visibility = metadata.narrativeVisibilityV1 ?? { class: modality === 'intent' ? 'author-only' as const : 'unclassified' as const,
      audienceKeys: [], policyVersion: 'unclassified-v1' }
    return { irVersion: 1, semanticId: id, revisionHash: UNBOUND, kind, scope, modality,
      reviewState: source.table === 'temporalFacts' && source.row.status === 'superseded' ? 'historical' : 'accepted',
      authority: receipt.mode === 'author-declaration' ? 'author-declared' : 'author-confirmed', confidence: null,
      time: time(metadata), perspectiveKeys: [], visibility: intersectNarrativeVisibilityV1(visibility, inheritedVisibility), evidenceIds: [...localEvidence.values()], dependencies,
      provenance: { sourceResourceKey: source.key, sourceField: provenance.fieldPointer, sourceRevision: provenance.sourceRevision,
        sourceContentHash: await hashNarrativeBytesV1(provenance.text),
        adoptionReceiptRef: receipt.mode === 'candidate-adoption' ? receipt.confirmationUid : null,
        manualDeclarationRef: receipt.mode === 'author-declaration' ? receipt.confirmationUid : null },
      authorCreatedAt: Number(source.row.createdAt), authorUpdatedAt: Number(source.row.updatedAt ?? source.row.createdAt) }
  }
  const add = (source: Source, record: NarrativeRecordV1) => {
    records.push(parseNarrativeRecordV1(record)); sourceForRecord.set(record.semanticId, source)
  }
  for (const source of inputs) {
    const row = source.row, spec = narrativeDomainTableV1(capture.registry, source.table), projector = spec.worldSemantic!.projector!
    coverage.declaredAtoms += projector.kind === 'development' ? row.narrativeDevelopmentsV1?.length ?? 0
      : projector.kind === 'disclosure' ? row.narrativeDisclosuresV1?.length ?? 0
        : projector.kind === 'assertion' && row.narrativeRuleV1 ? 2 : 1
    const beforeCount = records.length
    try {
      if (projector.kind === 'entity') {
        if (!spec.resourceIdentity?.narrativeEntityType) narrativeFail('entity-kind', '来源未登记实体类型')
        const base = await envelope(source, 'entity', row)
        add(source, { ...base, kind: 'entity', payload: { entityType: spec.resourceIdentity.narrativeEntityType,
          canonicalLabel: String(row.name), aliases: row.narrativeAliasesV1 ?? [], sourceIdentity: {
            resourceKind: spec.resourceIdentity.resourceKind, sourceUid: row[spec.resourceIdentity.field] as string, subKey: 'root' } } })
      } else if (projector.kind === 'event') {
        const payload = row.narrativeEventV1
        if (!payload) narrativeFail('event-metadata', '事件缺少参与者/传播方式等显式语义；自由文本不自动抽取')
        const base = await envelope(source, 'event', row)
        base.dependencies = [...new Map([...base.dependencies, ...payload.before.map(item => ({
          semanticId: ref(item).semanticId, revisionHash: UNBOUND, role: 'requires' as const,
        }))].map(item => [`${item.semanticId}:${item.role}`, item])).values()]
        add(source, { ...base, kind: 'event', payload: {
          eventType: payload.eventType, participants: payload.participants.map(item => ({ entityRef: entity(item.entity), role: item.role })),
          locationRefs: payload.locations.map(entity), propositionRefs: payload.propositions.map(ref), effectRefs: payload.effects.map(ref),
          communication: payload.communication && { senderRef: entity(payload.communication.sender), recipientRefs: payload.communication.recipients.map(entity), channel: payload.communication.channel },
          observerRef: payload.observer && entity(payload.observer),
        } })
      } else if (projector.kind === 'assertion') {
        const predicate = capture.registry.predicates.find(item => item.key === String(row.predicate))
        if (!predicate || row.factKind === 'derived') narrativeFail('predicate-unavailable', '派生或未登记谓词不能冒充作者事实')
        const subjects = ['characterId', 'locationId', 'codexEntryId', 'subjectWorldGroupId', 'storyArcId'].filter(field => row[field] != null)
        if (subjects.length !== 1 || subjects[0] === 'storyArcId') narrativeFail('subject-unavailable', '事实必须引用唯一已登记实体主体')
        const subjectType = { characterId: 'character', locationId: 'location', codexEntryId: 'codexEntry', subjectWorldGroupId: 'worldGroup' }[subjects[0]]
        if (!predicate.subjectTypes.includes(subjectType as typeof predicate.subjectTypes[number])) narrativeFail('predicate-subject', '主体类型不在该谓词允许范围内')
        const subjectRef = registeredFk(source, subjects[0], 'entity')
        let typed: TypedValueV1
        if (predicate.valueType === 'entity-ref') {
          const objects = ['objectCharacterId', 'objectLocationId', 'objectCodexEntryId'].filter(field => row[field] != null)
          if (objects.length !== 1) narrativeFail('predicate-value', '实体值必须有唯一类型化 FK')
          typed = { kind: 'entity-ref', value: registeredFk(source, objects[0], 'entity') }
        } else if (predicate.valueType === 'boolean') {
          if (row.value !== 'true' && row.value !== 'false') narrativeFail('predicate-value', '布尔事实必须规范编码')
          typed = { kind: 'boolean', value: row.value === 'true' }
        } else if (predicate.valueType === 'number') typed = { kind: 'decimal', value: String(row.value), unit: null }
        else if (predicate.valueType === 'enum') {
          if (!predicate.enums?.includes(String(row.value))) narrativeFail('predicate-value', '枚举事实不在谓词闭集中')
          typed = { kind: 'enum', value: String(row.value) }
        }
        else if (predicate.valueType === 'string') typed = { kind: 'text', value: String(row.value) }
        else narrativeFail('predicate-value', '任意 JSON 不能自动映射为强类型事实')
        const base = await envelope(source, 'assertion', row)
        if (base.modality !== 'established') narrativeFail('fact-modality', 'Canon 事实不能被注释改写成角色误信或未来计划')
        add(source, { ...base, kind: 'assertion', payload: { subjectRef, predicateKey: predicate.key, value: typed,
          polarity: row.narrativeAssertionV1?.polarity ?? 'positive',
          supersedesRefs: row.supersedesFactId == null ? [] : [registeredFk(source, 'supersedesFactId', 'assertion')] } })
        if (row.narrativeRuleV1) {
          if (!predicate.constitution) narrativeFail('rule-predicate', '只有已登记宪法谓词能投影为规则')
          add(source, { ...await envelope(source, 'rule', row), kind: 'rule', payload: { scopeRefs: [subjectRef],
            statement: String(row.value), strength: 'advisory', validatorRef: null, preconditionRefs: row.narrativeRuleV1.preconditions.map(ref) } })
        }
      } else if (projector.kind === 'relation') {
        if (row.narrativeRelationV1?.causeEvent && !row.narrativeEvidenceV1?.some(item => item.supportRole === 'supports')) {
          narrativeFail('dependency-evidence', '关系变化的原因必须有支持证据')
        }
        add(source, { ...await envelope(source, 'relation', row), kind: 'relation', payload: {
          fromRef: registeredFk(source, 'fromCharacterId', 'entity'), toRef: registeredFk(source, 'toCharacterId', 'entity'),
          relationType: String(row.relationType), direction: row.isBidirectional === true ? 'symmetric' : 'directed',
          value: { kind: 'text', value: String(row.label) }, causeEventRef: row.narrativeRelationV1?.causeEvent ? ref(row.narrativeRelationV1.causeEvent) : null,
        } })
      } else if (projector.kind === 'epistemic-event') {
        const payload = row.narrativeEpistemicV1
        if (!payload) narrativeFail('epistemic-metadata', '认知缺少显式命题值、态度和修正链注释')
        if ((row.action === 'mislearn' && payload.attitude !== 'believe')
          || (row.action === 'correct' && payload.transition !== 'revise')
          || (row.action === 'forget' && payload.transition !== 'forget')
          || (row.action === 'learn' && payload.transition !== 'acquire')
          || (row.action === 'mislearn' && (payload.transition !== 'acquire' || payload.assertedValue.kind !== 'text'
            || payload.assertedValue.value !== row.belief))) narrativeFail('epistemic-conflict', '新注释与已有认知动作或误信原值冲突')
        add(source, { ...await envelope(source, 'epistemic-event', row), kind: 'epistemic-event', payload: {
          holderRef: registeredFk(source, 'characterId', 'entity'), propositionRef: registeredFk(source, 'factId', 'assertion'),
          assertedValue: value(payload.assertedValue), transition: payload.transition, attitude: payload.attitude,
          sourceEventRef: payload.sourceEvent && ref(payload.sourceEvent),
          revisesRef: payload.revises && ref({ kind: 'epistemic-event', source: payload.revises, subKey: 'root' }),
        } })
      } else if (projector.kind === 'development') {
        if (!row.narrativeDevelopmentsV1?.length) narrativeFail('development-metadata', '计划文本尚未标注稳定发展原子')
        for (const item of row.narrativeDevelopmentsV1) {
          const metadata = { ...row, ...item }, base = await envelope(source, 'development', metadata, item.semanticSubKey)
          const resolved = item.state === 'resolved' || item.state === 'fulfilled'
          if ((row.status === 'planned' && base.modality !== 'intent') || (resolved && (base.modality !== 'established'
            || !item.resolutionEvidenceKeys.length))) narrativeFail('development-evidence', '计划不能冒充已兑现；兑现必须有明确证据')
          const evidenceIds = item.resolutionEvidenceKeys.map(key => {
            const id = `evidence:v1:${encodeURIComponent(source.key)}:${encodeURIComponent(item.semanticSubKey)}:${encodeURIComponent(key)}`
            if (!base.evidenceIds.includes(id)) narrativeFail('development-evidence', '兑现证据不在该发展原子中')
            return id
          })
          add(source, { ...base, kind: 'development', payload: { developmentType: item.developmentType, ownerRefs: item.owners.map(entity),
            memberRefs: item.members.map(ref), state: item.state, transitionEventRefs: item.transitions.map(ref), resolutionEvidenceIds: evidenceIds } })
        }
      } else if (projector.kind === 'disclosure') {
        if (!row.narrativeDisclosuresV1?.length) narrativeFail('disclosure-metadata', '正文未标注揭示原子，不自动推断谁知道')
        for (const item of row.narrativeDisclosuresV1) {
          const base = await envelope(source, 'disclosure', { ...row, ...item }, item.semanticSubKey)
          const spanRef = `evidence:v1:${encodeURIComponent(source.key)}:${encodeURIComponent(item.semanticSubKey)}:${encodeURIComponent(item.evidenceKey)}`
          if (!base.evidenceIds.includes(spanRef)) narrativeFail('disclosure-evidence', '揭示缺少原文证据')
          add(source, { ...base, kind: 'disclosure', payload: { subjectRefs: item.subjects.map(ref), audienceKeys: item.audienceKeys,
            sequenceKey, unitKey: row.ragDocumentId as string, spanRef } })
        }
      }
    } catch (error) {
      records.splice(beforeCount)
      coverage.gaps.push({ sourceKey: source.key, table: source.table, ...reason(error) })
    }
  }
  // Time definitions are domain content, not runtime clocks. Missing or invalid
  // definitions invalidate their dependent atoms; no date-string guessing.
  const chronologySources = inputs.filter(source => source.row.narrativeChronologyV1
    && records.some(record => record.kind === 'entity' && record.payload.entityType === 'world-group' && record.provenance.sourceResourceKey === source.key))
  for (const source of chronologySources) {
    for (const timeline of source.row.narrativeChronologyV1!.timelines) timeContext.timelines.push({ ...timeline,
      worldKey: source.row.ragDocumentId as string, branchKey: input.branchKey })
    for (const mapping of source.row.narrativeChronologyV1!.mappings) timeContext.mappings.push({
      mappingKey: mapping.mappingKey, revision: source.hash, fromTimelineKey: mapping.fromTimelineKey, toTimelineKey: mapping.toTimelineKey,
      fromStart: mapping.fromStart, fromEnd: mapping.fromEnd, numerator: mapping.numerator, denominator: mapping.denominator, offset: mapping.offset,
      evidenceIds: mapping.evidenceKeys.map(key => `evidence:v1:${encodeURIComponent(source.key)}:root:${encodeURIComponent(key)}`),
      confirmationRef: source.row.narrativeAuthorityV1!.confirmationUid,
    })
  }
  for (const record of records) if (record.kind === 'event') {
    const start = record.time.occurred?.start
    if (start?.kind === 'tick' && timeContext.timelines.some(timeline => timeline.timelineKey === start.timelineKey)) {
      timeContext.anchors.push({ eventKey: record.semanticId, timelineKey: start.timelineKey, value: start.value })
    }
  }
  // An explicit event anchor can inherit its referenced clock, but cannot
  // invent a tick. Only an explicit "at" anchor inherits the exact value.
  for (;;) {
    let progress = false
    for (const record of records) if (record.kind === 'event' && record.time.occurred?.start.kind === 'event-anchor'
      && !timeContext.anchors.some(anchor => anchor.eventKey === record.semanticId)) {
      const start = record.time.occurred.start, target = timeContext.anchors.find(anchor => anchor.eventKey === start.eventKey)
      if (!target) continue
      timeContext.anchors.push({ eventKey: record.semanticId, timelineKey: target.timelineKey, value: start.side === 'at' ? target.value : null })
      if (start.side === 'before') timeContext.before.push({ beforeEventKey: record.semanticId, afterEventKey: target.eventKey })
      if (start.side === 'after') timeContext.before.push({ beforeEventKey: target.eventKey, afterEventKey: record.semanticId })
      progress = true
    }
    if (!progress) break
  }
  const invalidTime = new Set<string>()
  for (const record of records) if (record.kind === 'event') {
    const source = sourceForRecord.get(record.semanticId)!
    for (const later of source.row.narrativeEventV1?.before ?? []) {
      const laterId = ref(later).semanticId
      if (timeContext.anchors.some(anchor => anchor.eventKey === record.semanticId) && timeContext.anchors.some(anchor => anchor.eventKey === laterId)) {
        timeContext.before.push({ beforeEventKey: record.semanticId, afterEventKey: laterId })
      } else {
        invalidTime.add(record.semanticId)
        coverage.gaps.push({ sourceKey: source.key, table: source.table, code: 'time-reference', detail: '相对顺序缺少同包可解析的事件时制' })
      }
    }
  }
  timeContext.before = [...new Map(timeContext.before.map(edge => [canonicalNarrativeJsonV1(edge), edge])).values()]
  for (const source of chronologySources) for (const mapping of source.row.narrativeChronologyV1!.mappings) {
    const target = resolveNarrativeDomainReferenceV1(capture, mapping.targetWorldGroup)
    if (timeContext.timelines.find(timeline => timeline.timelineKey === mapping.fromTimelineKey)?.worldKey !== source.row.ragDocumentId
      || timeContext.timelines.find(timeline => timeline.timelineKey === mapping.toTimelineKey)?.worldKey !== target.row.ragDocumentId) {
      narrativeFail('mapping-scope', '时制映射的来源/目标世界与显式声明不一致')
    }
  }
  // Chronology itself is a closed deterministic contract. Invalid mapping or
  // ordering is actionable input corruption, not a swallowed partial success.
  parseNarrativeTimeContextV1(timeContext)
  let included = records.filter(record => !invalidTime.has(record.semanticId))
  let finalTimeContext = timeContext
  for (;;) {
    const ids = new Set(included.map(record => record.semanticId)), next: NarrativeRecordV1[] = []
    const byId = new Map(included.map(record => [record.semanticId, record]))
    const worlds = new Set([narrativeOwnerKeyV1(capture.owner), ...included.flatMap(record => record.kind === 'entity'
      && record.payload.entityType === 'world-group' ? [record.payload.sourceIdentity.sourceUid] : [])])
    const timelines = timeContext.timelines.filter(timeline => worlds.has(timeline.worldKey))
    const timelineKeys = new Set(timelines.map(timeline => timeline.timelineKey))
    const anchors = timeContext.anchors.filter(anchor => ids.has(anchor.eventKey) && timelineKeys.has(anchor.timelineKey))
    const activeContext = { ...timeContext, timelines, anchors,
      before: timeContext.before.filter(edge => anchors.some(anchor => anchor.eventKey === edge.beforeEventKey) && anchors.some(anchor => anchor.eventKey === edge.afterEventKey)),
      mappings: timeContext.mappings.filter(mapping => timelineKeys.has(mapping.fromTimelineKey) && timelineKeys.has(mapping.toTimelineKey)) }
    for (const record of included) {
      try {
        validateNarrativeTimeReferencesV1(record.time, activeContext)
        forEachNarrativeReferenceV1(record, reference => {
          if (!ids.has(reference.semanticId)) narrativeFail('dependency-gap', '原子引用指向未选入、未确认或无效来源')
        })
        if (record.dependencies.some(item => !ids.has(item.semanticId))) narrativeFail('dependency-gap', '硬依赖闭包不完整')
        if (record.modality === 'established' && record.dependencies.some(item => item.role === 'causes'
          && byId.get(item.semanticId)!.modality === 'intent')) {
          narrativeFail('dependency-state', '未来意图不能作为已发生内容的确定原因')
        }
        const occurred = (event: SemanticRefV1<'event'>) => {
          const target = byId.get(event.semanticId)
          if (!target || target.kind !== 'event' || target.modality !== 'established') {
            narrativeFail('dependency-state', '计划/假设事件不能成为已发生的原因、认知来源或兑现证据')
          }
        }
        if (record.kind === 'relation' && record.payload.causeEventRef) occurred(record.payload.causeEventRef)
        if (record.kind === 'epistemic-event' && record.payload.sourceEventRef) occurred(record.payload.sourceEventRef)
        if (record.kind === 'development' && ['resolved', 'fulfilled'].includes(record.payload.state)) record.payload.transitionEventRefs.forEach(occurred)
        if (record.kind === 'assertion') for (const prior of record.payload.supersedesRefs) {
          const target = byId.get(prior.semanticId)
          if (target?.kind !== 'assertion' || target.payload.predicateKey !== record.payload.predicateKey
            || target.payload.subjectRef.semanticId !== record.payload.subjectRef.semanticId) narrativeFail('supersedes', '历史状态的主体或谓词不一致')
        }
        const narration = record.time.narratedAt
        if (narration && !evidence.some(span => record.evidenceIds.includes(span.evidenceId)
          && span.sourceResourceKey.endsWith(`:${narration.unitKey}`) && narration.spanStart >= span.start && narration.spanStart < span.end
          && sources.some(source => source.sourceResourceKey === span.sourceResourceKey && source.sourceRevision === span.sourceRevision
            && source.fieldPointer === span.fieldPointer && (new TextEncoder().encode(source.text)[narration.spanStart] & 0xc0) !== 0x80))) {
          narrativeFail('narration-evidence', '叙述位置必须落在该记录的实际原文证据中')
        }
        if (record.kind === 'disclosure') {
          if (!activeContext.sequences.some(sequence => sequence.sequenceKey === record.payload.sequenceKey
            && sequence.units.some(unit => unit.unitKey === record.payload.unitKey))
            || !evidence.some(span => span.evidenceId === record.payload.spanRef && span.sourceResourceKey.endsWith(`:${record.payload.unitKey}`))) {
            narrativeFail('disclosure-evidence', '揭示必须有可解析规范章序和同章原文证据')
          }
        }
        next.push(record)
      } catch (error) {
        const source = sourceForRecord.get(record.semanticId)!
        coverage.gaps.push({ sourceKey: source.key, table: source.table, ...reason(error) })
      }
    }
    if (next.length === included.length) { finalTimeContext = activeContext; break }
    included = next
  }
  const includedIds = new Set(included.map(record => record.semanticId))
  // Fixed point over a finite permission lattice, including reciprocal refs.
  // A cycle must not wash a secret into a public derived description.
  for (let pass = 0; pass <= included.length; pass++) {
    const byId = new Map(included.map(record => [record.semanticId, record]))
    let changed = false
    included = included.map(record => {
      const inherited = record.dependencies.map(item => byId.get(item.semanticId)!.visibility)
      forEachNarrativeReferenceV1(record, reference => {
        // v2 preserves this reference's identity/revision/closure validation,
        // but a character's independently authorized asserted value does not
        // derive from Canon truth. Explicit dependencies and evidence above
        // remain permission dependencies; v1 retains every original rule.
        if (input.compilerVersion === 'narrative-domain-v2' && record.kind === 'epistemic-event'
          && reference.kind === 'assertion' && reference.semanticId === record.payload.propositionRef.semanticId) return
        inherited.push(byId.get(reference.semanticId)!.visibility)
      })
      const effective = intersectNarrativeVisibilityV1(record.visibility, inherited)
      if (canonicalNarrativeJsonV1(effective) !== canonicalNarrativeJsonV1(record.visibility)) changed = true
      return { ...record, visibility: effective }
    })
    if (!changed) break
    if (pass === included.length) narrativeFail('visibility', '可见范围闭包未收敛')
  }
  const evidenceIds = new Set([...included.flatMap(record => record.evidenceIds), ...finalTimeContext.mappings.flatMap(mapping => mapping.evidenceIds)])
  const uniqueEvidence = [...new Map(evidence.filter(item => evidenceIds.has(item.evidenceId)).map(item => [item.evidenceId, item])).values()]
  const sourceIdentity = (source: Pick<NarrativeEvidenceSourceV1, 'sourceResourceKey' | 'sourceRevision' | 'fieldPointer'>) =>
    canonicalNarrativeJsonV1([source.sourceResourceKey, source.sourceRevision, source.fieldPointer])
  const usedSources = new Set([...included.map(record => sourceIdentity({ sourceResourceKey: record.provenance.sourceResourceKey,
    sourceRevision: record.provenance.sourceRevision, fieldPointer: record.provenance.sourceField })), ...uniqueEvidence.map(sourceIdentity)])
  const uniqueSources = [...new Map(sources.filter(source => usedSources.has(sourceIdentity(source)))
    .map(source => [sourceIdentity(source), source])).values()]
  const irInput = { scope, records: included, evidence: uniqueEvidence, timeContext: finalTimeContext, aliases: [] }
  const compiled = input.immutableIR
    ? await compileImmutableNarrativeIRV1(irInput, uniqueSources, capture.registry.predicates)
    : { bundle: await compileNarrativeIRBundleV1(irInput, uniqueSources, capture.registry.predicates), sources: uniqueSources }
  const { bundle } = compiled
  coverage.projectedAtoms = bundle.records.length
  coverage.projectedSourceKeys = [...new Set(bundle.records.map(record => record.provenance.sourceResourceKey))].sort(compareUnicodeCodePointsV1)
  const projected = new Set(coverage.projectedSourceKeys)
  coverage.eligibleSelected.sort(compareUnicodeCodePointsV1)
  coverage.explicitlyUnsupportedSourceKeys = coverage.eligibleSelected.filter(key => !projected.has(key))
  const evidenceBySourceField = new Map<string, Map<string, EvidenceSpanV1[]>>()
  for (const span of uniqueEvidence) {
    let fields = evidenceBySourceField.get(span.sourceResourceKey)
    if (!fields) { fields = new Map(); evidenceBySourceField.set(span.sourceResourceKey, fields) }
    const spans = fields.get(span.fieldPointer) ?? []
    spans.push(span); fields.set(span.fieldPointer, spans)
  }
  for (const source of eligibleRows) {
    const projector = narrativeDomainTableV1(capture.registry, source.table).worldSemantic!.projector
    if (!projector) continue
    const fields = [...projector.sourceFields, ...projector.annotationFields]
    const foreignFields = new Set(narrativeDomainTableV1(capture.registry, source.table).exportRemap?.map(ref => ref.field))
    const present = (field: string) => source.row[field] !== undefined && !(foreignFields.has(field) && source.row[field] === null)
    coverage.fields.push({ sourceKey: source.key, projected: projected.has(source.key) ? fields.filter(present) : [],
      unknown: fields.filter(field => !projected.has(source.key) || !present(field)) })
    // Include unreviewed/unannotated manuscript fields in the denominator.
    // This report contains byte ranges, not a claim that all facts were found.
    const prose = projector.sourceFields.flatMap(field => typeof source.row[field] === 'string'
      ? [{ fieldPointer: pointer(field), text: source.row[field] as string }] : [])
    prose.push(...(source.row.narrativeDevelopmentsV1 ?? []).map(item => ({
      fieldPointer: narrativeDevelopmentStatementPointerV1(item.semanticSubKey), text: item.statement,
    })))
    for (const { fieldPointer, text } of prose) {
      const byteLength = new TextEncoder().encode(text).length
      const ranges = (evidenceBySourceField.get(source.key)?.get(fieldPointer) ?? [])
        .map(item => ({ start: item.start, end: item.end })).sort((a, b) => a.start - b.start || a.end - b.end)
      const covered: Array<{ start: number; end: number }> = []
      for (const range of ranges) {
        const previous = covered[covered.length - 1]
        if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
        else covered.push({ ...range })
      }
      const uncovered: Array<{ start: number; end: number }> = []
      let offset = 0
      for (const range of covered) { if (offset < range.start) uncovered.push({ start: offset, end: range.start }); offset = range.end }
      if (offset < byteLength) uncovered.push({ start: offset, end: byteLength })
      coverage.sourceSpans.push({ sourceKey: source.key, fieldPointer, byteLength, covered, uncovered })
    }
  }
  const sourceGroups = bundle.records.map(record => {
    const source = sourceForRecord.get(record.semanticId)!
    const group = resolveNarrativeDomainGroupV1(capture, source.table, source.row)
    return { semanticId: record.semanticId, worldGroupSourceUid: typeof group?.ragDocumentId === 'string' ? group.ragDocumentId : null }
  })
  return { version: 1, bundle, sources: compiled.sources, coverage, sourceGroups,
    dependencyEvidence: dependencyEvidence.filter(edge => includedIds.has(edge.fromSemanticId) && includedIds.has(edge.toSemanticId)) }
}
