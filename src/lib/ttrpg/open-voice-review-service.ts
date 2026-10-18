/** Finish the original read-only generator after an explicit quality review.
 * No model, media import, text adopt(), E16 or runtime write is performed. */
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { AgentRunStoreError, appendAgentRunEventV1 } from '../agent/run/event-store'
import { AgentRunArtifactStoreError, readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { loadTtrpgOpenVoiceJobReadStateForKernelV1, type TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { freezeTtrpgOpenVoiceSourceEvidenceV1, readTtrpgOpenVoiceSourceEvidenceForKernelV1 } from './open-voice-source-evidence'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId } from './open-voice-execution-input'
import { parseTtrpgOpenVoiceQualityReviewV1, TTRPG_OPEN_VOICE_REVIEW_SCHEMA_V1 as schema,
  TTRPG_OPEN_VOICE_REVIEW_DECISION_V1 as decision, type TtrpgOpenVoiceQualityReviewV1 } from './open-voice-review-contract'
import * as p from './open-contract-parse'

type Basis = Awaited<ReturnType<typeof loadTtrpgOpenVoiceJobReadStateForKernelV1>>
type Input = TtrpgOpenVoiceJobLocatorV1 & { candidateHash: string }
const verifier = 'ttrpg.open.local-voice-v1'
const verificationSchema = 'storyforge.ttrpg-open-voice-generation-verification'
const reviewNote = '原音频候选的本人试听声明；不代表音轨采用或独立真人验收。'
function confirmationPayload(candidateHash: string, reviewArtifactHash: string) {
  return { stepId, candidateHash, decision:'adopt' as const, reviewItemId:'voice-quality:'+reviewArtifactHash,
    reviewDecision:'acknowledged' as const, note:reviewNote }
}

async function artifacts(b: Basis, wanted: string) {
  const found: Array<{ hash: string; body: Record<string,unknown>; event: Extract<typeof b.snapshot.events[number],{type:'evidence.artifact.recorded'}> }> = []
  for (const event of b.snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot' || event.payload.stepId != null) continue
    const content = await readAgentRunArtifactExactV1({ projectId: b.input.scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })
    const body = p.object(p.json(content), 'original voice review evidence')
    if (body.schema !== wanted) continue
    if (stable(body) !== content || new TextEncoder().encode(content).length !== event.payload.byteLength) p.fail('原配音审阅工件不是准确规范正文')
    found.push({ hash: event.payload.contentHash, body, event })
  }
  if (found.length > 1) p.fail('原配音审阅或终验工件重复，保留证据并停止')
  return found[0] ?? null
}

async function source(b: Basis, input: Input, evidenceArtifactHash: string) {
  const saved = await readTtrpgOpenVoiceSourceEvidenceForKernelV1({ projectId: input.scope.projectId, evidenceArtifactHash,
    candidateHash: input.candidateHash, requestKey: input.requestKey, sessionKey: b.original.request.script.sessionKey,
    runtimeSourceHash: b.original.request.script.runtimeSourceHash })
  const content = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: evidenceArtifactHash })
  const body = p.object(p.json(content), 'original voice source')
  for (const [name, snapshot] of [['execution',b.snapshot],['intent',b.original.snapshot]] as const) {
    const log = p.object(body[name], 'original source log'), prefix = p.list(log.events, 'original source prefix', e=>e, 4096, 1)
    if (log.runId !== snapshot.run.id || log.contractHash !== snapshot.run.contractHash || log.contractJson !== snapshot.run.contractJson
      || stable(snapshot.events.slice(0,prefix.length)) !== stable(prefix)) p.fail('审阅来源不再对应准确原父子事件前缀')
  }
  if (!b.snapshot.events.some(e=>e.type==='evidence.artifact.recorded' && e.payload.artifactKind==='source-snapshot'
    && e.payload.stepId == null && e.payload.contentHash===evidenceArtifactHash)) p.fail('原 Run 没有实际保留该来源快照')
  return saved
}

