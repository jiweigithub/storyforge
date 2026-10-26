import { describe, expect, it } from 'vitest'
import { verifyWorldReleaseManifestV1, verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import v3 from '../acceptance/narrative-world/worldrelease-v3-golden.json'
import v4 from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'

describe('NW-2A · 明确版本分派，不改写历史字节', () => {
  it('相同入口按各自历史合同验证 v3/v4 golden，并离线重建 v4 索引', async () => {
    const old = await verifyWorldReleaseManifestV1({ manifest: v3.manifestJson, expectedContentHash: v3.contentHash })
    expect(old.version).toBe(3)
    expect(old.readiness).toBe('legacy')
    expect(old.manifest).toEqual(JSON.parse(v3.manifestJson))
    const current = await verifyWorldReleaseManifestV1({ manifest: v4.compiled.manifestJson, expectedContentHash: v4.compiled.contentHash })
    expect(current.version).toBe(4)
    expect(current.readiness).toBe('rebuilt')
    expect(current.index).toEqual(v4.compiled.index)
  })

  it('未知版本、外层身份/hash 错配和向旧包附加索引均拒绝', async () => {
    await expect(verifyWorldReleaseManifestV1({ manifest: { ...v4.compiled.manifest, version: 5 } })).rejects.toThrow('version')
    await expect(verifyWorldReleaseManifestV1({ manifest: v3.manifestJson, index: v4.compiled.index })).rejects.toThrow('legacy-index')
    for (const source of [{ manifestJson: v3.manifestJson, contentHash: v3.contentHash }, v4.compiled]) {
      await expect(verifyWorldReleaseManifestV1({ manifest: source.manifestJson, expectedContentHash: '0'.repeat(64) })).rejects.toThrow()
      await expect(verifyWorldReleaseRecordV1({ id: 1, releaseUid: 'fixture', projectId: 1, worldId: 1, revisionId: 1,
        version: 1, label: 'fixture', sourceWorldCode: 'wrong-world', createdAt: 0, ...source })).rejects.toThrow()
    }
  })

  it('异步校验前隔离外部对象；不得在等待 hash 时替换原文', async () => {
    const source = structuredClone(v4.compiled.manifest)
    const pending = verifyWorldReleaseManifestV1({ manifest: source, expectedContentHash: v4.compiled.contentHash })
    source.worldName = '并发替换'
    expect((await pending).manifest.worldName).toBe(v4.compiled.manifest.worldName)
  })
})
