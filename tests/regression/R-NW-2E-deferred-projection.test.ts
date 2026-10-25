import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalNarrativeJsonV1, hashNarrativeValueV1, inspectCanonicalNarrativeObjectV1,
  parseCanonicalNarrativeObjectV1, splitCanonicalNarrativeObjectV1 } from '../../src/lib/world-engine/narrative-json'
import { captureFrozenNarrativeSourcesV4, compileWorldReleaseContentV4, verifyWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import type { WorldReleaseManifestV4 } from '../../src/lib/types/narrative-release'
import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'

const omit = ['semanticRootHash', 'indexDescriptor']
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
afterEach(() => vi.restoreAllMocks())

function compareNativeGrammar(wire: string, deferredKey = 'narrative') {
  let native: Record<string, unknown> | undefined
  let proof: ReturnType<typeof inspectCanonicalNarrativeObjectV1> | undefined
  try {
    native = JSON.parse(wire)
    proof = inspectCanonicalNarrativeObjectV1(native, wire, omit)
  } catch { /* Native syntax or the unchanged strict scalar contract rejects. */ }
  const split = splitCanonicalNarrativeObjectV1(wire, deferredKey, omit)
  if (!proof?.matches || !native || !Object.hasOwn(native, deferredKey)) {
    expect(split, wire).toBeNull()
    return
  }
  expect(split, wire).not.toBeNull()
  expect(split!.projectionHash, wire).toBe(proof.projectionHash)
  expect(split!.deferredJson, wire).toBe(canonicalNarrativeJsonV1(native[deferredKey]))
  expect(Object.hasOwn(split!.value, deferredKey), wire).toBe(false)
  Object.defineProperty(split!.value, deferredKey, { value: JSON.parse(split!.deferredJson), enumerable: true })
  expect(split!.value, wire).toEqual(native)
}

describe('NW-2E · complete wire grammar and delayed projection decoding', () => {
  it('retains every scalar, ordered array and escaped key while hashing only the specified root projection', () => {
    const controls = Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join('')
    const values = [null, true, false, 0, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
      0.3, 1e-7, Number.MIN_VALUE, controls, '桥𐀀🪶\u2028\u2029', '\\"\\\\"/', [], {},
      { indexDescriptor: 1, semanticRootHash: 2 }, [null, { '\u0000': 'x', '"': '\\', '\\': 'y' }]]
    for (const value of values) {
      const original = JSON.parse('{"10":1,"2":2,"__proto__":{"retained":true}}')
      Object.assign(original, { indexDescriptor: { indexHash: 'x' }, narrative: value,
        original: { nested: { indexDescriptor: 'keep', semanticRootHash: 'keep' } }, semanticRootHash: 'root' })
      const wire = canonicalNarrativeJsonV1(original)
      compareNativeGrammar(wire)
      compareNativeGrammar(wire, '__proto__')
    }
  })

  it('rejects every malformed literal, separator, raw control, surrogate and noncanonical number as a speculative miss', () => {
    const tokens = ['truE', 'trux', 'noll', 'nul', 'falsy', 'falsee', 'NaN', 'Infinity', '+1', '01', '1.', '.1',
      '--1', '1e', '1e+', '-0', '1e999', '9007199254740992', '1.0', '1e0', '1E-7', '1e-07', '1e-6',
      '0.10000000000000001', '1e-9999', '[,1]', '[1,]', '[1 2]', '{"a":1,}', '{"a" 1}', '{a:1}',
      '"\\ud800"', '"\\udc00"', '"\\u6865"', '"\\/"', '"\\x00"', '"\\u000A"', '"\\u0008"',
      '"' + '\ud800' + '"', '"' + '\udc00' + '"']
    for (const token of tokens) compareNativeGrammar('{"narrative":' + token + '}')
    for (let code = 0; code < 32; code++) compareNativeGrammar('{"narrative":"x' + String.fromCharCode(code) + 'y"}')
    for (const token of tokens) compareNativeGrammar('{"narrative":[],"semanticRootHash":' + token + '}')
  })

  it('agrees with native parsing and the existing strict inspector under bounded byte mutations', () => {
    const wires = ['{"narrative":[true,false,null,1,-2,0.3,"x\\n\\"🪶"],"z":{"a":1}}',
      '{"__proto__":{},"narrative":{"a":[0],"b":"\\u0000"},"semanticRootHash":"r"}']
    for (const wire of wires) {
      compareNativeGrammar(wire)
      for (let at = 0; at < wire.length; at++) {
        compareNativeGrammar(wire.slice(0, at) + wire.slice(at + 1))
        for (const unit of ['x', '"', ',', ':', '\\']) compareNativeGrammar(wire.slice(0, at) + unit + wire.slice(at + 1))
      }
      for (let end = 0; end < wire.length; end++) compareNativeGrammar(wire.slice(0, end))
      for (const suffix of [' ', '\n', '{}', 'x']) compareNativeGrammar(wire + suffix)
    }
  })

  it('keeps overwritten invalid values and depth/width limits on the unchanged fallback path', () => {
    for (const invalid of ['-0', '1e999', '9007199254740992', '"\\ud800"', '{"a":-0}']) {
      const wire = '{"narrative":' + invalid + ',"narrative":1}'
      expect(splitCanonicalNarrativeObjectV1(wire, 'narrative', [])).toBeNull()
      expect(parseCanonicalNarrativeObjectV1(wire, [])).toEqual({
        value: { narrative: 1 }, matches: false, projectionHash: digest('{"narrative":1}'),
      })
    }
    const deep = '{"narrative":' + '['.repeat(300) + '1' + ']'.repeat(300) + '}'
    const wide = canonicalNarrativeJsonV1({ ...Object.fromEntries(Array.from({ length: 300 }, (_, at) => ['k' + at, at])), narrative: [] })
    for (const wire of [deep, wide]) {
      expect(splitCanonicalNarrativeObjectV1(wire, 'narrative', [])).toBeNull()
      expect(parseCanonicalNarrativeObjectV1(wire, [])).toEqual({ value: JSON.parse(wire), matches: true, projectionHash: digest(wire) })
    }
  })

  it('does not decode the deferred field or grant JSON-shape authority to returned mutable originals', () => {
    const deferred = '{"a":["秘密",true]}'
    const wire = '{"narrative":' + deferred + ',"original":{"x":1}}'
    const parse = vi.spyOn(JSON, 'parse')
    const split = splitCanonicalNarrativeObjectV1(wire, 'narrative', [])!
    expect(parse.mock.calls.some(([input]) => input === wire || input === deferred)).toBe(false)
    expect(split.deferredJson).toBe(deferred)
    let calls = 0
    Object.defineProperty(split.value.original, 'x', { enumerable: true, get() { calls++; return 1 } })
    expect(() => canonicalNarrativeJsonV1(split.value)).toThrow('accessor')
    expect(calls).toBe(0)
    expect(() => splitCanonicalNarrativeObjectV1(wire, '\ud800', [])).toThrow('unicode')
    expect(() => splitCanonicalNarrativeObjectV1(wire, 'narrative', [3] as unknown as string[])).toThrow('json-key')
  })

  it('preserves complete golden content/index/hash and the existing mutable detached return contract', async () => {
    const result = await verifyWorldReleaseContentV4({ manifest: golden.compiled.manifestJson,
      expectedContentHash: golden.compiled.contentHash, index: structuredClone(golden.compiled.index) })
    expect(result.manifest).toEqual(golden.compiled.manifest)
    expect(result.index).toEqual(golden.compiled.index)
    expect(Object.isFrozen(result.manifest.narrative.bundle)).toBe(false)
    result.manifest.narrative.sources[0].text = 'caller-private mutation'
    const again = await verifyWorldReleaseContentV4({ manifest: golden.compiled.manifestJson,
      expectedContentHash: golden.compiled.contentHash })
    expect(again.manifest).toEqual(golden.compiled.manifest)
    expect(again.index).toEqual(golden.compiled.index)
  })

  it.each([
    ['wire', 'complete'], ['object', 'complete'],
    ['wire', 'source-only'], ['object', 'source-only'],
  ] as const)('keeps all nested originals and IR mutable and detached for %s / %s reads', async (representation, mode) => {
    const input = structuredClone(golden.compiled.manifest)
    if (mode === 'source-only') input.indexDescriptor.recipeVersion = 'future-test-recipe'
    const wire = canonicalNarrativeJsonV1(input)
    const verified = await verifyWorldReleaseContentV4({
      manifest: representation === 'wire' ? wire : input,
      expectedContentHash: digest(wire), mode,
    })
    expect(verified.manifest).toEqual(input)
    expect(verified.readiness).toBe(mode === 'source-only' ? 'unavailable' : 'rebuilt')
    const mutable = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      expect(Object.isFrozen(value)).toBe(false)
      Object.values(value).forEach(mutable)
    }
    mutable(input); mutable(verified.manifest)
    const row = verified.manifest.records.characters[0]
    const visibility = row._narrativeVisibilityV1Portable as { audienceKeys: string[]; policyVersion: string }
    visibility.audienceKeys.push('caller-only')
    visibility.policyVersion = 'caller mutation'
    verified.manifest.semanticSnapshot.worlds[0].name = 'caller world'
    verified.manifest.narrative.sources[0].text = 'caller source'
    expect(canonicalNarrativeJsonV1(input)).toBe(wire)
    const again = await verifyWorldReleaseContentV4({ manifest: wire, expectedContentHash: digest(wire), mode })
    expect(again.manifest).toEqual(input)
    // Public copies cannot inherit a shape receipt, even if all keys match.
    let invoked = 0
    Object.defineProperty(visibility, 'policyVersion', { enumerable: true, get() { invoked++; return 'hidden' } })
    await expect(verifyWorldReleaseContentV4({ manifest: verified.manifest, mode })).rejects.toThrow('accessor')
    expect(invoked).toBe(0)
  })

  it('freezes only private compilation inputs and keeps the public capture utility mutable', async () => {
    const { narrative: _narrative, semanticRootHash: _root, indexDescriptor: _descriptor, ...input } =
      structuredClone(golden.compiled.manifest) as WorldReleaseManifestV4
    const before = canonicalNarrativeJsonV1(input)
    const capture = captureFrozenNarrativeSourcesV4(input)
    const rows = capture.rows.get('characters')!
    expect(Object.isFrozen(rows)).toBe(false)
    expect(Object.isFrozen(rows[0])).toBe(false)
    expect(Object.isFrozen(rows[0].narrativeVisibilityV1)).toBe(false)
    const pending = compileWorldReleaseContentV4(input)
    const visibility = input.records.characters[0]._narrativeVisibilityV1Portable as { audienceKeys: string[] }
    visibility.audienceKeys.push('changed after capture')
    const compiled = await pending
    expect(compiled).toEqual(golden.compiled)
    expect(Object.isFrozen(input.records.characters[0]._narrativeVisibilityV1Portable)).toBe(false)
    expect(canonicalNarrativeJsonV1(input)).not.toBe(before)
  })

  it('rejects forged projection bytes even when an attacker recomputes both content and semantic hashes', async () => {
    for (const change of [
      (manifest: typeof golden.compiled.manifest) => { manifest.narrative.bundle.records[0].visibility.class = 'author-only' },
      (manifest: typeof golden.compiled.manifest) => { manifest.narrative.coverage.projectedAtoms++ },
      (manifest: typeof golden.compiled.manifest) => { manifest.narrative.sources[0].text += 'changed' },
      (manifest: typeof golden.compiled.manifest) => { Object.assign(manifest.narrative, { hiddenExtra: true }) },
    ]) {
      const forged = structuredClone(golden.compiled.manifest)
      change(forged)
      const { semanticRootHash: _root, indexDescriptor: _descriptor, ...content } = forged
      forged.semanticRootHash = await hashNarrativeValueV1(content)
      forged.indexDescriptor.inputRootHash = forged.semanticRootHash
      await expect(verifyWorldReleaseContentV4({ manifest: canonicalNarrativeJsonV1(forged),
        expectedContentHash: await hashNarrativeValueV1(forged) })).rejects.toThrow('release-projection')
    }
  })
})
