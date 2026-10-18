import type { AvgRawImagePayloadV1 } from './media-raw-contract'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductProductionBriefV3, WorkspaceScope, FrozenRuntimeMediaAssetV2 } from '../types'
import type { AvgAssemblyBriefV2 } from './assembly-contract'
import type { AvgVisualImageBindingV4 } from './visual-planning-brief'
import { readAvgImageDefinitionV3 } from './media-production-definition'
import { assertAvgRawImageArtifactFromDefinitionV1, assertAvgRawImageArtifactV1 } from './media-raw-contract'

/** Author consumption keeps the original Brief. V4 reads the actual accepted
 * compilation and its adopted inputs; it never constructs a legacy Brief or
 * grants permission to resume imported, stopped or frozen production. */
export async function readAvgImageConsumptionDefinitionV4(input: {
  scope: WorkspaceScope; buildId: number; brief: ProductProductionBriefV3
}): Promise<Pick<AvgAssemblyBriefV2, 'mediaBatch' | 'imageProcessing'> & {imageBinding:AvgVisualImageBindingV4}> {
  if (!input.brief.avgVisualPlanning) return readAvgImageDefinitionV3(input.brief)
  const build = await db.productBuilds.get(input.buildId)
  if (!build) throw new Error('[avg-visual-image] 图片消费缺少准确 Build')
  // Loading is the only non-DB boundary here. Keep the caller's author/source
  // transaction alive without moving compiled-proof reads outside its snapshot.
  const load = () => import('./visual-planning-image-definition')
  const { readAvgCompiledImageDefinitionV4 } = await (Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(load)) : load())
  const resolved = await readAvgCompiledImageDefinitionV4({ ...input, expectedBrief: input.brief,
    expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
    purpose:build.packageHash||build.previewHash?'frozen-verification':'assembly' })
  return { ...resolved.definition, imageProcessing: undefined }
}

/** Only payload/asset inspection. The caller must separately prove the exact
 * accepted producer, Work-owned Blob and author command before consumption. */
export async function assertAvgConsumedRawImageV4(input: {
  scope: WorkspaceScope; brief: ProductProductionBriefV3; row: ProductBuildArtifactRecordV1
}):Promise<{payload:AvgRawImagePayloadV1;asset:FrozenRuntimeMediaAssetV2;requirement:AvgVisualProductionRequirementV1}> {
  if (!input.brief.avgVisualPlanning){const raw=await assertAvgRawImageArtifactV1(input.brief,input.row);return {...raw,requirement:raw.payload.requirement}}
  if(input.brief.avgVisualPlanning.rawReuse?.some(r=>input.row.artifactKey===`avg.media.raw.${r.requirementKey}`)){
    const build=await db.productBuilds.get(input.row.buildId)
    if(!build)throw new Error('[avg-visual-raw-reuse] 当前复验 Build 缺失')
    const load=()=>Promise.all([import('./visual-planning-image-definition'),import('./visual-image-revalidation')])
    const [{readAvgCompiledImageDefinitionV4},{inspectAvgRevalidatedRawV4}]=await (Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    const compiled=await readAvgCompiledImageDefinitionV4({...input,buildId:build.id!,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
      expectedBrief:input.brief,purpose:build.packageHash||build.previewHash?'frozen-verification':'assembly'})
    const raw=await inspectAvgRevalidatedRawV4({scope:input.scope,compiled,artifact:input.row})
    return {payload:raw.payload,asset:raw.asset,requirement:raw.requirement}
  }
  const definition = await readAvgImageConsumptionDefinitionV4({ ...input, buildId: input.row.buildId })
  const capability = input.brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.image')!
  const raw=await assertAvgRawImageArtifactFromDefinitionV1({ mediaBatch: definition.mediaBatch, imageBinding: definition.imageBinding,
    capability, qualityProfile: input.brief.qualityProfile }, input.row)
  return {...raw,requirement:raw.payload.requirement}
}
