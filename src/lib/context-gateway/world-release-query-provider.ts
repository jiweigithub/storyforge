import { db } from '../db/schema'
import { estimateTokens } from '../ai/context-budget'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import type { ContextResourceDescriptorV1, ContextResourceKind, ContextResourceProviderV1, ContextSourceRefV1,
  FrozenResourceScopeV1, ResourceListInputV1, ResourceSearchInputV1, WorldCapabilityArea } from '../registry/types'
import { CONTEXT_RESOURCE_KINDS_V1 } from '../registry/types'
import type { OpenAuthorWorldQueryInputV1, WorldQueryAccessV1, WorldQueryGrantV1, WorldQueryItemV1, WorldQueryProviderProtocolV1, WorldQueryV1 } from '../types/world-query'
import type { NarrativeRecordV1 } from '../types/narrative-ir'
import { readWorldNarrativeIndexV1, type WorldNarrativeIndexReadV1 } from '../world-engine/narrative-index-cache'
import { referenceForVerifiedWorldReleaseV2, validatePortableWorldReferenceV2 } from '../world-engine/world-reference-v2'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1, hashNarrativeValueV1 } from '../world-engine/narrative-json'
import { parseWorldQueryGrantV1, worldQueryFailV1 } from './world-query-contract'
import { createWorldQueryEvaluatorV1 } from './world-query-evaluator'
import { frozenAuthorSourceTitlesV1 } from './world-query-source-titles'
import { buildWorldQueryVisibilityV1 } from './world-query-visibility'
import { WORLD_RELEASE_NORMALIZATION_VERSION_V1, WORLD_RELEASE_PROVIDER_ID_V1, WORLD_RELEASE_PROVIDER_VERSION_V1, WORLD_RELEASE_RESOURCE_KINDS_V1 } from './world-release-provider-contract'

interface AuthorizationV1 {
  source: WorldNarrativeIndexReadV1
  access: WorldQueryAccessV1
  grant: WorldQueryGrantV1
  evaluate: ReturnType<typeof createWorldQueryEvaluatorV1>
  byId: Map<string, NarrativeRecordV1>
  byResourceKey: Map<string, string>
  resourceKey: Map<string, string>
}
const authorizations = new WeakMap<WorldQueryAccessV1, AuthorizationV1>()
const descriptorContexts = new WeakMap<AuthorizationV1, {
  records: NarrativeRecordV1[]; positions: Map<string, number>; visible: Set<number>; evidenceVisible: Set<number>; required: Map<number, number[]>
  chunks: Map<string, NonNullable<WorldNarrativeIndexReadV1['verified']['index']>['indexes']['chunks']>
}>()
const evidenceSourceKey = (value: { sourceResourceKey: string; fieldPointer: string; sourceRevision: string }) =>
  canonicalNarrativeJsonV1([value.sourceResourceKey, value.fieldPointer, value.sourceRevision])
