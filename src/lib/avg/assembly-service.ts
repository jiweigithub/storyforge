import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, scopeTransactionTables } from '../workspace/scope'
import { readAvgDraftV1, bindAvgDraftProductionV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { AVG_ASSEMBLY_GATE_IDS_V1, avgMediaProductionEnabledV2, avgMediaAssemblyGateIdsV2 } from './assembly-contract'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../product-production/consultation'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { beginProductProductionEvolutionV1, readProductProductionDetailsV1, authorizeProductProductionStartV1, stopProductProductionV1, type ProductProductionDetailsV1 } from '../product-production/service'
import { verifyStoredProductBuildPreview } from '../product-production/preview-manifest'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1, selectProductBuildCompatibilityBaselineV1 } from '../product-production/scheduler'
import { createConfiguredProductProductionExecutorV1 } from '../product-production/production-executor'
import { readAvgMediaChoicesForConfigurationV2, stageAvgAuthorArtifactV1 } from './author-artifacts'
import { listAvgDraftMediaV1, saveAvgAuthorWorkspaceV1 } from './editor-service'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { assertAvgMediaConsumerDeclarationsV1, validateAvgVisualProductionBatchSourceV1 } from './media-source'
import { avgVisualProductionBudgetV2, avgVisualProductionDataClassesV2 } from './media-production-policy'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1 } from './media-reference-contract'
import { resolveAvgImageExecutionCapabilityV2 } from './media-capability'
import { avgMediaChoiceArtifactKeyV1, avgRawMediaArtifactKeyV1, avgVisualReviewArtifactKeyV1, type AvgAuthorMediaChoiceV1, type AvgVisualProductionRequirementV1 } from './media-production-contract'
import type { AvgReviewIssuesV1 } from './artifact-contract'
import type { ProductProductionBriefV3, ProviderCapabilityRequirementV1 } from '../types'
import { verifyAcceptedProductBuildArtifactV1, verifyRetainedAvgRawImageArtifactV1 } from '../product-production/artifact-store'
import type { ResolvedProductMediaCapabilityV1 } from '../product-production/media-transport'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { freezeAvgVisualProductionBatchV1 } from './media-source'
import { applyAvgMediaChoicesToDraftV1, prepareAvgMediaConsumerDeclarationsV1, resetAvgUnconsumedMediaDeclarationsV1 } from './media-configuration'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { assertAvgKnownImageRetriesV1, prepareAvgImageRecoveryV1, readAvgImageRecoverySourceV1, validateAvgImageRecoveryV1 } from './media-recovery'
import { parseAvgImageRecoveryV1, type AvgImageRecoveryV1 } from './media-recovery-contract'
import { listWorldReferenceCatalogV1 } from '../product/source'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { prepareAvgInheritedStageDraftV1, readAvgInheritedStageImagesV1 } from './stage-image-sources'

const commandId = (label: string) => `avg.assembly.${label}.${crypto.randomUUID()}`

/** Saves a proposed batch and prospective item image references only. The
 * author still reviews a Brief, starts production and confirms each choice. */
export async function saveAvgVisualBatchDraftV1(input: { scope: WorkspaceScope; expectedDraftRevision: number;
  batchKey: string; revision: number; requirements: AvgVisualProductionRequirementV1[];visualReviewPolicy?:'author-visual-v1' }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-media] 编辑草稿已变化')
  if(parseAvgAuthorWorkspaceV1(draft.editorJson).mediaBatch?.characterFamily)throw new Error('[avg-family] 请通过人物家族编辑保留身份方案，或明确结束当前家族批次后再新建普通需求')
  const workspace = prepareAvgMediaConsumerDeclarationsV1(resetAvgUnconsumedMediaDeclarationsV1(parseAvgAuthorWorkspaceV1(draft.editorJson)), input.requirements)
  workspace.mediaBatch = await freezeAvgVisualProductionBatchV1({ schema: 'storyforge.avg.visual-production-batch', version: 1,
    batchKey: input.batchKey, revision: input.revision, requirements: input.requirements,...(input.visualReviewPolicy||workspace.mediaBatch?.visualReviewPolicy?{visualReviewPolicy:input.visualReviewPolicy??workspace.mediaBatch!.visualReviewPolicy!}:{}) }, workspace)
  return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, workspace)
}

/** Explicitly remove an unused batch, retaining imported references/Blobs and
 * every production receipt. A live or already consumed batch is not erased. */
