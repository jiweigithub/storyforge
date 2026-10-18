import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2,ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1,verifyHistoricalAvgImageProcessingProducerV1,verifyHistoricalAvgImageRevalidationProducerV1,
  verifyHistoricalAvgVisualImageProducerV4 } from '../product-production/artifact-store'
import { putMediaBlobObject,readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { ProductProductionDraftRejectedErrorV1,type ProductProductionTaskExecutionInputV1,type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { readAvgCompiledImageDefinitionV4 } from './visual-planning-image-definition'
import { readAvgVisualPlanningExecutionSourcesV4 } from './visual-planning-task-source'
import { inspectAvgCompiledRawImageV4,type AvgVerifiedCompiledImageDefinitionV4 } from './visual-image-revalidation'
import { processAvgImageBytesV1 } from './image-processing'
import { assertAvgProcessedImageArtifactFromDefinitionV1,AVG_IMAGE_PROCESSOR_V1,type AvgProcessedImageArtifactFieldsV1,type AvgProcessedImagePayloadV1 } from './image-processing-contract'
import { avgHash,avgRecord } from './protocol-validation'
import { inspectAvgProcessedImageBytesV1 } from './image-processing-source'

type Compiled=AvgVerifiedCompiledImageDefinitionV4
type Processed=AvgProcessedImageArtifactFieldsV1&Pick<ProductBuildArtifactRecordV1,'qualityJson'|'requirementKey'>
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
const ref=(r:ProductBuildArtifactRecordV1)=>({artifactKey:r.artifactKey,version:r.version,contentHash:r.contentHash,producerReceiptHash:r.producerReceiptHash})

function quality(compiled:Compiled,raw:ProductBuildArtifactRecordV1,receiptHash:string,sourceContextHash:string){
  return {schema:'storyforge.avg.visual-image-processing-evidence',version:1,noProviderRequest:true,decoderVerified:true,
    processingReceiptHash:receiptHash,rawProducerReceiptHash:raw.producerReceiptHash,
    sourceCompilation:compiled.definition.compilation,sourceRule:compiled.source.artifact,sourceScripts:compiled.source.scripts.map(s=>s.artifact),sourceContextHash}
}

/** Product semantics only. Each caller supplies its independently proven
 * compilation and exact raw/processed producer records, current or historic. */
export async function inspectAvgVisualProcessedImageV4(input:{scope:WorkspaceScope;compiled:Compiled;raw:ProductBuildArtifactRecordV1;artifact:Processed}){
  const {compiled,raw,artifact:a}=input
  const image=await assertAvgProcessedImageArtifactFromDefinitionV1(compiled.definition,a)
  const original=await inspectAvgCompiledRawImageV4({scope:input.scope,compiled,artifact:raw}),task=compiled.plan.tasks.find(t=>t.outputArtifactKeys.includes(a.artifactKey))
  const q=avgRecord(JSON.parse(a.qualityJson),['schema','version','noProviderRequest','decoderVerified','processingReceiptHash','rawProducerReceiptHash',
    'sourceCompilation','sourceRule','sourceScripts','sourceContextHash'],'V4 processing evidence')
  if(!task||task.kind!=='avg-media-image-process'||task.executionMode!=='deterministic'||task.contextProfile!=='avg-visual-planning-v4'
    ||task.skillId!==null||task.capabilityRequirementKeys.length||task.maxAttempts!==1||task.reuse!==null
    ||task.budgetReservation.modelCalls!==0||task.budgetReservation.mediaCalls!==0||task.budgetReservation.maximumCostUsd!==0
    ||a.requirementKey!==null||!same(image.payload.raw,ref(raw))||!same(image.payload.sourceAsset,original.asset)
    ||!same(q,quality(compiled,raw,image.payload.receipt.receiptHash,avgHash(q.sourceContextHash,'processing context hash'))))throw new Error('[avg-process] 加工图没有绑定准确原图、配方、当前编译与零调用任务')
  return {...image,sourceContextHash:q.sourceContextHash as string}
}

/** Exact completed producers, original bytes, actual compilation/recipe and
 * decoded output. No current adoption or resumed imported Run authority. */
export async function readAvgVisualProcessingEvidenceV4(input:{scope:WorkspaceScope;compiled:Compiled;artifact:{artifactKey:string;version:number;contentHash:string}}){
  const {compiled}=input,build=compiled.build
  const boundary={scope:input.scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:compiled.plan.controlEpoch}
  const processing=await verifyHistoricalAvgImageProcessingProducerV1({...boundary,...input.artifact})
  const payload=await assertAvgProcessedImageArtifactFromDefinitionV1(compiled.definition,processing.artifact)
  const original=compiled.planning.rawReuse?.find(s=>s.requirementKey===payload.payload.requirementKey)
  const rawProof=original?await verifyHistoricalAvgImageRevalidationProducerV1({...boundary,...payload.payload.raw})
    :await verifyHistoricalAvgVisualImageProducerV4({...boundary,...payload.payload.raw})
  const checked=await inspectAvgVisualProcessedImageV4({scope:input.scope,compiled,raw:rawProof.artifact,artifact:processing.artifact})
  const image=await inspectAvgProcessedImageBytesV1({scope:input.scope,raw:rawProof.artifact,processed:processing.artifact,image:checked})
  return {raw:rawProof.artifact,rawProof:rawProof.provenance,...(original?{original}:{}),processing:processing.artifact,
    processingProof:processing.provenance,image}
}

/** Same bounded native processor as V2, executed under the actual V4 frozen
 * Brief/claim/Gateway and its own zero-capability producer. No fake V2 Brief. */
export async function executeAvgVisualImageProcessingTaskV4(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3):Promise<ProductProductionTaskExecutionResultV1>{
  const started=Date.now(),usage=(storageBytes=0)=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes})
  try{
    if(input.signal.aborted||input.capabilityBindings.length||input.attempt!==1||input.authorDraftJson)throw new Error('[avg-process] 单次零调用加工领取已失效')
    const claim=await readAvgVisualPlanningExecutionSourcesV4(input,brief)
    const compiled=await readAvgCompiledImageDefinitionV4({scope:input.scope,buildId:input.buildId,expectedBuildRevision:claim.build.stateRevision,
      controlEpoch:input.controlEpoch,expectedBrief:brief})
    const task=compiled.plan.tasks.find(t=>t.taskKey===input.task.taskKey),entry=compiled.planning.imageProcessing?.entries.find(e=>task?.taskKey===`avg.media.process.${e.requirementKey}`)
    const supplied=input.inputArtifacts.filter(r=>r.artifactKey===`avg.media.raw.${entry?.requirementKey}`)
    if(!entry||!task||!same(task,input.task)||task.kind!=='avg-media-image-process'||task.contextProfile!=='avg-visual-planning-v4'
      ||claim.packet.operation!=='process-compiled-image'||!same(claim.packet.processing,entry)||supplied.length!==1)throw new Error('[avg-process] 加工不属于准确冻结任务与登记输入')
    const readRaw=async()=>{
      const row=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,...ref(supplied[0])})
      return {row,...await inspectAvgCompiledRawImageV4({scope:input.scope,compiled,artifact:row})}
    }
    const raw=await readRaw(),blob=raw.row.blobObjectId===null?null:await db.mediaBlobObjects.get(raw.row.blobObjectId)
    if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==raw.asset.contentHash
      ||blob.mimeType!==raw.asset.mimeType||blob.byteSize!==raw.asset.byteSize)throw new Error('[avg-process] 加工原图缺少准确同作品字节')
    const result=await processAvgImageBytesV1({data:await readVerifiedMediaBlobObjectData(blob),source:{contentHash:raw.asset.contentHash,mimeType:raw.asset.mimeType,
      width:raw.asset.width!,height:raw.asset.height!},recipe:entry.recipe,signal:input.signal})
    await readRaw();await readAvgVisualPlanningExecutionSourcesV4(input,brief)
    if(input.signal.aborted)throw new Error('[avg-process] 加工已停止，原图与供应商记录保留')
    const output=await putMediaBlobObject({scope:input.scope,data:result.data,mimeType:'image/png',expectedContentHash:result.receipt.output.contentHash})
    const asset:FrozenRuntimeMediaAssetV2={...raw.asset,version:raw.asset.version+1,contentHash:output.contentHash,blobContentHash:output.contentHash,
      mimeType:'image/png',byteSize:output.byteSize,width:entry.recipe.width,height:entry.recipe.height,source:AVG_IMAGE_PROCESSOR_V1}
    const payload:AvgProcessedImagePayloadV1={schema:'storyforge.avg.processed-image',version:1,requirementKey:entry.requirementKey,
      raw:{...ref(raw.row),producerReceiptHash:raw.row.producerReceiptHash!},sourceAsset:raw.asset,recipe:entry.recipe,receipt:result.receipt}
    const artifact={artifactKey:task.outputArtifactKeys[0],requirementKey:null,kind:'image' as const,mediaKind:raw.asset.kind,payload,metadata:asset,
      contentHash:output.contentHash,blobObjectId:output.id!,mimeType:'image/png',byteSize:output.byteSize,
      quality:quality(compiled,raw.row,result.receipt.receiptHash,await hashProductProductionValueV2(input.contextText)),
      rights:{origin:'local-processing',sourceContentHash:raw.row.contentHash,sourceLicense:raw.asset.license,declaration:entry.recipe.declaration}}
    return {artifacts:[artifact],passedGateIds:[...task.acceptanceGateIds],usage:usage(output.byteSize+new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength)}
  }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'[avg-process] 本地加工失败',usage())}
}
