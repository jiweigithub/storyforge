/** Pure request shapes shared by frozen rule plans and durable clarification records. */
import * as p from './open-contract-parse'

export interface TtrpgOpenDiscoveryRequestV1 {
  situationKey: string; evidenceRef: string; interventionPointKey: string
  effectBindings: Record<string, Record<string, string | null>>
}
export interface TtrpgOpenRuleRequestV1 {
  route: 'existing-action' | 'generic-check'
  interactionKey?: string
  ruleKey: string
  actorKey: string
  targetKey: string | null
  controllerMode: 'human' | 'ai'
  effectBindings: Record<string, Record<string, string | null>>
  discovery?: TtrpgOpenDiscoveryRequestV1
}
function fail(message: string): never { throw new Error(`[ttrpg-open-rule-plan] ${message}`) }

export function parseTtrpgOpenDiscoveryRequestV1(value: unknown): TtrpgOpenDiscoveryRequestV1 {
  const r = p.record(value, ['situationKey', 'evidenceRef', 'interventionPointKey', 'effectBindings'], 'discovery request')
  const bindings = p.object(r.effectBindings, 'discovery bindings')
  if (Object.keys(bindings).length > 2) p.fail('发现最多绑定冻结代价与失败前进计划')
  return { situationKey: p.key(r.situationKey, 'discovery situation'), evidenceRef: p.key(r.evidenceRef, 'discovery evidence'),
    interventionPointKey: p.key(r.interventionPointKey, 'discovery intervention'), effectBindings: Object.fromEntries(Object.entries(bindings).map(([key, value]) =>
      [p.key(key, 'discovery effect plan'), Object.fromEntries(Object.entries(p.object(value, 'discovery slots')).map(([slot, ref]) =>
        [p.key(slot, 'discovery parameter'), p.nullable(ref, p.key, 'discovery target')]))])) }
}
export function parseTtrpgOpenRuleRequestV1(value: unknown): TtrpgOpenRuleRequestV1 {
  const hasInteraction = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'interactionKey')
  const hasDiscovery = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'discovery')
  const r = p.record(value, ['route', 'ruleKey', 'actorKey', 'targetKey', 'controllerMode', 'effectBindings', ...(hasDiscovery ? ['discovery'] : []),...(hasInteraction ? ['interactionKey'] : [])], 'rule request')
  const rawBindings = p.object(r.effectBindings, 'effectBindings')
  if (Object.keys(rawBindings).length > 7) fail('effectBindings 超过七档后果')
  const effectBindings = Object.fromEntries(Object.entries(rawBindings).map(([planKey, value]) => {
    const row = p.object(value, 'effect parameter bindings')
    if (Object.keys(row).length > 32) fail('参数槽超过32')
    return [p.key(planKey, 'effect plan key'), Object.fromEntries(Object.entries(row).map(([slot, ref]) =>
      [p.key(slot, 'parameterKey'), p.nullable(ref, p.key, 'parameter binding')]))]
  }))
  if (hasInteraction && r.route !== 'existing-action') fail('互动只能绑定真实自动行动')
  return { ...(hasInteraction ? { interactionKey: p.key(r.interactionKey,'interaction key') } : {}),route: p.oneOf(r.route, ['existing-action', 'generic-check'], 'route'),
    ruleKey: p.key(r.ruleKey, 'ruleKey'), actorKey: p.key(r.actorKey, 'actorKey'),
    targetKey: p.nullable(r.targetKey, p.key, 'targetKey'),
    controllerMode: p.oneOf(r.controllerMode, ['human', 'ai'], 'controllerMode'), effectBindings,
    ...(hasDiscovery ? { discovery: parseTtrpgOpenDiscoveryRequestV1(r.discovery) } : {}) }
}

