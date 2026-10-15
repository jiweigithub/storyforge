import JSZip from 'jszip'
import { verifyTextAdventureCommunityPackageV1, type TextAdventureCommunityPackageV1 } from './community-package'

export const MAXIMUM_ADVENTURE_WEB_METADATA_BYTES_V1 = 24 * 1024 * 1024

const CHUNK_BYTES = 8 * 1024 * 1024
const MAXIMUM_BYTES = 350 * 1024 * 1024
const FILE_PATH = /^media\/[a-f0-9]{64}-\d+\.bin$/

export interface AdventureWebPackageV1 {
  schema: 'storyforge.adventure-web-package'
  version: 1
  /** Original verified envelope; only base64 media moves to binary files. */
  candidate: TextAdventureCommunityPackageV1
  media: Array<{ assetKey: string; byteSize: number; paths: string[] }>
}

function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  }
  return btoa(chunks.join(''))
}

/** Verify the original candidate again after every byte has been reassembled. */
export async function readAdventureWebPackageV1(
  value: unknown,
  expectedHash: string,
  read: (path: string, maximumBytes: number) => Promise<Uint8Array>,
): Promise<TextAdventureCommunityPackageV1> {
  const envelope = value as AdventureWebPackageV1
  if (!envelope || envelope.schema !== 'storyforge.adventure-web-package' || envelope.version !== 1
    || !Array.isArray(envelope.media) || !envelope.candidate?.distributionBundle?.media
    || envelope.candidate.candidatePackageHash !== expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('网页游戏包身份或格式无效。')
  }
  const candidate = structuredClone(envelope.candidate)
  const assets = candidate.distributionBundle.media
  if (assets.length !== envelope.media.length || assets.length > 1000) throw new Error('游戏媒资清单不闭合。')
  let total = 0
  for (let index = 0; index < assets.length; index++) {
    const { asset, dataBase64 } = assets[index]
    const entry = envelope.media[index]
    if (!entry || entry.assetKey !== asset.assetKey || entry.byteSize !== asset.byteSize || dataBase64 !== ''
      || !Number.isSafeInteger(entry.byteSize) || entry.byteSize <= 0
      || !Array.isArray(entry.paths) || entry.paths.length !== Math.ceil(entry.byteSize / CHUNK_BYTES)
      || (total += entry.byteSize) > MAXIMUM_BYTES) throw new Error('游戏媒资大小或绑定无效。')
    const bytes = new Uint8Array(entry.byteSize)
    let offset = 0
    for (const [part, path] of entry.paths.entries()) {
      if (typeof path !== 'string' || !FILE_PATH.test(path) || path !== `media/${asset.blobContentHash}-${part}.bin`) {
        throw new Error('游戏媒资路径无效。')
      }
      const expectedSize = Math.min(CHUNK_BYTES, entry.byteSize - offset)
      const chunk = await read(path, expectedSize)
      if (chunk.byteLength !== expectedSize) throw new Error('游戏媒资缺失或大小不一致。')
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    assets[index].dataBase64 = toBase64(bytes)
  }
  return verifyTextAdventureCommunityPackageV1(candidate)
}

export async function createAdventureWebZipV1(input: {
  candidate: unknown
  template: ArrayBuffer
}): Promise<{ blob: Blob; filename: string }> {
  const verified = await verifyTextAdventureCommunityPackageV1(input.candidate)
  const zip = await JSZip.loadAsync(input.template)
  const html = await zip.file('index.html')?.async('string')
  if (!html?.includes('STORYFORGE_GAME_HASH') || !zip.file('LICENSE.runtime.txt') || !zip.file('THIRD-PARTY-NOTICES.txt')) throw new Error('独立播放器模板缺失或版本不符，请重新构建项目。')
  // A template is built locally from this same revision, never downloaded from a third party.
  if (Object.keys(zip.files).some(path => !['index.html', 'LICENSE.runtime.txt', 'THIRD-PARTY-NOTICES.txt'].includes(path)
    && !/^assets\/[\w.-]+\.(js|css|woff2?|png|jpe?g|webp|svg|gif|ico)$/.test(path) && !zip.files[path].dir)) {
    throw new Error('独立播放器模板含有非播放器文件。')
  }
  const candidate = structuredClone(verified)
  const media: AdventureWebPackageV1['media'] = []
  for (const row of candidate.distributionBundle.media) {
    const binary = atob(row.dataBase64)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const paths: string[] = []
    for (let offset = 0, part = 0; offset < bytes.length; offset += CHUNK_BYTES, part++) {
      const path = `media/${row.asset.blobContentHash}-${part}.bin`
      zip.file(path, bytes.slice(offset, offset + CHUNK_BYTES))
      paths.push(path)
    }
    row.dataBase64 = ''
    media.push({ assetKey: row.asset.assetKey, byteSize: row.asset.byteSize, paths })
  }
  const envelope: AdventureWebPackageV1 = { schema: 'storyforge.adventure-web-package', version: 1, candidate, media }
  zip.file('index.html', html.replace('STORYFORGE_GAME_HASH', verified.candidatePackageHash))
  const metadata = JSON.stringify(envelope)
  if (new TextEncoder().encode(metadata).length > MAXIMUM_ADVENTURE_WEB_METADATA_BYTES_V1) throw new Error('游戏剧情与验收元数据超过独立网页包上限。')
  zip.file('game.json', metadata)
  zip.file('README.txt', '将本文件夹完整上传到静态网站托管平台，入口为 index.html。可放在任意子目录。\n玩家不需要 StoryForge 或 API Key。存档保存在当前浏览器，清理浏览器数据会删除存档。\n本包不含生产历史；没有上传或发布任何内容。请使用 HTTPS 或本地 HTTP 服务预览，不能直接双击 HTML。\n不同作品版本使用独立存档空间；请保留旧版本网址供旧存档继续游玩。\n播放器许可：LICENSE.runtime.txt 和 THIRD-PARTY-NOTICES.txt；作品素材权利信息保留在 game.json 中。\n')
  return {
    blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    filename: `adventure-web-${verified.candidatePackageHash.slice(0, 12)}.zip`,
  }
}

/** Bound streaming reader prevents an oversized/corrupt host response consuming unbounded memory. */
export async function readAdventureWebFileV1(path: string, maximumBytes: number): Promise<Uint8Array> {
  const response = await fetch(new URL(path, new URL('.', location.href)), { credentials: 'omit', redirect: 'error' })
  if (!response.ok || !response.body) throw new Error(`游戏文件无法读取：${path}`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.length
      if (size > maximumBytes) throw new Error(`游戏文件超出大小上限：${path}`)
      chunks.push(result.value)
    }
  } catch (cause) { await reader.cancel().catch(() => undefined); throw cause }
  finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
