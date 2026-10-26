import { describe, expect, it } from 'vitest'
import { narrativeIRFixture, irSourceIdentity } from '../helpers/narrative-ir-fixture'
import type { NarrativeDomainProjectionV1 } from '../../src/lib/types/narrative-projection'
import { compileNarrativeIRBundleV1 } from '../../src/lib/world-engine/narrative-ir'
import { createNarrativeSemanticIdV1 } from '../../src/lib/world-engine/narrative-identity'
import { canonicalNarrativeJsonV1 as json, hashNarrativeBytesV1, hashNarrativeValueV1 as hash } from '../../src/lib/world-engine/narrative-json'
import { buildWorldImpactPlanV1, verifyWorldImpactPlanV1 } from '../../src/lib/consistency/world-impact'
import { compileNarrativeIndexV1, compileNarrativeIndexIncrementalV1 } from '../../src/lib/world-engine/narrative-index'

type Fixture = Awaited<ReturnType<typeof narrativeIRFixture>>
async function projection(fixture: Fixture): Promise<NarrativeDomainProjectionV1> {
  const bundle = await compileNarrativeIRBundleV1(fixture.input, fixture.sources)
  const keys = [...new Set(bundle.records.map(record => record.provenance.sourceResourceKey))].sort()
  // This fixture declares its complete graph. It is not a recall claim for
  // prose; production projection coverage is never replaced by these fields.
  return { version: 1, bundle, sources: structuredClone(fixture.sources), sourceGroups: [], dependencyEvidence: [], coverage: {
    version: 1, eligibleSelected: keys, projectedSourceKeys: keys, explicitlyUnsupportedSourceKeys: [], gaps: [], excluded: [],
    fields: [], declaredAtoms: bundle.records.length, projectedAtoms: bundle.records.length, sourceSpans: [],
  } }
}
async function snapshot(value: NarrativeDomainProjectionV1, lockedSemanticIds: string[] = []) {
  return { projection: value, semanticRootHash: await hash(value), lockedSemanticIds }
}
async function rewriteSource(fixture: Fixture, position: number, text: string) {
  const source = fixture.sources[position], sourceHash = await hashNarrativeBytesV1(text)
  source.text = text; source.sourceRevision = 'source-r2'
  const record = fixture.input.records[position]
  record.provenance.sourceRevision = source.sourceRevision; record.provenance.sourceContentHash = sourceHash
  const evidence = fixture.input.evidence[position]
  Object.assign(evidence, { sourceRevision: source.sourceRevision, sourceContentHash: sourceHash, spanHash: sourceHash, end: new TextEncoder().encode(text).length })
}

