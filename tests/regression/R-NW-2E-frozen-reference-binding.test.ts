import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertNarrativeJsonV1, canonicalNarrativeJsonV1, freezeAndHashNarrativeJsonV1,
  hashNarrativeValueWithoutKeysV1,
} from '../../src/lib/world-engine/narrative-json'
import { compileImmutableNarrativeIRV1, compileNarrativeIRBundleV1, verifyNarrativeIRBundleV1 } from '../../src/lib/world-engine/narrative-ir'
import { narrativeIRFixture } from '../helpers/narrative-ir-fixture'

const zero = '0'.repeat(64)
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

describe('NW-2E · 私有冻结记录只复制待绑定引用路径', () => {
  it('记录摘要排除键递归生效，完整值仍冻结并按原字节可读', async () => {
    const value = {
      revisionHash: 'root', a: [{ revisionHash: 'nested', text: '正文🗝️' }],
      scope: { branch: 'canon', revisionVectorHash: 'vector' },
    }
    const omitted = ['revisionHash', 'revisionVectorHash']
    const expected = '{"a":[{"text":"正文🗝️"}],"scope":{"branch":"canon"}}'
    const ordinary = await hashNarrativeValueWithoutKeysV1(value, omitted)
    expect(await freezeAndHashNarrativeJsonV1(value, omitted)).toBe(sha(expected))
    expect(ordinary).toBe(sha(expected))
    expect(Object.isFrozen(value.a[0])).toBe(true)
    expect(Object.isFrozen(value.scope)).toBe(true)
    expect(canonicalNarrativeJsonV1(value)).toBe('{"a":[{"revisionHash":"nested","text":"正文🗝️"}],"revisionHash":"root","scope":{"branch":"canon","revisionVectorHash":"vector"}}')
    // A successful omitted digest must not hide these fields from later hashes.
    expect(await freezeAndHashNarrativeJsonV1(value)).toBe(sha(canonicalNarrativeJsonV1(value)))
  })

  it('被摘要排除的非法值和访问器仍拒绝，失败冻结不产生有效父节点回执', () => {
    let invoked = false
    const accessor = Object.defineProperty({}, 'revisionHash', {
      enumerable: true, get() { invoked = true; return 'hidden' },
    })
    const cycle: Record<string, unknown> = {}; cycle.revisionHash = cycle
    for (const value of [{ revisionHash: '\ud800' }, { nested: { revisionHash: -0 } }, accessor, cycle]) {
      expect(() => freezeAndHashNarrativeJsonV1(value, ['revisionHash'])).toThrow()
      expect(() => assertNarrativeJsonV1(value)).toThrow()
    }
    expect(invoked).toBe(false)
    const valid = { text: '原文' }
    expect(() => freezeAndHashNarrativeJsonV1(valid, ['\ud800'])).toThrow('unicode')
    expect(Object.isFrozen(valid)).toBe(false)
  })

  it('双向依赖与有序集合内引用全部绑定，完整字节等于普通编译且不冻结调用者', async () => {
    const fixture = await narrativeIRFixture(), input = structuredClone(fixture.input)
    input.records[0].dependencies = [{ semanticId: fixture.ids[1], revisionHash: zero, role: 'requires' }]
    input.records[1].dependencies = [{ semanticId: fixture.ids[0], revisionHash: zero, role: 'requires' }]
    const relation = input.records.find(record => record.kind === 'relation')!
    relation.payload.value = { kind: 'ordered-set', values: [
      { kind: 'text', value: '先后不可互换' },
      { kind: 'entity-ref', value: { kind: 'entity', semanticId: fixture.ids[0], revisionHash: zero } },
    ] }
    const before = canonicalNarrativeJsonV1(input)
    const ordinary = await compileNarrativeIRBundleV1(input, fixture.sources)
    const snapshot = await compileImmutableNarrativeIRV1(input, fixture.sources)
    expect(canonicalNarrativeJsonV1(snapshot.bundle)).toBe(canonicalNarrativeJsonV1(ordinary))
    const left = snapshot.bundle.records.find(record => record.semanticId === fixture.ids[0])!
    const right = snapshot.bundle.records.find(record => record.semanticId === fixture.ids[1])!
    expect(left.dependencies[0].revisionHash).toBe(right.revisionHash)
    expect(right.dependencies[0].revisionHash).toBe(left.revisionHash)
    const frozenRelation = snapshot.bundle.records.find(record => record.kind === 'relation')!
    expect(frozenRelation.payload.value).toEqual({ kind: 'ordered-set', values: [
      { kind: 'text', value: '先后不可互换' },
      { kind: 'entity-ref', value: { kind: 'entity', semanticId: fixture.ids[0], revisionHash: left.revisionHash } },
    ] })
    expect(Object.isFrozen(frozenRelation.payload.value)).toBe(true)
    expect(Object.isFrozen(left.dependencies[0])).toBe(true)
    expect(await verifyNarrativeIRBundleV1(structuredClone(snapshot.bundle), fixture.sources)).toEqual(ordinary)
    expect(canonicalNarrativeJsonV1(input)).toBe(before)
    expect(Object.isFrozen(input.records[0])).toBe(false)
    expect(Reflect.set(ordinary.records[0].visibility, 'policyVersion', 'caller-edit')).toBe(true)
    expect(snapshot.bundle.records[0].visibility.policyVersion).toBe('policy-1')
  })

  it('有序集合内再嵌集合仍由两种编译路径拒绝，不放宽 v1 深度契约', async () => {
    const fixture = await narrativeIRFixture(), input = structuredClone(fixture.input)
    input.records.find(record => record.kind === 'relation')!.payload.value = {
      kind: 'ordered-set', values: [
        { kind: 'text', value: '先后不可互换' },
        { kind: 'ordered-set', values: [{ kind: 'entity-ref', value: { kind: 'entity', semanticId: fixture.ids[0], revisionHash: zero } }] },
      ],
    }
    const before = canonicalNarrativeJsonV1(input)
    await expect(compileNarrativeIRBundleV1(input, fixture.sources)).rejects.toThrow('value-depth')
    await expect(compileImmutableNarrativeIRV1(input, fixture.sources)).rejects.toThrow('value-depth')
    expect(canonicalNarrativeJsonV1(input)).toBe(before)
    expect(Object.isFrozen(input.records[0])).toBe(false)
  })

  it('已绑定输入和未绑定输入生成同一字节，失败后独立有效编译仍完整验证', async () => {
    const fixture = await narrativeIRFixture()
    const { schema: _schema, irVersion: _irVersion, semanticRootHash: _hash, ...bound } = fixture.bundle
    const alreadyBound = await compileImmutableNarrativeIRV1(bound, fixture.sources)
    const unbound = await compileImmutableNarrativeIRV1(fixture.input, fixture.sources)
    expect(canonicalNarrativeJsonV1(alreadyBound.bundle)).toBe(canonicalNarrativeJsonV1(unbound.bundle))
    const stale = structuredClone(bound)
    stale.records[0].revisionHash = 'f'.repeat(64)
    await expect(compileImmutableNarrativeIRV1(stale, fixture.sources)).rejects.toThrow('stale-reference')
    expect(await verifyNarrativeIRBundleV1(unbound.bundle, unbound.sources)).toBe(unbound.bundle)
    const changedSources = structuredClone(unbound.sources); changedSources[0].text += '改'
    await expect(verifyNarrativeIRBundleV1(unbound.bundle, changedSources)).rejects.toThrow('evidence-hash')
  })

  it.each(['record', 'dependency', 'payload', 'nested-value'])('不可变编译在 %s 位置拒绝旧 revision，不静默修复', async site => {
    const fixture = await narrativeIRFixture(), input = structuredClone(fixture.input), stale = 'f'.repeat(64)
    if (site === 'record') input.records[0].revisionHash = stale
    if (site === 'dependency') input.records[0].dependencies = [{ semanticId: fixture.ids[1], revisionHash: stale, role: 'requires' }]
    if (site === 'payload') input.records.find(record => record.kind === 'event')!.payload.participants[0].entityRef.revisionHash = stale
    if (site === 'nested-value') input.records.find(record => record.kind === 'relation')!.payload.value = {
      kind: 'ordered-set', values: [{ kind: 'entity-ref', value: { kind: 'entity', semanticId: fixture.ids[0], revisionHash: stale } }],
    }
    const before = canonicalNarrativeJsonV1(input)
    await expect(compileImmutableNarrativeIRV1(input, fixture.sources)).rejects.toThrow('stale-reference')
    expect(canonicalNarrativeJsonV1(input)).toBe(before)
  })
})
