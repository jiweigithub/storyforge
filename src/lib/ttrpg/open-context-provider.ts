/** Progressive actor context. Full resources are indivisible; original runtime heads are never disclosed. */
import type { ContextResourceProviderV1, ContextResourceDescriptorV1, FrozenResourceScopeV1, ResourceListInputV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'

type SourceKey = 'ttrpgOpenAuthority' | 'ttrpgOpenKnowledge'
type ResourceRow = { descriptor: ContextResourceDescriptorV1; content: string; tokenCount: number }
const catalogCache = new Map<string, { fingerprint: string; resources: ResourceRow[] }>()
async function catalog(scope: FrozenResourceScopeV1, sourceKey: SourceKey) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || !scope.runtimeActorKey) throw new Error('[ttrpg-open-provider] 需要明确 instance、World/Work 与角色 POV')
  const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
  const context = await loadTtrpgOpenPlayerContextV1({ scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: scope.runtimeActorKey })
  const { initialObservations, knowledge, rules, ...authority } = context.view
  const prefix = `fact:ttrpg-open:${context.readEvidence.sessionKey}:${scope.runtimeActorKey}`
  const rows = sourceKey === 'ttrpgOpenAuthority'
    ? [{ suffix: 'authority', title: '当前角色与权限', value: authority, mandatory: true },
      { suffix: 'rules-core', title: '角色规则目录与资源定义', value: rules.core, mandatory: true },
      ...rules.actions.map(action => ({ suffix: `action.${action.actionKey}`, title: action.name, value: action, mandatory: false })),
      ...rules.genericChecks.map(check => ({ suffix: `check.${check.checkKey}`, title: check.title, value: check, mandatory: false }))]
    : [
      { suffix: 'knowledge-contract', title: '角色知识边界', mandatory: true,
        value: { schema: 'storyforge.ttrpg-open-knowledge-context', version: 1, actorKey: scope.runtimeActorKey,
          initialObservationsAreReleaseTime: true, onlyObservedGrantsPassEvidenceGates: true, otherActorSecretsExcluded: true } },
      ...initialObservations.map((observation, index) => ({ suffix: `initial.${index}`, title: `${observation.subjectRef} · ${observation.predicateKey}`, value: observation, mandatory: false })),
      ...knowledge.map((entry, index) => ({ suffix: `knowledge.${index}`, title: entry.title, value: entry, mandatory: false })),
    ]
  const fingerprint = await hashCanonicalValue({ scope, runtimeSourceHash: context.readEvidence.runtimeSourceHash,
    stateHash: context.readEvidence.stateHash, visibilityHash: context.visibilityHash })
  const cacheKey = `${sourceKey}:${fingerprint}`
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached
  const policyHash = await hashCanonicalValue({ sourceKey, actorKey: scope.runtimeActorKey, originalRead: false, fullIsAtomic: true })
  const resources = await Promise.all(rows.map(async row => {
    const content = canonicalStringify(row.value), contentHash = await sha256Text(content), tokenCount = estimateTokens(content)
    const descriptor: ContextResourceDescriptorV1 = { version: 1, resourceKey: `${prefix}:${row.suffix}`, sourceKey,
      kind: 'fact', title: row.title, shortSummary: row.title, authority: 'confirmed-evidence',
      contentRevision: context.readEvidence.sequence, contentHash, policyRevision: 1, policyHash,
      scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: scope.runtimeActorKey }, relations: [],
      sourceRefs: [{ table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId!, field: 'runtimeHeadStateJson',
        revision: context.readEvidence.sequence, contentHash: context.readEvidence.stateHash }],
      tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: row.mandatory ? 'must-read' : 'normal' }
    return { descriptor, content, tokenCount }
  }))
  const result = { fingerprint, resources }
  catalogCache.set(cacheKey, result)
  while (catalogCache.size > 4) catalogCache.delete(catalogCache.keys().next().value!)
  return result
}

function provider(sourceKey: SourceKey): ContextResourceProviderV1 {
  const page = async (input: ResourceListInputV1, query?: string) => {
    const data = await catalog(input.scope, sourceKey)
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error('[ttrpg-open-provider] 目录页上限非法')
    const requestHash = await hashCanonicalValue({ sourceKey, query: query ?? null, kinds: input.kinds ?? null })
    let offset = 0
    if (input.cursor !== undefined) {
      const [hash, request, rawOffset] = input.cursor.split('/')
      if (hash !== data.fingerprint || request !== requestHash || !/^(0|[1-9]\d*)$/.test(rawOffset ?? '')) throw new Error('[ttrpg-open-provider] cursor 已 stale 或不属于此角色/查询')
      offset = Number(rawOffset)
    }
    const rows = data.resources.filter(row => (!input.kinds || input.kinds.includes('fact'))
      && (!query || `${row.descriptor.title} ${row.descriptor.shortSummary}`.includes(query)))
    if (offset > rows.length) throw new Error('[ttrpg-open-provider] cursor 超过目录范围')
    const items = rows.slice(offset, offset + input.limit).map(row => structuredClone(row.descriptor))
    return { version: 1 as const, items, nextCursor: offset + items.length < rows.length ? `${data.fingerprint}/${requestHash}/${offset + items.length}` : null,
      scopeFingerprint: data.fingerprint }
  }
  return { version: 'context-resource-provider-v1', providerId: `storyforge.${sourceKey}`, providerVersion: 'ttrpg-open-actor-provider-v1',
    normalizationVersion: 'ttrpg-open-actor-json-v1', kinds: ['fact'], listMetadata: input => page(input),
    searchMetadata: input => page(input, input.query),
    read: async input => {
      if (input.depth !== 'full') throw new Error('[ttrpg-open-provider] 角色契约与知识 JSON 必须完整读取')
      const data = await catalog(input.scope, sourceKey)
      const row = data.resources.find(row => row.descriptor.resourceKey === input.resourceKey)
      if (!row) throw new Error('[ttrpg-open-provider] 资源不属于当前角色授权视图')
      if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < row.tokenCount) throw new Error('[ttrpg-open-provider] 完整资源超过预算；禁止截断 JSON')
      return { version: 1, descriptor: structuredClone(row.descriptor), depth: 'full', content: row.content,
        contentHash: row.descriptor.contentHash, tokenCount: row.tokenCount, sourceRefs: structuredClone(row.descriptor.sourceRefs) }
    },
    readOriginal: async () => { throw new Error('[ttrpg-open-provider] 禁止角色读取原始 runtime head 或其他角色资料') },
    fingerprint: async scope => (await catalog(scope, sourceKey)).fingerprint }
}
export const TTRPG_OPEN_AUTHORITY_PROVIDER_V1 = provider('ttrpgOpenAuthority')
export const TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1 = provider('ttrpgOpenKnowledge')
