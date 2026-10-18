import type { ProductProductionBriefV3,ProductProductionPlanV3 } from '../types'
import { buildAvgVisualPlanningTopologyV1 } from './visual-planning-plan-kernel'
import { parseAvgVisualPlanningBriefV5,type AvgVisualPlanningBriefV5 } from './visual-planning-brief-v5'
import { avgVisualPlanningTemplateRequirementsV2 } from './visual-planning-contract-v2'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4,avgVisualProposalArtifactKeyV4 } from './visual-planning-plan'
import { avgVisualPlanningRoleV5 } from './visual-planning-roles-v5'
export { avgVisualPlanningRoleV5 } from './visual-planning-roles-v5'

export const AVG_COMPILED_IMAGE_SKILL_V5='avg.compiled-image-request.v2'
export function buildAvgVisualPlanningPlanV5(input:{
  brief:Pick<ProductProductionBriefV3,'capabilityRequirements'>&{avgVisualPlanning:AvgVisualPlanningBriefV5}
  briefHash:string;buildNumber:number;controlEpoch:number
}):ProductProductionPlanV3 {
  const v=parseAvgVisualPlanningBriefV5(input.brief.avgVisualPlanning)
  const mediaBatch={schema:'storyforge.avg.visual-production-batch' as const,version:2 as const,batchKey:v.scope.batchKey,revision:v.scope.revision,
    aspectRatio:v.scope.aspectRatio,sourceInputHash:v.scope.sourceInputHash,visualReviewPolicy:'author-visual-v1' as const,
    requirements:avgVisualPlanningTemplateRequirementsV2(v.scope)}
  return buildAvgVisualPlanningTopologyV1(input,v,mediaBatch,{contextProfile:'avg-visual-planning-v5',directionKind:'avg-v5-visual-direction-proposal',
    subjectKind:'avg-v5-subject-visual-proposal',compileKind:'avg-v5-visual-requirements-compile',imageSkillId:AVG_COMPILED_IMAGE_SKILL_V5,
    compiledArtifactKey:AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4,proposalKey:avgVisualProposalArtifactKeyV4,role:avgVisualPlanningRoleV5})
}
