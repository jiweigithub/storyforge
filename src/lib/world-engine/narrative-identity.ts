import { PROJECT_TABLES } from '../registry/project-tables'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { isWorkCode } from '../memory/identity'
import { isPublicWorldCode } from '../workspace/identity'
import { assertRecordInScope, resolveReadScope } from '../workspace/scope'
import { db } from '../db/schema'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import type { Chapter, OutlineNode, WorkspaceScope } from '../types'
import { NARRATIVE_KINDS_V1, type NarrativeIdentityAliasV1, type NarrativeOwnerV1, type NarrativeSourceIdentityV1, type SemanticKindV1 } from '../types/narrative-ir'
import type { NarrativeSequenceV1 } from '../types/narrative-time'
import { canonicalNarrativeJsonV1, enumV1, hashV1, keyV1, narrativeFail, nullableV1, objectV1, type DecoderV1 } from './narrative-json'

const workOwnerDecoder = objectV1<Extract<NarrativeOwnerV1, { kind: 'work' }>>({ kind: enumV1(['work']), workCode: keyV1 })
const worldOwnerDecoder = objectV1<Extract<NarrativeOwnerV1, { kind: 'world' }>>({
  kind: enumV1(['world']), worldCode: keyV1, sourceWorkCode: nullableV1(keyV1),
})
const sourceDecoder = objectV1<NarrativeSourceIdentityV1>({ resourceKind: keyV1, sourceUid: keyV1, subKey: keyV1 })
const semanticKindDecoder = enumV1(NARRATIVE_KINDS_V1)

export const ownerDecoderV1: DecoderV1<NarrativeOwnerV1> = (value, path) => {
  if ((value as NarrativeOwnerV1 | null)?.kind === 'work') {
    const owner = workOwnerDecoder(value, path)
    if (!isWorkCode(owner.workCode)) narrativeFail('owner', 'Work 必须使用稳定 code')
    return owner
  }
  const owner = worldOwnerDecoder(value, path)
  if (!isPublicWorldCode(owner.worldCode) || (owner.sourceWorkCode !== null && !isWorkCode(owner.sourceWorkCode))) {
    narrativeFail('owner', '内部 workspace scope 不可冒充公开世界')
  }
  return owner
}
export function narrativeOwnerKeyV1(value: NarrativeOwnerV1): string {
  const owner = ownerDecoderV1(value, 'owner')
  return owner.kind === 'world' ? `world/${owner.worldCode}` : `work/${owner.workCode}`
}
export function narrativeResourceIdentitySpecV1(resourceKind: string) {
  let found: (typeof PROJECT_TABLES)[number] | undefined
  // Keep live-registry uniqueness validation; avoid allocating a filter array
  // for every reference to an identity in the same frozen narrative.
  for (const spec of PROJECT_TABLES) if (spec.resourceIdentity?.resourceKind === resourceKind) {
    if (found) narrativeFail('resource-kind', `资源类型 ${resourceKind} 未唯一登记`)
    found = spec
  }
  if (!found) narrativeFail('resource-kind', `资源类型 ${resourceKind} 未唯一登记`)
  return found
}
export const sourceIdentityDecoderV1: DecoderV1<NarrativeSourceIdentityV1> = (value, path) => {
  const source = sourceDecoder(value, path)
  narrativeResourceIdentitySpecV1(source.resourceKind)
  // Preserve every currently valid stored UID byte-for-byte, including UUID
  // hex casing; normalization must never silently change a source identity.
  if (!isPortableResourceUidV1(source.sourceUid, source.resourceKind)) narrativeFail('source-uid', 'source UID 非规范或来源不一致')
  if (source.subKey !== 'root' && !/^sub:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(source.subKey)) {
    narrativeFail('subkey', '子记录必须使用持久 sub UID；不能用名称/数组下标')
  }
  return source
}
export function createNarrativeSemanticIdV1(owner: NarrativeOwnerV1, kind: SemanticKindV1, source: NarrativeSourceIdentityV1): string {
  const parsed = sourceIdentityDecoderV1(source, 'sourceIdentity')
  semanticKindDecoder(kind, 'kind')
  return ['nir', 'v1', narrativeOwnerKeyV1(owner), kind, parsed.sourceUid, parsed.subKey].map(encodeURIComponent).join(':')
}
type ParsedSemanticIdentity = { ownerKey: string; kind: SemanticKindV1; source: NarrativeSourceIdentityV1 }
// Immutable strings may share only their decoded syntax, never registry or
// owner authority. Bounds count both the original and decoded string units.
// Every cache hit still checks the live resource registry and kind contract.
const semanticIdentitySyntax = new Map<string, { value: ParsedSemanticIdentity; units: number }>()
let semanticIdentitySyntaxUnits = 0
function rememberSemanticIdentitySyntax(id: string, value: ParsedSemanticIdentity): void {
  const units = id.length + value.ownerKey.length + value.kind.length + value.source.resourceKind.length
    + value.source.sourceUid.length + value.source.subKey.length
  if (units > 4096) return
  while (semanticIdentitySyntax.size && (semanticIdentitySyntax.size >= 2048 || semanticIdentitySyntaxUnits + units > 524_288)) {
    const oldest = semanticIdentitySyntax.keys().next().value!
    semanticIdentitySyntaxUnits -= semanticIdentitySyntax.get(oldest)!.units
    semanticIdentitySyntax.delete(oldest)
  }
  const privateValue = Object.freeze({ ...value, source: Object.freeze({ ...value.source }) })
  semanticIdentitySyntax.set(id, { value: privateValue, units }); semanticIdentitySyntaxUnits += units
}
export function parseNarrativeSemanticIdV1(value: unknown): ParsedSemanticIdentity {
  const cached = typeof value === 'string' ? semanticIdentitySyntax.get(value) : undefined
  if (cached) {
    semanticKindDecoder(cached.value.kind, 'semanticId.kind')
    narrativeResourceIdentitySpecV1(cached.value.source.resourceKind)
    // Callers retain the same mutable return contract and cannot mutate the
    // private syntax entry or any subsequent caller's nested source identity.
    return { ...cached.value, source: { ...cached.value.source } }
  }
  const id = keyV1(value, 'semanticId')
  let parts: string[]
  try { parts = id.split(':').map(decodeURIComponent) } catch { return narrativeFail('semantic-id', '身份编码非法') }
  const [prefix, version, ownerKey, rawKind, sourceUid, subKey] = parts
  if (parts.length !== 6 || prefix !== 'nir' || version !== 'v1' || parts.map(encodeURIComponent).join(':') !== id) {
    narrativeFail('semantic-id', '身份必须是规范 v1 编码')
  }
  const kind = semanticKindDecoder(rawKind, 'semanticId.kind')
  const [ownerKind, code, extra] = ownerKey.split('/')
  if (extra !== undefined || (ownerKind !== 'world' && ownerKind !== 'work')) narrativeFail('owner', '身份 namespace 非法')
  narrativeOwnerKeyV1(ownerKind === 'world' ? { kind: 'world', worldCode: code, sourceWorkCode: null } : { kind: 'work', workCode: code })
  const source = sourceIdentityDecoderV1({ resourceKind: sourceUid.split(':')[2], sourceUid, subKey }, 'semanticId.source')
  const result = { ownerKey, kind, source }
  rememberSemanticIdentitySyntax(id, result)
  return result
}

