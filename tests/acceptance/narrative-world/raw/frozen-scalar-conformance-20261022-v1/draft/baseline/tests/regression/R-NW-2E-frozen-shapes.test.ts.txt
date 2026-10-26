import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertNarrativeJsonV1, boundedCanonicalNarrativeJsonV1, canonicalNarrativeJsonV1,
  freezeNarrativeJsonV1, hashNarrativeValueV1, hashNarrativeValueWithoutKeysV1,
  inspectCanonicalNarrativeObjectV1, matchesCanonicalNarrativeJsonV1,
} from '../../src/lib/world-engine/narrative-json'

// Independent reference: scalar arrays, no production comparator or encoder.
function reference(value: unknown, omit: ReadonlySet<string> = new Set()): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => reference(item, omit)).join(',')}]`
  const scalarOrder = (a: string, b: string) => {
    const left = Array.from(a, char => char.codePointAt(0)!), right = Array.from(b, char => char.codePointAt(0)!)
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      if (left[index] !== right[index]) return left[index] - right[index]
    }
    return left.length - right.length
  }
  return `{${Object.keys(value).filter(key => !omit.has(key)).sort(scalarOrder)
    .map(key => `${JSON.stringify(key)}:${reference((value as Record<string, unknown>)[key], omit)}`).join(',')}}`
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('NW-2E · 有界冻结形状只复用结构，不复用值或权限', () => {
  it('相同字段、不同插入顺序与值保留数字键、控制符、原型键和 Unicode 规范字节', async () => {
    const keys = ['z', '2', '10', '\ue000', '𐀀', '__proto__', 'a\u0000b', '"\\\r\n']
    const rows = Array.from({ length: 30 }, (_, index) => Object.fromEntries(
      (index % 2 ? keys : [...keys].reverse()).map((key, position) => [key, [index, position, `桥${index}e\u0301𐀀`]])))
    const expected = reference(rows)
    freezeNarrativeJsonV1(rows)
    expect(canonicalNarrativeJsonV1(rows)).toBe(expected)
    expect(await hashNarrativeValueV1(rows)).toBe(sha(expected))
    expect(JSON.parse(expected)).toEqual(rows)
    expect(matchesCanonicalNarrativeJsonV1(rows, expected)).toBe(true)
    expect(boundedCanonicalNarrativeJsonV1(rows, Buffer.byteLength(expected))).toBe(expected)
    expect(boundedCanonicalNarrativeJsonV1(rows, Buffer.byteLength(expected) - 1)).toBeNull()
  })

  it('形状淘汰、超长键和多字段回退仍能编码先前存活的对象', async () => {
    const early = freezeNarrativeJsonV1({ z: ['原文', 1], a: '早期' })
    const rows = Array.from({ length: 700 }, (_, index) =>
      freezeNarrativeJsonV1({ [`unique-${index}`]: index, shared: ['保留', index] }))
    const long = freezeNarrativeJsonV1({ ['长'.repeat(5000)]: '没有裁剪' })
    const many = freezeNarrativeJsonV1(Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, index])))
    const all = [early, ...rows, long, many]
    expect(canonicalNarrativeJsonV1(all)).toBe(reference(all))
    expect(await hashNarrativeValueV1(early)).toBe(sha('{"a":"早期","z":["原文",1]}'))
  })

  it('含分隔符和空键的形状签名碰撞不改变对象键或值', async () => {
    const objects = [
      {}, { '': 0 }, { 'a\u0000b': 1 }, { a: 2, b: 3 },
      { a: 4, 'b\u0000c': 5 }, { 'a\u0000b': 6, c: 7 },
    ]
    const expected = objects.map(value => reference(value))
    objects.forEach(freezeNarrativeJsonV1)
    for (let index = 0; index < objects.length; index++) {
      expect(canonicalNarrativeJsonV1(objects[index])).toBe(expected[index])
      expect(await hashNarrativeValueV1(objects[index])).toBe(sha(expected[index]))
    }
  })

  it('克隆、可变输入和普通冻结对象即使匹配已缓存形状也必须重新严格检查', () => {
    const value = freezeNarrativeJsonV1({ a: { text: '原文' }, z: [1] })
    canonicalNarrativeJsonV1(value)
    let invoked = false
    const clone = structuredClone(value)
    Object.defineProperty(clone.a, 'text', { enumerable: true, get() { invoked = true; return '伪造' } })
    const ordinary = Object.freeze({ a: { text: undefined }, z: [1] })
    const mutable = { a: { text: '改前' }, z: [1] }
    expect(canonicalNarrativeJsonV1(mutable)).toBe(reference(mutable))
    mutable.a.text = '改后'
    expect(canonicalNarrativeJsonV1(mutable)).toBe(reference(mutable))
    for (const invalid of [clone, ordinary]) {
      expect(() => assertNarrativeJsonV1(invalid)).toThrow()
      expect(() => canonicalNarrativeJsonV1(invalid)).toThrow()
    }
    expect(invoked).toBe(false)
  })

  it('子节点完成后父节点失败不获得凭据，后续检查仍拒绝非法后部', () => {
    const valid = { text: '已校验子节点' }
    const invalid = { a: valid, z: { text: '\ud800' } }
    expect(() => freezeNarrativeJsonV1(invalid)).toThrow('unicode')
    expect(Object.isFrozen(valid)).toBe(true)
    expect(canonicalNarrativeJsonV1(valid)).toBe('{"text":"已校验子节点"}')
    expect(() => assertNarrativeJsonV1(invalid)).toThrow('unicode')
    expect(() => canonicalNarrativeJsonV1(invalid)).toThrow('unicode')
    expect(() => hashNarrativeValueWithoutKeysV1(invalid, ['z'])).toThrow('unicode')
  })

  it('递归排除字段与根字段投影保持不同语义，摘要包含全部未排除值', async () => {
    const value = freezeNarrativeJsonV1({ z: { keep: [1, 2], revisionHash: 'nested' }, revisionHash: 'root', a: '桥' })
    const wire = reference(value)
    expect(await hashNarrativeValueWithoutKeysV1(value, ['revisionHash'])).toBe(sha(reference(value, new Set(['revisionHash']))))
    const result = inspectCanonicalNarrativeObjectV1(value, wire, ['revisionHash'])
    expect(result).toEqual({ matches: true, projectionHash: sha(reference({ a: value.a, z: value.z })) })
    expect(inspectCanonicalNarrativeObjectV1(value, wire + ' ', ['revisionHash']).matches).toBe(false)
  })
})
