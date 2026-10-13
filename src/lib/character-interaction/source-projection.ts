import Dexie from 'dexie'
import type { WorldSemanticResourceSnapshotV1 } from '../context-gateway/world-release-client'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'

export interface ChatSourceFragmentV1 {
  fragmentKey: string
  resourceKey: string
  /** JSON pointer into the full, immutable semantic resource, not its summary. */
  pointer: string
  valueJson: string
}

export interface ChatSourceProjectionDraftV1 {
  schema: 'storyforge.chat-source-projection'
  version: 1
  worldReferenceHash: string
  worldReleaseHash: string
  characters: Array<{
    resourceKey: string
    sourceHash: string
    /** Author-side label. This does not make the source name public knowledge. */
    label: string
    fragments: ChatSourceFragmentV1[]
  }>
  projectionHash: string
}

export interface ChatSourceClassificationV1 {
  projectionHash: string
  fragmentKey: string
  purpose: 'identity' | 'motivation' | 'voice' | 'knowledge'
  visibility: 'public' | 'participants' | 'author-only' | 'unclassified'
  /** Portable character resource keys or the explicit player viewpoint. */
  audienceKeys: string[]
}

/** Author-owned decision saved in S2, then frozen with the authorized Brief. */
export interface ChatSourceReviewV1 {
  projectionHash: string
  classifications: ChatSourceClassificationV1[]
}

export function parseChatSourceReviewV1(value: unknown): ChatSourceReviewV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('来源确认必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'classifications,projectionHash') fail('来源确认字段无效')
  requireHash(row.projectionHash, '来源确认')
  if (!Array.isArray(row.classifications) || row.classifications.length > 2000) fail('来源分类数量无效')
  const seen = new Set<string>()
  for (const item of row.classifications) {
    if (!item || typeof item !== 'object'
      || Object.keys(item).sort().join(',') !== 'audienceKeys,fragmentKey,projectionHash,purpose,visibility'
      || item.projectionHash !== row.projectionHash
      || typeof item.fragmentKey !== 'string' || !item.fragmentKey || item.fragmentKey.length > 1000
      || seen.has(item.fragmentKey)
      || !['identity', 'motivation', 'voice', 'knowledge'].includes(item.purpose)
      || !['public', 'participants', 'author-only', 'unclassified'].includes(item.visibility)
      || !Array.isArray(item.audienceKeys) || item.audienceKeys.length > 9
      || item.audienceKeys.some((key: unknown) => typeof key !== 'string' || !key || key.length > 500)
      || new Set(item.audienceKeys).size !== item.audienceKeys.length
      || (item.visibility === 'participants' ? !item.audienceKeys.length : !!item.audienceKeys.length)) {
      fail('来源分类字段、版本或接收者无效')
    }
    seen.add(item.fragmentKey)
  }
  return structuredClone(value) as ChatSourceReviewV1
}

// Only verified in-memory Gateway drafts enter the synchronous compiler. The
// serialized body also detects mutation after preparation; a hash alone is not
// accepted as proof that a caller actually verified source content.
const verifiedDrafts = new WeakMap<ChatSourceProjectionDraftV1, string>()

function fail(message: string): never {
  throw new Error(`[chat-source-projection] ${message}`)
}

