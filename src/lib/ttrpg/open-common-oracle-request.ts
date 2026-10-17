/** Exact one-call request evidence. Parsing, hashing or source matching never grants live authority. */
import * as p from './open-contract-parse'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenOracleRuntimeReferencePolicyV1, verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1, type TtrpgOpenOracleRuntimeReferencePolicyV1 } from './open-runtime-entity-references'
import { projectTtrpgOpenOracleRuntimeIdentityScopeV1 } from './open-oracle-runtime-delivery'
import { canonicalStringify as stable, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import type { loadTtrpgOpenCommonOracleContextV1 } from './open-common-oracle-context'

export const TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1 = Object.freeze({
  purpose: 'common-oracle-fact-candidate' as const, decision: 'request-this-one-common-oracle-candidate' as const,
  maximumCalls: 1 as const, maximumAiActions: 0 as const, perFactHumanReviewRequired: true as const,
  parsingEvidenceGrantsNoLiveAuthority: true as const,
})
export function parseTtrpgOpenCommonOracleRequestBasisV1(value: unknown) {
  const r = p.record(value, ['schema', 'version', 'purpose', 'sessionKey', 'runtimeSourceHash', 'rulePackContentHash',
    'authorizationRevision', 'requester', 'readEvidence', 'oracleSourceRef', 'audience', 'recipientActorKeys',
    'oracleInputHash', 'sourceVisibilityHash', 'runtimeReferencePolicy', 'decision', 'modelIdentity', 'budget'], 'common Oracle request basis')
  const requester = p.record(r.requester, ['viewerKey', 'seatKey', 'seatRevision'], 'common Oracle requester')
  const read = p.record(r.readEvidence, ['sequence', 'stateHash'], 'common Oracle source cut')
  const model = p.record(r.modelIdentity, ['provider', 'model'], 'common Oracle model')
  const budget = p.record(r.budget, ['maximumInputTokens', 'maximumOutputTokens', 'maximumCostUsd', 'maximumCalls', 'maximumAiActions', 'perFactHumanReviewRequired'], 'common Oracle budget')
  const recipientActorKeys = p.keys(r.recipientActorKeys, 'common Oracle actual recipients', 1000, 1)
  if (stable(recipientActorKeys) !== stable([...recipientActorKeys].sort())) p.fail('共同事实接收者须按实际角色排序')
  const sessionKey = p.key(r.sessionKey, 'common Oracle session'), oracleSourceRef = parseTtrpgOpenSourceRefV1(r.oracleSourceRef)
  const sequence = p.integer(read.sequence, 'common Oracle source sequence', 1), audience = p.oneOf(r.audience, ['public', 'party'], 'common Oracle audience')
  const runtimeSourceHash = p.hash(r.runtimeSourceHash, 'common Oracle frozen source'), rulePackContentHash = p.hash(r.rulePackContentHash, 'common Oracle rules')
  const runtimeReferencePolicy = r.runtimeReferencePolicy === null ? null : parseTtrpgOpenOracleRuntimeReferencePolicyV1(r.runtimeReferencePolicy)
  if (oracleSourceRef.sessionKey === sessionKey && oracleSourceRef.sequence > sequence) p.fail('共同事实不能借用未来咨询')
  if (runtimeReferencePolicy && (runtimeReferencePolicy.audience !== audience || stable(runtimeReferencePolicy.oracleSourceRef) !== stable(oracleSourceRef)
    || stable(runtimeReferencePolicy.recipientActorKeys) !== stable(recipientActorKeys) || runtimeReferencePolicy.references.runtimeSourceHash !== runtimeSourceHash
    || runtimeReferencePolicy.references.rulePackContentHash !== rulePackContentHash
    || runtimeReferencePolicy.references.references.some(row => row.sourceRef.sessionKey === sessionKey && row.sourceRef.sequence > sequence))) p.fail('共同事实实例范围不属于本次原咨询、接收者或冻结来源')
  if (typeof model.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(model.provider)) p.fail('共同事实模型 provider 无效')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-common-oracle-request-basis', 'common Oracle request schema'),
    version: p.literal(r.version, 1, 'common Oracle request version'), purpose: p.literal(r.purpose, TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1.purpose, 'common Oracle purpose'),
    sessionKey, runtimeSourceHash, rulePackContentHash, authorizationRevision: p.integer(r.authorizationRevision, 'common Oracle authorization revision', 1),
    requester: { viewerKey: p.key(requester.viewerKey, 'common Oracle human viewer'), seatKey: p.key(requester.seatKey, 'common Oracle human seat'), seatRevision: p.integer(requester.seatRevision, 'common Oracle seat revision', 1) },
    readEvidence: { sequence, stateHash: p.hash(read.stateHash, 'common Oracle original head') }, oracleSourceRef, audience, recipientActorKeys,
    oracleInputHash: p.hash(r.oracleInputHash, 'common Oracle full selected body'), sourceVisibilityHash: p.hash(r.sourceVisibilityHash, 'common Oracle original source visibility'),
    runtimeReferencePolicy, decision: p.literal(r.decision, TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1.decision, 'common Oracle explicit decision'),
    modelIdentity: { provider: model.provider, model: p.text(model.model, 'common Oracle model name', 200) },
    budget: { maximumInputTokens: p.integer(budget.maximumInputTokens, 'common Oracle input limit', 1, 16000), maximumOutputTokens: p.integer(budget.maximumOutputTokens, 'common Oracle output limit', 1, 20000),
      maximumCostUsd: p.number(budget.maximumCostUsd, 'common Oracle cost limit', 0, 1000), maximumCalls: p.literal(budget.maximumCalls, 1, 'common Oracle call limit'),
      maximumAiActions: p.literal(budget.maximumAiActions, 0, 'common Oracle action limit'), perFactHumanReviewRequired: p.literal(budget.perFactHumanReviewRequired, true, 'common Oracle human review') } }
}
export type TtrpgOpenCommonOracleRequestBasisV1 = ReturnType<typeof parseTtrpgOpenCommonOracleRequestBasisV1>
export async function hashTtrpgOpenCommonOracleRequestBasisV1(value: unknown) {
  const basis = parseTtrpgOpenCommonOracleRequestBasisV1(value)
  if (basis.runtimeReferencePolicy) await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(basis.runtimeReferencePolicy)
  return hashCanonicalValue(basis)
}
type Source = Awaited<ReturnType<typeof loadTtrpgOpenCommonOracleContextV1>>
/** Only matches immutable source evidence. The eventual command must separately recheck live owner, original cut, budget and window. */
export async function assertTtrpgOpenCommonOracleRequestSourceV1(value: unknown, source: Source) {
  const basis = parseTtrpgOpenCommonOracleRequestBasisV1(value)
  await hashTtrpgOpenCommonOracleRequestBasisV1(basis)
  const entry = source.directory.find(row => stable(row.oracleSourceRef) === stable(basis.oracleSourceRef))
  const bodies = source.resources.filter(row => row.suffix === entry?.suffix)
  if (!entry || bodies.length !== 1 || entry.audience !== basis.audience || entry.contentHash !== basis.oracleInputHash
    || source.readEvidence.sessionKey !== basis.sessionKey || source.readEvidence.runtimeSourceHash !== basis.runtimeSourceHash
    || source.readEvidence.sequence < basis.readEvidence.sequence
    || source.readEvidence.sequence === basis.readEvidence.sequence && source.readEvidence.stateHash !== basis.readEvidence.stateHash
    || source.visibilityHash !== await hashCanonicalValue(source.resources)
    || source.authorizationRevision !== basis.authorizationRevision || stable(source.recipientActorKeys) !== stable(basis.recipientActorKeys)
    || source.visibilityHash !== basis.sourceVisibilityHash || entry.snapshotHash !== (basis.runtimeReferencePolicy?.references.snapshotHash ?? null)
    || await sha256Text(stable(bodies[0].value)) !== basis.oracleInputHash) p.fail('共同事实请求的原咨询、实际完整正文或来源范围已变化')
  const packet = p.object(bodies[0].value, 'common Oracle actual source body')
  const contract = p.object(source.resources.find(row => row.suffix === 'common-oracle-contract')?.value, 'common Oracle actual contract')
  if (contract.rulePackContentHash !== basis.rulePackContentHash || stable(packet.runtimeIdentityScope) !== stable(basis.runtimeReferencePolicy ? projectTtrpgOpenOracleRuntimeIdentityScopeV1(basis.runtimeReferencePolicy) : null)) p.fail('共同事实请求的实际规则或原实例正文不匹配')
  return basis
}
/** Pure preparation from already verified source/seat evidence; does not create an epoch or Run. */
export async function createTtrpgOpenCommonOracleRequestBasisV1(input: {
  source: Source; oracleSourceRef: TtrpgOpenSourceRefV1; requester: TtrpgOpenCommonOracleRequestBasisV1['requester'];
  runtimeReferencePolicy: TtrpgOpenOracleRuntimeReferencePolicyV1 | null; decision: TtrpgOpenCommonOracleRequestBasisV1['decision'];
  modelIdentity: TtrpgOpenCommonOracleRequestBasisV1['modelIdentity']; budget: TtrpgOpenCommonOracleRequestBasisV1['budget'];
}) {
  const { source } = input, row = source.directory.find(row => stable(row.oracleSourceRef) === stable(input.oracleSourceRef))
  if (!row) p.fail('共同事实请求必须明确选择本次共同可读的原咨询')
  const contract = p.object(source.resources.find(row => row.suffix === 'common-oracle-contract')?.value, 'common Oracle source contract')
  const basis = parseTtrpgOpenCommonOracleRequestBasisV1({ schema: 'storyforge.ttrpg-open-common-oracle-request-basis', version: 1,
    purpose: TTRPG_OPEN_COMMON_ORACLE_REQUEST_POLICY_V1.purpose, sessionKey: source.readEvidence.sessionKey, runtimeSourceHash: source.readEvidence.runtimeSourceHash,
    rulePackContentHash: contract.rulePackContentHash, authorizationRevision: source.authorizationRevision, requester: input.requester,
    readEvidence: { sequence: source.readEvidence.sequence, stateHash: source.readEvidence.stateHash }, oracleSourceRef: row.oracleSourceRef, audience: row.audience,
    recipientActorKeys: source.recipientActorKeys, oracleInputHash: row.contentHash, sourceVisibilityHash: source.visibilityHash,
    runtimeReferencePolicy: input.runtimeReferencePolicy, decision: input.decision, modelIdentity: input.modelIdentity, budget: input.budget })
  return assertTtrpgOpenCommonOracleRequestSourceV1(basis, source)
}
