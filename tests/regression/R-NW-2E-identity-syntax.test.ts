import { describe, expect, it } from 'vitest'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { createNarrativeSemanticIdV1, parseNarrativeSemanticIdV1 } from '../../src/lib/world-engine/narrative-identity'
import { irSourceIdentity, NW_OWNER } from '../helpers/narrative-ir-fixture'

describe('NW-2E · 身份语法复用不缓存注册表权限或暴露共享可变状态', () => {
  it('每次返回独立可编辑副本，修改上次解析结果不改变后续身份', () => {
    const source = irSourceIdentity('character', 7001)
    const id = createNarrativeSemanticIdV1(NW_OWNER, 'entity', source)
    const expected = { ownerKey: `work/${NW_OWNER.kind === 'work' ? NW_OWNER.workCode : ''}`, kind: 'entity', source }
    const first = parseNarrativeSemanticIdV1(id)
    expect(first).toEqual(expected)
    first.ownerKey = 'work/caller-poison'; first.kind = 'rule'
    first.source.sourceUid = 'caller-poison'; first.source.subKey = 'caller-poison'
    const second = parseNarrativeSemanticIdV1(id)
    expect(second).toEqual(expected)
    expect(second).not.toBe(first)
    expect(second.source).not.toBe(first.source)
    expect(Object.isFrozen(second)).toBe(false)
    expect(Object.isFrozen(second.source)).toBe(false)
  })

  it('缓存命中仍拒绝已撤销或重复的资源注册，恢复注册后才重新通过', () => {
    const source = irSourceIdentity('character', 7002)
    const id = createNarrativeSemanticIdV1(NW_OWNER, 'entity', source)
    const expected = parseNarrativeSemanticIdV1(id)
    const original = PROJECT_TABLES.find(spec => spec.name === 'characters')!.resourceIdentity!
    const other = PROJECT_TABLES.find(spec => spec.resourceIdentity && spec.resourceIdentity.resourceKind !== original.resourceKind)!.resourceIdentity!
    const originalKind = original.resourceKind, otherKind = other.resourceKind
    try {
      expect(Reflect.set(original, 'resourceKind', 'temporarily-removed-character')).toBe(true)
      expect(() => parseNarrativeSemanticIdV1(id)).toThrow('resource-kind')
      expect(Reflect.set(original, 'resourceKind', originalKind)).toBe(true)
      expect(Reflect.set(other, 'resourceKind', originalKind)).toBe(true)
      expect(() => parseNarrativeSemanticIdV1(id)).toThrow('resource-kind')
    } finally {
      Reflect.set(original, 'resourceKind', originalKind)
      Reflect.set(other, 'resourceKind', otherKind)
    }
    expect(parseNarrativeSemanticIdV1(id)).toEqual(expected)
  })

  it('大量身份淘汰后仍逐字解析；非规范转义、错误 owner、非法 subKey 不借用相近身份', () => {
    const source = irSourceIdentity('character', 7003)
    const id = createNarrativeSemanticIdV1(NW_OWNER, 'entity', source)
    const expected = parseNarrativeSemanticIdV1(id)
    for (let index = 0; index < 2300; index++) {
      const distinct = irSourceIdentity('character', index + 8000)
      const text = createNarrativeSemanticIdV1(NW_OWNER, 'entity', distinct)
      expect(parseNarrativeSemanticIdV1(text).source).toEqual(distinct)
    }
    expect(parseNarrativeSemanticIdV1(id)).toEqual(expected)
    const noncanonical = id.replace('%3A', '%3a')
    expect(noncanonical).not.toBe(id)
    const wrongOwner = id.split(':'); wrongOwner[2] = encodeURIComponent('work/not-a-work-code')
    const wrongSubkey = id.split(':'); wrongSubkey[5] = 'array-index-1'
    for (const invalid of [noncanonical, wrongOwner.join(':'), wrongSubkey.join(':'), `${id}\ud800`, { toString: () => id }]) {
      expect(() => parseNarrativeSemanticIdV1(invalid)).toThrow()
    }
    expect(parseNarrativeSemanticIdV1(id)).toEqual(expected)
  })
})