export type NarrativeIdentityObservationV1 =
  | { status: 'available'; tableName: string; recordId: number; semanticId: string; source: NarrativeSourceIdentityV1; resourceKey: string }
  | { status: 'partial'; tableName: string; recordId: number; reason: 'source-missing' | 'source-uid-missing' }

/** Read-only compiler seam. Missing old identities are diagnostics, never
 * backfilled by a read. Existing explicit stampNewRecord owns allocation. */
export async function inspectNarrativeIdentitiesV1(input: {
  scope: WorkspaceScope
  owner: NarrativeOwnerV1
  requests: Array<{ tableName: string; recordId: number; kind: SemanticKindV1; subKey?: string }>
}): Promise<NarrativeIdentityObservationV1[]> {
  const scope = await resolveReadScope({ scope: input.scope })
  const owner = ownerDecoderV1(input.owner, 'owner')
  const [world, work] = await Promise.all([db.worlds.get(scope.worldId), db.works.get(scope.workId)])
  if (owner.kind === 'work' ? owner.workCode !== work?.code
    : owner.worldCode !== world?.code || (owner.sourceWorkCode !== null && owner.sourceWorkCode !== work?.code)) {
    narrativeFail('owner', '投影 owner 与工作区不一致')
  }
  const seen = new Map<string, string>(), identities = new Set<string>()
  const uidCountsByTable = new Map<string, Map<string, number>>()
  const result: NarrativeIdentityObservationV1[] = []
  for (const request of input.requests) {
    const spec = PROJECT_TABLES.find(s => s.name === request.tableName)
    if (!spec?.resourceIdentity) narrativeFail('resource-kind', '来源未登记 resourceIdentity')
    const row = await spec.table.get(request.recordId) as Record<string, unknown> | undefined
    if (!row) { result.push({ ...request, status: 'partial', reason: 'source-missing' }); continue }
    if (!await assertRecordInScope(scope, spec.name, row)) narrativeFail('scope', '拒绝跨 World/Work 来源')
    if (owner.kind === 'world' && row.workId != null && owner.sourceWorkCode !== work?.code) {
      narrativeFail('lineage', 'World 投影读取 Work 必须明确 sourceWorkCode')
    }
    const uid = row[spec.resourceIdentity.field]
    if (uid == null || uid === '') { result.push({ ...request, status: 'partial', reason: 'source-uid-missing' }); continue }
    const source = sourceIdentityDecoderV1({ resourceKind: spec.resourceIdentity.resourceKind, sourceUid: uid,
      subKey: request.subKey ?? 'root' }, 'sourceIdentity')
    if (!uidCountsByTable.has(spec.name)) {
      const peers = await spec.table.where('projectId').equals(scope.projectId).toArray() as Record<string, unknown>[]
      const counts = new Map<string, number>()
      for (const peer of peers) {
        const peerUid = peer[spec.resourceIdentity.field]
        if (typeof peerUid === 'string') counts.set(peerUid.toLowerCase(), (counts.get(peerUid.toLowerCase()) ?? 0) + 1)
      }
      uidCountsByTable.set(spec.name, counts)
    }
    if (uidCountsByTable.get(spec.name)!.get(source.sourceUid.toLowerCase())! > 1) narrativeFail('duplicate-uid', '来源 UID 在当前工作区不唯一')
    const rowKey = `${spec.name}:${request.recordId}`
    if (seen.has(source.sourceUid) && seen.get(source.sourceUid) !== rowKey) narrativeFail('duplicate-uid', '多个来源共用 UID')
    seen.set(source.sourceUid, rowKey)
    if (request.kind === 'entity' && !spec.resourceIdentity.narrativeEntityType) narrativeFail('entity-kind', '实体来源未登记')
    const semanticId = createNarrativeSemanticIdV1(owner, request.kind, source)
    if (identities.has(semanticId)) narrativeFail('duplicate-id', '投影请求重复语义身份')
    identities.add(semanticId)
    result.push({ status: 'available', tableName: spec.name, recordId: request.recordId, semanticId, source,
      resourceKey: `${spec.resourceIdentity.contextKind}:${source.sourceUid}` })
  }
  return result
}

