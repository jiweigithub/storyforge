import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import type { ContextResourceDescriptorV1, ContextSourceRefV1 } from '../registry/types'
import type { ProductSourceManifestV2, ProductSourcePlanV1, ProductSourcePlanV2, WorldResourceSelectorV1 } from '../types'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from '../product-production/world-source'
import { hashProductProductionValueV2 } from '../product-production/hash'
import type { ProductSourcePlanBasisV2 } from './source-contracts'

const unique = (values: readonly string[]) => [...new Set(values)].sort()
const same = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)
function fail(detail: string): never { throw new Error(`[product-source-exact] ${detail}`) }
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

async function exactSourcePolicyIdV2(plan: Omit<ProductSourcePlanV2, 'planHash'>): Promise<string> {
  const { gatewayPolicyHash: _derived, gatewayPolicy, ...body } = plan
  const { localReleaseRecordId: _local, ...worldReference } = body.worldReference
  const { policyId: _derivedId, ...policy } = gatewayPolicy
  return `world-source-plan-exact-v2:${await hashCanonicalValue({ ...body, worldReference, gatewayPolicy: policy })}`
}

async function finalizeExactPlan(body: Omit<ProductSourcePlanV2, 'planHash'>): Promise<ProductSourcePlanV2> {
  body.gatewayPolicy = { ...body.gatewayPolicy, policyId: await exactSourcePolicyIdV2(body) }
  body.gatewayPolicyHash = await hashCanonicalValue(body.gatewayPolicy)
  const { localReleaseRecordId: _local, ...reference } = body.worldReference
  const plan = { ...body, planHash: await hashCanonicalValue({ ...body, worldReference: reference }) }
  await (await import('./source-contracts')).validateProductSourcePlan(plan)
  return plan
}

/** New draft identity with exactly the same verified source authority. The
 * product caller proves that its source selection/configuration did not change. */
export async function refreezeExactProductSourcePlanBriefV2(input: {
  plan: ProductSourcePlanV2; briefHash: string; createdAt: number;
}): Promise<ProductSourcePlanV2> {
  await (await import('./source-contracts')).validateProductSourcePlan(input.plan)
  if (!hash(input.briefHash)) fail('新 Brief hash 非法')
  const { planHash: _oldHash, ...body } = structuredClone(input.plan)
  body.compiler.briefHash = input.briefHash
  body.createdAt = input.createdAt
  body.exact.requirements = body.exact.requirements.map(rule => ({ ...rule,
    condition: rule.condition ? { ...rule.condition, briefHash: input.briefHash } : null }))
  return finalizeExactPlan(body)
}

export function exactProductCompilerIdV2(productType: string): string {
  if (productType === 'character-interaction') return 'storyforge.character-interaction.world-compiler'
  if (productType === 'avg') return 'storyforge.avg.world-compiler'
  return fail('产品尚未登记精确来源编译器')
}

/** Release identity, field and content proof are portable; the IndexedDB row
 * number is only a locator and cannot enter an immutable plan hash. */
export async function portableWorldSourceRefsHashV2(refs: readonly ContextSourceRefV1[]): Promise<string> {
  if (!refs.length || refs.some(ref => ref.table !== 'worldReleases')) fail('来源证据必须来自冻结世界')
  return hashCanonicalValue(refs.map(({ recordId: _localLocator, ...ref }) => ref))
}

export function exactSelectorMatchesV2(selector: WorldResourceSelectorV1, descriptor: ContextResourceDescriptorV1): boolean {
  const semantic = descriptor.worldSemantic
  if (!semantic || (selector.areas.length && !selector.areas.includes(semantic.area))
    || (selector.resourceKinds.length && !selector.resourceKinds.includes(semantic.resourceKind))
    || (selector.contextKinds.length && !selector.contextKinds.includes(descriptor.kind))) return false
  const query = selector.query?.trim().toLocaleLowerCase('zh-CN')
  return !query || [descriptor.title, descriptor.shortSummary, semantic.area, semantic.resourceKind]
    .join('\n').toLocaleLowerCase('zh-CN').includes(query)
}

