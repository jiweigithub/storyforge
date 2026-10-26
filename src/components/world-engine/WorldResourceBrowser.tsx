import { FIELD_REGISTRY } from '../../lib/registry/field-registry'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { listWorldReleases } from '../../lib/world-engine/releases'
import { resolveScopeLike } from '../../lib/workspace/scope'
import { openWorldReleaseAuthorBrowserV1, listWorldReleaseV1, searchWorldReleaseV1, readWorldResourceV1, readWorldOriginalEvidenceV1, closeWorldQueryAccessV1, WORLD_RELEASE_RESOURCE_KINDS_V1, type OpenWorldReleaseV1 } from '../../lib/context-gateway/world-release-client'
import type { ContextResourceDescriptorV1, ContextResourceKind, ContextSourceRefV1 } from '../../lib/registry/types'
import type { WorldRelease } from '../../lib/types'
import type { WorldQueryAccessV1 } from '../../lib/types/world-query'
const NarrativeResourceBrowser = lazy(() => import('./NarrativeResourceBrowser'))

const areas:Record<string,string>={foundation:'世界基础',story:'故事语义',characters:'角色',relations:'关系与认知',entities:'实体与地点',storylines:'主支线',outline:'大纲','detailed-outline':'细纲',manuscript:'正文','multi-world':'多世界'}
const kinds:Record<string,string>={world:'世界集合','worldview-field':'世界设定','story-core-field':'故事核心',character:'角色','character-relation':'人物关系','story-arc':'故事线','storyline-progress':'故事线进度','outline-node':'大纲','detailed-outline':'细纲',chapter:'正文',foreshadow:'伏笔',location:'地点','codex-entry':'实体词条','world-link':'世界通道',fact:'事实'}
const resourceTitle=(item:ContextResourceDescriptorV1)=>/^[a-z][a-z-]* \d+$/.test(item.title)?`${kinds[item.kind]??'世界资源'} ${item.title.match(/\d+$/)?.[0]??''}`:item.title
const fieldLabels=Object.fromEntries(FIELD_REGISTRY.filter(f=>f.labels?.length).map(f=>[f.field,f.labels![0]]))
function readableContent(content:string):string {
 try {
  const value=JSON.parse(content)
  if(!value || typeof value!=='object' || Array.isArray(value))return content
  const labels:Record<string,string>={...fieldLabels,name:'名称',title:'标题',description:'说明',summary:'概述',content:'正文',background:'背景',appearance:'外貌',personality:'性格',motivation:'动机',globalNote:'整体规则',entries:'规则条目',customNodes:'自定义规则'}
  return Object.entries(value).filter(([key,v])=>!key.startsWith('_')&&!key.endsWith('Id')&&!key.endsWith('Ids')&&!['id','createdAt','updatedAt','fieldSchema','order','hidden'].includes(key)&&v!==null&&v!==''&&v!=='[]'&&v!=='{}').map(([key,v])=>`${labels[key]??key}：${typeof v==='string'?v:JSON.stringify(v,null,2)}`).join('\n\n') || '此资源没有正文，可展开查看原始结构。'
 }catch{return content}
}
export default function WorldResourceBrowser({projectId,worldId,onEdit,onVersions,initialReleaseId}:{projectId:number;worldId:number;onEdit?:()=>void;onVersions:()=>void;initialReleaseId?:number}){
 const [narrativeAccess,setNarrativeAccess]=useState<WorldQueryAccessV1|null>(null)
 const narrativePreview=import.meta.env.DEV&&new URLSearchParams(window.location.search).has('narrative-preview')
 const [releases,setReleases]=useState<WorldRelease[]>([]),[releaseId,setReleaseId]=useState<number|null>(null),[opened,setOpened]=useState<OpenWorldReleaseV1|null>(null),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[kind,setKind]=useState(''),[items,setItems]=useState<ContextResourceDescriptorV1[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<ContextResourceDescriptorV1|null>(null),[content,setContent]=useState(''),[refs,setRefs]=useState<ContextSourceRefV1[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const request=useRef(0),detailRequest=useRef(0)
 useEffect(()=>{let active=true;void resolveScopeLike(projectId).then(scope=>listWorldReleases(scope)).then(rows=>{if(active){setReleases(rows);setReleaseId(initialReleaseId??rows[0]?.id??null)}}).catch(c=>{if(active)setError(String(c))});return()=>{active=false}},[projectId,initialReleaseId])
 useEffect(()=>{let active=true;let issued:WorldQueryAccessV1|null=null;request.current++;detailRequest.current++;setOpened(null);setNarrativeAccess(null);setSelected(null);setContent('');setRefs([]);setItems([]);setCursor(null);setError('');if(releaseId)void openWorldReleaseAuthorBrowserV1({localReleaseRecordId:releaseId,expectedProjectId:projectId,expectedWorldId:worldId}).then(value=>{if(value.version===3){if(active)setOpened(value.opened);return}issued=value.access;if(!active){void closeWorldQueryAccessV1(issued);return}if(narrativePreview)setNarrativeAccess(issued);else{void closeWorldQueryAccessV1(issued);setError('此版本使用实验叙事索引，请在已开启实验预览的作者工作区查看。')}}).catch(c=>{if(active)setError(String(c))});return()=>{active=false;if(issued)void closeWorldQueryAccessV1(issued)}},[releaseId,projectId,worldId,narrativePreview])
 const load=async(next?:string)=>{
  if(!opened)return
  const ticket=++request.current;setBusy(true);setError('')
  try{const input={scope:opened.scope,kinds:kind?[kind as ContextResourceKind]:undefined,limit:30,cursor:next};const result=search.trim()?await searchWorldReleaseV1({...input,query:search}):await listWorldReleaseV1(input);if(ticket===request.current){setItems(previous=>next?[...previous,...result.items]:result.items);setCursor(result.nextCursor)}}
  catch(c){if(ticket===request.current)setError(String(c))}finally{if(ticket===request.current)setBusy(false)}
 }
 useEffect(()=>{setItems([]);setSelected(null);setContent('');setRefs([]);detailRequest.current++;void load();return()=>{
 // Invalidate outstanding asynchronous reads; this ref is a request counter.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 request.current++
 }
 // load is driven by these immutable query inputs; pagination calls it separately.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[opened,search,kind])
 const read=async(item:ContextResourceDescriptorV1,sourceRef?:ContextSourceRefV1)=>{
  if(!opened)return
  const ticket=++detailRequest.current;setSelected(item);setContent('读取中…');setError('')
  try{const result=sourceRef?await readWorldOriginalEvidenceV1({scope:opened.scope,resourceKey:item.resourceKey,sourceRef,maxTokens:100000}):await readWorldResourceV1({scope:opened.scope,resourceKey:item.resourceKey,depth:'full',maxTokens:100000});if(ticket===detailRequest.current){setContent(result.content);setRefs('sourceRefs' in result?result.sourceRefs:item.sourceRefs)}}catch(c){if(ticket===detailRequest.current){setContent('');setError(String(c))}}
 }
 return <>
 <section className="lf-paper"><h3>版本资源与来源证据</h3><p>这里展示已封存版本。修改内容请回到世界草稿，再封存新版本；各产品需要读取什么，在各自制作页确定。</p><div className="we-actions"><label>查看世界版本<select aria-label="出口世界版本" value={releaseId??''} onChange={e=>setReleaseId(Number(e.target.value)||null)}><option value="">选择版本</option>{releases.map(r=><option key={r.id} value={r.id}>v{r.version} · {r.label}</option>)}</select></label>{onEdit&&<button className="lf-action" onClick={onEdit}>编辑世界草稿</button>}<button className="lf-action" onClick={onVersions}>封存与发布</button></div>{!releases.length&&<p>尚未发布世界版本。可以先编辑任意范围的世界内容，再冻结并发布。</p>}
 {opened&&<><p>{opened.description.identity.worldCode} · v{opened.description.identity.releaseVersion} · {opened.description.identity.workTitle}</p><details><summary>版本与来源校验信息</summary><p>版本校验：<code>{opened.description.identity.releaseHash}</code></p><p>来源校验：<code>{opened.description.sourceManifestHash}</code></p></details><details open><summary>版本能力与封存范围</summary><div className="we-table-scroll"><table className="we-capabilities"><thead><tr><th>内容域</th><th>范围</th><th>可用状态</th><th>已确认</th><th>候选</th><th>冲突</th><th>未收录</th><th>证据与索引</th></tr></thead><tbody>{opened.description.capabilities.map(c=><tr key={c.area}><td>{areas[c.area]}</td><td>{{selected:'已选','partial-selection':'部分选择',omitted:'未选择'}[c.selectionStatus]}</td><td>{{missing:'缺少内容',partial:'部分可用',available:'可用'}[c.status]}</td><td>{c.confirmedRowCount}</td><td>{c.candidateRowCount}</td><td>{c.conflictRowCount}</td><td>{c.omittedRowCount}</td><td>{c.originalEvidenceAvailable?'有原文':'无原文'} · {c.queryableIndexAvailable?'目录检索':'无目录索引'}</td></tr>)}</tbody></table></div><p>未被本次封存收录的资源，不等于世界中不存在；候选与冲突不会冒充已确认内容。</p></details></>}
 </section>
 {error&&<p role="alert" className="we-error">{error}</p>}
 {narrativeAccess&&narrativePreview&&<Suspense fallback={<p>正在打开叙事查询…</p>}><NarrativeResourceBrowser key={narrativeAccess.reference.referenceHash} access={narrativeAccess}/></Suspense>}
 {opened&&<div className="we-outlet-grid"><section className="lf-paper"><h3>资源目录</h3><form onSubmit={e=>{e.preventDefault();setSearch(query)}}><label>搜索资源<input aria-label="搜索世界资源" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>资源类型<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">全部类型</option>{WORLD_RELEASE_RESOURCE_KINDS_V1.map(k=><option key={k} value={k}>{kinds[k]??k}</option>)}</select></label><button className="lf-action" disabled={busy}>搜索</button></form><div className="we-resource-list">{items.map(item=><button key={item.resourceKey} aria-current={selected?.resourceKey===item.resourceKey?'true':undefined} onClick={()=>void read(item)}>{resourceTitle(item)}<small>{kinds[item.kind]??item.kind} · {item.shortSummary}</small></button>)}</div>{!busy&&!items.length&&<p>当前检索条件下没有可读取资源，请同时查看上方封存范围和遗漏情况。</p>}{cursor&&<button className="lf-action" disabled={busy} onClick={()=>void load(cursor)}>加载更多资源</button>}</section><section className="lf-paper"><h3>{selected?resourceTitle(selected):'资源详情'}</h3>{selected?<><pre className="we-evidence">{readableContent(content)}</pre><details><summary>原始资源结构</summary><pre className="we-evidence">{content}</pre></details><div className="we-actions">{refs.map((ref,index)=><button className="lf-action" key={index} onClick={()=>void read(selected,ref)}>查看原文证据 {index+1}</button>)}</div><details><summary>资源与引用信息</summary><pre className="we-evidence">{JSON.stringify({revision:selected.contentRevision,contentHash:selected.contentHash,sourceRefs:refs,relations:selected.relations},null,2)}</pre></details></>:<p>选择左侧资源，查看内容及其固定版本来源。</p>}</section></div>}
 </>
}
