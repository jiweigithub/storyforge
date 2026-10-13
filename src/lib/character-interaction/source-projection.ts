import Dexie from 'dexie'
import {assertChatBackgroundSelectionV1} from './background-source'
import type { WorldSemanticResourceSnapshotV1 } from '../context-gateway/world-release-client'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import type { ChatSourceTextRangeV1 } from '../types/character-interaction'

export interface ChatSourceFragmentV1 {
  fragmentKey: string
  resourceKey: string
  /** JSON pointer into the full, immutable semantic resource, not its summary. */
  pointer: string
  valueJson: string
  textRange?: ChatSourceTextRangeV1
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
  /** The player's mapped character is a source subject, not an additional AI viewpoint. */
  playerCharacter?: ChatSourceProjectionDraftV1['characters'][number]
  /** Optional to preserve historical character-only projection hashes. */
  background?: Array<ChatSourceProjectionDraftV1['characters'][number] & {resourceKind: string; relatedResourceKeys?: string[]}>
  projectionHash: string
}

export function chatProjectionResourcesV1(draft: ChatSourceProjectionDraftV1) {
  return [...draft.characters, ...(draft.playerCharacter ? [draft.playerCharacter] : []), ...(draft.background ?? [])]
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

/** Lossless source passages; this is not a context-budget truncation or a summary. */
function fragmentSourceField(resourceKey: string, pointer: string, value: unknown): ChatSourceFragmentV1[] {
  const fragmentKey = `${resourceKey}#${pointer}`
  const valueJson = canonicalStringify(value)
  if (typeof value !== 'string' || valueJson.length <= 6000) return [{fragmentKey, resourceKey, pointer, valueJson}]
  const fragments: ChatSourceFragmentV1[] = []
  for (let start = 0; start < value.length;) {
    let low = start + 1; let high = Math.min(value.length, start + 5998)
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (canonicalStringify(value.slice(start, middle)).length <= 6000) low = middle
      else high = middle - 1
    }
    let end = low
    // Keep a paragraph together when it fits, and never split a surrogate pair.
    const paragraph = value.lastIndexOf('\n', end - 1) + 1
    if (end < value.length && paragraph > start + (end - start) / 2) end = paragraph
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--
    const textRange = {start, end}
    fragments.push({fragmentKey: `${fragmentKey}@${start}:${end}`, resourceKey, pointer,
      valueJson: canonicalStringify(value.slice(start, end)), textRange})
    start = end
  }
  return fragments
}

/** Pure preparation only. Production adoption/registration is a separate boundary. */
export async function createChatSourceProjectionDraftV1(input: {
  worldReferenceHash: string
  worldReleaseHash: string
  characterResourceKeys: readonly string[]
  playerCharacterKey?: string
  backgroundResourceKeys?: readonly string[]
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
  const backgroundKeys = [...(input.backgroundResourceKeys ?? [])].sort()
  if (input.playerCharacterKey !== undefined && (typeof input.playerCharacterKey !== 'string' || !input.playerCharacterKey.trim() || input.playerCharacterKey.length > 500
    || input.characterResourceKeys.includes(input.playerCharacterKey))) fail('玩家人物来源无效或与 AI 角色重复')
  assertChatBackgroundSelectionV1(backgroundKeys, input.resources.map(source => source.descriptor))
  const project = async (resourceKey: string, character: boolean) => {
    const source = byKey.get(resourceKey)
    if (!source || source.descriptor.sourceKey !== 'worldRelease'
      || character && source.descriptor.worldSemantic.resourceKind !== 'character'
      || source.descriptor.scope.worldReleaseHash !== input.worldReleaseHash) {
      fail(`角色来源缺失、类型错误或世界版本不一致：${resourceKey}`)
    }
    requireHash(source.descriptor.contentHash, '资源')
    const sourceHash = hashCanonicalValue(source.value)
    if ((Dexie.currentTransaction ? await Dexie.waitFor(sourceHash) : await sourceHash) !== source.descriptor.contentHash) {
      fail(`原文与资源证据不一致：${resourceKey}`)
    }
    const fragments: ChatSourceFragmentV1[] = []
    for (const field of Object.keys(source.value).sort()) {
      if (field.startsWith('_')) continue
      fragments.push(...fragmentSourceField(resourceKey, `/${escapePointer(field)}`, source.value[field]))
    }
    if (!fragments.length) fail(`资源没有可投影的语义字段：${resourceKey}`)
    return {resourceKey, sourceHash: source.descriptor.contentHash, label: source.descriptor.title, fragments}
  }
  const characters = await Promise.all([...input.characterResourceKeys].sort().map(key => project(key, true)))
  const playerCharacter = input.playerCharacterKey ? await project(input.playerCharacterKey, true) : undefined
  const background = await Promise.all(backgroundKeys.map(async key => {
    const descriptor = byKey.get(key)!.descriptor
    const relatedResourceKeys = descriptor.worldSemantic.resourceKind === 'character-relation'
      ? [...new Set(descriptor.relations.filter(r => r.kind === 'depends-on').map(r => r.targetResourceKey))].sort() : []
    return {...await project(key, false), resourceKind: descriptor.worldSemantic.resourceKind,
      ...(relatedResourceKeys.length ? {relatedResourceKeys} : {})}
  }))
  if ([...characters, ...(playerCharacter ? [playerCharacter] : []), ...background].reduce((sum, resource) => sum + resource.fragments.length, 0) > 2000) fail('来源资料片段超过 2000 项，请缩小本次来源范围')
  const body = {
    schema: 'storyforge.chat-source-projection' as const, version: 1 as const,
    worldReferenceHash: input.worldReferenceHash, worldReleaseHash: input.worldReleaseHash,
    characters, ...(playerCharacter ? {playerCharacter} : {}), ...(background.length ? {background} : {}),
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
  const fragments = new Map(chatProjectionResourcesV1(input.draft).flatMap(resource => resource.fragments)
    .map(fragment => [fragment.fragmentKey, fragment]))
  const seen = new Set<string>()
  const result: Array<ChatSourceFragmentV1 & { purpose: ChatSourceClassificationV1['purpose'] }> = []
  for (const decision of input.classifications) {
    if (decision.projectionHash !== projectionHash) fail('知识分类已过期，请重新确认')
    const fragment = fragments.get(decision.fragmentKey)
    if (!fragment || seen.has(decision.fragmentKey)) fail('知识分类引用缺失或重复')
    seen.add(decision.fragmentKey)
    if (body.background?.some(resource => resource.resourceKey === fragment.resourceKey) && decision.purpose !== 'knowledge') fail('世界背景资料只能作为事实与经历，不能变成人物身份、动机或口吻')
    if (body.playerCharacter?.resourceKey === fragment.resourceKey && !['identity', 'knowledge'].includes(decision.purpose)) fail('玩家人物资料只能作为身份或知识，不能要求 AI 代演玩家的动机与口吻')
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
