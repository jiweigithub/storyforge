import type { NarrativeDomainRegistryV1 } from '../types/narrative-domain-registry'
import { currentNarrativeDomainRegistryV1, narrativeDomainTableV1 } from './narrative-domain-registry'
import type { NarrativeDomainEvidenceV1, NarrativeDomainSourceRefV1 } from '../types/narrative-domain'
import type { NarrativeEvidenceSourceV1, EvidenceSpanV1, VisibilityV1 } from '../types/narrative-ir'
import type { NarrativeDomainCaptureV1, NarrativeDomainRowV1 } from './narrative-domain-capture'
import { narrativeDomainReferenceTargetV1 } from '../narrative-domain/references'
import { hashNarrativeBytesV1, narrativeFail, pointerV1 } from './narrative-json'
import { verifyNarrativeEvidenceV1 } from './narrative-ir'
import { intersectNarrativeVisibilityV1 } from '../narrative-domain/visibility'

/** Logical field pointer into a keyed subrecord, never an array position. The
 * resolver returns the exact stored statement bytes without normalization. */
export function narrativeDevelopmentStatementPointerV1(subKey: string): string {
  return `/narrativeDevelopmentsV1/${subKey.replace(/~/g, '~0').replace(/\//g, '~1')}/statement`
}

function developmentAtPointer(table: string, row: NarrativeDomainRowV1, parts: string[], registry: NarrativeDomainRegistryV1) {
  if (parts[0] !== 'narrativeDevelopmentsV1') return null
  if (!narrativeDomainTableV1(registry, table).worldSemantic?.projector?.annotationFields.includes(parts[0])
    || parts.length !== 3 || parts[2] !== 'statement') narrativeFail('evidence-field', '发展原文必须以持久子记录键定位 statement')
  const matches = row.narrativeDevelopmentsV1?.filter(item => item.semanticSubKey === parts[1]) ?? []
  if (matches.length !== 1) narrativeFail('evidence-source', '发展原文子记录不存在或身份重复')
  return matches[0]
}

export function narrativeDomainEvidenceVisibilityV1(table: string, row: NarrativeDomainRowV1, fieldPointer: string, registry = currentNarrativeDomainRegistryV1()): VisibilityV1 {
  const parts = fieldPointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  const child = developmentAtPointer(table, row, parts, registry)
  const parent = row.narrativeVisibilityV1 ?? { class: 'unclassified' as const, audienceKeys: [], policyVersion: 'unclassified-v1' }
  return child?.narrativeVisibilityV1 ? intersectNarrativeVisibilityV1(parent, [child.narrativeVisibilityV1]) : parent
}

// Identity-only acceleration, never a semantic/authority receipt. A cached
// array and every row must be frozen with own scalar data properties; a plain
// frozen container with mutable rows or accessors cannot use this index.
// Resolve against the capture's current arrays on every call, so replacing a
// selected/peer array or changing the registry field cannot reuse old counts.
type FrozenIdentityIndex = {
  field: string; byId: Map<number, NarrativeDomainRowV1>; uidCounts: Map<string, number>
}
const frozenIdentityIndexes = new WeakMap<NarrativeDomainRowV1[], FrozenIdentityIndex>()
function frozenIdentityIndex(rows: NarrativeDomainRowV1[] | undefined, field: string): FrozenIdentityIndex | null {
  if (!rows || !Object.isFrozen(rows)) return null
  const cached = frozenIdentityIndexes.get(rows)
  if (cached?.field === field) return cached
  const byId = new Map<number, NarrativeDomainRowV1>(), uidCounts = new Map<string, number>()
  for (let at = 0; at < rows.length; at++) {
    const entry = Object.getOwnPropertyDescriptor(rows, at)
    if (!entry || !('value' in entry)) return null
    const row: NarrativeDomainRowV1 = entry.value
    if (!row || typeof row !== 'object' || !Object.isFrozen(row)) return null
    const id = Object.getOwnPropertyDescriptor(row, 'id'), uid = Object.getOwnPropertyDescriptor(row, field)
    if (!id || !('value' in id) || !Number.isSafeInteger(id.value)
      || !uid || !('value' in uid) || typeof uid.value !== 'string') return null
    // Preserve find()'s first-match behavior even on malformed duplicate IDs.
    if (!byId.has(id.value)) byId.set(id.value, row)
    const key = uid.value.toLowerCase()
    uidCounts.set(key, (uidCounts.get(key) ?? 0) + 1)
  }
  const index = { field, byId, uidCounts }
  frozenIdentityIndexes.set(rows, index)
  return index
}

