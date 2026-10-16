/** Public-input drafting still produces unrevealed GM-owned candidate material. */
import type { TtrpgOpenSituationCandidateV1 } from './open-generated-situation-candidate'
import { assertTtrpgOpenSituationHumanGmV1, assertTtrpgOpenSituationRequesterV1 } from './open-generated-situation-candidate'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { readTtrpgOpenRuntimeCandidateV1, readTtrpgOpenRuntimeCandidateForKernelV1 } from './open-runtime-candidate'
import type { TtrpgOpenPublicSituationReferenceV1 } from './open-public-situation-delivery'
import { verifyTtrpgOpenPublicSituationKernelV1, type TtrpgOpenPublicSituationKernelV1 } from './open-public-situation-kernel'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import type { TtrpgOpenEpochV1 } from './open-coordination'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'

export interface TtrpgOpenPublicSituationCandidateV1 extends Omit<TtrpgOpenSituationCandidateV1, 'schema' | 'references'> {
  schema: 'storyforge.ttrpg-open-public-situation-candidate';
  references: TtrpgOpenPublicSituationReferenceV1[];
}
export async function readTtrpgOpenPublicSituationCandidateV1(input: TtrpgOpenCandidateReadV1) {
  await assertTtrpgOpenSituationHumanGmV1(input)
  const value = await readTtrpgOpenRuntimeCandidateV1(input, 'public-situation-proposal')
  return value?.schema === 'storyforge.ttrpg-open-public-situation-candidate' ? value : null
}
export function projectTtrpgOpenPublicSituationCandidateSummaryV1(candidate: TtrpgOpenPublicSituationCandidateV1, stopped = false, adopted = false) {
  return { schema: 'storyforge.ttrpg-open-public-situation-candidate-summary' as const, version: 1 as const,
    runId: candidate.runId, requestKey: candidate.requestKey, candidateHash: candidate.candidateHash,
    status: candidate.artifact.status, stopped, adopted, requiresExplicitAcceptance: !stopped && !adopted, grantsGmRead: false as const }
}
export async function readTtrpgOpenPublicSituationCandidateSummaryV1(input: TtrpgOpenCandidateReadV1) {
  try {
    const loaded = await assertTtrpgOpenSituationRequesterV1(input)
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(input, 'public-situation-proposal')
    if (candidate?.schema !== 'storyforge.ttrpg-open-public-situation-candidate') return null
    const original = await readInstanceAgentRunV1(input.scope, input.runId)
    const epoch = loaded.runtime.openRun!.coordination.epochs.find(row => row.epochKey === candidate.epochKey)
    const adopted = loaded.runtime.openRun!.situationReceipts?.some(row => row.model.requestKey === input.requestKey && row.model.candidateHash === candidate.candidateHash) ?? false
    await loaded.assertCurrent()
    return projectTtrpgOpenPublicSituationCandidateSummaryV1(candidate, epoch?.status === 'closed' || ['failed', 'cancelled'].includes(original.projection.state), adopted)
  } catch { throw new Error('当前无法读取本人的共同局势候选状态；原始候选资料保持受限。') }
}
/** Internal exact bytes only. Caller has verified the original call and input evidence. */
export async function readTtrpgOpenPublicSituationKernelSnapshotV1(input: TtrpgOpenCandidateReadV1,
  call: TtrpgOpenModelCallV1, epoch: TtrpgOpenEpochV1, evidence: TtrpgOpenInputEvidenceV1) {
  const hash = evidence.publicKernelHash
  const run = await readInstanceAgentRunV1(input.scope, input.runId)
  if (!hash || !epoch.publicSituation || !run.events.some(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt
    && event.payload.artifactKind === 'source-snapshot' && event.payload.contentHash === hash)) throw new Error('共同局势原请求缺少绑定内核工件')
  const snapshot = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
    artifactKind: 'source-snapshot', contentHash: hash })) as TtrpgOpenPublicSituationKernelV1
  return verifyTtrpgOpenPublicSituationKernelV1({ snapshot, expectedHash: hash, grant: epoch.publicSituation,
    sessionKey: call.createdRef.sessionKey, epochKey: epoch.epochKey, authorizationHash: epoch.authorizationHash })
}