export async function clearAvgVisualBatchDraftV1(input: { scope: WorkspaceScope; expectedDraftRevision: number }) {
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const draft = await readAvgDraftV1(input.scope)
    if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-media] 编辑草稿已变化')
    const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
    if (draft.productionId) {
      const production = await db.productProductions.get(draft.productionId)
      if (!production || production.productType !== 'avg' || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) throw new Error('[avg-media] 制作记录不存在或跨作品')
      if (production.currentBuildNumber !== null) {
        const build = await db.productBuilds.where('[productionId+buildNumber]').equals([draft.productionId, production.currentBuildNumber]).first()
        if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg-media] 当前制作版本不存在或跨作品')
        if (!build.previewHash && production.status !== 'brief-ready' && !['cancelled', 'failed', 'recovery-required'].includes(build.status)) {
          throw new Error('[avg-media] 已开始的图片批次须保留；请先明确停止或修订制作')
        }
      }
    }
    if (workspace.mediaBatch?.requirements.some(r => workspace.presentation.stage.assets.some(a => a.assetKey === r.assetKey))) {
      throw new Error('[avg-media] 图片已进入演出草稿，不能丢弃其生产来源；请保留批次并显式修订')
    }
    const next = resetAvgUnconsumedMediaDeclarationsV1(workspace)
    delete next.mediaBatch
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, next)
  })
}

/** An explicit new-scope proposal: keep adopted stage images, retire only the
 * editable generation batch, retain all old Runs, pending bills and Blobs. */
export async function keepAvgGeneratedStageDraftV1(input:{scope:WorkspaceScope;productionId:number;expectedDraftRevision:number;expectedBuildId:number}){
  const draft=await readAvgDraftV1(input.scope),details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId||details.build?.id!==input.expectedBuildId
    ||!details.executionBrief?.avgAssembly||!details.build.previewHash&&!['cancelled','failed','recovery-required'].includes(details.build.status))throw new Error('[avg-media] 请先明确停止或完成当前批次，再保留演出图')
  const workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
  if(!workspace.mediaBatch)throw new Error('[avg-media] 当前草稿没有待结束的图片批次')
  const next=resetAvgUnconsumedMediaDeclarationsV1(await prepareAvgInheritedStageDraftV1({scope:input.scope,workspace,build:details.build,productionKey:details.production.productionKey,
    targetBuildNumber:Math.max(...details.buildHistory.map(row=>row.buildNumber))+1,worldContentHash:details.executionBrief.source.worldContentHash}))
  if(!next.presentation.inheritedImages?.length)throw new Error('[avg-media] 没有可保留的已采用演出图片')
  delete next.mediaBatch
  return saveAvgAuthorWorkspaceV1(input.scope,draft.revision,next)
}

export async function stageAvgMediaChoiceV2(input: { scope: WorkspaceScope; productionId: number; requirementKey: string;
  rawVersion: number; rawContentHash: string; declaration: string }) {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (!build?.id || brief?.avgAssembly?.version !== 2) throw new Error('[avg-media] 当前版本不是已开始的图片批次')
  const r = brief.avgAssembly.mediaBatch.requirements.find(r => r.requirementKey === input.requirementKey)
  if (!r) throw new Error('[avg-media] 图片需求不在当前冻结批次')
  const raw = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: build.id, artifactKey: avgRawMediaArtifactKeyV1(r.requirementKey),
    version: input.rawVersion, contentHash: input.rawContentHash })
  const candidate = await assertAvgRawImageArtifactV1(brief, raw)
  const payload: AvgAuthorMediaChoiceV1 = { schema: 'storyforge.avg.media-choice', version: 1, requirementKey: r.requirementKey,
    requirementRevision: r.revision, raw: { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash }, asset: candidate.asset,
    referenceOnly: r.consumer.domain === 'reference', declaration: input.declaration }
  return stageAvgAuthorArtifactV1({ scope: input.scope, buildId: build.id, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
    taskKey: `avg.author.media.${r.requirementKey}`, artifactKey: avgMediaChoiceArtifactKeyV1(r.requirementKey), kind: 'presentation', payload, declaration: input.declaration })
}

export async function stageAvgVisualReviewV1(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;rawVersion:number;rawContentHash:string;report:AvgReviewIssuesV1;declaration:string}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build,brief=details.executionBrief
  if(!build?.id||brief?.avgAssembly?.version!==2||!brief.avgAssembly.mediaBatch.visualReviewPolicy||input.report.targetKey!==input.requirementKey)throw new Error('[avg-review] 评审不属于当前批次或准确图片')
  await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:build.id,artifactKey:avgRawMediaArtifactKeyV1(input.requirementKey),version:input.rawVersion,contentHash:input.rawContentHash})
  return stageAvgAuthorArtifactV1({scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
    taskKey:`avg.author.visual-review.${input.requirementKey}`,artifactKey:avgVisualReviewArtifactKeyV1(input.requirementKey),kind:'quality-report',payload:input.report,declaration:input.declaration})
}

export async function readAvgRawImageCandidateBytesV2(input: { scope: WorkspaceScope; productionId: number; requirementKey: string; version: number; contentHash: string }) {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  if (!details.build?.id || details.executionBrief?.avgAssembly?.version !== 2) throw new Error('[avg-media] 当前版本不是图片批次')
  const raw = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: details.build.id,
    artifactKey: avgRawMediaArtifactKeyV1(input.requirementKey), version: input.version, contentHash: input.contentHash })
  const candidate = await assertAvgRawImageArtifactV1(details.executionBrief, raw)
  const blob = raw.blobObjectId === null ? null : await db.mediaBlobObjects.get(raw.blobObjectId)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' }) || blob.contentHash !== candidate.asset.contentHash
    || blob.byteSize !== candidate.asset.byteSize || blob.mimeType !== candidate.asset.mimeType) throw new Error('[avg-media] 原始图片对象不存在或已变化')
  return { asset: candidate.asset, data: await readVerifiedMediaBlobObjectData(blob) }
}

