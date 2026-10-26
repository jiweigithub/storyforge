import { assertNarrativeJsonV1, compareUnicodeCodePointsV1, narrativeFail } from './narrative-json'

/** Transport only. These coordinates never become semantic or database IDs.
 * null/boolean/number retain their JSON values. Tuples encode a string [0,id],
 * array [1,...items], or object [shapeId+2,...fieldValues]. */
export type PackedNarrativeValueV1 = null | boolean | number | [number, ...PackedNarrativeValueV1[]]
export interface PackedNarrativeJsonV1 {
  schema: 'storyforge.narrative-json-pack'
  version: 1
  strings: string[]
  shapes: number[][]
  root: PackedNarrativeValueV1
}
export const NARRATIVE_PACK_LIMITS_V1 = Object.freeze({ maxExpandedBytes: 128 * 1024 * 1024,
  maxDepth: 128, maxNodes: 8_000_000, maxStrings: 1_000_000, maxShapes: 65_536 })
const fail = (message: string): never => narrativeFail('package-packing', message)
const scalarIndex = (value: unknown, length: number): value is number => Number.isSafeInteger(value)
  && !Object.is(value, -0) && (value as number) >= 0 && (value as number) < length
const stringBytes = (value: string): number => new TextEncoder().encode(JSON.stringify(value)).length

export function packNarrativeJsonV1(value: unknown): PackedNarrativeJsonV1 {
  assertNarrativeJsonV1(value)
  const strings: string[] = [], shapes: number[][] = []
  const stringIds = new Map<string, number>(), shapeIds = new Map<string, number>()
  let nodes = 0, expanded = 0
  const addBytes = (bytes: number) => {
    expanded += bytes
    if (expanded > NARRATIVE_PACK_LIMITS_V1.maxExpandedBytes) fail('展开内容超过 128 MiB')
  }
  const intern = (text: string) => {
    const prior = stringIds.get(text)
    if (prior !== undefined) return prior
    if (strings.length >= NARRATIVE_PACK_LIMITS_V1.maxStrings) fail('字符串字典超限')
    const id = strings.length; strings.push(text); stringIds.set(text, id); return id
  }
  const encode = (item: unknown, depth: number): PackedNarrativeValueV1 => {
    if (depth > NARRATIVE_PACK_LIMITS_V1.maxDepth || ++nodes > NARRATIVE_PACK_LIMITS_V1.maxNodes) fail('树深度或节点预算超限')
    if (typeof item === 'string') { addBytes(stringBytes(item)); return [0, intern(item)] }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') { addBytes(String(item).length); return item }
    if (Array.isArray(item)) {
      addBytes(2 + Math.max(0, item.length - 1))
      return [1, ...item.map(child => encode(child, depth + 1))]
    }
    const object = item as Record<string, unknown>, keys = Object.keys(object).sort(compareUnicodeCodePointsV1)
    addBytes(2 + Math.max(0, keys.length - 1) + keys.reduce((sum, key) => sum + stringBytes(key) + 1, 0))
    const ids = keys.map(intern), identity = ids.join(',')
    let shape = shapeIds.get(identity)
    if (shape === undefined) {
      if (shapes.length >= NARRATIVE_PACK_LIMITS_V1.maxShapes) fail('对象形状字典超限')
      shape = shapes.length; shapes.push(ids); shapeIds.set(identity, shape)
    }
    return [shape + 2, ...keys.map(key => encode(object[key], depth + 1))]
  }
  const root = encode(value, 0)
  return { schema: 'storyforge.narrative-json-pack', version: 1, strings, shapes, root }
}

/** A complete budget/reference/canonical-order pass runs before creating any
 * expanded objects. Repeated string references cannot bypass expansion bounds. */