const same = (left: unknown, right: unknown) => canonicalNarrativeJsonV1(left) === canonicalNarrativeJsonV1(right)
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value) }
  return value
}
async function authorized(access: WorldQueryAccessV1, scope?: FrozenResourceScopeV1): Promise<AuthorizationV1> {
  const state = authorizations.get(access)
  if (!state) worldQueryFailV1('access-unavailable', '读取授权不存在或已失效')
  if (scope && (scope.projectId !== state.access.scope.projectId || scope.worldId !== state.access.scope.worldId
    || scope.worldReleaseId !== state.access.scope.worldReleaseId || scope.worldReleaseHash !== state.access.scope.worldReleaseHash
    || scope.productRuntimeSessionId !== state.access.scope.productRuntimeSessionId)) worldQueryFailV1('access-unavailable', '读取作用域不匹配')
  const current = await db.worldReleases.get(state.source.release.id!)
  if (!current || current.projectId !== state.source.release.projectId || current.worldId !== state.source.release.worldId
    || current.sourceWorldCode !== state.source.release.sourceWorldCode || current.version !== state.source.release.version
    || current.manifestJson !== state.source.release.manifestJson || current.contentHash !== state.source.release.contentHash
    || current.releaseUid !== state.source.release.releaseUid) worldQueryFailV1('stale', '冻结世界版本已变化或删除，请重新打开')
  if (authorizations.get(access) !== state) worldQueryFailV1('access-unavailable', '读取授权不存在或已失效')
  return state
}
function defaultQuery(state: AuthorizationV1): WorldQueryV1 {
  return { schema: 'storyforge.world-query', version: 1, worldReference: state.access.reference, sourcePlanHash: state.grant.sourcePlanHash,
    view: state.access.view, perspective: state.access.perspective, branch: { kind: 'canon', key: state.grant.branchKey },
    mode: 'search', text: null, kinds: [], entityKeys: [], storyArcKeys: [], time: null, evidenceDepth: 'metadata',
    relationExpansion: { kinds: [], maxHops: 0, maxNodes: 500 }, causalDepth: 0,
    budget: { maxTokens: state.grant.maxTokens, maxRecords: state.grant.maxRecords, maxEvidenceBytes: state.grant.maxEvidenceBytes }, cursor: null }
}
function contextKind(record: NarrativeRecordV1): ContextResourceKind {
  if (record.kind === 'entity') return ({ character: 'character', location: 'location', 'codex-entry': 'codex-entry', 'world-group': 'world' } as const)[record.payload.entityType]
  if (record.kind === 'relation' || record.kind === 'epistemic-event') return 'character-relation'
  if (record.kind === 'development') return record.payload.developmentType === 'thread' ? 'story-arc' : 'foreshadow'
  if (record.kind === 'disclosure') return 'chapter'
  return 'fact'
}
function area(record: NarrativeRecordV1): WorldCapabilityArea {
  const kind = contextKind(record)
  if (kind === 'character') return 'characters'
  if (kind === 'character-relation') return 'relations'
  if (kind === 'world') return 'multi-world'
  if (kind === 'story-arc' || kind === 'foreshadow') return 'storylines'
  if (kind === 'chapter') return 'manuscript'
  return kind === 'codex-entry' || kind === 'location' ? 'entities' : 'story'
}
async function descriptor(state: AuthorizationV1, item: WorldQueryItemV1): Promise<ContextResourceDescriptorV1> {
  const record = state.byId.get(item.semanticId)!, resourceKey = state.resourceKey.get(item.semanticId)!
  const projection = state.source.verified.manifest.narrative, index = state.source.verified.index!
  let context = descriptorContexts.get(state)
  if (!context) {
    const records = index.indexes.recordKeys.map(key => state.byId.get(key)!)
    const visibility = buildWorldQueryVisibilityV1({ records, index, query: defaultQuery(state),
      grant: state.grant, timeContext: projection.bundle.timeContext,
      knowledgeProjectionVersion: state.source.verified.manifest.compilerVersion === 'narrative-domain-v2' ? 2 : 1 })
    const chunks = new Map<string, typeof index.indexes.chunks>()
    for (const chunk of index.indexes.chunks) {
      const key = evidenceSourceKey(chunk), group = chunks.get(key) ?? []
      group.push(chunk); chunks.set(key, group)
    }
    context = { records, positions: new Map(index.indexes.recordKeys.map((key, position) => [key, position])), chunks, ...visibility }
    descriptorContexts.set(state, context)
  }
  const { records, visible, evidenceVisible, required, chunks } = context
  const position = context.positions.get(item.semanticId)!
  const dependencies = new Set(required.get(position) ?? [])
  // A shared original must be authorized for every co-resident consumer,
  // independently of which atoms this view can return. An author-only proof
  // consumer outside the view is not a readable resource dependency. Product,
  // reader and character grants keep evidenceVisible === visible, so their
  // exact dependency closure and permission boundary remain unchanged.
  for (const span of item.evidence) for (const chunk of chunks.get(evidenceSourceKey(span)) ?? []) {
    if (chunk.start < span.end && chunk.end > span.start) {
      for (const target of chunk.recordIndexes) {
        if (!evidenceVisible.has(target)) worldQueryFailV1('access-unavailable', '原文证据在当前授权下不完整')
        if (visible.has(target)) dependencies.add(target)
      }
    }
  }
  dependencies.delete(position)
  if ([...dependencies].some(target => !visible.has(target))) worldQueryFailV1('access-unavailable', '资源依赖在当前授权下不完整')
  const requiredResourceKeys = [...dependencies].map(target => state.resourceKey.get(records[target].semanticId)!).sort()
  const relationEndpoints: [string, string] | null = record.kind === 'relation'
    ? [state.resourceKey.get(record.payload.fromRef.semanticId)!, state.resourceKey.get(record.payload.toRef.semanticId)!] : null
  const sourceRefs: ContextSourceRefV1[] = item.evidence.map(span => ({ table: 'worldReleases', recordId: state.source.release.id!,
    field: `narrative-evidence:${span.evidenceId}`, revision: state.source.release.version,
    contentHash: span.spanHash, anchor: { start: span.start, end: span.end, quoteHash: span.spanHash } }))
  if (!sourceRefs.length) sourceRefs.push({ table: 'worldReleases', recordId: state.source.release.id!,
    field: `narrative-atom:${item.semanticId}`, revision: state.source.release.version, contentHash: item.revisionHash })
  // Content identity follows the authorized materialization. Policy identity
  // remains separate: binding a frozen plan must not recursively change the
  // very resource hash that plan freezes.
  const contentHash = await hashNarrativeValueV1({ semanticId: item.semanticId, revisionHash: item.revisionHash,
    view: state.access.view, perspective: state.access.perspective, title: item.title, summary: item.summary,
    evidence: item.evidence.map(({ text: _text, ...span }) => span), originalAvailable: item.originalAvailable,
    neutralClosure: { requiredResourceKeys, relationEndpoints } })
  return { version: 1, resourceKey, sourceKey: 'worldRelease', kind: contextKind(record), title: item.title, shortSummary: Array.from(item.summary).slice(0, 400).join(''),
    authority: item.authority === 'author-declared' ? 'author-canon' : 'adopted-canon', contentRevision: item.revisionHash, contentHash, policyRevision: 1, policyHash: state.access.policyHash,
    scope: { projectId: state.source.release.projectId, worldId: state.source.release.worldId,
      worldReleaseId: state.source.release.id!, worldReleaseHash: state.source.release.contentHash },
    worldSemantic: { area: area(record), resourceKind: record.kind, resourceCoordinate: item.semanticId,
      ...(item.authorSource ? { authorSource: structuredClone(item.authorSource) } : {}),
      narrative: { version: 1, resolverVersion: 'narrative-neutral-closure-v1', requiredResourceKeys, relationEndpoints } },
    sourceRefs, relations: requiredResourceKeys.map(targetResourceKey => ({ kind: 'depends-on', direction: 'outgoing', targetResourceKey })),
    tokenEstimate: { index: estimateTokens(`${authorSourceHeader(item)}${item.title}\n${item.summary}`),
      summary: estimateTokens(`${authorSourceHeader(item)}${item.summary}`),
      // UTF-8 bytes safely bound the estimator, including original bundle
      // escaping and field/hash framing. No source text crosses metadata.
      original: item.originalAvailable ? item.evidence.reduce((sum, span) => sum + 2 * (span.end - span.start)
        + 2 * (`narrative-evidence:${span.evidenceId}`.length + span.spanHash.length) + 64, 128)
        + (item.authorSource ? estimateTokens(canonicalNarrativeJsonV1({ authorSource: item.authorSource })) : 0) : undefined },
    availableDepths: item.originalAvailable ? ['index', 'summary', 'focused', 'full', 'original'] : ['index', 'summary', 'focused', 'full'], priority: 'normal' }
}
function getId(state: AuthorizationV1, resourceKey: string): string {
  return state.byResourceKey.get(resourceKey) ?? worldQueryFailV1('access-unavailable', '请求的资源身份不可用')
}
async function locate(state: AuthorizationV1, id: string, depth: WorldQueryV1['evidenceDepth'] = 'metadata') {
  const query = { ...defaultQuery(state), evidenceDepth: depth }
  const result = await state.evaluate(query, state.grant, id)
  const item = result.items.find(item => item.semanticId === id)
  if (!item) worldQueryFailV1(result.status === 'insufficient' ? 'original-budget' : 'access-unavailable', '资源或完整证据在当前授权下不可用')
  return { item, descriptor: await descriptor(state, item) }
}
function budget(maxTokens: number): void {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 100000) worldQueryFailV1('budget', '读取预算无效')
}
function authorSourceHeader(item: WorldQueryItemV1): string {
  return item.authorSource ? `封存来源（目录元数据）：${canonicalNarrativeJsonV1(item.authorSource)}\n` : ''
}
function metadataWithinBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text
  const scalars = Array.from(text), marker = '…'
  let low = 0, high = scalars.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (estimateTokens(scalars.slice(0, mid).join('') + marker) <= maxTokens) low = mid
    else high = mid - 1
  }
  return scalars.slice(0, low).join('') + marker
}

