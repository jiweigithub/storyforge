/** Frozen discovery path; action names alone never grant knowledge. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeContentVersionedV1, isTtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { evaluateTtrpgPredicateV1 } from './predicate'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { hashTtrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { effectTemplate } from './open-content-templates'
import type { TtrpgOpenEffectPlanTemplateV1 } from './open-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenDiscoveryRequestV1 {
  situationKey: string; evidenceRef: string; interventionPointKey: string
  effectBindings: Record<string, Record<string, string | null>>
}
export interface TtrpgOpenDiscoveryPlanV1 {
  request: TtrpgOpenDiscoveryRequestV1
  frozenContent: TtrpgRuntimeContentV2
  contentHash: string
  publicFieldsHash: string
  recipientActorKeys: string[]
  actorKey: string
  route: 'existing-action' | 'generic-check'
  ruleKey: string
  effectTemplates: TtrpgOpenEffectPlanTemplateV1[]
}
export function parseTtrpgOpenDiscoveryRequestV1(value: unknown): TtrpgOpenDiscoveryRequestV1 {
  const r = p.record(value, ['situationKey', 'evidenceRef', 'interventionPointKey', 'effectBindings'], 'discovery request')
  const bindings = p.object(r.effectBindings, 'discovery bindings')
  if (Object.keys(bindings).length > 2) p.fail('发现最多绑定冻结代价与失败前进计划')
  return { situationKey: p.key(r.situationKey, 'discovery situation'), evidenceRef: p.key(r.evidenceRef, 'discovery evidence'),
    interventionPointKey: p.key(r.interventionPointKey, 'discovery intervention'), effectBindings: Object.fromEntries(Object.entries(bindings).map(([key, value]) =>
      [p.key(key, 'discovery effect plan'), Object.fromEntries(Object.entries(p.object(value, 'discovery slots')).map(([slot, ref]) =>
        [p.key(slot, 'discovery parameter'), p.nullable(ref, p.key, 'discovery target')]))])) }
}
export function parseTtrpgOpenDiscoveryPlanV1(value: unknown): TtrpgOpenDiscoveryPlanV1 {
  const r = p.record(value, ['request', 'frozenContent', 'contentHash', 'publicFieldsHash', 'recipientActorKeys', 'actorKey', 'route', 'ruleKey', 'effectTemplates'], 'discovery plan')
  const raw = p.object(r.frozenContent, 'discovery frozen content'), campaign = p.object(raw.campaign, 'discovery campaign')
  const sourceWorld = p.object(campaign.sourceWorld, 'discovery world')
  const frozenContent = parseTtrpgRuntimeContentVersionedV1(raw, p.hash(sourceWorld.contentHash, 'discovery world hash'), 2)
  if (!isTtrpgRuntimeContentV2(frozenContent)) p.fail('发现只能使用冻结 open 内容')
  const result = { request: parseTtrpgOpenDiscoveryRequestV1(r.request), frozenContent,
    contentHash: p.hash(r.contentHash, 'discovery content hash'), publicFieldsHash: p.hash(r.publicFieldsHash, 'discovery public fields'),
    recipientActorKeys: p.keys(r.recipientActorKeys, 'discovery recipients', 1000), actorKey: p.key(r.actorKey, 'discovery actor'),
    route: p.oneOf(r.route, ['existing-action', 'generic-check'], 'discovery route'), ruleKey: p.key(r.ruleKey, 'discovery rule'),
    effectTemplates: p.list(r.effectTemplates, 'discovery effects', effectTemplate, 2) }
  const evidence = frozenContent.campaign.situationTemplates.flatMap(template => template.evidence).find(evidence => evidence.clueRef === result.request.evidenceRef)
  if (!evidence || result.recipientActorKeys.some(actor => !frozenContent.campaign.characterTemplates.some(character => character.role === 'player' && character.characterKey === actor))) p.fail('发现引用或接收者不在冻结内容中')
  const planKeys = [...new Set([evidence.discoveryPolicy.costEffectPlanRef, evidence.discoveryPolicy.failForwardEffectPlanRef].filter((ref): ref is string => ref !== null))]
  if (result.effectTemplates.map(template => template.planKey).sort().join(',') !== planKeys.sort().join(',')
    || result.effectTemplates.some(template => JSON.stringify(template) !== JSON.stringify(frozenContent.campaign.effectPlanTemplates.find(original => original.planKey === template.planKey)))
    || Object.keys(result.request.effectBindings).sort().join(',') !== planKeys.sort().join(',')) p.fail('发现代价/失败前进只能来自冻结模板和完整绑定')
  return result
}
/** Broad audiences without an explicit subset resolve once to the current
 * authorized party. Private audiences never acquire an implicit recipient. */