async function reviewRetainedImage(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;version?:number;contentHash?:string}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const row=build?details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash):null
  const brief=row?parseProductProductionBriefV3(row.briefJson):null,a=brief?.avgAssembly
  if(!build?.id||a?.version!==2||!['cancelled','failed','recovery-required'].includes(build.status))throw new Error('[avg-media] 当前版本不是可查看的已停止图片批次')
  const plan=parseProductProductionPlanV3(build.planJson,brief!,build.briefHash)
  const raws=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id,avgRawMediaArtifactKeyV1(input.requirementKey)])
    .filter(r=>r.status==='accepted'&&r.controlEpoch===plan.controlEpoch).limit(2).toArray()
  const raw=raws[0]
  if(raws.length!==1||!raw||input.version!==undefined&&raw.version!==input.version||input.contentHash!==undefined&&raw.contentHash!==input.contentHash)throw new Error('[avg-media] 该项没有准确的已接收原图')
  const proved=await verifyRetainedAvgRawImageArtifactV1({scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:plan.controlEpoch,artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash})
  const query=parseAvgImageRecoveryV1({schema:'storyforge.avg.image-recovery',version:1,sourceBuildNumber:build.buildNumber,sourceBuildRevision:build.stateRevision,
    sourceBriefHash:build.briefHash,sourcePlanHash:build.planHash,sourceControlEpoch:plan.controlEpoch,sourceBatchHash:await hashProductProductionValueV2(a.mediaBatch),
    retained:[{requirementKey:input.requirementKey,proof:proved.provenance}],rerunRequirementKeys:a.mediaBatch.requirements.filter(r=>r.requirementKey!==input.requirementKey).map(r=>r.requirementKey),
    declaration:'只读原图核验，不授权调用、采用或新版本'},a.mediaBatch)
  return readAvgImageRecoverySourceV1({scope:input.scope,productionId:input.productionId,brief:{avgAssembly:{...a,imageRecovery:query}},requirementKey:input.requirementKey})
}

export async function readAvgRetainedImageCandidateBytesV1(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;version:number;contentHash:string}){
  const candidate=await reviewRetainedImage(input)
  const blob=candidate.artifact.blobObjectId===null?null:await db.mediaBlobObjects.get(candidate.artifact.blobObjectId)
  if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'}))throw new Error('[avg-media] 保留原图对象不存在或跨作品')
  return {asset:candidate.asset,data:await readVerifiedMediaBlobObjectData(blob)}
}

export async function readAvgImageRecoveryOptionsV1(scope:WorkspaceScope,productionId:number){
  const details=await readProductProductionDetailsV1(scope,productionId,['avg']),build=details.build
  const row=build?details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash):null
  const brief=row?parseProductProductionBriefV3(row.briefJson):null
  if(!build?.id||brief?.avgAssembly?.version!==2||build.previewHash||!['cancelled','failed','recovery-required'].includes(build.status))throw new Error('[avg-media] 当前版本不能准备未封存图片恢复')
  const items=[]
  for(const r of brief.avgAssembly.mediaBatch.requirements){
    let candidate:Awaited<ReturnType<typeof reviewRetainedImage>>|null=null,issue='',retryBlocker=''
    try{candidate=await reviewRetainedImage({scope,productionId,requirementKey:r.requirementKey})}catch(error){issue=error instanceof Error?error.message:String(error)}
    try{await assertAvgKnownImageRetriesV1(scope,build,[r.requirementKey])}catch(error){retryBlocker=error instanceof Error?error.message:String(error)}
    items.push({requirementKey:r.requirementKey,name:r.name,asset:candidate?.asset??null,proof:candidate?.proof??null,issue,retryBlocker})
  }
  return {buildId:build.id,buildRevision:build.stateRevision,items}
}

/** Applies only actually adopted choices into an editable stage proposal. */
export async function configureAvgChosenMediaDraftV2(input: { scope: WorkspaceScope; productionId: number; expectedDraftRevision: number }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId) throw new Error('[avg-media] 编辑草稿或制作指针已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (!build?.id || brief?.avgAssembly?.version !== 2 || build.previewHash) throw new Error('[avg-media] 当前版本不能配置生成媒资')
  if (canonicalProductProductionJsonV2(workspace.mediaBatch ?? null) !== canonicalProductProductionJsonV2(brief.avgAssembly.mediaBatch)) throw new Error('[avg-media] 草稿需求与冻结批次已不一致')
  const source = await readAvgMediaChoicesForConfigurationV2({ scope: input.scope, buildId: build.id, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })
  await readAvgInheritedStageImagesV1({scope:input.scope,payload:workspace.presentation,productionKey:details.production.productionKey,
    targetBuildNumber:build.buildNumber,worldContentHash:brief.source.worldContentHash})
  const next = await applyAvgMediaChoicesToDraftV1({ workspace, batch: brief.avgAssembly.mediaBatch, choices: (source.mediaChoices ?? []).map(choice => choice.payload) })
  return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, next)
}

