import {AIError} from '../types'
import {classifyHarnessFailureV1, type HarnessFailureClassV1} from '../agent/run/harness-failure'
import {db} from '../db/schema'
import type {AgentRunEventTypeV1, ProductMediaAsset, WorkspaceScope} from '../types'
import {assembleContext} from '../registry/assemble-context'
import {hashCanonicalValue} from '../agent/run/hash'
import {createAgentSkillExecutionBindingV1} from '../agent/execution-binding'
import {getAgentSkillV1} from '../agent/skill-registry'
import {appendAgentRunEventV1, createAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1} from '../agent/run/checkpoint'
import {createContextManifestFromAssemblyV1} from '../agent/run/context-manifest'
import {createVerificationReceiptV1} from '../agent/run/verification-receipt'
import {recordAgentRunArtifactV1} from '../memory/artifact-store'
import {resolveConfiguredAgnesImageCapabilityV1, type ResolvedProductMediaCapabilityV1} from '../product-production/media-transport'
import {detectProductImageDimensionsV1, type ProductMediaRequestV1} from '../product-production/media-adapters'
import {importProductRuntimeMediaAssetV1} from '../product/runtime-media-library'
import {readProductMediaBlobData} from '../product-production/media-blob-store'
import {readChatRuntimeVisualContextV1, type ChatRuntimeVisualContextV1, type ChatRuntimeVisualRequestV1} from './runtime-visual-context'