export function exactResourcePermittedV2(plan: Pick<ProductSourcePlanV1, 'permission'>, descriptor: ContextResourceDescriptorV1): boolean {
  return plan.permission.allowedSelectors.some(selector => exactSelectorMatchesV2(selector, descriptor))
    && !plan.permission.prohibitedSelectors.some(selector => exactSelectorMatchesV2(selector, descriptor))
    && plan.permission.allowedContextKinds.includes(descriptor.kind)
    && !!descriptor.worldSemantic && plan.permission.allowedAreas.includes(descriptor.worldSemantic.area)
}

async function exactCatalog(input: {
  plan: ProductSourcePlanBasisV2
  authorResourceKeys: readonly string[]
  descriptors: readonly ContextResourceDescriptorV1[]
}) {
  const authorResourceKeys = unique(input.authorResourceKeys)
  if (!authorResourceKeys.length || authorResourceKeys.length !== input.authorResourceKeys.length) fail('作者选择为空或重复')
  const closure = resolveProductProductionWorldCompilationDescriptorsV2({
    descriptors: input.descriptors, selection: { resourceKeys: authorResourceKeys },
  })
  for (const item of closure) {
    if (!exactResourcePermittedV2(input.plan, item)) fail(`required/prohibited 或权限冲突:${item.resourceKey}`)
    if (!item.availableDepths.includes('original')) fail(`缺少必读原文能力:${item.resourceKey}`)
  }
  const requiredResourceKeys = unique(closure.map(item => item.resourceKey))
  const dependencyResourceKeys = requiredResourceKeys.filter(key => !authorResourceKeys.includes(key))
  const resources = await Promise.all(closure.map(async item => ({ resourceKey: item.resourceKey,
    minimumDepth: 'original' as const, contentHash: item.contentHash,
    area: item.worldSemantic!.area, resourceKind: item.worldSemantic!.resourceKind, contextKind: item.kind,
    sourceRefsHash: await portableWorldSourceRefsHashV2(item.sourceRefs) })))
  return { authorResourceKeys, dependencyResourceKeys, requiredResourceKeys, resources,
    closureHash: await hashCanonicalValue({ resolverVersion: input.plan.worldReference.version === 2 ? 'narrative-neutral-closure-v1' : 'world-neutral-closure-v2',
      authorResourceKeys, dependencyResourceKeys, resources }) }
}

/** Called with the same verified neutral catalog as the existing compiler.
 * Never reduces A or D to fit permission/budget. */