async function openWorldQueryAccess(input: OpenAuthorWorldQueryInputV1, purpose: WorldQueryGrantV1['purpose']): Promise<WorldQueryAccessV1> {
    if (input.scope.productRuntimeSessionId !== undefined) worldQueryFailV1('access-unavailable', '运行期不能申请作者授权')
    const source = await readWorldNarrativeIndexV1({ projectId: input.scope.projectId, worldId: input.scope.worldId, releaseId: input.localReleaseRecordId })
    if (!source.release.id || !source.verified.index) worldQueryFailV1('unsupported', '此世界版本没有可查询的叙事索引')
    const reference = await referenceForVerifiedWorldReleaseV2({ ...source.release, id: source.release.id }, source.verified.manifest)
    await validatePortableWorldReferenceV2(reference)
    const grant = parseWorldQueryGrantV1({ version: 1, releaseReferenceHash: reference.referenceHash, sourcePlanHash: null,
      purpose, views: [input.view], perspective: input.perspective,
      audienceKeys: input.perspective.kind === 'character' ? [`character:${input.perspective.characterKey}`] : [input.perspective.kind],
      allowedSemanticIds: null, branchKey: source.verified.manifest.narrative.bundle.scope.branchKey,
      knowledgeThrough: input.knowledgeThrough, disclosedThrough: input.disclosedThrough,
      maxTokens: 100000, maxRecords: 500, maxEvidenceBytes: 4 * 1024 * 1024, policyRevision: purpose === 'author-review' ? 'local-author-world-query-v6' : 'product-preparation-world-query-v1' })
    const scope: FrozenResourceScopeV1 = { projectId: input.scope.projectId, worldId: input.scope.worldId,
      worldReleaseId: source.release.id, worldReleaseHash: source.release.contentHash }
    const policyHash = await hashCanonicalValue(grant), coverage = source.verified.manifest.narrative.coverage
    const timeContext = source.verified.manifest.narrative.bundle.timeContext
    const access: WorldQueryAccessV1 = freeze({ version: 1, scope, reference, view: input.view, perspective: structuredClone(input.perspective), branchKey: grant.branchKey, purpose, sourcePlanHash: grant.sourcePlanHash, policyHash,
      scopeFingerprint: await hashCanonicalValue({ scope, policyHash, referenceHash: reference.referenceHash, providerVersion: WORLD_RELEASE_PROVIDER_VERSION_V1 }),
      capabilities: { queryVersion: 'world-query-v1', operations: ['search', 'state-at', 'events', 'traverse'],
        axes: ['occurred', 'valid', 'acquired', 'narrated', 'disclosed'], deterministic: true, embeddingsRequired: false, simulation: false,
        coverage: input.perspective.kind === 'author' && purpose === 'author-review' ? { declaredAtoms: coverage.declaredAtoms, projectedAtoms: coverage.projectedAtoms,
          unsupportedSources: coverage.explicitlyUnsupportedSourceKeys.length,
          unannotatedBytes: coverage.sourceSpans.reduce((sum, source) => sum + source.uncovered.reduce((sum, span) => sum + span.end - span.start, 0), 0) } : null,
        timeChoices: input.perspective.kind === 'author' && purpose === 'author-review' ? { timelines: timeContext.timelines.map(timeline => ({ key: timeline.timelineKey, label: `${timeline.calendar} · ${timeline.unit}` })),
          sequences: timeContext.sequences.map(sequence => ({ key: sequence.sequenceKey, units: sequence.units.map(unit => ({ key: unit.unitKey, ordinal: unit.ordinal })) })) } : null } })
    const projection = source.verified.manifest.narrative
    // These release and semantic identities have already passed full scalar
    // validation. Hash the identical raw UTF-8 formula with the bounded codec
    // instead of queuing one independent WebCrypto task for every record.
    const resourceKey = new Map<string, string>()
    for (const record of projection.bundle.records) resourceKey.set(record.semanticId,
      `world-narrative:${await hashNarrativeBytesV1(`${reference.releaseUid}\n${record.semanticId}`)}`)
    const state: AuthorizationV1 = { source, access, grant, evaluate: createWorldQueryEvaluatorV1({ reference, projection, index: source.verified.index,
      authorSourceTitles: frozenAuthorSourceTitlesV1(source.verified.manifest) }),
      byId: new Map(projection.bundle.records.map(record => [record.semanticId, record])), resourceKey,
      byResourceKey: new Map([...resourceKey].map(([id, key]) => [key, id])) }
    // Validate perspective/sequence anchors at creation, before issuing access.
    await state.evaluate(defaultQuery(state), grant)
    authorizations.set(access, state)
    return access
}

