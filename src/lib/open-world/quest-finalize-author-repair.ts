import type { WorkspaceScope } from '../types'
import { readTextOpenWorldAuthorRepairPageV1 } from './author-repair-context'
import { projectTextOpenWorldQuestFinalizeRepairCandidatesV1, type QuestFinalizeRepairSectionV1 } from './quest-finalize-production'

export async function readTextOpenWorldQuestFinalizeRepairCandidatesV1(input: {
  scope: WorkspaceScope
  productionId: number
  expectedBuildId: number
  expectedControlEpoch: number
  section: QuestFinalizeRepairSectionV1
  page: number
  expectedContextSelectionHash?: string
}) {
  return readTextOpenWorldAuthorRepairPageV1({ ...input, taskKey: 'p8f.quest-finalize' },
    contextText => projectTextOpenWorldQuestFinalizeRepairCandidatesV1({ ...input, contextText }))
}

export type TextOpenWorldQuestFinalizeRepairCandidatePageV1 = Awaited<ReturnType<typeof readTextOpenWorldQuestFinalizeRepairCandidatesV1>>