export async function freezeExactProductSourcePlanV2(input: ({ base: ProductSourcePlanV1; basis?: never }
  | { basis: ProductSourcePlanBasisV2; base?: never }) & {
  briefHash: string
  configuration: ProductSourcePlanV2['configuration']
  authorResourceKeys: readonly string[]
  descriptors: readonly ContextResourceDescriptorV1[]
}): Promise<ProductSourcePlanV2> {
  const base = input.base ? await (async () => {
    await (await import('./source-contracts')).validateProductSourcePlanV1(input.base!)
    const { planHash: _oldHash, version: _version, ...body } = input.base!
    return body
  })() : input.basis
  const compilerId = exactProductCompilerIdV2(base.productType)
  if (!hash(input.briefHash)) fail('Brief hash 非法')
  const configuration = { ...input.configuration, roleBindings: Object.fromEntries(Object.entries(input.configuration.roleBindings)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => [key, unique(values)])) }
  const compiled = await exactCatalog({ plan: base, authorResourceKeys: input.authorResourceKeys, descriptors: input.descriptors })
  const required = new Set(compiled.requiredResourceKeys)
  if (Object.values(configuration.roleBindings).flat().some(key => !required.has(key))) fail('角色绑定超出作者确认的精确选择')
  const descriptors = input.descriptors.filter(item => required.has(item.resourceKey))
  const requirements: ProductSourcePlanV2['exact']['requirements'] = base.requirements.map(rule => {
    const rawConditionKey = rule.condition?.key
    const conditionKey = rawConditionKey === 'inheritStoryContinuity' || rawConditionKey === 'allowCrossWorld'
      ? rawConditionKey : rawConditionKey == null ? null : fail('条件表达式未登记')
    const active = rule.level === 'stable-required' || (rule.level === 'conditional' && rule.condition?.active)
    const keys = active ? descriptors.filter(item => exactSelectorMatchesV2(rule.selector, item)).map(item => item.resourceKey).sort() : []
    if (active && keys.length < rule.minimumResources) fail(`必读条件在精确选择中未满足:${rule.key}`)
    return { requirementKey: rule.key, requiredResourceKeys: keys, condition: conditionKey ? {
      expressionVersion: 'brief-derived-boolean-v1', field: conditionKey,
      value: configuration[conditionKey], result: configuration[conditionKey], briefHash: input.briefHash,
    } : null }
  })
  const sliceKeys = (keys: readonly string[]) => base.worldReference.version === 2
    ? resolveProductProductionWorldCompilationDescriptorsV2({ descriptors: input.descriptors,
      selection: { resourceKeys: [...keys] } }).map(item => item.resourceKey)
    : unique(keys)
  const adaptation = sliceKeys(base.initialResourceKeys)
  const content = sliceKeys(compiled.authorResourceKeys)
  if ([...adaptation, ...content].some(key => !required.has(key))) fail('任务切片超出完整编译闭包')
  // Existing deterministic integration consumes the full original closure.
  // Refuse before starting if the frozen total cannot fit its explicit budget.
  const originalTokens = descriptors.reduce((sum, item) => sum + (item.tokenEstimate.original ?? Number.POSITIVE_INFINITY), 0)
  const originalCalls = descriptors.reduce((sum, item) => sum + item.sourceRefs.length, 0)
  if (originalTokens > base.gatewayPolicy.maxRetrievedTokens || originalCalls > base.gatewayPolicy.maxReadCalls) {
    fail('精确必读集合超过冻结读取预算；请调整 Brief，不能静默截断选择')
  }
  const body: Omit<ProductSourcePlanV2, 'planHash'> = { ...base, version: 2,
    compiler: { compilerId, compilerVersion: 1, briefHash: input.briefHash,
      configurationHash: await hashCanonicalValue(configuration), resolverVersion: base.worldReference.version === 2 ? 'narrative-neutral-closure-v1' : 'world-neutral-closure-v2' },
    configuration,
    exact: { ...compiled, permittedResourceKeys: [...compiled.requiredResourceKeys], requirements,
      slices: [{ key: 'adaptation', purpose: '产品内容起草使用已确认的起始资料', resourceKeys: adaptation },
        { key: 'content', purpose: '产品叙事与角色内容使用作者选入的原文', resourceKeys: content },
        { key: 'integration', purpose: '确定性产品编译与发布核验完整原文闭包', resourceKeys: [...compiled.requiredResourceKeys] }],
      views: ['canon'], audiences: ['product-author'], branches: ['canon'], timeBound: null },
  }
  // Bind actual Manifest.policyHash to every frozen plan input without a
  // self-referential planHash. A new Brief/selection cannot reuse an old run.
  return finalizeExactPlan(body)
}

/** Portable structural verification in addition to the shared plan hash,
 * permission and reference checks. Physical catalog verification is separate. */
