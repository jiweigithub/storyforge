import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { NARRATIVE_KINDS_V1, type SemanticKindV1, type VisibilityV1 } from '../types/narrative-ir'
import {
  NARRATIVE_SOURCE_FKS_V1, type NarrativeSourceFkV1, type NarrativeDomainSourceRefV1,
  type NarrativeDomainAtomRefV1, type NarrativeDomainValueV1, type NarrativeDomainTimePointV1,
  type NarrativeDomainIntervalV1, type NarrativeDomainTimeV1, type NarrativeDomainEvidenceV1,
  type NarrativeDomainDependencyV1, type NarrativeDomainAuthorityV1, type NarrativeDomainMetadataV1,
  type NarrativeDomainEventV1, type NarrativeDomainEpistemicV1, type NarrativeDomainDevelopmentV1,
  type NarrativeDomainDisclosureV1, type NarrativeDomainChronologyV1, type NarrativeDomainFieldsV1,
} from '../types/narrative-domain'
import {
  arrayV1, assertNarrativeJsonV1, canonicalNarrativeJsonV1, enumV1, hashV1, integerTextV1, keyV1, narrativeFail,
  nullableV1, objectV1, pointerV1, textV1, uintV1, uniqueKeysV1, type DecoderV1,
} from './json'

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const sourceFkKeys = Object.keys(NARRATIVE_SOURCE_FKS_V1) as NarrativeSourceFkV1[]
function keyedArray<T>(decoder: DecoderV1<T>, identity: (item: T) => string): DecoderV1<T[]> {
  return (value, path) => {
    const items = arrayV1(decoder)(value, path)
    if (new Set(items.map(identity)).size !== items.length) narrativeFail('duplicate', `${path} 包含重复身份`)
    return items
  }
}
const subKeyV1: DecoderV1<string> = (value, path) => {
  const key = keyV1(value, path)
  if (!/^sub:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    narrativeFail('subkey', `${path} 必须是持久子记录 UID`)
  }
  return key
}

/** Optional fields are absent, never undefined/null compatibility defaults. */
function optionalObject<T extends object>(required: Record<string, DecoderV1<unknown>>, optional: Record<string, DecoderV1<unknown>>): DecoderV1<T> {
  return (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) narrativeFail('shape', `${path} 必须是对象`)
    const row = value as Record<string, unknown>
    if (Object.keys(required).some(key => !hasOwn(row, key))
      || Object.keys(row).some(key => !hasOwn(required, key) && !hasOwn(optional, key))) {
      narrativeFail('exact-keys', `${path} 缺少字段或含额外字段`)
    }
    return Object.fromEntries(Object.keys(row).map(key => [key, (required[key] ?? optional[key])(row[key], `${path}.${key}`)])) as T
  }
}

const visibility: DecoderV1<VisibilityV1> = (value, path) => {
  const decoded = objectV1<VisibilityV1>({ class: enumV1(['public', 'restricted', 'author-only', 'unclassified'] as const),
    audienceKeys: uniqueKeysV1, policyVersion: keyV1 })(value, path)
  if (decoded.class === 'restricted' ? decoded.audienceKeys.length === 0 : decoded.audienceKeys.length !== 0) {
    narrativeFail('visibility', `${path} 分类与受众不一致`)
  }
  return decoded
}
const authority = objectV1<NarrativeDomainAuthorityV1>({ version: enumV1([1] as const), confirmationUid: keyV1,
  mode: enumV1(['author-declaration', 'candidate-adoption'] as const), confirmedAt: uintV1, contentHash: hashV1 })