async function checkedReview(b: Basis, input: Input, saved: NonNullable<Awaited<ReturnType<typeof artifacts>>>) {
  const review = parseTtrpgOpenVoiceQualityReviewV1(saved.body), original = await source(b,input,review.sourceEvidenceArtifactHash)
  if (stable(b.snapshot.contract.acceptance)!==stable([{id:'voice.audio-candidate',kind:'deterministic-check',required:true}])
    || stable(b.snapshot.contract.verificationPlan)!==stable([{id:'voice.audio-terminal',kind:'terminal',verifier,criterionIds:['voice.audio-candidate']}])) p.fail('原生成任务不是冻结的只读音频候选验收合同')
  const capsuleEvent=b.snapshot.events.find(e=>e.type==='evidence.artifact.recorded' && e.payload.contentHash===review.sourceEvidenceArtifactHash)
  if (review.candidateHash !== input.candidateHash || review.runId !== b.snapshot.run.id || review.contractHash !== b.snapshot.run.contractHash
    || review.reviewer.viewerKey !== input.viewerKey || review.reviewer.seatKey !== original.request.script.scope.issuerSeatKey
    || review.audioContentHash !== original.audio.contentHash || review.sourceTextHash !== original.request.textHash
    || review.normalizedTextSha256 !== original.request.reading?.normalizedTextSha256 || saved.event.createdAt !== review.reviewedAt
    || review.runtimeReadEvidence.sessionKey !== original.request.script.sessionKey
    || review.runtimeReadEvidence.runtimeSourceHash !== original.request.script.runtimeSourceHash
    || review.runtimeReadEvidence.sequence < original.request.sourceRef.sequence
    || !capsuleEvent || saved.event.sequence <= capsuleEvent.sequence
    || review.runtimeReadEvidence.sequence > b.original.owner.state.lastSequence) p.fail('本人审阅与准确原候选、来源或实际读取不一致')
  const { parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } = await import('../product/runtime-core')
  const state = replayProductRuntimeEvents(parseProductRuntimeState(b.original.owner.session.initialStateJson),
    b.original.owner.events.filter(e=>e.sequence<=review.runtimeReadEvidence.sequence))
  if (state.lastSequence !== review.runtimeReadEvidence.sequence || await hashProductRuntimeStateV1(state) !== review.runtimeReadEvidence.stateHash) p.fail('原配音终验缺少真实的只读运行状态')
  return { review, original, reviewArtifactHash: saved.hash }
}

async function terminal(b: Basis, checked: Awaited<ReturnType<typeof checkedReview>>) {
  const { review, reviewArtifactHash } = checked
  const { createVerificationReceiptV1 } = await import('../agent/run/verification-receipt')
  const contexts=b.snapshot.events.filter(e=>e.type==='context.assembled')
  if (contexts.length!==1 || contexts[0].type!=='context.assembled' || contexts[0].payload.stepId!==stepId || contexts[0].payload.attempt!==1) p.fail('原生成终验缺少唯一实际 Manifest')
  const requested=b.snapshot.events.filter(e=>e.type==='model.requested'),responded=b.snapshot.events.filter(e=>e.type==='model.responded')
  if (requested.length!==1 || requested[0].type!=='model.requested' || requested[0].payload.stepId!==stepId || requested[0].payload.attempt!==1 || requested[0].payload.bindingHash!==b.inputArtifactHash
    || responded.length!==1 || responded[0].type!=='model.responded' || responded[0].payload.stepId!==stepId || responded[0].payload.attempt!==1) p.fail('原生成终验缺少唯一准确步骤的实际派发和返回')
  const receipt = await createVerificationReceiptV1({ version: 1, runId: b.snapshot.run.id, generation: b.snapshot.projection.generation,
    contractHash: b.snapshot.run.contractHash, contextManifestHashes: [contexts[0].payload.manifestHash],
    candidateHashes: [review.candidateHash], adoptionEventIds: [], postStateHash: review.runtimeReadEvidence.stateHash,
    verifierSetVersion: verifier, acceptedAt: review.reviewedAt, lineage: { runId: b.original.snapshot.run.id,
      receiptHash: b.original.receipt.receiptHash, artifactHash: b.original.artifactHash, relation: b.snapshot.run.parentRelation! },
    criteria: [{ id: 'voice.audio-candidate', status: 'passed', evidenceRefs: ['candidate:'+review.candidateHash,
      'raw:'+responded[0].payload.outputHash,
      'source:'+review.sourceEvidenceArtifactHash,'review:'+reviewArtifactHash,'audio:'+review.audioContentHash] }] })
  const body = { schema: verificationSchema, version: 1, requestKey: b.input.requestKey, reviewArtifactHash, receipt }
  return { receipt, content: stable(body), artifactHash: await hash(body) }
}

