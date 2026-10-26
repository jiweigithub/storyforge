import type {
  IntervalV1, NarrativeTimeComparisonV1, NarrativeTimeContextV1, NarrativeTimeV1,
  TimePointV1,
} from '../types/narrative-time'
import {
  arrayV1, canonicalNarrativeJsonV1, enumV1, integerTextV1, keyV1, narrativeFail,
  nullableV1, objectV1, textV1, uintV1, uniqueKeysV1, type DecoderV1,
} from './narrative-json'

export const timePointDecoderV1: DecoderV1<TimePointV1> = (value, path) => {
  const kind = (value as TimePointV1 | null)?.kind
  switch (kind) {
    case 'tick': return objectV1<Extract<TimePointV1, { kind: 'tick' }>>({
      kind: enumV1(['tick']), timelineKey: keyV1, value: integerTextV1,
    })(value, path)
    case 'event-anchor': return objectV1<Extract<TimePointV1, { kind: 'event-anchor' }>>({
      kind: enumV1(['event-anchor']), eventKey: keyV1, side: enumV1(['before', 'at', 'after']),
    })(value, path)
    case 'unknown': return objectV1<Extract<TimePointV1, { kind: 'unknown' }>>({
      kind: enumV1(['unknown']), label: nullableV1(textV1),
    })(value, path)
    default: return narrativeFail('time-kind', `${path} 时间类型不支持`)
  }
}
export const intervalDecoderV1: DecoderV1<IntervalV1> = (value, path) => {
  const interval = objectV1<IntervalV1>({ start: timePointDecoderV1, end: nullableV1(timePointDecoderV1),
    endMeaning: enumV1(['known', 'open', 'unknown']) })(value, path)
  if ((interval.endMeaning === 'known') !== (interval.end !== null)) {
    narrativeFail('interval-end', `${path}: end=null 必须明确 open/unknown`)
  }
  if (interval.end?.kind === 'unknown') narrativeFail('interval-end', `${path}: 未知结束用 end=null/unknown`)
  if (interval.start.kind === 'tick' && interval.end?.kind === 'tick'
    && interval.start.timelineKey === interval.end.timelineKey
    && BigInt(interval.start.value) > BigInt(interval.end.value)) narrativeFail('interval-order', `${path}: 结束早于开始`)
  return interval
}
export const narrativeTimeDecoderV1 = objectV1<NarrativeTimeV1>({
  occurred: nullableV1(intervalDecoderV1), valid: nullableV1(intervalDecoderV1),
  narratedAt: nullableV1(objectV1({ sequenceKey: keyV1, unitKey: keyV1, spanStart: uintV1 })),
  disclosedAt: arrayV1(objectV1({ audienceKey: keyV1, sequenceKey: keyV1, unitKey: keyV1 })),
  acquiredAt: nullableV1(timePointDecoderV1),
})
const contextDecoder = objectV1<NarrativeTimeContextV1>({
  version: enumV1([1]),
  timelines: arrayV1(objectV1({ timelineKey: keyV1, worldKey: keyV1, branchKey: keyV1,
    calendar: keyV1, unit: keyV1, epoch: keyV1 })),
  sequences: arrayV1(objectV1({ sequenceKey: keyV1, ownerKey: keyV1, revision: keyV1,
    units: arrayV1(objectV1({ unitKey: keyV1, ordinal: uintV1 })) })),
  anchors: arrayV1(objectV1({ eventKey: keyV1, timelineKey: keyV1, value: nullableV1(integerTextV1) })),
  before: arrayV1(objectV1({ beforeEventKey: keyV1, afterEventKey: keyV1 })),
  mappings: arrayV1(objectV1({ mappingKey: keyV1, revision: keyV1, fromTimelineKey: keyV1,
    toTimelineKey: keyV1, fromStart: integerTextV1, fromEnd: nullableV1(integerTextV1),
    numerator: integerTextV1, denominator: integerTextV1, offset: integerTextV1,
    evidenceIds: uniqueKeysV1, confirmationRef: keyV1 })),
})

