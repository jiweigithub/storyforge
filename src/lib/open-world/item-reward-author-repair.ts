import type { WorkspaceScope } from '../types'
import { readTextOpenWorldAuthorRepairPageV1 } from './author-repair-context'
import { projectTextOpenWorldItemRewardRepairCandidatesV1, type ItemRewardRepairSectionV1 } from './item-reward-catalog-production'

export async function readTextOpenWorldItemRewardRepairCandidatesV1(input: {
  scope: WorkspaceScope
  productionId: number
  expectedBuildId: number
  expectedControlEpoch: number
  section: ItemRewardRepairSectionV1
  page: number
  expectedContextSelectionHash?: string
}) {
  return readTextOpenWorldAuthorRepairPageV1({ ...input, taskKey: 'p8.catalog.items-rewards' },
    contextText => projectTextOpenWorldItemRewardRepairCandidatesV1({ ...input, contextText }))
}

export type TextOpenWorldItemRewardRepairCandidatePageV1 = Awaited<ReturnType<typeof readTextOpenWorldItemRewardRepairCandidatesV1>>
