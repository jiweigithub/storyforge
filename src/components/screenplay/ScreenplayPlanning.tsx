import { useEffect, useRef, useState } from 'react'
import type { AdaptationProject, AdaptationSourceUnit, WorkspaceScope } from '../../lib/types'
import { adoptAdaptationSourceFactsV1, adoptAdaptationCausalEdgesV1, adoptAdaptationDecisionsV1, listAdaptationAnalysisV1 } from '../../lib/adaptation/analysis'
import { confirmAdaptationBrief, saveAdaptationBriefDraft, updateScreenplayTargetSpecV1 } from '../../lib/adaptation/source-manifest'
import { adoptScreenplayBeatsV1, adoptScreenplaySceneCardsV1, listScreenplayProductionV1 } from '../../lib/screenplay/production'
import { readScreenplayAuthorDraft, saveScreenplayAuthorDraft } from '../../lib/screenplay/author-drafts'
import { queueCandidateDraftV1, flushCandidateDraftsV1 } from '../../lib/agent/candidate-draft-coordinator'
import { registerPendingDraftFlusherV1, flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { downloadJSON, exportProjectJSON } from '../../lib/export/json-export'
import { useDialog } from '../shared/Dialog'
import ScreenplayFields, { type FieldOption } from './ScreenplayFields'
export type PlanningStage = 'facts'|'edges'|'brief'|'decisions'|'beats'|'cards'|'settings'
const titles = {facts:'原作事实',edges:'因果关系',brief:'改编要求',decisions:'删改决定',beats:'结构与节拍',cards:'场次卡片',settings:'剧本与署名设置'}
const keys: Record<string,string[]> = {
 facts:['stableKey','kind','statement','subjectKeys','sourceUnitKeys','confidence'],edges:['stableKey','fromFactKey','toFactKey','relation','rationale','sourceUnitKeys'],decisions:['stableKey','action','sourceFactKeys','targetKeys','rationale'],
 beats:['stableKey','sectionKey','sectionTitle','scope','episodeNumber','order','objective','conflict','turn','outcome','causalFactKeys','decisionKeys','sourceUnitKeys','estimatedSeconds'],
 cards:['stableKey','beatKey','episodeNumber','sceneNumber','order','purpose','conflict','entryState','exitState','visibleAction','informationReveal','sourceUnitKeys','estimatedSeconds'],
}
export function emptyScreenplayBrief(){return {version:1,coreTheme:'',dominantEmotion:'',mustKeep:[],mayCut:[],mayMerge:[],mayReorder:[],allowedAdditions:[],audience:'中文观众',rating:'PG-13',targetScale:'电影',narrativePerspective:'跟随主人公',timeBudget:'',costLimit:'标准',deviationNotes:'',unresolvedQuestions:[],assumptions:[]}}
export default function ScreenplayPlanning({scope,root,units,stage,onChanged}:{scope:WorkspaceScope;root:AdaptationProject;units:AdaptationSourceUnit[];stage:PlanningStage;onChanged:()=>Promise<void>}){
 const [value,setValue]=useState<any>(null),[options,setOptions]=useState<Record<string,FieldOption[]>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false)
 const dialog=useDialog();const edit=useRef(0);const prefix=`screenplay:${scope.workId}:`;const draftKey=`planning:${stage}:r${root.revision}`
 useEffect(()=>registerPendingDraftFlusherV1(()=>flushCandidateDraftsV1(prefix)),[prefix])
 // Same-revision parent refreshes must not hide the editable form or discard newer input.
 useEffect(()=>{let cancelled=false;const initial=edit.current
 void Promise.all([listAdaptationAnalysisV1({scope,adaptationProjectId:root.id!}),listScreenplayProductionV1(scope),readScreenplayAuthorDraft(scope,draftKey)]).then(([a,p,saved])=>{
 if(cancelled||initial!==edit.current)return
 const facts=a.facts.filter(x=>x.authorStatus==='confirmed');const decisions=a.decisions.filter(x=>x.authorStatus==='confirmed')
 const factOptions=facts.map(x=>({value:x.stableKey,label:x.statement}));const sourceOptions=units.map(x=>({value:x.sourceUnitKey,label:x.label}));const cardOptions=p.sceneCards.map(x=>({value:x.stableKey,label:`第${x.episodeNumber}集 ${x.sceneNumber}场 · ${x.purpose}`}))
 setOptions({sourceUnitKeys:sourceOptions,sourceFactKeys:factOptions,causalFactKeys:factOptions,fromFactKey:factOptions,toFactKey:factOptions,decisionKeys:decisions.map(x=>({value:x.stableKey,label:x.rationale})),beatKey:p.beats.map(x=>({value:x.stableKey,label:x.sectionTitle+' · '+x.objective})),targetKeys:cardOptions})
 const collections:any={facts,edges:a.edges.filter(x=>x.authorStatus==='confirmed'),decisions,beats:p.beats,cards:p.sceneCards}
 const formal=stage==='brief'?(root.brief??emptyScreenplayBrief()):stage==='settings'?root.targetSpec:collections[stage].map((row:any)=>Object.fromEntries(keys[stage].map(key=>[key,row[key]])))
 setValue(saved?JSON.parse(saved):formal);setLoaded(true)
 }).catch(c=>setError(String(c)));return()=>{cancelled=true}
 },[scope,root,stage,draftKey,units])
 const change=(next:any)=>{edit.current++;setValue(next);queueCandidateDraftV1({key:prefix+draftKey,draft:JSON.stringify(next),debounceMs:250,persist:text=>saveScreenplayAuthorDraft(scope,draftKey,text),onError:c=>setError(c.message)})}
 const add=()=>{
 const id=crypto.randomUUID();const source=options.sourceUnitKeys?.[0]?.value;const fact=options.sourceFactKeys?.[0]?.value;const n=Array.isArray(value)?value.length:0
 const templates:any={facts:{stableKey:id,kind:'event',statement:'',subjectKeys:[],sourceUnitKeys:source?[source]:[],confidence:1},edges:{stableKey:id,fromFactKey:fact??'',toFactKey:options.sourceFactKeys?.[1]?.value??fact??'',relation:'cause',rationale:'',sourceUnitKeys:source?[source]:[]},decisions:{stableKey:id,action:'keep',sourceFactKeys:fact?[fact]:[],targetKeys:[],rationale:''},beats:{stableKey:id,sectionKey:'act-1',sectionTitle:'第一幕',scope:'act',episodeNumber:1,order:n,objective:'',conflict:'',turn:'',outcome:'',causalFactKeys:fact?[fact]:[],decisionKeys:options.decisionKeys?.[0]?[options.decisionKeys[0].value]:[],sourceUnitKeys:source?[source]:[],estimatedSeconds:60},cards:{stableKey:id,beatKey:options.beatKey?.[0]?.value??'',episodeNumber:1,sceneNumber:n+1,order:n,purpose:'',conflict:'',entryState:'',exitState:'',visibleAction:'',informationReveal:'',sourceUnitKeys:source?[source]:[],estimatedSeconds:60}}
 change([...(value??[]),templates[stage]])
 }
 const save=async()=>{setBusy(true);setError('');try{
 await flushPendingEditsV1();let allowReplaceDownstream=false
 if(stage==='facts'){
 const analysis=await listAdaptationAnalysisV1({scope,adaptationProjectId:root.id!})
 if(analysis.edges.length||analysis.decisions.length){
 if(!await dialog.confirm({title:'重新确认原作事实',message:'修改事实会清除依赖它的因果关系与删改决定，需要重新确认改编规划。已有剧本场景保留。',confirmText:'备份并确认'}))return
 await downloadJSON(await exportProjectJSON(scope.projectId),'原作事实修改前备份.json')
 }
 }
 if(['beats','cards'].includes(stage)){
 const p=await listScreenplayProductionV1(scope)
 // This confirmation backs up the complete project before the existing governed replacement transaction.
 if(p.sceneCards.length){if(!await dialog.confirm({title:'重新确认场次规划',message:'重新规划会替换相关场次与审查。先下载整个作品备份，再确认替换；已发布版本保留。',confirmText:'备份并替换'}))return;await downloadJSON(await exportProjectJSON(scope.projectId),'剧本重新规划前备份.json');allowReplaceDownstream=true}
 }
 const common={scope,adaptationProjectId:root.id!,expectedAdaptationRevision:root.revision,sourceManifestVersion:root.activeSourceManifestVersion}
 const items=Array.isArray(value)?value.map(candidate=>({candidate,authorStatus:'confirmed' as const})):[]
 if(stage==='facts')await adoptAdaptationSourceFactsV1({...common,items})
 else if(stage==='edges')await adoptAdaptationCausalEdgesV1({...common,items})
 else if(stage==='decisions')await adoptAdaptationDecisionsV1({...common,items})
 else if(stage==='brief'){const saved=await saveAdaptationBriefDraft({adaptationProjectId:root.id!,expectedRevision:root.revision,brief:value});await confirmAdaptationBrief({adaptationProjectId:root.id!,expectedRevision:saved.revision})}
 else if(stage==='settings')await updateScreenplayTargetSpecV1({scope,expectedRevision:root.revision,targetSpec:{...value,episodeCount:value.format==='film'?null:Number(value.episodeCount)||1}})
 else if(stage==='beats')await adoptScreenplayBeatsV1({...common,candidates:value,allowReplaceDownstream})
 else await adoptScreenplaySceneCardsV1({...common,candidates:value,allowReplaceDownstream})
 await onChanged()
 }catch(c){setError(String(c))}finally{setBusy(false)}}
 return <section className="sp-planning"><header><h3>{titles[stage]}</h3><p>填写或修改后确认。原作依据会随本次改编保存。</p></header>{error&&<p role="alert">{error}</p>}{!loaded?<p>读取内容…</p>:<fieldset disabled={busy||root.status==='complete'}><ScreenplayFields value={value} onChange={change} options={options}/>{Array.isArray(value)&&<button onClick={add}>添加{titles[stage]}</button>}<button className="primary" onClick={()=>void save()}>确认{titles[stage]}</button></fieldset>}</section>
}
