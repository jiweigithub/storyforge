import {resolveRequestConfig, type ChatResult} from '../ai/client'
import {estimateTokens} from '../ai/context-budget'
import {computeKnownCostUsd} from '../ai/usage-log'
import {createAgentSkillExecutionBindingV1} from '../agent/execution-binding'
import {executeFrozenFormalAIEntryV1, freezeFormalAIEntryBindingV1} from '../agent/formal-ai-entry'
import {createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1} from '../agent/run/checkpoint'
import {createContextManifestFromAssemblyV1} from '../agent/run/context-manifest'
import {appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {hashCanonicalValue} from '../agent/run/hash'
import {createVerificationReceiptV1} from '../agent/run/verification-receipt'
import {getAgentSkillV1} from '../agent/skill-registry'
import type {CreativeCallEvidenceV1} from '../agent/creative-reliability'
import {assembleContext} from '../registry/assemble-context'
import {db} from '../db/schema'
import {readOwnedRows} from '../workspace/scope'
import type {AgentRunRecord, AIConfig, ChatMessage, WorkspaceScope} from '../types'
import {readChatSourceReviewContextV1, type ChatSourceReviewContextV1, type ChatSourceReviewRequestV1} from './source-review-context'
import {CHAT_SOURCE_REVIEW_PROMPT_V1, createChatSourceSuggestionsArtifactV1} from './source-review-suggestions'

const STEP = 'chat:source-review', SKILL = 'chat.source-review.v1', ENTRY = 'chat.source-review', CATEGORY = 'authoring.chat-source-review'
const KIND = 'storyforge.chat-source-review-run', VERIFIER = 'chat-source-review-v1', SOURCE = 'chat.source-review'
const terminal = new Set(['completed', 'failed', 'cancelled'])
interface ReviewPayload {
  kind: typeof KIND
  version: 1
  request: ChatSourceReviewRequestV1
  context: ChatSourceReviewContextV1
  model: {provider: string; model: string}
  messages: ChatMessage[]
  manifestHash: string
  response: {raw: string; call: CreativeCallEvidenceV1} | null
  result: ReturnType<typeof createChatSourceSuggestionsArtifactV1> | null
}
export interface ChatSourceReviewRunViewV1 {
  runId: number
  status: 'ready' | 'blocked' | 'pending' | 'unknown' | 'cancelled' | 'stale'
  context: ChatSourceReviewContextV1 | null
  result: ReturnType<typeof createChatSourceSuggestionsArtifactV1> | null
}
export type ChatSourceReviewBoundaryV1 = 'prepared' | 'model.requested' | 'response.saved' | 'model.responded' | 'candidate.persisted'
const locks = new Set<number>()
async function withLock<T>(scope: WorkspaceScope, injected: boolean, action: () => Promise<T>): Promise<T> {
  if (locks.has(scope.workId)) throw new Error('资料整理仍在处理中')
  locks.add(scope.workId)
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`storyforge:chat-source-review:${db.name}:${scope.workId}`, {ifAvailable: true}, lock => {
      if (!lock) throw new Error('另一页面正在整理资料，请稍后查看结果')
      return action()
    })
    if (typeof window !== 'undefined' && !injected) throw new Error('当前浏览器无法锁定资料整理，请使用支持 Web Locks 的浏览器')
    return await action()
  } finally {locks.delete(scope.workId)}
}
async function reviewRuns(scope: WorkspaceScope) {
  return (await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', {owner: 'work'}))
    .filter(row => row.contractJson.includes(`"skillId":"${SKILL}"`)).sort((a, b) => b.id! - a.id!)
}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence} as Parameters<typeof appendAgentRunEventV1>[0])
}
async function checkpoint(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: ReviewPayload) {
  return (await createAgentRunCheckpointV1({scope, runId: snapshot.run.id, resumePayload: payload, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
}
async function bindingHash(payload: ReviewPayload) {
  return hashCanonicalValue({request: payload.request, context: payload.context, model: payload.model, messages: payload.messages})
}
async function load(scope: WorkspaceScope, runId: number) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!saved) throw new Error('资料整理的准备记录未保存，请结束该任务后重新开始')
  const payload = saved.resumePayload as ReviewPayload
  const snapshot = saved.snapshot
  if (payload?.kind !== KIND || payload.version !== 1
    || snapshot.contract.executionBindings?.[0]?.skillId !== SKILL
    || snapshot.contract.executionBindings?.[0]?.stepId !== STEP
    || snapshot.contract.runtimeBindingHash !== await bindingHash(payload)) throw new Error('资料整理的来源或运行绑定不一致')
  const requested = snapshot.events.filter(event => event.type === 'model.requested')
  const responded = snapshot.events.filter(event => event.type === 'model.responded')
  const promptHash = await hashCanonicalValue(payload.messages)
  const outputHash = payload.response ? await hashCanonicalValue(payload.response.raw) : null
  if (requested.length > 1 || responded.length > 1
    || requested.some(event => event.type === 'model.requested' && (event.payload.bindingHash !== promptHash || event.payload.stepId !== STEP || event.payload.attempt !== 1))
    || responded.some(event => event.type === 'model.responded' && (event.payload.outputHash !== outputHash || event.payload.stepId !== STEP || event.payload.attempt !== 1))
    || !!payload.response && (requested.length !== 1 || payload.response.call.outputHash !== outputHash
      || payload.response.call.provider !== payload.model.provider || payload.response.call.model !== payload.model.model)
    || !snapshot.events.some(event => event.type === 'context.assembled' && event.payload.manifestHash === payload.manifestHash))
    throw new Error('资料整理的请求、原始回复或上下文证据不一致')
  if (payload.response) {
    const candidateHash = await hashCanonicalValue(createChatSourceSuggestionsArtifactV1(payload.response.raw, payload.context, payload.response.call))
    if (payload.result && await hashCanonicalValue(payload.result) !== candidateHash
      || snapshot.events.some(event => event.type === 'candidate.persisted' && (!payload.result || event.payload.candidateHash !== candidateHash))) throw new Error('资料整理候选与原始回复不一致')
  }
  return {snapshot, payload}
}

/** Finish a retained response without any provider/config access or new call. */
async function finish(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: ReviewPayload,
  onBoundary?: (boundary: ChatSourceReviewBoundaryV1, runId: number) => void | Promise<void>) {
  if (!payload.response) throw new Error('请求结果尚未留存，不能自动重发')
  const responseHash = await hashCanonicalValue(payload.response.raw)
  if (!snapshot.events.some(event => event.type === 'model.responded'))
    snapshot = await append(scope, snapshot, 'model.responded', {stepId: STEP, attempt: 1, outputHash: responseHash})
  const result = createChatSourceSuggestionsArtifactV1(payload.response.raw, payload.context, payload.response.call)
  payload.result = result
  const candidateHash = await hashCanonicalValue(result)
  if (!snapshot.events.some(event => event.type === 'candidate.persisted')) {
    snapshot = await checkpoint(scope, snapshot, payload)
    snapshot = await append(scope, snapshot, 'candidate.persisted', {stepId: STEP, attempt: 1, candidateHash, requiresConfirmation: false})
    await onBoundary?.('candidate.persisted', snapshot.run.id)
  }
  if (terminal.has(snapshot.projection.state)) return
  if (!result.suggestions) {
    snapshot = await append(scope, snapshot, 'step.failed', {stepId: STEP, attempt: 1, code: 'source-suggestion-invalid', retryable: false, category: 'protocol', action: 'fail'})
    await append(scope, snapshot, 'run.failed', {code: 'source-suggestion-invalid', retryable: false})
    return
  }
  if (snapshot.projection.steps[STEP]?.status !== 'succeeded')
    snapshot = await append(scope, snapshot, 'step.succeeded', {stepId: STEP, attempt: 1, outputHash: candidateHash})
  if (snapshot.projection.state !== 'verifying')
    snapshot = await append(scope, snapshot, 'verification.started', {verifierSetVersion: VERIFIER})
  const receipt = await createVerificationReceiptV1({version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: [payload.manifestHash], candidateHashes: [candidateHash], adoptionEventIds: [],
    postStateHash: candidateHash, verifierSetVersion: VERIFIER, criteria: [{id: 'source-review.grounded-quotes', status: 'passed', evidenceRefs: [`candidate:${candidateHash}`]}], acceptedAt: Date.now()})
  await append(scope, snapshot, 'verification.accepted', {receiptHash: receipt.receiptHash})
}

export async function readChatSourceReviewRunV1(scope: WorkspaceScope, runId: number): Promise<ChatSourceReviewRunViewV1> {
  if (!await readLatestVerifiedAgentRunCheckpointV1(scope, runId)) {
    const snapshot = await readAgentRunV1(scope, runId)
    if (snapshot.contract.executionBindings?.[0]?.skillId !== SKILL) throw new Error('当前任务不属于资料整理')
    return {runId, status: snapshot.projection.state === 'cancelled' ? 'cancelled' : 'pending', context: null, result: null}
  }
  const {snapshot, payload} = await load(scope, runId)
  const result = payload.result ?? (payload.response ? createChatSourceSuggestionsArtifactV1(payload.response.raw, payload.context, payload.response.call) : null)
  let status: ChatSourceReviewRunViewV1['status'] = snapshot.projection.state === 'cancelled' ? 'cancelled'
    : snapshot.projection.state === 'failed' ? 'blocked'
    : !payload.response ? snapshot.events.some(event => event.type === 'model.requested') ? 'unknown' : 'pending'
    : snapshot.projection.state === 'completed' ? 'ready' : 'pending'
  if (status === 'ready' || status === 'blocked') {
    try {
      if (await hashCanonicalValue(await readChatSourceReviewContextV1(scope, payload.request)) !== await hashCanonicalValue(payload.context)) status = 'stale'
    } catch {status = 'stale'}
  }
  return {runId, status, context: payload.context, result}
}
export async function readLatestChatSourceReviewRunV1(scope: WorkspaceScope) {
  const row = (await reviewRuns(scope))[0]
  return row ? readChatSourceReviewRunV1(scope, row.id!) : null
}
export async function recoverChatSourceReviewRunV1(scope: WorkspaceScope, runId: number) {
  return withLock(scope, true, async () => {
    const {snapshot, payload} = await load(scope, runId)
    if (!terminal.has(snapshot.projection.state)) await finish(scope, snapshot, payload)
    return readChatSourceReviewRunV1(scope, runId)
  })
}
/** Explicit author dismissal only; a later generation is a separate request. */
export async function cancelChatSourceReviewRunV1(scope: WorkspaceScope, runId: number) {
  return withLock(scope, true, async () => {
    const snapshot = await readAgentRunV1(scope, runId)
    if (snapshot.contract.executionBindings?.[0]?.skillId !== SKILL) throw new Error('当前任务不属于资料整理')
    if (!terminal.has(snapshot.projection.state)) await append(scope, snapshot, 'run.cancelled', {reason: '作者结束此次资料整理；不自动重发'})
  })
}

export async function generateChatSourceReviewSuggestionsV1(input: {
  scope: WorkspaceScope; request: ChatSourceReviewRequestV1; config?: AIConfig; signal?: AbortSignal
  runAI?: (messages: ChatMessage[]) => Promise<string>
  onBoundary?: (boundary: ChatSourceReviewBoundaryV1, runId: number) => void | Promise<void>
}) {
  const scope = structuredClone(input.scope), request = structuredClone(input.request)
  return withLock(scope, !!input.runAI, async () => {
    if (!request.fragmentKeys.length || request.fragmentKeys.length > 12) throw new Error('请一次选择1至12项资料')
    for (const row of (await reviewRuns(scope)).filter(row => !terminal.has(row.status))) {
      const previous = await readAgentRunV1(scope, row.id!)
      // Import invalidates old receipts. Historical finished reports are not
      // in-flight requests and must not trap a Work behind invisible old runs.
      if (!previous.events.some(event => event.type === 'verification.accepted'))
        throw new Error('有尚未结束的资料整理，请先恢复已保存结果或结束该任务')
    }
    const skill = getAgentSkillV1(SKILL), binding = createAgentSkillExecutionBindingV1(skill), formalEntry = await freezeFormalAIEntryBindingV1(ENTRY)
    const resolved = input.config ? resolveRequestConfig({...structuredClone(input.config), maxTokens: 6000}, {category: CATEGORY, projectId: scope.projectId, contextOverflowPolicy: 'reject'}) : null
    if (!input.runAI && !resolved) throw new Error('请先配置全局 AI')
    const assembled = await assembleContext({projectId: scope.projectId, scope, sourceKeys: [SOURCE], chatSourceReviewRequest: request,
      provider: resolved?.config.provider, model: resolved?.config.model, inputBudgetMaxTokens: 20_000})
    if (assembled.included.join(',') !== SOURCE || assembled.trimmed.length || assembled.overBudgetAfterTrim
      || assembled.sourceEvidence?.some(row => row.delivery !== 'full')) throw new Error('本次原文不能完整交付，请减少选中资料')
    const context = JSON.parse(assembled.segments[0].content) as ChatSourceReviewContextV1
    const model = {provider: resolved?.config.provider ?? 'test', model: resolved?.config.model ?? 'test'}
    const messages: ChatMessage[] = [{role: 'system', content: CHAT_SOURCE_REVIEW_PROMPT_V1}, {role: 'user', content: assembled.text}]
    const inputTokens = messages.reduce((sum, row) => sum + estimateTokens(row.content), 0)
    if (inputTokens > 24_000) throw new Error('本次资料超过整理容量，请减少选中资料')
    const payload: ReviewPayload = {kind: KIND, version: 1, request, context, model, messages, manifestHash: '', response: null, result: null}
    let snapshot = await createAgentRunV1({scope, worldGroupId: null, contract: {
      version: 1, objective: '解释作者选中的角色聊天原文，提供带逐字引用的用途与风险建议；不修改资料或知情范围', workflowKind: 'direct-generation',
      scope: {projectId: scope.projectId, worldGroupId: null}, permissions: {contextSourceKeys: [SOURCE], writeTargets: []},
      runtimeBindingHash: await bindingHash(payload), executionBindings: [{stepId: STEP, ...binding, formalEntry}],
      budget: {maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 24_000, maxOutputTokens: 6000, maxAttemptsPerStep: 1},
      acceptance: [{id: 'source-review.grounded-quotes', kind: 'deterministic-check', required: true}],
      verificationPlan: [{id: 'source-review.terminal', kind: 'terminal', verifier: VERIFIER, criterionIds: ['source-review.grounded-quotes']}],
      failurePolicy: {onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author'},
    }})
    snapshot = await append(scope, snapshot, 'step.scheduled', {stepId: STEP})
    snapshot = await append(scope, snapshot, 'step.started', {stepId: STEP, attempt: 1})
    const manifest = await createContextManifestFromAssemblyV1({runId: snapshot.run.id, stepId: STEP, attempt: 1, projectId: scope.projectId, worldGroupId: null,
      declaredSourceKeys: [SOURCE], assembled, readerVersion: VERIFIER})
    payload.manifestHash = manifest.manifestHash
    snapshot = await append(scope, snapshot, 'context.assembled', {stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash})
    snapshot = await checkpoint(scope, snapshot, payload)
    await input.onBoundary?.('prepared', snapshot.run.id)
    if (input.signal?.aborted) throw new Error('已取消资料整理，未发送模型请求')
    if (await hashCanonicalValue(await readChatSourceReviewContextV1(scope, request)) !== await hashCanonicalValue(context)) throw new Error('资料已变化，未发送模型请求')
    snapshot = await append(scope, snapshot, 'model.requested', {stepId: STEP, attempt: 1, bindingHash: await hashCanonicalValue(messages)})
    await input.onBoundary?.('model.requested', snapshot.run.id)
    const result: ChatResult = {}, start = Date.now()
    let raw: string
    try {
      raw = input.runAI ? await input.runAI(messages) : await executeFrozenFormalAIEntryV1('chat.source-review', formalEntry, skill,
        'src/lib/character-interaction/source-review-harness.ts', messages, resolved!.config,
        {category: 'authoring.chat-source-review', projectId: scope.projectId, contextOverflowPolicy: 'reject'}, input.signal, result, undefined, resolved!)
    } catch (cause) {
      const status = result.requestLifecycle?.responseStatus
      if (result.requestLifecycle?.phase === 'response-observed' && status != null && status >= 400 && status < 500) {
        snapshot = await append(scope, snapshot, 'step.failed', {stepId: STEP, attempt: 1, code: `provider-rejected-${status}`, retryable: false, category: 'deterministic', action: 'fail'})
        await append(scope, snapshot, 'run.failed', {code: `provider-rejected-${status}`, retryable: false})
      }
      throw cause
    }
    const measuredInput = result.usage?.inputTokens ?? inputTokens, outputTokens = result.usage?.outputTokens ?? estimateTokens(raw)
    payload.response = {raw, call: {version: 1, callIndex: 1, purpose: 'generate', status: 'succeeded', ...model,
      usageSource: result.usage ? 'provider' : 'estimated', inputTokens: measuredInput, outputTokens, totalTokens: result.usage?.totalTokens ?? measuredInput + outputTokens,
      latencyMs: Date.now() - start, estimatedCostUsd: computeKnownCostUsd(model.model, measuredInput, outputTokens), outputHash: await hashCanonicalValue(raw)}}
    snapshot = await checkpoint(scope, snapshot, payload)
    await input.onBoundary?.('response.saved', snapshot.run.id)
    snapshot = await append(scope, snapshot, 'model.responded', {stepId: STEP, attempt: 1, outputHash: payload.response.call.outputHash!})
    await input.onBoundary?.('model.responded', snapshot.run.id)
    await finish(scope, snapshot, payload, input.onBoundary)
    return readChatSourceReviewRunV1(scope, snapshot.run.id)
  })
}