export function unpackNarrativeJsonV1(input: unknown): unknown {
  assertNarrativeJsonV1(input)
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('缺少打包对象')
  const value = input as PackedNarrativeJsonV1
  const keys = Object.keys(value)
  if (keys.length !== 5 || ['schema', 'version', 'strings', 'shapes', 'root'].some(key => !keys.includes(key))
    || value.schema !== 'storyforge.narrative-json-pack' || value.version !== 1) fail('打包版本或字段不受支持')
  if (!Array.isArray(value.strings) || value.strings.length > NARRATIVE_PACK_LIMITS_V1.maxStrings
    || value.strings.some(text => typeof text !== 'string') || new Set(value.strings).size !== value.strings.length) fail('字符串字典重复、非法或超限')
  if (!Array.isArray(value.shapes) || value.shapes.length > NARRATIVE_PACK_LIMITS_V1.maxShapes) fail('对象形状字典非法或超限')
  const shapeKeys = new Set<string>()
  for (const shape of value.shapes) {
    if (!Array.isArray(shape) || shape.some(id => !scalarIndex(id, value.strings.length))) fail('对象字段引用越界')
    if (shape.some((id, index) => index > 0 && compareUnicodeCodePointsV1(value.strings[shape[index - 1]], value.strings[id]) >= 0)) fail('对象字段重复或非规范顺序')
    const key = shape.join(','); if (shapeKeys.has(key)) fail('对象形状重复'); shapeKeys.add(key)
  }
  const byteLengths = value.strings.map(stringBytes)
  const usedStrings = new Set<number>(), usedShapes = new Set<number>()
  const checkStringReference = (id: unknown): number => {
    if (!scalarIndex(id, value.strings.length)) fail('字符串引用越界')
    const index = id as number
    if (!usedStrings.has(index)) {
      if (index !== usedStrings.size) fail('字符串字典不是首次出现顺序')
      usedStrings.add(index)
    }
    return index
  }
  let nodes = 0, expanded = 0
  const addBytes = (bytes: number) => {
    expanded += bytes
    if (expanded > NARRATIVE_PACK_LIMITS_V1.maxExpandedBytes) fail('展开内容超过 128 MiB')
  }
  const inspect = (item: PackedNarrativeValueV1, depth: number): void => {
    if (depth > NARRATIVE_PACK_LIMITS_V1.maxDepth || ++nodes > NARRATIVE_PACK_LIMITS_V1.maxNodes) fail('树深度或节点预算超限')
    if (item === null || typeof item === 'number' || typeof item === 'boolean') { addBytes(String(item).length); return }
    if (!Array.isArray(item) || !item.length || !Number.isSafeInteger(item[0]) || Object.is(item[0], -0) || item[0] < 0) fail('打包值不是合法标签元组')
    if (item[0] === 0) {
      if (item.length !== 2) fail('字符串元组字段不完整')
      addBytes(byteLengths[checkStringReference(item[1])]); return
    }
    if (item[0] === 1) {
      addBytes(2 + Math.max(0, item.length - 2))
    } else {
      const shapeId = item[0] - 2
      if (!scalarIndex(shapeId, value.shapes.length)) fail('对象形状引用越界')
      if (!usedShapes.has(shapeId)) {
        if (shapeId !== usedShapes.size) fail('对象形状不是首次出现顺序')
        usedShapes.add(shapeId)
      }
      const shape = value.shapes[shapeId]
      if (item.length !== shape.length + 1) fail('对象字段和值数量不符')
      addBytes(2 + Math.max(0, shape.length - 1))
      for (const id of shape) addBytes(byteLengths[checkStringReference(id)] + 1)
    }
    for (let index = 1; index < item.length; index++) inspect(item[index], depth + 1)
  }
  inspect(value.root, 0)
  if (usedStrings.size !== value.strings.length || usedShapes.size !== value.shapes.length) fail('字典含未使用项')
  const decode = (item: PackedNarrativeValueV1): unknown => {
    if (!Array.isArray(item)) return item
    if (item[0] === 0) return value.strings[item[1] as number]
    if (item[0] === 1) return item.slice(1).map(decode)
    const result: Record<string, unknown> = {}
    value.shapes[item[0] - 2].forEach((id, index) => Object.defineProperty(result, value.strings[id], {
      value: decode(item[index + 1]), enumerable: true, writable: true, configurable: true,
    }))
    return result
  }
  return decode(value.root)
}
