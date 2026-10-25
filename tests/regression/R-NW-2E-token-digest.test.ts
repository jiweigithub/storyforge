import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertNarrativeJsonV1, boundedCanonicalNarrativeJsonV1, canonicalNarrativeJsonV1,
  canonicalNarrativeJsonWithHashV1, freezeNarrativeJsonV1, hashNarrativeValueV1,
  hashNarrativeValueWithoutKeysV1, inspectCanonicalNarrativeObjectV1,
} from '../../src/lib/world-engine/narrative-json'
import { createNarrativeSha256V1, initializeNarrativeSha256V1 } from '../../src/lib/narrative-domain/sha256'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('NW-2E · 精确字符串字节与摘要状态', () => {
  it('全部 C0 控制字符、引号、反斜线、Unicode 和长文保持原生 JSON 字节', async () => {
    const controls = String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index))
    const values = ['', controls, '"\\/\r\n\t', 'e\u0301é\u2028\u2029\ufeff\uffff𐀀😀',
      'ascii:%2F:1e+20', '桥😀'.repeat(40_000), 'a'.repeat(32_767) + '😀末尾']
    const expected = JSON.stringify(values)
    expect(canonicalNarrativeJsonV1(values)).toBe(expected)
    expect(canonicalNarrativeJsonWithHashV1(values)).toEqual({ json: expected, hash: sha(expected) })
    expect(await hashNarrativeValueV1(values)).toBe(sha(expected))
    expect(boundedCanonicalNarrativeJsonV1(values, Buffer.byteLength(expected))).toBe(expected)
    expect(boundedCanonicalNarrativeJsonV1(values, Buffer.byteLength(expected) - 1)).toBeNull()
  })

  it('交替短长字符串、重访和多轮容量淘汰不混淆相同前缀或改变原文', async () => {
    const rows: string[] = []
    for (let index = 0; index < 5000; index++) {
      rows.push(`共用前缀:${index % 1300}:${'x'.repeat(index % 4 === 0 ? 500 : 5)}:😀`,
        `quote:"${index}\\`, `共用前缀:${index % 11}:😀`, index % 2 ? '' : '桥')
    }
    const value = { a: rows, b: rows.slice().reverse() }, expected = JSON.stringify(value)
    expect(canonicalNarrativeJsonV1(value)).toBe(expected)
    expect(await hashNarrativeValueV1(value)).toBe(sha(expected))
    freezeNarrativeJsonV1(value)
    expect(canonicalNarrativeJsonV1(value)).toBe(expected)
    expect(await hashNarrativeValueWithoutKeysV1(value, ['b'])).toBe(sha(JSON.stringify({ a: rows })))
    expect(inspectCanonicalNarrativeObjectV1(value, expected, ['b']))
      .toEqual({ matches: true, projectionHash: sha(JSON.stringify({ a: rows })) })
  })

  it('已有合法相邻值或排除字段不能掩盖非法 Unicode、访问器和稀疏数组', () => {
    for (const bad of ['\ud800', '\udc00', '桥\ud800尾', '\ud800\ud800']) {
      const value = { a: ['桥😀', '桥😀'], z: bad }
      expect(() => assertNarrativeJsonV1(value)).toThrow('unicode')
      expect(() => canonicalNarrativeJsonV1(value)).toThrow('unicode')
      expect(() => hashNarrativeValueWithoutKeysV1(value, ['z'])).toThrow('unicode')
      expect(() => inspectCanonicalNarrativeObjectV1(value, '{}', ['z'])).toThrow('unicode')
    }
    let invoked = false
    const values = ['safe', 'safe']
    Object.defineProperty(values, '1', { get() { invoked = true; return 'safe' }, enumerable: true })
    expect(() => canonicalNarrativeJsonV1(values)).toThrow('accessor')
    expect(invoked).toBe(false)
    const sparse = ['safe', 'safe']; delete sparse[1]
    expect(() => canonicalNarrativeJsonV1(sparse)).toThrow('json')
  })

  it('十六进制与二进制终态互斥，超出 WASM 状态池的交错摘要仍独立且可恢复', async () => {
    await initializeNarrativeSha256V1()
    // Nine simultaneous states exceed the four-state accelerated pool, so
    // both implementations must obey the same terminal and reset contract.
    const sinks = Array.from({ length: 9 }, () => createNarrativeSha256V1())
    for (let step = 0; step < 5; step++) for (const [index, sink] of sinks.entries()) {
      sink.update(new TextEncoder().encode(`${index}:${step}:桥😀;`))
    }
    for (const [index, sink] of sinks.entries()) {
      const input = Array.from({ length: 5 }, (_, step) => `${index}:${step}:桥😀;`).join('')
      const actual = index % 2 ? Buffer.from(sink.digest()).toString('hex') : sink.digestHex()
      expect(actual).toBe(sha(input))
      expect(() => sink.digestHex()).toThrow('finished')
      expect(() => sink.digest()).toThrow('finished')
      expect(() => sink.update(new Uint8Array())).toThrow('finished')
      sink.destroy(); sink.destroy()
      expect(() => sink.digestHex()).toThrow('released')
    }
    const fresh = createNarrativeSha256V1()
    expect(fresh.digestHex()).toBe(sha(''))
    fresh.destroy()
  })
})
