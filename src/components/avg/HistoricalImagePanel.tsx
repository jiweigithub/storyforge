import { useEffect,useRef,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import type { readAvgHistoricalImageCandidatesV4 } from '../../lib/avg/visual-image-history'
import MediaAssetPreview from './MediaAssetPreview'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Snapshot=Awaited<ReturnType<typeof readAvgHistoricalImageCandidatesV4>>

/** Explicit local read. Loading and stale results belong to this exact owner
 * and original version; there are no generation or adoption controls here. */
export default function HistoricalImagePanel({scope,view}:{scope:WorkspaceScope;view:View}){
  const details=view.details!,build=details.build!
  const identity=`${scope.projectId}:${scope.worldId}:${scope.workId}:${details.production.id}:${build.id}:${build.stateRevision}:${build.briefHash}:${build.planHash}`
  const fence=useRef({request:0}),identityRef=useRef(identity);identityRef.current=identity
  const [saved,setSaved]=useState<{identity:string;snapshot:Snapshot}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState('')
  useEffect(()=>{const state=fence.current;state.request++;setSaved(null);setError('');setExpanded('');setLoading(false);return()=>{state.request++}},[identity])
  const snapshot=saved?.identity===identity?saved.snapshot:null
  const read=async()=>{
    const ticket=++fence.current.request,currentIdentity=identity
    setLoading(true);setError('')
    try{
      const {readAvgHistoricalImageCandidatesV4}=await import('../../lib/avg/visual-image-history')
      const result=await readAvgHistoricalImageCandidatesV4({scope,productionId:details.production.id!,buildId:build.id!,
        expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash})
      if(fence.current.request===ticket&&identityRef.current===currentIdentity){setSaved({identity:currentIdentity,snapshot:result});setExpanded('')}
    }catch(cause){if(fence.current.request===ticket&&identityRef.current===currentIdentity)setError(cause instanceof Error?cause.message:'原图来源读取失败')}
    finally{if(fence.current.request===ticket&&identityRef.current===currentIdentity)setLoading(false)}
  }
  return <section className="avg-input-card" aria-label="已停止版本的原图"><h5>已停止版本的原图</h5>
    <p>查看原始方案、生成记录和图片。读取只核对本机保存的来源与字节；下一版的用途、评审和选用仍需重新确认。</p>
    <button className="lf-action" disabled={loading} onClick={()=>void read()}>{loading?'正在核对原图来源…':'读取原图与来源'}</button>
    {error&&<p role="alert">{error}</p>}
    {snapshot&&<><p role="status">已核对版本 {snapshot.buildNumber} 的原始编译来源；{snapshot.candidates.filter(c=>c.available).length} 张原图来源可读取。</p>
      {snapshot.candidates.map(candidate=><article className="avg-input-card" key={candidate.requirement.requirementKey} aria-label={`历史原图：${candidate.requirement.name}`}>
        <h5>{candidate.requirement.name}</h5>
        {candidate.available?<><p>{candidate.asset.source==='agnes.image-2.5-flash.v1'?'Agnes Image 2.5 Flash':'Agnes Image 2.1 Flash'} · {candidate.asset.width} × {candidate.asset.height} · 原调用费用：{candidate.costUsd===null?'未知':`$${candidate.costUsd}`}</p>
          <button className="lf-action" onClick={()=>setExpanded(expanded===candidate.requirement.requirementKey?'':candidate.requirement.requirementKey)}>{expanded===candidate.requirement.requirementKey?'收起原图':'查看原图'}</button>
          {expanded===candidate.requirement.requirementKey&&<MediaAssetPreview scope={scope} productionId={details.production.id!} asset={candidate.asset}
            raw={{requirementKey:candidate.requirement.requirementKey,version:candidate.raw.version,contentHash:candidate.raw.contentHash,historical:snapshot.boundary,historicalSource:candidate.reuseSource}}/>}
        </>:<p>{candidate.issue}</p>}
      </article>)}
    </>}
  </section>
}
