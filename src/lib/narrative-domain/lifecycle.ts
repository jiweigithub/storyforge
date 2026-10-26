import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../registry/project-tables'
import { replaceNarrativeDomainReferenceV1 } from './references'
import { narrativeFail } from './json'

/** Called inside the existing registered deletion/merge transaction. The
 * evidence and old UID stay present after deletion. Reviewed identities cannot
 * use automatic merge without an explicit identity-alias receipt. */
export async function remapNarrativeDomainReferencesV1(input: {
  table: string; fromId: number; toId?: number
}): Promise<number> {
  const holders = PROJECT_TABLES.filter(spec => spec.refs?.some(ref =>
    ref.kind === 'narrative-source-refs-v1' && ref.targetTables.includes(input.table)))
  if (!holders.length) return 0
  const source = REGISTRY_BY_NAME.get(input.table)!
  const from = await source.table.get(input.fromId) as Record<string, unknown> | undefined
  if (!from) return 0
  const to = input.toId === undefined ? undefined : await source.table.get(input.toId) as Record<string, unknown> | undefined
  if (input.toId !== undefined && (!to || to.projectId !== from.projectId)) {
    narrativeFail('scope', '合并目标不存在或不属于当前项目')
  }
  if (to) {
    if (from.id === to.id) narrativeFail('merge', '合并来源和目标不能相同')
    const locator = source.domainOwner?.locator
    const fields = locator?.kind === 'field' ? [locator.field]
      : locator?.kind === 'exclusive-fields' ? [locator.worldField, locator.workField] : []
    if (!fields.length || fields.some(field => (from[field] ?? null) !== (to[field] ?? null))) {
      narrativeFail('scope', '不能跨 World/Work owner 合并叙事身份')
    }
    if (from.narrativeAuthorityV1 || to.narrativeAuthorityV1) {
      narrativeFail('merge-review', '已确认叙事身份需要显式 alias 与作者合并回执；自动合并不修改来源')
    }
  }
  const identity = source.resourceIdentity!.field
  let touched = 0
  for (const holder of holders) {
    const rows = await holder.table.where('projectId').equals(from.projectId as number).toArray() as Record<string, unknown>[]
    for (const row of rows) {
      const patch: Record<string, unknown> = {}
      for (const ref of holder.refs ?? []) {
        if (ref.kind !== 'narrative-source-refs-v1' || !ref.targetTables.includes(input.table)
          || !Object.prototype.hasOwnProperty.call(row, ref.field)) continue
        const replacement = to ? { id: input.toId!, sourceUid: String(to[identity] ?? '') } : null
        const mapped = replaceNarrativeDomainReferenceV1({
          field: ref.field, value: row[ref.field], table: input.table,
          fromId: input.fromId, fromUid: String(from[identity] ?? ''), replacement,
        })
        if (mapped.changed) patch[ref.field] = mapped.value
      }
      if (Object.keys(patch).length) {
        if (to && row.narrativeAuthorityV1) {
          narrativeFail('merge-review', '合并会改变已确认注释的来源身份，需要作者审阅；保留旧来源及证据')
        }
        // Preserve receipt and raw evidence for audit. Projection rechecks FK
        // existence and the portable content hash, so neither stays effective.
        await holder.table.update(row.id as number, { ...patch, updatedAt: Date.now() })
        touched++
      }
    }
  }
  return touched
}