/** Read existing original review/terminal only; never repairs or grants media rights. */
export async function readTtrpgOpenVoiceCandidateReviewV1(request: Input) {
  const input = structuredClone(request), b = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input)
  const saved = await artifacts(b,schema)
  if (!saved) {
    if (b.snapshot.projection.state==='completed') p.fail('已完成的原生成任务缺少本人审阅工件')
    return null
  }
  const checked = await checkedReview(b,input,saved), expected = await terminal(b,checked), stored = await artifacts(b,verificationSchema)
  if (stored && (stored.hash !== expected.artifactHash || stable(stored.body) !== expected.content)) p.fail('原配音终验正文冲突')
  const complete = b.snapshot.projection.state === 'completed'
  if (complete && (!stored || b.snapshot.projection.terminalReceiptHash !== expected.receipt.receiptHash)) p.fail('原配音完成标记缺少真实终验工件')
  if (complete) {
    const confirmations=b.snapshot.events.filter(e=>e.type==='confirmation.recorded'), starts=b.snapshot.events.filter(e=>e.type==='verification.started'), ends=b.snapshot.events.filter(e=>e.type==='verification.accepted')
    const step=b.snapshot.projection.steps[stepId]
    if (confirmations.length!==1 || stable(confirmations[0].payload)!==stable(confirmationPayload(input.candidateHash,saved.hash))
      || starts.length!==1 || starts[0].type!=='verification.started' || starts[0].payload.verifierSetVersion!==verifier
      || ends.length!==1 || ends[0].type!=='verification.accepted' || ends[0].payload.receiptHash!==expected.receipt.receiptHash
      || !step || step.status!=='succeeded' || step.outputHash!==input.candidateHash
      || !(saved.event.sequence<confirmations[0].sequence && confirmations[0].sequence<starts[0].sequence && starts[0].sequence<stored!.event.sequence && stored!.event.sequence<ends[0].sequence)
      || b.snapshot.events.some(e=>['adoption.started','adoption.committed','runtime.candidate.adopted'].includes(e.type))) p.fail('原配音完成缺少真实的审阅、步骤和只读终验顺序')
  }
  await b.original.owner.assertCurrent()
  return { review: checked.review, reviewArtifactHash: checked.reviewArtifactHash, runId: b.snapshot.run.id, runState: b.snapshot.projection.state,
    complete, receiptHash: complete ? expected.receipt.receiptHash : null, verificationArtifactHash: stored?.hash ?? null,
    generationAllowed: false as const, adoptionAllowed: false as const, independentListening: 'unproven' as const }
}

