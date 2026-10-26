import Dexie from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { assertRecordInScope, resolveReadScope, scopeTransactionTables } from '../workspace/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import type { NarrativeOwnerV1 } from '../types/narrative-ir'
import type { NarrativeDomainRegistryV1 } from '../types/narrative-domain-registry'
import { currentNarrativeDomainRegistryV1, narrativeDomainTableV1 } from './narrative-domain-registry'
import type { NarrativeDomainFieldsV1 } from '../types/narrative-domain'
import { NARRATIVE_DOMAIN_FIELDS_V1, parseNarrativeDomainFieldV1 } from '../narrative-domain/codec'
import { portableNarrativeDomainFieldValueV1 } from '../narrative-domain/references'
import { compareUnicodeCodePointsV1, hashNarrativeValueV1, narrativeFail } from './narrative-json'
import { ownerDecoderV1 } from './narrative-identity'

export type NarrativeDomainRowV1 = Record<string, unknown> & NarrativeDomainFieldsV1
export interface NarrativeDomainCaptureV1 {
  scope: WorkspaceScope
  registry: NarrativeDomainRegistryV1
  owner: NarrativeOwnerV1
  /** All selected scope rows, captured in one IndexedDB read transaction. */
  rows: Map<string, NarrativeDomainRowV1[]>
  /** Peers retain UID collision evidence, including another Work in the project. */
  peers: Map<string, NarrativeDomainRowV1[]>
  worldCode: string
  workCode: string
}

export function narrativeDomainCaptureTablesV1() {
  return scopeTransactionTables(...PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.table))
}

function isWorldOwned(rows: ReadonlyMap<string, NarrativeDomainRowV1[]>, table: string, row: NarrativeDomainRowV1,
  registry: NarrativeDomainRegistryV1, visited = new Set<string>()): boolean {
  const locator = narrativeDomainTableV1(registry, table).domainOwner!.locator
  if (locator.kind === 'field') return locator.owner === 'world'
  if (locator.kind === 'exclusive-fields') return row[locator.worldField] != null && row[locator.workField] == null
  if (locator.kind !== 'parent') return false
  const key = `${table}:${row.id}`
  if (visited.has(key)) narrativeFail('owner-cycle', '来源 owner 存在循环')
  visited.add(key)
  const parent = rows.get(locator.table)?.find(item => item.id === row[locator.field])
  return !!parent && isWorldOwned(rows, locator.table, parent, registry, visited)
}

/** Reusable inside the author confirmation write transaction. Never allocate
 * source identities during a read or silently include another active Work. */
export async function captureNarrativeDomainInTransactionV1(input: {
  scope: WorkspaceScope; owner: NarrativeOwnerV1
}): Promise<NarrativeDomainCaptureV1> {
  const registry = currentNarrativeDomainRegistryV1()
  const scope = await Dexie.Promise.resolve(resolveReadScope({ scope: input.scope }))
  const owner = ownerDecoderV1(input.owner, 'owner')
  const world = (await db.worlds.get(scope.worldId))!, work = (await db.works.get(scope.workId))!
  if (owner.kind === 'work' ? owner.workCode !== work.code
    : owner.worldCode !== world.code || (owner.sourceWorkCode !== null && owner.sourceWorkCode !== work.code)) {
    narrativeFail('owner', '领域投影 owner/来源作品与当前作用域不一致')
  }
  const specs = PROJECT_TABLES.filter(spec => spec.worldSemantic)
  const captures = await Dexie.Promise.all(specs.map(spec => spec.table.where('projectId').equals(scope.projectId).toArray()
    .then(rows => ({ spec, rows: rows as NarrativeDomainRowV1[] }))))
  const peers = new Map(captures.map(({ spec, rows }) => [spec.name, rows]))
  const rows = new Map<string, NarrativeDomainRowV1[]>()
  for (const capture of captures) {
    const selected: NarrativeDomainRowV1[] = []
    for (const row of capture.rows) {
      if (owner.kind === 'world' && owner.sourceWorkCode === null && !isWorldOwned(peers, capture.spec.name, row, registry)) continue
      // Exclusive-owner sources are accepted only when their actual owner
      // resolves within the explicit scope; don't use an active-owner fallback.
      const locator = capture.spec.domainOwner?.locator
      const actualOwner = locator?.kind === 'exclusive-fields'
        ? row[locator.worldField] != null ? 'world' : 'work' : undefined
      if (await Dexie.Promise.resolve(assertRecordInScope(scope, capture.spec.name, row, { owner: actualOwner }))) selected.push(row)
    }
    rows.set(capture.spec.name, selected)
  }
  peers.set('worlds', await db.worlds.where('projectId').equals(scope.projectId).toArray() as unknown as NarrativeDomainRowV1[])
  peers.set('works', await db.works.where('projectId').equals(scope.projectId).toArray() as unknown as NarrativeDomainRowV1[])
  // Projection/confirmation validate the selected source and its references.
  // Peers are retained only for identity collisions; malformed annotations in
  // another Work must not make this Work unreadable. Full backup validation
  // still checks every captured row before export/import.
  return { scope, owner, rows, peers, registry, worldCode: world.code, workCode: work.code }
}

