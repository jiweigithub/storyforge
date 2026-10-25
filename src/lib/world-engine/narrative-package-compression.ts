import { assertNarrativeJsonV1, canonicalNarrativeJsonV1, hashNarrativeBytesV1, hashV1, narrativeFail, objectV1, enumV1, textV1, uintV1 } from './narrative-json'
import type { PackedNarrativeJsonV1 } from './narrative-package-packing'

/** An optional bounded transport around the dictionary. Canon and index
 * identities are independent of platform gzip implementation bytes. */
export interface CompressedNarrativePackV1 {
  schema: 'storyforge.narrative-pack-gzip'
  version: 1
  encoding: 'gzip-base64'
  decodedBytes: number
  decodedHash: string
  data: string
}
export const NARRATIVE_COMPRESSED_PACK_MAX_DECODED_BYTES_V1 = 64 * 1024 * 1024
const fail = (message: string): never => narrativeFail('package-compression', message)

async function collectBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > limit) fail('压缩流展开超过声明或版本预算')
      chunks.push(next.value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
function base64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32_768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)))
  return btoa(chunks.join(''))
}
const byteStream = (bytes: Uint8Array<ArrayBuffer>) => new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(bytes); controller.close() } })
export async function compressNarrativePackV1(value: PackedNarrativeJsonV1): Promise<CompressedNarrativePackV1> {
  const bytes = new TextEncoder().encode(canonicalNarrativeJsonV1(value))
  if (!bytes.length || bytes.length > NARRATIVE_COMPRESSED_PACK_MAX_DECODED_BYTES_V1) fail('字典 JSON 超过 64 MiB')
  if (typeof CompressionStream === 'undefined') fail('当前平台不支持完整大世界包的标准压缩')
  const compressed = await collectBounded(byteStream(bytes).pipeThrough(new CompressionStream('gzip')), 32 * 1024 * 1024)
  return { schema: 'storyforge.narrative-pack-gzip', version: 1, encoding: 'gzip-base64', decodedBytes: bytes.length,
    decodedHash: await hashNarrativeBytesV1(bytes), data: base64(compressed) }
}
export async function decompressNarrativePackV1(input: unknown): Promise<unknown> {
  assertNarrativeJsonV1(input)
  const parsed = objectV1<CompressedNarrativePackV1>({ schema: enumV1(['storyforge.narrative-pack-gzip']), version: enumV1([1]),
    encoding: enumV1(['gzip-base64']), decodedBytes: uintV1, decodedHash: hashV1, data: textV1 })(input, 'compressedPack')
  if (!parsed.decodedBytes || parsed.decodedBytes > NARRATIVE_COMPRESSED_PACK_MAX_DECODED_BYTES_V1
    || !parsed.data.length || parsed.data.length > 32 * 1024 * 1024 || parsed.data.length % 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.data)) fail('压缩包长度或编码非法')
  let binary: string
  try { binary = atob(parsed.data) } catch { fail('压缩数据不是有效 base64') }
  if (btoa(binary!) !== parsed.data) fail('压缩数据不是规范 base64')
  const bytes = new Uint8Array(binary!.length)
  for (let index = 0; index < binary!.length; index++) bytes[index] = binary!.charCodeAt(index)
  if (typeof DecompressionStream === 'undefined') fail('当前平台不支持完整大世界包的标准解压')
  const decoded = await collectBounded(byteStream(bytes).pipeThrough(new DecompressionStream('gzip')), parsed.decodedBytes)
  if (decoded.length !== parsed.decodedBytes || await hashNarrativeBytesV1(decoded) !== parsed.decodedHash) fail('展开长度或摘要不匹配')
  let value: unknown, text = ''
  // Retain a BOM as a character so it cannot disappear before the canonical
  // byte check. Canonical output never emits one.
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decoded); value = JSON.parse(text) }
  catch { fail('压缩内容不是有效 UTF-8 JSON') }
  if (canonicalNarrativeJsonV1(value) !== text) fail('压缩字典不是规范 JSON')
  return value
}
