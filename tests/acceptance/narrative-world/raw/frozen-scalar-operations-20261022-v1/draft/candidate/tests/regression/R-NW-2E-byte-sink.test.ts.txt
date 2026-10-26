import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  canonicalNarrativeJsonWithHashV1, freezeAndHashNarrativeJsonV1, hashNarrativeBytesV1,
  hashNarrativeTextPartsV1, hashNarrativeValueV1, hashNarrativeValueWithoutKeysV1, inspectCanonicalNarrativeObjectV1,
  parseCanonicalNarrativeObjectV1, splitCanonicalNarrativeObjectV1,
} from '../../src/lib/world-engine/narrative-json'
import { initializeNarrativeSha256V1 } from '../../src/lib/narrative-domain/sha256'

const sha = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex')

describe('NW-2E · 有界 UTF-8 摘要缓冲', () => {
  it('短段重分区与长段交替保持完整 UTF-8 原文，不受文本和字节缓冲边界影响', async () => {
    for (const length of [4093, 4094, 4095, 4096, 4097, 4098, 32_765, 32_766, 32_767, 32_768, 32_769]) {
      const text = 'a'.repeat(length) + '😀桥é\u0000\r\n' + '汉字😀'.repeat(12_000) + '尾'
      const scalars = Array.from(text)
      const single = scalars.slice()
      const mixed: string[] = []
      for (let at = 0; at < scalars.length;) {
        const size = [1, 31, 64, 127, 129, 4097][mixed.length % 6]
        mixed.push(scalars.slice(at, at + size).join('')); at += size
      }
      const expected = sha(text)
      for (const parts of [single, mixed, [text]]) expect(await hashNarrativeTextPartsV1(parts)).toBe(expected)
    }
  })

  it('尚未编码的短段在失败和深层重入后不泄入下一次摘要', async () => {
    const expected: Promise<string>[] = []
    function* nested(depth: number): Generator<string> {
      yield `层${depth}:😀`
      if (depth < 8) expected.push(hashNarrativeTextPartsV1(nested(depth + 1)))
      yield ':尾'
    }
    expect(await hashNarrativeTextPartsV1(nested(0))).toBe(sha('层0:😀:尾'))
    // Recursive synchronous consumption completes inner sinks first.
    expect(await Promise.all(expected)).toEqual(Array.from({ length: 8 }, (_, index) => sha(`层${8 - index}:😀:尾`)))
    function* failed(): Generator<string> { yield '尚未冲刷😀'; throw Error('producer failure before flush') }
    await expect(hashNarrativeTextPartsV1(failed())).rejects.toThrow('producer failure before flush')
    await expect(hashNarrativeTextPartsV1(['尚未冲刷', '\ud800'])).rejects.toThrow('unicode')
    expect(await hashNarrativeTextPartsV1(['新的', '摘要'])).toBe(sha('新的摘要'))
  })

  it('原始字符串流保持分段字节、同步消费与失败后的缓冲隔离', async () => {
    const parts = ['\ufeff', '桥😀'.repeat(20_000), '', '\r\n"\\\u0000', '尾']
    const expected = sha(parts.join(''))
    const pending = hashNarrativeTextPartsV1(parts)
    parts.fill('调用返回后修改')
    expect(await pending).toBe(expected)
    // The stream is not a JSON verifier; raw text is hashed literally.
    expect(await hashNarrativeTextPartsV1(['not ', 'JSON'])).toBe(sha('not JSON'))
    for (const bad of [['\ud800', '\udc00'], ['prefix', undefined], ['prefix', { toString: () => 'hidden' }]]) {
      await expect(hashNarrativeTextPartsV1(bad as string[])).rejects.toThrow()
    }
    const nested: Promise<string>[] = []
    function* interrupted() {
      yield '旧数据'.repeat(20_000)
      nested.push(hashNarrativeTextPartsV1(['独立', '😀']))
      throw new Error('producer failure')
    }
    await expect(hashNarrativeTextPartsV1(interrupted())).rejects.toThrow('producer failure')
    expect(await nested[0]).toBe(sha('独立😀'))
    expect(await hashNarrativeTextPartsV1(['新的', '短数据'])).toBe(sha('新的短数据'))
  })

  it('每个合法 BMP 码点和星界边界保持 Node 原生 UTF-8 摘要', async () => {
    const scalars: string[] = []
    for (let code = 0; code <= 0xffff; code++) {
      if (code < 0xd800 || code > 0xdfff) scalars.push(String.fromCodePoint(code))
    }
    for (let high = 0; high < 1024; high++) {
      for (const low of [0, 1, 1022, 1023]) scalars.push(String.fromCodePoint(0x10000 + high * 1024 + low))
    }
    const expected = JSON.stringify(scalars)
    // First run uses the original JavaScript backend; the same bytes then
    // pass through explicitly initialized WASM. Native JSON and Node crypto
    // provide the expected bytes independently of the implementation.
    expect(await hashNarrativeValueV1(scalars)).toBe(sha(expected))
    await initializeNarrativeSha256V1()
    expect(await hashNarrativeValueV1(scalars)).toBe(sha(expected))
    expect(canonicalNarrativeJsonWithHashV1(scalars)).toEqual({ json: expected, hash: sha(expected) })
  })

  it('短长编码切换与剩余一至四字节空间不拆开 UTF-8 码点', async () => {
    for (const offset of [0, 1, 2, 3, 4, 5, 127, 128, 129, 379, 380, 381, 383, 384, 385]) {
      const prefix = 'x'.repeat(32_768 - offset)
      const values = [prefix, '\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff𐀀\u{10ffff}',
        'é'.repeat(62), '桥'.repeat(63), '桥'.repeat(126), '桥'.repeat(127),
        '😀'.repeat(63), '😀'.repeat(64), '😀'.repeat(65),
        '\r\n\\"\u0000', 'z'.repeat(65_537), 'e\u0301', '']
      const expected = JSON.stringify(values)
      expect(await hashNarrativeValueV1(values)).toBe(sha(expected))
      for (const length of [127, 128, 129, 32_767, 32_768, 32_769]) {
        const raw = prefix + '😀' + '桥'.repeat(length)
        expect(await hashNarrativeBytesV1(raw)).toBe(sha(raw))
      }
    }
    for (const raw of ['桥'.repeat(127), '桥'.repeat(128), '桥'.repeat(129), '😀'.repeat(64)]) {
      expect(await hashNarrativeBytesV1(raw)).toBe(sha(raw))
    }
  })

  it('根字段投影、递归排除、延后解码及冻结摘要仍绑定完整规范字节', async () => {
    const value = { a: '桥😀'.repeat(9000), hidden: { secret: '留在正文', value: [true, null] },
      nested: { hidden: '只按相应契约排除', value: 'é'.repeat(129) }, z: [1e-7, 0, '末尾'] }
    const wire = JSON.stringify(value)
    const root = sha(JSON.stringify({ a: value.a, nested: value.nested, z: value.z }))
    expect(inspectCanonicalNarrativeObjectV1(value, wire, ['hidden'])).toEqual({ matches: true, projectionHash: root })
    expect(parseCanonicalNarrativeObjectV1(wire, ['hidden'])).toMatchObject({ matches: true, projectionHash: root })
    expect(splitCanonicalNarrativeObjectV1(wire, 'a', ['hidden'])).toMatchObject({ deferredJson: JSON.stringify(value.a), projectionHash: root })
    const recursive = sha(JSON.stringify({ a: value.a, nested: { value: value.nested.value }, z: value.z }))
    expect(await hashNarrativeValueWithoutKeysV1(value, ['hidden'])).toBe(recursive)
    expect(await freezeAndHashNarrativeJsonV1(value, ['hidden'])).toBe(recursive)
    expect(Object.isFrozen(value.hidden)).toBe(true)
    expect(await hashNarrativeValueV1(value)).toBe(sha(wire))
  })

  it('超过四层的重入摘要不共用活动缓冲，异常后不泄入上次字节', async () => {
    const observed: Array<{ pending: Promise<string>; expected: string }> = []
    const nested = (depth: number): Promise<string> => {
      const target = { a: `level:${depth}:` + '桥😀'.repeat(8000), z: depth }
      let aDescriptors = 0
      const value = new Proxy(target, { getOwnPropertyDescriptor(object, key) {
        // Object.keys first requests this descriptor. Reenter on the actual
        // value visit, after the outer sink has written its opening brace.
        if (key === 'a' && ++aDescriptors === 2 && depth < 9) {
          const next = { a: `level:${depth + 1}:` + '桥😀'.repeat(8000), z: depth + 1 }
          observed.push({ pending: nested(depth + 1), expected: sha(JSON.stringify(next)) })
        }
        return Reflect.getOwnPropertyDescriptor(object, key)
      } })
      return hashNarrativeValueV1(value)
    }
    const root = await nested(0)
    expect(root).toBe(sha(JSON.stringify({ a: 'level:0:' + '桥😀'.repeat(8000), z: 0 })))
    expect(observed.length).toBeGreaterThanOrEqual(9)
    for (const item of observed) expect(await item.pending).toBe(item.expected)
    let invoked = false
    const invalid = Object.defineProperty({ a: '旧数据'.repeat(20_000) }, 'z', {
      enumerable: true, get() { invoked = true; return '不能读取' },
    })
    for (const bad of [invalid, { a: '旧数据'.repeat(20_000), z: '\ud800' }, { a: 1, z: Array(2) }]) {
      expect(() => hashNarrativeValueV1(bad)).toThrow()
      expect(await hashNarrativeValueV1({ a: '新的短数据' })).toBe(sha('{"a":"新的短数据"}'))
    }
    expect(invoked).toBe(false)
    const bytes = new Uint8Array([9, 0, 1, 2, 3, 8]).subarray(1, 5), expected = sha(bytes)
    const pending = hashNarrativeBytesV1(bytes); bytes.fill(255)
    expect(await pending).toBe(expected)
  })

  it('原生编码只收到有界视图，输入调用后的改写不能改变摘要', async () => {
    const value = { a: '桥😀'.repeat(100_000), z: '尚未改写' }, expected = sha(JSON.stringify(value))
    const encode = vi.spyOn(TextEncoder.prototype, 'encodeInto')
    try {
      const pending = hashNarrativeValueV1(value); value.z = '之后改写'
      expect(await pending).toBe(expected)
      expect(encode.mock.calls.length).toBeGreaterThan(1)
      expect(encode.mock.calls.every(([text, bytes]) => text.length <= 32_768 && bytes.byteLength <= 32_768)).toBe(true)
      expect(new Set(encode.mock.calls.map(([, bytes]) => bytes.buffer)).size).toBe(1)
    } finally { encode.mockRestore() }
  })
})
