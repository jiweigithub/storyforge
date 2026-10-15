import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextAdventureCommunityPackageFixtureV1 } from '../helpers/text-adventure-community-package'
import * as communityPackage from '../../src/lib/adventure/community-package'
import { createAdventureWebZipV1, readAdventureWebFileV1, readAdventureWebPackageV1, type AdventureWebPackageV1 } from '../../src/lib/adventure/web-package'
import { adventureWebPlayerStorageName, isAdventureWebPlayerAssetRequest } from '../../src/lib/adventure/web-player-policy'
import { installAdventureWebPackageV1 } from '../../src/lib/adventure/web-player-install'
import { isWorkspaceUid } from '../../src/lib/memory/identity'
import { createTextAdventureInstance } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/adventure/runtime-api'

async function template() {
  const zip = new JSZip()
  zip.file('index.html', '<meta name="storyforge-game" content="STORYFORGE_GAME_HASH"><script src="./assets/player.js"></script>')
  zip.file('assets/player.js', '/* local player */')
  zip.file('assets/theme.webp', new Uint8Array([1, 2, 3]))
  zip.file('LICENSE.runtime.txt', 'MIT License')
  zip.file('THIRD-PARTY-NOTICES.txt', 'Third party notices')
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('standalone adventure web package', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('round trips the verified package and installs once without author WorldRelease or production history', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    const result = await createAdventureWebZipV1({ candidate, template: await template() })
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    expect(await zip.file('index.html')!.async('string')).toContain(candidate.candidatePackageHash)
    expect(await zip.file('LICENSE.runtime.txt')!.async('string')).toBe('MIT License')
    const envelope = JSON.parse(await zip.file('game.json')!.async('string'))
    const restored = await readAdventureWebPackageV1(envelope, candidate.candidatePackageHash, async path => zip.file(path)!.async('uint8array'))
    expect(restored).toEqual(candidate)
    const first = await installAdventureWebPackageV1(restored)
    expect(isWorkspaceUid(first.project.workspaceUid)).toBe(true)
    const session = await createTextAdventureInstance({ scope: first.scope, productReleaseId: first.release.id!, title: '独立游戏测试' })
    expect((await readProductRuntimeState(session.id!)).adventure?.currentLocationKey).toBeTruthy()
    const second = await installAdventureWebPackageV1(restored)
    expect(second.scope).toEqual(first.scope)
    expect(second.release.id).toBe(first.release.id)
    expect(await db.productRuntimeSessions.count()).toBe(1)
    expect(await db.worldReleases.count()).toBe(0)
    expect(await db.productBuilds.count()).toBe(0)
    expect(await db.agentRuns.count()).toBe(0)
  }, 30_000)

  it('fails before writes on tampered evidence, package identity, or unsafe media paths', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    const envelope: AdventureWebPackageV1 = { schema: 'storyforge.adventure-web-package', version: 1, candidate, media: [] }
    const read = vi.fn()
    await expect(readAdventureWebPackageV1(envelope, 'a'.repeat(64), read)).rejects.toThrow('身份')
    const tampered = structuredClone(envelope)
    tampered.candidate.evidence.gateReceipts[0].status = 'failed'
    await expect(readAdventureWebPackageV1(tampered, candidate.candidatePackageHash, read)).rejects.toThrow()
    envelope.candidate.distributionBundle.media.push({ asset: { assetKey: 'image', byteSize: 4, blobContentHash: 'a'.repeat(64) } as never, dataBase64: '' })
    envelope.media.push({ assetKey: 'image', byteSize: 4, paths: ['https://outside.test/private'] })
    await expect(readAdventureWebPackageV1(envelope, candidate.candidatePackageHash, read)).rejects.toThrow('路径')
    expect(read).not.toHaveBeenCalled()
    expect(await db.projects.count()).toBe(0)
  })

  it('isolates game versions and only permits relative static reads under the deployment directory', () => {
    const page = 'https://games.example/games/one/index.html'
    expect(adventureWebPlayerStorageName('a'.repeat(64))).not.toBe(adventureWebPlayerStorageName('b'.repeat(64)))
    expect(() => adventureWebPlayerStorageName('../author-db')).toThrow()
    for (const path of ['./game.json', './assets/player-1.js', `./media/${'a'.repeat(64)}-0.bin`]) {
      expect(isAdventureWebPlayerAssetRequest(path, 'GET', page)).toBe(true)
    }
    for (const path of ['../game.json', 'https://other.test/game.json', '/v1/chat/completions', './media/../../game.json']) {
      expect(isAdventureWebPlayerAssetRequest(path, 'GET', page)).toBe(false)
    }
    expect(isAdventureWebPlayerAssetRequest('./game.json', 'POST', page)).toBe(false)
  })

  it('preserves every binary byte across chunk boundaries and rejects missing chunks before verification', async () => {
    const candidate = await createTextAdventureCommunityPackageFixtureV1()
    const bytes = Uint8Array.from({ length: 8 * 1024 * 1024 + 257 }, (_, index) => index % 256)
    const originalBase64 = Buffer.from(bytes).toString('base64')
    candidate.distributionBundle.media.push({
      asset: { assetKey: 'codec-only-image', byteSize: bytes.length, blobContentHash: 'c'.repeat(64) } as never,
      dataBase64: originalBase64,
    })
    // Codec-only input: the unmocked test above covers the formal evidence gate.
    // This deliberately synthetic image must never represent accepted game media.
    const verify = vi.spyOn(communityPackage, 'verifyTextAdventureCommunityPackageV1')
      .mockImplementation(async value => value as communityPackage.TextAdventureCommunityPackageV1)
    const result = await createAdventureWebZipV1({ candidate, template: await template() })
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const envelope = JSON.parse(await zip.file('game.json')!.async('string')) as AdventureWebPackageV1
    expect(envelope.candidate.distributionBundle.media[0].dataBase64).toBe('')
    expect(envelope.media[0].paths).toHaveLength(2)
    expect((await zip.file(envelope.media[0].paths[0])!.async('uint8array')).length).toBe(8 * 1024 * 1024)
    expect((await zip.file(envelope.media[0].paths[1])!.async('uint8array')).length).toBe(257)
    const restored = await readAdventureWebPackageV1(envelope, candidate.candidatePackageHash, async path => zip.file(path)!.async('uint8array'))
    expect(restored.distributionBundle.media[0].dataBase64).toBe(originalBase64)
    expect(verify).toHaveBeenLastCalledWith(restored)
    verify.mockClear()
    await expect(readAdventureWebPackageV1(envelope, candidate.candidatePackageHash, async path => {
      const chunk = await zip.file(path)!.async('uint8array')
      return chunk.subarray(1)
    })).rejects.toThrow('大小不一致')
    expect(verify).not.toHaveBeenCalled()
    expect(await db.projects.count()).toBe(0)
  })

  it('cancels oversized streamed files without trusting a claimed content length', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([0, 1, 2, 3])) },
      cancel,
    })
    const fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-length': '1' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(readAdventureWebFileV1('game.json', 3)).rejects.toThrow('超出大小上限')
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), { credentials: 'omit', redirect: 'error' })
  })
})
