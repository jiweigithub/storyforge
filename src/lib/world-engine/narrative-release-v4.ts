import { initializeNarrativeSha256V1 } from '../narrative-domain/sha256'
import type { WorldReleaseCompiledV4, WorldReleaseManifestV4, WorldReleaseSemanticContentV4 } from '../types/narrative-release'
import { NARRATIVE_DOMAIN_COMPILERS_V4 } from '../types/narrative-release'
import type { WorldSemanticSnapshotV1 } from '../types/world-release'
import type { NarrativeDomainCaptureV1, NarrativeDomainRowV1 } from './narrative-domain-capture'
import type { NarrativeIndexV1 } from '../types/narrative-index'
import { NARRATIVE_INDEX_RECIPE_V1 } from '../types/narrative-index'
import { WORLD_SEMANTIC_REGISTRY_V4 } from './semantic-registry-v4'
import { projectNarrativeDomainCaptureV1 } from './narrative-domain-projection'
import { compileNarrativeIndexV1, verifyNarrativeIndexV1 } from './narrative-index'
import { assertWorldSemanticSnapshotV1 } from './semantic-snapshot'
import { remapNarrativeDomainFieldV1 } from '../narrative-domain/references'
import { NARRATIVE_DOMAIN_FIELDS_V1 } from '../narrative-domain/codec'
import { assertNarrativeDomainReferenceRowsV1 } from '../narrative-domain/integrity'
import { parseWorldPortals } from '../utils/world-portals'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { isPublicWorldCode } from '../workspace/identity'
import { isWorkspaceUid, isWorkCode } from '../memory/identity'
import { attachNarrativeLineageV1, verifyNarrativeLineageV1 } from './narrative-lineage'
import { assertNarrativeJsonV1, freezeAndHashNarrativeJsonV1, canonicalNarrativeJsonV1, canonicalNarrativeJsonWithHashV1, parseCanonicalNarrativeObjectV1, splitCanonicalNarrativeObjectV1, matchesCanonicalNarrativeJsonV1, equalNarrativeJsonV1, compareUnicodeCodePointsV1, hashNarrativeBytesV1, hashNarrativeValueV1, hashV1, narrativeFail,
  keyV1, objectV1, enumV1, uniqueKeysV1 } from './narrative-json'

/** v4 publishPolicy includes legitimate prior facts. The historical v3 status
 * filter is deliberately not reused or widened. Unconfirmed proposals stay out. */
export function isWorldReleaseSourceEligibleV4(table: string, row: Record<string, unknown>): boolean {
  const policy = WORLD_SEMANTIC_REGISTRY_V4.tables.find(spec => spec.name === table)?.worldSemantic
  if (!policy) return false
  if (policy.canonPolicy === 'authoritative-table') return true
  const status = String(row[policy.statusField!])
  return Boolean(policy.confirmedStatusValues?.includes(status)
    || (policy.publishPolicy === 'reviewed-narrative-v1' && table === 'temporalFacts' && status === 'superseded'))
}

