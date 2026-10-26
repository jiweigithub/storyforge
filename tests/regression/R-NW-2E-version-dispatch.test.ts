import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyWorldReleaseManifestV1 } from '../../src/lib/world-engine/release-codec'
import { canonicalNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-json'
import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'

afterEach(() => vi.restoreAllMocks())

describe('NW-2E · complete version verification without duplicate v4 parse', () => {
  it('avoids a full v4 parse during proof and still rebuilds the exact frozen index', async () => {
    const wire = golden.compiled.manifestJson, parse = vi.spyOn(JSON, 'parse')
    const verified = await verifyWorldReleaseManifestV1({ manifest: wire, expectedContentHash: golden.compiled.contentHash })
    expect(verified).toMatchObject({ version: 4, readiness: 'rebuilt', manifest: golden.compiled.manifest, index: golden.compiled.index })
    expect(parse.mock.calls.filter(([input]) => input === wire)).toHaveLength(0)
  })

  it('rejects damaged content, noncanonical wire and spoofed version headers', async () => {
    const original = structuredClone(golden.compiled.manifest)
    for (const input of [
      { ...original, schema: 'unknown' }, { ...original, version: 5 }, { ...original, version: 3 },
      { ...original, compilerVersion: 'future-compiler' }, { ...original, runtime: {} },
    ]) await expect(verifyWorldReleaseManifestV1({ manifest: canonicalNarrativeJsonV1(input) })).rejects.toThrow()
    await expect(verifyWorldReleaseManifestV1({ manifest: ` ${golden.compiled.manifestJson}` })).rejects.toThrow('release-noncanonical')
    await expect(verifyWorldReleaseManifestV1({ manifest: golden.compiled.manifestJson.slice(0, -1) })).rejects.toThrow('release-json')
    original.narrative.bundle.records[0].visibility.class = 'author-only'
    await expect(verifyWorldReleaseManifestV1({ manifest: canonicalNarrativeJsonV1(original) })).rejects.toThrow('release-projection')
    await expect(verifyWorldReleaseManifestV1({ manifest: golden.compiled.manifestJson, expectedContentHash: '0'.repeat(64) }))
      .rejects.toThrow('release-hash')
  })

  it('never normalizes invalid JSON values before checking an object v4 input', async () => {
    for (const value of [undefined, NaN, Infinity, -0]) {
      const original = structuredClone(golden.compiled.manifest)
      Object.assign(original.records.characters[0], { invalidExtra: value })
      await expect(verifyWorldReleaseManifestV1({ manifest: original })).rejects.toThrow('json')
    }
  })

  it('captures object input before await, bypasses hidden toJSON and rejects version accessors without invoking them', async () => {
    const original = structuredClone(golden.compiled.manifest)
    const hook = vi.fn(() => { throw Error('toJSON invoked') })
    Object.defineProperty(original, 'toJSON', { value: hook })
    const pending = verifyWorldReleaseManifestV1({ manifest: original, expectedContentHash: golden.compiled.contentHash })
    original.worldName = '调用后的改写'
    expect((await pending).manifest).toEqual(golden.compiled.manifest)
    expect(hook).not.toHaveBeenCalled()
    const accessor = structuredClone(golden.compiled.manifest), getter = vi.fn(() => 4)
    Object.defineProperty(accessor, 'version', { enumerable: true, get: getter })
    await expect(verifyWorldReleaseManifestV1({ manifest: accessor })).rejects.toThrow('accessor')
    expect(getter).not.toHaveBeenCalled()
  })
})
