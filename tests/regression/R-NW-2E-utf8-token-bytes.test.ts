import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  canonicalNarrativeJsonWithHashV1, freezeAndHashNarrativeJsonV1, hashNarrativeBytesV1,
  hashNarrativeValueV1, hashNarrativeValueWithoutKeysV1,
} from '../../src/lib/world-engine/narrative-json'
import { initializeNarrativeSha256V1 } from '../../src/lib/narrative-domain/sha256'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('NW-2E · 短 token UTF-8 字节复用', () => {
  it('切换边界、BOM、转义及组合 Unicode 保持原生字节和两种摘要后端', async () => {
    const values = [
      ...[11, 12, 13, 126, 127, 128, 129].flatMap(length => [
        'a'.repeat(length), '桥'.repeat(length), '😀'.repeat(Math.floor(length / 2)) + (length % 2 ? 'é' : ''),
        '\ufeff' + 'x'.repeat(length - 1), '\\"\n\t\u0000' + 'x'.repeat(length - 5),
      ]),
      'e\u0301é\u2028\u2029\uffff𐀀\u{10ffff}',
    ]
    for (let backend = 0; backend < 2; backend++) {
      if (backend) await initializeNarrativeSha256V1()
      for (const value of values) {
        expect(await hashNarrativeBytesV1(value)).toBe(sha(value))
        // Repeat after a cached encoding is eligible, including an initial
        // BOM that TextDecoder normally consumes unless configured otherwise.
        expect(await hashNarrativeBytesV1(value)).toBe(sha(value))
      }
      const wire = JSON.stringify(values)
      expect(await hashNarrativeValueV1(values)).toBe(sha(wire))
      expect(canonicalNarrativeJsonWithHashV1(values)).toEqual({ json: wire, hash: sha(wire) })
    }
  })

  it('多轮容量淘汰和相同前缀不混淆字节，长字符串仍按有界原生视图编码', async () => {
    const values = Array.from({ length: 5000 }, (_, index) =>
      `utf8-byte-eviction:${String(index).padStart(5, '0')}:` + '桥😀'.repeat(index % 3 ? 18 : 32))
    const all = [...values, ...values.slice().reverse(), ...values.slice(0, 30)]
    const wire = JSON.stringify(all)
    expect(await hashNarrativeValueV1(all)).toBe(sha(wire))
    for (const value of [values[0], values[1023], values[1024], values[4095], values[4999]]) {
      expect(await hashNarrativeBytesV1(value)).toBe(sha(value))
    }
    const large = '桥😀'.repeat(100_000), encoder = vi.spyOn(TextEncoder.prototype, 'encodeInto')
    try {
      expect(await hashNarrativeBytesV1(large)).toBe(sha(large))
      expect(encoder.mock.calls.length).toBeGreaterThan(1)
      expect(encoder.mock.calls.every(([text, bytes]) => text.length <= 32_768 && bytes.byteLength <= 32_768)).toBe(true)
    } finally { encoder.mockRestore() }
  })

  it('已见过的 token 不给可变对象、排除字段或非法 JSON 赋予有效性', async () => {
    const token = 'same-validated-token:桥😀', value: { a: unknown; z: unknown } = { a: token, z: token }
    expect(await hashNarrativeValueV1(value)).toBe(sha(JSON.stringify(value)))
    value.z = 'changed-current-token:桥😀'
    expect(await hashNarrativeValueV1(value)).toBe(sha(JSON.stringify(value)))
    const sparse = [token, token]; delete sparse[1]
    const cycle: unknown[] = [token]; cycle.push(cycle)
    let invoked = false
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return token } })
    for (const invalid of ['\ud800', -0, Number.POSITIVE_INFINITY, undefined, sparse, cycle, getter]) {
      const bad = { a: token, hidden: invalid }
      expect(() => hashNarrativeValueV1(bad)).toThrow()
      expect(() => hashNarrativeValueWithoutKeysV1(bad, ['hidden'])).toThrow()
      expect(() => freezeAndHashNarrativeJsonV1(bad, ['hidden'])).toThrow()
      expect(await hashNarrativeValueV1({ a: token })).toBe(sha(JSON.stringify({ a: token })))
    }
    for (const invalid of ['\ud800' + token, token + '\udc00']) await expect(hashNarrativeBytesV1(invalid)).rejects.toThrow('unicode')
    expect(invoked).toBe(false)
    expect(Object.isFrozen(value)).toBe(false)
  })

  it('重入期间淘汰旧 token 不改写活动摘要，异常后下一次摘要仍独立', async () => {
    const token = 'outer-retained-token:桥😀'
    await hashNarrativeBytesV1(token)
    const target = { a: token, z: 'outer-final-token:桥😀' }
    const churn = Array.from({ length: 4000 }, (_, index) => `inner-token:${index}:` + 'é桥'.repeat(30))
    let inner: Promise<string> | undefined, descriptors = 0
    const value = new Proxy(target, { getOwnPropertyDescriptor(object, key) {
      if (key === 'z' && ++descriptors === 2) inner = hashNarrativeValueV1(churn)
      return Reflect.getOwnPropertyDescriptor(object, key)
    } })
    expect(await hashNarrativeValueV1(value)).toBe(sha(JSON.stringify(target)))
    expect(inner).toBeDefined()
    expect(await inner).toBe(sha(JSON.stringify(churn)))
    expect(await hashNarrativeBytesV1(token)).toBe(sha(token))
    expect(() => hashNarrativeValueV1({ a: token, z: '\ud800' })).toThrow('unicode')
    expect(await hashNarrativeValueV1(target)).toBe(sha(JSON.stringify(target)))
  })
})
