/** Current human-GM adapter. Reading never sends, starts a window, confirms facts or repairs a receipt. */
import { loadTtrpgOpenFactDeskOwnerV1, type TtrpgOpenFactDeskInputV1 } from './open-fact-desk'
import { createTtrpgOpenOracleRuntimeReferencePolicyV1, ttrpgOpenOracleRuntimeReferenceKeysV1 } from './open-runtime-entity-references'
import { verifyTtrpgOpenEntityStateV1 } from './open-entity-proof'
import { assertTtrpgOpenOracleRuntimeEpochAuthorityV1, frozenTtrpgOpenEpochBudgetV1, TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1,
  type TtrpgOpenSourceRefV1 } from './open-coordination'
import { assertTtrpgOpenOracleInterpretationSlotV1, ttrpgOpenCallBudgetV1 } from './open-model-calls'
import { readTtrpgOpenModelCallRunsV1, readTtrpgOpenOriginalLocalCallRunV1 } from './open-model-call-evidence'
import { readTtrpgOpenOracleCandidateV1 } from './open-oracle-candidate'
import { loadTtrpgOpenGmOracleContextV1 } from './open-gm-oracle-context'
import { generateTtrpgOpenOracleCandidateV2, executeTtrpgOpenOracleRequestV1 } from './open-intent-harness'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, reviewTtrpgOpenOracleCandidateV1 } from './runtime-commands'
import { reconcileTtrpgOpenOracleFactRunV1 } from './open-oracle-adoption'
import { finishTtrpgOpenOracleInstanceDraftV1, reconcileTtrpgOpenStoppedOracleInstanceV1 } from './open-runtime-draft-stop'
import { repairTtrpgOpenOracleInstanceResponseReceiptV1, abandonTtrpgOpenOracleInstanceWaitV1 } from './open-situation-request-recovery'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { TTRPG_FACT_PREDICATE_LABELS_V1, ttrpgOpenFactScalarLabelV1 } from './open-fact-desk-contract'
import type { TtrpgOpenOracleReviewChoiceV1 } from './open-oracle-review'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

