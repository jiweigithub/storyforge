import type { WorkspaceScope } from '../types'
import { projectTextOpenWorldSceneScriptsRepairCandidatesV1, type SceneScriptsRepairSectionV1 } from './scene-scripts-production'
import { readTextOpenWorldAuthorRepairPageV1 } from './author-repair-context'
import { projectTextOpenWorldCraftingEconomyRepairCandidatesV1, type CraftingEconomyRepairSectionV1 } from './crafting-economy-catalog-production'
import { projectTextOpenWorldNpcRuntimeRepairCandidatesV1, type NpcRuntimeRepairSectionV1 } from './npc-runtime-catalog-production'

interface CatalogRepairSelectorsV1 {
  scope: WorkspaceScope
  productionId: number
  expectedBuildId: number
  expectedControlEpoch: number
  page: number
  expectedContextSelectionHash?: string
}
export async function readTextOpenWorldCraftingEconomyRepairCandidatesV1(input: CatalogRepairSelectorsV1 & { section: CraftingEconomyRepairSectionV1 }) {
  return readTextOpenWorldAuthorRepairPageV1({ ...input, taskKey: 'p8.catalog.crafting-economy' },
    contextText => projectTextOpenWorldCraftingEconomyRepairCandidatesV1({ ...input, contextText }))
}
export async function readTextOpenWorldNpcRuntimeRepairCandidatesV1(input: CatalogRepairSelectorsV1 & { section: NpcRuntimeRepairSectionV1 }) {
  return readTextOpenWorldAuthorRepairPageV1({ ...input, taskKey: 'p8.catalog.npc-runtime' },
    contextText => projectTextOpenWorldNpcRuntimeRepairCandidatesV1({ ...input, contextText }))
}
export async function readTextOpenWorldSceneScriptsRepairCandidatesV1(input: CatalogRepairSelectorsV1 & { section: SceneScriptsRepairSectionV1 }) {
  return readTextOpenWorldAuthorRepairPageV1({ ...input, taskKey: 'p9.scene-scripts' },
    contextText => projectTextOpenWorldSceneScriptsRepairCandidatesV1({ ...input, contextText }))
}
export type TextOpenWorldCatalogRepairCandidatePageV1 = Awaited<ReturnType<
  typeof readTextOpenWorldCraftingEconomyRepairCandidatesV1 | typeof readTextOpenWorldNpcRuntimeRepairCandidatesV1 | typeof readTextOpenWorldSceneScriptsRepairCandidatesV1>>