export async function captureNarrativeDomainV1(input: {
  scope: WorkspaceScope; owner: NarrativeOwnerV1
}): Promise<NarrativeDomainCaptureV1> {
  return db.transaction('r', narrativeDomainCaptureTablesV1(), async () => await Dexie.Promise.resolve(captureNarrativeDomainInTransactionV1(input)))
}

function stableOwner(capture: NarrativeDomainCaptureV1, table: string, row: NarrativeDomainRowV1): unknown {
  if (isWorldOwned(capture.peers, table, row, capture.registry)) return { worldCode: capture.worldCode }
  return { workCode: capture.workCode }
}

export function resolveNarrativeDomainGroupV1(capture: NarrativeDomainCaptureV1, table: string,
  row: NarrativeDomainRowV1): NarrativeDomainRowV1 | null {
  const spec = narrativeDomainTableV1(capture.registry, table)
  if (spec.resourceIdentity?.narrativeEntityType === 'world-group') return row
  const field = spec.homeWorldScoped ? 'homeWorldGroupId' : spec.worldScoped ? 'worldGroupId' : null
  if ((row.worldGroupId != null && field !== 'worldGroupId') || (row.homeWorldGroupId != null && field !== 'homeWorldGroupId')) {
    narrativeFail('domain-field', `${table} 子世界字段未由注册表声明`)
  }
  if (!field || row[field] == null) return null
  const group = capture.rows.get('worldGroups')?.find(item => item.id === row[field])
  if (!group || typeof group.ragDocumentId !== 'string') narrativeFail('source-uid', '所属子世界缺少同作用域稳定身份')
  return group
}

/** A source revision commits only registered business fields and typed
 * annotations. Physical IDs become source UIDs; unrelated UI timestamps and
 * candidate confidence cannot invalidate or grant semantic authority. */
export async function hashNarrativeDomainSourceV1(capture: NarrativeDomainCaptureV1, table: string, row: NarrativeDomainRowV1): Promise<string> {
  const spec = narrativeDomainTableV1(capture.registry, table), projector = spec.worldSemantic?.projector
  if (!projector || !spec.resourceIdentity) narrativeFail('projector', `${table} 未登记叙事投影`)
  const business: Record<string, unknown> = {}
  for (const field of projector.sourceFields) {
    const foreignKey = spec.exportRemap?.find(remap => remap.field === field)
    if (row[field] === undefined && !foreignKey) continue
    // The registered backup codec restores absent optional FK fields as null.
    // Both mean no reference; that faithful round trip must preserve approval.
    if (foreignKey && row[field] == null) business[field] = null
    else if (foreignKey) {
      const targetSpec = narrativeDomainTableV1(capture.registry, foreignKey.remapVia)
      const target = capture.rows.get(targetSpec.name)?.find(record => record.id === row[field])
      if (targetSpec.resourceIdentity) business[field] = { sourceUid: target?.[targetSpec.resourceIdentity.field] ?? null }
      // Structural chapters/outline coordinates also have resource identity.
      // Never introduce a numeric fallback into a portable revision.
      else narrativeFail('source-uid', `${table}.${field} 目标没有稳定资源身份`)
    } else business[field] = row[field]
  }
  const annotations: Record<string, unknown> = {}
  for (const field of NARRATIVE_DOMAIN_FIELDS_V1) {
    if (row[field] === undefined) continue
    if (!projector.annotationFields.includes(field)) narrativeFail('domain-field', `${table}.${field} 未登记`)
    if (field === 'narrativeAuthorityV1') {
      parseNarrativeDomainFieldV1(field, row[field])
      continue
    }
    // The normalizer exact-decodes into private data. Hash the value directly;
    // a canonical string followed by JSON.parse adds no validation or meaning.
    // Subrecords have persistent keys; array reorder isn't an identity edit.
    // Preserve ordered payload arrays within each item.
    if (field === 'narrativeDevelopmentsV1' || field === 'narrativeDisclosuresV1') {
      const normalized = portableNarrativeDomainFieldValueV1(field, row[field])
      normalized.sort((a, b) => compareUnicodeCodePointsV1(a.semanticSubKey, b.semanticSubKey))
      annotations[field] = normalized
    } else annotations[field] = portableNarrativeDomainFieldValueV1(field, row[field])
  }
  const worldGroup = resolveNarrativeDomainGroupV1(capture, table, row)?.ragDocumentId ?? null
  return hashNarrativeValueV1({ version: 1, table, sourceUid: row[spec.resourceIdentity.field] ?? null,
    owner: stableOwner(capture, table, row), worldGroup, business, annotations })
}
