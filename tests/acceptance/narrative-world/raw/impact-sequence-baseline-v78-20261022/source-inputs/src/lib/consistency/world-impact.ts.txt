import type { NarrativeDomainProjectionV1 } from '../types/narrative-projection'
import type { NarrativeRecordV1, NarrativeEvidenceSourceV1 } from '../types/narrative-ir'
import type { FactPredicateSpec } from '../types/temporal-fact'
import type { WorldImpactEdgeV1, WorldImpactItemV1, WorldImpactPlanV1, WorldImpactRevisionVectorV1 } from '../types/world-impact'
import { verifyNarrativeIRBundleV1 } from '../world-engine/narrative-ir'
import { mapNarrativeReferencesV1 } from '../world-engine/narrative-ir-codec'
import { canonicalNarrativeJsonV1 as json, compareUnicodeCodePointsV1 as compare, hashNarrativeValueV1 as hash,
  hashNarrativeBytesV1, hashV1, narrativeFail } from '../world-engine/narrative-json'

export interface WorldImpactSnapshotV1 {
  projection: NarrativeDomainProjectionV1
  semanticRootHash: string
  /** Production callers derive this from the frozen registered source rows. */
  lockedSemanticIds: string[]
  /** Frozen original business fields which may not yet have IR atoms. */
  originals?: Array<{ sourceKey: string; fields: Record<string, unknown> }>
}
const strings = (values: Iterable<string>) => [...new Set(values)].sort(compare)
const sourceKey = (source: Pick<NarrativeEvidenceSourceV1, 'sourceResourceKey' | 'fieldPointer'>) =>
  `source:${json([source.sourceResourceKey, source.fieldPointer])}`
const sourceVersionKey = (source: NarrativeEvidenceSourceV1) => json([sourceKey(source), source.sourceRevision])
const TIME = 'time-context'
const ALGORITHM = 'world-impact-evidence-v2'
const stripBindings = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripBindings)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'revisionHash' && key !== 'revisionVectorHash')
    .map(([key, child]) => [key, stripBindings(child)]))
}
const meaning = (record: NarrativeRecordV1) => stripBindings({ kind: record.kind, payload: record.payload, time: record.time,
  modality: record.modality, visibility: record.visibility, dependencies: record.dependencies, reviewState: record.reviewState, authority: record.authority })

