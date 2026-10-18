/** Original completed intent -> one durable, independently governed speech Run.
 * Preparation is resumable bookkeeping, never a model dispatch or audio result. */
import type { WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentSkillExecutionBindingV2, projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { freezeFormalAIEntryBindingV1, executeFrozenFormalAudioEntryV1 } from '../agent/formal-ai-entry'
import { acceptAgentRunContract } from '../agent/run/contract'
import { AgentRunStoreError, createAgentRunV1, readInstanceAgentRunV1, appendAgentRunEventV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { createContextManifestFromAssemblyV1, createContextManifestV2FromV1 } from '../agent/run/context-manifest'
import { AgentRunArtifactStoreError, recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { finishTtrpgOpenVoiceIntentForKernelV1 } from './open-voice-intent-receipt'
import { createTtrpgOpenVoiceExecutionInputForKernelV1, TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId,
  TTRPG_OPEN_VOICE_EXECUTION_RELATION_V1 as relation, TTRPG_OPEN_VOICE_EXECUTION_DECISION_V1 as decision,
  type TtrpgOpenVoiceExecutionInputV1 } from './open-voice-execution-input'
import * as p from './open-contract-parse'

type Locator = { scope: WorkspaceScope; sessionId: number; viewerKey: string; requestKey: string }
async function basis(request: Locator) {
  const original = await finishTtrpgOpenVoiceIntentForKernelV1(request, true)
  const assembled = await assembleContext({ projectId: request.scope.projectId, scope: request.scope, productRuntimeSessionId: request.sessionId,
    sourceKeys: ['ttrpgOpenVoiceText'], ttrpgVoiceRequest: { viewerKey: request.viewerKey, requestKey: request.requestKey, intentReceiptHash: original.receipt.receiptHash }, inputBudgetTokens: 8000 })
  if (assembled.included.join(',') !== 'ttrpgOpenVoiceText' || assembled.omitted.length || assembled.trimmed.length
    || assembled.segments.length !== 1 || assembled.text !== assembled.segments[0].content
    || assembled.sourceEvidence?.[0]?.delivery !== 'full' || assembled.overBudgetAfterTrim) p.fail('语音执行必须从注册来源完整读取准确原片段')
  const input = await createTtrpgOpenVoiceExecutionInputForKernelV1({ row: original.request, sourceText: assembled.text,
    intentReceiptHash: original.receipt.receiptHash, intentVerificationArtifactHash: original.artifactHash })
  const inputHash = await hashCanonicalValue(input), skill = getAgentSkillV1('prose.ttrpg-open-local-voice')
  const expected = await acceptAgentRunContract({ version: 3, executionBoundary: 'product-runtime',
    objective: 'ttrpg.open.local-voice:' + request.requestKey, workflowKind: 'direct-generation',
    lineage: { parent: { runId: original.snapshot.run.id, receiptHash: original.receipt.receiptHash, artifactHash: original.artifactHash, relation } },
    scope: { projectId: request.scope.projectId, worldGroupId: null, runtime: { productRuntimeSessionId: request.sessionId,
      baseSequence: original.request.readEvidence.sequence, stateHash: original.request.readEvidence.stateHash,
      visibilityHash: original.request.scriptHash, releaseHash: original.request.script.runtimeSourceHash } },
    permissions: { contextSourceKeys: ['ttrpgOpenVoiceText'], writeTargets: [] }, runtimeBindingHash: inputHash,
    executionBindings: [{ stepId, ...await createAgentSkillExecutionBindingV2(skill), formalEntry: await freezeFormalAIEntryBindingV1('ttrpg.open.local-voice') }],
    // Text-token caps describe registered context/envelope only. Physical
    // encoder/inference calls, chars, samples, bytes and time have separate caps.
    budget: { maxModelCalls: input.profile.maxSpeechInferenceCalls + input.profile.maxTextEncoderCalls, maxToolCalls: 0,
      maxInputTokens: 8000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'voice.audio-candidate', kind: 'deterministic-check', required: true }],
    verificationPlan: [{ id: 'voice.audio-terminal', kind: 'terminal', verifier: 'ttrpg.open.local-voice-v1', criterionIds: ['voice.audio-candidate'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } })
  await original.owner.assertCurrent()
  return { original, assembled, input, inputHash, expected }
}

async function readChild(request: Locator, b: Awaited<ReturnType<typeof basis>>) {
  const rows = await db.agentRuns.where('[parentRunId+parentRelation]').equals([b.original.snapshot.run.id, relation]).toArray()
  if (rows.length > 1) p.fail('原配音意图存在重复执行子任务，保留证据并停止')
  if (!rows.length) return null
  const snapshot = await readInstanceAgentRunV1(request.scope, rows[0].id!)
  if (snapshot.run.portableRuntimeOriginJson !== undefined || snapshot.run.productRuntimeSessionId !== request.sessionId
    || snapshot.run.contractHash !== b.expected.contractHash || snapshot.run.contractJson !== canonicalStringify(b.expected.contract)) p.fail('执行子任务不属于原本人、本机、原读法与冻结产品合同')
  return snapshot
}

async function material(request: Locator, b: Awaited<ReturnType<typeof basis>>, snapshot: AgentRunSnapshotV1) {
  const manifestV1 = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId, attempt: 1,
    projectId: request.scope.projectId, worldGroupId: null, declaredSourceKeys: ['ttrpgOpenVoiceText'], assembled: b.assembled, readerVersion: 'ttrpg.open.local-voice-source-v1' })
  const manifest = await createContextManifestV2FromV1({ manifest: manifestV1, scope: request.scope })
  return { manifest, inputContent: canonicalStringify(b.input), manifestContent: canonicalStringify(manifest) }
}
function hasArtifact(snapshot: AgentRunSnapshotV1, kind: 'source-snapshot' | 'context-manifest', hash: string) {
  return snapshot.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === kind
    && e.payload.stepId === stepId && e.payload.attempt === 1 && e.payload.contentHash === hash)
}
async function assertMaterial(request: Locator, b: Awaited<ReturnType<typeof basis>>, snapshot: AgentRunSnapshotV1, m: Awaited<ReturnType<typeof material>>) {
  const manifestArtifactHash = await hashCanonicalValue(m.manifest)
  if (!hasArtifact(snapshot, 'source-snapshot', b.inputHash) || !hasArtifact(snapshot, 'context-manifest', manifestArtifactHash)
    || await readAgentRunArtifactExactV1({ projectId: request.scope.projectId, artifactKind: 'source-snapshot', contentHash: b.inputHash }) !== m.inputContent
    || await readAgentRunArtifactExactV1({ projectId: request.scope.projectId, artifactKind: 'context-manifest', contentHash: manifestArtifactHash }) !== m.manifestContent
    || !snapshot.events.some(e => e.type === 'context.assembled' && e.payload.stepId === stepId && e.payload.attempt === 1 && e.payload.manifestHash === m.manifest.manifestHash)) p.fail('语音执行缺少原准确输入和实际 Context Manifest；读取不会代替修复')
  await b.original.owner.assertCurrent()
  return { requestKey: request.requestKey, runId: snapshot.run.id, inputArtifactHash: b.inputHash,
    manifestHash: m.manifest.manifestHash, profileHash: b.input.profileHash,
    status: 'prepared' as const, generationAllowed: false as const, adoptionAllowed: false as const }
}

/** Explicit action; a lost return resumes only the unique original ledger.
 * No model.requested event, transport, quota reservation or media write here. */
export async function prepareTtrpgOpenLocalVoiceExecutionV1(request: Locator & { decision: typeof decision }) {
  const input = structuredClone(request)
  p.literal(input.decision, decision, 'explicit local voice preparation')
  const b = await basis(input)
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      await b.original.owner.assertCurrent()
      let snapshot = await readChild(input, b)
      if (!snapshot) {
        snapshot = await createAgentRunV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, worldGroupId: null, contract: b.expected.contract })
      }
      if (!['planned', 'running'].includes(snapshot.projection.state) || snapshot.events.some(e => ['model.requested', 'model.responded', 'tool.called', 'tool.returned', 'candidate.persisted'].includes(e.type))) p.fail('原语音执行已派发或结束，请查看原任务，不会重新准备或发送')
      const append = (type: 'step.scheduled' | 'step.started' | 'context.assembled', payload: unknown) => appendAgentRunEventV1({
        scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot!.run.id, type, payload,
        expectedLastSequence: snapshot!.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
      const step = snapshot.projection.steps[stepId]
      if (!step) { await append('step.scheduled', { stepId }); continue }
      if (step.status === 'scheduled') { await append('step.started', { stepId, attempt: 1 }); continue }
      if (step.status !== 'running' || step.attempt !== 1) p.fail('语音执行步骤不在原唯一准备状态')
      const m = await material(input, b, snapshot)
      for (const [kind, hash, content] of [['source-snapshot', b.inputHash, m.inputContent], ['context-manifest', await hashCanonicalValue(m.manifest), m.manifestContent]] as const) {
        if (!hasArtifact(snapshot, kind, hash)) {
          const stored = await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
            stepId, attempt: 1, artifactKind: kind, content, expectedLastSequence: snapshot.projection.lastSequence })
          snapshot = stored.snapshot
        }
      }
      if (!snapshot.events.some(e => e.type === 'context.assembled' && e.payload.stepId === stepId && e.payload.attempt === 1)) {
        await append('context.assembled', { stepId, attempt: 1, manifestHash: m.manifest.manifestHash }); continue
      }
      return await assertMaterial(input, b, snapshot, m)
    } catch (error) {
      // Only deterministic ledger contention can be retried. No model/network
      // activity is involved; failures/unknown/stale never create another child.
      if (!(error instanceof AgentRunStoreError && ['sequence_conflict', 'duplicate_child'].includes(error.code))
        && !(error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict')) throw error
    }
  }
  throw new Error('原语音执行准备持续竞争，请恢复同一任务；没有重新预留或发送')
}

