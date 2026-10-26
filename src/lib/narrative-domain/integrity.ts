import { PROJECT_TABLES } from '../registry/project-tables'
import type { TableSpec } from '../registry/types'
import { mapNarrativeDomainReferencesV1, NARRATIVE_DOMAIN_FIELDS_V1 } from './codec'
import { narrativeDomainReferenceTargetV1 } from './references'
import { narrativeFail } from './json'

type Row = Record<string, unknown>
type Rows = ReadonlyMap<string, readonly Row[]>
type IdentitySpec = Pick<TableSpec, 'name' | 'domainOwner' | 'resourceIdentity' | 'exportIdField' | 'exportRemap' | 'worldSemantic'>

/** Validate identities against the same immutable capture used for export or
 * import. Numeric coordinates never establish identity on their own. Missing
 * local sources become tombstones on export; missing portable targets abort. */
export function assertNarrativeDomainReferenceRowsV1(rows: Rows, coordinate: 'local' | 'portable', specs: readonly IdentitySpec[] = PROJECT_TABLES): void {
  const byTable = new Map(specs.map(spec => [spec.name, spec]))
  const byId = new Map<string, Map<number, Row>>()
  const counts = new Map<string, Map<string, number>>()
  for (const spec of specs) {
    const ids = new Map<number, Row>(), uids = new Map<string, number>()
    for (const [index, row] of (rows.get(spec.name) ?? []).entries()) {
      const id = coordinate === 'local' ? row.id : spec.exportIdField ? row._exportId : index
      if (typeof id === 'number') ids.set(id, row)
      const uid = spec.resourceIdentity && row[spec.resourceIdentity.field]
      if (typeof uid === 'string') uids.set(uid.toLowerCase(), (uids.get(uid.toLowerCase()) ?? 0) + 1)
    }
    byId.set(spec.name, ids); counts.set(spec.name, uids)
  }
  const fk = (spec: IdentitySpec, row: Row, field: string): unknown => coordinate === 'local' ? row[field]
    : row[spec.exportRemap?.find(remap => remap.field === field)?.exportAs ?? field]
  const owner = (spec: IdentitySpec, row: Row, seen = new Set<string>()): { world?: unknown; work?: unknown } => {
    const locator = spec.domainOwner?.locator
    if (!locator || locator.kind === 'workspace') return {}
    const token = `${spec.name}:${coordinate === 'local' ? row.id : row._exportId}`
    if (seen.has(token)) narrativeFail('owner-cycle', '叙事来源 owner 存在循环')
    seen.add(token)
    if (locator.kind === 'parent') {
      const parent = byTable.get(locator.table)!
      const record = byId.get(parent.name)?.get(fk(spec, row, locator.field) as number)
      return record ? owner(parent, record, seen) : {}
    }
    const workField = locator.kind === 'field' && locator.owner === 'work' ? locator.field
      : locator.kind === 'exclusive-fields' || locator.kind === 'exclusive-work-instance' ? locator.workField : null
    const worldField = locator.kind === 'field' && locator.owner === 'world' ? locator.field
      : locator.kind === 'exclusive-fields' ? locator.worldField : null
    const work = coordinate === 'portable' ? row._workOwnerExportId ?? (workField ? fk(spec, row, workField) : undefined)
      : workField ? row[workField] : undefined
    const explicitWorld = coordinate === 'portable' ? row._worldOwnerExportId ?? (worldField ? fk(spec, row, worldField) : undefined)
      : worldField ? row[worldField] : undefined
    const workRow = typeof work === 'number' ? byId.get('works')?.get(work) : undefined
    const world = explicitWorld ?? (workRow && (coordinate === 'local' ? workRow.worldId : workRow._worldExportId))
    return { work, world }
  }
  for (const spec of specs) for (const row of rows.get(spec.name) ?? []) {
    const allowed = spec.worldSemantic?.projector?.annotationFields ?? []
    for (const field of NARRATIVE_DOMAIN_FIELDS_V1) {
      const key = coordinate === 'local' ? field : `_${field}Portable`
      if (!Object.prototype.hasOwnProperty.call(row, key)) continue
      if (!allowed.includes(field)) narrativeFail('domain-field', `${spec.name}.${field} 未登记`)
      mapNarrativeDomainReferencesV1(field, row[key], source => {
        const target = narrativeDomainReferenceTargetV1(source)
        if (target.id === null) return source
        const record = byId.get(target.table)?.get(target.id)
        if (!record) {
          if (coordinate === 'portable') narrativeFail('source-missing', `${spec.name}.${field} 便携来源不存在`)
          return source
        }
        const targetSpec = byTable.get(target.table)!
        if (record[targetSpec.resourceIdentity!.field] !== target.sourceUid
          || counts.get(target.table)?.get(target.sourceUid.toLowerCase()) !== 1) {
          narrativeFail('reference-identity', `${spec.name}.${field} 的来源 UID 与编号不一致或不唯一`)
        }
        const from = owner(spec, row), to = owner(targetSpec, record)
        if ((coordinate === 'local' && row.projectId !== record.projectId)
          || from.world == null || to.world == null || from.world !== to.world
          || (from.work != null && to.work != null && from.work !== to.work)) {
          narrativeFail('scope', `${spec.name}.${field} 不允许跨 World/Work 引用`)
        }
        return source
      }, coordinate)
    }
  }
}
