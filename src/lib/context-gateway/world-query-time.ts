import type { IntervalV1, NarrativeTimeContextV1, NarrativeTimeV1, TimePointV1 } from '../types/narrative-time'
import type { NarrativeRecordV1 } from '../types/narrative-ir'
import type { WorldQueryTimeV1 } from '../types/world-query'
import { compareNarrativeTimeV1 } from '../world-engine/narrative-time'
import { worldQueryFailV1 } from './world-query-contract'

export type WorldQueryTimeMatchV1 = 'matched' | 'outside' | 'unknown-time' | 'incomparable-time'
export function sequenceOrdinalV1(context: NarrativeTimeContextV1, sequenceKey: string, unitKey: string): number {
  const unit = context.sequences.find(sequence => sequence.sequenceKey === sequenceKey)?.units.find(item => item.unitKey === unitKey)
  if (!unit) worldQueryFailV1('time-reference', '查询序列或位置不可用')
  return unit.ordinal
}
export function timeAtOrBeforeV1(point: TimePointV1, through: TimePointV1, context: NarrativeTimeContextV1): WorldQueryTimeMatchV1 {
  const order = compareNarrativeTimeV1(point, through, context)
  return order === 'before' || order === 'equal' ? 'matched' : order === 'after' ? 'outside' : order
}
function pointInInterval(point: TimePointV1, interval: IntervalV1, context: NarrativeTimeContextV1,
  instant: boolean): WorldQueryTimeMatchV1 {
  const start = compareNarrativeTimeV1(point, interval.start, context)
  if (start === 'before') return 'outside'
  if (start !== 'equal' && start !== 'after') return start
  if (interval.end) {
    const width = compareNarrativeTimeV1(interval.start, interval.end, context)
    if (width === 'after') worldQueryFailV1('time-order', '查询区间倒置')
    if (instant && width === 'equal') return start === 'equal' ? 'matched' : 'outside'
    const end = compareNarrativeTimeV1(point, interval.end, context)
    return end === 'before' ? 'matched' : end === 'after' || end === 'equal' ? 'outside' : end
  }
  return interval.endMeaning === 'open' ? 'matched' : 'unknown-time'
}
function overlap(left: IntervalV1, right: IntervalV1, context: NarrativeTimeContextV1, instant: boolean): WorldQueryTimeMatchV1 {
  const leftInstant = left.end && compareNarrativeTimeV1(left.start, left.end, context) === 'equal'
  const rightInstant = right.end && compareNarrativeTimeV1(right.start, right.end, context) === 'equal'
  if (leftInstant) return instant ? pointInInterval(left.start, right, context, true) : 'outside'
  if (rightInstant) return pointInInterval(right.start, left, context, instant)
  const comparisons = []
  if (left.end) {
    const order = compareNarrativeTimeV1(left.end, right.start, context)
    if (order === 'before' || order === 'equal') return 'outside'
    comparisons.push(order)
  } else if (left.endMeaning === 'unknown') comparisons.push('unknown-time')
  if (right.end) {
    const order = compareNarrativeTimeV1(right.end, left.start, context)
    if (order === 'before' || order === 'equal') return 'outside'
    comparisons.push(order)
  } else if (right.endMeaning === 'unknown') comparisons.push('unknown-time')
  if (comparisons.includes('incomparable-time')) return 'incomparable-time'
  if (comparisons.includes('unknown-time')) return 'unknown-time'
  // Open intervals on unrelated calendars still cannot be compared.
  const starts = compareNarrativeTimeV1(left.start, right.start, context)
  return starts === 'unknown-time' || starts === 'incomparable-time' ? starts : 'matched'
}

export function validateWorldQueryTimeV1(time: WorldQueryTimeV1 | null, context: NarrativeTimeContextV1): void {
  if (!time) return
  if (!('mode' in time)) { sequenceOrdinalV1(context, time.sequenceKey, time.throughUnitKey); return }
  if (time.mode === 'at') { compareNarrativeTimeV1(time.point, time.point, context); return }
  compareNarrativeTimeV1(time.interval.start, time.interval.start, context)
  if (time.interval.end && compareNarrativeTimeV1(time.interval.start, time.interval.end, context) === 'after') worldQueryFailV1('time-order', '查询区间倒置')
}

export function matchWorldQueryTimeV1(record: NarrativeRecordV1, time: WorldQueryTimeV1 | null,
  context: NarrativeTimeContextV1, disclosed: NarrativeTimeV1['disclosedAt'] = []): WorldQueryTimeMatchV1 {
  if (!time) return 'matched'
  if (!('mode' in time)) {
    const target = sequenceOrdinalV1(context, time.sequenceKey, time.throughUnitKey)
    const positions = time.axis === 'narrated' ? record.time.narratedAt ? [record.time.narratedAt] : []
      : [...record.time.disclosedAt, ...disclosed].filter(position => position.audienceKey === time.audienceKey)
    if (!positions.length) return 'unknown-time'
    if (!positions.some(position => position.sequenceKey === time.sequenceKey)) return 'incomparable-time'
    return positions.some(position => position.sequenceKey === time.sequenceKey && sequenceOrdinalV1(context, position.sequenceKey, position.unitKey) <= target) ? 'matched' : 'outside'
  }
  if (time.axis === 'acquired') {
    if (!record.time.acquiredAt) return 'unknown-time'
    if (time.mode === 'at') {
      const order = compareNarrativeTimeV1(record.time.acquiredAt, time.point, context)
      return order === 'equal' ? 'matched' : order === 'before' || order === 'after' ? 'outside' : order
    }
    return pointInInterval(record.time.acquiredAt, time.interval, context, true)
  }
  const interval = record.time[time.axis]
  if (!interval) return 'unknown-time'
  return time.mode === 'at' ? pointInInterval(time.point, interval, context, time.axis === 'occurred')
    : overlap(interval, time.interval, context, time.axis === 'occurred')
}