/** Reload is read-only. Partial preparation must be explicitly resumed. */
export async function readTtrpgOpenLocalVoicePreparationV1(request: Locator) {
  const input = structuredClone(request), b = await basis(input), snapshot = await readChild(input, b)
  if (!snapshot) return null
  if (snapshot.projection.state === 'planned') p.fail('原语音任务准备尚未完成，请明确恢复同一任务')
  if (snapshot.projection.state !== 'running' || snapshot.events.some(e => ['model.requested', 'model.responded', 'tool.called', 'tool.returned', 'candidate.persisted'].includes(e.type))) p.fail('原任务已离开准备阶段，请读取真实执行状态')
  return assertMaterial(input, b, snapshot, await material(input, b, snapshot))
}

/** Internal bridge boundary. A transport must durably own this exact job key
 * before inference; its worker must recompute the confirmed reading and retain
 * output on disk. UI wiring and the actual offline worker are separate work. */
export interface TtrpgOpenLocalVoiceTransportV1 {
  kind: 'local-offline-speech-v1'; profileHash: string
  execute: (input: { jobKey: string; inputArtifactHash: string; execution: TtrpgOpenVoiceExecutionInputV1; signal?: AbortSignal; assertCurrentBeforeStart: () => Promise<void> }) => Promise<string>
}
/** One durable dispatch only. Raw bytes are evidence, never an accepted audio
 * candidate. Unknown/lost returns are inspected by job key, never auto resent. */