export async function validateExactSourcePlanFieldsV2(plan: ProductSourcePlanV2): Promise<void> {
  const { planHash: _planHash, ...body } = plan
  if (plan.gatewayPolicy.policyId !== await exactSourcePolicyIdV2(body)) fail('读取策略未绑定精确计划输入')
  const exact = plan.exact
  if (plan.compiler.compilerId !== exactProductCompilerIdV2(plan.productType) || plan.compiler.compilerVersion !== 1
    || plan.compiler.resolverVersion !== (plan.worldReference.version === 2 ? 'narrative-neutral-closure-v1' : 'world-neutral-closure-v2') || !hash(plan.compiler.briefHash)
    || plan.compiler.configurationHash !== await hashCanonicalValue(plan.configuration)) fail('编译器/配置合同不一致')
  for (const values of [exact.authorResourceKeys, exact.dependencyResourceKeys, exact.requiredResourceKeys, exact.permittedResourceKeys]) {
    if (!same(values, unique(values))) fail('精确资源集合不是 canonical keys')
  }
  if (!exact.authorResourceKeys.length || exact.dependencyResourceKeys.some(key => exact.authorResourceKeys.includes(key))
    || !same(unique([...exact.authorResourceKeys, ...exact.dependencyResourceKeys]), exact.requiredResourceKeys)
    || !same(exact.requiredResourceKeys, exact.permittedResourceKeys)
    || !same(exact.resources.map(item => item.resourceKey), exact.requiredResourceKeys)) fail('A∪D 与精确 required/permission 不一致')
  if (exact.resources.some(item => item.minimumDepth !== 'original' || !hash(item.contentHash) || !hash(item.sourceRefsHash)
    || !plan.permission.allowedAreas.includes(item.area) || !plan.permission.allowedContextKinds.includes(item.contextKind)
    || typeof item.resourceKind !== 'string' || !item.resourceKind)) fail('必读能力、深度或证据 hash 非法')
  const closureHash = await hashCanonicalValue({ resolverVersion: plan.compiler.resolverVersion,
    authorResourceKeys: exact.authorResourceKeys, dependencyResourceKeys: exact.dependencyResourceKeys, resources: exact.resources })
  if (closureHash !== exact.closureHash || !same(exact.views, ['canon']) || !same(exact.audiences, ['product-author'])
    || !same(exact.branches, ['canon']) || exact.timeBound !== null) fail('闭包或读取视角合同不一致')
  if (Object.values(plan.configuration.roleBindings).flat().some(key => !exact.authorResourceKeys.includes(key))) fail('角色绑定超出选择')
  if (exact.requirements.length !== plan.requirements.length) fail('精确规则缺失')
  for (const [index, rule] of plan.requirements.entries()) {
    const frozen = exact.requirements[index]!
    if (frozen.requirementKey !== rule.key || !same(frozen.requiredResourceKeys, unique(frozen.requiredResourceKeys))
      || frozen.requiredResourceKeys.some(key => !exact.requiredResourceKeys.includes(key))) fail('精确规则资源不一致')
    if (rule.condition) {
      const condition = frozen.condition
      if (!condition || condition.expressionVersion !== 'brief-derived-boolean-v1'
        || !['inheritStoryContinuity', 'allowCrossWorld'].includes(condition.field)
        || condition.field !== rule.condition.key || condition.briefHash !== plan.compiler.briefHash
        || typeof condition.value !== 'boolean' || condition.value !== plan.configuration[condition.field]
        || condition.result !== condition.value || condition.result !== rule.condition.active) fail('条件与冻结 Brief 配置不一致')
    } else if (frozen.condition) fail('无条件规则包含可切换条件')
    const active = rule.level === 'stable-required' || (rule.level === 'conditional' && rule.condition?.active)
    if (active ? frozen.requiredResourceKeys.length < rule.minimumResources : frozen.requiredResourceKeys.length !== 0) fail('精确规则必读集合不完整')
  }
  if (!same(exact.slices.map(slice => slice.key), ['adaptation', 'content', 'integration'])
    || !same(exact.slices[2]!.resourceKeys, exact.requiredResourceKeys)
    || (plan.worldReference.version === 1 && (!same(exact.slices[1]!.resourceKeys, exact.authorResourceKeys)
      || !same(exact.slices[0]!.resourceKeys, unique(plan.initialResourceKeys))))
    || exact.authorResourceKeys.some(key => !exact.slices[1]!.resourceKeys.includes(key))
    || plan.initialResourceKeys.some(key => !exact.slices[0]!.resourceKeys.includes(key))
    || exact.slices.some(slice => !slice.purpose.trim() || !same(slice.resourceKeys, unique(slice.resourceKeys))
      || slice.resourceKeys.some(key => !exact.requiredResourceKeys.includes(key)))) fail('任务切片未闭合')
}

export async function assertExactProductSourceCatalogV2(plan: ProductSourcePlanV2, descriptors: readonly ContextResourceDescriptorV1[]): Promise<void> {
  const actual = await exactCatalog({ plan, authorResourceKeys: plan.exact.authorResourceKeys, descriptors })
  if (actual.closureHash !== plan.exact.closureHash) fail('冻结依赖闭包或证据已变化')
  if (plan.worldReference.version === 2) for (const [index, keys] of [plan.initialResourceKeys, plan.exact.authorResourceKeys].entries()) {
    const expected = resolveProductProductionWorldCompilationDescriptorsV2({ descriptors, selection: { resourceKeys: [...keys] } })
      .map(item => item.resourceKey)
    if (!same(expected, plan.exact.slices[index]!.resourceKeys)) fail('叙事任务切片缺少必需证据闭包')
  }
  for (const [index, rule] of plan.requirements.entries()) {
    const active = rule.level === 'stable-required' || (rule.level === 'conditional' && rule.condition?.active)
    const expected = active ? descriptors.filter(item => actual.requiredResourceKeys.includes(item.resourceKey)
      && exactSelectorMatchesV2(rule.selector, item)).map(item => item.resourceKey).sort() : []
    if (!same(expected, plan.exact.requirements[index]!.requiredResourceKeys)) fail('精确规则与冻结来源不一致')
  }
}