function requireHash(value: unknown, label: string): asserts value is string {
  if (!isSha256Hash(value)) fail(`${label} 缺少合法 hash`)
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

/** Pure preparation only. Production adoption/registration is a separate boundary. */
export async function createChatSourceProjectionDraftV1(input: {
  worldReferenceHash: string
  worldReleaseHash: string
  characterResourceKeys: readonly string[]
  resources: readonly WorldSemanticResourceSnapshotV1[]
}): Promise<ChatSourceProjectionDraftV1> {
  // Snapshot inputs before async hashing. Cast selection is a canonical set in the WorldSourceSelection contract.
  input = structuredClone(input)
  requireHash(input.worldReferenceHash, 'WorldReference')
  requireHash(input.worldReleaseHash, 'WorldRelease')
  if (!input.characterResourceKeys.length || input.characterResourceKeys.length > 8
    || new Set(input.characterResourceKeys).size !== input.characterResourceKeys.length) {
    fail('请选择 1～8 个不重复的冻结角色')
  }
  const byKey = new Map<string, WorldSemanticResourceSnapshotV1>()
  for (const snapshot of input.resources) {
    if (byKey.has(snapshot.descriptor.resourceKey)) fail('来源资源 key 重复')
    byKey.set(snapshot.descriptor.resourceKey, snapshot)
  }
  const characters = await Promise.all([...input.characterResourceKeys].sort().map(async resourceKey => {
    const source = byKey.get(resourceKey)
    if (!source || source.descriptor.sourceKey !== 'worldRelease'
      || source.descriptor.worldSemantic.resourceKind !== 'character'
      || source.descriptor.scope.worldReleaseHash !== input.worldReleaseHash) {
      fail(`角色来源缺失、类型错误或世界版本不一致：${resourceKey}`)
    }
    requireHash(source.descriptor.contentHash, '资源')
    const sourceHash = hashCanonicalValue(source.value)
    if ((Dexie.currentTransaction ? await Dexie.waitFor(sourceHash) : await sourceHash) !== source.descriptor.contentHash) {
      fail(`角色原文与资源证据不一致：${resourceKey}`)
    }
    const fragments: ChatSourceFragmentV1[] = []
    // Preserve each top-level semantic field exactly, including arrays/objects.
    // Internal provider coordinates remain in provenance, never character facts.
    for (const field of Object.keys(source.value).sort()) {
      if (field.startsWith('_')) continue
      const pointer = `/${escapePointer(field)}`
      fragments.push({
        fragmentKey: `${resourceKey}#${pointer}`, resourceKey, pointer,
        valueJson: canonicalStringify(source.value[field]),
      })
    }
    if (!fragments.length) fail(`角色没有可投影的语义字段：${resourceKey}`)
    return {
      resourceKey, sourceHash: source.descriptor.contentHash,
      label: source.descriptor.title, fragments,
    }
  }))
  const body = {
    schema: 'storyforge.chat-source-projection' as const, version: 1 as const,
    worldReferenceHash: input.worldReferenceHash, worldReleaseHash: input.worldReleaseHash,
    characters,
  }
  const draft = { ...body, projectionHash: await hashProductProductionValueV2(body) }
  verifiedDrafts.set(draft, canonicalStringify(draft))
  return draft
}

/**
 * Returns only explicitly classified fragments for one viewpoint. Missing
 * decisions fail closed. Hashes detect staleness; they are NOT author consent.
 * The eventual caller must additionally verify the persisted author confirmation.
 */
export async function readChatSourceProjectionViewV1(input: {
  draft: ChatSourceProjectionDraftV1
  classifications: readonly ChatSourceClassificationV1[]
  viewerKey: string
}): Promise<Array<ChatSourceFragmentV1 & { purpose: ChatSourceClassificationV1['purpose'] }>> {
  input = structuredClone(input)
  const { projectionHash, ...body } = input.draft
  requireHash(projectionHash, '投影')
  if (body.schema !== 'storyforge.chat-source-projection' || body.version !== 1
    || await hashProductProductionValueV2(body) !== projectionHash) fail('投影内容与版本证据不一致')
  return selectProjectionView(input)
}

/** Compile only a freshly verified Gateway draft and a frozen author decision. */
export function readPreparedChatSourceProjectionViewV1(input: {
  draft: ChatSourceProjectionDraftV1
  review: ChatSourceReviewV1
  viewerKey: string
}): Array<ChatSourceFragmentV1 & { purpose: ChatSourceClassificationV1['purpose'] }> {
  if (verifiedDrafts.get(input.draft) !== canonicalStringify(input.draft)) fail('构建需要重新核验的世界来源投影')
  const review = parseChatSourceReviewV1(input.review)
  if (review.projectionHash !== input.draft.projectionHash) fail('来源或角色选择已变化，请重新检查并确认资料')
  return selectProjectionView({ draft: input.draft, classifications: review.classifications, viewerKey: input.viewerKey })
}

function selectProjectionView(input: {
  draft: ChatSourceProjectionDraftV1
  classifications: readonly ChatSourceClassificationV1[]
  viewerKey: string
}): Array<ChatSourceFragmentV1 & { purpose: ChatSourceClassificationV1['purpose'] }> {
  const { projectionHash, ...body } = input.draft
  const viewers = new Set(['player', ...body.characters.map(character => character.resourceKey)])
  if (!viewers.has(input.viewerKey)) fail('视角不属于当前投影')
  const fragments = new Map(body.characters.flatMap(character => character.fragments)
    .map(fragment => [fragment.fragmentKey, fragment]))
  const seen = new Set<string>()
  const result: Array<ChatSourceFragmentV1 & { purpose: ChatSourceClassificationV1['purpose'] }> = []
  for (const decision of input.classifications) {
    if (decision.projectionHash !== projectionHash) fail('知识分类已过期，请重新确认')
    const fragment = fragments.get(decision.fragmentKey)
    if (!fragment || seen.has(decision.fragmentKey)) fail('知识分类引用缺失或重复')
    seen.add(decision.fragmentKey)
    if (!['identity', 'motivation', 'voice', 'knowledge'].includes(decision.purpose)
      || !['public', 'participants', 'author-only', 'unclassified'].includes(decision.visibility)
      || !Array.isArray(decision.audienceKeys)
      || new Set(decision.audienceKeys).size !== decision.audienceKeys.length
      || decision.audienceKeys.some(key => !viewers.has(key))) fail('知识分类或接收者无效')
    if (decision.visibility === 'participants' ? decision.audienceKeys.length === 0 : decision.audienceKeys.length !== 0) {
      fail('可见性与接收者不匹配')
    }
    if (decision.visibility === 'public'
      || decision.visibility === 'participants' && decision.audienceKeys.includes(input.viewerKey)) {
      result.push({ ...structuredClone(fragment), purpose: decision.purpose })
    }
  }
  return result
}
