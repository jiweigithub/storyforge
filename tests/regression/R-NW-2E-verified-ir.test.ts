import { describe, expect, it } from 'vitest'
import { narrativeIRFixture } from '../helpers/narrative-ir-fixture'
import { compileImmutableNarrativeIRV1, compileNarrativeIRBundleV1, hashNarrativeRecordV1, verifyNarrativeIRBundleV1 } from '../../src/lib/world-engine/narrative-ir'
import { canonicalNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-json'
import { FACT_PREDICATE_REGISTRY } from '../../src/lib/registry/fact-predicate-registry'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { compileWorldReleaseContentV4, verifyWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'
import type { NarrativeIRBundleV1 } from '../../src/lib/types/narrative-ir'
import type { WorldReleaseManifestV4 } from '../../src/lib/types/narrative-release'

const compilerInput = (bundle: NarrativeIRBundleV1) => {
  const { schema: _schema, irVersion: _version, semanticRootHash: _root, ...input } = bundle
  return input
}

describe('NW-2E · 只复用内部不可变 IR 的完整验证，不信任外部摘要或冻结标签', () => {
  it('八类记录的不可变编译与普通编译逐字一致；仅精确快照可共享验证结果', async () => {
    const fixture = await narrativeIRFixture(), input = compilerInput(fixture.bundle)
    const snapshot = await compileImmutableNarrativeIRV1(input, fixture.sources)
    const ordinary = await compileNarrativeIRBundleV1(input, fixture.sources)
    expect(canonicalNarrativeJsonV1(snapshot.bundle)).toBe(canonicalNarrativeJsonV1(ordinary))
    expect(snapshot.sources).toEqual(fixture.sources)
    expect(await verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources)).toBe(snapshot.bundle)
    // Identical bytes in a different source array still take full validation.
    expect(await verifyNarrativeIRBundleV1(snapshot.bundle, structuredClone(snapshot.sources))).not.toBe(snapshot.bundle)
    expect(await verifyNarrativeIRBundleV1(structuredClone(snapshot.bundle), snapshot.sources)).not.toBe(snapshot.bundle)
  })

  it('快照的嵌套记录、证据、原文和数组均不可改写，调用者原始对象保持可编辑', async () => {
    const fixture = await narrativeIRFixture(), input = compilerInput(fixture.bundle)
    const snapshot = await compileImmutableNarrativeIRV1(input, fixture.sources)
    const check = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      expect(Object.isFrozen(value)).toBe(true)
      Object.values(value).forEach(check)
    }
    check(snapshot.bundle); check(snapshot.sources)
    expect(Reflect.set(snapshot.sources[0], 'text', '篡改')).toBe(false)
    expect(Reflect.set(snapshot.bundle.records[0], 'revisionHash', '0'.repeat(64))).toBe(false)
    expect(Reflect.set(snapshot.bundle.records[0].visibility, 'class', 'public')).toBe(false)
    expect(Object.isFrozen(fixture.sources)).toBe(false)
    expect(Object.isFrozen(input.records[0])).toBe(false)
    expect(await verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources)).toBe(snapshot.bundle)
  })

  it('首个异步边界前捕获记录、原文和谓词；随后修改调用者对象不能污染快照', async () => {
    const fixture = await narrativeIRFixture(), input = structuredClone(compilerInput(fixture.bundle))
    const sources = structuredClone(fixture.sources), predicates = structuredClone([...FACT_PREDICATE_REGISTRY])
    const pending = compileImmutableNarrativeIRV1(input, sources, predicates)
    input.records[0].confidence = 0.25
    sources[0].text += '调用之后才修改'
    predicates.find(item => item.key === 'location')!.valueType = 'boolean'
    const snapshot = await pending
    expect(snapshot.bundle).toEqual(fixture.bundle)
    expect(snapshot.sources).toEqual(fixture.sources)
    expect(await verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources)).toBe(snapshot.bundle)
  })

  it('修改原文或谓词后必须重新验证并拒绝不一致，不能复用旧回执', async () => {
    const fixture = await narrativeIRFixture()
    const snapshot = await compileImmutableNarrativeIRV1(compilerInput(fixture.bundle), fixture.sources)
    const sources = structuredClone(snapshot.sources); sources[0].text += '改'
    await expect(verifyNarrativeIRBundleV1(snapshot.bundle, sources)).rejects.toThrow('evidence-hash')
    const predicates = structuredClone([...FACT_PREDICATE_REGISTRY])
    predicates.find(item => item.key === 'location')!.valueType = 'boolean'
    await expect(verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources, predicates)).rejects.toThrow('predicate-value')
    await expect(verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources, [])).rejects.toThrow('predicate-unregistered')
  })

  it('复制或自行冻结的非法 bundle 不能继承进程内验证，非法证据也不能取得新回执', async () => {
    const fixture = await narrativeIRFixture()
    const snapshot = await compileImmutableNarrativeIRV1(compilerInput(fixture.bundle), fixture.sources)
    const changed = structuredClone(snapshot.bundle)
    changed.records[0].revisionHash = '0'.repeat(64)
    Object.freeze(changed)
    await expect(verifyNarrativeIRBundleV1(changed, snapshot.sources)).rejects.toThrow()
    const sources = structuredClone(fixture.sources); sources[0].text += '改'
    await expect(compileImmutableNarrativeIRV1(compilerInput(fixture.bundle), sources)).rejects.toThrow('evidence-hash')
    expect(await verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources)).toBe(snapshot.bundle)
  })

  it('来源身份注册规则发生变化时不能复用此前的验证', async () => {
    const fixture = await narrativeIRFixture()
    const snapshot = await compileImmutableNarrativeIRV1(compilerInput(fixture.bundle), fixture.sources)
    const identity = PROJECT_TABLES.find(spec => spec.name === 'characters')!.resourceIdentity!
    const prior = identity.narrativeEntityType
    try {
      expect(Reflect.set(identity, 'narrativeEntityType', 'location')).toBe(true)
      await expect(verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources)).rejects.toThrow('entity-kind')
    } finally { Reflect.set(identity, 'narrativeEntityType', prior) }
    expect(await verifyNarrativeIRBundleV1(snapshot.bundle, snapshot.sources)).toBe(snapshot.bundle)
  })

  it('拒绝原文访问器且不执行 getter，不把非 JSON 对象冻结后当成有效快照', async () => {
    const fixture = await narrativeIRFixture(), sources = structuredClone(fixture.sources)
    let invoked = false
    Object.defineProperty(sources[0], 'text', { enumerable: true, get() { invoked = true; return '隐藏值' } })
    await expect(compileImmutableNarrativeIRV1(compilerInput(fixture.bundle), sources)).rejects.toThrow('accessor')
    expect(invoked).toBe(false)
  })

  it('v4 完整内容和索引黄金字节不变，外部原包仍完整重建投影并核验', async () => {
    const manifest = structuredClone(golden.compiled.manifest) as WorldReleaseManifestV4
    const { narrative: _narrative, semanticRootHash: _root, indexDescriptor: _descriptor, ...input } = manifest
    const compiled = await compileWorldReleaseContentV4(input)
    expect(compiled).toEqual(golden.compiled)
    expect(Object.isFrozen(compiled.manifest.narrative.bundle)).toBe(true)
    const verified = await verifyWorldReleaseContentV4({ manifest: compiled.manifestJson,
      expectedContentHash: compiled.contentHash, index: structuredClone(compiled.index) })
    expect(verified.manifest).toEqual(compiled.manifest)
    expect(verified.index).toEqual(compiled.index)
    // Import parsing yields its own mutable data, not an authority-bearing receipt.
    expect(Object.isFrozen(verified.manifest.narrative.bundle)).toBe(false)
  })

  it('内部绑定覆盖有序值中的引用及双向依赖，调用者数据不变且外部错绑仍被拒绝', async () => {
    const fixture = await narrativeIRFixture(), input = structuredClone(fixture.input)
    const zero = '0'.repeat(64)
    const relation = input.records.find(record => record.kind === 'relation')!
    relation.payload.value = { kind: 'ordered-set', values: [
      { kind: 'text', value: '保留次序' },
      { kind: 'entity-ref', value: { kind: 'entity', semanticId: fixture.ids[0], revisionHash: zero } },
    ] }
    input.records[0].dependencies = [{ semanticId: fixture.ids[1], revisionHash: zero, role: 'requires' }]
    input.records[1].dependencies = [{ semanticId: fixture.ids[0], revisionHash: zero, role: 'requires' }]
    const before = canonicalNarrativeJsonV1(input)
    const firstHash = await hashNarrativeRecordV1(input.records[0]), secondHash = await hashNarrativeRecordV1(input.records[1])
    const compiled = await compileNarrativeIRBundleV1(input, fixture.sources)
    const first = compiled.records.find(record => record.semanticId === fixture.ids[0])!
    const second = compiled.records.find(record => record.semanticId === fixture.ids[1])!
    expect(first.revisionHash).toBe(firstHash)
    expect(second.revisionHash).toBe(secondHash)
    expect(first.dependencies).toEqual([{ semanticId: fixture.ids[1], revisionHash: secondHash, role: 'requires' }])
    expect(second.dependencies).toEqual([{ semanticId: fixture.ids[0], revisionHash: firstHash, role: 'requires' }])
    expect(compiled.records.find(record => record.kind === 'relation')!.payload.value).toEqual({
      kind: 'ordered-set', values: [
        { kind: 'text', value: '保留次序' },
        { kind: 'entity-ref', value: { kind: 'entity', semanticId: fixture.ids[0], revisionHash: firstHash } },
      ],
    })
    expect(canonicalNarrativeJsonV1(input)).toBe(before)
    expect(await verifyNarrativeIRBundleV1(compiled, fixture.sources)).toEqual(compiled)
    const changed = structuredClone(compiled), value = changed.records.find(record => record.kind === 'relation')!.payload.value
    if (value.kind !== 'ordered-set' || value.values[1].kind !== 'entity-ref') throw new Error('fixture')
    value.values[1].value.revisionHash = 'f'.repeat(64)
    await expect(verifyNarrativeIRBundleV1(changed, fixture.sources)).rejects.toThrow('stale-reference')
  })

  it.each(['record', 'dependency', 'payload'])('显式旧哈希在 %s 位置均不能被内部绑定静默更新', async site => {
    const fixture = await narrativeIRFixture(), input = structuredClone(fixture.input), stale = 'f'.repeat(64)
    if (site === 'record') input.records[0].revisionHash = stale
    if (site === 'dependency') input.records[0].dependencies = [{ semanticId: fixture.ids[1], revisionHash: stale, role: 'requires' }]
    if (site === 'payload') input.records.find(record => record.kind === 'event')!.payload.participants[0].entityRef.revisionHash = stale
    const before = canonicalNarrativeJsonV1(input)
    await expect(compileNarrativeIRBundleV1(input, fixture.sources)).rejects.toThrow('stale-reference')
    expect(canonicalNarrativeJsonV1(input)).toBe(before)
  })

})
