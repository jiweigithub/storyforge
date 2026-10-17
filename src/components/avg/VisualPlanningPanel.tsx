import { useCallback, useEffect, useState } from 'react'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { confirmAvgWorkspaceInputV1 } from '../../lib/avg/assembly-service'
import { avgVisualPlanningExecutionReadyV4 } from '../../lib/avg/visual-planning-brief'
import { stageAvgVisualPlanningAuthorInputV4, refuseAvgVisualPlanningBatchV4, type AvgVisualPlanningDraftV4 } from '../../lib/avg/visual-planning-workspace'
import type { AvgVisualBibleV1, AvgMediaBriefV1 } from '../../lib/avg/visual-planning-contract'
import { parseAvgMediaReferencesV1 } from '../../lib/avg/media-reference-contract'

type View = Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Semantic = AvgVisualBibleV1 | AvgMediaBriefV1
const list = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean)

function ProposalCard({scope,view,proposal,workspace,disabled,declaration,onAction,onReload,onNotice,onPending}: {
  scope:WorkspaceScope;view:View;proposal:ProductBuildArtifactRecordV1;workspace:AvgAuthorWorkspaceV1;disabled:boolean;declaration:string;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>;onNotice:(text:string)=>void;onPending:(key:string,value:boolean)=>void
}) {
  const original = JSON.parse(proposal.payloadJson) as {targetArtifactKey:string;payload:Semantic}
  const [value,setValue]=useState<Semantic>(()=>{
    const saved=view.artifacts.filter(a=>a.artifactKey===original.targetArtifactKey&&['accepted','pending'].includes(a.status)).sort((a,b)=>b.version-a.version)[0]
    return saved?JSON.parse(saved.payloadJson):structuredClone(original.payload)
  }),[changed,setChanged]=useState(false)
  const [reviewed,setReviewed]=useState(false),[reason,setReason]=useState('')
  const build=view.details!.build!,productionId=view.details!.production.id!,key=original.targetArtifactKey
  const accepted=view.artifacts.find(a=>a.artifactKey===key&&a.status==='accepted')
  const pending=view.artifacts.filter(a=>a.artifactKey===key&&a.status==='pending'&&a.version>(accepted?.version??0)).sort((a,b)=>b.version-a.version)[0]
  const candidateHash=pending?String(JSON.parse(pending.metadataJson).candidateHash??''):''
  const canEdit=build.status==='building'&&view.details!.production.status==='producing'&&!accepted
  const label=value.schema==='storyforge.avg.visual-bible'?'视觉基准':`场景方案：${workspace.systemPlan.scenes.find(s=>s.key===value.subjectKey)?.title??'已确认主体'}`
  useEffect(()=>{setReviewed(false)},[candidateHash])
  useEffect(()=>{onPending(key,changed||!!reason.trim());return()=>onPending(key,false)},[changed,reason,key,onPending])
  const change=(update:(next:Semantic)=>void)=>{const next=structuredClone(value);update(next);setValue(next);setChanged(true);setReviewed(false)}
  const selection={scope,productionId,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,artifactKey:key,
    proposal:{artifactKey:proposal.artifactKey,version:proposal.version,contentHash:proposal.contentHash}}
  return <article className="avg-input-card" aria-label={`专业方案：${label}`}><h5>{label}</h5>
    <p>{accepted?'此方案已明确采用。':pending?'已有待确认版本，请核对后采用。':'原始方案已接收，尚未采用。'} 原始内容与作者修订分别保留。</p>
    <details><summary>查看原始方案内容</summary>{original.payload.schema==='storyforge.avg.visual-bible'?<><p>{Object.values(original.payload.style).map(v=>Array.isArray(v)?v.join('、'):v).join('；')}</p>{original.payload.subjects.map(s=><p key={s.subjectKey}>保持：{s.identityInvariants.join('；')}。允许变化：{s.allowedChanges.join('；')}。不表现：{s.forbiddenDepictions.join('；')}</p>)}</>:<><p>{original.payload.designIntent}</p>{original.payload.outputs.map(o=><p key={o.requirementKey}>{o.prompt}；保持：{o.invariants.join('；')}；排除：{[o.negativePrompt,...o.forbiddenDepictions].filter(Boolean).join('；')}</p>)}</>}</details>
    <fieldset className="avg-form" disabled={disabled||!canEdit}>
      {value.schema==='storyforge.avg.visual-bible'?<>
        {(['medium','rendering','lighting','composition'] as const).map((field,i)=><label key={field}>{['画面媒介','绘制方式','光照方向','构图与留白'][i]}<textarea value={value.style[field]} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.visual-bible')p.style[field]=e.target.value})}/></label>)}
        <label>主配色（每行一项）<textarea value={value.style.palette.join('\n')} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.visual-bible')p.style.palette=list(e.target.value)})}/></label>
        {value.subjects.map((subject,i)=><fieldset key={subject.subjectKey}><legend>主体：{workspace.systemPlan.scenes.find(s=>s.key===subject.subjectKey)?.title??workspace.systemPlan.characters.find(c=>c.key===subject.subjectKey)?.displayName??'已确认主体'}</legend>
          {(['identityInvariants','allowedChanges','forbiddenDepictions'] as const).map((field,j)=><label key={field}>{['主体保持项','主体允许变化','主体不得表现的信息'][j]}（每行一项）<textarea value={subject[field].join('\n')} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.visual-bible')p.subjects[i][field]=list(e.target.value)})}/></label>)}
        </fieldset>)}
      </>:<>
        <label>设计意图<textarea value={value.designIntent} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.designIntent=e.target.value})}/></label>
        {value.outputs.map((output,i)=>{const template=view.details!.executionBrief!.avgVisualPlanning!.scope.templates.find(t=>t.parameters.requirementKey===output.requirementKey)!;return <fieldset key={output.requirementKey}><legend>{template.parameters.name}</legend>
          <label>生成画面要求<textarea value={output.prompt} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.outputs[i].prompt=e.target.value})}/></label>
          <label>排除画面<textarea value={output.negativePrompt} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.outputs[i].negativePrompt=e.target.value})}/></label>
          {(['invariants','forbiddenDepictions'] as const).map((field,j)=><label key={field}>{['本图保持项','本图不得表现的信息'][j]}（每行一项）<textarea value={output[field].join('\n')} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.outputs[i][field]=list(e.target.value)})}/></label>)}
          <p>用途、尺寸和参考权限来自已确认制作方案，本卡只能修改画面设计。</p>
        </fieldset>})}
      </>}
      <button className="lf-action" disabled={!declaration.trim()} onClick={()=>void onAction(async()=>{await stageAvgVisualPlanningAuthorInputV4({...selection,payload:value,declaration});setChanged(false);await onReload();onNotice('方案已保存为待确认版本；尚未采用或发送图片请求。')})}>保存待确认：{label}</button>
      {pending&&<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已核对本方案内容及允许参考</label><button className="lf-action" disabled={changed||!reviewed} onClick={()=>void onAction(async()=>{await confirmAvgWorkspaceInputV1({scope,productionId,artifactKey:key,candidateVersion:pending.version,candidateHash});setReason('');await onReload();onNotice('该准确方案已采用；下一步仍需明确执行。')})}>确认采用：{label}</button></>}
      <label>退回依据<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="lf-action" disabled={!reason.trim()} onClick={()=>void onAction(async()=>{await refuseAvgVisualPlanningBatchV4({...selection,reason});setChanged(false);setReason('');await onReload();onNotice('已记录退回依据并停止本批；原方案、账单和图片均保留，不会自动重发。')})}>退回此方案并停止本批</button>
    </fieldset>
    {changed&&<button className="lf-action" disabled={disabled} onClick={()=>{setValue(structuredClone(original.payload));setChanged(false)}}>撤销本卡未保存修改</button>}
    {!!reason.trim()&&<button className="lf-action" disabled={disabled} onClick={()=>setReason('')}>撤销未提交的退回依据</button>}
  </article>
}

