/** Frozen deterministic rule admission. Model suggestions cannot set difficulty or costs. */
import type { ProductRuntimeState, RulePackV1 } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenGenericCheckV1, TtrpgOpenEffectPlanTemplateV1 } from './open-contract'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseRulePackV1 } from './rule-pack'
import { projectTtrpgRulePackMechanicalCoreV1, parseTtrpgOpenGenericCheckV1 } from './rule-pack-v2'
import { effectTemplate } from './open-content-templates'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { evaluateTtrpgActionRequirementsV2 } from './action-requirement'
import { consumeTtrpgAbilityV2, ttrpgAbilityStateKeyV2 } from './ability-ledger'
import { evaluateTtrpgPredicateV1, type TtrpgPredicateEvaluationContextV1 } from './predicate'
import * as p from './open-contract-parse'

export interface TtrpgOpenRuleRequestV1 {
  route: 'existing-action' | 'generic-check'
  ruleKey: string
  actorKey: string
  targetKey: string | null
  controllerMode: 'human' | 'ai'
  effectBindings: Record<string, Record<string, string | null>>
}
export interface TtrpgOpenRulePlanV1 {
  schema: 'storyforge.ttrpg-open-rule-plan'
  version: 1
  request: TtrpgOpenRuleRequestV1
  epochKey: string
  rulePackContentHash: string
  runtimeSourceHash: string
  authorizationHash: string
  mechanicalStateHash: string
  rulePack: RulePackV1
  genericCheck: TtrpgOpenGenericCheckV1 | null
  effectTemplates: TtrpgOpenEffectPlanTemplateV1[]
  timeCostWorldTurns: number
  affectedActorKeys: string[]
  requiredApprovals: Array<{ actorKey: string; allowedSeatKeys: string[] }>
  skillValues: Record<string, number>
}
function fail(message: string): never { throw new Error(`[ttrpg-open-rule-plan] ${message}`) }

export function parseTtrpgOpenRuleRequestV1(value: unknown): TtrpgOpenRuleRequestV1 {
  const r = p.record(value, ['route', 'ruleKey', 'actorKey', 'targetKey', 'controllerMode', 'effectBindings'], 'rule request')
  const rawBindings = p.object(r.effectBindings, 'effectBindings')
  if (Object.keys(rawBindings).length > 7) fail('effectBindings 超过七档后果')
  const effectBindings = Object.fromEntries(Object.entries(rawBindings).map(([planKey, value]) => {
    const row = p.object(value, 'effect parameter bindings')
    if (Object.keys(row).length > 32) fail('参数槽超过32')
    return [p.key(planKey, 'effect plan key'), Object.fromEntries(Object.entries(row).map(([slot, ref]) =>
      [p.key(slot, 'parameterKey'), p.nullable(ref, p.key, 'parameter binding')]))]
  }))
  return { route: p.oneOf(r.route, ['existing-action', 'generic-check'], 'route'),
    ruleKey: p.key(r.ruleKey, 'ruleKey'), actorKey: p.key(r.actorKey, 'actorKey'),
    targetKey: p.nullable(r.targetKey, p.key, 'targetKey'),
    controllerMode: p.oneOf(r.controllerMode, ['human', 'ai'], 'controllerMode'), effectBindings }
}

/** Only mechanical authorities contribute; confirmations and display events do not stale a plan. */
export async function ttrpgOpenMechanicalStateHashV1(state: ProductRuntimeState): Promise<string> {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) fail('open 团局未启动')
  return hashProductProductionValueV2({ entities: state.entities, conditions: runtime.product.conditions,
    inventory: runtime.product.inventory, abilities: runtime.product.abilityStates, pools: runtime.product.usagePools,
    effectLedger: runtime.product.effectLedger, customizations: runtime.product.characterCustomizations,
    worldTime: runtime.openRun.worldTime, clocks: runtime.openRun.clocks, fronts: runtime.openRun.fronts,
    situations: runtime.openRun.situations, safetyStatus: runtime.product.safety.status })
}