function unique(items: string[], label: string): void {
  if (new Set(items).size !== items.length) narrativeFail('duplicate', `${label} 重复`)
}
export function parseNarrativeTimeContextV1(input: unknown): NarrativeTimeContextV1 {
  canonicalNarrativeJsonV1(input)
  const context = contextDecoder(input, 'timeContext')
  unique(context.timelines.map(t => t.timelineKey), 'timelineKey')
  unique(context.sequences.map(s => s.sequenceKey), 'sequenceKey')
  unique(context.anchors.map(a => a.eventKey), 'eventKey')
  unique(context.mappings.map(m => m.mappingKey), 'mappingKey')
  unique(context.before.map(e => `${e.beforeEventKey}\0${e.afterEventKey}`), 'before edge')
  const timelines = new Map(context.timelines.map(t => [t.timelineKey, t]))
  const anchors = new Map(context.anchors.map(a => [a.eventKey, a]))
  for (const sequence of context.sequences) {
    unique(sequence.units.map(u => u.unitKey), 'sequence unit')
    unique(sequence.units.map(u => String(u.ordinal)), 'sequence ordinal')
    sequence.units.sort((a, b) => a.ordinal - b.ordinal)
  }
  for (const anchor of context.anchors) {
    if (!timelines.has(anchor.timelineKey)) narrativeFail('time-reference', 'anchor 未声明 timeline')
  }
  const edges = new Map<string, string[]>()
  for (const edge of context.before) {
    const from = anchors.get(edge.beforeEventKey), to = anchors.get(edge.afterEventKey)
    if (!from || !to || from.timelineKey !== to.timelineKey) narrativeFail('time-reference', 'before 只能连接同一时制/分支的已登记事件')
    const next = edges.get(from.eventKey) ?? []
    next.push(to.eventKey); edges.set(from.eventKey, next)
  }
  // Check cycles and every transitive bound, not just directly connected ticks.
  for (const start of context.anchors) {
    const seen = new Set<string>(), pending = [...(edges.get(start.eventKey) ?? [])]
    while (pending.length) {
      const key = pending.pop()!
      if (key === start.eventKey) narrativeFail('time-cycle', 'before/after 存在环')
      if (seen.has(key)) continue
      seen.add(key)
      const target = anchors.get(key)!
      if (start.value !== null && target.value !== null && BigInt(start.value) >= BigInt(target.value)) {
        narrativeFail('time-conflict', '事件偏序与 tick 矛盾')
      }
      pending.push(...(edges.get(key) ?? []))
    }
  }
  for (const mapping of context.mappings) {
    if (!timelines.has(mapping.fromTimelineKey) || !timelines.has(mapping.toTimelineKey)
      || mapping.fromTimelineKey === mapping.toTimelineKey || !mapping.evidenceIds.length
      || BigInt(mapping.numerator) <= 0n || BigInt(mapping.denominator) <= 0n
      || (mapping.fromEnd !== null && BigInt(mapping.fromStart) >= BigInt(mapping.fromEnd))) {
      narrativeFail('time-mapping', '映射必须有两个时制、合法单调区间、证据和确认')
    }
    for (const other of context.mappings) {
      if (other === mapping || other.fromTimelineKey !== mapping.fromTimelineKey || other.toTimelineKey !== mapping.toTimelineKey) continue
      if ((other.fromEnd === null || BigInt(mapping.fromStart) < BigInt(other.fromEnd))
        && (mapping.fromEnd === null || BigInt(other.fromStart) < BigInt(mapping.fromEnd))) {
        narrativeFail('time-mapping-conflict', '同向时间映射区间重叠')
      }
    }
  }
  return context
}