export default function VisualPlanningPanel({scope,view,workspace,disabled,activeBuild,sourcesReady,declaration,generating,onAction,onPrepare,onGenerate,onCancel,onReload,onNotice,onPending}: {
  scope:WorkspaceScope;view:View;workspace:AvgAuthorWorkspaceV1;disabled:boolean;activeBuild:boolean;sourcesReady:boolean;declaration:string;generating:boolean;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onPrepare:(value:AvgVisualPlanningDraftV4)=>Promise<void>;onGenerate:()=>Promise<void>;onCancel:()=>void;
  onReload:()=>Promise<void>;onNotice:(text:string)=>void;onPending:(pending:boolean)=>void
}) {
  const brief=view.details?.brief?parseProductProductionBriefV3(view.details.brief.briefJson):null
  const planning=brief?.avgVisualPlanning,prepared=planning?.scope,first=prepared?.templates[0]
  const [sceneKey,setSceneKey]=useState(first?.parameters.consumer.sceneKey??workspace.systemPlan.entrySceneKey)
  const [details,setDetails]=useState(first?.requiredDetails.join('\n')??''),[forbidden,setForbidden]=useState(first?.forbiddenDepictions.join('\n')??'不得新增未确认的剧情秘密')
  const [referenceKey,setReferenceKey]=useState(prepared?.referenceCatalog[0]?.reference.assetKey??''),[allowedChange,setAllowedChange]=useState(prepared?.referenceCatalog[0]?.reference.allowedChange??''),[external,setExternal]=useState(false),[derivative,setDerivative]=useState(false)
  const [edited,setEdited]=useState(false),[cardsPending,setCardsPending]=useState<Record<string,boolean>>({}),[editPrepared,setEditPrepared]=useState(false)
  const pendingCards=Object.values(cardsPending).some(Boolean)
  const enabled=avgVisualPlanningExecutionReadyV4(),scene=workspace.systemPlan.scenes.find(s=>s.key===sceneKey)
  const build=view.details?.build,closed=!!build&&!['authorized','building','integrating'].includes(build.status)
  const proposals=view.artifacts.filter(a=>a.artifactKey.startsWith('avg.proposal.')&&a.status==='accepted')
  const available=!workspace.mediaBatch&&!workspace.voiceProduction&&!workspace.imageProcessing&&!workspace.presentation.stage.assets.some(a=>!a.mimeType.startsWith('image/'))
  useEffect(()=>{onPending(edited||pendingCards);return()=>onPending(false)},[edited,pendingCards,onPending])
  const changed=()=>setEdited(true)
  const cardPending=useCallback((key:string,value:boolean)=>setCardsPending(old=>old[key]===value?old:{...old,[key]:value}),[])
  const prepare=async()=>{
    if(!scene)throw new Error('请选择已保存的场景')
    const trigger=workspace.scripts.find(s=>s.sceneKey===scene.key)?.lines[0]
    if(!trigger)throw new Error('请先保存该场景的对白')
    const id=crypto.randomUUID(),reference=view.media.items.map(r=>r.asset).find(a=>a.assetKey===referenceKey)
    if(referenceKey&&!reference)throw new Error('当前参考尚未读取或已变化，请重新选择准确参考，不能静默移除')
    const references=reference?parseAvgMediaReferencesV1([{assetKey:reference.assetKey,assetVersion:reference.version,contentHash:reference.contentHash,mimeType:reference.mimeType,
      byteSize:reference.byteSize,purpose:'style',allowedChange,dataClass:'avg-authorized-reference',license:reference.license,
      providerInputAllowed:external,derivativeUseAllowed:derivative,crop:null,mask:null}]):[]
    const keys=references.map(()=>`visual.reference.${id}`)
    await onPrepare({schema:'storyforge.avg.visual-planning-scope',version:1,batchKey:prepared?.batchKey??`visual.batch.${id}`,revision:(prepared?.revision??0)+1,
      templates:[{subjectKind:'environment',requiredDetails:list(details),forbiddenDepictions:list(forbidden),allowedReferenceKeys:keys,requiredReferenceKeys:keys,
        parameters:{requirementKey:`visual.background.${id}`,revision:1,assetKey:`avg.visual.${id}`,name:`${scene.title}背景`,altText:`${scene.title}场景背景`,
          family:{subjectKey:scene.key,familyKey:`visual.environment.${scene.key}`,variantKey:`base.${id}`,revision:1},
          consumer:{consumerKey:`visual.background.${id}`,domain:'stage',slot:'background',subjectKey:scene.key,sceneKey:scene.key,lineKey:null,required:true,fallback:'none'},
          triggerBeatKey:trigger.lineKey,itemVariantKey:null,mediaKind:'background',width:workspace.presentation.aspectRatio==='4:3'?640:576,height:workspace.presentation.aspectRatio==='4:3'?480:324,resolutionTier:'1K',alpha:'not-required'}}],
      referenceCatalog:references.map((reference,i)=>({referenceKey:keys[i],reference}))})
    setEdited(false);setEditPrepared(false)
  }
  if(!enabled&&!planning)return null
  return <section className="lf-paper" aria-label="专业视觉策划（实验）"><h4>专业视觉策划 <small>实验</small></h4>
    <p>先确认具体用途与合法参考，再由美术方向和场景设计岗位提出方案。采用后编译图片需求，每项最多请求一次；费用可能未知，图片返回后仍须单独评审、选用和确认演出。</p>
    {!planning&&<p>当前先接场景背景的完整流程；人物与物件专业家族另行扩展。原有手填图片与配音制作继续保留。</p>}
    {!available&&!planning&&<p>当前草稿已使用其他生成或声音方案。请保留该记录，通过原制作流程完成本批。</p>}
    {enabled&&available&&!activeBuild&&!build?.previewHash&&(!prepared||editPrepared)&&<fieldset className="avg-form" disabled={disabled||pendingCards}>
      <legend>准备专业场景背景</legend><label>专业策划的场景<select value={sceneKey} onChange={e=>{setSceneKey(e.target.value);changed()}}>{workspace.systemPlan.scenes.map(s=><option key={s.key} value={s.key}>{s.title}</option>)}</select></label>
      <label>必须呈现的场景细节（每行一项）<textarea value={details} onChange={e=>{setDetails(e.target.value);changed()}}/></label>
      <label>专业场景不得表现的信息（每行一项）<textarea value={forbidden} onChange={e=>{setForbidden(e.target.value);changed()}}/></label>
      <label>本次风格参考<select value={referenceKey} onChange={e=>{setReferenceKey(e.target.value);setExternal(false);setDerivative(false);changed()}}><option value="">不使用参考图</option>{view.media.items.filter(r=>r.asset.mimeType.startsWith('image/')).map(r=><option key={r.asset.assetKey} value={r.asset.assetKey}>{r.asset.name}</option>)}</select></label>
      {referenceKey&&<><label>参考允许改变的内容<textarea value={allowedChange} onChange={e=>{setAllowedChange(e.target.value);setExternal(false);setDerivative(false);changed()}}/></label>
        <label><input type="checkbox" checked={external} onChange={e=>{setExternal(e.target.checked);changed()}}/>我有权向本次图片供应商发送该参考</label>
        <label><input type="checkbox" checked={derivative} onChange={e=>{setDerivative(e.target.checked);changed()}}/>我有权用该参考进行本次衍生创作</label></>}
      <button className="lf-action" disabled={!details.trim()||!view.draft.editorJson||!view.draft.worldReleaseId||!!referenceKey&&(!external||!derivative||!allowedChange.trim())} onClick={()=>void onAction(prepare)}>准备专业视觉制作方案</button>
      {edited&&<button className="lf-action" onClick={()=>{setDetails(first?.requiredDetails.join('\n')??'');setForbidden(first?.forbiddenDepictions.join('\n')??'不得新增未确认的剧情秘密');setSceneKey(first?.parameters.consumer.sceneKey??workspace.systemPlan.entrySceneKey);setReferenceKey(prepared?.referenceCatalog[0]?.reference.assetKey??'');setAllowedChange(prepared?.referenceCatalog[0]?.reference.allowedChange??'');setExternal(false);setDerivative(false);setEdited(false);setEditPrepared(false)}}>撤销未保存的专业用途</button>}
    </fieldset>}
    {prepared&&<><p>已保存专业用途：{prepared.templates.map(t=>t.parameters.name).join('、')}；{prepared.referenceCatalog.length} 张授权参考。准备方案不会调用模型，须到制作页核对并明确开始。</p>
      <p>本批上限：{brief!.productionBudget.maximumModelCalls} 次方案调用、{brief!.productionBudget.maximumMediaCalls} 次图片请求。{view.visualProgress?`已记录 ${view.visualProgress.budget.usage.modelCalls} 次方案、${view.visualProgress.budget.usage.mediaCalls} 次图片调用；费用${view.visualProgress.budget.usage.costUsd===null?'未知':` $${view.visualProgress.budget.usage.costUsd}`}。`:'费用以实际回执为准。'}</p>
      {!activeBuild&&!build&&!edited&&<button className="lf-action" disabled={disabled} onClick={()=>setEditPrepared(true)}>修改尚未开始的专业用途</button>}
      {build&&<><p>模型方案与原始响应、用量和未知费用保存在本次制作记录中。刷新只读取记录；继续执行需要明确点击。</p>
        {!sourcesReady&&!closed&&<p>请先到制作页明确采用系统规则和全部场景脚本。</p>}
        {!closed&&<button className="lf-action lf-action-primary" disabled={!enabled||disabled||edited||pendingCards||!sourcesReady||!declaration.trim()} onClick={()=>void onGenerate()}>执行已确认的专业方案与图片任务</button>}
        {generating&&<button className="lf-action" onClick={onCancel}>停止等待并保留记录</button>}
        {proposals.map(proposal=><ProposalCard key={`${build.id}:${proposal.artifactKey}:${proposal.contentHash}`} {...{scope,view,proposal,workspace,declaration,onAction,onReload,onNotice}} disabled={!enabled||disabled||edited||closed} onPending={cardPending}/>)}
        {closed&&<p>本次制作已结束或暂停，方案与账单保留，当前不会自动调用。冻结预览可在制作页试玩。</p>}
      </>}
    </>}
  </section>
}