export function resolveNarrativeDomainReferenceV1(capture: NarrativeDomainCaptureV1, reference: NarrativeDomainSourceRefV1): {
  table: string; row: NarrativeDomainRowV1
} {
  const target = narrativeDomainReferenceTargetV1(reference)
  const spec = narrativeDomainTableV1(capture.registry, target.table)
  const field = spec.resourceIdentity!.field, rows = capture.rows.get(target.table)
  const selectedIndex = frozenIdentityIndex(rows, field)
  const row = selectedIndex ? target.id === null ? undefined : selectedIndex.byId.get(target.id)
    : rows?.find(record => record.id === target.id)
  if (!row || row[spec.resourceIdentity!.field] !== target.sourceUid) narrativeFail('source-missing', '来源已删除、身份变化或不在选定作用域')
  const peers = capture.peers.get(target.table), peerIndex = frozenIdentityIndex(peers, field)
  const key = target.sourceUid.toLowerCase()
  let count = peerIndex?.uidCounts.get(key) ?? 0
  if (!peerIndex) for (const peer of peers ?? []) if (String(peer[field]).toLowerCase() === key) count++
  if (count !== 1) narrativeFail('duplicate-uid', '来源 UID 不唯一')
  return { table: target.table, row }
}

export function readNarrativeDomainEvidenceTextV1(table: string, row: NarrativeDomainRowV1, fieldPointer: string, registry = currentNarrativeDomainRegistryV1()): string {
  pointerV1(fieldPointer, 'fieldPointer')
  const parts = fieldPointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  const development = developmentAtPointer(table, row, parts, registry)
  if (development) return development.statement
  const spec = narrativeDomainTableV1(registry, table)
  if (!spec?.worldSemantic || !(spec.worldSemantic.projector?.sourceFields.includes(parts[0])
    || registry.evidenceFields[table]?.includes(parts[0]))) narrativeFail('evidence-field', `${table}${fieldPointer} 未登记为证据来源`)
  let value: unknown = row
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) {
      narrativeFail('evidence-source', '来源字段不存在')
    }
    value = (value as Record<string, unknown>)[part]
  }
  if (typeof value !== 'string' || !value.length) narrativeFail('evidence-source', '来源必须是非空原始文本')
  return value
}

export async function narrativeDomainEvidenceSourceV1(table: string, row: NarrativeDomainRowV1, fieldPointer: string, registry = currentNarrativeDomainRegistryV1()): Promise<NarrativeEvidenceSourceV1> {
  const spec = narrativeDomainTableV1(registry, table)
  const text = readNarrativeDomainEvidenceTextV1(table, row, fieldPointer, registry)
  const sourceUid = row[spec.resourceIdentity!.field]
  if (typeof sourceUid !== 'string') narrativeFail('source-uid', '来源缺少稳定 UID')
  return { sourceResourceKey: `${spec.resourceIdentity!.contextKind}:${sourceUid}`, fieldPointer,
    sourceRevision: await hashNarrativeBytesV1(text), text }
}

export async function compileNarrativeDomainEvidenceV1(capture: NarrativeDomainCaptureV1, table: string, row: NarrativeDomainRowV1,
  annotation: NarrativeDomainEvidenceV1, evidenceId: string): Promise<{ evidence: EvidenceSpanV1; source: NarrativeEvidenceSourceV1 }> {
  const target = 'self' in annotation.source ? { table, row } : resolveNarrativeDomainReferenceV1(capture, annotation.source)
  const source = await narrativeDomainEvidenceSourceV1(target.table, target.row, annotation.fieldPointer, capture.registry)
  const evidence: EvidenceSpanV1 = { evidenceId, sourceResourceKey: source.sourceResourceKey,
    fieldPointer: source.fieldPointer, sourceRevision: source.sourceRevision,
    sourceContentHash: annotation.sourceContentHash, normalizationVersion: annotation.normalizationVersion,
    start: annotation.start, end: annotation.end, spanHash: annotation.spanHash, supportRole: annotation.supportRole }
  await verifyNarrativeEvidenceV1(evidence, source)
  return { evidence, source }
}