export const WORLD_RELEASE_QUERY_PROTOCOL_V1: WorldQueryProviderProtocolV1 = {
  openAuthor: input => openWorldQueryAccess(input, 'author-review'),
  openPreparation(input) {
    if (!['character-interaction', 'avg'].includes(input.productType)) worldQueryFailV1('unsupported', '此产品尚未登记叙事世界编译器')
    return openWorldQueryAccess({ scope: input.scope, localReleaseRecordId: input.localReleaseRecordId,
      view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null }, 'product-preparation')
  },
  async openProduction(input) {
    const plan = await (await import('../product/source-contracts')).validateProductSourcePlan(input.sourcePlan)
    if (plan.version !== 2 || plan.worldReference.version !== 2) worldQueryFailV1('reference-version', '此授权只接受冻结的 v4 精确计划')
    if (plan.readiness !== 'ready') worldQueryFailV1('insufficient', '来源计划尚未满足正式生产必读要求')
    const preparation = await this.openPreparation({ scope: input.scope,
      localReleaseRecordId: plan.worldReference.localReleaseRecordId, productType: plan.productType as 'character-interaction' | 'avg' })
    try {
      const original = await authorized(preparation)
      if (preparation.reference.referenceHash !== plan.worldReference.referenceHash) worldQueryFailV1('stale', '计划与冻结世界不匹配')
      const grant = parseWorldQueryGrantV1({ ...original.grant, purpose: 'product-production', sourcePlanHash: plan.planHash,
        allowedSemanticIds: plan.exact.permittedResourceKeys.map(key => getId(original, key)).sort(),
        maxTokens: Math.min(original.grant.maxTokens, plan.gatewayPolicy.maxRetrievedTokens), policyRevision: plan.gatewayPolicyHash })
      const policyHash = await hashCanonicalValue(grant)
      const access = freeze({ ...preparation, purpose: grant.purpose, sourcePlanHash: plan.planHash, policyHash,
        scopeFingerprint: await hashCanonicalValue({ scope: preparation.scope, policyHash,
          referenceHash: preparation.reference.referenceHash, providerVersion: WORLD_RELEASE_PROVIDER_VERSION_V1 }) })
      const state = { ...original, access, grant }
      const index = original.source.verified.index!, records = index.indexes.recordKeys.map(key => original.byId.get(key)!)
      const { visible } = buildWorldQueryVisibilityV1({ records, index, query: defaultQuery(state), grant,
        timeContext: original.source.verified.manifest.narrative.bundle.timeContext,
        knowledgeProjectionVersion: original.source.verified.manifest.compilerVersion === 'narrative-domain-v2' ? 2 : 1 })
      if (grant.allowedSemanticIds!.some(key => !visible.has(index.indexes.recordKeys.indexOf(key)))) worldQueryFailV1('access-unavailable', '精确计划包含当前产品不可读的资源或依赖')
      authorizations.set(access, state)
      return access
    } finally { authorizations.delete(preparation) }
  },
  async describe(access) {
    const { source } = await authorized(access)
    return { sourceManifestHash: await hashCanonicalValue(source.verified.manifest.sourceManifest),
      identity: { worldCode: source.release.sourceWorldCode, worldName: source.verified.manifest.worldName, workTitle: '',
        releaseVersion: source.release.version, releaseLabel: source.release.label,
        releaseHash: source.release.contentHash, releasedAt: source.release.createdAt } }
  },
  async query(access, query) {
    const state = await authorized(access)
    return state.evaluate(query, state.grant)
  },
  async close(access) { authorizations.delete(access) },
  async bind(access, narrowing) {
    const original = await authorized(access)
    let bound = original
    if (narrowing) {
      if (!Number.isSafeInteger(narrowing.maxTokens) || narrowing.maxTokens < 1
        || narrowing.allowedKinds.some(kind => !CONTEXT_RESOURCE_KINDS_V1.includes(kind))) worldQueryFailV1('budget', 'Gateway 读取约束无效')
      const keys = narrowing.allowedResourceKeys === null ? null : new Set(narrowing.allowedResourceKeys)
      const eligible = [...original.byId.values()].filter(record => original.grant.allowedSemanticIds === null || original.grant.allowedSemanticIds.includes(record.semanticId))
      const selected = eligible.filter(record => narrowing.allowedKinds.includes(contextKind(record))
        && (keys === null || keys.has(original.resourceKey.get(record.semanticId)!))).map(record => record.semanticId).sort()
      const grant = parseWorldQueryGrantV1({ ...original.grant, maxTokens: Math.min(original.grant.maxTokens, narrowing.maxTokens),
        allowedSemanticIds: selected.length === eligible.length ? original.grant.allowedSemanticIds : selected })
      const policyHash = await hashCanonicalValue(grant)
      bound = { ...original, grant, access: { ...access, policyHash,
        scopeFingerprint: await hashCanonicalValue({ scope: access.scope, policyHash, referenceHash: access.reference.referenceHash,
          providerVersion: WORLD_RELEASE_PROVIDER_VERSION_V1 }) } }
    }
    const current = async (scope: FrozenResourceScopeV1) => { await authorized(access, scope); return bound }
    const page = async (input: ResourceListInputV1 | ResourceSearchInputV1) => {
      const state = await current(input.scope)
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) worldQueryFailV1('page', '分页条数必须在 1 到 100')
      if ('timeRange' in input && input.timeRange) worldQueryFailV1('unsupported', '旧时间参数缺少轴或时制；请使用叙事查询')
      if ('query' in input && !input.query.trim()) worldQueryFailV1('query', '搜索 query 不能为空')
      const query = defaultQuery(state)
      query.text = 'query' in input ? input.query : null
      query.entityKeys = 'entityKeys' in input ? (input.entityKeys ?? []).map(key => getId(state, key)) : []
      query.storyArcKeys = 'storyArcKeys' in input ? (input.storyArcKeys ?? []).map(key => getId(state, key)) : []
      query.budget.maxRecords = input.limit
      const pageHash = await hashCanonicalValue({ kinds: input.kinds ?? null, limit: input.limit, policy: state.access.policyHash })
      if (input.cursor) {
        try { const value = JSON.parse(decodeURIComponent(input.cursor))
          if (Object.keys(value).sort().join(',') !== 'cursor,hash' || value.hash !== pageHash || typeof value.cursor !== 'string') throw Error('cursor')
          query.cursor = value.cursor
        } catch { worldQueryFailV1('cursor', '目录游标与类型、预算或授权不一致') }
      }
      const result = await state.evaluate(query, state.grant)
      const items = await Promise.all(result.items.filter(item => !input.kinds?.length || input.kinds.includes(contextKind(state.byId.get(item.semanticId)!)))
        .map(item => descriptor(state, item)))
      return { version: 1 as const, items, scopeFingerprint: state.access.scopeFingerprint,
        nextCursor: result.nextCursor ? encodeURIComponent(JSON.stringify({ hash: pageHash, cursor: result.nextCursor })) : null }
    }
    const provider: ContextResourceProviderV1 = { version: 'context-resource-provider-v1', providerId: WORLD_RELEASE_PROVIDER_ID_V1,
      providerVersion: WORLD_RELEASE_PROVIDER_VERSION_V1, normalizationVersion: WORLD_RELEASE_NORMALIZATION_VERSION_V1,
      kinds: WORLD_RELEASE_RESOURCE_KINDS_V1, listMetadata: page, searchMetadata: page,
      async queryWorldMetadata(input) {
        const state = await current(input.scope)
        if (input.query.evidenceDepth !== 'metadata') worldQueryFailV1('depth', 'Gateway 查询只返回目录；原子和原文必须经实际读取记录证据')
        const result = await state.evaluate(input.query, state.grant)
        return { result, descriptors: await Promise.all(result.items.map(item => descriptor(state, item))) }
      },
      assertAccessCurrent: async scope => { await authorized(access, scope) },
      fingerprint: async scope => (await current(scope)).access.scopeFingerprint,
      async read(input) {
        budget(input.maxTokens)
        const state = await current(input.scope), id = getId(state, input.resourceKey)
        const located = await locate(state, id), { item } = await locate(state, id, input.depth === 'full' || input.depth === 'focused' ? 'atomic' : 'metadata')
        const content = input.depth === 'index' ? metadataWithinBudget(`${authorSourceHeader(item)}${item.title}\n${item.summary}`, input.maxTokens)
          : input.depth === 'summary' ? metadataWithinBudget(`${authorSourceHeader(item)}${item.summary}`, input.maxTokens)
          : canonicalNarrativeJsonV1({ atom: item.atom, supportingAtoms: item.supportingAtoms, modality: item.modality,
            authority: item.authority, evidence: item.evidence, closure: item.closure,
            ...(item.authorSource ? { authorSource: item.authorSource } : {}) })
        if (estimateTokens(content) > input.maxTokens) worldQueryFailV1('budget', '完整资源超过预算，请提高预算或选择较浅读取')
        return { version: 1, descriptor: located.descriptor, depth: input.depth, content,
          contentHash: await sha256Text(content), tokenCount: estimateTokens(content), sourceRefs: located.descriptor.sourceRefs }
      },
      async readOriginal(input) {
        budget(input.maxTokens)
        const state = await current(input.scope), id = getId(state, input.resourceKey), located = await locate(state, id)
        const sourceRef = located.descriptor.sourceRefs.find(ref => same(ref, input.sourceRef))
        if (!sourceRef || !sourceRef.field.startsWith('narrative-evidence:')) worldQueryFailV1('access-unavailable', '原文引用在当前授权下不可用')
        const { item } = await locate(state, id, 'original')
        const span = item.evidence.find(span => `narrative-evidence:${span.evidenceId}` === sourceRef.field)
        if (span?.text === null || !span || await sha256Text(span.text) !== sourceRef.contentHash) worldQueryFailV1('evidence', '原文证据校验失败')
        if (estimateTokens(span.text) > input.maxTokens) worldQueryFailV1('original-budget', '完整原文超过预算；未返回截断内容')
        return { version: 1, descriptor: located.descriptor, sourceRef: structuredClone(sourceRef), content: span.text,
          contentHash: span.spanHash, tokenCount: estimateTokens(span.text) }
      },
    }
    return provider
  },
}
