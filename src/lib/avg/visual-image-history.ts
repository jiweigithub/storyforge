import Dexie from 'dexie'
import { avgVisualRawReuseDescriptorV4, type AvgVisualRawReuseSourceV4 } from './visual-image-reuse-contract'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyHistoricalAvgVisualPlanningArtifactV4, verifyHistoricalAvgVisualImageProducerV4 } from '../product-production/artifact-store'
import { readAvgHistoricalVisualArtifactV4 } from './author-artifacts'
import { parseAvgProfessionalArtifactV1 } from './artifact-contract'
import { assertAvgVisualPlanningProposalV1 } from './media-source'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from './visual-planning-plan'
import { avgImageReferenceCapabilityV2, verifyAvgReferenceBytesV1 } from './media-reference-contract'
import { readAvgDraftReferenceBytesV1 } from './editor-service'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { assertAvgRawImageArtifactFromDefinitionV1 } from './media-raw-contract'
import { avgRawMediaArtifactKeyV1 } from './media-production-contract'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'

type Ref={artifactKey:string;version:number;contentHash:string}
const ref=(row:ProductBuildArtifactRecordV1):Ref=>({artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
export interface AvgHistoricalVisualBoundaryV4 {
  scope:WorkspaceScope;buildId:number;expectedBuildRevision:number;controlEpoch:number
  expectedBriefHash:string;expectedPlanHash:string
}

/** Read the original stopped/frozen compilation through its actual author,
 * model and compiler receipts. No substitute Brief, current adoption or
 * request permission is created. A partial image prefix needs no Stage. */
export async function readAvgHistoricalCompiledImageDefinitionV4(input:AvgHistoricalVisualBoundaryV4){
  const scope=await resolveScope({scope:input.scope}),build=await db.productBuilds.get(input.buildId)
  if(!build?.id||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'})
    ||build.stateRevision!==input.expectedBuildRevision||build.briefHash!==input.expectedBriefHash||build.planHash!==input.expectedPlanHash
    ||!Number.isSafeInteger(input.controlEpoch)||input.controlEpoch<0||input.controlEpoch>build.controlEpoch
    ||!['paused','cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(build.status))throw new Error('[avg-visual-history] 图片来源不是准确已停止或冻结版本')
  const production=await db.productProductions.get(build.productionId)
  const briefRow=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
  if(!production||production.productType!=='avg'||!await assertRecordInScope(scope,'productProductions',production,{owner:'work'})
    ||!briefRow||!await assertRecordInScope(scope,'productProductionBriefs',briefRow,{owner:'work'})
    ||!['authorized','superseded'].includes(briefRow.status)||briefRow.briefHash!==build.briefHash||briefRow.authorizedAt!==build.authorizedAt)throw new Error('[avg-visual-history] 原图片缺少准确授权来源')
  const brief=parseProductProductionBriefV3(briefRow.briefJson),planning=brief.avgVisualPlanning
  if(!planning||await hashProductProductionValueV2(brief)!==build.briefHash)throw new Error('[avg-visual-history] 需要原始完整 V4 图片合同')
  const capability=brief.capabilityRequirements.find(c=>c.requirementKey==='avg.media.image')
  if(!capability||capability.capabilityHash!==await hashProductProductionValueV2(avgImageReferenceCapabilityV2(planning.imageBinding.adapterId)))throw new Error('[avg-visual-history] 原图片模型与能力不一致')
  const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  if(plan.controlEpoch!==input.controlEpoch||plan.buildNumber!==build.buildNumber||await hashProductProductionValueV2(plan)!==build.planHash)throw new Error('[avg-visual-history] 原图片 Plan/epoch 不一致')
  const compiler=plan.tasks.find(t=>t.kind==='avg-v4-visual-requirements-compile')
  if(!compiler||!same(compiler.outputArtifactKeys,[AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4]))throw new Error('[avg-visual-history] 原编译任务缺失')
  const rows=await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const exact=(key:string)=>{
    const matches=rows.filter(r=>r.status==='accepted'&&r.controlEpoch===input.controlEpoch&&r.artifactKey===key)
    if(matches.length!==1)throw new Error(`[avg-visual-history] 原输入不唯一或缺失：${key}`)
    return matches[0]
  }
  const proofInput={scope,buildId:build.id,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:input.controlEpoch}
  const compilation=await verifyHistoricalAvgVisualPlanningArtifactV4({...proofInput,...ref(exact(AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4))})
  const visualKeys=compiler.inputArtifactKeys.filter(k=>k==='avg.media.visual-bible'||/^avg\.media\.(character|environment|prop)-brief\./.test(k))
  const visual=[]
  const witnessed=new Map<string,Ref>()
  for(const key of visualKeys){
    const history=await readAvgHistoricalVisualArtifactV4({scope,buildId:build.id,expectedBuildRevision:build.stateRevision,
      controlEpoch:input.controlEpoch,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,artifact:ref(exact(key))})
    for(const witness of [...history.inputs,history.artifact]){
      const old=witnessed.get(witness.artifactKey)
      if(old&&!same(old,witness))throw new Error('[avg-visual-history] 原作者来源见证相互冲突')
      witnessed.set(witness.artifactKey,witness)
    }
    visual.push(history)
  }
  const inputs=compiler.inputArtifactKeys.map(key=>{
    const row=exact(key),witness=witnessed.get(key)
    if(!witness||!same(witness,ref(row)))throw new Error('[avg-visual-history] 编译输入缺少实际原作者见证')
    return row
  })
  const rule=exact('avg.system.plan'),systemPlan=parseAvgProfessionalArtifactV1(rule.payloadJson)
  if(systemPlan.schema!=='storyforge.avg.system-plan')throw new Error('[avg-visual-history] 原规则不是准确正式系统')
  const scripts=systemPlan.scenes.map(scene=>{
    const row=exact(`avg.content.scene-script.${scene.key}`),payload=parseAvgProfessionalArtifactV1(row.payloadJson)
    if(payload.schema!=='storyforge.avg.scene-script'||!inputs.some(i=>same(ref(i),ref(row))))throw new Error('[avg-visual-history] 原脚本缺少编译来源')
    return {payload,artifact:ref(row)}
  })
  if(inputs.length!==1+scripts.length+visual.length||!inputs.some(i=>same(ref(i),ref(rule))))throw new Error('[avg-visual-history] 原编译依赖域不完整')
  const visualBible=visual.find(v=>v.payload.schema==='storyforge.avg.visual-bible')?.payload
  const mediaBriefs=visual.filter(v=>v.payload.schema==='storyforge.avg.media-brief').map(v=>v.payload)
  const proposal=await assertAvgVisualPlanningProposalV1(compilation.payloadJson,{scope:planning.scope,visualBible,mediaBriefs,
    source:{systemPlan,scripts:scripts.map(s=>s.payload),presentation:{aspectRatio:planning.scope.aspectRatio}}})
  if(!same(JSON.parse(compilation.qualityJson),{schema:'storyforge.avg.visual-compilation-evidence',version:1,
    scopeHash:await hashProductProductionValueV2(planning.scope),inputs:inputs.map(ref)}))throw new Error('[avg-visual-history] 原编译工件与作者输入不一致')
  for(const requirement of proposal.batch.requirements){
    for(const reference of requirement.references)await verifyAvgReferenceBytesV1(reference,await readAvgDraftReferenceBytesV1(scope,reference))
    await validateAvgGeneratedReferencesV1(scope,requirement.references,requirement.family)
  }
  if(!same(await db.productBuilds.get(build.id),build)||!same(await db.productProductions.get(production.id!),production)
    ||!same(await db.productProductionBriefs.get(briefRow.id!),briefRow))throw new Error('[avg-visual-history] 原编译来源在读取期间变化')
  for(const row of [compilation,...inputs])if(!await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'})||!same(await db.productBuildArtifacts.get(row.id!),row))throw new Error('[avg-visual-history] 原编译输入在读取期间变化')
  return {scope,brief,planning,build,production,plan,compiler,compilation,proposal,capability,records:{brief:briefRow,artifacts:[compilation,...inputs]},
    source:{plan:systemPlan,artifact:ref(rule),scripts},visual,
    definition:{schema:'storyforge.avg.compiled-image-definition' as const,version:4 as const,assembly:planning.assembly,
      mediaBatch:proposal.batch,imageBinding:planning.imageBinding,compilation:ref(compilation)}}
}

/** Full original definition + intrinsic producer evidence. Author selection,
 * new reference consent and current consumption remain separate decisions. */
export async function readAvgHistoricalRawImageV4(input:AvgHistoricalVisualBoundaryV4&{artifact:Ref}){
  const resolved=await readAvgHistoricalCompiledImageDefinitionV4(input)
  return inspectHistoricalRaw(resolved,input.artifact)
}

type HistoricalDefinition=Awaited<ReturnType<typeof readAvgHistoricalCompiledImageDefinitionV4>>
async function assertFresh(resolved:HistoricalDefinition){
  if(!same(await db.productBuilds.get(resolved.build.id!),resolved.build)
    ||!same(await db.productProductions.get(resolved.production.id!),resolved.production)
    ||!same(await db.productProductionBriefs.get(resolved.records.brief.id!),resolved.records.brief))throw new Error('[avg-visual-history] 原图片来源在读取期间变化，请重新读取')
  for(const row of resolved.records.artifacts)if(!same(await db.productBuildArtifacts.get(row.id!),row))throw new Error('[avg-visual-history] 原作者或编译输入在读取期间变化')
}
async function inspectHistoricalRaw(resolved:HistoricalDefinition,artifact:Ref){
  const {build,plan}=resolved
  const proof=await verifyHistoricalAvgVisualImageProducerV4({scope:resolved.scope,buildId:build.id!,
    expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,
    sourceControlEpoch:plan.controlEpoch,...artifact})
  const raw=await assertAvgRawImageArtifactFromDefinitionV1({...resolved.definition,capability:resolved.capability,
    qualityProfile:resolved.brief.qualityProfile},proof.artifact)
  const quality=JSON.parse(proof.artifact.qualityJson)
  if(!same(quality.sourceCompilation,resolved.definition.compilation)||!same(quality.sourceRule,resolved.source.artifact)
    ||!same(quality.sourceScripts,resolved.source.scripts.map(s=>s.artifact)))throw new Error('[avg-visual-history] 原图未绑定原已采用编译来源')
  await assertFresh(resolved)
  return {...resolved,raw:proof.artifact,provenance:proof.provenance,payload:raw.payload,asset:raw.asset}
}

/** All original slots remain visible, including absent or invalid images.
 * Compiler verification is shared within this one read, never persisted as
 * a grant. Pixels are read again through their exact boundary on expansion. */
export async function readAvgHistoricalImageCandidatesV4(input:Omit<AvgHistoricalVisualBoundaryV4,'controlEpoch'>&{productionId:number}){
  const build=await db.productBuilds.get(input.buildId)
  if(!build||build.productionId!==input.productionId)throw new Error('[avg-visual-history] 图片来源制作记录已变化')
  const controlEpoch=(JSON.parse(build.planJson) as {controlEpoch:number}).controlEpoch
  const boundary={...input,controlEpoch},resolved=await readAvgHistoricalCompiledImageDefinitionV4(boundary)
  const candidates=[]
  for(const requirement of resolved.definition.mediaBatch.requirements){
    const rows=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,avgRawMediaArtifactKeyV1(requirement.requirementKey)])
      .filter(r=>r.status==='accepted'&&r.controlEpoch===controlEpoch).toArray()
    if(!rows.length){candidates.push({requirement,available:false as const,issue:'本版暂无可核对的原图记录'});continue}
    try{
      if(rows.length!==1)throw new Error('[avg-visual-history] 原图版本不唯一')
      const image=await inspectHistoricalRaw(resolved,ref(rows[0]))
      candidates.push({requirement,available:true as const,asset:image.asset,raw:ref(image.raw),reuseSource:await avgVisualRawReuseDescriptorV4(image),costUsd:image.payload.provider.costUsd})
    }catch(error){candidates.push({requirement,available:false as const,issue:error instanceof Error?error.message:'原图来源未通过核验'})}
  }
  await assertFresh(resolved)
  const {scope:_scope,productionId:_production,...previewBoundary}=boundary
  return {boundary:previewBoundary,buildNumber:build.buildNumber,candidates}
}

/** Same owner/hash reader for native preview; never an HTTP image URL. */
export async function readAvgHistoricalImageCandidateBytesV4(input:AvgHistoricalVisualBoundaryV4&{
  productionId:number;requirementKey:string;version:number;contentHash:string;source?:AvgVisualRawReuseSourceV4
}){
  let image:Awaited<ReturnType<typeof readAvgHistoricalRawImageV4>>
  if(input.source){
    const load=()=>import('./visual-image-reuse')
    const {readAvgVisualRawReuseSourceV4}=await (Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    image=await readAvgVisualRawReuseSourceV4({scope:input.scope,source:input.source})
    if(image.build.id!==input.buildId||image.build.stateRevision!==input.expectedBuildRevision||image.plan.controlEpoch!==input.controlEpoch
      ||image.build.briefHash!==input.expectedBriefHash||image.build.planHash!==input.expectedPlanHash
      ||image.raw.artifactKey!==avgRawMediaArtifactKeyV1(input.requirementKey)||image.raw.version!==input.version
      ||image.raw.contentHash!==input.contentHash)throw new Error('[avg-visual-history] 便携原图与所选来源边界不一致')
  }else image=await readAvgHistoricalRawImageV4({...input,artifact:{artifactKey:avgRawMediaArtifactKeyV1(input.requirementKey),version:input.version,contentHash:input.contentHash}})
  if(image.production.id!==input.productionId)throw new Error('[avg-visual-history] 原图不属于所选制作记录')
  const blob=image.raw.blobObjectId===null?null:await db.mediaBlobObjects.get(image.raw.blobObjectId)
  if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==image.asset.contentHash
    ||blob.byteSize!==image.asset.byteSize||blob.mimeType!==image.asset.mimeType)throw new Error('[avg-visual-history] 原图字节不存在或已变化')
  const data=await readVerifiedMediaBlobObjectData(blob)
  await assertFresh(image)
  if(!same(await db.productBuildArtifacts.get(image.raw.id!),image.raw))throw new Error('[avg-visual-history] 原图版本在读取期间变化')
  return {asset:image.asset,data}
}
