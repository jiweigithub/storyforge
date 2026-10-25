import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import type { WorkspaceScope } from '../types/world-ownership'
import type { NarrativeRecordV1 } from '../types/narrative-ir'
import { captureNarrativeDomainV1, resolveNarrativeDomainGroupV1 } from './narrative-domain-capture'
import { projectNarrativeDomainCaptureV1 } from './narrative-domain-projection'
import { canonicalNarrativeJsonV1, compareUnicodeCodePointsV1, narrativeFail } from './narrative-json'

const KIND_LABELS: Record<NarrativeRecordV1['kind'], string> = {
  entity: '实体', event: '事件', assertion: '断言', relation: '关系', rule: '规则',
  'epistemic-event': '角色认知', development: '发展与承诺', disclosure: '叙述揭示',
}
const MODALITY_LABELS: Record<NarrativeRecordV1['modality'], string> = {
  established: '已确立', belief: '角色信念，不代表客观事实', intent: '作者意图，尚未兑现', hypothesis: '假设',
}

/** Authoring-only extension of the existing canonAssertions source. It reads
 * current reviewed domain data for one explicit Work/World scope, never a
 * product runtime. Product POV/permission reads remain on frozen WorldRelease.
 * No row limit or silent source expansion: assembly owns the final budget. */
export async function readNarrativeCanonContextV1(input: {
  scope: WorkspaceScope
  worldGroupId?: number | null
}): Promise<string> {
  const work = await db.works.get(input.scope.workId)
  if (!work) narrativeFail('owner', '叙事上下文的作品不存在')
  const capture = await captureNarrativeDomainV1({ scope: input.scope, owner: { kind: 'work', workCode: work.code } })
  const selectedSourceKeys: string[] = []
  for (const spec of PROJECT_TABLES) {
    if (!spec.worldSemantic?.projector || !spec.resourceIdentity) continue
    for (const row of capture.rows.get(spec.name) ?? []) {
      if (!row.narrativeAuthorityV1) continue
      const group = resolveNarrativeDomainGroupV1(capture, spec.name, row)
      if (input.worldGroupId !== undefined && group && group.id !== input.worldGroupId) continue
      const uid = row[spec.resourceIdentity.field]
      if (!isPortableResourceUidV1(uid, spec.resourceIdentity.resourceKind)) {
        narrativeFail('source-uid', '已确认的叙事来源缺少稳定身份，请先修复来源')
      }
      selectedSourceKeys.push(`${spec.resourceIdentity.contextKind}:${uid}`)
    }
  }
  if (!selectedSourceKeys.length) return ''
  const projection = await projectNarrativeDomainCaptureV1(capture, { branchKey: 'canon', selectedSourceKeys })
  const records = projection.bundle.records
  // Local labels only compress repeated references in this one context block.
  // Persistent identity and evidence remain in the verified projection; these
  // labels are never accepted as adoption targets or saved back to domain rows.
  const labels = new Map(records.map((record, index) => [record.semanticId, `#${index + 1}`]))
  function readableReferences(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(readableReferences)
    if (!value || typeof value !== 'object') return value
    const object = value as Record<string, unknown>
    if (typeof object.semanticId === 'string' && typeof object.revisionHash === 'string') {
      return labels.get(object.semanticId) ?? narrativeFail('dependency-gap', '上下文引用未纳入同一投影')
    }
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, readableReferences(item)]))
  }
  function describe(record: NarrativeRecordV1): string {
    const time = Object.fromEntries(Object.entries(record.time).filter(([, value]) => value !== null && (!Array.isArray(value) || value.length)))
    const prose = ['event', 'development'].includes(record.kind)
      ? projection.sources.find(source => source.sourceResourceKey === record.provenance.sourceResourceKey
        && source.sourceRevision === record.provenance.sourceRevision && source.fieldPointer === record.provenance.sourceField)?.text
      : undefined
    return `${labels.get(record.semanticId)} ${KIND_LABELS[record.kind]}｜${MODALITY_LABELS[record.modality]}｜${record.reviewState === 'historical' ? '历史状态' : '有效确认'}\n${canonicalNarrativeJsonV1({
      ...(prose ? { 原文: prose } : {}), 内容: readableReferences(record.payload),
      ...(Object.keys(time).length ? { 时间: time } : {}),
      可见范围: record.visibility.class, 受众: record.visibility.audienceKeys,
      ...(record.dependencies.length ? { 依赖: record.dependencies.map(item => ({ 引用: labels.get(item.semanticId), 关系: item.role })) } : {}),
    })}`
  }
  const gaps = projection.coverage.gaps.map(gap => ({ sourceKey: gap.sourceKey, code: gap.code }))
    .sort((a, b) => compareUnicodeCodePointsV1(canonicalNarrativeJsonV1(a), canonicalNarrativeJsonV1(b)))
  return [
    '【作者已确认的叙事注释】',
    '本段用于作者创作。信念不等于事实，计划不等于已发生，历史状态不等于当前状态；角色可知范围仍须另行约束。',
    `内容版本：${projection.bundle.semanticRootHash}`,
    ...records.map(describe),
    ...(gaps.length ? [`以下来源尚未成为可用注释，不得据此补造事实：${canonicalNarrativeJsonV1(gaps)}`] : []),
  ].join('\n')
}
