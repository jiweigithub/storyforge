import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hashNarrativeValueV1, inspectCanonicalNarrativeObjectV1, matchesCanonicalNarrativeJsonV1, parseCanonicalNarrativeObjectV1 } from '../../src/lib/world-engine/narrative-json'

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const omit = ['semanticRootHash', 'indexDescriptor']

describe('NW-2E · 冻结字节核对与根摘要共享遍历', () => {
  it('私有解析仍拒绝非精确标量和非规范字节，返回后修改不获得编码信任', () => {
    const wire = '{"__proto__":{"x":1},"a":["桥𐀀",true,null],"semanticRootHash":"root"}'
    const parsed = parseCanonicalNarrativeObjectV1(wire, omit)
    expect({ matches: parsed.matches, projectionHash: parsed.projectionHash })
      .toEqual(inspectCanonicalNarrativeObjectV1(JSON.parse(wire), wire, omit))
    expect(Object.getPrototypeOf(parsed.value)).toBe(Object.prototype)
    expect(Object.hasOwn(parsed.value, '__proto__')).toBe(true)
    for (const invalid of ['{"a":-0}', '{"a":1e999}', '{"a":9007199254740992}', '{"a":"\\ud800"}',
      '{"semanticRootHash":"\\udc00"}', 'null', '[]', '{']) {
      expect(() => parseCanonicalNarrativeObjectV1(invalid, omit)).toThrow()
    }
    for (const noncanonical of ['{ "a":1}', '{"a":1,"a":1}', '{"b":2,"a":1}', '{"a":1.0}', '{"a":"\\u6865"}']) {
      expect(parseCanonicalNarrativeObjectV1(noncanonical, omit).matches).toBe(false)
    }
    let called = false
    Object.defineProperty(parsed.value, 'a', { enumerable: true, get() { called = true; return [] } })
    expect(() => inspectCanonicalNarrativeObjectV1(parsed.value, wire, omit)).toThrow()
    expect(called).toBe(false)
  })
  it('仅排除根字段，保留同名嵌套字段、数组顺序、数值键标量序及 Unicode 原字节', () => {
    const wire = '{"10":"十","2":"二","indexDescriptor":{"indexHash":"x"},"nested":{"indexDescriptor":1,"semanticRootHash":2},"semanticRootHash":"root","values":["🪶",3,true,null],"":"先","😀":"后"}'
    const content = '{"10":"十","2":"二","nested":{"indexDescriptor":1,"semanticRootHash":2},"values":["🪶",3,true,null],"":"先","😀":"后"}'
    expect(inspectCanonicalNarrativeObjectV1(JSON.parse(wire), wire, omit)).toEqual({ matches: true, projectionHash: digest(content) })
    expect(parseCanonicalNarrativeObjectV1(wire, omit)).toEqual({
      value: JSON.parse(wire), matches: true, projectionHash: digest(content),
    })
  })

  it.each([
    ['{}', '{}', []],
    ['{"indexDescriptor":{},"semanticRootHash":"x"}', '{}', omit],
    ['{"a":1,"indexDescriptor":{},"z":2}', '{"a":1,"z":2}', omit],
    ['{"__proto__":{"x":1},"semanticRootHash":"x"}', '{"__proto__":{"x":1}}', omit],
  ])('空根、全排除及特殊属性保持精确摘要：%s', (wire, content, omitted) => {
    expect(inspectCanonicalNarrativeObjectV1(JSON.parse(wire), wire, omitted as string[])).toEqual({ matches: true, projectionHash: digest(content as string) })
    expect(parseCanonicalNarrativeObjectV1(wire, omitted as string[])).toEqual({
      value: JSON.parse(wire), matches: true, projectionHash: digest(content as string),
    })
  })

  it('所有 C0 转义、引号、连续反斜线及多字节字符与原生 JSON 字节一致', () => {
    const text = [...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
      '"', '\\', '\\\\', '\\"', '\\\\"', '/', '桥', '𐀀', '🪶', '\ue000', '\u2028', '\u2029']
    const content = { a: text, nested: { indexDescriptor: [true, false, null], semanticRootHash: '保留' } }
    const value = { ...content, semanticRootHash: '排除' }, wire = JSON.stringify(value)
    expect(parseCanonicalNarrativeObjectV1(wire, omit)).toEqual({
      value, matches: true, projectionHash: digest(JSON.stringify(content)),
    })
    const entries = [...Array.from({ length: 32 }, (_, code) => [String.fromCharCode(code), code] as const),
      ['"', 32] as const, ['\\', 33] as const, ['a', 34] as const]
    const omitted = ['\0', '"'], keyed = Object.fromEntries(entries)
    expect(parseCanonicalNarrativeObjectV1(JSON.stringify(keyed), omitted)).toEqual({
      value: keyed, matches: true,
      projectionHash: digest(JSON.stringify(Object.fromEntries(entries.filter(([key]) => !omitted.includes(key))))),
    })
  })

  it('等义但非规范的转义仍返回不匹配，并保留解析值的规范摘要', () => {
    for (const wire of [
      '{"a":"\\u000A"}', '{"a":"\\u000B"}', '{"a":"\\u0008"}', '{"a":"\\u0022"}',
      '{"a":"\\u005c"}', '{"a":"\\u0061"}', '{"a":"\\/"}', '{"a":"\\ud83d\\ude00"}',
      '{"\\u0061":1}', '{"a":[{"z":"\\u0062"}]}',
    ]) {
      const value = JSON.parse(wire)
      expect(parseCanonicalNarrativeObjectV1(wire, [])).toEqual({
        value, matches: false, projectionHash: digest(JSON.stringify(value)),
      })
    }
  })

  it('重复键覆盖非法旧值时回退至保留值语义，不把重复字节视为规范输入', () => {
    for (const invalid of ['-0', '1e999', '9007199254740992', '"\\ud800"', '"' + '\ud800' + '"', '{"z":-0}']) {
      const wire = '{"a":' + invalid + ',"a":1}'
      expect(parseCanonicalNarrativeObjectV1(wire, [])).toEqual({
        value: { a: 1 }, matches: false, projectionHash: digest('{"a":1}'),
      })
      const nested = '{"outer":' + wire + '}'
      expect(parseCanonicalNarrativeObjectV1(nested, [])).toEqual({
        value: { outer: { a: 1 } }, matches: false, projectionHash: digest('{"outer":{"a":1}}'),
      })
      expect(() => parseCanonicalNarrativeObjectV1('{"a":1,"a":' + invalid + '}', [])).toThrow()
    }
    expect(parseCanonicalNarrativeObjectV1('{"\\u0061":-0,"a":1}', [])).toEqual({
      value: { a: 1 }, matches: false, projectionHash: digest('{"a":1}'),
    })
  })

  it('精确数值、指数形式和小数舍入保持原生解析后的既有规范判定', () => {
    const value = { a: [0, 1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 0.3, 1e-7, 1e-6, Number.MIN_VALUE] }
    const wire = JSON.stringify(value)
    expect(parseCanonicalNarrativeObjectV1(wire, [])).toEqual({ value, matches: true, projectionHash: digest(wire) })
    for (const number of ['1.0', '1e0', '1E-7', '1e-07', '1e-6', '1.2300', '0.10000000000000001', '1e-9999']) {
      const text = '{"a":' + number + '}', parsed = JSON.parse(text)
      expect(parseCanonicalNarrativeObjectV1(text, [])).toEqual({
        value: parsed, matches: false, projectionHash: digest(JSON.stringify(parsed)),
      })
    }
  })

  it('快速识别的根字段与深度预算不收窄合法输入，也不隐藏后面的非法值', () => {
    const entries = Array.from({ length: 300 }, (_, index) => ['k' + String(index).padStart(3, '0'), index])
    const wide = Object.fromEntries(entries), wire = JSON.stringify(wide)
    expect(parseCanonicalNarrativeObjectV1(wire, ['k123'])).toEqual({
      value: wide, matches: true,
      projectionHash: digest(JSON.stringify(Object.fromEntries(entries.filter(([key]) => key !== 'k123')))),
    })
    expect(() => parseCanonicalNarrativeObjectV1(wire.slice(0, -1) + ',"z":-0}', [])).toThrow()
    const deep = '{"a":' + '['.repeat(300) + '1' + ']'.repeat(300) + '}'
    expect(parseCanonicalNarrativeObjectV1(deep, [])).toEqual({
      value: JSON.parse(deep), matches: true, projectionHash: digest(deep),
    })
    expect(() => parseCanonicalNarrativeObjectV1(deep.replace('1', '-0'), [])).toThrow()
  })

  it('非规范空白、键顺序和重复键保持完整回退摘要，非法排除键仍拒绝', () => {
    for (const wire of [' { "a": 1 } ', '{\n"a":1\n}', '{"b":2,"a":1}', '{"a":1,"a":2}',
      '{"a":{"b":2,"a":1},"semanticRootHash":{"x":1}}']) {
      const value = JSON.parse(wire)
      expect(parseCanonicalNarrativeObjectV1(wire, omit)).toEqual({
        value, ...inspectCanonicalNarrativeObjectV1(value, wire, omit),
      })
      expect(parseCanonicalNarrativeObjectV1(wire, omit).matches).toBe(false)
    }
    for (const omitted of [[7], ['\ud800']]) {
      expect(() => parseCanonicalNarrativeObjectV1('{}', omitted as unknown as string[])).toThrow()
    }
  })

  it('删除字段仍参加原字节核对，错误顺序、空白、转义、重复键及截断不会成为验证成功', () => {
    const value = { a: '甲', semanticRootHash: 'root' }
    for (const wire of [
      '{"a":"甲","semanticRootHash":"wrong"}', '{"semanticRootHash":"root","a":"甲"}',
      '{ "a":"甲","semanticRootHash":"root"}', '{"a":"\\u7532","semanticRootHash":"root"}',
      '{"a":"甲","a":"甲","semanticRootHash":"root"}', '{"a":"甲","semanticRootHash":"root"',
      '{"a":"甲","semanticRootHash":"root"}\n',
    ]) expect(inspectCanonicalNarrativeObjectV1(value, wire, omit).matches).toBe(false)
  })

  it('不因字节已不匹配或根字段被排除而跳过非法值、accessor、循环或 symbol', () => {
    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get() { getterCalls++; return 1 } })
    const cycle: { self?: unknown } = {}; cycle.self = cycle
    const symbol = { [Symbol('hidden')]: 1 }
    const sparse = Array<number>(2); sparse[1] = 1
    for (const invalid of [undefined, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1, '\ud800', accessor, cycle, symbol, sparse]) {
      expect(() => inspectCanonicalNarrativeObjectV1({ a: 1, semanticRootHash: invalid }, 'mismatch', omit)).toThrow()
    }
    expect(getterCalls).toBe(0)
  })

  it('超出分段长度的原文保留完整 surrogate 和转义边界，且不改写输入', () => {
    const text = 'x'.repeat(32_765) + '🪶\\"\n' + '汉'.repeat(32_768)
    const value = { original: text, semanticRootHash: 'root' }
    const wire = JSON.stringify(value), before = structuredClone(value)
    expect(inspectCanonicalNarrativeObjectV1(value, wire, omit)).toEqual({ matches: true, projectionHash: digest(JSON.stringify({ original: text })) })
    expect(parseCanonicalNarrativeObjectV1(wire, omit)).toEqual({
      value, matches: true, projectionHash: digest(JSON.stringify({ original: text })),
    })
    expect(value).toEqual(before)
  })

  it('调用之间不复用可变对象或旧原字节的摘要', () => {
    const value = { a: 1, semanticRootHash: 'root' }, wire = JSON.stringify(value)
    const first = inspectCanonicalNarrativeObjectV1(value, wire, omit)
    value.a = 2
    expect(inspectCanonicalNarrativeObjectV1(value, wire, omit)).toEqual({ matches: false, projectionHash: digest('{"a":2}') })
    expect(first).toEqual({ matches: true, projectionHash: digest('{"a":1}') })
  })

  it.runIf(process.env.NW_ROOT_DIGEST_DIAGNOSTIC === '1')('单独测量两步核对与合并核对，结果不能代替浏览器冷开或内存验收', async () => {
    const output = process.env.NW_ROOT_DIGEST_REPORT
    if (!output) throw Error('A new NW_ROOT_DIGEST_REPORT destination is required')
    const { buildNarrativeScaleInputV1 } = await import('../helpers/narrative-scale-fixture')
    const { compileWorldReleaseContentV4 } = await import('../../src/lib/world-engine/narrative-release-v4')
    const fixture = await buildNarrativeScaleInputV1(100_000)
    const compiled = await compileWorldReleaseContentV4(fixture.input)
    const parsed = JSON.parse(compiled.manifestJson)
    const samples: Array<{ pair: number; method: string; elapsedMs: number; matches: boolean; projectionHash: string }> = []
    try {
      for (let pair = 0; pair < 8; pair++) {
        for (const method of pair % 2 ? ['combined', 'separate'] : ['separate', 'combined']) {
          const start = performance.now()
          let result: { matches: boolean; projectionHash: string }
          if (method === 'combined') result = inspectCanonicalNarrativeObjectV1(parsed, compiled.manifestJson, omit)
          else {
            const matches = matchesCanonicalNarrativeJsonV1(parsed, compiled.manifestJson)
            const { semanticRootHash: _root, indexDescriptor: _index, ...content } = parsed
            result = { matches, projectionHash: await hashNarrativeValueV1(content) }
          }
          samples.push({ pair, method, elapsedMs: performance.now() - start, ...result })
          expect(result).toEqual({ matches: true, projectionHash: compiled.manifest.semanticRootHash })
        }
      }
    } finally {
      const paths = ['src/lib/narrative-domain/json.ts', 'src/lib/world-engine/narrative-release-v4.ts',
        'tests/helpers/narrative-scale-fixture.ts', 'tests/regression/R-NW-2E-canonical-root.test.ts']
      writeFileSync(output, JSON.stringify({ schema: 'storyforge.narrative-root-digest-diagnostic', version: 1,
        createdAt: new Date().toISOString(), evidenceLevel: 'local Node stage diagnostic; not browser or performance acceptance',
        node: process.version, compilerVersion: compiled.manifest.compilerVersion, stats: fixture.stats,
        contentHash: compiled.contentHash, semanticRootHash: compiled.manifest.semanticRootHash, indexHash: compiled.index.indexHash,
        wireCharacters: compiled.manifestJson.length, samples,
        sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
        includesParsing: false, includesProjectionOrIndexCompilation: false, memoryMeasured: false,
        modelCalls: 0, independentHumanReviews: 0, accepted: false }, null, 2) + '\n', { flag: 'wx' })
    }
  }, 60_000)
})
