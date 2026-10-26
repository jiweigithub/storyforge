import { describe, expect, it } from 'vitest'
import { packNarrativeJsonV1, unpackNarrativeJsonV1, type PackedNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-package-packing'
import { canonicalNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-json'
import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'
import { compressNarrativePackV1, decompressNarrativePackV1 } from '../../src/lib/world-engine/narrative-package-compression'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

describe('NW-2E · 独立版本的无损字典传输', () => {
  it('固定 v4 原文和索引逐字往返，键序变化不影响打包内容', () => {
    const original = { manifest: golden.compiled.manifest, index: golden.compiled.index }
    const packed = packNarrativeJsonV1(original)
    expect(canonicalNarrativeJsonV1(unpackNarrativeJsonV1(packed))).toBe(canonicalNarrativeJsonV1(original))
    expect(packNarrativeJsonV1({ index: original.index, manifest: original.manifest })).toEqual(packed)
    expect(canonicalNarrativeJsonV1(packed).length).toBeLessThan(canonicalNarrativeJsonV1(original).length)
    expect(packNarrativeJsonV1(unpackNarrativeJsonV1(packed))).toEqual(packed)
  })

  it('保留空键、__proto__、数组顺序和补充平面 Unicode；不更改对象原型', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"":[],"𐀀":["é","é",null,false,1e-7,-3]}')
    const decoded = unpackNarrativeJsonV1(packNarrativeJsonV1(value)) as Record<string, unknown>
    expect(canonicalNarrativeJsonV1(decoded)).toBe(canonicalNarrativeJsonV1(value))
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(Object.hasOwn({}, 'polluted')).toBe(false)
  })

  it.each(['extra', 'future', 'duplicate-string', 'unused-string', 'duplicate-shape', 'unused-shape',
    'missing-field', 'shape-outside', 'string-outside', 'shape-order', 'string-order', 'literal-string'])(
    '拒绝错误/非规范传输：%s', mutation => {
      const packed: any = packNarrativeJsonV1({ a: 'one', b: ['two', 'one'] })
      if (mutation === 'extra') packed.extra = true
      if (mutation === 'future') packed.version = 2
      if (mutation === 'duplicate-string') packed.strings.push(packed.strings[0])
      if (mutation === 'unused-string') packed.strings.push('unused')
      if (mutation === 'duplicate-shape') packed.shapes.push([...packed.shapes[0]])
      if (mutation === 'unused-shape') packed.shapes.push([])
      if (mutation === 'missing-field') packed.root.pop()
      if (mutation === 'shape-outside') packed.root[0] = 999
      if (mutation === 'string-outside') packed.root[1][1] = 999
      if (mutation === 'shape-order') packed.shapes[0].reverse()
      if (mutation === 'string-order') [packed.strings[2], packed.strings[3]] = [packed.strings[3], packed.strings[2]]
      if (mutation === 'literal-string') packed.root[1] = 'unencoded'
      // Reordering just string values can form another valid semantic packet;
      // the enclosing frozen content hash must reject that change instead.
      if (mutation === 'string-order') expect(unpackNarrativeJsonV1(packed)).not.toEqual({ a: 'one', b: ['two', 'one'] })
      else expect(() => unpackNarrativeJsonV1(packed)).toThrow()
    },
  )

  it('重复引用的展开预算在构造展开对象前核算，不能借小字典制造超限内容', () => {
    const packed: PackedNarrativeJsonV1 = { schema: 'storyforge.narrative-json-pack', version: 1,
      strings: ['桥'.repeat(1_000_000)], shapes: [], root: [1, ...Array.from({ length: 50 }, () => [0, 0] as [number, number])] }
    expect(() => unpackNarrativeJsonV1(packed)).toThrow('128 MiB')
    let root: PackedNarrativeJsonV1['root'] = null
    for (let i = 0; i < 130; i++) root = [1, root]
    expect(() => unpackNarrativeJsonV1({ ...packed, strings: [], root })).toThrow('深度')
  })

  it('标准压缩层逐字往返；同一实现重复生成相同传输，解压后仍须校验字典和内容', async () => {
    const packed = packNarrativeJsonV1({ manifest: golden.compiled.manifest, index: golden.compiled.index })
    const compressed = await compressNarrativePackV1(packed)
    expect(await compressNarrativePackV1(packed)).toEqual(compressed)
    expect(await decompressNarrativePackV1(compressed)).toEqual(packed)
    for (const changed of [{ ...compressed, extra: true }, { ...compressed, encoding: 'deflate' },
      { ...compressed, decodedBytes: compressed.decodedBytes - 1 }, { ...compressed, decodedBytes: compressed.decodedBytes + 1 },
      { ...compressed, decodedHash: '0'.repeat(64) }, { ...compressed, data: compressed.data.slice(0, -4) },
      { ...compressed, data: compressed.data + '\n' }, { ...compressed, decodedBytes: 64 * 1024 * 1024 + 1 }]) {
      await expect(decompressNarrativePackV1(changed)).rejects.toThrow()
    }
  })

  it('小压缩流不能绕过声明的展开限额', async () => {
    const compressed = await compressNarrativePackV1(packNarrativeJsonV1('桥'.repeat(100_000)))
    expect(compressed.data.length).toBeLessThan(2000)
    await expect(decompressNarrativePackV1({ ...compressed, decodedBytes: 100 })).rejects.toThrow('展开超过')
  })

  it('兼容另一 gzip 实现，但不接受重签的 BOM 或非规范 JSON 字节', async () => {
    const packed = packNarrativeJsonV1({ source: '桥' }), canonical = canonicalNarrativeJsonV1(packed)
    const compressed = await compressNarrativePackV1(packed)
    const wrap = (text: string) => { const bytes = Buffer.from(text); return { ...compressed,
      decodedBytes: bytes.length, decodedHash: createHash('sha256').update(bytes).digest('hex'), data: gzipSync(bytes).toString('base64') } }
    expect(await decompressNarrativePackV1(wrap(canonical))).toEqual(packed)
    await expect(decompressNarrativePackV1(wrap('\ufeff' + canonical))).rejects.toThrow()
    await expect(decompressNarrativePackV1(wrap(JSON.stringify(packed)))).rejects.toThrow('规范 JSON')
  })
})
