/** NW-1A: wire types, independent of author timestamps and database IDs. */
export type TimePointV1 =
  | { kind: 'tick'; timelineKey: string; value: string }
  | { kind: 'event-anchor'; eventKey: string; side: 'before' | 'at' | 'after' }
  | { kind: 'unknown'; label: string | null }

export interface IntervalV1 {
  start: TimePointV1
  end: TimePointV1 | null
  endMeaning: 'known' | 'open' | 'unknown'
}

export interface NarrativeTimeV1 {
  occurred: IntervalV1 | null
  valid: IntervalV1 | null
  narratedAt: { sequenceKey: string; unitKey: string; spanStart: number } | null
  disclosedAt: Array<{ audienceKey: string; sequenceKey: string; unitKey: string }>
  acquiredAt: TimePointV1 | null
}

export interface NarrativeTimelineV1 {
  timelineKey: string
  worldKey: string
  branchKey: string
  calendar: string
  unit: string
  epoch: string
}

export interface NarrativeSequenceV1 {
  sequenceKey: string
  ownerKey: string
  revision: string
  units: Array<{ unitKey: string; ordinal: number }>
}

/** Explicit directed, bounded, author-confirmed affine map. No inversion or
 * inferred mapping chains. Nonintegral images remain incomparable. */
export interface NarrativeTimeMappingV1 {
  mappingKey: string
  revision: string
  fromTimelineKey: string
  toTimelineKey: string
  fromStart: string
  fromEnd: string | null
  numerator: string
  denominator: string
  offset: string
  evidenceIds: string[]
  confirmationRef: string
}

export interface NarrativeTimeContextV1 {
  version: 1
  timelines: NarrativeTimelineV1[]
  sequences: NarrativeSequenceV1[]
  anchors: Array<{ eventKey: string; timelineKey: string; value: string | null }>
  before: Array<{ beforeEventKey: string; afterEventKey: string }>
  mappings: NarrativeTimeMappingV1[]
}

export type NarrativeTimeComparisonV1 = 'before' | 'equal' | 'after' | 'unknown-time' | 'incomparable-time'