export function parseNarrativeTimeV1(input: unknown): NarrativeTimeV1 {
  canonicalNarrativeJsonV1(input)
  return narrativeTimeDecoderV1(input, 'time')
}
export function unknownNarrativeTimeV1(): NarrativeTimeV1 {
  return { occurred: null, valid: null, narratedAt: null, disclosedAt: [], acquiredAt: null }
}
const sign = (a: bigint, b: bigint): NarrativeTimeComparisonV1 => a < b ? 'before' : a > b ? 'after' : 'equal'
function reaches(context: NarrativeTimeContextV1, from: string, to: string): boolean {
  const seen = new Set<string>(), pending = [from]
  while (pending.length) {
    const at = pending.pop()!
    if (seen.has(at)) continue
    seen.add(at)
    for (const edge of context.before) {
      if (edge.beforeEventKey !== at) continue
      if (edge.afterEventKey === to) return true
      pending.push(edge.afterEventKey)
    }
  }
  return false
}
function assertPointReference(point: TimePointV1, context: NarrativeTimeContextV1): void {
  if (point.kind === 'tick' && !context.timelines.some(t => t.timelineKey === point.timelineKey)) {
    narrativeFail('time-reference', '时间点引用未知 timeline')
  }
  if (point.kind === 'event-anchor' && !context.anchors.some(a => a.eventKey === point.eventKey)) {
    narrativeFail('time-reference', '时间点引用未知 event anchor')
  }
}
function compareParsed(a: TimePointV1, b: TimePointV1, context: NarrativeTimeContextV1): NarrativeTimeComparisonV1 {
  assertPointReference(a, context); assertPointReference(b, context)
  if (a.kind === 'unknown' || b.kind === 'unknown') return 'unknown-time'
  if (a.kind === 'event-anchor' && b.kind === 'event-anchor') {
    const positions = { before: -1, at: 0, after: 1 }
    if (a.eventKey === b.eventKey) {
      if (a.side === b.side) return a.side === 'at' ? 'equal' : 'unknown-time'
      return positions[a.side] < positions[b.side] ? 'before' : 'after'
    }
    if (reaches(context, a.eventKey, b.eventKey) && a.side !== 'after' && b.side !== 'before') return 'before'
    if (reaches(context, b.eventKey, a.eventKey) && b.side !== 'after' && a.side !== 'before') return 'after'
  }
  const tick = (p: Exclude<TimePointV1, { kind: 'unknown' }>) => p.kind === 'tick' ? p
    : { kind: 'tick' as const, ...context.anchors.find(x => x.eventKey === p.eventKey)! }
  const left = tick(a), right = tick(b)
  if (left.value === null || right.value === null) {
    return left.timelineKey === right.timelineKey ? 'unknown-time' : 'incomparable-time'
  }
  let av = BigInt(left.value)
  if (left.timelineKey !== right.timelineKey) {
    const mapping = context.mappings.find(m => m.fromTimelineKey === left.timelineKey && m.toTimelineKey === right.timelineKey
      && av >= BigInt(m.fromStart) && (m.fromEnd === null || av < BigInt(m.fromEnd)))
    if (!mapping) return 'incomparable-time'
    const scaled = av * BigInt(mapping.numerator)
    if (scaled % BigInt(mapping.denominator) !== 0n) return 'incomparable-time'
    av = scaled / BigInt(mapping.denominator) + BigInt(mapping.offset)
  }
  const order = sign(av, BigInt(right.value))
  const as = a.kind === 'tick' ? 'at' : a.side, bs = b.kind === 'tick' ? 'at' : b.side
  if (as === 'at' && bs === 'at') return order
  if (order === 'before' && as !== 'after' && bs !== 'before') return 'before'
  if (order === 'after' && as !== 'before' && bs !== 'after') return 'after'
  if (order === 'equal' && positionsForSide(as) < positionsForSide(bs)) return 'before'
  if (order === 'equal' && positionsForSide(as) > positionsForSide(bs)) return 'after'
  return 'unknown-time'
}
const positionsForSide = (side: 'before' | 'at' | 'after') => side === 'before' ? -1 : side === 'after' ? 1 : 0

