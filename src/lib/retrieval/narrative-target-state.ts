import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { parseNarrativeDomainFieldV1 } from '../narrative-domain/codec'
import { portableNarrativeDomainFieldJsonV1 } from '../narrative-domain/references'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import type { RagAnnotationTargetSelectionV1, RagAnnotationTargetStateV1, RagDocumentPolicy } from '../types/rag-library'

/** Pure projection used only by ragSelection's explicit original read. The
 * caller must first locate this same row through its authorized Canon field.
 * Proposal fields remain hidden from ordinary Canon metadata and reads. */
export function deriveNarrativeTargetStateV1(selection: RagAnnotationTargetSelectionV1, row: Record<string, unknown>): RagAnnotationTargetStateV1 {
  const spec = REGISTRY_BY_NAME.get(selection.table)
  if (Object.keys(selection).sort().join(',') !== 'sourceUid,table'
    || !spec?.resourceIdentity || !spec.worldSemantic?.projector
    || !isPortableResourceUidV1(selection.sourceUid, spec.resourceIdentity.resourceKind)
    || row[spec.resourceIdentity.field] !== selection.sourceUid) throw new Error('注释目标没有登记身份或不属于所选来源')
  const policy = row.ragPolicy as RagDocumentPolicy | undefined
  if (policy?.enabled === false) throw new Error('目标资料已停用；未调用模型')
  const annotations: RagAnnotationTargetStateV1['annotations'] = {}
  for (const field of ['narrativeDevelopmentsV1', 'narrativeDisclosuresV1'] as const) {
    if (row[field] === undefined) continue
    if (!spec.worldSemantic.projector.annotationFields.includes(field)
      || !FIELD_BY_TARGET.get(selection.table)?.some(item => item.field === field && item.adoptionPolicy === 'narrative-annotation-v1')) {
      throw new Error('目标包含未登记的子记录注释')
    }
    if (policy?.fields?.[field]?.enabled === false) throw new Error('目标既有注释字段已停用；未调用模型')
    const decoded = parseNarrativeDomainFieldV1(field, row[field])
    Object.assign(annotations, { [field]: JSON.parse(portableNarrativeDomainFieldJsonV1(field, decoded)) })
  }
  return { version: 1, table: selection.table, sourceUid: selection.sourceUid, annotations }
}