function runtimeMediaKeys(workspace: ReturnType<typeof parseAvgAuthorWorkspaceV1>) {
  return [...new Set([...workspace.presentation.stage.assets.map(asset => asset.assetKey),
    ...(workspace.mediaBatch?.requirements.filter(r => r.consumer.domain !== 'reference').map(r => r.assetKey) ?? [])])]
}

async function assemblyExecutionOptions(scope: WorkspaceScope, brief: ProductProductionBriefV3, buildId?: number) {
  const mediaCapabilities = new Map<string, ResolvedProductMediaCapabilityV1>()
  if (brief.avgAssembly?.version !== 2) return { mediaCapabilities, capabilityBindings: [] }
  const a = brief.avgAssembly
  const binding = { requirementKey: a.imageBinding.requirementKey, adapterId: a.imageBinding.adapterId, bindingHash: a.imageBinding.bindingHash }
  if(a.imageRecovery?.rerunRequirementKeys.length===0)return {mediaCapabilities,capabilityBindings:[binding]}
  // Finished images can be compiled offline. A fresh/pending dispatch must
  // resolve and match the exact author-confirmed non-secret route identity.
  let received = buildId !== undefined
  if (buildId !== undefined) for (const r of a.mediaBatch.requirements) {
    const rows = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([buildId, avgRawMediaArtifactKeyV1(r.requirementKey)])
      .filter(row => row.status === 'accepted').toArray()
    if (rows.length !== 1) { received = false; break }
    try { await verifyAcceptedProductBuildArtifactV1({ scope, buildId, artifactKey: rows[0]!.artifactKey, version: rows[0]!.version, contentHash: rows[0]!.contentHash }) }
    catch { received = false; break }
  }
  if (received) return { mediaCapabilities, capabilityBindings: [binding] }
  if (!avgMediaProductionEnabledV2()) throw new Error('[avg-media] 实验性图片生产尚未启用；已有回执和候选仍可读取')
  const configured = await resolveAvgImageExecutionCapabilityV2({ projectId: scope.projectId, requirement: brief.capabilityRequirements[0]! })
  if (configured.binding.bindingHash !== binding.bindingHash || configured.endpointRouteHash !== a.imageBinding.endpointRouteHash) throw new Error('[avg-media] Agnes 图片路由已变化，请重新核对制作方案')
  mediaCapabilities.set(binding.requirementKey, configured.resolved)
  return { mediaCapabilities, capabilityBindings: [binding], avgImageEndpointRouteHash: configured.endpointRouteHash }
}

export async function readAvgAssemblyWorkspaceV1(scope: WorkspaceScope, selectedProductionId?: number | null) {
  const draft = await readAvgDraftV1(scope)
  if (selectedProductionId && draft.productionId && selectedProductionId !== draft.productionId) throw new Error('[avg] 当前草稿属于另一制作记录，请返回作品库选择准确版本')
  const productionId = selectedProductionId ?? draft.productionId
  const details = productionId ? await readProductProductionDetailsV1(scope,productionId,['avg']) : null
  if (details?.brief && !parseProductProductionBriefV3(details.brief.briefJson).avgAssembly) throw new Error('[avg] 此记录使用旧版制作流程；请在新 AVG 作品中试用系统组装')
  const artifacts = []
  if (details?.build?.planRevision && details.executionBrief) {
    // A reviewable revision Brief can coexist with the previous immutable Build.
    // Its task/media domains must never be used to reinterpret that old Plan.
    const frozenBrief = details.briefHistory.find(row=>row.revision===details.build!.briefRevision&&row.briefHash===details.build!.briefHash)
    if(!frozenBrief||frozenBrief.status!=='authorized')throw new Error('[avg] 当前 Build 缺少准确的已授权方案')
    const plan = parseProductProductionPlanV3(details.build.planJson,parseProductProductionBriefV3(frozenBrief.briefJson),details.build.briefHash)
    const keys = [...plan.tasks.filter(task=>task.executionMode==='human-import'||['avg-media-image-generate','avg-media-image-reuse'].includes(task.kind)).flatMap(task=>task.outputArtifactKeys),'runtime.package','quality.report']
    for (const key of keys) {
      const accepted = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([details.build.id!,key])
        .filter(row=>row.status==='accepted'&&row.controlEpoch===details.build!.controlEpoch).limit(2).toArray()
      const pending = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([details.build.id!,key]).reverse()
        .filter(row=>row.status==='pending'&&row.controlEpoch===details.build!.controlEpoch).limit(1).toArray()
      for (const row of [...accepted,...pending]) if (!await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'})) throw new Error('[avg] 作者输入跨作品')
      artifacts.push(...accepted,...pending)
    }
  }
  return { draft,details,artifacts,media:await listAvgDraftMediaV1(scope) }
}

export async function confirmAvgWorkspaceInputV1(input: { scope: WorkspaceScope; productionId: number; artifactKey: string; candidateVersion: number; candidateHash: string }) {
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.build || !details.executionBrief?.avgAssembly) throw new Error('[avg] 当前制作缺少作者组装 Build')
  const result = await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'adopt-avg-artifact',
    commandId:commandId('confirm'),expectedStateRevision:details.production.stateRevision,expectedBuildRevision:details.build.stateRevision,
    buildNumber:details.build.buildNumber,controlEpoch:details.build.controlEpoch,artifactKey:input.artifactKey,candidateVersion:input.candidateVersion,candidateHash:input.candidateHash}})
  if (!result.ok) throw new Error(String(result.result.message??result.errorCode))
  return result
}

