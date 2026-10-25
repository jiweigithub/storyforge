import type { WorldReleaseManifestV4 } from '../types/narrative-release'
import { WORLD_SEMANTIC_REGISTRY_V4 } from '../world-engine/semantic-registry-v4'
import { worldQueryFailV1 } from './world-query-contract'

/** Query metadata interpretation, independent of the immutable v4 IR compiler.
 * These labels are author directory metadata, never evidence or disclosure to
 * a reader, character or product. Only a verified manifest may enter here. */
export function frozenAuthorSourceTitlesV1(manifest: WorldReleaseManifestV4): ReadonlyMap<string, string> {
  const origins = new Set(manifest.narrative.bundle.records.map(record => record.provenance.sourceResourceKey))
  const titles = new Map<string, string>()
  for (const table of manifest.selectedTables) {
    const identity = WORLD_SEMANTIC_REGISTRY_V4.tables.find(spec => spec.name === table)?.resourceIdentity
    if (!identity) continue
    for (const row of manifest.records[table] ?? []) {
      const uid = row[identity.field]
      if (typeof uid !== 'string') continue
      const key = `${identity.contextKind}:${uid}`
      if (!origins.has(key)) continue
      // Fixed directory-label policy; no prose/summary or inferred fallback.
      const title = [row.name, row.title, row.label].find(value => typeof value === 'string' && value.trim())
      if (typeof title !== 'string') continue
      if (titles.has(key)) worldQueryFailV1('source-title', '冻结来源的目录身份重复')
      titles.set(key, title)
    }
  }
  return titles
}