export async function dispatchTtrpgOpenLocalVoiceForKernelV1(request: Locator & {
  decision: 'dispatch-this-original-local-voice-execution'; transport: TtrpgOpenLocalVoiceTransportV1; signal?: AbortSignal
}) {
  const input = structuredClone({ scope: request.scope, sessionId: request.sessionId, viewerKey: request.viewerKey, requestKey: request.requestKey, decision: request.decision })
  const transport = { kind: request.transport.kind, profileHash: request.transport.profileHash, execute: request.transport.execute.bind(request.transport) }, signal = request.signal
  p.literal(input.decision, 'dispatch-this-original-local-voice-execution', 'explicit local speech dispatch')
  signal?.throwIfAborted()
  const b = await basis(input), snapshot = await readChild(input, b)
  if (!snapshot) p.fail('须先明确准备原语音执行，派发不会新建任务')
  if (transport.kind !== 'local-offline-speech-v1' || transport.profileHash !== b.input.profileHash) p.fail('本机传输与原冻结语音版本不匹配')
  const jobKey = `ttrpg.voice.${snapshot.run.id}.${b.inputHash}`
  if (snapshot.events.some(e => e.type === 'model.requested')) return { status: 'dispatch-already-recorded' as const, runId: snapshot.run.id, jobKey, automaticRetryAllowed: false as const }
  await assertMaterial(input, b, snapshot, await material(input, b, snapshot))
  const binding = snapshot.contract.executionBindings?.find(row => row.stepId === stepId)
  if (!binding || binding.version !== 2 || !binding.formalEntry || snapshot.projection.state !== 'running') p.fail('原语音任务缺少正式冻结绑定或已结束')
  const frozenSkill = projectFrozenAgentSkillDefinitionV1(binding)
  signal?.throwIfAborted(); await b.original.owner.assertCurrent()
  let current: AgentRunSnapshotV1
  try {
    current = await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
      type: 'model.requested', payload: { stepId, attempt: 1, bindingHash: b.inputHash }, expectedLastSequence: snapshot.projection.lastSequence })
  } catch (error) {
    if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict')) throw error
    // A competing durable claimant won. Do not call the transport, even if it
    // has not returned yet. Subsequent recovery inspects the original job.
    return { status: 'dispatch-claim-conflict' as const, runId: snapshot.run.id, jobKey, automaticRetryAllowed: false as const }
  }
  try {
    await b.original.owner.assertCurrent()
    const raw = await executeFrozenFormalAudioEntryV1('ttrpg.open.local-voice', binding.formalEntry, frozenSkill,
      'src/lib/ttrpg/open-voice-execution.ts', async () => {
        // Frozen-entry verification is asynchronous. Consent/pause/identity
        // can change while it runs, so the last check belongs inside invoke.
        await b.original.owner.assertCurrent(); signal?.throwIfAborted()
        return transport.execute({ jobKey, inputArtifactHash: b.inputHash, execution: structuredClone(b.input), signal,
          assertCurrentBeforeStart: async () => {
            // Waiting/lease renewal may span harmless game progress. Re-read
            // the same registered original source and current consent rather
            // than granting new text or relying on an old state snapshot.
            const fresh = await basis(input)
            if (fresh.inputHash !== b.inputHash) p.fail('原文字、读法、受众或执行版本已经变化')
            signal?.throwIfAborted()
          } })
      },
      { category: 'runtime.ttrpg-open.local-voice', projectId: input.scope.projectId }, signal)
    // The file cap remains the existing 100 MiB. Base64 envelope allowance is
    // separate, bounded, and is not misreported as allocated audio bytes.
    if (typeof raw !== 'string' || !raw.length || new TextEncoder().encode(raw).byteLength > Math.ceil(b.input.profile.maxAudioBytes / 3) * 4 + 1048576) p.fail('原始语音响应为空或超过独立传输预算；检查原本机 job，不重发')
    const stored = await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
      stepId, attempt: 1, artifactKind: 'raw-response', content: raw, expectedLastSequence: current.projection.lastSequence })
    current = stored.snapshot
    await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
      type: 'model.responded', payload: { stepId, attempt: 1, outputHash: stored.artifact.contentHash }, expectedLastSequence: current.projection.lastSequence })
    return { status: 'raw-response-recorded' as const, runId: snapshot.run.id, jobKey, responseArtifactHash: stored.artifact.contentHash,
      candidateAccepted: false as const, adoptionAllowed: false as const }
  } catch (error) {
    const latest = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
    if (latest.projection.state === 'running') await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
      type: 'run.paused', payload: { reason: '语音派发已记账；发送、返回或留存结果需按原 job 核查。不得自动重发、返还额度或当作已确认停止。', recoverable: true }, expectedLastSequence: latest.projection.lastSequence })
    throw error
  }
}

/** The explicit generate action reuses the already reserved original reading.
 * A probe/refresh cannot call this action or manufacture a new reservation. */
export async function generateTtrpgOpenLocalVoiceV1(request: Locator & { decision: 'generate-this-original-confirmed-local-voice'; signal?: AbortSignal }) {
  const input = structuredClone({ scope: request.scope, sessionId: request.sessionId, viewerKey: request.viewerKey, requestKey: request.requestKey, decision: request.decision }), signal = request.signal
  p.literal(input.decision, 'generate-this-original-confirmed-local-voice', 'explicit original speech generation')
  signal?.throwIfAborted()
  const prepared = await prepareTtrpgOpenLocalVoiceExecutionV1({ ...input, decision })
  const { createTtrpgOpenLocalVoiceTransportV1 } = await import('./open-local-voice-transport')
  const transport = await createTtrpgOpenLocalVoiceTransportV1(signal)
  const result = await dispatchTtrpgOpenLocalVoiceForKernelV1({ ...input, decision: 'dispatch-this-original-local-voice-execution', signal, transport })
  return { prepared, result }
}
