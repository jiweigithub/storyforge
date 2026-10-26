import {
  NARRATIVE_SOURCE_FKS_V1, type NarrativeDomainSourceRefV1, type NarrativeSourceFkV1,
} from '../types/narrative-domain'
import { canonicalNarrativeJsonV1, narrativeFail } from './json'
import {
  mapNarrativeDomainReferencesV1, parseNarrativeDomainFieldV1, type NarrativeDomainFieldV1,
} from './codec'

export function narrativeDomainReferenceTargetV1(source: NarrativeDomainSourceRefV1): {
  field: NarrativeSourceFkV1; table: string; id: number | null; sourceUid: string
} {
  const field = (Object.keys(NARRATIVE_SOURCE_FKS_V1) as NarrativeSourceFkV1[]).find(key => key in source)
  if (!field) narrativeFail('source-ref', '不是分类型来源引用')
  return { field, table: NARRATIVE_SOURCE_FKS_V1[field].table,
    id: (source as unknown as Record<string, number | null>)[field], sourceUid: source.sourceUid }
}

type IdMaps = ReadonlyMap<string, ReadonlyMap<number, number>>

/** Export keeps missing sources as explicit null-FK tombstones, retaining UID
 * and evidence bytes. Import never interprets an unresolved coordinate as a
 * local ID, and never silently drops the enclosing annotation. */
export function remapNarrativeDomainFieldV1(
  field: NarrativeDomainFieldV1, value: unknown, direction: 'export' | 'import', maps: IdMaps,
): unknown {
  const inputCoordinate = direction === 'export' ? 'local' : 'portable'
  const outputCoordinate = direction === 'export' ? 'portable' : 'local'
  const mapped = mapNarrativeDomainReferencesV1(field, value, source => {
    const target = narrativeDomainReferenceTargetV1(source)
    if (target.id === null) return source
    const id = maps.get(target.table)?.get(target.id)
    if (id === undefined && direction === 'import') {
      narrativeFail('unmapped-reference', `${field}.${target.field} 的便携坐标无法解析`)
    }
    return { [target.field]: id ?? null, sourceUid: target.sourceUid } as NarrativeDomainSourceRefV1
  }, inputCoordinate)
  return parseNarrativeDomainFieldV1(field, mapped, outputCoordinate)
}

/** Hashing physical IDs would invalidate author confirmation on a faithful
 * backup restore. Normalize only exact-decoded FK leaves to their source UID;
 * the resolver must still verify every physical ID/UID pair before compiling. */
export function portableNarrativeDomainFieldValueV1<K extends NarrativeDomainFieldV1>(field: K, value: unknown) {
  return mapNarrativeDomainReferencesV1(field, value, source => {
    const target = narrativeDomainReferenceTargetV1(source)
    return { [target.field]: null, sourceUid: target.sourceUid } as NarrativeDomainSourceRefV1
  })
}

/** Keep the existing canonical string interface for backup comparisons. */
export function portableNarrativeDomainFieldJsonV1(field: NarrativeDomainFieldV1, value: unknown): string {
  return canonicalNarrativeJsonV1(portableNarrativeDomainFieldValueV1(field, value))
}

/** An explicit entity merge changes the referenced UID as well as its FK.
 * That invalidates the old confirmation hash and requires author review.
 * Deletion retains the old UID/evidence and produces a source-missing marker. */
export function replaceNarrativeDomainReferenceV1(input: {
  field: NarrativeDomainFieldV1
  value: unknown
  table: string
  fromId: number
  fromUid: string
  replacement: { id: number; sourceUid: string } | null
}): { changed: boolean; value: unknown } {
  let changed = false
  const value = mapNarrativeDomainReferencesV1(input.field, input.value, source => {
    const target = narrativeDomainReferenceTargetV1(source)
    if (target.table !== input.table || target.id !== input.fromId) return source
    if (target.sourceUid !== input.fromUid) narrativeFail('reference-identity', '被替换 FK 与保留的 UID 不一致')
    changed = true
    return { [target.field]: input.replacement?.id ?? null,
      sourceUid: input.replacement?.sourceUid ?? target.sourceUid } as NarrativeDomainSourceRefV1
  })
  return { changed, value: parseNarrativeDomainFieldV1(input.field, value) }
}
