/** Isolated evaluation harness. Synthetic seeding is not an author publish
 * flow; export/import and query use the real production entry points. */
import { narrativeSha256StatusV1 } from '../../src/lib/narrative-domain/sha256'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { buildNarrativeScaleInputV1 } from './narrative-scale-fixture'
import { buildNarrativeScaleInputV2 } from './narrative-scale-v2-fixture'
import { compileWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { worldReleaseUidV1 } from '../../src/lib/world-engine/releases'
import { createWorldPackage, importWorldPackage } from '../../src/lib/world-engine/world-package'
import { clearWorldNarrativeIndexCachesV1 } from '../../src/lib/world-engine/narrative-index-cache'
import { openAuthorWorldQueryAccessV1, authorWorldQueryV1, queryWorldReleaseV1 } from '../../src/lib/context-gateway/world-query-client'
import type { WorldReleaseCompiledV4 } from '../../src/lib/types/narrative-release'
import type { WorldQueryAccessV1 } from '../../src/lib/types/world-query'

let fixture: Awaited<ReturnType<typeof buildNarrativeScaleInputV1>> | null = null
let compiled: WorldReleaseCompiledV4 | null = null
let access: WorldQueryAccessV1 | null = null

export async function prepareScaleV1(size: number) {
  return prepareScale(size, buildNarrativeScaleInputV1)
}
export async function prepareScaleV2(size: number) {
  return prepareScale(size, buildNarrativeScaleInputV2)
}
async function prepareScale(size: number, build: typeof buildNarrativeScaleInputV1) {
  if (await db.projects.count()) throw Error('Scale harness requires an empty isolated browser context')
  const start = performance.now()
  fixture = await build(size)
  return { stats: fixture.stats, needles: fixture.needles, generationMs: performance.now() - start,
    compilerVersion: fixture.input.compilerVersion, inputHash: await hashNarrativeBytesV1(canonicalNarrativeJsonV1(fixture.input)) }
}
export async function compileScaleV1() {
  if (!fixture) throw Error('Scale input is absent')
  const start = performance.now(), hashBackendBefore = narrativeSha256StatusV1()
  compiled = await compileWorldReleaseContentV4(fixture.input)
  const compileMs = performance.now() - start
  const records = compiled.manifest.narrative.bundle.records
  const privateAssertions = new Set(records.filter(row => row.kind === 'assertion' && row.visibility.class === 'author-only').map(row => row.semanticId))
  return { compileMs, hashBackendBefore, hashBackend: narrativeSha256StatusV1(), contentHash: compiled.contentHash, indexHash: compiled.index.indexHash,
    compilerVersion: compiled.manifest.compilerVersion,
    epistemicRecords: records.filter(row => row.kind === 'epistemic-event').length,
    privateAssertions: privateAssertions.size,
    independentVisibleBeliefs: records.filter(row => row.kind === 'epistemic-event' && row.visibility.class === 'public'
      && privateAssertions.has(row.payload.propositionRef.semanticId)).length,
    records: compiled.manifest.narrative.bundle.records.length, edges: compiled.index.indexes.adjacency.length }
}
export async function exportScaleV1() {
  if (!compiled) throw Error('Scale result is absent')
  // Frozen fixture publication metadata keeps exported bytes identical across
  // repeated cold runs; actual measurement time belongs to the outer receipt.
  const start = performance.now(), now = 1_900_000_000_000
  const created = await createWorkspace({ name: 'NW-2E 隔离评测', genres: [], description: '', status: 'drafting', targetWordCount: 1000, enableMultiWorld: false },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const { scope } = created
  await db.worlds.update(scope.worldId, { code: compiled.manifest.worldCode })
  const common = { projectId: scope.projectId, worldId: scope.worldId, label: 'Synthetic engineering scale fixture',
    manifestJson: compiled.manifestJson, contentHash: compiled.contentHash, createdAt: now }
  const revisionId = await db.worldRevisions.add({ ...common, revision: 1, parentRevisionId: null, updatedAt: now })
  const releaseId = await db.worldReleases.add({ ...common, revisionId, version: 1, sourceWorldCode: compiled.manifest.worldCode,
    releaseUid: worldReleaseUidV1({ worldCode: compiled.manifest.worldCode, version: 1, contentHash: compiled.contentHash }) })
  // Allow compiled/input objects to be collected; the exported package must
  // come from the persisted release through the registered verified cache.
  compiled = null; fixture = null
  const pkg = await createWorldPackage(releaseId, { authorName: 'StoryForge synthetic evaluation', license: 'CC-BY-4.0', allowedUses: {
    'world-remix': true, ttrpg: false, 'character-interaction': true, 'ai-town': false, 'text-adventure': false, avg: true, 'text-open-world': false,
  } })
  const bytes = canonicalNarrativeJsonV1(pkg)
  return { bytes, packageVersion: pkg.packageVersion, packageBytes: new TextEncoder().encode(bytes).length, exportMs: performance.now() - start,
    packageHash: await hashNarrativeBytesV1(bytes) }
}
export async function importScaleV1(bytes: string) {
  if (await db.projects.count()) throw Error('Scale import requires an empty isolated browser context')
  const start = performance.now(), importedProjectId = await importWorldPackage(JSON.parse(bytes))
  const release = await db.worldReleases.where('projectId').equals(importedProjectId).first()
  if (!release) throw Error('Imported release is absent')
  await clearWorldNarrativeIndexCachesV1({ projectId: release.projectId, worldId: release.worldId })
  return { importAndCacheClearMs: performance.now() - start, contentHash: release.contentHash }
}
export async function openScaleV1() {
  const release = await db.worldReleases.toCollection().first()
  if (!release) throw Error('Imported release is absent')
  const start = performance.now(), hashBackendBefore = narrativeSha256StatusV1()
  access = await openAuthorWorldQueryAccessV1({ scope: { projectId: release.projectId, worldId: release.worldId },
    localReleaseRecordId: release.id!, view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
  return { coldIndexMs: performance.now() - start, hashBackendBefore, hashBackend: narrativeSha256StatusV1(), reference: access.reference, capabilities: access.capabilities }
}
export async function queryScaleV1(needle: { query: string; quote: string }) {
  if (!access) throw Error('Scale query access is absent')
  const start = performance.now()
  const result = await queryWorldReleaseV1(access, { ...authorWorldQueryV1(access), text: needle.query, evidenceDepth: 'original' })
  return { queryMs: performance.now() - start, status: result.status,
    exactEvidenceFound: result.items.some(item => item.evidence.some(span => span.text?.includes(needle.quote))),
    evidence: result.items.flatMap(item => item.evidence.filter(span => span.text?.includes(needle.quote))
      .map(span => ({ evidenceId: span.evidenceId, spanHash: span.spanHash, start: span.start, end: span.end }))) }
}
