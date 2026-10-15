/** Restore the durable adoption receipt from a real committed narration; never re-send or re-write prose. */
import { db } from '../db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenKpCandidateProofV1 } from './open-kp-candidate'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { parseTtrpgOpenNarrationReceiptV1, isTtrpgOpenModelNarrationReceiptV1, type TtrpgOpenModelNarrationReceiptV1 } from './open-kp-receipt'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { AgentRunStoreError, readInstanceAgentRunV1, appendAgentRunEventV1, appendRuntimeCandidateAdoptedV1 } from '../agent/run/event-store'
import { createVerificationReceiptV1, parseVerificationReceiptV1, verifyVerificationReceiptIntegrityV1 } from '../agent/run/verification-receipt'
import { AgentRunArtifactStoreError, recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { hashCanonicalValue } from '../agent/run/hash'
export class TtrpgOpenKpReceiptPendingError extends Error {
  readonly code = 'kp-committed-receipt-pending'
  constructor(readonly sessionId: number, readonly eventSequence: number, readonly runId: number, cause: unknown) { super(`叙述已保存，终验回执尚未完成；请恢复回执。${cause instanceof Error ? cause.message : ''}`) }
}
export async function reconcileTtrpgOpenKpRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }): Promise<string> {
  const { candidate } = await verifyTtrpgOpenKpCandidateProofV1(input), session = await db.productRuntimeSessions.get(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg), row = runtime?.openRun?.narrations?.find((r): r is TtrpgOpenModelNarrationReceiptV1 => isTtrpgOpenModelNarrationReceiptV1(r) && r.requestKey === input.requestKey && r.candidateHash === input.candidateHash)
  if (!session || !row || row.sourceRef.sessionKey !== runtime!.sessionKey || stable(row.narration) !== stable(candidate.narration) || stable(row.binding) !== stable(candidate.binding)) throw new Error('[ttrpg-kp] 回执恢复缺少同候选真实已提交叙述')
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, row.sourceRef.sequence]).first()
  if (!event || typeof event.commandId !== 'string' || typeof event.baseSequence !== 'number' || event.type !== 'ttrpg.open.narration.accepted' || stable(parseTtrpgOpenNarrationReceiptV1(JSON.parse(event.payloadJson).receipt)) !== stable(row)) throw new Error('[ttrpg-kp] 叙述回执没有实际原始事件')
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(e => e.sequence <= event.sequence)), postStateHash = await hashProductRuntimeStateV1(state)
  const adoptionHash = await hashCanonicalValue({ receipt: row, commandId: event.commandId, postStateHash }), verifier = 'ttrpg-open-kp-v1'
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const snapshot = await readInstanceAgentRunV1(input.scope, input.runId), call = runtime!.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!, step = snapshot.projection.steps[call.stepId]
      if (!step) throw new Error('[ttrpg-kp] 运行步骤缺失')
      const append = (type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) => appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
      // Generic adopt status contains no human identity or review claim. Actual
      // authority is in the committed runtime receipt and exact verifier artifact.
      if (!step.confirmation) { await append('confirmation.recorded', { stepId: call.stepId, candidateHash: input.candidateHash, decision: 'adopt' }); continue }
      if (step.confirmation !== 'adopt') throw new Error('[ttrpg-kp] 被拒绝候选不能补发采用回执')
      const adopted = snapshot.events.find(e => e.type === 'runtime.candidate.adopted' && e.payload.candidateHash === input.candidateHash)
      if (!adopted) { await appendRuntimeCandidateAdoptedV1({ scope: input.scope, runId: input.runId, expectedLastSequence: snapshot.projection.lastSequence, payload: { stepId: call.stepId, candidateHash: input.candidateHash, adoptionHash, commandIds: [event.commandId], baseSequence: event.baseSequence, resultingSequence: event.sequence } }); continue }
      if (adopted.type !== 'runtime.candidate.adopted' || adopted.payload.adoptionHash !== adoptionHash) throw new Error('[ttrpg-kp] 已采用证据与实际叙述事件不一致')
      if (step.status !== 'succeeded') { await append('step.succeeded', { stepId: call.stepId, attempt: call.attempt, outputHash: adoptionHash }); continue }
      if (snapshot.projection.state === 'running') { await append('verification.started', { verifierSetVersion: verifier }); continue }
      if (!['verifying', 'completed'].includes(snapshot.projection.state)) throw new Error('[ttrpg-kp] 运行不在可恢复终验状态')
      const receipt = await createVerificationReceiptV1({ version: 1, runId: input.runId, generation: snapshot.projection.generation, contractHash: snapshot.run.contractHash,
        contextManifestHashes: snapshot.events.filter(e => e.type === 'context.assembled' && e.payload.stepId === call.stepId).slice(-1).map(e => e.type === 'context.assembled' ? e.payload.manifestHash : candidate.inputManifestHash), candidateHashes: [input.candidateHash], adoptionEventIds: [], postStateHash, verifierSetVersion: verifier,
        criteria: [{ id: 'kp.protocol', status: 'passed', evidenceRefs: [`candidate:${input.candidateHash}`, `raw:${candidate.rawResponseHash}`] }, { id: 'kp.commit', status: 'passed', evidenceRefs: [`narration:${row.sourceRef.sessionKey}:${row.sourceRef.sequence}`, `adoption:${adoptionHash}`] },
          ...(row.hostingDelegationRef ? [{ id: 'kp.delegation',status: 'passed' as const,evidenceRefs: [`hosting:${row.hostingDelegationRef.sessionKey}:${row.hostingDelegationRef.sequence}`] }] : [])], acceptedAt: event.createdAt })
      const decisionAuthority = row.hostingDelegationRef ? { kind: 'runtime-delegation',sourceRef: row.hostingDelegationRef } : undefined
      let retained = false
      for (const e of snapshot.events) if (e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot') {
        const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: e.payload.contentHash })) as { schema?: string; adoptionHash?: string; receipt?: unknown;decisionAuthority?: unknown }
        if (body.schema !== 'storyforge.ttrpg-kp-verification') continue
        const saved = parseVerificationReceiptV1(body.receipt)
        if (body.adoptionHash !== adoptionHash || stable(body.decisionAuthority) !== stable(decisionAuthority) || !await verifyVerificationReceiptIntegrityV1(saved) || saved.receiptHash !== receipt.receiptHash) throw new Error('[ttrpg-kp] 保存的终验工件与实际叙述或采用来源不一致')
        retained = true
      }
      if (!retained) { if (snapshot.projection.state === 'completed') throw new Error('[ttrpg-kp] 完成运行缺少真实终验工件'); await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, artifactKind: 'source-snapshot', content: JSON.stringify({ schema: 'storyforge.ttrpg-kp-verification', version: 1, adoptionHash,...(decisionAuthority ? { decisionAuthority } : {}),receipt }), stepId: call.stepId, attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence }); continue }
      if (snapshot.projection.state === 'completed') { if (snapshot.projection.terminalReceiptHash !== receipt.receiptHash) throw new Error('[ttrpg-kp] 终态 hash 不一致'); return receipt.receiptHash }
      await append('verification.accepted', { receiptHash: receipt.receiptHash })
    } catch (error) { if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') && !(error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict')) throw error }
  }
  throw new Error('[ttrpg-kp] 终验持续竞争，请恢复已保存叙述回执')
}
