import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertNarrativeJsonV1, canonicalNarrativeJsonV1, freezeAndHashNarrativeJsonV1,
  freezeNarrativeJsonV1, hashNarrativeValueV1,
} from '../../src/lib/world-engine/narrative-json'
import { compileImmutableNarrativeIRV1, compileNarrativeIRBundleV1 } from '../../src/lib/world-engine/narrative-ir'
import { narrativeIRFixture } from '../helpers/narrative-ir-fixture'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const checkFrozen = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  Object.values(value).forEach(checkFrozen)
}

describe('NW-2E · 严格校验、冻结和哈希合并遍历保持原契约', () => {
  it('独立固定字节和 Node SHA 覆盖键序、原型键、Unicode、转义及跨缓冲区数据', async () => {
    const row = JSON.parse('{"𐀀":"补充平面","2":2,"__proto__":{"x":true},"10":10,"z":[null,false,1.5,"é\\r\\n\\"\\\\"],"":1}')
    // Literal scalar-key order, independent of the production comparator.
    const rowWire = '{"10":10,"2":2,"__proto__":{"x":true},"z":[null,false,1.5,"é\\r\\n\\"\\\\"],"":1,"𐀀":"补充平面"}'
    const value = Array.from({ length: 700 }, () => structuredClone(row))
    const wire = `[${Array.from({ length: 700 }, () => rowWire).join(',')}]`
    expect(Buffer.byteLength(wire)).toBeGreaterThan(32768)
    expect(await freezeAndHashNarrativeJsonV1(value)).toBe(sha(wire))
    checkFrozen(value)
    expect(canonicalNarrativeJsonV1(value)).toBe(wire)
    expect(await hashNarrativeValueV1(value)).toBe(sha(wire))
    expect(await freezeAndHashNarrativeJsonV1(value)).toBe(sha(wire))
    const ordinary = freezeNarrativeJsonV1(structuredClone(value))
    expect(await hashNarrativeValueV1(ordinary)).toBe(sha(wire))
  })

  it('非法数值、Unicode、对象和数组仍拒绝，访问器不会执行', () => {
    let invoked = false
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return 1 } })
    const symbolic = { [Symbol('hidden')]: 1 }
    const sparse = Array(2)
    const extra = Object.assign([1], { extra: 2 })
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    const invalid: unknown[] = [
      -0, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, undefined,
      1n, '\ud800', { '\udfff': 1 }, accessor, symbolic, sparse, extra, cycle,
      Object.assign(Object.create({ inherited: true }), { value: 1 }),
    ]
    for (const value of invalid) {
      expect(() => freezeAndHashNarrativeJsonV1(value)).toThrow()
      expect(() => assertNarrativeJsonV1(value)).toThrow()
    }
    expect(invoked).toBe(false)
  })

  it('后部失败即使对象已冻结也不授权父节点；独立修复副本须重新完整遍历', async () => {
    const input = { a: { text: '先完成的子节点' }, z: { text: '\ud800' } }
    expect(() => freezeAndHashNarrativeJsonV1(input)).toThrow('unicode')
    expect(Object.isFrozen(input.a)).toBe(true)
    // The existing freezer locks descriptors before inspection. A frozen flag
    // alone is therefore deliberately insufficient after a failed traversal.
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input.z)).toBe(true)
    expect(() => canonicalNarrativeJsonV1(input)).toThrow('unicode')
    expect(() => assertNarrativeJsonV1(input)).toThrow('unicode')
    expect(() => freezeAndHashNarrativeJsonV1(input)).toThrow('unicode')
    const repaired = structuredClone(input)
    repaired.z.text = '已修复'
    const wire = '{"a":{"text":"先完成的子节点"},"z":{"text":"已修复"}}'
    expect(await freezeAndHashNarrativeJsonV1(repaired)).toBe(sha(wire))
    checkFrozen(repaired)
    const clone = structuredClone(repaired)
    clone.a.text = '克隆可改'
    expect(canonicalNarrativeJsonV1(clone)).not.toBe(wire)
    expect(canonicalNarrativeJsonV1(repaired)).toBe(wire)
    expect(() => canonicalNarrativeJsonV1(input)).toThrow('unicode')
  })

  it('普通 IR 的返回值仍可编辑；不可变编译不改变调用者数据或最终字节', async () => {
    const fixture = await narrativeIRFixture()
    const inputBefore = canonicalNarrativeJsonV1(fixture.input)
    const ordinary = await compileNarrativeIRBundleV1(fixture.input, fixture.sources)
    const immutable = await compileImmutableNarrativeIRV1(fixture.input, fixture.sources)
    expect(canonicalNarrativeJsonV1(immutable.bundle)).toBe(canonicalNarrativeJsonV1(ordinary))
    expect(Object.isFrozen(ordinary.records)).toBe(false)
    expect(Object.isFrozen(ordinary.records[0])).toBe(false)
    expect(Reflect.set(ordinary.records[0], 'confidence', 0.25)).toBe(true)
    expect(immutable.bundle.records[0].confidence).toBeNull()
    checkFrozen(immutable.bundle)
    expect(canonicalNarrativeJsonV1(fixture.input)).toBe(inputBefore)
    expect(Object.isFrozen(fixture.input.records[0])).toBe(false)
  })
})