type Input = TtrpgOpenFactDeskInputV1
type Transport = Pick<Parameters<typeof generateTtrpgOpenOracleCandidateV2>[0], 'aiConfig' | 'runAI' | 'signal'>
const liveRun = (state: string) => !['completed', 'failed', 'cancelled'].includes(state)
async function envelope(sessionId: number, commandId: string) {
  const version = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash }
}
export async function readTtrpgOpenOracleModelDeskV1(input: Input & { requestKey?: string }) {
  const loaded = await loadTtrpgOpenFactDeskOwnerV1(input)
  if (!loaded) return null
  const { runtime, content } = loaded, run = runtime.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  await verifyTtrpgOpenEntityStateV1(loaded.state, content)
  const name = (key: string) => key === 'gm' ? '主持' : loaded.state.entities[key]?.name ?? '原已授权对象'
  const modelConsent = Boolean(loaded.seat?.consent.aiAdviceAllowed && loaded.seat?.consent.aiIdentityDisclosed)
  const running = runtime.product.safety.status === 'active' && run.stage.status === 'open'
  const own = run.coordination.calls.filter(call => call.oracleInterpretation?.runtimeReferencePolicy
    && run.coordination.epochs.some(row => row.epochKey === call.authorizationEpochKey && row.viewerKey === input.viewerKey))
  const call = input.requestKey ? own.find(row => row.requestKey === input.requestKey) : own[own.length - 1]
  const rows = call ? await readTtrpgOpenModelCallRunsV1({ ...input, calls: [call] }) : []
  const snapshot = call ? await readTtrpgOpenOriginalLocalCallRunV1({ ...input, call, runs: rows }) : null
  const read = call && snapshot ? { ...input, requestKey: call.requestKey, runId: snapshot.run.id! } : null
  const originalEpoch = call && run.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
  const currentWindow = Boolean(call && epoch?.epochKey === call.authorizationEpochKey && epoch?.viewerKey === input.viewerKey)
  const review = call && run.oracleReviews?.find(row => row.requestKey === call.requestKey)
  const fact = call && run.factLedger?.entries.find(row => row.modelCandidate?.requestKey === call.requestKey)
  const committed = Boolean(review || fact), committedHash = review?.candidateHash ?? fact?.modelCandidate?.candidateHash ?? null
  const observed = Boolean(call && snapshot?.events.some(event => (event.type === 'model.responded'
    || event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt))
  const active = Boolean(snapshot && liveRun(snapshot.projection.state))
  let candidate = null, candidateUnavailable = false
  if (read && call?.status === 'succeeded') {
    try { candidate = await readTtrpgOpenOracleCandidateV1(read) } catch { candidateUnavailable = true }
  }
  let fresh = false
  if (candidate && currentWindow && !committed && modelConsent) {
    const context = await loadTtrpgOpenGmOracleContextV1({ ...input, actorKey: 'gm' })
    fresh = context.visibilityHash === call!.visibilityHash && context.admissionStateHash === call!.admissionStateHash
  }
  let modelIdentity: { provider: string; model: string } | null = null
  if (read && call) {
    const rendered = p.object(p.json(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestHash })), 'original Oracle request')
    const model = p.record(rendered.modelIdentity, ['provider', 'model'], 'original Oracle model')
    modelIdentity = { provider: p.text(model.provider, 'original provider', 64), model: p.text(model.model, 'original model', 200) }
  }
  let unavailable = ''
  try {
    if (!content.campaign.runtimePolicy.enabled) throw new Error('冻结作品尚未启用模型咨询。')
    assertTtrpgOpenOracleRuntimeEpochAuthorityV1(runtime, input.viewerKey)
    assertTtrpgOpenOracleInterpretationSlotV1(runtime, run.worldTime.worldTurn)
    if (epoch) throw new Error('请先处理并结束原咨询、行动或拟定窗口。')
  } catch (error) { unavailable = error instanceof Error ? error.message : '当前不能发起模型事实咨询。' }
  const catalog = []
  if (!unavailable) for (const oracle of run.oracleReceipts ?? []) {
    const source = { content, operations: run.entityOperations ?? [], runtimeSourceHash: loaded.source.runtimeSourceHash,
      oracle, recipientActorKeys: runtime.authorization!.selectedActorKeys, consumerRef: { sessionKey: runtime.sessionKey, sequence: loaded.state.lastSequence + 1 } }
    if (!ttrpgOpenOracleRuntimeReferenceKeysV1(source).length) continue
    const policy = await createTtrpgOpenOracleRuntimeReferencePolicyV1(source)
    catalog.push({ oracleSourceRef: oracle.sourceRef, question: oracle.resolution.outcome.question, audience: oracle.audience, snapshotHash: policy.references.snapshotHash,
      recipients: policy.recipientActorKeys.map(name), entities: policy.references.references.map(row => ({ name: name(row.entityRef), kind: row.kind, audience: row.audience,
        recipients: row.recipientActorKeys.map(name) })) })
  }
  if (!catalog.length && !unavailable) unavailable = '原咨询没有符合本次范围的已创建对象；可先使用人工事实面板。'
  const budget = epoch ? ttrpgOpenCallBudgetV1(epoch, run.coordination.calls) : null
  const originalCalls = epoch && run.coordination.calls.filter(row => row.authorizationEpochKey === epoch.epochKey)
  const reviewedTerminal = Boolean(committed && snapshot && (review?.interpretationDecision === 'reject' ? snapshot.projection.state === 'failed' : snapshot.projection.state === 'completed'))
  const closeWindow = epoch?.oracleRuntimeReferencePolicy && epoch.viewerKey === input.viewerKey && !epoch.reservedCalls
    && (!originalCalls?.length || currentWindow && reviewedTerminal)
  const sourceLabel = (key: string) => {
    const entry = run.factLedger?.entries.find(row => row.fact.factKey === key), frozen = content.campaign.frozenWorldPredicateIndex.entries.find(row => row.factKey === key)
    return entry?.fact.detail ?? (frozen ? name(frozen.subjectRef) + ' · ' + TTRPG_FACT_PREDICATE_LABELS_V1[frozen.predicateKey] + '：' + ttrpgOpenFactScalarLabelV1(frozen.canonicalValue) : '原实际来源')
  }
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, catalog, canRequest: !unavailable && catalog.length > 0, unavailable,
    maximumCostUsd: frozenTtrpgOpenEpochBudgetV1(content.campaign).maximumCostUsd,
    closeWindowEpochKey: closeWindow ? epoch.epochKey : null,
    requests: own.map(row => ({ requestKey: row.requestKey, status: row.status, audience: row.oracleInterpretation!.runtimeReferencePolicy!.audience })),
    request: call ? { requestKey: call.requestKey, status: call.status, local: Boolean(read), modelIdentity, currentWindow, observed, committed, committedHash,
      oracle: run.oracleReceipts?.find(row => stable(row.sourceRef) === stable(call.oracleInterpretation!.oracleSourceRef))?.resolution.outcome.question ?? '原已保存咨询',
      canResume: Boolean(read && active && currentWindow && modelConsent && running && call.status === 'prepared'),
      canReview: Boolean(read && active && currentWindow && modelConsent && running && fresh && !committed && candidate?.facts !== null && candidate?.interpretation
        && ['ready', 'usable-with-warnings'].includes(candidate.artifact.status) && !budget?.pending && !budget?.blockedByUnknown),
      canRepairResponse: Boolean(read && active && !committed && (call.status === 'succeeded' && (!candidate || candidateUnavailable) || currentWindow && call.status === 'dispatched' && observed)),
      canRepairReview: Boolean(read && committed && !reviewedTerminal),
      canRepairStop: Boolean(read && active && originalEpoch?.status === 'closed' && !committed),
      canFinish: Boolean(read && currentWindow && !committed),
      candidate: candidate ? { candidateHash: candidate.candidateHash, status: candidate.artifact.status, interpretation: candidate.interpretation,
        facts: candidate.facts?.map((row, index) => ({ index, subject: name(row.subjectRef), predicate: TTRPG_FACT_PREDICATE_LABELS_V1[row.predicateKey],
          object: row.objectRef ? name(row.objectRef) : null, value: ttrpgOpenFactScalarLabelV1(row.canonicalValue), detail: row.detail,
          audience: row.audience, recipients: row.knownByActorKeys.map(name), sources: row.sourceFactRefs.map(sourceLabel),
          supersedes: row.supersedes ? sourceLabel(row.supersedes) : null, supersedeReason: row.supersedeReason })) ?? null } : null,
      review: review ? { interpretationDecision: review.interpretationDecision, interpretationReason: review.interpretationReason, choices: review.choices,
        adoptedCount: review.adoptedFactKeys.length } : null } : null }
}
async function original(input: Input & { requestKey: string }) {
  const page = await readTtrpgOpenOracleModelDeskV1(input), request = page?.request
  if (!request?.local || request.requestKey !== input.requestKey) throw new Error('原本地实例事实请求不存在；历史记录不恢复发送或确认权限。')
  const loaded = await loadTtrpgOpenFactDeskOwnerV1(input)
  if (!loaded) throw new Error('仅当前本人真人 GM 可以处理原实例事实请求。')
  const call = loaded.runtime.openRun!.coordination.calls.find(row => row.requestKey === input.requestKey)!
  const owner = await readTtrpgOpenOriginalLocalCallRunV1({ ...input, call })
  if (!owner) throw new Error('原 Run 不存在，不创建替代请求。')
  await loaded.assertCurrent()
  return { page: page!, request, call, read: { ...input, runId: owner.run.id! } }
}
export async function requestTtrpgOpenOracleModelDeskV1(input: Input & Transport & {
  submissionKey: string; expectedSequence: number; oracleSourceRef: TtrpgOpenSourceRefV1; snapshotHash: string; maximumCostUsd: number;
  decision: 'request-this-oracle-instance-candidate'; onPrepared?: (requestKey: string) => void | Promise<void>;
}) {
  if (input.decision !== 'request-this-oracle-instance-candidate' || !/^[A-Za-z0-9._-]{1,96}$/.test(input.submissionKey)) throw new Error('请明确选择原咨询、对象范围和一次请求的预留上限。')
  if (!input.aiConfig && !input.runAI) throw new Error('请先配置本次模型。')
  const page = await readTtrpgOpenOracleModelDeskV1(input)
  const selection = page?.catalog.find(row => stable(row.oracleSourceRef) === stable(input.oracleSourceRef) && row.snapshotHash === input.snapshotHash)
  const cost = p.number(input.maximumCostUsd, '本次实例事实预留上限', 0, 1000)
  if (!page?.canRequest || page.sequence !== input.expectedSequence || !selection || cost > page.maximumCostUsd) throw new Error('原咨询、对象范围或进度已变化，请重新读取并确认。')
  const loaded = await loadTtrpgOpenFactDeskOwnerV1(input)
  if (!loaded || loaded.state.lastSequence !== page.sequence) throw new TtrpgOpenReadConflictV1('准备实例事实咨询期间进度已变化。')
  const oracle = loaded.runtime.openRun!.oracleReceipts!.find(row => stable(row.sourceRef) === stable(input.oracleSourceRef))!
  const policy = await createTtrpgOpenOracleRuntimeReferencePolicyV1({ content: loaded.content, operations: loaded.runtime.openRun!.entityOperations ?? [],
    runtimeSourceHash: loaded.source.runtimeSourceHash, oracle, recipientActorKeys: loaded.authorization.selectedActorKeys,
    consumerRef: { sessionKey: loaded.runtime.sessionKey, sequence: loaded.state.lastSequence + 1 } })
  await loaded.assertCurrent()
  await startTtrpgOpenEpochV1({ sessionId: input.sessionId, commandId: 'oracle.model.desk.start.' + input.submissionKey, baseSequence: loaded.state.lastSequence,
    baseStateHash: loaded.stateHash, viewerKey: input.viewerKey, triggerKind: 'continue-host', rawInput: TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1, oracleRuntimeReferencePolicy: policy })
  const result = await generateTtrpgOpenOracleCandidateV2({ ...input, ...await envelope(input.sessionId, 'oracle.model.desk.prepare.' + input.submissionKey),
    oracleSourceRef: oracle.sourceRef, referencePolicy: 'recorded-oracle-instances-v1', maximumCostUsd: cost,
    maximumOutputTokens: Math.min(getAgentSkillV1('prose.ttrpg-open-oracle-interpret').maxOutputTokens, loaded.content.campaign.runtimePolicy.maximumOutputTokens),
    onPrepared: prepared => input.onPrepared?.(prepared.requestKey) })
  return { requestKey: result.prepared.requestKey }
}
export async function resumeTtrpgOpenOracleModelDeskV1(input: Input & Transport & { requestKey: string }) {
  const f = await original(input)
  if (!f.request.canResume) throw new Error('原请求当前不能继续发送，请读取原状态与模型。')
  return executeTtrpgOpenOracleRequestV1({ ...input, ...f.read })
}
export async function reviewTtrpgOpenOracleModelDeskV1(input: Input & { requestKey: string; candidateHash: string;
  interpretationDecision: 'accept' | 'reject'; interpretationReason: string | null; choices: TtrpgOpenOracleReviewChoiceV1[];
  decision: 'reviewed-this-original-oracle-candidate'; }) {
  if (input.decision !== 'reviewed-this-original-oracle-candidate') throw new Error('请明确审阅原解释和每一项事实提案。')
  const f = await original(input)
  if (!f.request.canReview && !f.request.committed || (f.request.candidate?.candidateHash ?? f.request.committedHash) !== input.candidateHash) throw new Error('原候选已变化、不能确认或已不在本次窗口。')
  return reviewTtrpgOpenOracleCandidateV1({ ...input, ...f.read, ...await envelope(input.sessionId, 'oracle.model.desk.review') })
}
export async function repairTtrpgOpenOracleModelDeskV1(input: Input & { requestKey: string }) {
  const f = await original(input)
  if (f.request.canRepairReview) return reconcileTtrpgOpenOracleFactRunV1({ ...f.read, candidateHash: f.request.committedHash! })
  if (f.request.canRepairStop) return reconcileTtrpgOpenStoppedOracleInstanceV1(f.read)
  if (f.request.canRepairResponse) return repairTtrpgOpenOracleInstanceResponseReceiptV1(f.read)
  throw new Error('本原请求没有需要补齐的回执。')
}
export async function finishTtrpgOpenOracleModelDeskV1(input: Input & { requestKey: string; decision: 'discard-this-oracle-instance-request-and-close-window' }) {
  if (input.decision !== 'discard-this-oracle-instance-request-and-close-window') throw new Error('请明确放弃本次候选并结束原窗口，保留回答和费用。')
  let f = await original(input)
  if (f.request.committed) throw new Error('原候选已确认或拒绝，请核对原审阅回执后结束，不能改记为放弃。')
  if (f.request.canRepairStop) return reconcileTtrpgOpenStoppedOracleInstanceV1(f.read)
  if (!f.request.canFinish) throw new Error('原窗口已结束；请保留已有记录。')
  if (f.call.status === 'dispatched' && f.request.observed) { await repairTtrpgOpenOracleInstanceResponseReceiptV1(f.read); f = await original(input) }
  if (f.call.status === 'dispatched') return abandonTtrpgOpenOracleInstanceWaitV1({ ...f.read, decision: 'abandon-wait-as-unknown' })
  return finishTtrpgOpenOracleInstanceDraftV1({ ...f.read, decision: input.decision })
}
export async function closeTtrpgOpenOracleModelWindowDeskV1(input: Input & { epochKey: string; decision: 'close-this-original-oracle-window' }) {
  const page = await readTtrpgOpenOracleModelDeskV1(input)
  if (input.decision !== 'close-this-original-oracle-window' || page?.closeWindowEpochKey !== input.epochKey) throw new Error('请先处理原请求及终验，再明确结束本人的原窗口。')
  return closeTtrpgOpenEpochV1({ ...await envelope(input.sessionId, 'oracle.model.window.close.' + input.epochKey), viewerKey: input.viewerKey,
    epochKey: input.epochKey, reason: '真人明确结束本次实例事实窗口；原咨询、回答、审阅、费用和确认事实保留。' })
}
