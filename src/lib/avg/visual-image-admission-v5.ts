import { db } from '../db/schema'
import type { ProductProductionBriefV3 } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import type { assertAvgMediaRawProducerAdmissionV2 } from './media-production-admission'
import { readAvgCompiledImageDefinitionV5 } from './visual-planning-image-definition-v5'
import { assertAvgRawImageArtifactFromDefinitionV2 } from './media-raw-contract-v2'
import { AVG_COMPILED_IMAGE_SKILL_V5 } from './visual-planning-plan-v5'
import { AVG_VISUAL_PLANNING_CONTEXT_V5 } from './visual-planning-roles-v5'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { avgRecord } from './protocol-validation'
import { assertAvgOriginalImageResponseV1 } from './media-response-proof'
import { avgReferenceTransmissionV1 } from './media-reference-adapter'

/** Sealed admission under the actual V5 Brief, compiler and durable producer.
 * Original bytes cannot be accepted as a legacy request or as reviewed art. */
export async function assertAvgCompiledImageProducerAdmissionV5(input:Parameters<typeof assertAvgMediaRawProducerAdmissionV2>[0],brief:ProductProductionBriefV3){
  const d=await readAvgCompiledImageDefinitionV5({scope:input.scope,buildId:input.build.id,expectedBuildRevision:input.build.stateRevision,
    controlEpoch:input.build.controlEpoch,expectedBrief:brief}),task=input.task,a=input.artifact
  if(task.kind!=='avg-media-image-generate'||task.executionMode!=='media-provider'||task.skillId!==AVG_COMPILED_IMAGE_SKILL_V5
    ||task.maxAttempts!==1||task.budgetReservation.mediaCalls!==1||task.budgetReservation.modelCalls!==0
    ||task.outputArtifactKeys.length!==1||task.outputArtifactKeys[0]!==a.artifactKey
    ||!task.inputArtifactKeys.includes(d.definition.compilation.artifactKey))throw new Error('[avg-visual-image] 新原图不是准确编译需求的单次图片任务')
  const raw=await assertAvgRawImageArtifactFromDefinitionV2({...d.definition,capability:d.capability,qualityProfile:brief.qualityProfile},a)
  if(task.taskKey!==`avg.media.generate.${raw.payload.requirement.requirementKey}`)throw new Error('[avg-visual-image] 新原图需求写域不一致')
  const binding={requirementKey:d.capability.requirementKey,adapterId:raw.payload.request.request.adapterId,bindingHash:raw.payload.capabilityBindingHash}
  const run=await db.agentRuns.get(input.producerRunId)
  if(!run||(JSON.parse(run.contractJson) as {runtimeBindingHash?:string}).runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1({
    planHash:input.build.planHash,task,capabilityBindings:[binding]}))throw new Error('[avg-visual-image] 新原图路由与真实 Harness 不一致')
  const q=avgRecord(JSON.parse(a.qualityJson),['received','rawResponseRecorded','responseEvidenceHash','headerVerified','contentHashVerified',
    'decoderVerified','referenceTransmission','sourceRule','sourceScripts','sourceCompilation','sourceContextHash'],'versioned compiled image evidence')
  const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
  if(q.received!==true||q.rawResponseRecorded!==true||q.headerVerified!==true||q.contentHashVerified!==true||q.decoderVerified!==false
    ||!same(q.sourceRule,d.source.artifact)||!same(q.sourceScripts,d.source.scripts.map(s=>s.artifact))||!same(q.sourceCompilation,d.definition.compilation)
    ||!same(q.referenceTransmission,avgReferenceTransmissionV1(raw.payload.request)))throw new Error('[avg-visual-image] 新原图必须保留准确参考用途/家族回执，不能冒充解码或画面合规')
  await assertAvgOriginalImageResponseV1(input.scope,input.producerRunId,task.taskKey,q)
  const assembled=await assembleContext({projectId:input.scope.projectId,scope:input.scope,productProductionId:input.build.productionId,
    productBuildId:input.build.id,productProductionTaskKey:task.taskKey,productArtifactKeys:task.inputArtifactKeys,sourceKeys:[AVG_VISUAL_PLANNING_CONTEXT_V5],
    inputBudgetTokens:task.budgetReservation.inputTokens,sourceTransformer:preserveProductProductionContextV1})
  if(assembled.overBudgetAfterTrim||assembled.segments.length!==1||!same(assembled.included,[AVG_VISUAL_PLANNING_CONTEXT_V5])
    ||!assembled.sourceEvidence?.length||assembled.sourceEvidence.some(s=>s.status!=='included'||s.delivery!=='full')
    ||q.sourceContextHash!==await hashProductProductionValueV2(assembled.text))throw new Error('[avg-visual-image] 新原图登记输入与真实编译来源不一致')
}
