import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  boundedCanonicalNarrativeJsonV1, canonicalNarrativeJsonV1, freezeAndHashNarrativeJsonV1,
  hashNarrativeValueV1, hashNarrativeValueWithoutKeysV1,
} from '../../src/lib/world-engine/narrative-json'
import { initializeNarrativeSha256V1 } from '../../src/lib/narrative-domain/sha256'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const numbers = (length: number) => Array.from({ length }, (_, index) =>
  [index, -index - 1, 1e-7, 1.25, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE][index % 6])

describe('NW-2E · 严格校验后的有界数字段摘要', () => {
  it('短数组、整段边界、尾段及浮点拼写与原生 JSON 和两种 SHA 后端一致', async () => {
    for (const accelerated of [false, true]) {
      if (accelerated) await initializeNarrativeSha256V1()
      for (const length of [0, 1, 31, 32, 33, 255, 256, 257, 511, 512, 513, 2049]) {
        const value = numbers(length), wire = JSON.stringify(value)
        expect(canonicalNarrativeJsonV1(value)).toBe(wire)
        expect(await hashNarrativeValueV1(value)).toBe(sha(wire))
        expect(await freezeAndHashNarrativeJsonV1(value)).toBe(sha(wire))
        expect(await hashNarrativeValueV1(value)).toBe(sha(wire))
      }
    }
  })

  it('数字段两侧及相邻嵌套值的逗号、Unicode、递归省略完全保持', async () => {
    const value = { a: [null, ...numbers(255), '桥😀', ...numbers(256), false,
      { hidden: numbers(257), keep: numbers(33) }, ...numbers(513), []], hidden: numbers(1000) }
    const wire = JSON.stringify(value)
    expect(await hashNarrativeValueV1(value)).toBe(sha(wire))
    const kept = { a: [null, ...numbers(255), '桥😀', ...numbers(256), false,
      { keep: numbers(33) }, ...numbers(513), []] }
    const expected = sha(JSON.stringify(kept))
    expect(await hashNarrativeValueWithoutKeysV1(value, ['hidden'])).toBe(expected)
    expect(await freezeAndHashNarrativeJsonV1(value, ['hidden'])).toBe(expected)
    expect(await hashNarrativeValueV1(value)).toBe(sha(wire))
  })

  it('长数组后段的非法数字、对象、Unicode 和省略值仍完整拒绝', () => {
    const invalid = [NaN, Infinity, -Infinity, -0, Number.MAX_SAFE_INTEGER + 1, undefined, 1n,
      Object(1), '\ud800']
    for (const bad of invalid) {
      for (const at of [31, 255, 256, 512]) {
        const value: unknown[] = numbers(514); value[at] = bad
        expect(() => hashNarrativeValueV1(value)).toThrow()
        expect(() => hashNarrativeValueWithoutKeysV1({ hidden: value }, ['hidden'])).toThrow()
        expect(() => freezeAndHashNarrativeJsonV1(value)).toThrow()
      }
    }
  })

  it('空洞、额外属性、symbol、循环和 accessor 不因数字段而被隐藏', () => {
    let getters = 0
    const accessor = numbers(600)
    Object.defineProperty(accessor, 256, { enumerable: true, get() { getters++; return 1 } })
    const sparse = numbers(600); delete sparse[256]
    const extra = Object.assign(numbers(600), { extra: 1 })
    const symbolic = Object.assign(numbers(600), { [Symbol('hidden')]: 1 })
    const cycle: unknown[] = numbers(600); cycle[256] = cycle
    for (const value of [accessor, sparse, extra, symbolic, cycle]) {
      expect(() => hashNarrativeValueV1(value)).toThrow()
      expect(() => freezeAndHashNarrativeJsonV1(value)).toThrow()
    }
    expect(getters).toBe(0)
  })

  it('只拼接私有数字副本，不调用数组 toJSON 或重新读取已检查的元素', async () => {
    let invoked = 0
    const value = numbers(600), expected = sha(JSON.stringify(value))
    Object.defineProperty(value, 'toJSON', { value: () => { invoked++; throw Error('toJSON invoked') } })
    expect(await hashNarrativeValueV1(value)).toBe(expected)
    expect(invoked).toBe(0)
    const target = numbers(600), before = JSON.stringify(target)
    let descriptors = 0
    const proxy = new Proxy(target, { getOwnPropertyDescriptor(array, key) {
      // Enumeration requests each descriptor first. During the value visit,
      // change an already copied element before the first numeric run flush.
      if (key === '1' && ++descriptors === 2) array[0] = 999
      return Reflect.getOwnPropertyDescriptor(array, key)
    } })
    expect(await hashNarrativeValueV1(proxy)).toBe(sha(before))
    expect(target[0]).toBe(999)
    expect(await hashNarrativeValueV1(target)).toBe(sha(JSON.stringify(target)))
  })

  it('摘要失败后的下一次写入及有界编码的原提前退出规则保持', async () => {
    const late: unknown[] = numbers(600); late[599] = '\ud800'
    expect(boundedCanonicalNarrativeJsonV1(late, 3)).toBeNull()
    expect(() => hashNarrativeValueV1(late)).toThrow('unicode')
    const valid = numbers(600), wire = JSON.stringify(valid)
    expect(await hashNarrativeValueV1(valid)).toBe(sha(wire))
    expect(boundedCanonicalNarrativeJsonV1(valid, wire.length)).toBe(wire)
    expect(boundedCanonicalNarrativeJsonV1(valid, wire.length - 1)).toBeNull()
  })
})