const CONTENT_KEYS = ['schema', 'version', 'semanticContract', 'registryVersion', 'compilerVersion', 'worldCode',
  'worldName', 'selectedTables', 'records', 'semanticSnapshot', 'sourceManifest', 'narrative'] as const

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) narrativeFail('release-shape', `${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    narrativeFail('release-exact-keys', `${label} 缺字段或包含未知字段`)
  }
}
function captureManifest(value: unknown): string | Record<string, unknown> {
  if (typeof value === 'string') return value
  assertNarrativeJsonV1(value)
  return object(structuredClone(value), 'manifest')
}
function parse(value: string | Record<string, unknown>): { value: Record<string, unknown>; semanticRootHash: string | null; narrativeJson?: string } {
  if (typeof value === 'string') {
    try {
      const split = splitCanonicalNarrativeObjectV1(value, 'narrative', ['semanticRootHash', 'indexDescriptor'])
      if (split) return { value: split.value, semanticRootHash: split.projectionHash, narrativeJson: split.deferredJson }
      const proof = parseCanonicalNarrativeObjectV1(value, ['semanticRootHash', 'indexDescriptor'])
      if (!proof.matches) narrativeFail('release-noncanonical', 'v4 冻结字节必须使用该版本的规范编码')
      return { value: proof.value, semanticRootHash: proof.projectionHash }
    } catch (error) {
      if (error instanceof SyntaxError) narrativeFail('release-json', '世界封存内容不是合法 JSON')
      throw error
    }
  }
  return { value, semanticRootHash: null }
}
function contentOf(manifest: WorldReleaseManifestV4): WorldReleaseSemanticContentV4 {
  const { semanticRootHash: _root, indexDescriptor: _index, ...content } = manifest
  return content
}

/** Read-only decoding of portable coordinates for the versioned projector.
 * This is not a database import and never allocates or writes author IDs. */
export function captureFrozenNarrativeSourcesV4(input: {
  worldCode: string
  records: Record<string, Record<string, unknown>[]>
  selectedTables: readonly string[]
  semanticSnapshot: WorldSemanticSnapshotV1
  sourceWorkCode?: string | null
}): NarrativeDomainCaptureV1 {
  if (!isPublicWorldCode(input.worldCode)) narrativeFail('release-world', 'v4 必须绑定可分享的 World 身份')
  assertWorldSemanticSnapshotV1(input.semanticSnapshot)
  const roots = input.semanticSnapshot
  const sourceWorkCode = input.sourceWorkCode ?? null
  if (roots.ownership.worldExportId !== 0 || roots.ownership.workExportId !== 0
    || roots.worlds[0].code !== input.worldCode || roots.worlds[0].identityKind !== 'world-draft'
    || !isWorkCode(roots.works[0].code) || !isWorkspaceUid(roots.project.workspaceUid)
    || roots.project.workspacePurpose !== 'world-engine' || roots.works[0]._worldExportId !== 0) {
    narrativeFail('release-roots', 'v4 语义根身份、用途或所有权不一致')
  }
  if (sourceWorkCode !== null && (!isWorkCode(sourceWorkCode) || sourceWorkCode !== roots.works[0].code)) {
    narrativeFail('release-lineage', '明确选择的 Work 来源必须与冻结根身份一致')
  }
  const selected = uniqueKeysV1([...input.selectedTables], 'selectedTables')
  const registry = WORLD_SEMANTIC_REGISTRY_V4
  if (canonicalNarrativeJsonV1(selected) !== canonicalNarrativeJsonV1(input.selectedTables)
    || selected.some(table => !registry.tables.some(spec => spec.name === table))
    || canonicalNarrativeJsonV1(Object.keys(input.records).sort(compareUnicodeCodePointsV1)) !== canonicalNarrativeJsonV1(selected)) {
    narrativeFail('release-selection', '所选领域必须与 v4 注册合同及原始来源精确闭合')
  }
  const maps = new Map<string, Map<number, number>>([
    ['worlds', new Map([[0, 1]])], ['works', new Map([[0, 1]])],
  ])
  const rows = new Map<string, NarrativeDomainRowV1[]>()
  for (const spec of registry.tables) {
    const source = input.records[spec.name] ?? []
    if (!Array.isArray(source)) narrativeFail('release-records', `${spec.name} 原始来源不是数组`)
    const ids = new Map<number, number>(), uids = new Set<string>()
    let prior = ''
    for (const [index, raw] of source.entries()) {
      const row = object(raw, spec.name), identity = spec.resourceIdentity!
      const uid = row[identity.field]
      if (!isPortableResourceUidV1(uid, identity.resourceKind) || uids.has(uid.toLowerCase())
        || (index > 0 && compareUnicodeCodePointsV1(prior, uid) >= 0)
        || (spec.exportIdField && row._exportId !== index)
        || (!spec.exportIdField && '_exportId' in row)
        || ['id', 'projectId', 'worldId', 'workId', '_instanceOwnerExportId'].some(field => field in row)) narrativeFail('release-source-identity', `${spec.name} 来源身份、排序或 owner 非法`)
      const locator = spec.domainOwner!.locator
      const worldOwned = row._worldOwnerExportId === 0 && !('_workOwnerExportId' in row)
      const workOwned = row._workOwnerExportId === 0 && !('_worldOwnerExportId' in row)
      if ((!worldOwned && !workOwned) || (workOwned && sourceWorkCode === null)
        || (locator.kind === 'field' && (locator.owner === 'world' ? !worldOwned : locator.owner !== 'work' || !workOwned))
        || !['field', 'exclusive-fields'].includes(locator.kind)) {
        narrativeFail('release-owner', 'Work 来源必须明确选择并绑定来源身份；不能跨 owner 混入世界包')
      }
      const policy = spec.worldSemantic!
      if (!isWorldReleaseSourceEligibleV4(spec.name, row)) {
        narrativeFail('release-authority', '候选来源不能进入已封存 Canon')
      }
      for (const field of NARRATIVE_DOMAIN_FIELDS_V1) {
        if (field in row || (`_${field}Portable` in row && !policy.projector?.annotationFields.includes(field))) {
          narrativeFail('release-annotation', `${spec.name}.${field} 不是该版本登记的便携注释`)
        }
      }
      ids.set(index, index + 1); uids.add(uid.toLowerCase()); prior = uid
    }
    maps.set(spec.name, ids)
  }
  assertNarrativeDomainReferenceRowsV1(new Map([...Object.entries(input.records), ['worlds', roots.worlds], ['works', roots.works]]),
    'portable', [...registry.tables, { name: 'worlds', exportIdField: true }, { name: 'works', exportIdField: true }])
  const mappedArray = (value: unknown, table: string): number[] => {
    if (!Array.isArray(value) || value.some(id => !Number.isSafeInteger(id) || !maps.get(table)?.has(id))) {
      narrativeFail('release-reference', '嵌套便携引用缺失或越界')
    }
    return value.map(id => maps.get(table)!.get(id)!)
  }
  for (const spec of registry.tables) {
    rows.set(spec.name, (input.records[spec.name] ?? []).map((raw, index) => {
      const row = { ...raw, id: index + 1, projectId: 1 } as NarrativeDomainRowV1
      delete row._exportId
      delete row._worldOwnerExportId
      delete row._workOwnerExportId
      const locator = spec.domainOwner!.locator
      if (locator.kind === 'field') row[locator.field] = 1
      else if (locator.kind === 'exclusive-fields') {
        row[locator.worldField] = raw._worldOwnerExportId === 0 ? 1 : null
        row[locator.workField] = raw._workOwnerExportId === 0 ? 1 : null
      }
      for (const ref of spec.exportRemap ?? []) {
        if (ref.field in raw || !(ref.exportAs in raw)) narrativeFail('release-reference', `${spec.name}.${ref.field} 缺少规范便携引用`)
        const portable = raw[ref.exportAs]
        if (portable === null && (ref.onUnmapped === 'require' || ref.onUnmapped === 'drop')) narrativeFail('release-reference', `${spec.name}.${ref.field} 必填引用缺失`)
        if (portable !== null && (!Number.isSafeInteger(portable) || !maps.get(ref.selfTree ? spec.name : ref.remapVia)?.has(portable as number))) {
          narrativeFail('release-reference', `${spec.name}.${ref.field} 引用缺失或越界`)
        }
        row[ref.field] = portable === null ? null : maps.get(ref.selfTree ? spec.name : ref.remapVia)!.get(portable as number)!
        delete row[ref.exportAs]
      }
      for (const ref of spec.exportRefRemap ?? []) {
        if (ref.kind === 'narrative-source-refs-v1') {
          if (!(ref.exportAs in raw)) continue
          row[ref.field] = remapNarrativeDomainFieldV1(ref.field, raw[ref.exportAs], 'import', maps) as never
          delete row[ref.exportAs]
        } else if (ref.kind === 'id-array') {
          if (ref.field in raw) narrativeFail('release-reference', '原始本地 ID 数组不能混入便携内容')
          const restored = mappedArray(raw[ref.exportAs], ref.remapVia)
          row[ref.field] = ref.storage === 'json-string' ? JSON.stringify(restored) : restored
          delete row[ref.exportAs]
        } else if (ref.kind === 'scene-character-ids') {
          const scenes = raw[ref.field], shadows = raw[ref.exportAs]
          if (!Array.isArray(scenes) || !Array.isArray(shadows) || shadows.length !== scenes.length) narrativeFail('release-reference', '场景与角色引用数组不闭合')
          row[ref.field] = scenes.map((scene, position) => {
            const original = object(scene, 'scene')
            if (!Array.isArray(original.characterIds) || original.characterIds.length) narrativeFail('release-reference', '场景不能保留本地角色编号')
            return { ...original, characterIds: mappedArray(shadows[position], ref.remapVia) }
          })
          delete row[ref.exportAs]
        } else if (ref.kind === 'portals' && ref.field in raw) {
          if (typeof raw[ref.field] !== 'string') narrativeFail('release-reference', '通道必须是规范便携 JSON')
          let originals: unknown
          try { originals = JSON.parse(raw[ref.field] as string) } catch { narrativeFail('release-reference', '通道不是合法 JSON') }
          const portals = parseWorldPortals(raw[ref.field] as string)
          if (!Array.isArray(originals) || originals.length !== portals.length) narrativeFail('release-reference', '通道原文含非法引用')
          const ids = mappedArray(portals.map(portal => portal.targetWorldId), ref.remapVia)
          row[ref.field] = JSON.stringify(portals.map((portal, position) => ({ ...portal, targetWorldId: ids[position] })))
        }
      }
      return row
    }))
  }
  const peers = new Map(rows)
  peers.set('worlds', [{ ...roots.worlds[0], id: 1, projectId: 1 }])
  peers.set('works', [{ ...roots.works[0], id: 1, projectId: 1, worldId: 1 }])
  return { registry, scope: { projectId: 1, worldId: 1, workId: 1 },
    owner: { kind: 'world', worldCode: input.worldCode, sourceWorkCode }, rows, peers,
    worldCode: input.worldCode, workCode: roots.works[0].code as string }
}

async function verifyContentSources(content: Omit<WorldReleaseSemanticContentV4, 'narrative'>): Promise<NarrativeDomainCaptureV1> {
  exact(object(content, 'content'), CONTENT_KEYS.filter(key => key !== 'narrative'), 'content')
  if (content.schema !== 'storyforge.world-release' || content.version !== 4 || content.semanticContract !== 4
    || content.registryVersion !== 'world-semantic-v4' || !NARRATIVE_DOMAIN_COMPILERS_V4.includes(content.compilerVersion)) {
    narrativeFail('release-version', '只接受该版本的 v4 世界内容合同')
  }
  keyV1(content.worldName, 'worldName')
  const { lineage, ...sourceFields } = object(content.sourceManifest, 'sourceManifest')
  const source = objectV1<Omit<WorldReleaseSemanticContentV4['sourceManifest'], 'lineage'>>({
    sourceKind: enumV1(['world-draft']), sourceWorkspaceUid: keyV1, sourceWorldCode: keyV1,
    sourceWorkCode: value => {
      if (value !== null && !isWorkCode(value)) narrativeFail('release-lineage', 'Work 来源必须是明确的稳定身份')
      return value as string | null
    },
  })(sourceFields, 'sourceManifest')
  if ('lineage' in content.sourceManifest) await verifyNarrativeLineageV1(lineage, content.worldCode)
  if (source.sourceWorldCode !== content.worldCode || source.sourceWorkspaceUid !== content.semanticSnapshot.project.workspaceUid
    || content.semanticSnapshot.worlds[0].name !== content.worldName) narrativeFail('release-source', '封存来源与语义根不一致')
  const capture = captureFrozenNarrativeSourcesV4({ ...content, sourceWorkCode: source.sourceWorkCode })
  // These rows/arrays were constructed here and remain private to this
  // verification or compilation. Stabilize identities for repeated reference
  // lookup, without freezing the public capture utility used for preparation.
  // Nested semantic data still follows the full projection/evidence checks.
  for (const rows of new Set([...capture.rows.values(), ...capture.peers.values()])) {
    for (const row of rows) Object.freeze(row)
    Object.freeze(rows)
  }
  return capture
}

async function verifyContent(content: WorldReleaseSemanticContentV4, narrativeJson?: string) {
  exact(object(content, 'content'), narrativeJson === undefined ? CONTENT_KEYS : CONTENT_KEYS.filter(key => key !== 'narrative'), 'content')
  const { narrative: _narrative, ...originals } = content
  const capture = await verifyContentSources(originals)
  // Rebuild coverage, permissions, evidence and all atoms from the same frozen
  // originals. Merely re-hashing a fabricated projection cannot pass.
  const expected = await attachNarrativeLineageV1(await projectNarrativeDomainCaptureV1(capture, {
    branchKey: 'canon', immutableIR: true, compilerVersion: content.compilerVersion }),
    content.sourceManifest.lineage, { immutableIR: true })
  if (narrativeJson === undefined ? !equalNarrativeJsonV1(content.narrative, expected)
    : !matchesCanonicalNarrativeJsonV1(expected, narrativeJson)) {
    narrativeFail('release-projection', '冻结投影与原文、确认、覆盖或权限不一致')
  }
  return expected
}

/** Compile a release component; persistence, author authorization and final
 * compare-and-swap are owned by createWorldRevision, not this pure function. */
export async function prepareNarrativeReleaseContentV4(input: Omit<WorldReleaseSemanticContentV4, 'narrative'>) {
  assertNarrativeJsonV1(input)
  const frozen = structuredClone(input)
  await initializeNarrativeSha256V1()
  const capture = await verifyContentSources(frozen)
  const narrative = await attachNarrativeLineageV1(await projectNarrativeDomainCaptureV1(capture, {
    branchKey: 'canon', immutableIR: true, compilerVersion: frozen.compilerVersion }),
    frozen.sourceManifest.lineage, { immutableIR: true })
  // Only this compiler owns these decoded originals and completed projection.
  // Validate and freeze once before repeated encoding; the private JSON receipt
  // proves shape, not semantic validity, author approval or read permission.
  const content = { ...frozen, narrative }
  const semanticRootHash = await freezeAndHashNarrativeJsonV1(content)
  // The projection above was built here from a private frozen input. External
  // manifests still recompile in verifyContent; a compiler need not repeat its
  // own identical projection just to compare that result with itself.
  return { content, semanticRootHash }
}

export async function compileWorldReleaseContentV4(input: Omit<WorldReleaseSemanticContentV4, 'narrative'>): Promise<WorldReleaseCompiledV4> {
  const { content, semanticRootHash } = await prepareNarrativeReleaseContentV4(input)
  const narrative = content.narrative
  const index = await compileNarrativeIndexV1({ inputRootHash: semanticRootHash, projection: narrative,
    predicates: WORLD_SEMANTIC_REGISTRY_V4.predicates, retainIncrementalShards: false })
  const manifest: WorldReleaseManifestV4 = { ...content, semanticRootHash,
    indexDescriptor: { inputRootHash: semanticRootHash, recipeVersion: index.recipeVersion, indexHash: index.indexHash } }
  const { json: manifestJson, hash: contentHash } = canonicalNarrativeJsonWithHashV1(manifest)
  return { manifest, manifestJson, contentHash, index }
}

export async function verifyWorldReleaseContentV4(input: {
  manifest: string | unknown
  expectedContentHash?: string
  expectedWorldCode?: string
  index?: unknown
  mode?: 'complete' | 'source-only'
  /** Private shard copies are needed only when this verified index will be an
   * incremental baseline, not for ordinary reads or package verification. */
  retainIncrementalShards?: boolean
}): Promise<{ manifest: WorldReleaseManifestV4; index: NarrativeIndexV1 | null; readiness: 'ready' | 'rebuilt' | 'unavailable' }> {
  // Capture caller objects synchronously before initializing the accelerator.
  // Initialization belongs to the actual open/compile operation, not module load.
  const request = { ...input, manifest: captureManifest(input.manifest) }
  const captured = request.manifest
  await initializeNarrativeSha256V1()
  const decoded = parse(captured), parsed = decoded.value
  exact(parsed, [...(decoded.narrativeJson === undefined ? CONTENT_KEYS : CONTENT_KEYS.filter(key => key !== 'narrative')),
    'semanticRootHash', 'indexDescriptor'], 'manifest')
  const manifest = parsed as unknown as WorldReleaseManifestV4
  hashV1(manifest.semanticRootHash, 'semanticRootHash')
  const descriptor = objectV1<WorldReleaseManifestV4['indexDescriptor']>({ inputRootHash: hashV1, recipeVersion: keyV1, indexHash: hashV1 })(manifest.indexDescriptor, 'indexDescriptor')
  if (request.expectedContentHash !== undefined && await (typeof captured === 'string'
    ? hashNarrativeBytesV1(captured) : hashNarrativeValueV1(manifest)) !== hashV1(request.expectedContentHash, 'expectedContentHash')) narrativeFail('release-hash', '世界内容 hash 不匹配')
  if (request.expectedWorldCode !== undefined && request.expectedWorldCode !== manifest.worldCode) narrativeFail('release-world', '世界身份与外层绑定不一致')
  const verifiedProjection = await verifyContent(contentOf(manifest), decoded.narrativeJson)
  if ((decoded.semanticRootHash ?? await hashNarrativeValueV1(contentOf(manifest))) !== manifest.semanticRootHash
    || descriptor.inputRootHash !== manifest.semanticRootHash) {
    narrativeFail('release-semantic-root', '原文、IR 和索引输入根不一致')
  }
  // Only after full source reconstruction and exact byte equality may we
  // decode the deferred value. Return a caller-private mutable object, keeping
  // the public read contract and withholding the private immutable IR receipt.
  const restoreManifest = () => {
    if (decoded.narrativeJson !== undefined) manifest.narrative = JSON.parse(decoded.narrativeJson)
    return manifest
  }
  if (descriptor.recipeVersion !== NARRATIVE_INDEX_RECIPE_V1) {
    if (request.mode !== 'source-only') narrativeFail('release-recipe', '索引配方不可用；只能显式读取原始内容')
    return { manifest: restoreManifest(), index: null, readiness: 'unavailable' }
  }
  // Use the private, immutable projection just rebuilt and compared above.
  // The imported manifest itself never receives an in-process proof receipt.
  const indexInput = { inputRootHash: manifest.semanticRootHash, projection: verifiedProjection,
    predicates: WORLD_SEMANTIC_REGISTRY_V4.predicates, retainIncrementalShards: request.retainIncrementalShards === true }
  const index = request.index === undefined ? await compileNarrativeIndexV1(indexInput) : await verifyNarrativeIndexV1(request.index, indexInput)
  if (index.indexHash !== descriptor.indexHash) narrativeFail('release-index-hash', '按原配方重建的索引与冻结承诺不同')
  return { manifest: restoreManifest(), index, readiness: request.index === undefined ? 'rebuilt' : 'ready' }
}
