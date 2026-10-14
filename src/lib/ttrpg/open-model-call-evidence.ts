/** Exact governed Run/evidence proof checked again by the runtime command transaction. */
import { db } from '../db/schema'
import type { AgentRunRecord, AgentRunEventRecord, AgentRunArtifactRecordV1, WorkspaceScope } from '../types'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { verifyContextManifestIntegrityV1, verifyContextManifestIntegrityV2, verifyContextManifestIntegrityV3 } from '../agent/run/context-manifest'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import { estimateTokens } from '../ai/context-budget'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { assertAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'

export interface TtrpgOpenAgentEvidenceV1 {
  run: AgentRunRecord & { id: number }
  events: AgentRunEventRecord[]
  artifacts: AgentRunArtifactRecordV1[]
}
export async function ttrpgOpenCallBindingHashV1(input: Pick<TtrpgOpenModelCallV1,
  'actorKey' | 'authorizationEpochKey' | 'admissionStateHash' | 'visibilityHash' | 'runtimeSourceHash'> & { sessionKey: string }) {
  return hashProductProductionValueV2({ schema: 'storyforge.ttrpg-open-call-binding', version: 1, ...input })
}

export async function verifyTtrpgOpenModelCallEvidenceV1(input: {
  scope: WorkspaceScope; sessionId: number; runId: number; call: TtrpgOpenModelCallV1
  mode: 'reserve' | 'dispatch' | 'finish'
}): Promise<TtrpgOpenAgentEvidenceV1> {
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  const { call } = input
  const bound = snapshot.contract.scope.runtime
  const binding = snapshot.contract.executionBindings?.find(binding => binding.stepId === call.stepId)
  const step = snapshot.projection.steps[call.stepId]
  if (snapshot.run.productRuntimeSessionId !== input.sessionId || snapshot.run.contractHash !== call.runContractHash
    || !bound || bound.productRuntimeSessionId !== input.sessionId || bound.visibilityHash !== call.visibilityHash
    || bound.releaseHash !== call.runtimeSourceHash || binding?.skillId !== call.skillId
    || call.skillId !== 'prose.ttrpg-open-intent' || snapshot.contract.permissions.writeTargets.length
    || [...snapshot.contract.permissions.contextSourceKeys].sort().join(',') !== 'ttrpgOpenAuthority,ttrpgOpenKnowledge'
    || step?.attempt !== call.attempt || (input.mode !== 'finish' && step.status !== 'running')
    || snapshot.contract.runtimeBindingHash !== await ttrpgOpenCallBindingHashV1({ sessionKey: call.createdRef.sessionKey,
      actorKey: call.actorKey, authorizationEpochKey: call.authorizationEpochKey, admissionStateHash: call.admissionStateHash,
      visibilityHash: call.visibilityHash, runtimeSourceHash: call.runtimeSourceHash })) {
    throw new Error('[ttrpg-open-call] 模型请求没有同一实例/角色/Skill 的真实运行契约')
  }
  if (binding.version === 1 && input.mode !== 'finish') {
    const { stepId: _stepId, formalEntry: _formalEntry, promptExecution: _promptExecution, ...skillBinding } = binding
    assertAgentSkillExecutionBindingV1(skillBinding, getAgentSkillV1(call.skillId))
  }
  if (input.mode === 'reserve') {
    const state = await readProductRuntimeState(input.sessionId)
    const alreadyCounted = parseTtrpgRuntimeStateV2(state.ttrpg)?.openRun?.coordination.calls.filter(previous => previous.runContractHash === call.runContractHash).length ?? 0
    if (alreadyCounted >= snapshot.contract.budget.maxModelCalls || call.reservedInputTokens > snapshot.contract.budget.maxInputTokens
      || call.reservedOutputTokens > Math.min(snapshot.contract.budget.maxOutputTokens, getAgentSkillV1(call.skillId).maxOutputTokens)
      || call.attempt > snapshot.contract.budget.maxAttemptsPerStep) throw new Error('[ttrpg-open-call] 请求超过冻结 Run/Skill 硬预算')
  }
  if (!snapshot.events.some(event => event.type === 'context.assembled' && event.payload.stepId === call.stepId
    && event.payload.attempt === call.attempt && event.payload.manifestHash === call.inputManifestHash)) {
    throw new Error('[ttrpg-open-call] 缺少同一 attempt 的实际上下文回执')
  }
  if (!snapshot.events.some(event => event.type === 'model.requested' && event.payload.stepId === call.stepId
    && event.payload.attempt === call.attempt && event.payload.bindingHash === call.requestHash)) {
    throw new Error('[ttrpg-open-call] 缺少同一 attempt 的真实模型请求绑定')
  }
  const artifacts: AgentRunArtifactRecordV1[] = []
  const exact = async (kind: AgentRunArtifactRecordV1['artifactKind'], hash: string) => {
    if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind
      && event.payload.contentHash === hash && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt)) {
      throw new Error('[ttrpg-open-call] 原始请求/响应缺少同一 attempt 的真实工件回执')
    }
    const body = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: kind, contentHash: hash })
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, kind, hash]).first()
    if (!row || row.content !== body || row.retentionState !== 'available') throw new Error('[ttrpg-open-call] 工件读取期间发生变化')
    if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind
      && event.payload.contentHash === hash && event.payload.byteLength === row.byteLength
      && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt)) throw new Error('[ttrpg-open-call] 原始工件的字节回执不一致')
    artifacts.push(row)
    return body
  }
  const renderedRequest = await exact('rendered-request', call.requestHash)
  if (estimateTokens(renderedRequest) > call.reservedInputTokens) throw new Error('[ttrpg-open-call] 实际请求超过预留输入预算')
  // Context snapshots use governed exact storage; a caller-provided hash alone is insufficient.
  let foundManifest = false
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== call.stepId || event.payload.attempt !== call.attempt) continue
    const body = await exact('source-snapshot', event.payload.contentHash)
    let manifest: unknown
    try { manifest = JSON.parse(body) } catch { continue }
    if (!manifest || typeof manifest !== 'object' || !('manifestHash' in manifest) || manifest.manifestHash !== call.inputManifestHash) continue
    const version = 'version' in manifest ? manifest.version : null
    const valid = version === 1 ? await verifyContextManifestIntegrityV1(manifest)
      : version === 2 ? await verifyContextManifestIntegrityV2(manifest) : version === 3 ? await verifyContextManifestIntegrityV3(manifest) : false
    if (!valid || !('runId' in manifest) || manifest.runId !== input.runId || !('stepId' in manifest) || manifest.stepId !== call.stepId
      || !('attempt' in manifest) || manifest.attempt !== call.attempt) throw new Error('[ttrpg-open-call] 实际 Context Manifest 完整性或 attempt 不一致')
    const scope = 'scope' in manifest && manifest.scope && typeof manifest.scope === 'object' ? manifest.scope : null
    if (!scope || !('projectId' in scope) || scope.projectId !== input.scope.projectId
      || !('worldGroupId' in scope) || scope.worldGroupId !== snapshot.contract.scope.worldGroupId) {
      throw new Error('[ttrpg-open-call] 实际 Context Manifest 不属于冻结工作区')
    }
    const sources = 'sources' in manifest && Array.isArray(manifest.sources) ? manifest.sources : []
    if (sources.map(source => source.key).sort().join(',') !== 'ttrpgOpenAuthority,ttrpgOpenKnowledge'
      || sources.some(source => source.status !== 'included' || source.delivery !== 'full' || !source.contentHash)
      || !('totalInputTokens' in manifest) || typeof manifest.totalInputTokens !== 'number'
      || manifest.totalInputTokens > call.reservedInputTokens) throw new Error('[ttrpg-open-call] 角色契约/知识来源不完整或超过实际输入预算')
    foundManifest = true; break
  }
  if (!foundManifest) throw new Error('[ttrpg-open-call] 缺少可回读的实际 Context Manifest')
  if (call.responseArtifactHash !== null) {
    await exact('raw-response', call.responseArtifactHash)
    if (!snapshot.events.some(event => event.type === 'model.responded' && event.payload.stepId === call.stepId
      && event.payload.attempt === call.attempt && event.payload.outputHash === call.responseArtifactHash)) {
      throw new Error('[ttrpg-open-call] 原始响应缺少同一 attempt 的实际模型回执')
    }
  }
  if (input.mode !== 'finish') {
    const context = await loadTtrpgOpenPlayerContextV1({ scope: input.scope, sessionId: input.sessionId, actorKey: call.actorKey })
    if (context.visibilityHash !== call.visibilityHash || context.admissionStateHash !== call.admissionStateHash
      || context.readEvidence.runtimeSourceHash !== call.runtimeSourceHash
      || (input.mode === 'reserve' && (context.readEvidence.sequence !== bound.baseSequence || context.readEvidence.stateHash !== bound.stateHash))) {
      throw new Error('[ttrpg-open-call] 模型派发输入已 stale，不能使用旧权限或机械状态')
    }
  }
  const events = await db.agentRunEvents.where('runId').equals(input.runId).sortBy('sequence')
  const run = await db.agentRuns.get(input.runId)
  if (!run || stable(run) !== stable(snapshot.run) || events.length !== snapshot.events.length
    || events.some((event, index) => {
      const expected = snapshot.events[index]
      return event.sequence !== expected.sequence || event.type !== expected.type || event.contractHash !== expected.contractHash
        || stable(JSON.parse(event.payloadJson)) !== stable(expected.payload)
    })) throw new Error('[ttrpg-open-call] 运行证据读取期间发生变化')
  return { run: snapshot.run, events, artifacts }
}

/** Called only inside the encompassing runtime rw transaction. */
export async function assertTtrpgOpenAgentEvidenceUnchangedV1(evidence: TtrpgOpenAgentEvidenceV1): Promise<void> {
  const run = await db.agentRuns.get(evidence.run.id)
  const events = await db.agentRunEvents.where('runId').equals(evidence.run.id).sortBy('sequence')
  if (stable(run) !== stable(evidence.run) || stable(events) !== stable(evidence.events)) throw new Error('[ttrpg-open-call] 提交期间运行证据已变化')
  for (const artifact of evidence.artifacts) {
    if (stable(await db.agentRunArtifacts.get(artifact.id!)) !== stable(artifact)) throw new Error('[ttrpg-open-call] 提交期间原始工件已变化')
  }
}
