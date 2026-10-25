import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'

const expected = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex')
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('NW-2E · interchangeable bounded SHA-256 implementations', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('starts with JavaScript and initializes only on explicit release request', async () => {
    const backend = await import('../../src/lib/narrative-domain/sha256')
    const codec = await import('../../src/lib/narrative-domain/json')
    expect(backend.narrativeSha256StatusV1()).toEqual({ backend: 'javascript', initialization: 'not-requested' })
    expect(await codec.hashNarrativeBytesV1('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(backend.narrativeSha256StatusV1().initialization).toBe('not-requested')
    expect(await Promise.all([backend.initializeNarrativeSha256V1(), backend.initializeNarrativeSha256V1()]))
      .toEqual(['wasm', 'wasm'])
    expect(backend.narrativeSha256StatusV1()).toEqual({ backend: 'wasm', initialization: 'ready' })
    for (const input of ['', 'abc', 'a'.repeat(1_000_000), '桥😀𠮷\r\n'.repeat(20_000)]) {
      expect(await codec.hashNarrativeBytesV1(input)).toBe(expected(input))
    }
  })

  it('preserves canonical wire, root projections, omission validation and synchronous capture', async () => {
    const backend = await import('../../src/lib/narrative-domain/sha256')
    const codec = await import('../../src/lib/narrative-domain/json')
    await backend.initializeNarrativeSha256V1()
    const value = { a: ['桥', '😀', 'x'.repeat(40_000)], b: { a: 1e-7, b: true }, z: '原文' }
    const json = JSON.stringify(value)
    expect(codec.canonicalNarrativeJsonWithHashV1(value)).toEqual({ json, hash: expected(json) })
    expect(codec.parseCanonicalNarrativeObjectV1(json, ['z'])).toMatchObject({ matches: true,
      projectionHash: expected(JSON.stringify({ a: value.a, b: value.b })) })
    const pending = codec.hashNarrativeValueV1(value)
    value.z = '调用后改写'
    expect(await pending).toBe(expected(json))
    const bytes = new TextEncoder().encode('原始字节'), pendingBytes = codec.hashNarrativeBytesV1(bytes)
    bytes.fill(0)
    expect(await pendingBytes).toBe(expected('原始字节'))
    expect(() => codec.hashNarrativeValueWithoutKeysV1({ hidden: undefined }, ['hidden'])).toThrow('json')
    await expect(codec.hashNarrativeBytesV1('\ud800')).rejects.toThrow('unicode')
    expect(await codec.hashNarrativeBytesV1('after-error')).toBe(expected('after-error'))
  })

  it('keeps interleaved and nested sinks independent beyond the pool size; old handles stay closed', async () => {
    const backend = await import('../../src/lib/narrative-domain/sha256')
    await backend.initializeNarrativeSha256V1()
    const sinks = Array.from({ length: 9 }, () => backend.createNarrativeSha256V1())
    for (let step = 0; step < 6; step++) for (const [index, sink] of sinks.entries()) {
      sink.update(new TextEncoder().encode(`state${index}:step${step}:桥😀;`))
    }
    for (const [index, sink] of sinks.entries()) {
      expect(hex(sink.digest())).toBe(expected(Array.from({ length: 6 }, (_, step) => `state${index}:step${step}:桥😀;`).join('')))
      expect(() => sink.update(new Uint8Array([1]))).toThrow('finished')
      sink.destroy(); sink.destroy()
    }
    const abandoned = backend.createNarrativeSha256V1()
    abandoned.update(new Uint8Array([1, 2, 3])); abandoned.destroy()
    const clean = backend.createNarrativeSha256V1()
    expect(() => abandoned.update(new Uint8Array([4]))).toThrow('released')
    expect(hex(clean.digest())).toBe(expected(''))
    clean.destroy()
  })

  it('explicitly falls back when WebAssembly is unavailable and keeps canonical digests', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    const backend = await import('../../src/lib/narrative-domain/sha256')
    const codec = await import('../../src/lib/narrative-domain/json')
    expect(await backend.initializeNarrativeSha256V1()).toBe('javascript')
    expect(backend.narrativeSha256StatusV1()).toEqual({ backend: 'javascript', initialization: 'unavailable' })
    vi.unstubAllGlobals()
    // Unavailability is remembered, not retried for each record after a failure.
    expect(await backend.initializeNarrativeSha256V1()).toBe('javascript')
    const value = { a: '桥😀'.repeat(40_000), b: [0, true, null] }, json = JSON.stringify(value)
    expect(codec.canonicalNarrativeJsonWithHashV1(value)).toEqual({ json, hash: expected(json) })
    const { compileWorldReleaseContentV4 } = await import('../../src/lib/world-engine/narrative-release-v4')
    const { semanticRootHash: _root, indexDescriptor: _index, narrative: _projection, ...content } = golden.compiled.manifest
    expect(await compileWorldReleaseContentV4(content as Parameters<typeof compileWorldReleaseContentV4>[0])).toEqual(golden.compiled)
  })
})