export async function acceptTtrpgOpenVoiceCandidateReviewV1(request: Input & {
  decision: typeof decision; listening: 'self-reported-original-listening'; judgment: 'acceptable-to-me'
}) {
  const input = structuredClone(request)
  p.literal(input.decision,decision,'explicit original quality review')
  p.literal(input.listening,'self-reported-original-listening','explicit personal original listening')
  p.literal(input.judgment,'acceptable-to-me','personal original quality judgment')
  p.hash(input.candidateHash,'exact original reviewed candidate')
  for (let attempt=0;attempt<12;attempt++) {
    try {
      const b = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input), saved = await artifacts(b,schema)
      if (!saved) {
        if (b.snapshot.projection.state !== 'awaiting_confirmation' || b.original.owner.runtime.product.safety.status !== 'active') p.fail('请先核对实际原候选并恢复有效的本人审阅状态')
        const original = await freezeTtrpgOpenVoiceSourceEvidenceV1({ ...input, decision:'freeze-this-original-voice-source-evidence' })
        const current = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input)
        if (await artifacts(current,schema)) continue
        if (current.snapshot.projection.state !== 'awaiting_confirmation' || current.original.owner.runtime.product.safety.status !== 'active') p.fail('原候选审阅状态已变化')
        const owner=current.original.owner, reviewedAt=Date.now()
        const review: TtrpgOpenVoiceQualityReviewV1 = parseTtrpgOpenVoiceQualityReviewV1({ schema,version:1,decision,candidateHash:input.candidateHash,
          sourceEvidenceArtifactHash:original.evidenceArtifactHash,runId:current.snapshot.run.id,contractHash:current.snapshot.run.contractHash,
          reviewer:{viewerKey:input.viewerKey,seatKey:original.request.script.scope.issuerSeatKey},audioContentHash:original.audio.contentHash,
          sourceTextHash:original.request.textHash,normalizedTextSha256:original.request.reading!.normalizedTextSha256,
          listening:input.listening,judgment:input.judgment,independentListening:'unproven',
          runtimeReadEvidence:{sessionKey:owner.runtime.sessionKey,runtimeSourceHash:owner.session.runtimeSourceHash,sequence:owner.state.lastSequence,stateHash:owner.stateHash},reviewedAt })
        await source(current,input,original.evidenceArtifactHash); await owner.assertCurrent()
        await recordAgentRunArtifactV1({scope:input.scope,productRuntimeSessionId:input.sessionId,runId:current.snapshot.run.id,artifactKind:'source-snapshot',
          content:stable(review),expectedLastSequence:current.snapshot.projection.lastSequence,now:reviewedAt});continue
      }
      const checked=await checkedReview(b,input,saved), step=b.snapshot.projection.steps[stepId]
      if (!step || step.candidateHash!==input.candidateHash || step.attempt!==1) p.fail('原审阅缺少同一实际候选步骤')
      if (b.snapshot.events.some(e=>['adoption.started','adoption.committed','runtime.candidate.adopted'].includes(e.type))) p.fail('只读语音生成不能冒充产品采用')
      const confirmation=confirmationPayload(input.candidateHash,saved.hash)
      const confirmations=b.snapshot.events.filter(e=>e.type==='confirmation.recorded')
      if (confirmations.length>1 || confirmations.some(e=>stable(e.payload)!==stable(confirmation))) p.fail('原语音候选存在不同确认，不能补造审阅终态')
      const append=(type:'confirmation.recorded'|'step.succeeded'|'verification.started'|'verification.accepted',payload:unknown)=>appendAgentRunEventV1({
        scope:input.scope,productRuntimeSessionId:input.sessionId,runId:b.snapshot.run.id,type,payload,expectedLastSequence:b.snapshot.projection.lastSequence
      } as Parameters<typeof appendAgentRunEventV1>[0])
      await b.original.owner.assertCurrent()
      if (!confirmations.length) { await append('confirmation.recorded',confirmation);continue }
      if (step.status==='running') { await append('step.succeeded',{stepId,attempt:1,outputHash:input.candidateHash});continue }
      if (step.status!=='succeeded' || step.outputHash!==input.candidateHash) p.fail('原生成步骤不在可终验状态')
      if (b.snapshot.projection.state==='running') { await append('verification.started',{verifierSetVersion:verifier});continue }
      if (!['verifying','completed'].includes(b.snapshot.projection.state)) p.fail('原生成任务已暂停或终止，请保留原审阅')
      const expected=await terminal(b,checked), stored=await artifacts(b,verificationSchema)
      if (stored && (stored.hash!==expected.artifactHash || stable(stored.body)!==expected.content)) p.fail('原生成终验正文已变化')
      if (!stored) {
        if (b.snapshot.projection.state==='completed') p.fail('已完成原生成任务缺少真实终验正文')
        await recordAgentRunArtifactV1({scope:input.scope,productRuntimeSessionId:input.sessionId,runId:b.snapshot.run.id,artifactKind:'source-snapshot',
          content:expected.content,expectedLastSequence:b.snapshot.projection.lastSequence});continue
      }
      if (b.snapshot.projection.state==='completed') {
        if (b.snapshot.projection.terminalReceiptHash!==expected.receipt.receiptHash) p.fail('原生成终态回执不一致')
        return readTtrpgOpenVoiceCandidateReviewV1(input)
      }
      await append('verification.accepted',{receiptHash:expected.receipt.receiptHash})
    } catch(error) {
      if (!(error instanceof AgentRunStoreError && error.code==='sequence_conflict') && !(error instanceof AgentRunArtifactStoreError && error.code==='sequence-conflict')) throw error
    }
  }
  p.fail('原配音审阅终验持续竞争，请明确恢复同一记录；没有重新生成或采用音轨')
}
