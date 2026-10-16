/** Exact complete Oracle identity delivery; no model or storage authority is inferred here. */
import { parseTtrpgOpenOracleRuntimeReferencePolicyV1, type TtrpgOpenOracleRuntimeReferencePolicyV1 } from './open-runtime-entity-references'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'

interface OracleIdentityScope {
  schema: 'storyforge.ttrpg-open-oracle-instance-identity-scope'; version: 1;
  oracleSourceRef: TtrpgOpenSourceRefV1; audience: 'public' | 'party' | 'gm-only'; recipientActorKeys: string[];
  runtimeSourceHash: string; rulePackContentHash: string; snapshotHash: string;
  references: Array<{ entityRef: string; kind: 'actor' | 'location' | 'item'; audience: 'public' | 'party' | 'private' | 'gm-only'; knownByActorKeys: string[]; sourceRef: TtrpgOpenSourceRefV1 }>;
}
/** Guidance is still constrained by its original consumer grants; an Oracle cannot make party prose public. */
export function isTtrpgOpenOracleRuntimeGuidanceVisibleV1(policy: TtrpgOpenOracleRuntimeReferencePolicyV1, audience: string, knownBy: readonly string[]): boolean {
  if (audience === 'public') return true
  if (policy.audience === 'public') return false
  if (audience === 'party') return !knownBy.length || policy.recipientActorKeys.every(key => knownBy.includes(key))
  return policy.audience === 'gm-only' && (audience === 'gm-only' || audience === 'private' && knownBy.includes('gm'))
}
/** Original template, operation and plan bytes stay in the internal call proof, including for a public Oracle. */
export function projectTtrpgOpenOracleRuntimeIdentityScopeV1(value: TtrpgOpenOracleRuntimeReferencePolicyV1): OracleIdentityScope {
  const policy = parseTtrpgOpenOracleRuntimeReferencePolicyV1(value)
  return { schema: 'storyforge.ttrpg-open-oracle-instance-identity-scope', version: 1, oracleSourceRef: policy.oracleSourceRef,
    audience: policy.audience, recipientActorKeys: policy.recipientActorKeys, runtimeSourceHash: policy.references.runtimeSourceHash,
    rulePackContentHash: policy.references.rulePackContentHash, snapshotHash: policy.references.snapshotHash,
    references: policy.references.references.map(row => ({ entityRef: row.entityRef, kind: row.kind, audience: row.audience,
      knownByActorKeys: row.recipientActorKeys, sourceRef: row.sourceRef })) }
}
function parseIdentityScope(value: unknown): OracleIdentityScope {
  const r = p.record(value, ['schema', 'version', 'oracleSourceRef', 'audience', 'recipientActorKeys', 'runtimeSourceHash', 'rulePackContentHash', 'snapshotHash', 'references'], 'Oracle identity scope')
  const references = p.list(r.references, 'Oracle delivered references', value => {
    const row = p.record(value, ['entityRef', 'kind', 'audience', 'knownByActorKeys', 'sourceRef'], 'Oracle delivered reference')
    return { entityRef: p.key(row.entityRef, 'Oracle instance'), kind: p.oneOf(row.kind, ['actor', 'location', 'item'], 'Oracle instance kind'),
      audience: p.oneOf(row.audience, p.AUDIENCES, 'Oracle instance audience'), knownByActorKeys: p.keys(row.knownByActorKeys, 'Oracle instance recipients', 1000), sourceRef: parseTtrpgOpenSourceRefV1(row.sourceRef) }
  }, 10000, 1)
  p.unique(references.map(row => row.entityRef), 'Oracle delivered identities')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-oracle-instance-identity-scope', 'Oracle identity scope schema'), version: p.literal(r.version, 1, 'Oracle identity scope version'),
    oracleSourceRef: parseTtrpgOpenSourceRefV1(r.oracleSourceRef), audience: p.oneOf(r.audience, ['public', 'party', 'gm-only'], 'Oracle input scope audience'),
    recipientActorKeys: p.keys(r.recipientActorKeys, 'Oracle scope recipients', 1000), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'Oracle scope source'),
    rulePackContentHash: p.hash(r.rulePackContentHash, 'Oracle scope rules'), snapshotHash: p.hash(r.snapshotHash, 'Oracle internal identity snapshot'), references }
}
export function ttrpgOpenOracleRuntimeDeliveryPolicyV1(contractValue: unknown, packetValue: unknown) {
  const contract = p.object(contractValue, 'Oracle delivery contract'), packet = p.object(packetValue, 'Oracle delivery input')
  if (contract.version !== 2 && packet.version !== 2) {
    if ('runtimeEntityReferencePolicy' in contract || 'runtimeEntityReferencePolicy' in packet || 'runtimeIdentityScope' in contract || 'runtimeIdentityScope' in packet) p.fail('旧 Oracle 正文不能夹带新实例策略')
    return undefined
  }
  p.exact(contract, ['schema', 'version', 'runtimeIdentityScope', 'instanceIdentitiesDoNotGrantMechanics', 'actorKey', 'selectedActorKeys',
    'rulePackContentHash', 'worldReleaseHash', 'factPolicy', 'rawOutcomeIsFinal', 'outputIsCandidate', 'mechanicalOwnersAndPlayerDecisionsForbidden', 'noWorldWriteBack'], 'Oracle versioned contract')
  p.exact(packet, ['schema', 'version', 'runtimeIdentityScope', 'sourceRef', 'audience', 'outcome', 'interpretationPolicy',
    'permittedFrozenFacts', 'permittedSessionFacts', 'permittedEntityRefs'], 'Oracle versioned full input')
  const policy = parseIdentityScope(packet.runtimeIdentityScope)
  if (contract.version !== 2 || packet.version !== 2 || contract.schema !== 'storyforge.ttrpg-open-gm-oracle-contract'
    || packet.schema !== 'storyforge.ttrpg-open-gm-oracle-input' || stable(contract.runtimeIdentityScope) !== stable(policy)
    || stable(policy.oracleSourceRef) !== stable(packet.sourceRef) || policy.audience !== packet.audience
    || stable(contract.selectedActorKeys) !== stable(policy.recipientActorKeys)) p.fail('新版 Oracle 正文缺少同一原咨询、准确接收者和完整读取合同')
  const entities = p.list(packet.permittedEntityRefs, 'Oracle actual delivered identities', value => p.object(value, 'Oracle delivered identity'), 10000)
  const dynamic = entities.filter(row => Object.prototype.hasOwnProperty.call(row, 'runtimeOrigin'))
  for (const row of entities.filter(row => !Object.prototype.hasOwnProperty.call(row, 'runtimeOrigin'))) {
    p.exact(row, ['entityRef', 'kind', 'audience', 'knownByActorKeys', 'playerControlled'], 'Oracle frozen identity')
  }
  if (dynamic.length !== policy.references.length) p.fail('Oracle 实例目录与实际完整正文不一致')
  for (const origin of policy.references) {
    const matches = dynamic.filter(row => row.entityRef === origin.entityRef)
    if (matches.length !== 1) p.fail('Oracle 缺少本次原实例的完整身份正文')
    const row = p.record(matches[0], ['entityRef', 'kind', 'audience', 'knownByActorKeys', 'playerControlled', 'name', 'runtimeOrigin'], 'Oracle instance identity body')
    p.text(row.name, 'Oracle instance name', 20000)
    if (stable(row.runtimeOrigin) !== stable(origin) || row.kind !== origin.kind || row.audience !== origin.audience
      || stable(row.knownByActorKeys) !== stable(origin.knownByActorKeys) || row.playerControlled !== false) p.fail('Oracle 实例正文更换了原创建或准确接收者')
  }
  return policy
}
export function reviewTtrpgOpenOracleRuntimeDeliveryV1(policy: TtrpgOpenOracleRuntimeReferencePolicyV1,
  snapshots: ReadonlyArray<{ sourceKey?: string; content: unknown }>) {
  const rows = snapshots.filter(row => row.sourceKey === 'ttrpgOpenGmOracleInput').map(row => {
    if (typeof row.content !== 'string') p.fail('Oracle 来源需要实际完整 JSON 正文')
    return p.object(p.json(row.content), 'Oracle full source')
  })
  const contracts = rows.filter(row => row.schema === 'storyforge.ttrpg-open-gm-oracle-contract'), packets = rows.filter(row => row.schema === 'storyforge.ttrpg-open-gm-oracle-input')
  if (contracts.length !== 1 || packets.length !== 1 || stable(ttrpgOpenOracleRuntimeDeliveryPolicyV1(contracts[0], packets[0])) !== stable(projectTtrpgOpenOracleRuntimeIdentityScopeV1(policy))) p.fail('原 Oracle 实例策略没有通过登记来源实际完整交付')
}
