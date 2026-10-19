import { useEffect, useRef, useState } from 'react'
import type { AdaptationProject, AdaptationSourceUnit, WorkspaceScope } from '../../lib/types'
import { adoptAdaptationSourceFactsV1, adoptAdaptationCausalEdgesV1, adoptAdaptationDecisionsV1, listAdaptationAnalysisV1 } from '../../lib/adaptation/analysis'
import { confirmAdaptationBrief, saveAdaptationBriefDraft } from '../../lib/adaptation/source-manifest'
import { adoptComicScriptBeatsV1, adoptComicPagePlansV1, adoptComicVisualBibleV1, listComicProductionV1 } from '../../lib/comic/production'
import { readComicAuthorDraft, saveComicAuthorDraft } from '../../lib/comic/authoring'
import { listComicVisualSubjects } from '../../lib/comic/service'
import { COMIC_SCRIPT_BEAT_KEYS_V1, COMIC_PAGE_PLAN_KEYS_V1 } from '../../lib/comic/production-contracts'
import { queueCandidateDraftV1, flushCandidateDraftsV1 } from '../../lib/agent/candidate-draft-coordinator'
import { registerPendingDraftFlusherV1, flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { downloadJSON, exportProjectJSON } from '../../lib/export/json-export'
import { useDialog } from '../shared/Dialog'
import ComicFields, {type FieldOption} from './ComicFields'
export type ComicPlanningStage='facts'|'causal'|'brief'|'decisions'|'script'|'rhythm'|'visual'
const titles:Record<ComicPlanningStage,string>={facts:'原作事实',causal:'因果关系',brief:'改编方案',decisions:'删改决定',script:'漫画脚本',rhythm:'分页节奏',visual:'视觉圣经'}
const keys:Record<string,readonly string[]>={facts:['stableKey','kind','statement','subjectKeys','sourceUnitKeys','confidence'],causal:['stableKey','fromFactKey','toFactKey','relation','rationale','sourceUnitKeys'],decisions:['stableKey','action','sourceFactKeys','targetKeys','rationale'],script:COMIC_SCRIPT_BEAT_KEYS_V1,rhythm:COMIC_PAGE_PLAN_KEYS_V1}
export function emptyComicBrief(){return {version:1,coreTheme:'',dominantEmotion:'',mustKeep:[],mayCut:[],mayMerge:[],mayReorder:[],allowedAdditions:[],audience:'中文读者',rating:'PG-13',targetScale:'页漫',narrativePerspective:'跟随主人公',timeBudget:'',costLimit:'',deviationNotes:'',unresolvedQuestions:[],assumptions:[]}}
export default function ComicPlanning({scope,root,units,stage,onChanged}:{scope:WorkspaceScope;root:AdaptationProject;units:AdaptationSourceUnit[];stage:ComicPlanningStage;onChanged:()=>Promise<void>}) {
 const [value,setValue]=useState<any>(null),[options,setOptions]=useState<Record<string,FieldOption[]>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false)
 const [confirmed,setConfirmed]=useState('')
 const edit=useRef(0),dialog=useDialog();const prefix=`comic:${scope.workId}:`;const draftKey=`planning:${stage}:r${root.revision}`
 useEffect(()=>registerPendingDraftFlusherV1(()=>flushCandidateDraftsV1(prefix)),[prefix])
 useEffect(()=>{let cancelled=false;setLoaded(false);const initial=edit.current
 void Promise.all([listAdaptationAnalysisV1({scope,adaptationProjectId:root.id!}),listComicProductionV1(scope),listComicVisualSubjects(scope),readComicAuthorDraft(scope,draftKey)]).then(([a,p,subjects,saved])=>{
  if(cancelled||initial!==edit.current)return
  const facts=a.facts.filter(x=>x.authorStatus==='confirmed'),decisions=a.decisions.filter(x=>x.authorStatus==='confirmed');const f=facts.map(x=>({value:x.stableKey,label:x.statement}));
  setOptions({subjectIdentity:[...new Set(facts.flatMap(f=>f.subjectKeys))].map(value=>({value,label:value})),sourceUnitKeys:units.filter(x=>x.sourceKind!=='work').map(x=>({value:x.sourceUnitKey,label:x.label})),sourceFactKeys:f,causalFactKeys:f,fromFactKey:f,toFactKey:f,decisionKeys:decisions.map(x=>({value:x.stableKey,label:x.rationale})),beatKeys:p.scriptBeats.map(x=>({value:x.stableKey,label:x.visualAction})),...(stage==='visual'?{kind:['character','location','prop','style'].map((value,i)=>({value,label:['人物','地点','道具','风格'][i]}))}:{})})
  const rows:any={facts,causal:a.edges.filter(x=>x.authorStatus==='confirmed'),decisions,script:p.scriptBeats,rhythm:p.pagePlans}
  const formal=stage==='brief'?(root.brief??emptyComicBrief()):stage==='visual'?{global:root.visualBible??{version:1,artDirection:'',linework:'',palette:[],lighting:'',periodAndMaterials:'',cameraLanguage:[],prohibitedDepictions:[]},subjects:subjects.map(s=>({stableKey:s.stableKey,kind:s.kind,label:s.label,design:s.design,sourceUnitKeys:s.sourceUnitIds.map(id=>units.find(u=>u.id===id)?.sourceUnitKey).filter(Boolean)}))}:rows[stage].map((r:any)=>Object.fromEntries(keys[stage].map(k=>[k,r[k]])))
  setValue(saved?JSON.parse(saved):formal);setLoaded(true)
 }).catch(c=>setError(String(c)));return()=>{cancelled=true}
 },[scope,root,units,stage,draftKey])
 const change=(next:any)=>{setConfirmed('');edit.current++;setValue(next);queueCandidateDraftV1({key:prefix+draftKey,draft:JSON.stringify(next),debounceMs:250,persist:text=>saveComicAuthorDraft(scope,draftKey,text),onError:c=>setError(c.message)})}
 const add=()=>{const id=crypto.randomUUID(),n=Array.isArray(value)?value.length:0;const source=options.sourceUnitKeys?.[0]?.value,fact=options.sourceFactKeys?.[0]?.value,decision=options.decisionKeys?.[0]?.value,beat=options.beatKeys?.[0]?.value;const refs=source?[source]:[]
 const templates:any={facts:{stableKey:id,kind:'event',statement:'',subjectKeys:[],sourceUnitKeys:refs,confidence:1},causal:{stableKey:id,fromFactKey:fact??'',toFactKey:options.sourceFactKeys?.[1]?.value??fact??'',relation:'cause',rationale:'',sourceUnitKeys:refs},decisions:{stableKey:id,action:'keep',sourceFactKeys:fact?[fact]:[],targetKeys:[],rationale:''},script:{stableKey:id,sectionKey:'chapter_1',chapterNumber:1,order:n,narrativeFunction:'develop',visualAction:'',dialogueIntent:'',emotion:'',causalFactKeys:fact?[fact]:[],decisionKeys:decision?[decision]:[],sourceUnitKeys:refs,estimatedPanels:1},rhythm:{stableKey:id,chapterNumber:1,pageNumber:n+1,order:n,goal:'',beatKeys:beat?[beat]:[],endReveal:'',pageTurn:'none',expectedPanelCount:1,textBudget:80}}
 if(stage==='visual')change({...value,subjects:[...value.subjects,{stableKey:options.subjectIdentity?.find(o=>!value.subjects.some((s:any)=>s.stableKey===o.value))?.value??`subject_${id}`,kind:'character',label:'',design:{description:'',silhouette:'',facialFeatures:'',hairAndCostume:'',palette:[],materials:[],distinguishingMarks:[],prohibitedChanges:[]},sourceUnitKeys:refs}]})
 else change([...(value??[]),templates[stage]])
 }
 const save=async()=>{if(busy)return;setBusy(true);setError('');try{
 await flushPendingEditsV1();let replace=false
 if(stage==='visual'&&(!value.global.palette.length||!value.global.cameraLanguage.length))throw new Error('请在全局画风中填写至少一种颜色和一条镜头语言。')
 const p=await listComicProductionV1(scope)
 if(['facts','causal','decisions','brief'].includes(stage)&&p.scriptBeats.length&&!await dialog.confirm({title:'确认修改上游内容？',message:'已做的脚本、页格和图片会保留，但分页方案将需要重新确认，才能继续发布。修改原作事实还会清除旧因果关系和删改决定。',confirmText:'确认修改'}))return
 if((['script','rhythm'].includes(stage)&&p.pagePlans.length)||(stage==='visual'&&(await listComicVisualSubjects(scope)).length)){
 if(!await dialog.confirm({title:'确认重新规划？',message:'此操作会替换下游页格、图片候选与审查，并先下载完整备份。已发布版本及其图片保留。锁定内容需要先解锁。',confirmText:'备份并替换'}))return
 await downloadJSON(await exportProjectJSON(scope.projectId),'漫画重新规划前备份.json');replace=true
 }
 const common={scope,adaptationProjectId:root.id!,expectedAdaptationRevision:root.revision,sourceManifestVersion:root.activeSourceManifestVersion};const items=Array.isArray(value)?value.map(candidate=>({candidate,authorStatus:'confirmed' as const})):[]
 if(stage==='facts')await adoptAdaptationSourceFactsV1({...common,items})
 else if(stage==='causal')await adoptAdaptationCausalEdgesV1({...common,items})
 else if(stage==='decisions')await adoptAdaptationDecisionsV1({...common,items})
 else if(stage==='brief'){const saved=await saveAdaptationBriefDraft({adaptationProjectId:root.id!,expectedRevision:root.revision,brief:value});await confirmAdaptationBrief({adaptationProjectId:root.id!,expectedRevision:saved.revision})}
 else if(stage==='script')await adoptComicScriptBeatsV1({...common,candidates:value,allowReplaceDownstream:replace})
 else if(stage==='rhythm')await adoptComicPagePlansV1({...common,candidates:value,allowReplaceDownstream:replace})
 else await adoptComicVisualBibleV1({...common,candidate:value,allowReplaceExisting:replace})
 await onChanged();setConfirmed(stage)
 }catch(c){setError(String(c))}finally{setBusy(false)}}
 return <section className="cp-planning"><h3>{titles[stage]}</h3><p>编辑稿会保留；确认后才写入漫画的正式内容。</p>{error&&<p role="alert">{error}</p>}{confirmed===stage&&<p role="status">{titles[stage]}已确认</p>}{loaded?<fieldset disabled={busy||root.status==='complete'}><ComicFields value={value} onChange={change} options={options}/>{(Array.isArray(value)||stage==='visual')&&<button onClick={add}>添加{stage==='visual'?'视觉主体':titles[stage]}</button>}<button className="primary" onClick={()=>void save()}>确认{titles[stage]}</button></fieldset>:<p>读取内容…</p>}</section>
}