async function diff(before: unknown, after: unknown, pointer = ''): Promise<WorldImpactItemV1['fieldDiffs']> {
  if (before !== undefined && after !== undefined && json(before) === json(after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>
    const result: WorldImpactItemV1['fieldDiffs'] = []
    for (const key of strings([...Object.keys(a), ...Object.keys(b)])) result.push(...await diff(a[key], b[key],
      `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`))
    return result
  }
  return [{ pointer: pointer || '/', oldHash: before === undefined ? null : await hash(before), newHash: after === undefined ? null : await hash(after) }]
}

async function snapshot(input: WorldImpactSnapshotV1, predicates?: readonly FactPredicateSpec[]) {
  hashV1(input.semanticRootHash, 'impact.semanticRootHash')
  const projection = input.projection
  const bundle = await verifyNarrativeIRBundleV1(projection.bundle, projection.sources, predicates)
  const records = new Map(bundle.records.map(record => [record.semanticId, record]))
  const locked = strings(input.lockedSemanticIds)
  if (locked.some(key => !records.has(key))) narrativeFail('impact-lock', '锁定条目必须属于同一版本和 owner')
  const sources = new Map<string, NarrativeEvidenceSourceV1[]>()
  const vector: WorldImpactRevisionVectorV1 = { semanticRootHash: input.semanticRootHash, revisionVectorHash: bundle.scope.revisionVectorHash,
    timeContextHash: await hash(bundle.timeContext), records: [...records.values()].sort((a, b) => compare(a.semanticId, b.semanticId))
      .map(record => ({ semanticId: record.semanticId, revisionHash: record.revisionHash })), sources: [], originalFields: [] }
  for (const source of [...projection.sources].sort((a, b) => compare(sourceVersionKey(a), sourceVersionKey(b)))) {
    const key = sourceKey(source), rows = sources.get(key) ?? []
    rows.push(source); sources.set(key, rows)
    vector.sources.push({ sourceKey: source.sourceResourceKey, fieldPointer: source.fieldPointer,
      sourceRevision: source.sourceRevision, contentHash: await hashNarrativeBytesV1(source.text) })
  }
  const originals = new Map<string, Record<string, unknown>>()
  const selectedSources = new Set([...projection.coverage.eligibleSelected, ...projection.sources.map(source => source.sourceResourceKey)])
  for (const original of [...input.originals ?? []].sort((a, b) => compare(a.sourceKey, b.sourceKey))) {
    if (originals.has(original.sourceKey) || !selectedSources.has(original.sourceKey)) narrativeFail('impact-original', '原文来源身份重复或不属于选定范围')
    originals.set(original.sourceKey, original.fields)
    for (const field of Object.keys(original.fields).sort(compare)) vector.originalFields.push({ sourceKey: original.sourceKey,
      fieldPointer: `/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`, contentHash: await hash(original.fields[field]) })
  }
  const edges: WorldImpactEdgeV1[] = []
  const add = (from: string, to: string, kind: WorldImpactEdgeV1['kind'], strength: WorldImpactEdgeV1['strength'], role: string, evidenceIds: string[] = []) => {
    if (from !== to) edges.push({ from, to, kind, strength, role, evidenceIds: strings(evidenceIds) })
  }
  const evidence = new Map(bundle.evidence.map(span => [span.evidenceId, span]))
  const proofs = new Map<string, NarrativeDomainProjectionV1['dependencyEvidence'][number]>()
  for (const proof of projection.dependencyEvidence) {
    const key = json([proof.fromSemanticId, proof.toSemanticId, proof.role]), record = records.get(proof.fromSemanticId)
    if (proofs.has(key) || !record?.dependencies.some(edge => edge.semanticId === proof.toSemanticId && edge.role === proof.role)
      || !records.has(proof.toSemanticId) || !proof.evidenceIds.length
      || proof.evidenceIds.some(id => !record.evidenceIds.includes(id) || evidence.get(id)?.supportRole !== 'supports')) {
      narrativeFail('impact-dependency-proof', '依赖图不能接受缺失、伪造或跨原子的证据')
    }
    proofs.set(key, proof)
  }
  const beforePairs = new Set(bundle.timeContext.before.map(edge => json([edge.beforeEventKey, edge.afterEventKey])))
  for (const record of records.values()) {
    const id = record.semanticId
    add(sourceKey({ sourceResourceKey: record.provenance.sourceResourceKey, fieldPointer: record.provenance.sourceField }), id,
      'provenance', 'hard', 'source-field')
    for (const evidenceId of record.evidenceIds) add(sourceKey(evidence.get(evidenceId)!), id, 'evidence', 'hard', 'original-span', [evidenceId])
    mapNarrativeReferencesV1(record, ref => {
      const identityOnly = ref.kind === 'entity'
      add(ref.semanticId, id, identityOnly ? 'identity' : 'dependency', 'hard', identityOnly ? 'entity-identity' : 'typed-reference', record.evidenceIds)
      return ref
    })
    for (const dependency of record.dependencies) {
      const proof = proofs.get(json([id, dependency.semanticId, dependency.role]))
      if (dependency.role !== 'requires' && !proof?.evidenceIds.length) narrativeFail('impact-dependency-proof', '声明依赖缺少有效支持证据')
      // A.before=[B] retains B as a closure requirement on A. That does not
      // assert that changing B invalidates A. Relative event anchors can store
      // the same requirement in the other direction. Emit their actual order
      // once below; an independently evidenced requirement remains hard.
      const sequence = dependency.role === 'requires' && !proof
        && (beforePairs.has(json([dependency.semanticId, id])) || beforePairs.has(json([id, dependency.semanticId])))
      const exactAnchor = [record.time.occurred?.start, record.time.occurred?.end, record.time.valid?.start,
        record.time.valid?.end, record.time.acquiredAt].some(point => point?.kind === 'event-anchor'
          && point.eventKey === dependency.semanticId && point.side === 'at')
      if (sequence && !exactAnchor) continue
      add(dependency.semanticId, id, records.get(dependency.semanticId)?.kind === 'entity' && dependency.role === 'requires' ? 'identity' : 'dependency',
        dependency.role === 'contradicts' ? 'review' : 'hard', dependency.role, proof?.evidenceIds ?? [])
    }
    if (record.time.occurred || record.time.valid || record.time.acquiredAt || record.time.narratedAt || record.time.disclosedAt.length) {
      add(TIME, id, 'time-context', 'hard', 'time-mapping')
    }
  }
  for (const edge of bundle.timeContext.before) add(edge.beforeEventKey, edge.afterEventKey, 'sequence', 'review', 'before')
  const unknown = strings([
    ...projection.coverage.gaps.map(gap => `${gap.sourceKey}:${gap.code}`),
    ...projection.coverage.explicitlyUnsupportedSourceKeys.map(key => `${key}:unsupported`),
    ...projection.coverage.fields.flatMap(field => field.unknown.map(key => `${field.sourceKey}:${key}`)),
    ...projection.coverage.sourceSpans.filter(span => span.uncovered.length).map(span => `${span.sourceKey}:${span.fieldPointer}:uncovered`),
    ...(projection.coverage.declaredAtoms !== projection.coverage.projectedAtoms ? ['declared-atoms-not-fully-projected'] : []),
  ])
  return { projection, records, sources, originals, vector, edges, locked, unknown }
}

/** Deterministic, read-only counterpart of the existing chapter impact graph.
 * It never mutates Canon, summaries, retrieval caches, releases or sessions.
 * Missing semantics remain review candidates, not fabricated hard edges. */
export async function buildWorldImpactPlanV1(input: { base: WorldImpactSnapshotV1; next: WorldImpactSnapshotV1; predicates?: readonly FactPredicateSpec[] }): Promise<WorldImpactPlanV1> {
  const base = await snapshot(input.base, input.predicates), next = await snapshot(input.next, input.predicates)
  const scope = { owner: base.projection.bundle.scope.owner, branchKey: base.projection.bundle.scope.branchKey }
  if (json(scope) !== json({ owner: next.projection.bundle.scope.owner, branchKey: next.projection.bundle.scope.branchKey })) {
    narrativeFail('impact-scope', '影响比较不能跨 owner 或 branch')
  }
  const edges = [...new Map([...base.edges, ...next.edges].map(edge => [json(edge), edge])).entries()].sort(([a], [b]) => compare(a, b)).map(([, edge]) => edge)
  const unknownCoverage = strings([...base.unknown, ...next.unknown])
  const protectedSemanticIds = strings([...base.locked, ...next.locked])
  const changedMeaning = new Set<string>(), identityChanges = new Set<string>(), direct = new Set<string>()
  const evidenceChanged = new Set<string>()
  const items = new Map<string, WorldImpactItemV1>()
  const allRecords = new Map([...base.records, ...next.records])
  const entityName = (id: string) => { const record = allRecords.get(id); return record?.kind === 'entity' ? record.payload.canonicalLabel : '相关内容' }
  const recordLabel = (record: NarrativeRecordV1): string => {
    switch (record.kind) {
      case 'entity': return record.payload.canonicalLabel
      case 'assertion': return `${entityName(record.payload.subjectRef.semanticId)}的${input.predicates?.find(spec => spec.key === record.payload.predicateKey)?.label ?? '状态'}`
      case 'relation': return `${entityName(record.payload.fromRef.semanticId)}与${entityName(record.payload.toRef.semanticId)}的关系`
      case 'event': return `${record.payload.participants.map(item => entityName(item.entityRef.semanticId)).join('、') || '已确认'}的事件`
      case 'epistemic-event': return `${entityName(record.payload.holderRef.semanticId)}的认知`
      case 'rule': return record.payload.statement
      case 'development': return `${record.payload.ownerRefs.map(ref => entityName(ref.semanticId)).join('、') || '故事'}的${({ thread: '故事线', goal: '目标', conflict: '冲突', commitment: '承诺', foreshadow: '伏笔' } as const)[record.payload.developmentType]}`
      case 'disclosure': return '面向读者的揭示'
    }
  }
  const sourceLabels = new Map([...allRecords.values()].map(record => [sourceKey({ sourceResourceKey: record.provenance.sourceResourceKey,
    fieldPointer: record.provenance.sourceField }), `原文 · ${recordLabel(record)}`]))
  const baseEvidence = new Map(base.projection.bundle.evidence.map(span => [span.evidenceId, span]))
  const nextEvidence = new Map(next.projection.bundle.evidence.map(span => [span.evidenceId, span]))
  const item = async (key: string, kind: WorldImpactItemV1['kind'], before: unknown, after: unknown, oldHash: string | null, newHash: string | null) => {
    const changed = oldHash !== newHash
    const label = kind === 'time-context' ? '时间体系与叙述顺序' : kind === 'source' ? sourceLabels.get(key) ?? '原文证据' : recordLabel(allRecords.get(key)!)
    const row: WorldImpactItemV1 = { key, label: [...label].slice(0, 120).join(''), kind, disposition: changed ? 'rebuild' : 'unaffected', operation: oldHash === null ? 'added' : newHash === null ? 'removed' : changed ? 'changed' : 'retained',
      oldHash, newHash, fieldDiffs: changed ? await diff(before, after) : [], path: [], pathRootKey: null, pathComplete: true, evidenceIds: [], unknownEdges: [],
      confidence: 'deterministic', locked: protectedSemanticIds.includes(key), authorDecisionRequired: false }
    items.set(key, row)
    if (changed) direct.add(key)
    return row
  }
  for (const key of strings([...base.records.keys(), ...next.records.keys()])) {
    const a = base.records.get(key), b = next.records.get(key)
    await item(key, 'record', a && stripBindings(a), b && stripBindings(b), a?.revisionHash ?? null, b?.revisionHash ?? null)
    if (!a || !b || json(meaning(a)) !== json(meaning(b))) changedMeaning.add(key)
    if (json(a?.evidenceIds.map(id => baseEvidence.get(id)) ?? []) !== json(b?.evidenceIds.map(id => nextEvidence.get(id)) ?? [])) evidenceChanged.add(key)
    if (!a || !b || a.kind !== b.kind || (a.kind === 'entity' && b.kind === 'entity'
      && json(a.payload) !== json(b.payload))) identityChanges.add(key)
  }
  for (const key of strings([...base.sources.keys(), ...next.sources.keys()])) {
    const a = base.sources.get(key), b = next.sources.get(key)
    await item(key, 'source', a, b, a ? await hash(a) : null, b ? await hash(b) : null)
  }
  for (const key of strings([...base.originals.keys(), ...next.originals.keys()])) {
    const a = base.originals.get(key), b = next.originals.get(key)
    const original = await item(`original:${key}`, 'source', a, b, a ? await hash(a) : null, b ? await hash(b) : null)
    original.label = `原始设定 · ${[...allRecords.values()].filter(record => record.provenance.sourceResourceKey === key).map(recordLabel).join('、') || '未投影内容'}`
    if (original.disposition !== 'unaffected') {
      // Whole frozen originals are preserved even when a projector only knows
      // the entity name. Such an edit cannot be reported as semantically safe.
      const represented = new Set([...base.projection.coverage.fields, ...next.projection.coverage.fields]
        .filter(field => field.sourceKey === key).flatMap(field => field.projected))
      const unknown = original.fieldDiffs.filter(field => !represented.has(field.pointer.split('/')[1]?.replace(/~1/g, '/').replace(/~0/g, '~')))
      unknownCoverage.push(...unknown.map(field => `${key}:${field.pointer}:unprojected-original`))
    }
  }
  await item(TIME, 'time-context', base.projection.bundle.timeContext, next.projection.bundle.timeContext, base.vector.timeContextHash, next.vector.timeContextHash)
  if (direct.has(TIME)) changedMeaning.add(TIME)
  const outbound = new Map<string, WorldImpactEdgeV1[]>()
  for (const edge of edges) { const group = outbound.get(edge.from) ?? []; group.push(edge); outbound.set(edge.from, group) }
  const witness = (source: WorldImpactItemV1, target: WorldImpactItemV1, edge: WorldImpactEdgeV1) => {
    target.pathRootKey = source.pathRootKey ?? source.key
    target.pathComplete = source.pathComplete && source.path.length < 64
    // Preserve a contiguous suffix and the root identity. The full direct
    // graph remains in the plan; do not allocate a quadratic path matrix.
    target.path = [...source.path.slice(-63), edge]
  }
  // Hard invalidation reaches a fixed point, with one shortest deterministic
  // witness. Entity identity edges ignore an unrelated appearance/provenance
  // edit; an explicit derived-from edge still propagates that declared use.
  const hardAffected = new Set([...changedMeaning, ...evidenceChanged])
  const queue = [...direct].sort(compare), processed = new Map<string, number>()
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor]
    const current = items.get(key)!
    const mode = (hardAffected.has(key) ? 1 : 0) | (identityChanges.has(key) ? 2 : 0) | (current.kind !== 'record' && direct.has(key) ? 4 : 0)
    if (processed.get(key) === mode) continue
    processed.set(key, mode)
    for (const edge of outbound.get(key) ?? []) {
      const target = items.get(edge.to)
      if (!target || edge.strength === 'review') continue
      if (edge.kind === 'identity' && !identityChanges.has(key)) continue
      if (edge.kind === 'dependency' && !hardAffected.has(key)) continue
      if (current.kind === 'record' && edge.kind !== 'identity' && !hardAffected.has(key)) continue
      if (!direct.has(target.key) && !target.path.length) witness(current, target, edge)
      target.evidenceIds = strings([...target.evidenceIds, ...edge.evidenceIds])
      if (!direct.has(target.key)) target.disposition = 'stale'
      if (edge.kind !== 'provenance') hardAffected.add(target.key)
      queue.push(target.key)
    }
  }
  const reviewQueue = [...items.values()].filter(row => row.disposition !== 'unaffected').map(row => row.key)
  for (let cursor = 0; cursor < reviewQueue.length; cursor++) {
    const source = items.get(reviewQueue[cursor])!
    for (const edge of outbound.get(source.key) ?? []) {
      const target = items.get(edge.to)
      if ((edge.strength === 'review' || source.disposition === 'review') && target?.disposition === 'unaffected') {
        target.disposition = 'review'; witness(source, target, edge); target.confidence = 'unknown-impact'
        reviewQueue.push(target.key)
      }
    }
  }
  for (const row of items.values()) {
    if (direct.size && unknownCoverage.length && row.disposition === 'unaffected' && row.kind !== 'time-context') {
      row.disposition = 'review'; row.confidence = 'unknown-impact'; row.unknownEdges = ['incomplete-dependency-coverage']
    }
    row.authorDecisionRequired = row.disposition === 'review' || (row.locked && row.disposition !== 'unaffected')
  }
  const dependencyGraphHash = await hash({ edges, baseCoverage: base.projection.coverage, nextCoverage: next.projection.coverage, unknownCoverage })
  const body: Omit<WorldImpactPlanV1, 'planHash'> = { schema: 'storyforge.world-impact-plan', version: 1, algorithmVersion: ALGORITHM,
    operation: 'compare-draft-revision', operationKey: await hash({ algorithmVersion: ALGORITHM, scope, base: base.vector, next: next.vector, dependencyGraphHash, protectedSemanticIds }), scope,
    baseRevisionVector: base.vector, nextRevisionVector: next.vector, changedSemanticIds: strings([...direct].filter(key => items.get(key)!.kind === 'record')),
    dependencyGraphHash, edges, items: [...items.values()].sort((a, b) => compare(a.key, b.key)),
    rebuildSourceKeys: strings([...direct].filter(key => items.get(key)!.kind === 'source')),
    staleSemanticIds: strings([...items.values()].filter(row => row.disposition === 'stale').map(row => row.key)),
    reviewKeys: strings([...items.values()].filter(row => row.disposition === 'review' || row.authorDecisionRequired).map(row => row.key)),
    unknownCoverage, protectedSemanticIds, writes: [], frozenArtifactsChanged: 0 }
  return { ...body, planHash: await hash(body) }
}

export async function verifyWorldImpactPlanV1(value: unknown, input: Parameters<typeof buildWorldImpactPlanV1>[0]) {
  const expected = await buildWorldImpactPlanV1(input)
  if (json(value) !== json(expected)) narrativeFail('impact-stale', '版本向量、依赖图或影响计划已变化，必须重新规划')
  return expected
}
