/** Explicitly discard this draft and close its original consultation window; never create or resend. */
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { assertTtrpgOpenEntityCandidateReaderV1 } from './open-entity-candidate'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import { readInstanceAgentRunV1, appendAgentRunEventV1, AgentRunStoreError } from '../agent/run/event-store'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'
import { closeTtrpgOpenEpochV1 } from './runtime-commands'

async function owned(input: TtrpgOpenCandidateReadV1) {
  await assertTtrpgOpenEntityCandidateReaderV1(input)
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const call = loaded.runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)!
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (snapshot.run.portableRuntimeOriginJson || snapshot.run.productRuntimeSessionId !== input.sessionId || snapshot.run.contractHash !== call.runContractHash) throw new Error('实体请求收尾需要准确原本地 Run，不能续用导入授权。')
  await verifyTtrpgOpenModelCallEvidenceV1({ ...input, call, mode: 'finish' })
  await loaded.assertCurrent()
  return { loaded, call, epoch }
}
export async function finishTtrpgOpenEntityDraftV1(input: TtrpgOpenCandidateReadV1 & { decision: 'discard-this-entity-request-and-close-window' }) {
  if (input.decision !== 'discard-this-entity-request-and-close-window') throw new Error('需要明确放弃本实体请求并结束原咨询窗口。')
  const f = await owned(input)
  if (f.call.status === 'dispatched') throw new Error('原请求仍在等待回答，须先恢复原回执或明确记录结果未知。')
  if (f.call.status === 'prepared') await cancelTtrpgOpenPreparedRequestV1(input)
  if (f.epoch.status === 'active') {
    const version = await readProductRuntimeStateVersion(input.sessionId)
    await closeTtrpgOpenEpochV1({ ...input, commandId: 'entity-draft.stop.' + f.epoch.epochKey,
      baseSequence: version.sequence, baseStateHash: version.stateHash, epochKey: f.epoch.epochKey,
      reason: '真人明确放弃本实体提案并结束原咨询窗口；保留回答、用量与未知费用，不创建、不重发。' })
  }
  await reconcileTtrpgOpenStoppedEntityV1(input)
}
/** The saved close receipt, not a timer or model result, authorizes local Run cleanup. */
export async function reconcileTtrpgOpenStoppedEntityV1(input: TtrpgOpenCandidateReadV1) {
  const f = await owned(input)
  if (f.epoch.status !== 'closed' || !f.epoch.closedRef) throw new Error('原实体请求窗口尚未保存结束决定。')
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)) return
    if (snapshot.projection.steps[f.call.stepId]?.confirmation === 'adopt') throw new Error('实体候选已进入采用，不得改记为放弃。')
    try {
      await appendAgentRunEventV1({ ...input, productRuntimeSessionId: input.sessionId, type: 'run.cancelled',
        payload: { reason: 'entity-original-window-closed:' + f.epoch.closedRef.sessionKey + ':' + f.epoch.closedRef.sequence },
        expectedLastSequence: snapshot.projection.lastSequence })
      return
    } catch (error) { if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') || attempt === 7) throw error }
  }
}