export function resolveTtrpgOpenDiscoveryRecipientsV1(policy: { allowedAudience: string; recipientActorKeys: string[] },selectedActorKeys: string[]) {
  return policy.recipientActorKeys.length ? policy.recipientActorKeys.filter(key => selectedActorKeys.includes(key))
    : policy.allowedAudience === 'party' || policy.allowedAudience === 'public' ? [...selectedActorKeys] : []
}
export function assertTtrpgOpenDiscoveryPathV1(state: ProductRuntimeState, plan: TtrpgOpenDiscoveryPlanV1) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun
  const instance = run?.situations.active.find(instance => instance.situationKey === plan.request.situationKey)
  const template = plan.frozenContent.campaign.situationTemplates.find(template => template.templateKey === instance?.templateKey)
  const evidence = template?.evidence.find(evidence => evidence.clueRef === plan.request.evidenceRef)
  const point = template?.interventionPoints.find(point => point.pointKey === plan.request.interventionPointKey)
  if (!runtime?.authorization || !run || !instance || !template || !evidence || !point
    || (point.visibleTo === 'private' && !point.knownByActorKeys.includes(plan.actorKey))
    || (plan.route === 'existing-action' && !point.suggestedActionKeys.includes(plan.ruleKey))
    || !evidence.discoveryPolicy.paths.some(path => path.interventionPointKey === point.pointKey && path.key === plan.ruleKey
      && path.kind === (plan.route === 'existing-action' ? 'action' : 'generic-check'))) p.fail('知识发现没有本局势、本介入点与真实规则路径')
  const context = ttrpgOpenPredicateContextV1(state, plan.frozenContent)
  if ((point.requiresPredicate !== null && !evaluateTtrpgPredicateV1(point.requiresPredicate, context))
    || evidence.discoveryPolicy.preconditions.some(predicate => !evaluateTtrpgPredicateV1(predicate, context))) p.fail('知识发现前置条件未满足')
  const recipients = resolveTtrpgOpenDiscoveryRecipientsV1(evidence.discoveryPolicy,runtime.authorization!.selectedActorKeys)
  if (evidence.discoveryPolicy.allowedAudience !== 'gm-only' && !recipients.length
    || JSON.stringify([...recipients].sort()) !== JSON.stringify([...plan.recipientActorKeys].sort())) p.fail('知识发现接收者或授权已经 stale')
  return { runtime, instance, template, evidence, point }
}
export async function createTtrpgOpenDiscoveryPlanV1(input: {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; request: TtrpgOpenDiscoveryRequestV1;
  actorKey: string; route: TtrpgOpenDiscoveryPlanV1['route']; ruleKey: string;
}): Promise<TtrpgOpenDiscoveryPlanV1> {
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg)
  if (!runtime?.authorization) p.fail('知识发现需要本桌授权')
  const evidence = input.content.campaign.situationTemplates.flatMap(template => template.evidence).find(evidence => evidence.clueRef === input.request.evidenceRef)
  if (!evidence) p.fail('没有该冻结 evidence')
  const plan = parseTtrpgOpenDiscoveryPlanV1({ request: input.request, frozenContent: input.content,
    contentHash: await hashProductProductionValueV2(input.content), publicFieldsHash: await hashTtrpgOpenEvidenceFieldsV1(input.content.campaign, evidence.clueRef),
    recipientActorKeys: resolveTtrpgOpenDiscoveryRecipientsV1(evidence.discoveryPolicy,runtime.authorization!.selectedActorKeys),
    actorKey: input.actorKey, route: input.route, ruleKey: input.ruleKey,
    effectTemplates: [...new Set([evidence.discoveryPolicy.costEffectPlanRef, evidence.discoveryPolicy.failForwardEffectPlanRef].filter((ref): ref is string => ref !== null))]
      .map(ref => input.content.campaign.effectPlanTemplates.find(template => template.planKey === ref) ?? p.fail('发现后果模板不存在')) })
  assertTtrpgOpenDiscoveryPathV1(input.state, plan)
  return plan
}