export async function exactManifestEvidenceV2(plan: ProductSourcePlanV2): Promise<ProductSourceManifestV2['exactEvidence']> {
  return { compilerHash: await hashCanonicalValue(plan.compiler), closureHash: plan.exact.closureHash,
    requiredResourceKeys: [...plan.exact.requiredResourceKeys], resourceRequirementsHash: await hashCanonicalValue(plan.exact.resources) }
}

export async function assertExactSourceManifestV2(plan: ProductSourcePlanV2, manifest: ProductSourceManifestV2): Promise<void> {
  if (!same(await exactManifestEvidenceV2(plan), manifest.exactEvidence)) fail('实际来源清单未绑定精确计划')
  const byKey = new Map(manifest.resources.map(item => [item.resourceKey, item]))
  if (byKey.size !== manifest.resources.length || manifest.resources.some(item => !plan.exact.permittedResourceKeys.includes(item.resourceKey))) fail('实际读取越过精确权限或存在重复')
  const pointerHashes = new Set(manifest.runContextManifests.map(item => item.manifestHash))
  for (const required of plan.exact.resources) {
    const read = byKey.get(required.resourceKey)
    if (!read || read.status !== 'matched' || !read.depths.includes(required.minimumDepth)
      || read.area !== required.area || read.resourceKind !== required.resourceKind
      || !same(read.contentHashes, [required.contentHash]) || read.sourceRefsHash !== required.sourceRefsHash
      || !read.contextManifestHashes.length || read.contextManifestHashes.some(value => !pointerHashes.has(value))) {
      fail(`缺少精确必读原文/深度/hash/真实 manifest 证据:${required.resourceKey}`)
    }
  }
  if (manifest.requirementOutcomes.length !== plan.requirements.length) fail('需求读取结果缺失')
  for (const [index, rule] of plan.requirements.entries()) {
    const outcome = manifest.requirementOutcomes[index]!
    if (outcome.requirementKey !== rule.key) fail('需求读取结果身份不一致')
    const active = rule.level === 'stable-required' || (rule.level === 'conditional' && rule.condition?.active)
    if (active && (outcome.status !== 'matched'
      || !same(outcome.evidenceResourceKeys, plan.exact.requirements[index]!.requiredResourceKeys))) fail('必读需求未按精确集合核验')
    if ((rule.level === 'prohibited' || (rule.level === 'conditional' && !rule.condition?.active))
      && (outcome.status !== 'omitted' || outcome.evidenceResourceKeys.length)) fail('禁止/未激活需求不能伪造读取结果')
  }
  for (const status of ['matched', 'missing', 'conflict', 'omitted', 'insufficient'] as const) {
    if (manifest.summary[status] !== manifest.requirementOutcomes.filter(item => item.status === status).length) fail('需求结果统计不一致')
  }
}

/** Shared by backup export/import before mutation. Existing V1/creator rows
 * retain their compatibility policy; enhanced/unknown world-plan versions
 * cannot enter storage with an unchecked embedded contract. */
export async function validateEnhancedProductSourcePlanRecordV2(row: {
  sourcePlanJson: string; sourcePlanHash: string; briefJson: string; briefHash: string;
  sourceWorldReleaseId: number; sourceWorldContentHash: string;
}): Promise<ProductSourcePlanV2 | null> {
  const value = JSON.parse(row.sourcePlanJson)
  if (value?.schema !== 'storyforge.product-source-plan' || value.version === 1) return null
  const contracts = await import('./source-contracts')
  const plan = await contracts.validateProductSourcePlan(value)
  if (plan.version !== 2 || plan.planHash !== row.sourcePlanHash || plan.compiler.briefHash !== row.briefHash
    || await hashProductProductionValueV2(JSON.parse(row.briefJson)) !== row.briefHash
    || plan.worldReference.localReleaseRecordId !== row.sourceWorldReleaseId
    || plan.worldReference.releaseHash !== row.sourceWorldContentHash) fail('Brief/精确 SourcePlan/世界 locator 或 hash 不一致')
  return plan
}
