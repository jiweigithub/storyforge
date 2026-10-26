import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSHA256 } = require('/tmp/nw2e-hash-wasm-probe-v1/extracted/package/dist/index.umd.js')
const wasmHash = await createSHA256()
let inUse = false
const sha256 = { create() {
  if (inUse) throw Error('probe hash cannot be re-entered')
  inUse = true; wasmHash.init()
  return { update(value: Uint8Array) { wasmHash.update(value) }, digest() { return wasmHash.digest('binary') as Uint8Array },
    destroy() { inUse = false } }
} }


/** Separate from immutable v3 release canonicalization. Never change the v3 comparator. */
export class NarrativeContractErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[narrative-ir:${code}] ${message}`)
    this.name = 'NarrativeContractErrorV1'
  }
}
export function narrativeFail(code: string, message: string): never {
  throw new NarrativeContractErrorV1(code, message)
}
const SURROGATE_UNIT = /[\ud800-\udfff]/
export function compareUnicodeCodePointsV1(a: string, b: string): number {
  if (a === b) return 0
  // Native UTF-16 order is exactly scalar order when neither string contains
  // surrogate units. Keep the scalar comparison for astral characters.
  if (!SURROGATE_UNIT.test(a) && !SURROGATE_UNIT.test(b)) return a < b ? -1 : 1
  let left = 0, right = 0
  while (left < a.length && right < b.length) {
    const aPoint = a.codePointAt(left)!, bPoint = b.codePointAt(right)!
    const difference = aPoint - bPoint
    if (difference) return difference
    left += aPoint > 0xffff ? 2 : 1
    right += bPoint > 0xffff ? 2 : 1
  }
  // Only the sign matters to callers; code-point order is unchanged and no
  // temporary arrays proportional to long semantic IDs are allocated.
  return left < a.length ? 1 : right < b.length ? -1 : 0
}
export function assertUnicodeV1(text: string): void {
  if (!SURROGATE_UNIT.test(text)) return
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) narrativeFail('unicode', '孤立 surrogate 不可编码为原文证据')
    } else if (unit >= 0xdc00 && unit <= 0xdfff) narrativeFail('unicode', '孤立 surrogate 不可编码为原文证据')
  }
}
/** Exact raw UTF-8 length, without allocating a byte array. */
export function narrativeUtf8ByteLengthV1(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) narrativeFail('unicode', '孤立 surrogate 不可编码为原文证据')
      bytes += 4
    } else if (unit >= 0xdc00 && unit <= 0xdfff) narrativeFail('unicode', '孤立 surrogate 不可编码为原文证据')
    else bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3
  }
  return bytes
}
/** Validation and encoding share one traversal. Validation alone must not
 * allocate a second, potentially very large serialized artifact. */
function walkNarrativeJsonV1(value: unknown, write?: (part: string) => void, omittedKeys?: ReadonlySet<string>): void {
  const stack = new Set<object>()
  const visit = (item: unknown, emit?: (part: string) => void): void => {
    if (item === null) { emit?.('null'); return }
    if (typeof item === 'string') { assertUnicodeV1(item); if (emit) emit(JSON.stringify(item)); return }
    if (typeof item === 'boolean') { emit?.(String(item)); return }
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)
      && (!Number.isInteger(item) || Number.isSafeInteger(item))) { emit?.(String(item)); return }
    if (typeof item !== 'object' || !item) narrativeFail('json', '仅允许精确 JSON 值；禁止 undefined/非有限数/不安全整数')
    if (stack.has(item)) narrativeFail('json-cycle', 'JSON 不允许循环对象')
    stack.add(item)
    if (Object.getOwnPropertySymbols(item).length) narrativeFail('json', '不允许 symbol 属性')
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) narrativeFail('json', '数组必须稠密且无额外属性')
      emit?.('[')
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, index)
        if (!descriptor || !('value' in descriptor)) narrativeFail('json', '数组必须稠密且不允许 accessor')
        if (index) emit?.(',')
        visit(descriptor.value, emit)
      }
      emit?.(']')
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        narrativeFail('json', '仅允许普通 JSON 对象')
      }
      const keys = Object.keys(item)
      if (emit) keys.sort(compareUnicodeCodePointsV1)
      emit?.('{')
      let emitted = 0
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]
        assertUnicodeV1(key)
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!
        if (!('value' in descriptor)) narrativeFail('json', '不允许 accessor')
        const output = omittedKeys?.has(key) ? undefined : emit
        if (output) { if (emitted++) output(','); output(`${JSON.stringify(key)}:`) }
        // Omission affects only encoded bytes. Invalid values, accessors and
        // cycles inside omitted fields are still rejected by the same walk.
        visit(descriptor.value, output)
      }
      emit?.('}')
    }
    stack.delete(item)
  }
  visit(value, write)
}
export function assertNarrativeJsonV1(value: unknown): void { walkNarrativeJsonV1(value) }
export function canonicalNarrativeJsonV1(value: unknown): string {
  return encodeNarrativeJsonV1(value)!
}
/** A disposable cache may stop encoding when its byte budget is exhausted.
 * null is a refusal, never validation of the unvisited remainder. */
export function boundedCanonicalNarrativeJsonV1(value: unknown, maxBytes: number): string | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) narrativeFail('json-budget', 'JSON 字节预算必须是安全非负整数')
  return encodeNarrativeJsonV1(value, maxBytes)
}
function encodeNarrativeJsonV1(value: unknown, maxBytes?: number): string | null {
  // Bound the intermediate pieces instead of holding a serialized string for
  // every nested subtree while serializing its ancestors. Wire bytes stay v1.
  const chunks: string[] = []
  let parts: string[] = [], length = 0, bytes = 0
  const exhausted = Symbol('cache JSON budget exhausted')
  try {
    walkNarrativeJsonV1(value, part => {
      if (maxBytes !== undefined) {
        if (part.length > maxBytes - bytes || (bytes += narrativeUtf8ByteLengthV1(part)) > maxBytes) throw exhausted
      }
      parts.push(part); length += part.length
      if (length >= 32_768) { chunks.push(parts.join('')); parts = []; length = 0 }
    })
  } catch (error) { if (error === exhausted) return null; throw error }
  if (parts.length) chunks.push(parts.join(''))
  return chunks.join('')
}
/** Exact canonical-value equality without allocating two complete encodings.
 * Invalid JSON is still rejected, including accessors and cyclic objects. */
export function equalNarrativeJsonV1(left: unknown, right: unknown): boolean {
  assertNarrativeJsonV1(left); assertNarrativeJsonV1(right)
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const aKeys = Object.keys(a), bKeys = Object.keys(b)
    return aKeys.length === bKeys.length && aKeys.every(key => Object.prototype.hasOwnProperty.call(b, key)
      && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  }
  return equal(left, right)
}
const hashHex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
/** SHA-256 is unchanged. Feed bounded UTF-8 pieces instead of allocating and
 * transferring another complete encoding of a potentially large artifact.
 * Updates consume each piece synchronously; caller mutation after the call
 * cannot change a digest already being returned. */
function incrementalNarrativeHash() {
  const hash = sha256.create(), encoder = new TextEncoder()
  let buffer: Uint8Array | undefined
  const updateText = (text: string) => {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 32_768, text.length)
      const finalUnit = text.charCodeAt(end - 1)
      if (end < text.length && finalUnit >= 0xd800 && finalUnit <= 0xdbff) end--
      // SHA consumes the view synchronously, so a large artifact can reuse
      // one 32 KiB buffer instead of abandoning thousands of byte arrays.
      // encodeInto stops before a partial scalar when non-ASCII bytes need
      // more room; advance by its consumed units, never by the proposed end.
      const capacity = Math.max(4, end - start)
      if (!buffer || buffer.length < capacity) buffer = new Uint8Array(capacity)
      const encoded = encoder.encodeInto(text.slice(start, end), buffer)
      if (!encoded.read) narrativeFail('encoding', 'UTF-8 分段编码未消费输入')
      hash.update(buffer.subarray(0, encoded.written))
      start += encoded.read
    }
  }
  return { updateText, updateBytes: (bytes: Uint8Array) => { hash.update(bytes) },
    digest: () => hashHex(hash.digest()), destroy: () => { hash.destroy(); buffer = undefined } }
}
export async function hashNarrativeBytesV1(value: string | Uint8Array): Promise<string> {
  if (typeof value === 'string') assertUnicodeV1(value)
  const hash = incrementalNarrativeHash()
  try {
    if (typeof value === 'string') hash.updateText(value)
    else hash.updateBytes(value)
    return hash.digest()
  } finally { hash.destroy() }
}
function hashCanonicalNarrativeValueV1(value: unknown, omittedKeys?: ReadonlySet<string>): Promise<string> {
  const hash = incrementalNarrativeHash()
  let parts: string[] = [], length = 0
  const flush = () => { if (length) hash.updateText(parts.join('')); parts = []; length = 0 }
  try {
    // Use the same strict canonical traversal, including exact key order and
    // invalid-JSON rejection. Only the sink changes, never the wire format.
    walkNarrativeJsonV1(value, part => {
      if (part.length >= 32_768) { flush(); hash.updateText(part) }
      else { parts.push(part); length += part.length; if (length >= 32_768) flush() }
    }, omittedKeys)
    flush()
    return Promise.resolve(hash.digest())
  } finally { hash.destroy() }
}

export const hashNarrativeValueV1 = (value: unknown): Promise<string> => hashCanonicalNarrativeValueV1(value)

/** Hash the canonical projection without allocating a recursively copied
 * object tree. Keys are omitted at every object depth, never array elements;
 * the entire input remains subject to strict JSON validation. */
export function hashNarrativeValueWithoutKeysV1(value: unknown, omittedKeys: readonly string[]): Promise<string> {
  for (const key of omittedKeys) {
    if (typeof key !== 'string') narrativeFail('json-key', '摘要排除键必须是字符串')
    assertUnicodeV1(key)
  }
  return hashCanonicalNarrativeValueV1(value, new Set(omittedKeys))
}

export type DecoderV1<T> = (value: unknown, path: string) => T
export const textV1: DecoderV1<string> = (value, path) => {
  if (typeof value !== 'string') narrativeFail('shape', `${path} 必须是 string`)
  assertUnicodeV1(value)
  return value
}
export const keyV1: DecoderV1<string> = (value, path) => {
  const text = textV1(value, path)
  if (!text || text.trim() !== text) narrativeFail('shape', `${path} 必须是精确非空键`)
  return text
}
export const hashV1: DecoderV1<string> = (value, path) => {
  const text = textV1(value, path)
  if (!/^[a-f0-9]{64}$/.test(text)) narrativeFail('hash', `${path} 必须是 SHA-256`)
  return text
}
export const pointerV1: DecoderV1<string> = (value, path) => {
  const pointer = textV1(value, path)
  if (!/^(\/(?:[^~]|~[01])*)+$/.test(pointer)) narrativeFail('json-pointer', `${path} 必须是非空规范 JSON pointer`)
  return pointer
}
export const uintV1: DecoderV1<number> = (value, path) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    narrativeFail('shape', `${path} 必须是安全非负整数`)
  }
  return value
}
export const integerTextV1: DecoderV1<string> = (value, path) => {
  const text = textV1(value, path)
  if (!/^(0|-?[1-9][0-9]*)$/.test(text)) narrativeFail('tick', `${path} 必须是规范十进制整数`)
  return text
}
export const nullableV1 = <T>(decoder: DecoderV1<T>): DecoderV1<T | null> => (value, path) => value === null ? null : decoder(value, path)
export const enumV1 = <T extends string | number>(values: readonly T[]): DecoderV1<T> => (value, path) => {
  if (!values.includes(value as T)) narrativeFail('enum', `${path} 不支持 ${String(value)}`)
  return value as T
}
export const arrayV1 = <T>(decoder: DecoderV1<T>): DecoderV1<T[]> => (value, path) => {
  if (!Array.isArray(value)) narrativeFail('shape', `${path} 必须是数组`)
  return value.map((item, index) => decoder(item, `${path}[${index}]`))
}
export const uniqueKeysV1: DecoderV1<string[]> = (value, path) => {
  const keys = arrayV1(keyV1)(value, path)
  if (new Set(keys).size !== keys.length) narrativeFail('duplicate', `${path} 键重复`)
  return keys.sort(compareUnicodeCodePointsV1)
}
export function objectV1<T extends object>(shape: { [K in keyof T]-?: DecoderV1<T[K]> }): DecoderV1<T> {
  const expected = Object.keys(shape)
  return (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) narrativeFail('shape', `${path} 必须是对象`)
    if (Object.keys(value).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
      narrativeFail('exact-keys', `${path} 缺少字段或含额外字段`)
    }
    const decoded: Record<string, unknown> = {}
    for (const key of expected) {
      const field = (shape[key as keyof T] as DecoderV1<unknown>)((value as Record<string, unknown>)[key], `${path}.${key}`)
      if (key === '__proto__') Object.defineProperty(decoded, key, { value: field, writable: true, enumerable: true, configurable: true })
      else decoded[key] = field
    }
    return decoded as T
  }
}