async function expectedBaselinePackageHash(details: ProductProductionDetailsV1) {
  if (!details.build) return null
  const targetNumber = Math.max(...details.buildHistory.map(build=>build.buildNumber)) + 1
  const selected = selectProductBuildCompatibilityBaselineV1({ currentBuildNumber:targetNumber,parentBuildNumber:details.build.buildNumber,priorBuilds:details.buildHistory })
  if (!selected) return null
  const build = details.buildHistory.find(build=>build.id===selected.id)!
  const preview = await verifyStoredProductBuildPreview(build)
  if (!preview || !build.rootTerminalReceiptHash) throw new Error('[avg] 修订基线缺少可验证的正式组装回执')
  return preview.packageHash
}

/** Prepare a reviewable Brief only. User start and per-artifact adoption remain explicit. */
export async function prepareAvgAssemblyBriefV1(input: { scope: WorkspaceScope; expectedDraftRevision: number; imageRecovery?:AvgImageRecoveryV1 }) {
  let draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg] 编辑草稿已变化，请刷新后再准备方案')
  let workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (workspace.mediaBatch) {
    await validateAvgVisualProductionBatchSourceV1(workspace.mediaBatch, workspace)
    if (!avgMediaProductionEnabledV2()) throw new Error('[avg-media] 媒资生产流程尚未开放；不能把待生成批次按零调用组装执行')
    assertAvgMediaConsumerDeclarationsV1(workspace.mediaBatch, workspace.systemPlan)
    for(const r of workspace.mediaBatch.requirements)await validateAvgGeneratedReferencesV1(input.scope,r.references,r.family)
  }
  if (!draft.worldReleaseId) throw new Error('[avg] 请先在产品定向选择冻结世界版本')
  const work = await db.works.get(input.scope.workId)
  if (!work || work.kind !== 'avg' || !await assertRecordInScope(input.scope,'works',work,{owner:'work'})) throw new Error('[avg] 当前作品不是 AVG')
  const mediaCapability: ProviderCapabilityRequirementV1 | null = workspace.mediaBatch ? {
    requirementKey: 'avg.media.image', mediaClass: 'image', operation: 'generate', adapterFamily: 'agnes', minimumCapabilityVersion: '1',
    allowedDataClasses: avgVisualProductionDataClassesV2({ mediaBatch: workspace.mediaBatch }), maximumRequestCost: null, maximumTotalCost: null,
    rightsPolicyVersion: 'storyforge-avg-image-rights.v1', capabilityHash: await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V1), required: true,
  } : null
  const recovery=input.imageRecovery&&workspace.mediaBatch?parseAvgImageRecoveryV1(input.imageRecovery,workspace.mediaBatch):null
  if(input.imageRecovery&&!recovery)throw new Error('[avg-media] 恢复缺少准确图片批次')
  let retainedBinding: import('./assembly-contract').AvgAssemblyBriefV2['imageBinding']|null=null
  if(recovery){
    if(!draft.productionId)throw new Error('[avg-media] 恢复缺少当前制作记录')
    const current=await readProductProductionDetailsV1(input.scope,draft.productionId,['avg']),old=current.executionBrief?.avgAssembly
    if(!current.build||current.build.buildNumber!==recovery.sourceBuildNumber||current.build.stateRevision!==recovery.sourceBuildRevision
      ||current.build.previewHash||old?.version!==2||canonicalProductProductionJsonV2(old.mediaBatch)!==canonicalProductProductionJsonV2(workspace.mediaBatch))throw new Error('[avg-media] 恢复来源或草稿批次已变化')
    retainedBinding=old.imageBinding
    await validateAvgImageRecoveryV1({scope:input.scope,productionId:draft.productionId,brief:{...current.executionBrief!,avgAssembly:{...old,imageRecovery:recovery}}})
  }
  const configured = mediaCapability&&(!recovery||recovery.rerunRequirementKeys.length>0) ? await resolveAvgImageExecutionCapabilityV2({ projectId: input.scope.projectId, requirement: mediaCapability }) : null
  const imageBinding=configured?{...configured.binding,endpointRouteHash:configured.endpointRouteHash}:retainedBinding
  if(recovery&&canonicalProductProductionJsonV2(imageBinding)!==canonicalProductProductionJsonV2(retainedBinding))throw new Error('[avg-media] 图片路由已改变，不能在同一恢复中复用旧原图')
  let productionId = draft.productionId
  let basePackageHash: string | null = null
  if (productionId != null) {
    const details = await readProductProductionDetailsV1(input.scope,productionId,['avg'])
    if (details.build) {
      const old = details.executionBrief
      const frozenSource=details.briefHistory.find(row=>row.revision===details.build!.briefRevision&&row.briefHash===details.build!.briefHash)
      const reference=(await listWorldReferenceCatalogV1(input.scope)).find(entry=>entry.reference.localReleaseRecordId===draft.worldReleaseId)?.reference
      if (!old?.avgAssembly || !frozenSource || frozenSource.sourceWorldReleaseId!==draft.worldReleaseId || !reference
        ||reference.releaseHash!==old.source.worldContentHash||frozenSource.sourceWorldContentHash!==reference.releaseHash) throw new Error('[avg] 当前修订不能替换产品协议或世界来源')
      const pending = details.production.status === 'brief-ready' && details.brief?.revision !== details.build.briefRevision
        ? parseProductProductionBriefV3(details.brief!.briefJson) : null
      if (details.build.previewHash) {
        if (workspace.basePreviewHash !== details.build.previewHash) throw new Error('[avg] 修订基线已变化，请读取准确预览后再创建新 Build')
        const preview = await verifyStoredProductBuildPreview(details.build)
        if (!preview) throw new Error('[avg] 修订基线缺少正式预览')
        basePackageHash = preview.packageHash
      } else {
        if (!['cancelled','failed','recovery-required'].includes(details.build.status)) throw new Error('[avg] 当前制作仍在执行；请先停止并保留记录，再准备新 Build')
        if(workspace.mediaBatch&&!recovery)await assertAvgKnownImageRetriesV1(input.scope,details.build,workspace.mediaBatch.requirements.map(r=>r.requirementKey))
        basePackageHash = await expectedBaselinePackageHash(details)
      }
      const inherited=await prepareAvgInheritedStageDraftV1({scope:input.scope,workspace,build:details.build,
        productionKey:details.production.productionKey,targetBuildNumber:Math.max(...details.buildHistory.map(row=>row.buildNumber))+1,worldContentHash:old.source.worldContentHash})
      if (!pending) await beginProductProductionEvolutionV1({ scope:input.scope,productionId,expectedStateRevision:details.production.stateRevision,
        userText:'作者修订 AVG 系统、对白、演出和媒资，生成新预览并保留旧版本及存档',affectedLanes:['content','product','visual','audio'] })
      if(canonicalProductProductionJsonV2(inherited)!==canonicalProductProductionJsonV2(workspace)){
        draft=await saveAvgAuthorWorkspaceV1(input.scope,draft.revision,inherited);workspace=inherited
      }
    }
  } else {
    const created = await executeProductProductionCommand({ scope:input.scope,command:{ type:'create-intent',commandId:commandId('intent'),
      productionKey:`avg.assembly.${crypto.randomUUID()}`,productType:'avg',worldReleaseId:draft.worldReleaseId,userText:'作者组装 AVG 系统与表现' } })
    if (!created.ok) throw new Error(String(created.result.message ?? created.errorCode))
    productionId = created.productionId
    await bindAvgDraftProductionV1(input.scope,draft.revision,productionId)
  }
  const details = await readProductProductionDetailsV1(input.scope,productionId,['avg'])
  const priorBrief = details.brief ? parseProductProductionBriefV3(details.brief.briefJson) : null
  const sourceBrief = priorBrief ?? await (async () => {
    const suggestions = await suggestProductStartingPoints({ scope:input.scope,worldReleaseId:draft.worldReleaseId! })
    if (!suggestions.suggestions[0]) throw new Error('[avg] 当前来源没有可用定向入口')
    return draftProductProductionBriefV3({ scope:input.scope,worldReleaseId:draft.worldReleaseId!,
      suggestionKey:suggestions.suggestions[0].suggestionKey,productType:'avg',scale:'scene',visualLevel:'none',audioLevel:'none',requiredFacts:[],forbiddenChanges:['源世界只读'] })
  })()
  const assets = workspace.presentation.stage.assets
  const brief = parseProductProductionBriefV3({ ...sourceBrief,
    // A portable Brief retains its original hash/host IDs. A new explicit
    // child uses the registry-remapped host locator to the same frozen hash.
    source:{...sourceBrief.source,worldReleaseId:draft.worldReleaseId},
    scale:{...sourceBrief.scale,scope:'scene',targetWordCount:workspace.scripts.flatMap(script=>script.lines).reduce((sum,line)=>sum+line.text.length,0),
      targetEndingCount:workspace.systemPlan.scenes.filter(scene=>scene.kind==='ending').length},
    media:{visualLevel:assets.some(asset=>asset.mimeType.startsWith('image/'))||workspace.mediaBatch?'key-scenes':'none',audioLevel:assets.some(asset=>asset.mimeType.startsWith('audio/'))?'full':'none',
      imageCount:assets.filter(asset=>asset.mimeType.startsWith('image/')).length+(workspace.mediaBatch?.requirements.length??0),musicTrackCount:assets.filter(asset=>['bgm','ambience'].includes(asset.kind)).length,
      sfxCount:assets.filter(asset=>asset.kind==='sfx').length,voiceLineCount:assets.filter(asset=>asset.kind==='voice').length,
      requiredMediaKinds:[...new Set([...assets.map(asset=>asset.kind),...(workspace.mediaBatch?.requirements.map(r=>r.mediaKind)??[])])]},
    intent:{ ...sourceBrief.intent,openingSituation:'作者确认的系统、固定文本与合法媒资联合预览',coreExperience:['作者编辑、明确确认、确定性组装和试玩'] },
    ...(priorBrief?.evolution ? { evolution:priorBrief.evolution } : {}),
    avgAssembly:{ schema:'storyforge.avg.assembly-brief',version:workspace.mediaBatch?2:1,title:work.title,sceneKeys:workspace.systemPlan.scenes.map(scene=>scene.key),
      mediaAssetKeys:runtimeMediaKeys(workspace),basePackageHash, ...(workspace.mediaBatch ? { mediaBatch: workspace.mediaBatch,
        imageBinding:imageBinding!,...(recovery?{imageRecovery:recovery}:{}) } : {}) },
    qualityProfile:'prototype',capabilityRequirements:mediaCapability?[mediaCapability]:[],
    consultationBudget:{maximumModelCalls:0,maximumInputTokens:0,maximumOutputTokens:0,maximumCostUsd:0},
    productionBudget:workspace.mediaBatch ? avgVisualProductionBudgetV2(workspace.mediaBatch.requirements.length,null,recovery?.retained.length??0) : { ...sourceBrief.productionBudget,maximumModelCalls:0,maximumInputTokens:100_000,maximumOutputTokens:0,maximumMediaCalls:0,
      maximumCostUsd:0,maximumDurationMs:180_000,maximumStorageBytes:64*1024*1024 },
    ...(workspace.mediaBatch ? { externalDataPolicy: { ...sourceBrief.externalDataPolicy, allowedDataClasses: [...new Set([...sourceBrief.externalDataPolicy.allowedDataClasses, ...mediaCapability!.allowedDataClasses])],
      allowReferenceImages: workspace.mediaBatch.requirements.some(r => r.references.length > 0), allowVoiceScripts: false },
      fallbackPolicy: { allowTextOnly: false, allowExistingProjectMedia: true, allowProceduralAudio: false, onRequiredCapabilityMissing: 'pause' } } : {}),
    completionContract:{ requiresPlayablePreview:true,requiredGateIds:workspace.mediaBatch ? avgMediaAssemblyGateIdsV2(workspace.mediaBatch) : [...AVG_ASSEMBLY_GATE_IDS_V1],minimumMediaCoverage:1,allowSoftWaivers:false },
    unresolvedDecisionKeys:[] })
  const saved = await executeProductProductionCommand({ scope:input.scope,productionId,command:{ type:'save-brief-revision',commandId:commandId('brief'),
    expectedStateRevision:details.production.stateRevision,parentRevision:details.brief?.revision ?? null,brief } })
  if (!saved.ok) throw new Error(String(saved.result.message ?? saved.errorCode))
  return readProductProductionDetailsV1(input.scope,productionId,['avg'])
}