function decoders(coordinate: 'local' | 'portable') {
  const source = <K extends NarrativeSourceFkV1>(allowed: readonly K[]): DecoderV1<NarrativeDomainSourceRefV1<K>> => (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) narrativeFail('source-ref', `${path} 不是分类型来源引用`)
    const fields = Object.keys(value), field = fields.find(key => allowed.includes(key as K)) as K | undefined
    if (!field || fields.length !== 2 || !fields.includes('sourceUid')) narrativeFail('source-ref', `${path} 必须且只能含一个登记 FK 和 sourceUid`)
    const row = value as Record<string, unknown>
    const uid = keyV1(row.sourceUid, `${path}.sourceUid`)
    if (!isPortableResourceUidV1(uid, NARRATIVE_SOURCE_FKS_V1[field].resourceKind)) narrativeFail('source-uid', `${path} UID 与 FK 来源不一致`)
    const id = row[field] === null ? null : uintV1(row[field], `${path}.${field}`)
    if (id !== null && coordinate === 'local' && id === 0) narrativeFail('source-ref', `${path} 本地主键必须为正整数`)
    return { [field]: id, sourceUid: uid } as NarrativeDomainSourceRefV1<K>
  }
  const anySource = source(sourceFkKeys)
  const entity = source(['characterId', 'locationId', 'codexEntryId', 'worldGroupId'])
  const atom = <K extends SemanticKindV1>(kinds: readonly K[]): DecoderV1<NarrativeDomainAtomRefV1<K>> => (value, path) => {
    const parsed = objectV1<NarrativeDomainAtomRefV1<K>>({ kind: enumV1(kinds), source: anySource,
      subKey: (key, at) => key === 'root' ? 'root' : subKeyV1(key, at) })(value, path)
    const fk = sourceFkKeys.find(key => key in parsed.source)!
    if (!(NARRATIVE_SOURCE_FKS_V1[fk].semanticKinds as readonly SemanticKindV1[]).includes(parsed.kind)) {
      narrativeFail('ref-kind', `${path} FK 目标不支持 ${parsed.kind}`)
    }
    if (parsed.kind === 'disclosure' && parsed.subKey === 'root') narrativeFail('subkey', `${path} 揭示标注需要稳定子记录身份`)
    return parsed
  }
  const anyAtom = atom(NARRATIVE_KINDS_V1), event = atom(['event']), assertion = atom(['assertion'])
  const typedValue: DecoderV1<NarrativeDomainValueV1> = (value, path) => {
    switch ((value as NarrativeDomainValueV1 | null)?.kind) {
      case 'boolean': return objectV1({ kind: enumV1(['boolean'] as const), value: (item, at) => {
        if (typeof item !== 'boolean') narrativeFail('shape', `${at} 必须是 boolean`)
        return item
      } })(value, path)
      case 'text': return objectV1({ kind: enumV1(['text'] as const), value: textV1 })(value, path)
      case 'enum': return objectV1({ kind: enumV1(['enum'] as const), value: keyV1 })(value, path)
      case 'decimal': return objectV1({ kind: enumV1(['decimal'] as const), unit: nullableV1(keyV1), value: (item, at) => {
        const text = textV1(item, at)
        if (!/^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/.test(text) || text === '-0') narrativeFail('decimal', `${at} 必须是规范十进制字符串`)
        return text
      } })(value, path)
      case 'entity-ref': return objectV1({ kind: enumV1(['entity-ref'] as const), value: entity })(value, path)
      case 'ordered-set': {
        const set = objectV1({ kind: enumV1(['ordered-set'] as const), values: arrayV1(typedValue) })(value, path)
        if (set.values.some(item => item.kind === 'ordered-set')) narrativeFail('value-depth', `${path} 不允许嵌套有序集合`)
        if (new Set(set.values.map(canonicalNarrativeJsonV1)).size !== set.values.length) narrativeFail('duplicate', `${path} 有序集合重复`)
        return set as NarrativeDomainValueV1
      }
      default: return narrativeFail('value-kind', `${path} 不支持的值类型`)
    }
  }
  const point: DecoderV1<NarrativeDomainTimePointV1> = (value, path) => {
    switch ((value as NarrativeDomainTimePointV1 | null)?.kind) {
      case 'tick': return objectV1({ kind: enumV1(['tick'] as const), timelineKey: keyV1, value: integerTextV1 })(value, path)
      case 'unknown': return objectV1({ kind: enumV1(['unknown'] as const), label: nullableV1(textV1) })(value, path)
      case 'event-anchor': return objectV1({ kind: enumV1(['event-anchor'] as const), event, side: enumV1(['before', 'at', 'after'] as const) })(value, path)
      default: return narrativeFail('time-point', `${path} 不支持的时间点`)
    }
  }
  const interval: DecoderV1<NarrativeDomainIntervalV1> = (value, path) => {
    const parsed = objectV1<NarrativeDomainIntervalV1>({ start: point, end: nullableV1(point), endMeaning: enumV1(['known', 'open', 'unknown'] as const) })(value, path)
    if ((parsed.endMeaning === 'known') !== (parsed.end !== null)) narrativeFail('time-interval', `${path} 终点含义不一致`)
    return parsed
  }
  const chapter = source(['chapterId'])
  const time = objectV1<NarrativeDomainTimeV1>({ occurred: nullableV1(interval), valid: nullableV1(interval), acquiredAt: nullableV1(point),
    narratedAt: nullableV1(objectV1({ chapter, spanStart: uintV1 })), disclosedAt: arrayV1(objectV1({ audienceKey: keyV1, chapter })) })
  const evidence = objectV1<NarrativeDomainEvidenceV1>({ evidenceKey: keyV1, source: (value, path) => {
    if (value && typeof value === 'object' && 'self' in value) return objectV1({ self: (item, at) => {
      if (item !== true) narrativeFail('source-ref', `${at} 必须为 true`)
      return true as const
    } })(value, path)
    return anySource(value, path)
  }, fieldPointer: pointerV1, sourceContentHash: hashV1, normalizationVersion: enumV1(['raw-utf8-v1'] as const),
  start: uintV1, end: uintV1, spanHash: hashV1, supportRole: enumV1(['supports', 'contradicts', 'context'] as const) })
  const dependency = objectV1<NarrativeDomainDependencyV1>({ target: anyAtom,
    role: enumV1(['supports', 'contradicts', 'derived-from', 'causes', 'requires'] as const), evidenceKeys: uniqueKeysV1 })
  const metadata: { [K in keyof Required<NarrativeDomainMetadataV1>]: DecoderV1<NonNullable<NarrativeDomainMetadataV1[K]>> } = {
    narrativeTimeV1: time, narrativeEvidenceV1: keyedArray(evidence, item => item.evidenceKey), narrativeVisibilityV1: visibility,
    narrativeModalityV1: enumV1(['established', 'belief', 'intent'] as const), narrativeDependenciesV1: arrayV1(dependency), narrativeAuthorityV1: authority,
  }
  const eventPayload: DecoderV1<NarrativeDomainEventV1> = (value, path) => {
    const parsed = objectV1<NarrativeDomainEventV1>({ eventType: enumV1(['action', 'observation', 'communication'] as const),
      participants: arrayV1(objectV1({ entity, role: keyV1 })), locations: arrayV1(source(['locationId'])),
      propositions: arrayV1(assertion), effects: arrayV1(anyAtom), before: arrayV1(event), observer: nullableV1(entity),
      communication: nullableV1(objectV1({ sender: entity, recipients: arrayV1(entity), channel: keyV1 })) })(value, path)
    if ((parsed.eventType === 'observation') !== (parsed.observer !== null)
      || (parsed.eventType === 'communication') !== (parsed.communication !== null)
      || parsed.communication?.recipients.length === 0) narrativeFail('event-variant', `${path} 观察/通信类型与字段不一致`)
    return parsed
  }
  const epistemic: DecoderV1<NarrativeDomainEpistemicV1> = (value, path) => {
    const parsed = objectV1<NarrativeDomainEpistemicV1>({ attitude: enumV1(['know', 'believe', 'doubt', 'unaware'] as const),
      transition: enumV1(['acquire', 'revise', 'forget', 'deny-awareness'] as const), assertedValue: typedValue,
      sourceEvent: nullableV1(event), revises: nullableV1(source(['knowledgeId'])) })(value, path)
    if ((parsed.transition === 'revise') !== (parsed.revises !== null)
      || (parsed.transition === 'deny-awareness' && parsed.attitude !== 'unaware')) narrativeFail('epistemic-transition', `${path} 认知修订结构不闭合`)
    return parsed
  }
  const { narrativeAuthorityV1: _parentAuthority, ...childMetadata } = metadata
  const development = optionalObject<NarrativeDomainDevelopmentV1>({ semanticSubKey: subKeyV1, statement: textV1,
    developmentType: enumV1(['thread', 'goal', 'conflict', 'commitment', 'foreshadow'] as const), owners: arrayV1(entity), members: arrayV1(anyAtom),
    state: enumV1(['open', 'advancing', 'blocked', 'resolved', 'fulfilled', 'abandoned'] as const), transitions: arrayV1(event), resolutionEvidenceKeys: uniqueKeysV1 }, childMetadata)
  const disclosure = optionalObject<NarrativeDomainDisclosureV1>({ semanticSubKey: subKeyV1,
    subjects: arrayV1(anyAtom), audienceKeys: uniqueKeysV1, evidenceKey: keyV1 }, childMetadata)
  const chronology = objectV1<NarrativeDomainChronologyV1>({
    timelines: keyedArray(objectV1({ timelineKey: keyV1, calendar: textV1, unit: keyV1, epoch: textV1 }), item => item.timelineKey),
    mappings: keyedArray(objectV1({ mappingKey: keyV1, targetWorldGroup: source(['worldGroupId']),
      fromTimelineKey: keyV1, toTimelineKey: keyV1, fromStart: integerTextV1, fromEnd: nullableV1(integerTextV1),
      numerator: integerTextV1, denominator: integerTextV1, offset: integerTextV1, evidenceKeys: uniqueKeysV1 }), item => item.mappingKey),
  })
  const fields: { [K in keyof Required<NarrativeDomainFieldsV1>]: DecoderV1<NonNullable<NarrativeDomainFieldsV1[K]>> } = {
    ...metadata, narrativeAliasesV1: uniqueKeysV1, narrativeEventV1: eventPayload,
    narrativeAssertionV1: objectV1({ polarity: enumV1(['positive', 'negative'] as const) }),
    narrativeRuleV1: objectV1({ preconditions: arrayV1(assertion) }),
    narrativeRelationV1: objectV1({ causeEvent: nullableV1(event) }), narrativeEpistemicV1: epistemic,
    narrativeDevelopmentsV1: keyedArray(development, item => item.semanticSubKey),
    narrativeDisclosuresV1: keyedArray(disclosure, item => item.semanticSubKey), narrativeChronologyV1: chronology,
  }
  return { fields, source: anySource }
}

