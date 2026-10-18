import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { parseAvgAuthorMediaChoice,type AvgAuthorMediaChoice } from './media-production-contract'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'
import { inspectAvgChosenImageBytesV1 } from './media-choice-validation'

/** Choice identity is still the exact original row/asset/use declaration;
 * request and reference meanings remain in their explicit raw2 proof. */
export async function readAvgChosenMediaSourceV5(input:{scope:WorkspaceScope;buildId:number;brief:ProductProductionBriefV3;choice:AvgAuthorMediaChoice}){
  const choice=parseAvgAuthorMediaChoice(input.choice)
  const row=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,...choice.raw})
  return inspectAvgChosenImageV5({...input,choice,row})
}
export async function inspectAvgChosenImageV5(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;choice:AvgAuthorMediaChoice;row:ProductBuildArtifactRecordV1}){
  const choice=parseAvgAuthorMediaChoice(input.choice),raw=await assertAvgConsumedRawImageV5(input)
  if(choice.version!==1||raw.compiled.planning.imageProcessing?.entries.some(e=>e.requirementKey===raw.requirement.requirementKey))throw new Error('[avg-process] 新版加工选用尚未接通，不能跳过冻结配方')
  return inspectAvgChosenImageBytesV1({scope:input.scope,choice,row:input.row,image:input.row,asset:raw.asset,requirement:raw.requirement})
}