export async function startAvgAssemblyV1(input: { scope: WorkspaceScope; productionId: number; expectedBriefHash: string }) {
  let details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  const brief = details.brief ? parseProductProductionBriefV3(details.brief.briefJson) : null
  if (!brief?.avgAssembly || details.brief!.briefHash !== input.expectedBriefHash) throw new Error('[avg] 制作方案已变化，请重新核对')
  const draft=await readAvgDraftV1(input.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (workspace.mediaBatch && brief.avgAssembly.version === 1) throw new Error('[avg-media] 草稿已包含待生成媒资批次，请重新准备匹配的制作方案')
  if (brief.avgAssembly.version === 2) {
    if(!avgMediaProductionEnabledV2())throw new Error('[avg-media] 实验性图片生产尚未启用')
    if (canonicalProductProductionJsonV2(workspace.mediaBatch ?? null) !== canonicalProductProductionJsonV2(brief.avgAssembly.mediaBatch)) throw new Error('[avg-media] 媒资批次已变化，请重新核对制作方案')
    await validateAvgVisualProductionBatchSourceV1(brief.avgAssembly.mediaBatch, workspace)
    assertAvgMediaConsumerDeclarationsV1(brief.avgAssembly.mediaBatch, workspace.systemPlan)
    await validateAvgImageRecoveryV1({scope:input.scope,productionId:input.productionId,brief})
    for(const r of brief.avgAssembly.mediaBatch.requirements)await validateAvgGeneratedReferencesV1(input.scope,r.references,r.family)
  }
  const same=(a:string[],b:string[])=>canonicalProductProductionJsonV2([...a].sort())===canonicalProductProductionJsonV2([...b].sort())
  if(draft.productionId!==input.productionId||draft.worldReleaseId!==brief.source.worldReleaseId
    ||!same(brief.avgAssembly.sceneKeys,workspace.systemPlan.scenes.map(scene=>scene.key))
    ||!same(brief.avgAssembly.mediaAssetKeys,runtimeMediaKeys(workspace))) throw new Error('[avg] 场景、媒资或来源清单已变化，请重新准备制作方案')
  if (brief.avgAssembly.basePackageHash !== await expectedBaselinePackageHash(details)) throw new Error('[avg] 组装修订基线与实际 Build 谱系不一致，请重新准备方案')
  const execution = await assemblyExecutionOptions(input.scope, brief)
  await authorizeProductProductionStartV1({ scope:input.scope,details })
  details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  // Freezes the real shared Plan/root and waits for manual inputs; never runs a provider.
  await runProductProductionSchedulerCycleV1({ scope:input.scope,productionId:input.productionId,
    ...execution, executor:createConfiguredProductProductionExecutorV1({ production:details.production,brief,...execution }) })
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}

/** Staging and confirmation are separate UI actions; payload is always from a saved draft. */
export async function stageAvgWorkspaceInputV1(input: { scope: WorkspaceScope; productionId: number; expectedDraftRevision: number; artifactKey: string; declaration: string }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId) throw new Error('[avg] 草稿或制作指针已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.build || !details.executionBrief?.avgAssembly) throw new Error('[avg] 请先明确开始作者组装')
  const plan = JSON.parse(details.build.planJson) as { tasks:Array<{taskKey:string;outputArtifactKeys:string[]}> }
  const task = plan.tasks.find(task=>task.outputArtifactKeys.includes(input.artifactKey))
  if (!task) throw new Error('[avg] 输入不在冻结写域')
  const payload = input.artifactKey === 'avg.system.plan' ? workspace.systemPlan : input.artifactKey === 'avg.author.stage' ? workspace.presentation
    : workspace.scripts.find(script=>`avg.content.scene-script.${script.sceneKey}` === input.artifactKey)
  if (!payload) throw new Error('[avg] 已保存草稿中不存在该输入')
  return stageAvgAuthorArtifactV1({ scope:input.scope,buildId:details.build.id!,expectedBuildRevision:details.build.stateRevision,
    controlEpoch:details.build.controlEpoch,taskKey:task.taskKey,artifactKey:input.artifactKey,
    kind:input.artifactKey === 'avg.system.plan' ? 'product-module' : input.artifactKey === 'avg.author.stage' ? 'presentation' : 'narrative',payload,declaration:input.declaration })
}

export async function runAvgAssemblyV1(input: { scope: WorkspaceScope; productionId: number; signal?: AbortSignal }) {
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.executionBrief?.avgAssembly || !details.build || !['authorized','building','integrating'].includes(details.build.status)) throw new Error('[avg] 当前 Build 不可组装')
  const execution = await assemblyExecutionOptions(input.scope, details.executionBrief, details.build.id!)
  return runProductProductionUntilBlockedV1({ ...input, ...execution, executor:createConfiguredProductProductionExecutorV1({ production:details.production,brief:details.executionBrief,...execution }) })
}