export function ttrpgOpenPredicateContextV1(state: ProductRuntimeState, content: TtrpgRuntimeContentV2): TtrpgPredicateEvaluationContextV1 {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) fail('open 团局未启动')
  const product = runtime.product
  return {
    frozenWorldPredicateIndex: content.campaign.frozenWorldPredicateIndex,
    sessionFacts: [], // P4 facts join this owner explicitly; no invented facts here.
    effectLedger: { storyFacts: product.effectLedger.storyFacts, socialBalances: product.effectLedger.socialBalances },
    pressure: {
      clocks: Object.fromEntries(runtime.openRun.clocks.map(clock => [clock.clockKey, { value: clock.value }])),
      fronts: Object.fromEntries(runtime.openRun.fronts.map(front => [front.frontKey, { currentStageKey: front.stageKey,
        escalationStages: content.campaign.fronts.find(definition => definition.frontKey === front.frontKey)?.escalationStages ?? [] }])),
    },
    actors: Object.fromEntries(content.campaign.characterTemplates.map(actor => [actor.characterKey, {
      locationRef: state.entities[actor.characterKey]?.locationKey ?? null,
      itemKeys: Object.values(product.inventory.items).filter(item => item.ownerRef === actor.characterKey && !item.stateTags.includes('broken'))
        .flatMap(item => [item.itemInstanceId, item.definitionRef]),
      abilityKeys: actor.actionKeys,
      resources: Object.fromEntries(content.rulePack.content.resources.map(resource => [resource.key,
        Number(state.entities[actor.characterKey]?.attributes[`resource.${resource.key}`])])),
    }])),
    situations: { active: runtime.openRun.situations.active, templates: content.campaign.situationTemplates },
    chaos: runtime.openRun.chaos.value, worldTurn: runtime.openRun.worldTime.worldTurn,
    knownRefs: content.campaign.entityBindings.map(binding => binding.bindingKey),
  }
}

export function parseTtrpgOpenRulePlanV1(value: unknown): TtrpgOpenRulePlanV1 {
  const r = p.record(value, ['schema', 'version', 'request', 'epochKey', 'rulePackContentHash', 'runtimeSourceHash',
    'authorizationHash', 'mechanicalStateHash', 'rulePack', 'genericCheck', 'effectTemplates', 'timeCostWorldTurns',
    'affectedActorKeys', 'requiredApprovals', 'skillValues'], 'rule plan')
  p.literal(r.schema, 'storyforge.ttrpg-open-rule-plan', 'schema'); p.literal(r.version, 1, 'version')
  const request = parseTtrpgOpenRuleRequestV1(r.request), rulePack = parseRulePackV1(r.rulePack)
  const genericCheck = r.genericCheck === null ? null : parseTtrpgOpenGenericCheckV1(r.genericCheck, 'genericCheck', rulePack)
  if ((request.route === 'generic-check') !== (genericCheck !== null)
    || (genericCheck !== null && request.ruleKey !== genericCheck.checkKey)
    || (request.route === 'existing-action' && !rulePack.actions.some(action => action.key === request.ruleKey))) fail('规则路由与冻结定义不一致')
  const affectedActorKeys = p.keys(r.affectedActorKeys, 'affectedActorKeys', 1000, 1)
  const requiredApprovals = p.list(r.requiredApprovals, 'requiredApprovals', value => {
    const a = p.record(value, ['actorKey', 'allowedSeatKeys'], 'required approval')
    return { actorKey: p.key(a.actorKey, 'approval actor'), allowedSeatKeys: p.keys(a.allowedSeatKeys, 'allowedSeatKeys', 1000, 1) }
  }, 1000, 1)
  if (new Set(requiredApprovals.map(approval => approval.actorKey)).size !== requiredApprovals.length) fail('批准要求重复')
  const effectTemplates = p.list(r.effectTemplates, 'effectTemplates', effectTemplate, 7)
  return { schema: 'storyforge.ttrpg-open-rule-plan', version: 1, request, rulePack, genericCheck, effectTemplates,
    epochKey: p.key(r.epochKey, 'epochKey'), rulePackContentHash: p.hash(r.rulePackContentHash, 'rule hash'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'source hash'), authorizationHash: p.hash(r.authorizationHash, 'authorization hash'),
    mechanicalStateHash: p.hash(r.mechanicalStateHash, 'mechanical hash'),
    timeCostWorldTurns: p.integer(r.timeCostWorldTurns, 'time cost', 0, 10), affectedActorKeys, requiredApprovals,
    skillValues: p.numericRecord(r.skillValues, 'skillValues') }
}