/** FK targets come from PROJECT_TABLES, not an ungoverned type+id field. */
export function resolveNarrativeRegisteredFkV1(input: {
  tableName: string; field: string; targetId: number; identities: NarrativeIdentityObservationV1[]
}): string {
  const spec = PROJECT_TABLES.find(s => s.name === input.tableName)
  const remap = spec?.exportRemap?.find(r => r.field === input.field)
  if (!remap) narrativeFail('fk-unregistered', '该 FK 未登记导入导出映射')
  const matches = input.identities.filter(i => i.status === 'available' && i.tableName === remap.remapVia && i.recordId === input.targetId)
  if (matches.length !== 1 || matches[0].status !== 'available') narrativeFail('fk-unresolved', 'FK 缺失或存在多个语义目标')
  return matches[0].semanticId
}

/** Same canonical chapter resolver used by stepwise authoring and nodes. */
export function freezeNarrativeChapterSequenceV1(input: {
  owner: NarrativeOwnerV1; sequenceKey: string; revision: string; chapters: Chapter[]; outlineNodes: OutlineNode[]
}): { sequence: NarrativeSequenceV1 | null; diagnostics: string[] } {
  const canonical = resolveCanonicalChapterSequence(input.outlineNodes, input.chapters)
  const diagnostics: string[] = canonical.anomalies.map(a => a.kind)
  const unitKeys = canonical.sequence.map(({ chapter }) => chapter.ragDocumentId)
  if (unitKeys.some(key => !isPortableResourceUidV1(key, 'chapter'))) diagnostics.push('source-uid-missing')
  if (new Set(unitKeys).size !== unitKeys.length) diagnostics.push('duplicate-unit')
  if (diagnostics.length) return { sequence: null, diagnostics }
  const sequence = { sequenceKey: keyV1(input.sequenceKey, 'sequenceKey'), ownerKey: narrativeOwnerKeyV1(input.owner),
    revision: keyV1(input.revision, 'revision'), units: unitKeys.map((unitKey, ordinal) => ({ unitKey: unitKey!, ordinal })) }
  // Snapshot all values. Reordering a later draft cannot mutate this revision.
  return { sequence: JSON.parse(canonicalNarrativeJsonV1(sequence)) as NarrativeSequenceV1, diagnostics: [] }
}

/** Exact v3 aliases only; names and new database IDs never establish identity. */
export function resolveNarrativeLegacyAliasV1(
  source: Extract<NarrativeIdentityAliasV1['from'], { kind: 'legacy-release' }>,
  aliases: readonly NarrativeIdentityAliasV1[],
): { status: 'mapped'; semanticId: string } | { status: 'release-local'; resourceKey: string } {
  if (!isPublicWorldCode(source.worldCode)) narrativeFail('owner', 'legacy worldCode 非法')
  hashV1(source.releaseHash, 'releaseHash'); keyV1(source.resourceKey, 'resourceKey')
  const matched = aliases.filter(alias => alias.reason === 'legacy' && canonicalNarrativeJsonV1(alias.from) === canonicalNarrativeJsonV1(source))
  if (matched.length > 1) narrativeFail('alias-conflict', '同一旧身份对应多个 alias')
  if (matched.length === 1) {
    keyV1(matched[0].confirmationRef, 'confirmationRef')
    const target = parseNarrativeSemanticIdV1(matched[0].toSemanticId)
    if (target.ownerKey !== `world/${source.worldCode}`) narrativeFail('alias-scope', '旧包 alias 不可跨世界')
    return { status: 'mapped', semanticId: matched[0].toSemanticId }
  }
  return { status: 'release-local', resourceKey: `release-local:v3:${encodeURIComponent(source.worldCode)}:${source.releaseHash}:${encodeURIComponent(source.resourceKey)}` }
}