const local = decoders('local'), portable = decoders('portable')
export type NarrativeDomainFieldV1 = keyof NarrativeDomainFieldsV1
export const NARRATIVE_DOMAIN_FIELDS_V1 = Object.freeze(Object.keys(local.fields) as NarrativeDomainFieldV1[])

/** Used by governed field adoption and the exact backup boundary. Permission,
 * source existence, review receipts and publishability are checked separately. */
export function parseNarrativeDomainFieldV1<K extends NarrativeDomainFieldV1>(
  field: K, value: unknown, coordinate: 'local' | 'portable' = 'local',
): NonNullable<NarrativeDomainFieldsV1[K]> {
  assertNarrativeJsonV1(value)
  const decoder = (coordinate === 'local' ? local : portable).fields[field]
  if (!decoder) narrativeFail('domain-field', `未登记叙事字段 ${field}`)
  return decoder(value, field) as NonNullable<NarrativeDomainFieldsV1[K]>
}
export function parseNarrativeDomainSourceRefV1(value: unknown, coordinate: 'local' | 'portable' = 'local'): NarrativeDomainSourceRefV1 {
  assertNarrativeJsonV1(value)
  return (coordinate === 'local' ? local : portable).source(value, 'source')
}

/** Only walk a field after exact decoding. No arbitrary JSON object can
 * smuggle a ref-shaped leaf past the typed domain boundary. */
export function mapNarrativeDomainReferencesV1<K extends NarrativeDomainFieldV1>(
  field: K, value: unknown, map: (source: NarrativeDomainSourceRefV1) => NarrativeDomainSourceRefV1,
  coordinate: 'local' | 'portable' = 'local',
): NonNullable<NarrativeDomainFieldsV1[K]> {
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk)
    if (!item || typeof item !== 'object') return item
    const row = item as Record<string, unknown>
    if (hasOwn(row, 'sourceUid')) return map(row as NarrativeDomainSourceRefV1)
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, walk(value)]))
  }
  return walk(parseNarrativeDomainFieldV1(field, value, coordinate)) as NonNullable<NarrativeDomainFieldsV1[K]>
}
