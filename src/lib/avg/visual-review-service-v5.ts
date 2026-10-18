import type { WorkspaceScope } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { stageAvgAuthorArtifactV1 } from './author-artifacts'
import { avgRawMediaArtifactKeyV1,avgVisualReviewArtifactKeyV1,avgMediaChoiceArtifactKeyV1,type AvgAuthorMediaChoiceV1 } from './media-production-contract'
import { parseAvgAuthorVisualReviewV2,type AvgReviewIssuesV2 } from './visual-review-contract-v2'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'

/** Same pending author candidate and adoption command, with explicit policy
 * review grammar. Saving a rejection or unknown cannot choose an image. */
export async function stageAvgVisualReviewV2(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;
  rawVersion:number;rawContentHash:string;report:AvgReviewIssuesV2;declaration:string}){
  const report=parseAvgAuthorVisualReviewV2(input.report)
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build,brief=details.executionBrief
  if(!build?.id||brief?.avgVisualPlanning?.version!==5||report.targetKey!==input.requirementKey)throw new Error('[avg-review] 新参考评审不属于准确 V5 批次或图片')
  await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:build.id,artifactKey:avgRawMediaArtifactKeyV1(input.requirementKey),
    version:input.rawVersion,contentHash:input.rawContentHash})
  return stageAvgAuthorArtifactV1({scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
    taskKey:`avg.author.visual-review.${input.requirementKey}`,artifactKey:avgVisualReviewArtifactKeyV1(input.requirementKey),
    kind:'quality-report',payload:report,declaration:input.declaration})
}

/** Explicit V5 reader around the original author-choice grammar and writer.
 * The pending candidate rechecks the adopted policy review before selection. */
export async function stageAvgMediaChoiceV5(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;
  rawVersion:number;rawContentHash:string;declaration:string}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build,brief=details.executionBrief
  if(!build?.id||brief?.avgVisualPlanning?.version!==5)throw new Error('[avg-media] 新版选图要求准确已开始 V5 批次')
  const row=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:build.id,artifactKey:avgRawMediaArtifactKeyV1(input.requirementKey),
    version:input.rawVersion,contentHash:input.rawContentHash})
  const raw=await assertAvgConsumedRawImageV5({scope:input.scope,brief,row}),r=raw.requirement
  if(raw.compiled.planning.imageProcessing?.entries.some(e=>e.requirementKey===r.requirementKey))throw new Error('[avg-process] 新版加工选用尚未接通，不能绕过配方')
  const payload:AvgAuthorMediaChoiceV1={schema:'storyforge.avg.media-choice',version:1,requirementKey:r.requirementKey,requirementRevision:r.revision,
    raw:{artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash},asset:raw.asset,referenceOnly:r.consumer.domain==='reference',declaration:input.declaration}
  return stageAvgAuthorArtifactV1({scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
    taskKey:`avg.author.media.${r.requirementKey}`,artifactKey:avgMediaChoiceArtifactKeyV1(r.requirementKey),kind:'presentation',payload,declaration:input.declaration})
}