export function compareNarrativeTimeV1(a: TimePointV1, b: TimePointV1, input: NarrativeTimeContextV1): NarrativeTimeComparisonV1 {
  return compareParsed(timePointDecoderV1(a, 'left'), timePointDecoderV1(b, 'right'), parseNarrativeTimeContextV1(input))
}
export function narrativeIntervalContainsV1(interval: IntervalV1, point: TimePointV1, context: NarrativeTimeContextV1): 'contains' | 'outside' | 'uncertain' {
  const parsed = intervalDecoderV1(interval, 'interval'), checked = parseNarrativeTimeContextV1(context)
  const checkedPoint = timePointDecoderV1(point, 'point')
  if (parsed.end) {
    const order = compareParsed(parsed.start, parsed.end, checked)
    if (order === 'after' || order === 'equal') narrativeFail('interval-order', '有效区间必须非空且不可倒置')
  }
  const before = compareParsed(checkedPoint, parsed.start, checked)
  if (before === 'before') return 'outside'
  if (parsed.end) {
    const after = compareParsed(checkedPoint, parsed.end, checked)
    if (after === 'equal' || after === 'after') return 'outside'
    return (before === 'equal' || before === 'after') && after === 'before' ? 'contains' : 'uncertain'
  }
  return parsed.endMeaning === 'open' && (before === 'equal' || before === 'after') ? 'contains' : 'uncertain'
}
export function validateNarrativeTimeReferencesV1(time: NarrativeTimeV1, context: NarrativeTimeContextV1): void {
  const position = (sequenceKey: string, unitKey: string) => {
    if (!context.sequences.find(s => s.sequenceKey === sequenceKey)?.units.some(u => u.unitKey === unitKey)) {
      narrativeFail('sequence-reference', '叙述/揭示位置未在冻结 sequence 中')
    }
  }
  for (const [kind, interval] of [['occurred', time.occurred], ['valid', time.valid]] as const) {
    if (!interval) continue
    assertPointReference(interval.start, context)
    if (interval.end) {
      const result = compareParsed(interval.start, interval.end, context)
      if (result === 'after' || (kind === 'valid' && result === 'equal')) narrativeFail('interval-order', '有效区间必须非空，事件区间不可倒置')
    }
  }
  if (time.acquiredAt) assertPointReference(time.acquiredAt, context)
  if (time.narratedAt) position(time.narratedAt.sequenceKey, time.narratedAt.unitKey)
  for (const at of time.disclosedAt) position(at.sequenceKey, at.unitKey)
}

/** Chapter-only legacy evidence cannot assert a world-time acquisition. */
export function legacyNarrativeTimeV1(input: {
  chapterUnitKey: string | null; sequenceKey: string | null; storyTime: string | null
}): { time: NarrativeTimeV1; diagnostics: string[] } {
  const time = unknownNarrativeTimeV1()
  if (input.chapterUnitKey && input.sequenceKey) time.narratedAt = { sequenceKey: input.sequenceKey, unitKey: input.chapterUnitKey, spanStart: 0 }
  time.acquiredAt = { kind: 'unknown', label: input.storyTime }
  return { time, diagnostics: ['acquired-time-unknown', ...(input.storyTime ? ['unparsed-story-time'] : []),
    ...(!time.narratedAt ? ['narration-position-unknown'] : [])] }
}

/** Only caller-supplied coordinates captured from this exact frozen v3 release
 * may translate throughChapterId. No live database lookup or timestamp parse. */
export function resolveLegacyNarrativeCutoffV1(input: {
  releaseHash: string
  chapterId: number
  sequence: NarrativeTimeContextV1['sequences'][number]
  coordinates: Array<{ releaseHash: string; chapterId: number; unitKey: string }>
}): { status: 'supported'; sequenceKey: string; unitKey: string; ordinal: number } | { status: 'unsupported'; reason: 'frozen-chapter-map-missing' } {
  const matches = input.coordinates.filter(c => c.releaseHash === input.releaseHash && c.chapterId === input.chapterId)
  const unit = matches.length === 1 ? input.sequence.units.filter(u => u.unitKey === matches[0].unitKey) : []
  if (unit.length !== 1) return { status: 'unsupported', reason: 'frozen-chapter-map-missing' }
  return { status: 'supported', sequenceKey: input.sequence.sequenceKey, unitKey: unit[0].unitKey, ordinal: unit[0].ordinal }
}