/** Creates a reviewable child Brief only. Start, each choice and stage adoption
 * remain separate. Retained rows never become fake imported-media entries. */
export async function prepareAvgImageRecoveryBriefV1(input:{scope:WorkspaceScope;productionId:number;expectedDraftRevision:number;expectedBuildId:number;
  expectedBuildRevision:number;retainedRequirementKeys:string[];declaration:string}){
  const draft=await readAvgDraftV1(input.scope),details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId||details.build?.id!==input.expectedBuildId)throw new Error('[avg-media] 恢复草稿或当前 Build 已变化')
  const {recovery}=await prepareAvgImageRecoveryV1(input)
  return prepareAvgAssemblyBriefV1({scope:input.scope,expectedDraftRevision:input.expectedDraftRevision,imageRecovery:recovery})
}

/** Explicit restart for unsealed attempts; the old Run, inputs and failures remain. */
export async function restartAvgAssemblyFromDraftV1(input: { scope: WorkspaceScope; productionId: number; expectedBuildId: number; expectedDraftRevision: number }) {
  const draft=await readAvgDraftV1(input.scope)
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId)throw new Error('[avg] 编辑草稿或制作指针已变化')
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if(!details.executionBrief?.avgAssembly||details.build?.id!==input.expectedBuildId||details.build.previewHash)throw new Error('[avg] 当前版本不能按未封存组装重建')
  if(!['cancelled','failed'].includes(details.build.status))await stopProductProductionV1({scope:input.scope,production:details.production})
  return prepareAvgAssemblyBriefV1({scope:input.scope,expectedDraftRevision:input.expectedDraftRevision})
}