const SKILL = 'character.chat-runtime-visuals', STEP = 'chat:runtime-visual', SOURCE = 'chat.runtime-visuals'
const VERIFIER = 'chat-runtime-visual-v1', KIND = 'storyforge.chat-runtime-visual-run'
interface VisualPayload {
  kind: typeof KIND; version: 1
  context: ChatRuntimeVisualContextV1; request: ChatRuntimeVisualRequestV1
  manifestHash: string
  status: 'prepared' | 'requested' | 'available' | 'failed'
  asset: {assetKey: string; contentHash: string} | null
  issue: string | null
  slotAttempt?: number
  explicitRetry?: boolean
}
export interface ChatRuntimeVisualJobV1 {
  runId: number; request: ChatRuntimeVisualRequestV1
  status: 'available' | 'failed' | 'unknown'; issue: string | null
  asset: ProductMediaAsset | null
}
const locks = new Set<number>()
export function latestChatVisualJobsV1(jobs: ChatRuntimeVisualJobV1[]) {
  const latest = new Map<string, ChatRuntimeVisualJobV1>()
  for (const job of jobs) if ((latest.get(job.request.key)?.runId ?? -1) < job.runId) latest.set(job.request.key, job)
  return latest
}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: AgentRunEventTypeV1, payload: unknown) {
  return appendAgentRunEventV1({scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? undefined, type, payload, expectedLastSequence: snapshot.projection.lastSequence} as Parameters<typeof appendAgentRunEventV1>[0])
}
async function checkpoint(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: VisualPayload) {
  return (await createAgentRunCheckpointV1({scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? undefined, resumePayload: payload, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
}

/** Historical results are read without touching credentials or retrying. The
 * content key is portable; database ids are resolved within the current save. */
export async function readChatRuntimeVisualJobsV1(scope: WorkspaceScope, sessionId: number): Promise<ChatRuntimeVisualJobV1[]> {
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session || session.kind !== 'character-interaction' || session.projectId !== scope.projectId || session.workId !== scope.workId || session.worldId !== scope.worldId) throw new Error('聊天图片不属于当前存档')
  const runs = (await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray()).filter(run => run.contractJson.includes(`"skillId":"${SKILL}"`))
  const assets = await db.productMediaAssets.where('productRuntimeSessionId').equals(sessionId).toArray()
  const jobs: ChatRuntimeVisualJobV1[] = []
  for (const run of runs) {
    const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, run.id!, {owner: 'instance'})
    const payload = saved?.resumePayload as VisualPayload | undefined
    if (!saved || payload?.kind !== KIND || payload.version !== 1 || payload.context.releaseHash !== session.runtimeSourceHash
      || saved.snapshot.contract.scope.runtime?.releaseHash !== payload.context.releaseHash) continue
    const boundHash = await hashCanonicalValue({context: payload.context, request: payload.request})
    if (boundHash !== saved.snapshot.contract.runtimeBindingHash) throw new Error('图片请求与冻结情境绑定不一致')
    const asset = payload.asset && assets.find(asset => asset.ownerKind === 'runtime' && asset.productType === 'character-interaction'
      && asset.assetKey === payload.asset!.assetKey && asset.contentHash === payload.asset!.contentHash && asset.workId === scope.workId)
    // Import retains the verified candidate checkpoint, while terminal Run
    // receipts must be re-evidenced for new database identities. The image is
    // independently usable from its immutable candidate hash and scoped bytes;
    // this does not re-label the imported Run as completed.
    const completed = payload.status === 'available' && !!asset && !!saved.snapshot.projection.steps[STEP]?.candidateHash
    jobs.push({runId: run.id!, request: payload.request, asset: completed ? asset : null,
      status: completed ? 'available' : payload.status === 'failed' ? 'failed' : 'unknown', issue: payload.issue})
  }
  return jobs
}

/** One provider attempt per durable run. A confirmed failure can receive at
 * most two explicit new attempts; refresh and unknown outcomes never retry. */
export async function generateChatRuntimeVisualsV1(input: {
  scope: WorkspaceScope; sessionId: number; signal?: AbortSignal
  /** A separate visible player command; never enabled by automatic updates. */
  retryFailed?: boolean
  /** Inject the real adapter with a test transport, not an alternate image path. */
  capability?: ResolvedProductMediaCapabilityV1
  onProgress?: () => void
}): Promise<ChatRuntimeVisualJobV1[]> {
  if (locks.has(input.sessionId)) return readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
  locks.add(input.sessionId)
  const action = async () => {
    const assembled = await assembleContext({projectId: input.scope.projectId, scope: input.scope, productRuntimeSessionId: input.sessionId,
      sourceKeys: [SOURCE], inputBudgetMaxTokens: 12000})
    if (assembled.included.join(',') !== SOURCE || assembled.trimmed.length || assembled.overBudgetAfterTrim
      || assembled.sourceEvidence?.some(source => source.delivery !== 'full')) throw new Error('当前画面资料无法完整读取，未调用图片服务')
    const context = JSON.parse(assembled.segments[0].content) as ChatRuntimeVisualContextV1
    const jobs = await readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
    const latest = latestChatVisualJobsV1(jobs)
    const pending = context.requests.filter(request => !latest.has(request.key)
      || input.retryFailed === true && latest.get(request.key)?.status === 'failed'
        && jobs.filter(job => job.request.key === request.key).length < 3)
    if (!pending.length) return jobs
    if (jobs.length + pending.length > context.maximumImages) throw new Error('此存档的剧情配图次数已用完，仍可继续文字聊天')
    const capability = input.capability ?? await resolveConfiguredAgnesImageCapabilityV1({projectId: input.scope.projectId, requirement: {
      requirementKey: 'chat.runtime.image', mediaClass: 'image', operation: 'generate', adapterFamily: 'image', minimumCapabilityVersion: '1',
      allowedDataClasses: ['product-public-presentation'], maximumRequestCost: null, maximumTotalCost: null,
      rightsPolicyVersion: 'chat-runtime-visual-v1', capabilityHash: await hashCanonicalValue('chat-runtime-visual-v1'), required: true}})
    for (const request of pending) {
      if (input.signal?.aborted) break
      const fresh = await readChatRuntimeVisualContextV1(input.scope, input.sessionId)
      if (fresh.stateHash !== context.stateHash || fresh.releaseHash !== context.releaseHash) break
      const session = await db.productRuntimeSessions.get(input.sessionId)
      if (!session) break
      const slotAttempt = jobs.filter(job => job.request.key === request.key).length + 1
      const bindingHash = await hashCanonicalValue({context, request}), skill = getAgentSkillV1(SKILL)
      let snapshot = await createAgentRunV1({scope: input.scope, productRuntimeSessionId: input.sessionId, worldGroupId: session.worldGroupId ?? null,
        contract: {version: 1, objective: '表现当前已提交剧情，不改变角色、故事或发布版本', workflowKind: 'direct-generation',
          scope: {projectId: input.scope.projectId, worldGroupId: session.worldGroupId ?? null, runtime: {productRuntimeSessionId: input.sessionId,
            baseSequence: context.sequence, stateHash: context.stateHash, visibilityHash: await hashCanonicalValue(context), releaseHash: context.releaseHash}},
          permissions: {contextSourceKeys: [SOURCE], writeTargets: []}, runtimeBindingHash: bindingHash,
          executionBindings: [{stepId: STEP, ...createAgentSkillExecutionBindingV1(skill)}],
          budget: {maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 12000, maxOutputTokens: 1, maxAttemptsPerStep: 1},
          acceptance: [{id: 'visual.bytes-and-owner', kind: 'deterministic-check', required: true}],
          verificationPlan: [{id: 'visual.terminal', kind: 'terminal', verifier: VERIFIER, criterionIds: ['visual.bytes-and-owner']}],
          failurePolicy: {onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author'}}})
      snapshot = await append(input.scope, snapshot, 'step.scheduled', {stepId: STEP})
      snapshot = await append(input.scope, snapshot, 'step.started', {stepId: STEP, attempt: 1})
      const manifest = await createContextManifestFromAssemblyV1({runId: snapshot.run.id, stepId: STEP, attempt: 1,
        projectId: input.scope.projectId, worldGroupId: session.worldGroupId ?? null, assembled, declaredSourceKeys: [SOURCE], readerVersion: 'chat-runtime-visual-v1'})
      snapshot = await append(input.scope, snapshot, 'context.assembled', {stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash})
      const payload: VisualPayload = {kind: KIND, version: 1, context, request, manifestHash: manifest.manifestHash, status: 'prepared', asset: null, issue: null,
        slotAttempt, explicitRetry: slotAttempt > 1}
      snapshot = await checkpoint(input.scope, snapshot, payload)
      const mediaRequest: ProductMediaRequestV1 = {schema: 'storyforge.product-media-request', version: 1,
        requestId: `chat-visual-${snapshot.run.id}`, adapterId: capability.adapter.capability.adapterId, mediaClass: 'image', mediaKind: request.kind,
        requirementKey: 'chat.runtime.image', artifactKey: `chat.runtime.${request.key}${slotAttempt > 1 ? `.attempt-${slotAttempt}` : ''}`, prompt: request.prompt,
        negativePrompt: '文字、水印、未发生的情节、额外人物、改变角色身份', count: 1,
        width: request.kind === 'character-expression' ? 768 : 1536, height: 1024, durationMs: null, inputHash: bindingHash,
        qualityProfile: 'internal', environment: 'production', allowedDataClasses: ['product-public-presentation'], rightsPolicyVersion: 'chat-runtime-visual-v1'}
      snapshot = (await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.sessionId,
        artifactKind: 'tool-result', content: JSON.stringify({manifest, mediaRequest}), stepId: STEP, attempt: 1,
        expectedLastSequence: snapshot.projection.lastSequence})).snapshot
      snapshot = await append(input.scope, snapshot, 'model.requested', {stepId: STEP, attempt: 1, bindingHash: await hashCanonicalValue(mediaRequest)})
      payload.status = 'requested'; snapshot = await checkpoint(input.scope, snapshot, payload); input.onProgress?.()
      let stage: HarnessFailureClassV1 = 'provider'
      try {
        const candidates = await capability.adapter.generate(mediaRequest, capability.transport, input.signal ?? new AbortController().signal)
        stage = 'parse'
        if (candidates.length !== 1) throw new Error('图片返回数量不符合请求')
        const candidate = await capability.adapter.parseAndVerify(candidates[0])
        // Chat consumes an image card, not a composited stage sprite. Keep the
        // provider's original pixels instead of risking destructive keying.
        const data = candidate.data, mimeType = candidate.mimeType
        const dimensions = detectProductImageDimensionsV1(data)
        if (!dimensions) throw new Error('图片格式或尺寸无法验证')
        // Late output remains owned by its original event and save. Display
        // selection checks the current frame; it cannot overwrite current art.
        stage = 'save'
        const asset = await importProductRuntimeMediaAssetV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
          assetKey: mediaRequest.artifactKey, kind: request.kind, name: request.alt.slice(0, 200), altText: request.alt,
          blob: new Blob([data], {type: mimeType}), width: dimensions.width, height: dimensions.height,
          source: candidate.adapterId, license: JSON.stringify(candidate.rights), characterTag: request.participantKey ?? '', sceneTag: request.frameKey})
        const blob = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
        if (!blob) throw new Error('已生成图片缺少持久化字节')
        await readProductMediaBlobData({scope: input.scope, blob, expected: asset})
        const result = {requestKey: request.key, assetKey: asset.assetKey, contentHash: asset.contentHash,
          originalContentHash: candidate.contentHash, providerReceipt: candidate.providerReceipt, rights: candidate.rights, preservesOriginalPixels: true}
        const outputHash = await hashCanonicalValue(result)
        snapshot = (await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.sessionId,
          artifactKind: 'tool-result', content: JSON.stringify(result), stepId: STEP, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
        snapshot = await append(input.scope, snapshot, 'model.responded', {stepId: STEP, attempt: 1, outputHash})
        snapshot = await append(input.scope, snapshot, 'candidate.persisted', {stepId: STEP, attempt: 1, candidateHash: outputHash, requiresConfirmation: false})
        payload.status = 'available'; payload.asset = {assetKey: asset.assetKey, contentHash: asset.contentHash}
        snapshot = await checkpoint(input.scope, snapshot, payload)
        stage = 'terminal'
        snapshot = await append(input.scope, snapshot, 'step.succeeded', {stepId: STEP, attempt: 1, outputHash})
        snapshot = await append(input.scope, snapshot, 'verification.started', {verifierSetVersion: VERIFIER})
        const receipt = await createVerificationReceiptV1({version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
          contractHash: snapshot.run.contractHash, contextManifestHashes: [manifest.manifestHash], candidateHashes: [outputHash], adoptionEventIds: [],
          postStateHash: asset.contentHash, verifierSetVersion: VERIFIER, criteria: [{id: 'visual.bytes-and-owner', status: 'passed', evidenceRefs: [`asset:${asset.assetKey}:${asset.contentHash}`]}], acceptedAt: Date.now()})
        snapshot = (await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.sessionId,
          artifactKind: 'tool-result', content: JSON.stringify(receipt), stepId: STEP, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
        await append(input.scope, snapshot, 'verification.accepted', {receiptHash: receipt.receiptHash})
      } catch (cause) {
        const evidence = await classifyHarnessFailureV1(cause, {stage})
        const status = cause instanceof AIError ? cause.status : undefined
        const unknown = stage === 'provider' && !(typeof status === 'number' && status >= 400)
        payload.status = unknown ? 'requested' : 'failed'
        payload.issue = `${unknown ? '图片请求结果尚未确认' : `图片${evidence.label}未完成${status ? `（HTTP ${status}）` : ''}`}；已保留请求，没有自动重发。可继续聊天。`
        // Only a safe classification/fingerprint is retained; provider error
        // bodies can contain endpoint credentials and must not enter evidence.
        snapshot = (await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.sessionId,
          artifactKind: 'tool-result', content: JSON.stringify({requestKey: request.key, failure: evidence, outcome: unknown ? 'unknown' : 'failed', status}),
          stepId: STEP, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
        snapshot = await checkpoint(input.scope, snapshot, payload)
        if (unknown || stage === 'terminal') await append(input.scope, snapshot, 'run.paused', {reason: payload.issue, recoverable: true})
        else {
          snapshot = await append(input.scope, snapshot, 'step.failed', {stepId: STEP, attempt: 1, code: evidence.code, fingerprint: evidence.fingerprint, retryable: false, category: 'deterministic', action: 'fail'})
          await append(input.scope, snapshot, 'run.failed', {code: evidence.code, retryable: false})
        }
        input.onProgress?.(); break
      }

      input.onProgress?.()
    }
    return readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`storyforge:chat-media:${db.name}:${input.sessionId}`, {ifAvailable: true}, async lock => {
      if (!lock) return readChatRuntimeVisualJobsV1(input.scope, input.sessionId)
      return action()
    })
    if (typeof window !== 'undefined' && !input.capability) throw new Error('当前浏览器不支持图片请求锁定')
    return await action()
  } finally {locks.delete(input.sessionId)}
}