describe('NW-2D · 硬依赖影响和增量编译，不代替作者语义判断', () => {
  it('改地点值命中全部实际依赖与远处承诺，保留锁定约束和无关实体', async () => {
    const fixture = await narrativeIRFixture(), base = await snapshot(await projection(fixture), [fixture.ids[7]])
    const assertion = fixture.input.records[3]
    if (assertion.kind !== 'assertion') throw Error('fixture')
    assertion.payload.value = { kind: 'text', value: '桥墩底下' }
    const next = await snapshot(await projection(fixture), [fixture.ids[7]])
    const plan = await buildWorldImpactPlanV1({ base, next })
    const expected = [2, 4, 5, 6, 7, 8].map(index => fixture.ids[index]).sort()
    expect(plan.staleSemanticIds).toEqual(expected)
    expect(plan.changedSemanticIds).toEqual([fixture.ids[3]])
    expect(plan.items.filter(item => expected.includes(item.key)).every(item => item.path.length > 0)).toBe(true)
    expect(plan.items.find(item => item.key === fixture.ids[3])!.fieldDiffs.map(field => field.pointer)).toContain('/payload/value/value')
    expect(plan.items.find(item => item.key === fixture.ids[7])).toMatchObject({ locked: true, authorDecisionRequired: true })
    expect(plan.items.filter(item => [fixture.ids[0], fixture.ids[1]].includes(item.key)).every(item => item.disposition === 'unaffected')).toBe(true)
    expect(plan.writes).toEqual([])
    expect(plan.frozenArtifactsChanged).toBe(0)
    expect(await verifyWorldImpactPlanV1(plan, { base, next })).toEqual(plan)
    expect(await buildWorldImpactPlanV1({ base, next })).toEqual(plan)
    // Fixed declared hard gold: six expected, six found, no false positives.
    expect(plan.staleSemanticIds.filter(id => expected.includes(id)).length / expected.length).toBe(1)
    expect(plan.staleSemanticIds.filter(id => expected.includes(id)).length / plan.staleSemanticIds.length).toBe(1)
  })

  it('只改同一人物的原文描述不把身份引用的关系、事件和承诺全部判 stale', async () => {
    const fixture = await narrativeIRFixture(), base = await snapshot(await projection(fixture))
    await rewriteSource(fixture, 0, '沈青穿了一件灰外衣。\r\n身份和关系没有改动。')
    const plan = await buildWorldImpactPlanV1({ base, next: await snapshot(await projection(fixture)) })
    expect(plan.changedSemanticIds).toEqual([fixture.ids[0]])
    expect(plan.staleSemanticIds).toEqual([])
    expect(plan.items.find(item => item.key === fixture.ids[4])!.disposition).toBe('unaffected')
    expect(plan.rebuildSourceKeys).toHaveLength(1)
  })

  it('只有先后顺序的后续事件进入 review，不能冒充因果或全书失效', async () => {
    const fixture = await narrativeIRFixture(), identity = irSourceIdentity('historical-event', 20)
    const event = structuredClone(fixture.input.records[2])
    if (event.kind !== 'event') throw Error('fixture')
    event.semanticId = createNarrativeSemanticIdV1(fixture.input.scope.owner, 'event', identity)
    event.provenance.sourceResourceKey = `fact:${identity.sourceUid}`
    fixture.sources.push({ ...fixture.sources[2], sourceResourceKey: event.provenance.sourceResourceKey })
    event.payload.propositionRefs = []; event.payload.effectRefs = []
    event.dependencies = [{ semanticId: fixture.ids[2], revisionHash: '0'.repeat(64), role: 'requires' }]
    fixture.input.records.push(event)
    fixture.input.timeContext.anchors.push({ eventKey: event.semanticId, timelineKey: 'days', value: '3' })
    fixture.input.timeContext.before.push({ beforeEventKey: fixture.ids[2], afterEventKey: event.semanticId })
    const base = await snapshot(await projection(fixture))
    const changed = fixture.input.records[2]
    if (changed.kind !== 'event') throw Error('fixture')
    changed.payload.participants[0].role = 'witness'
    const plan = await buildWorldImpactPlanV1({ base, next: await snapshot(await projection(fixture)) })
    expect(plan.items.find(item => item.key === event.semanticId)).toMatchObject({ disposition: 'review', confidence: 'unknown-impact' })
    expect(plan.staleSemanticIds).not.toContain(event.semanticId)
  })

  it('缺覆盖明确 unknown-impact；新缺边、版本漂移、伪造图或锁均不能沿用旧回执', async () => {
    const fixture = await narrativeIRFixture(), base = await snapshot(await projection(fixture))
    fixture.input.records[0].authorUpdatedAt++
    const next = await snapshot(await projection(fixture))
    next.projection.coverage.gaps.push({ sourceKey: fixture.sources[0].sourceResourceKey, table: 'characters', code: 'unannotated', detail: 'unresolved prose' })
    const plan = await buildWorldImpactPlanV1({ base, next })
    expect(plan.items.find(item => item.key === fixture.ids[4])).toMatchObject({ disposition: 'review', confidence: 'unknown-impact' })
    expect(plan.staleSemanticIds).toEqual([])
    const corrupt = structuredClone(plan); corrupt.edges.pop()
    const { planHash: _hash, ...body } = corrupt; corrupt.planHash = await hash(body)
    await expect(verifyWorldImpactPlanV1(corrupt, { base, next })).rejects.toThrow('impact-stale')
    next.projection.coverage.gaps.push({ ...next.projection.coverage.gaps[0], code: 'other-gap' })
    await expect(verifyWorldImpactPlanV1(plan, { base, next })).rejects.toThrow('impact-stale')
    await expect(buildWorldImpactPlanV1({ base: { ...base, lockedSemanticIds: ['outside-owner'] }, next })).rejects.toThrow('impact-lock')
    const other = await narrativeIRFixture({ kind: 'work', workCode: 'WORK-00000000-0000-4000-8000-000000000002' })
    await expect(buildWorldImpactPlanV1({ base, next: await snapshot(await projection(other)) })).rejects.toThrow('impact-scope')
  })

  it('无关修改集合分开计数；没有变化时不因覆盖不足制造修改或重建', async () => {
    const fixture = await narrativeIRFixture(), value = await snapshot(await projection(fixture))
    value.projection.coverage.gaps.push({ sourceKey: 'unread-prose', table: 'chapters', code: 'unknown', detail: 'fixture gap' })
    const plan = await buildWorldImpactPlanV1({ base: value, next: value })
    expect(plan.changedSemanticIds).toEqual([])
    expect(plan.staleSemanticIds).toEqual([])
    expect(plan.reviewKeys).toEqual([])
    expect(plan.items.every(item => item.disposition === 'unaffected')).toBe(true)
  })

  it('未进入 IR 的原始字段仍参加比较，未知依赖不会把其他未投影来源报成安全', async () => {
    const fixture = await narrativeIRFixture(), frozen = await snapshot(await projection(fixture))
    const base = { ...frozen, originals: [
      { sourceKey: fixture.sources[0].sourceResourceKey, fields: { personality: '守约而谨慎' } },
      { sourceKey: fixture.sources[1].sourceResourceKey, fields: { background: '尚未表达的往事' } },
    ] }
    const next = structuredClone(base)
    next.originals[0].fields.personality = '宣称守约，实际另有安排'
    next.semanticRootHash = await hash(next.originals)
    const plan = await buildWorldImpactPlanV1({ base, next })
    expect(plan.changedSemanticIds).toEqual([])
    expect(plan.unknownCoverage.some(value => value.includes('/personality:unprojected-original'))).toBe(true)
    expect(plan.items.find(item => item.key === `original:${fixture.sources[1].sourceResourceKey}`)).toMatchObject({ disposition: 'review', confidence: 'unknown-impact' })
    expect(plan.items.every(item => item.unknownEdges.length <= 1)).toBe(true)
    await expect(buildWorldImpactPlanV1({ base, next: { ...next, originals: [{ sourceKey: 'outside-owner', fields: {} }] } })).rejects.toThrow('impact-original')
  })

  it('长依赖链保留根和完整直接图，展示路径有明确边界而不分配二次方路径矩阵', async () => {
    const fixture = await narrativeIRFixture()
    let previous = fixture.ids[3]
    for (let index = 0; index < 80; index++) {
      const record = structuredClone(fixture.input.records[3])
      if (record.kind !== 'assertion') throw Error('fixture')
      const identity = irSourceIdentity('temporal-fact', 100 + index)
      record.semanticId = createNarrativeSemanticIdV1(fixture.input.scope.owner, 'assertion', identity)
      record.provenance.sourceResourceKey = `fact:${identity.sourceUid}`
      record.payload.supersedesRefs = [{ kind: 'assertion', semanticId: previous, revisionHash: '0'.repeat(64) }]
      fixture.input.records.push(record)
      fixture.sources.push({ ...fixture.sources[3], sourceResourceKey: record.provenance.sourceResourceKey })
      previous = record.semanticId
    }
    const base = await snapshot(await projection(fixture))
    const assertion = fixture.input.records[3]
    if (assertion.kind !== 'assertion') throw Error('fixture')
    assertion.payload.value = { kind: 'text', value: '桥底' }
    const plan = await buildWorldImpactPlanV1({ base, next: await snapshot(await projection(fixture)) })
    expect(plan.items.find(item => item.key === previous)).toMatchObject({ disposition: 'stale', pathComplete: false, pathRootKey: fixture.ids[3] })
    expect(plan.items.find(item => item.key === previous)!.path).toHaveLength(64)
    expect(plan.items.every(item => item.path.length <= 64)).toBe(true)
    expect(plan.edges.filter(edge => edge.kind === 'dependency').length).toBeGreaterThanOrEqual(80)
  })

  it('改一个原文字段只重建一个原文分片；增量与全量所有字节和 hash 一致', async () => {
    const fixture = await narrativeIRFixture(), before = await projection(fixture)
    const index = await compileNarrativeIndexV1({ inputRootHash: await hash(before), projection: before }), frozen = json(index)
    await rewriteSource(fixture, 3, '钥匙在西桥石墩下。\r\n🗝️ 新版证据。')
    const after = await projection(fixture), input = { inputRootHash: await hash(after), projection: after }
    const impact = await buildWorldImpactPlanV1({ base: await snapshot(before), next: await snapshot(after) })
    expect(impact.staleSemanticIds).toEqual([2, 4, 5, 6, 7, 8].map(position => fixture.ids[position]).sort())
    const updated = await compileNarrativeIndexIncrementalV1(input, index)
    expect(json(updated.index)).toBe(json(await compileNarrativeIndexV1(input)))
    expect(updated.receipt.rebuiltSources).toHaveLength(1)
    expect(updated.receipt.reusedSources).toHaveLength(8)
    expect(updated.receipt.rebuiltAtomPostings).toHaveLength(0)
    expect(json(index)).toBe(frozen)
    await expect(compileNarrativeIndexIncrementalV1(input, structuredClone(index))).rejects.toThrow('index-incremental-base')
  })

  it('删除和插入改变全局序号时复用分片仍正确重映射；权限变化不能复用旧公开 postings', async () => {
    const fixture = await narrativeIRFixture(), before = await projection(fixture)
    const index = await compileNarrativeIndexV1({ inputRootHash: await hash(before), projection: before })
    fixture.input.records.splice(5, 1); fixture.input.evidence.splice(5, 1); fixture.sources.splice(5, 1)
    const after = await projection(fixture), input = { inputRootHash: await hash(after), projection: after }
    const deleted = await compileNarrativeIndexIncrementalV1(input, index)
    expect(deleted.index).toEqual(await compileNarrativeIndexV1(input))
    expect(deleted.receipt.rebuiltSources).toHaveLength(0)
    expect(deleted.receipt.reusedSources).toHaveLength(8)
    const restored = await compileNarrativeIndexIncrementalV1({ inputRootHash: await hash(before), projection: before }, deleted.index)
    expect(restored.index).toEqual(index)
    expect(restored.receipt.rebuiltSources).toHaveLength(1)
    fixture.input.records[0].visibility = { class: 'public', audienceKeys: [], policyVersion: 'policy-1' }
    const changed = await projection(fixture), changedInput = { inputRootHash: await hash(changed), projection: changed }
    const permissions = await compileNarrativeIndexIncrementalV1(changedInput, deleted.index)
    expect(permissions.index).toEqual(await compileNarrativeIndexV1(changedInput))
    expect(permissions.receipt.rebuiltSources).toHaveLength(1)
    expect(permissions.receipt.reusedSources).toHaveLength(7)
  })
})