export async function createTtrpgOpenRulePlanV1(input: {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtimeSourceHash: string; request: TtrpgOpenRuleRequestV1
}): Promise<TtrpgOpenRulePlanV1> {
  const request = parseTtrpgOpenRuleRequestV1(input.request)
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg)
  const auth = runtime?.authorization, run = runtime?.openRun
  if (!runtime || !auth || !run || runtime.product.safety.status !== 'active' || run.stage.status !== 'open') fail('当前团局不能计划规则行动')
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === run.coordination.activeEpochKey)
  if (!epoch || epoch.status !== 'active') fail('需要真人启动的 active epoch')
  const seat = auth.seats.find(seat => seat.actorKey === request.actorKey && seat.role === 'player')
  if (!seat || !auth.selectedActorKeys.includes(request.actorKey)) fail('行动者不在已确认活动席位')
  if ((request.controllerMode === 'human' && (seat.controller === 'ai' || seat.assignmentState !== 'claimed'))
    || (request.controllerMode === 'ai' && (seat.controller === 'human' || !seat.consent.aiAdviceAllowed))) fail('行动控制模式与席位/同意策略不一致')
  if (request.controllerMode === 'ai' && (epoch.successfulActorKeys.includes(request.actorKey)
    || epoch.successfulActorKeys.length >= epoch.budget.maximumAiActions)) fail('该 epoch 队友成功执行额度不足')
  const actor = input.state.entities[request.actorKey]
  const location = actor?.locationKey
  if (!actor || actor.lifecycleStatus !== 'active' || !location || input.state.entities[location]?.kind !== 'location') fail('行动者缺少可解析地点或不可行动')
  const target = request.targetKey === null ? null : input.state.entities[request.targetKey]
  if (request.targetKey !== null && (!target || target.lifecycleStatus !== 'active'
    || (target.entityKey !== request.actorKey && target.kind !== 'location' && target.locationKey !== location)
    || (target.kind === 'location' && target.entityKey !== location))) fail('目标不存在或不在同一地点')
  const rulePack = projectTtrpgRulePackMechanicalCoreV1(input.content.rulePack.content)
  const template = input.content.campaign.characterTemplates.find(template => template.characterKey === request.actorKey)!
  let genericCheck: TtrpgOpenGenericCheckV1 | null = null, timeCostWorldTurns: number
  let effectTemplates: TtrpgOpenEffectPlanTemplateV1[] = []
  const affected = new Set([request.actorKey])
  if (request.route === 'existing-action') {
    const action = rulePack.actions.find(action => action.key === request.ruleKey)
    const inventory = Object.values(runtime.product.inventory.items).filter(item => item.ownerRef === request.actorKey && !item.stateTags.includes('broken'))
    if (!action || (!template.actionKeys.includes(action.key) && !inventory.some(item => rulePack.items.find(definition => definition.key === item.definitionRef)?.grantedActionKeys.includes(action.key)))) fail('角色或现持物品未授予该冻结行动')
    if ((action.target === 'self' && request.targetKey !== request.actorKey)
      || (action.target === 'scene' && request.targetKey !== null)
      || (['single-ally', 'single-enemy'].includes(action.target) && (!target || target.entityKey === actor.entityKey || !['player', 'npc', 'character'].includes(target.kind)))) fail('行动目标种类不合法')
    const requirement = evaluateTtrpgActionRequirementsV2({ action, rulePack,
      actorAttributes: actor.attributes, actorConditions: runtime.product.conditions[request.actorKey] })
    if (!requirement.met) fail(requirement.reason ?? '行动前置条件不满足')
    const ability = runtime.product.abilityStates[ttrpgAbilityStateKeyV2(request.actorKey, action.key)]
    if (!ability) fail('冻结能力账本缺失')
    const use = consumeTtrpgAbilityV2({ definition: { abilityKey: action.key, actionDefinitionKey: action.key, usage: action.usage },
      state: ability, eventId: 'preflight', currentRound: run.worldTime.worldTurn,
      resourceCurrent: action.usage.resourceKey === null ? null : Number(actor.attributes[`resource.${action.usage.resourceKey}`]),
      sharedPool: action.usage.sharedPoolKey === null ? null : runtime.product.usagePools[action.usage.sharedPoolKey] ?? null })
    const cost = action.costAmount + (action.costResourceKey === action.usage.resourceKey ? Math.max(0, -use.resourceDelta) : 0)
    if (action.costResourceKey) {
      const current = actor.attributes[`resource.${action.costResourceKey}`]
      if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < cost) fail('行动资源不足或缺少权威数值')
    }
    if (action.effects.some(effect => effect.kind !== 'check' && effect.targetScope !== 'actor') && request.targetKey) affected.add(request.targetKey)
    timeCostWorldTurns = input.content.rulePack.content.timePolicy.actionOverrides.find(override => override.actionKey === action.key)?.timeCostWorldTurns
      ?? input.content.rulePack.content.timePolicy.existingAction
    if (Object.keys(request.effectBindings).length !== 0) fail('existing-action 不接受外加后果参数')
  } else {
    genericCheck = input.content.rulePack.content.genericChecks.find(check => check.checkKey === request.ruleKey) ?? null
    if (!genericCheck) fail('没有该冻结 generic check 定义')
    const kind = request.targetKey === request.actorKey ? 'self' : target?.kind === 'location' ? 'location' : target?.kind === 'item' ? 'item' : target ? 'actor' : null
    if (!kind || !genericCheck.targetKinds.includes(kind)) fail('通用检定目标种类不合法')
    const context = ttrpgOpenPredicateContextV1(input.state, input.content)
    if (genericCheck.preconditions.some(predicate => !evaluateTtrpgPredicateV1(predicate, context))) fail('通用检定前置谓词未满足')
    for (const cost of genericCheck.resourceCosts) {
      const current = actor.attributes[`resource.${cost.resourceKey}`]
      if (typeof current !== 'number' || current < cost.amount) fail('通用检定资源不足')
    }
    timeCostWorldTurns = genericCheck.timeCostWorldTurns
    const planKeys = [...new Set(Object.values(genericCheck.effectPlanByDegree).filter((key): key is string => key !== null))]
    effectTemplates = planKeys.map(planKey => input.content.campaign.effectPlanTemplates.find(template => template.planKey === planKey) ?? fail('后果模板缺失'))
    if (Object.keys(request.effectBindings).sort().join(',') !== [...planKeys].sort().join(',')) fail('后果参数必须覆盖所有冻结后果模板')
    for (const effect of effectTemplates) {
      const bindings = request.effectBindings[effect.planKey]
      if (Object.keys(bindings).sort().join(',') !== effect.parameters.map(parameter => parameter.parameterKey).sort().join(',')) fail('后果参数槽不精确')
      for (const parameter of effect.parameters) {
        const ref = bindings[parameter.parameterKey]
        if (ref === null) { if (parameter.required) fail('缺少必需后果参数'); continue }
        const entity = input.state.entities[ref]
        const kind = entity?.kind === 'item' ? 'item' : entity?.kind === 'location' ? 'location' : entity ? 'actor' : null
        if (!entity || !kind || !parameter.entityKinds.includes(kind)
          || (!parameter.allowedRefs.includes(ref) && !parameter.allowDynamicFromTemplateKeys.includes(String(entity.attributes.templateKey)))) fail('后果绑定不属于冻结允许范围')
      }
      for (const primitive of [...effect.effects, ...effect.alternatives.flatMap(alternative => alternative.effects)]) {
        const ref = primitive.targetRef.startsWith('parameter:') ? bindings[primitive.targetRef.slice(10)] : primitive.targetRef
        if (ref && input.state.entities[ref]?.kind === 'player') affected.add(ref)
      }
    }
  }
  const requiredApprovals = [...affected].flatMap(actorKey => {
    const affectedSeat = auth.seats.find(seat => seat.actorKey === actorKey && seat.role === 'player')
    if (!affectedSeat) return []
    if (actorKey === request.actorKey && request.controllerMode === 'ai') {
      const binding = auth.approvalBindings.find(binding => binding.companionActorKey === actorKey)
      if (!binding) fail('AI 行动缺少真人批准关系')
      return [{ actorKey, allowedSeatKeys: [...binding.approverSeatKeys] }]
    }
    if (affectedSeat.controller !== 'ai') return [{ actorKey, allowedSeatKeys: [affectedSeat.seatKey] }]
    return []
  })
  return parseTtrpgOpenRulePlanV1({ schema: 'storyforge.ttrpg-open-rule-plan', version: 1, request,
    epochKey: epoch.epochKey, rulePackContentHash: input.content.rulePack.contentHash, runtimeSourceHash: input.runtimeSourceHash,
    authorizationHash: await hashProductProductionValueV2(auth), mechanicalStateHash: await ttrpgOpenMechanicalStateHashV1(input.state),
    rulePack, genericCheck, effectTemplates, timeCostWorldTurns, affectedActorKeys: [...affected], requiredApprovals,
    skillValues: Object.fromEntries([...new Set([request.actorKey, ...(request.targetKey ? [request.targetKey] : [])])].map(actorKey => {
      const template = input.content.campaign.characterTemplates.find(template => template.characterKey === actorKey)
      const custom = runtime.product.characterCustomizations.find(custom => custom.characterKey === actorKey)
      return [actorKey, custom?.characterSheet.rules.skills[request.ruleKey] ?? template?.characterSheet.rules.skills[request.ruleKey] ?? template?.skills[request.ruleKey] ?? 0]
    })) })
}
