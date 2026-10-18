import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { readAvgDraftReferenceBytesV2 } from './editor-service'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'
import { assertAvgVisualObservationScopeV1,assertAvgVisualObservationSelectableV1,validateAvgVisualObservedBytesV1 } from './visual-review'
import { assertAvgReferencePolicyReviewV2,assertAvgReferencePolicySelectableV2,parseAvgAuthorVisualReviewV2 } from './visual-review-contract-v2'
import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'

/** New policy observations remain explicit author input. A transmitted policy
 * or a received/decoded original never becomes a fabricated review pass. */
export async function validateAvgAuthorVisualReviewV2(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;raw:ProductBuildArtifactRecordV1;payload:unknown;processed?:ProductBuildArtifactRecordV1}){
  const raw=await assertAvgConsumedRawImageV5({...input,row:input.raw}),report=parseAvgAuthorVisualReviewV2(input.payload)
  if(!raw.compiled.definition.mediaBatch.visualReviewPolicy)throw new Error('[avg-review] 新版批次未声明作者评审合同')
  if(input.processed||raw.compiled.planning.imageProcessing?.entries.some(e=>e.requirementKey===raw.requirement.requirementKey))throw new Error('[avg-review] 新版加工评审接线尚未完成，不能改用原图绕过')
  assertAvgVisualObservationScopeV1(report,raw.requirement,input.raw.contentHash)
  await assertAvgReferencePolicyReviewV2(report,raw.requirement)
  return validateAvgVisualObservedBytesV1({scope:input.scope,report,requirement:raw.requirement,image:input.raw,asset:raw.asset,
    readReference:reference=>readAvgDraftReferenceBytesV2(input.scope,reference,raw.requirement.family)})
}
export async function assertAvgVisualReviewSelectableV2(value:unknown,requirement:AvgVisualProductionRequirementV2,rawHash:string){
  const report=parseAvgAuthorVisualReviewV2(value)
  assertAvgVisualObservationScopeV1(report,requirement,rawHash)
  await assertAvgReferencePolicyReviewV2(report,requirement)
  assertAvgVisualObservationSelectableV1(report);assertAvgReferencePolicySelectableV2(report)
  return report
}
