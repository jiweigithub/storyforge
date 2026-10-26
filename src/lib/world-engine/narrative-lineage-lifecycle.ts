import { canonicalNarrativeJsonV1 } from './narrative-json'
import { verifyNarrativeLineageV1 } from './narrative-lineage'

/** Portable lineage has no local FK inside its JSON. Validate the outer World
 * owner and immutable hash before import writes anything or export succeeds. */
export async function assertNarrativeLineageRowsV1(rows: ReadonlyMap<string, readonly Record<string, unknown>[]>, coordinate: 'local' | 'portable'): Promise<void> {
  const worlds = new Map((rows.get('worlds') ?? []).map(row => [coordinate === 'local' ? row.id : row._exportId, row]))
  const seen = new Set<unknown>()
  for (const row of rows.get('worldDerivations') ?? []) {
    if (row.narrativeLineageJson === undefined) continue
    if (typeof row.narrativeLineageJson !== 'string') throw Error('[lineage] 派生回执必须是规范 JSON')
    const worldId = coordinate === 'local' ? row.worldId : row._worldExportId, world = worlds.get(worldId)
    if (!world || seen.has(worldId) || (coordinate === 'local' && row.projectId !== world.projectId)) throw Error('[lineage] 派生来源重复、跨工作区或缺少 World')
    const lineage = await verifyNarrativeLineageV1(JSON.parse(row.narrativeLineageJson), String(world.code))
    if (canonicalNarrativeJsonV1(lineage) !== row.narrativeLineageJson || lineage.sourceContentHash !== row.sourceContentHash
      || lineage.sourceWorkspaceUid !== row.sourceWorkspaceUid
      || (lineage.kind === 'world-copy' ? row.sourceKind !== 'world-release-copy' : !['long-novel', 'short-novel'].includes(String(row.sourceKind)))
      || (lineage.sourceOwner.kind === 'work' && lineage.sourceOwner.workCode !== row.sourceWorkCode)) throw Error('[lineage] 派生回执与外层来源不一致')
    seen.add(worldId)
  }
}
