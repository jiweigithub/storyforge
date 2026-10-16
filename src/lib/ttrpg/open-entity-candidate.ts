/** Model-origin evidence stays separate from the human-oracle-proposal V1 contract. */
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import type { TtrpgOpenEntityProposalV1 } from './open-entity-contract'
import type { TtrpgOpenEntityModelSelectionV1 } from './open-entity-model-contract'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { readTtrpgOpenRuntimeCandidateV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'

export interface TtrpgOpenEntityCandidateV1 extends Omit<TtrpgOpenIntentCandidateV1, 'schema' | 'intent'> {
  schema: 'storyforge.ttrpg-open-entity-candidate';
  selection: TtrpgOpenEntityModelSelectionV1; proposals: TtrpgOpenEntityProposalV1[] | null;
}
export async function assertTtrpgOpenEntityCandidateReaderV1(input: TtrpgOpenCandidateReadV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const call = loaded.runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === call?.authorizationEpochKey)
  if (!loaded.humanHost || !call?.entityProposal || epoch?.viewerKey !== input.viewerKey
    || call.entityProposal.scope.audience === 'gm-only' && loaded.seat?.role !== 'gm'
    || call.entityProposal.scope.audience === 'private' && loaded.seat?.role !== 'gm'
      && !call.entityProposal.scope.recipientActorKeys.includes(loaded.seat?.actorKey ?? '')) throw new Error('当前无法读取本人的实体候选；原资料保持受限。')
  await loaded.assertCurrent()
}
export async function readTtrpgOpenEntityCandidateV1(input: TtrpgOpenCandidateReadV1) {
  const candidate = await readTtrpgOpenRuntimeCandidateV1(input, 'entity-proposal')
  return candidate?.schema === 'storyforge.ttrpg-open-entity-candidate' ? candidate : null
}
