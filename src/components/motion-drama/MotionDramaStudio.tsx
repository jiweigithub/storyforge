import { liveQuery } from 'dexie'
import { Link, useNavigate } from 'react-router'
import { useDialog } from '../shared/Dialog'
import { readMotionAuthorDraft, saveMotionAuthorDraft } from '../../lib/motion-drama/author-drafts'
import { exportMotionMaterialBundle } from '../../lib/motion-drama/delivery'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { downloadJSON, exportProjectJSON } from '../../lib/export/json-export'
import { listActiveSourceUnits } from '../../lib/adaptation/source-manifest'
import { motionStageDraft } from '../../lib/motion-drama/editing'
import MotionFields from './MotionFields'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Archive, BookOpenText, Boxes, Check, ChevronRight, Clapperboard, Copy, Download, Film, Image, Layers3, Library, Loader2, PackageCheck, RefreshCw, Save, ShieldCheck, Sparkles, Upload, X } from 'lucide-react'
import type { MotionDramaPromptPackMaturityV1, MotionDramaPromptStageV1, MotionDramaProviderTargetV1, Project, WorkspaceScope } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import { mediaObjectDataUrlV1 } from '../../lib/media/blob-store'
import {
  adoptMotionDramaProfessionalCandidateV1,
  listMotionMaterialTasks,
  generateMotionDramaCandidateV1,
  readPendingMotionDramaCandidateV1,
  rejectMotionDramaProfessionalCandidateV1,
} from '../../lib/motion-drama/durable-production'
import {
  adoptMotionDramaCandidateV1,
  selectMotionMaterialReference,
  removeMotionMaterialSubject,
  selectMotionFrameReference,
  commitMotionDramaAssetReferenceV1,
  commitMotionDramaShotReferenceV1,
  loadMotionDramaStudioV1,
  resyncMotionDramaSourceV1,
  setCurrentMotionDramaEpisodeV1,
  updateMotionDramaReviewIssueStatusV1,
  type MotionDramaStudioSnapshotV1,
} from '../../lib/motion-drama/service'
import { compileMotionDramaPromptPackV1, SEEDANCE_PROVIDER_PROFILE_IDS, verifyMotionDramaPromptPackV1, type MotionDramaPromptPackManifest, type SeedanceProviderProfileId } from '../../lib/motion-drama/prompt-pack'
import { inspectMotionDramaQualityV1, type MotionDramaQualityReportV1 } from '../../lib/motion-drama/quality'
import { listMotionDramaReleasesV1, publishMotionDramaReleaseV1, readMotionDramaReleaseManifestV1 } from '../../lib/motion-drama/release'
import { deleteMotionDramaPromptOverrideV1, getMotionDramaPromptDefinitionV1, listMotionDramaPromptOverridesV1, resolveMotionDramaPromptV1, saveMotionDramaPromptOverrideV1, type ResolvedMotionDramaPromptV1 } from '../../lib/motion-drama/prompts'
import type { CreationReleaseV1, MotionDramaPromptOverrideV1 } from '../../lib/types'
import MotionDramaShowcase from './MotionDramaShowcase'
import './motion-drama-studio.css'

const ShortNovelStudio = lazy(() => import('../short-novel/ShortNovelStudio'))

interface Props { scope: WorkspaceScope; project: Project; page?: string }
type View = 'source' | 'series-bible' | 'asset-bible' | 'episode-outline' | 'episode-script' | 'shot-design' | 'prompt-pack' | 'quality-review'

const VIEWS: Array<{ id: View; label: string; note: string; icon: typeof BookOpenText }> = [
  { id: 'source', label: '小说来源', note: '冻结完整故事', icon: BookOpenText },
  { id: 'series-bible', label: '系列圣经', note: '承诺与整季引擎', icon: Library },
  { id: 'asset-bible', label: '物料圣经', note: '角色、服装、场景、道具、声音', icon: Boxes },
  { id: 'episode-outline', label: '单集节拍', note: '钩子、升级与尾钩', icon: Layers3 },
  { id: 'episode-script', label: '漫剧剧本', note: '可演、可分镜、可配音', icon: Clapperboard },
  { id: 'shot-design', label: '分镜与参考帧', note: '镜头、关键帧与运动', icon: Film },
  { id: 'prompt-pack', label: '工具适配包', note: 'Seedance / Runway / LTX', icon: PackageCheck },
  { id: 'quality-review', label: '质量与交付', note: '检查结果与素材版本', icon: ShieldCheck },
]

function generationStage(view: View, promptKind: 'image' | 'video'): MotionDramaPromptStageV1 | null {
  if (view === 'series-bible' || view === 'asset-bible' || view === 'episode-outline' || view === 'episode-script' || view === 'shot-design' || view === 'quality-review') return view
  if (view === 'prompt-pack') return promptKind === 'image' ? 'image-prompts' : 'video-prompts'
  return null
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeName(value: string) { return value.replace(/[/:*?"<>|]/g, '_').trim() || '漫剧前期包' }

export default function MotionDramaStudio({ scope, project, page }: Props) {
  const [snapshot, setSnapshot] = useState<MotionDramaStudioSnapshotV1 | null>(null)
  const [quality, setQuality] = useState<MotionDramaQualityReportV1 | null>(null)
  const [releases, setReleases] = useState<CreationReleaseV1[]>([])
  const [overrides, setOverrides] = useState<MotionDramaPromptOverrideV1[]>([])
  const navigate=useNavigate(); const dialog=useDialog()
  const [localView,setView]=useState<View>('source')
  const viewMap:Record<string,View>={source:'source',series:'series-bible',episodes:'series-bible',assets:'asset-bible',beats:'episode-outline',script:'episode-script',shots:'shot-design',frames:'shot-design',image:'prompt-pack',video:'prompt-pack',pack:'prompt-pack',review:'quality-review',versions:'quality-review',prompts:'source'}
  const view=page?viewMap[page]??'source':localView
  const [units,setUnits]=useState<Awaited<ReturnType<typeof listActiveSourceUnits>>>([])
  const [tasks,setTasks]=useState<Awaited<ReturnType<typeof listMotionMaterialTasks>>>([])
  const [draftStatus,setDraftStatus]=useState('')
  const [assetFilter,setAssetFilter]=useState('all')
  const [assetSearch,setAssetSearch]=useState('')
  const [deliveryRange,setDeliveryRange]=useState('current')
  const [releasePreview,setReleasePreview]=useState<string|null>(null)
  const [promptHistory,setPromptHistory]=useState<Array<{key:string;text:string}>>([])
  const [selectedHistory,setSelectedHistory]=useState('')
  const [promptKind, setPromptKind] = useState<'image' | 'video'>('image')
  const [candidate, setCandidate] = useState<{ runId: number; stage: MotionDramaPromptStageV1; text: string; resuming?:boolean; productionRevision?:number; adaptationRevision?:number; episodeNumber?:number } | null>(null)
  const [authorInstruction, setAuthorInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [showSourceStudio, setShowSourceStudio] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [promptEditorStage, setPromptEditorStage] = useState<MotionDramaPromptStageV1>('series-bible')
  const [promptEditorScope, setPromptEditorScope] = useState<'work' | 'episode'>('work')
  const [promptEditorText, setPromptEditorText] = useState('')
  const [resolvedPrompt, setResolvedPrompt] = useState<ResolvedMotionDramaPromptV1 | null>(null)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [packManifests, setPackManifests] = useState<Partial<Record<MotionDramaProviderTargetV1, MotionDramaPromptPackManifest>>>({})
  const [copiedShotKey, setCopiedShotKey] = useState<string | null>(null)
  const [seedanceProfileId, setSeedanceProfileId] = useState<SeedanceProviderProfileId>(SEEDANCE_PROVIDER_PROFILE_IDS[0])
  const activeGeneration = useRef<AbortController | null>(null)
  const aiConfig = useAIConfigStore(state => state.config)

  const reload = useCallback(async (followPhase = false) => {
    const studio = await loadMotionDramaStudioV1(scope)
    const [report, releaseRows, promptRows] = await Promise.all([
      inspectMotionDramaQualityV1({ scope, episodeNumber: studio.production.currentEpisodeNumber }),
      listMotionDramaReleasesV1(scope), listMotionDramaPromptOverridesV1(scope),
    ])
    const latestByProvider = [...studio.promptPacks]
      .filter(pack => pack.episodeNumber === studio.production.currentEpisodeNumber)
      .sort((a, b) => b.version - a.version)
      .filter((pack, index, rows) => rows.findIndex(row => row.provider === pack.provider) === index)
    const verified = await Promise.all(latestByProvider.map(async pack => {
      try { return [pack.provider, await verifyMotionDramaPromptPackV1(pack)] as const } catch { return null }
    }))
    const manifests = Object.fromEntries(verified.filter((value): value is NonNullable<typeof value> => value !== null)) as Partial<Record<MotionDramaProviderTargetV1, MotionDramaPromptPackManifest>>
    setPackManifests(manifests)
    if (manifests.seedance?.version === 2 && SEEDANCE_PROVIDER_PROFILE_IDS.includes(manifests.seedance.providerProfile.id as SeedanceProviderProfileId)) setSeedanceProfileId(manifests.seedance.providerProfile.id as SeedanceProviderProfileId)
    setUnits(await listActiveSourceUnits(studio.adaptation.id!)); setTasks(await listMotionMaterialTasks(scope))
    setSnapshot(studio); setQuality(report); setReleases(releaseRows); setOverrides(promptRows)
    if (followPhase) {
      const phaseMap: Record<string, View> = { source: 'source', 'series-bible': 'series-bible', 'asset-bible': 'asset-bible', 'episode-outline': 'episode-outline', script: 'episode-script', storyboard: 'shot-design', 'prompt-pack': 'prompt-pack', review: 'quality-review', 'release-ready': 'quality-review', complete: 'quality-review' }
      setView(phaseMap[studio.production.phase] ?? 'source')
    }
    const urls: Record<string, string> = {}
    const selected = studio.assets.flatMap(subject => studio.assetVersions.filter(version => version.stableKey === subject.selectedVersionKey && version.blobObjectId != null).map(version => [subject.stableKey, version.blobObjectId!] as const))
    const frames = studio.shotReferences.filter(reference => reference.selected && reference.blobObjectId != null).map(reference => [reference.stableKey, reference.blobObjectId!] as const)
    await Promise.all([...selected, ...frames].map(async ([key, blobObjectId]) => { try { urls[key] = await mediaObjectDataUrlV1({ scope, blobObjectId }) } catch { /* broken refs remain visibly absent */ } }))
    setPreviewUrls(urls)
    return studio
  }, [scope])

  useEffect(()=>{let active=true;const sub=liveQuery(()=>loadMotionDramaStudioV1(scope)).subscribe({next:()=>{if(active)void reload().catch(c=>setError(String(c)))},error:c=>setError(String(c))});return()=>{active=false;sub.unsubscribe()}},[scope,reload])
  useEffect(() => {
    let cancelled = false
    void reload(true).then(async () => {
      const pending = await readPendingMotionDramaCandidateV1(scope)
      if (!pending || cancelled) return
      const saved=pending.resuming?null:await readMotionAuthorDraft(scope,`candidate:${pending.snapshot.run.id}`)
      if(!cancelled)setCandidate({ runId: pending.snapshot.run.id, stage: pending.candidate.stage, resuming:pending.resuming, text:saved??JSON.stringify(pending.authorPayload??pending.candidate.payload,null,2) })
    }).catch(cause => setError(cause instanceof Error ? cause.message : '漫剧素材初始化失败'))
    return () => { cancelled = true; activeGeneration.current?.abort() }
  }, [reload, scope])

  useEffect(() => {
    if (!snapshot || !showPromptLibrary) return
    void readMotionAuthorDraft(scope,`prompt-history:${promptEditorStage}:${promptEditorScope}:${snapshot.production.currentEpisodeNumber}`).then(value=>setPromptHistory(JSON.parse(value??'[]'))).catch(c=>setError(String(c)))
    void resolveMotionDramaPromptV1(scope, promptEditorStage, snapshot.production.currentEpisodeNumber).then(value => {
      const definition = getMotionDramaPromptDefinitionV1(promptEditorStage)
      const selected = overrides.find(row => row.stage === promptEditorStage && row.scope === promptEditorScope && row.episodeNumber === (promptEditorScope === 'episode' ? snapshot.production.currentEpisodeNumber : null))
      const workFallback = overrides.find(row => row.stage === promptEditorStage && row.scope === 'work' && row.episodeNumber === null)?.instruction
      setResolvedPrompt(value)
      setPromptEditorText(selected?.instruction ?? (promptEditorScope === 'episode' ? workFallback : null) ?? definition.instruction)
    }).catch(cause => setError(cause instanceof Error ? cause.message : '读取提示词失败'))
  }, [promptEditorScope, promptEditorStage, showPromptLibrary, snapshot, scope, overrides])

  const act = async (operation: () => Promise<unknown>, followPhase = false) => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation(); await reload(followPhase) } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy(false) }
  }

  const runStage = async (stage: MotionDramaPromptStageV1) => {
    if (!snapshot || busy || candidate) return
    if (!isAIConfigReady(aiConfig)) { setError(getAIConfigRequiredMessage(aiConfig)); return }
    const controller = new AbortController(); let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, 120_000)
    activeGeneration.current = controller; setBusy(true); setGenerating(true); setError('')
    try {
      const result = await generateMotionDramaCandidateV1({ scope, stage, episodeNumber: snapshot.production.currentEpisodeNumber, authorInstruction, aiConfig, signal: controller.signal })
      setCandidate({ runId: result.snapshot.run.id, stage, text: JSON.stringify(result.candidate.payload, null, 2) })
    } catch (cause) {
      setError(controller.signal.aborted ? timedOut ? '生成超过 120 秒，已安全停止；没有正式写入。' : '本次生成已取消；没有正式写入。' : cause instanceof Error ? cause.message : '生成失败')
    } finally { window.clearTimeout(timeout); activeGeneration.current = null; setGenerating(false); setBusy(false) }
  }

  const acceptCandidate = async () => {
    if (!candidate||!snapshot) return
    if(!candidate.resuming&&['episode-outline','episode-script','shot-design'].includes(candidate.stage)&&(snapshot.shots.some(row=>row.episodeNumber===snapshot.production.currentEpisodeNumber)||(candidate.stage==='episode-outline'&&snapshot.scenes.some(row=>row.episodeNumber===snapshot.production.currentEpisodeNumber)))){
      if(!await dialog.confirm({title:'确认重建下游内容？',message:'本集已有下游内容。确认将重建受影响的场景、镜头、参考帧关联和工具包；将先下载完整备份，已冻结交付版本保留。',confirmText:'备份并确认'}))return
      try{await downloadJSON(await exportProjectJSON(scope.projectId),`${snapshot.work.title}-修改前备份.json`)}catch(c){setError(String(c));return}
    }
    await act(async () => {
      await flushPendingEditsV1()
      const payload=JSON.parse(candidate.text)
      if(candidate.runId) await adoptMotionDramaProfessionalCandidateV1({scope,runId:candidate.runId,authorPayload:payload})
      else await adoptMotionDramaCandidateV1({scope,stage:candidate.stage,payload,episodeNumber:candidate.episodeNumber!,expectedProductionRevision:candidate.productionRevision!,expectedAdaptationRevision:candidate.adaptationRevision!})
      setCandidate(null);setAuthorInstruction('');setDraftStatus('')
    },true)
  }

  const editCandidate=(text:string)=>{
    if(!candidate||candidate.resuming)return
    setCandidate({...candidate,text});setDraftStatus('正在保存草稿…')
    const key=candidate.runId?`candidate:${candidate.runId}`:`manual:${candidate.stage}:${candidate.episodeNumber}:${candidate.productionRevision}`
    void saveMotionAuthorDraft(scope,key,text).then(()=>setDraftStatus('编辑草稿已保存')).catch(c=>{setDraftStatus('草稿保存失败');setError(String(c))})
  }
  const openManual=async(stage:MotionDramaPromptStageV1)=>{
    if(!snapshot)return
    const key=`manual:${stage}:${snapshot.production.currentEpisodeNumber}:${snapshot.production.revision}`
    try{const text=await readMotionAuthorDraft(scope,key)??JSON.stringify(motionStageDraft(snapshot,stage,units.map(row=>row.sourceUnitKey)),null,2);setCandidate({runId:0,stage,text,productionRevision:snapshot.production.revision,adaptationRevision:snapshot.adaptation.revision,episodeNumber:snapshot.production.currentEpisodeNumber})}catch(c){setError(String(c))}
  }
  const syncSource=async()=>{
    if(!snapshot||!await dialog.confirm({title:'同步来源并重建素材草稿？',message:'这会清空尚未交付的系列设定、物料、单集内容和工具包。先下载完整备份；已有交付版本不变。',confirmText:'备份并同步'}))return
    await act(async()=>{await downloadJSON(await exportProjectJSON(scope.projectId),`${snapshot.work.title}-同步前备份.json`);await resyncMotionDramaSourceV1({scope,expectedAdaptationRevision:snapshot.adaptation.revision,expectedProductionRevision:snapshot.production.revision})},true)
  }
  const exportBundle=async(release:CreationReleaseV1)=>{
    try{const blob=await exportMotionMaterialBundle(scope,release.id!);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${safeName(snapshot?.work.title??'素材')}-v${release.version}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(c){setError(String(c))}
  }
  const rejectCandidate = async () => {
    if (!candidate) return
    await act(async () => { if(candidate.resuming)throw new Error('已确认的任务请继续采纳，不能撤销已提交意图');if(candidate.runId)await rejectMotionDramaProfessionalCandidateV1(scope, candidate.runId); setCandidate(null) })
  }

  const savePrompt = async () => {
    if (!snapshot) return
    await act(async () => {
      const historyKey=`prompt-history:${promptEditorStage}:${promptEditorScope}:${snapshot.production.currentEpisodeNumber}`
      const history=JSON.parse(await readMotionAuthorDraft(scope,historyKey)??'[]') as Array<{key:string;text:string}>
      const existing=await resolveMotionDramaPromptV1(scope,promptEditorStage,snapshot.production.currentEpisodeNumber)
      await saveMotionAuthorDraft(scope,historyKey,JSON.stringify([...history,{key:String(Date.now()),text:existing.instruction}]))
      await saveMotionDramaPromptOverrideV1({ scope, stage: promptEditorStage, overrideScope: promptEditorScope, episodeNumber: snapshot.production.currentEpisodeNumber, instruction: promptEditorText })
    })
  }

  const resetPrompt = async () => {
    if (!snapshot) return
    await act(async () => { await deleteMotionDramaPromptOverrideV1({ scope, stage: promptEditorStage, overrideScope: promptEditorScope, episodeNumber: snapshot.production.currentEpisodeNumber }) })
  }

  const uploadRights = () => ({ version: 1 as const, source: 'author-upload' as const, commercialUse: 'allowed' as const, redistribution: 'allowed' as const, attribution: '', declaration: '作者确认拥有该参考素材用于商业创作与随项目包再分发的权利。', declaredAt: Date.now() })

  const uploadSubject = (subjectKey: string, file?: File) => {
    if (!file || !snapshot || !rightsConfirmed) return
    void act(async () => commitMotionDramaAssetReferenceV1({ scope, subjectKey, data: await file.arrayBuffer(), rights: uploadRights() }))
  }

  const uploadFrame = (shotKey: string, file?: File, role:'start-frame'|'key-frame'|'end-frame'='start-frame') => {
    if (!file || !snapshot || !rightsConfirmed) return
    void act(async () => commitMotionDramaShotReferenceV1({ scope, shotKey, role, data: await file.arrayBuffer(), rights: uploadRights() }))
  }

  const compilePack = (provider: MotionDramaProviderTargetV1) => {
    if (!snapshot) return
    void act(() => compileMotionDramaPromptPackV1({ scope, episodeNumber: snapshot.production.currentEpisodeNumber, provider, providerProfileId: provider === 'seedance' ? seedanceProfileId : undefined, expectedProductionRevision: snapshot.production.revision }))
  }

  const exportLatestPack = async (provider: MotionDramaProviderTargetV1) => {
    if (!snapshot) return
    const rows = snapshot.promptPacks.filter(pack => pack.episodeNumber === snapshot.production.currentEpisodeNumber && pack.provider === provider).sort((a, b) => b.version - a.version)
    if (!rows[0]) { setError(`请先编译 ${provider} 适配包`); return }
    try { const manifest = await verifyMotionDramaPromptPackV1(rows[0]); download(`${safeName(snapshot.work.title)}-EP${snapshot.production.currentEpisodeNumber}-${provider}-v${rows[0].version}.json`, JSON.stringify(manifest, null, 2)) } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败') }
  }

  const copyProviderPrompt = async (shotKey: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedShotKey(shotKey)
      window.setTimeout(() => setCopiedShotKey(current => current === shotKey ? null : current), 1_500)
    } catch { setError('复制失败，请展开提示词后手动复制') }
  }

  const publish = (tier: MotionDramaPromptPackMaturityV1) => {
    if (!snapshot) return
    const target = snapshot.adaptation.targetSpec as import('../../lib/types').MotionDramaTargetSpecV1
    void act(() => publishMotionDramaReleaseV1({ scope, episodeNumbers:deliveryRange==='all'?Array.from({length:target.episodeCount},(_,i)=>i+1):[snapshot.production.currentEpisodeNumber], providers: target.providerTargets, tier, expectedProductionRevision: snapshot.production.revision }), false)
  }

  const exportRelease = async (release: CreationReleaseV1) => {
    if (!snapshot || !release.id) return
    try { const manifest = await readMotionDramaReleaseManifestV1(scope, release.id); download(`${safeName(snapshot.work.title)}-release-v${release.version}.json`, JSON.stringify(manifest, null, 2)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Release 导出失败') }
  }

  const currentStage = page==='image'?'image-prompts':page==='video'?'video-prompts':page==='frames'||page==='pack'||page==='versions'||page==='episodes'||page==='prompts'?null:generationStage(view,promptKind)
  useEffect(()=>{let cancelled=false;setAuthorInstruction('');if(currentStage&&snapshot)void readMotionAuthorDraft(scope,`instruction:${currentStage}:${snapshot.production.currentEpisodeNumber}`).then(value=>{if(!cancelled)setAuthorInstruction(value??'')}).catch(c=>setError(String(c)));return()=>{cancelled=true}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currentStage,snapshot?.production.currentEpisodeNumber,scope])
  const sourceWork = snapshot?.sourceWork ?? null
  const episode = snapshot?.episodes.find(row => row.episodeNumber === snapshot.production.currentEpisodeNumber)
  const scenes = snapshot?.scenes.filter(row => row.episodeNumber === snapshot.production.currentEpisodeNumber) ?? []
  const shots = snapshot?.shots.filter(row => row.episodeNumber === snapshot.production.currentEpisodeNumber) ?? []
  const targetSpec = snapshot?.adaptation.targetSpec as import('../../lib/types').MotionDramaTargetSpecV1 | undefined
  const seedanceManifest = packManifests.seedance?.version === 2 ? packManifests.seedance : null
  const sourceReady = snapshot?.adaptation.sourceCoverage === 'full-text'
  const stageDone = useMemo(() => new Set<View>([
    'source', ...(snapshot?.seriesBibleRecord ? ['series-bible' as View] : []), ...(snapshot?.assets.length ? ['asset-bible' as View] : []), ...(episode ? ['episode-outline' as View] : []), ...(scenes.length ? ['episode-script' as View] : []), ...(shots.length ? ['shot-design' as View] : []), ...(snapshot?.promptPacks.some(row => row.episodeNumber === snapshot.production.currentEpisodeNumber) ? ['prompt-pack' as View] : []), ...(quality?.ready ? ['quality-review' as View] : []),
  ]), [episode, quality?.ready, scenes.length, shots.length, snapshot])

  if (!snapshot) return <div className="motion-loading">{error || '正在打开漫剧素材…'}</div>

  const sourceProject: Project = { ...project, activeWorldId: snapshot.adaptation.worldId, activeWorkId: snapshot.adaptation.sourceWorkId }
  const sourceScope: WorkspaceScope = { projectId: scope.projectId, worldId: scope.worldId, workId: snapshot.adaptation.sourceWorkId! }

  return <div className={`motion-studio ${page?'motion-integrated':''}`} data-testid="motion-drama-studio">
    <header className="motion-hero">
      <div className="motion-hero-copy"><span className="motion-overline">MOTION MATERIALS</span><h2>{snapshot.work.title}</h2><p>原著 · 系列与物料 · 单集与分镜 · 参考帧 · Seedance 提示词与素材包</p><div className="motion-hero-tags"><span>{targetSpec?.aspectRatio}</span><span>{targetSpec?.targetSecondsPerEpisode}s / 集</span><span>{targetSpec?.episodeCount} 集</span><span>{targetSpec?.narrativeMode}</span></div></div>
      <div className="motion-episode-switch"><small>CURRENT EPISODE</small><strong>EP {String(snapshot.production.currentEpisodeNumber).padStart(2, '0')}</strong><select aria-label="当前漫剧集数" value={snapshot.production.currentEpisodeNumber} onChange={event => void act(() => setCurrentMotionDramaEpisodeV1({ scope, episodeNumber: Number(event.target.value), expectedRevision: snapshot.production.revision }), true)}>{Array.from({ length: targetSpec?.episodeCount ?? 1 }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 集</option>)}</select><span className={`motion-source-state ${snapshot.sourceFreshness.status}`}>{snapshot.sourceFreshness.status === 'unchanged' ? '来源已冻结' : '来源有变化'}</span></div>
    </header>

    <div className="motion-shell">
      <aside className="motion-rail"><div className="motion-progress-line" />{VIEWS.map((item, index) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><span className={stageDone.has(item.id) ? 'done' : ''}>{stageDone.has(item.id) ? <Check /> : <Icon />}</span><div><small>{String(index + 1).padStart(2, '0')}</small><strong>{item.label}</strong><em>{item.note}</em></div><ChevronRight /></button> })}<button className="motion-library-button" onClick={() => setShowPromptLibrary(true)}><Library /><div><strong>提示词库</strong><em>内置 / 项目 / 单集</em></div></button></aside>

      <main className="motion-workbench">
        <section className="motion-stage-head"><div><span>STEP {VIEWS.findIndex(item => item.id === view) + 1}</span><h3>{VIEWS.find(item => item.id === view)?.label}</h3><p>{VIEWS.find(item => item.id === view)?.note}</p></div>{currentStage && <button className="motion-primary" title={sourceReady ? undefined : '请先完成小说正文并同步来源'} onClick={() => void runStage(currentStage)} disabled={busy || Boolean(candidate) || !sourceReady}>{generating ? <Loader2 className="spin" /> : <Sparkles />}生成专业候选</button>}</section>

        {generating && <div className="motion-generating"><span><Loader2 className="spin" />{getMotionDramaPromptDefinitionV1(currentStage??(promptKind==='image'?'image-prompts':'video-prompts')).profession}正在生成，最长等待 120 秒</span><button onClick={() => activeGeneration.current?.abort()}><X />取消</button></div>}
        {tasks.length>0&&<section className="mm-tasks"><h4>待处理素材任务</h4>{tasks.map(task=><div key={task.id}><span>#{task.id} · {getMotionDramaPromptDefinitionV1(task.stage).label} · {task.resuming?'等待恢复采纳':task.status==='awaiting_confirmation'?'等待确认':task.status}</span>{task.resuming&&<button disabled={busy} onClick={()=>void act(async()=>{await adoptMotionDramaProfessionalCandidateV1({scope,runId:task.id});setCandidate(null)})}>继续采纳</button>}</div>)}</section>}
        {currentStage&&currentStage!=='quality-review'&&<div className="mm-edit-actions"><button disabled={busy||!!candidate||!sourceReady} onClick={()=>void openManual(currentStage)}>编辑本页内容</button><small>编辑草稿先保存，确认后进入正式素材；上游修改后需重新编译工具包。</small></div>}
        {page==='episodes'&&<section className="mm-episode-grid">{Array.from({length:targetSpec?.episodeCount??1},(_,i)=>{const ep=snapshot.episodes.find(row=>row.episodeNumber===i+1);return <article key={i}><h4>第 {i+1} 集 · {ep?.title??'尚未规划'}</h4><p>{ep?.logline??'选择这一集，准备节拍与单集内容。'}</p><p>{ep?.continuityOut.join('；')}</p><button onClick={()=>void act(async()=>{await setCurrentMotionDramaEpisodeV1({scope,episodeNumber:i+1,expectedRevision:snapshot.production.revision});navigate(`/motion/beats?work=${scope.workId}`)})}>打开本集</button></article>})}</section>}
        {page==='prompts'&&<section className="lf-paper"><h3>专业岗位提示词</h3><p>系列、物料、节拍、剧本、分镜、画面、运动、审查分别维护提示词；支持默认与单集覆盖。</p><button onClick={()=>setShowPromptLibrary(true)}>打开提示词设置</button></section>}
        {snapshot.sourceFreshness.status !== 'unchanged' && <div className="motion-warning"><AlertTriangle /><div><strong>来源小说已有修改</strong><p>当前版本与原著已有差异。继续制作前需明确同步；同步会清空素材草稿，请先备份。已有交付版本保留。</p></div><button onClick={()=>void syncSource()}>同步并重建</button></div>}
        {!sourceReady && <div className="motion-warning"><BookOpenText /><div><strong>先完成小说，再进入漫剧改编</strong><p>当前只冻结了一句话/大纲创意。请在“小说来源”打开短篇工作台完成正文；保存后回到这里显式同步，系列圣经及后续生成才会解锁。</p></div>{view !== 'source' && <button onClick={()=>page?navigate(`/motion/source?work=${scope.workId}`):setView('source')}>去写小说</button>}</div>}

        {view === 'source' && page!=='prompts' && <section className="motion-source-panel"><div className="motion-source-summary"><span><Archive />FROZEN MANIFEST v{snapshot.adaptation.activeSourceManifestVersion}</span><h4>{sourceWork?.title ?? '来源小说'}</h4><p>{sourceWork?.description || '来源小说内容由独立小说 Work 拥有。'}</p><dl><div><dt>覆盖</dt><dd>{snapshot.adaptation.sourceCoverage === 'full-text' ? '完整正文' : '大纲来源'}</dd></div><div><dt>关系</dt><dd>显式冻结 · 不自动同步</dd></div><div><dt>归属</dt><dd>来源小说保持原 owner</dd></div></dl><button className="motion-secondary" onClick={() => setShowSourceStudio(value => !value)}><BookOpenText />{showSourceStudio ? '收起小说工作台' : '创作 / 修改来源小说'}</button></div>{units.length>0&&<details className="mm-source-units"><summary>查看冻结来源 · {units.length} 个片段</summary>{units.map(unit=><article key={unit.sourceUnitKey}><h4>{unit.label}</h4><p>{unit.summary}</p><small>{unit.wordCount} 字 · 来源版本 {unit.manifestVersion}</small></article>)}</details>}{showSourceStudio && sourceWork && <div className="motion-embedded-novel"><Suspense fallback={<div className="motion-loading">小说工作台加载中…</div>}>{sourceWork.novelProfile==='short'?<ShortNovelStudio structured project={sourceProject} scope={sourceScope}/>:<div className="lf-paper"><h4>在长篇工作台编辑原著</h4><p>编辑完成后回到漫剧素材，检查并同步来源版本。</p><Link onClick={e=>{e.preventDefault();void import('../../lib/workspace/works').then(m=>m.switchActiveWork(scope.projectId,sourceWork.id!)).then(()=>navigate(`/workspace/${scope.projectId}?module=info`)).catch(c=>setError(String(c)))}} to={`/workspace/${scope.projectId}?module=info`}>打开长篇原著</Link></div>}</Suspense></div>}</section>}

        {view === 'series-bible' && page!=='episodes' && <section className="motion-bible">{snapshot.seriesBibleRecord ? <><div className="motion-promise"><span>SERIES PROMISE · v{snapshot.seriesBibleRecord.version}</span><h4>{snapshot.seriesBibleRecord.bible.titlePromise}</h4><p>{snapshot.seriesBibleRecord.bible.logline}</p></div><div className="motion-bible-grid"><article><small>故事引擎</small><p>{snapshot.seriesBibleRecord.bible.storyEngine}</p></article><article><small>整季弧线</small><p>{snapshot.seriesBibleRecord.bible.seasonArc}</p></article><article><small>主人公弧</small><p>{snapshot.seriesBibleRecord.bible.protagonistArc}</p></article><article><small>单集结构</small><p>{snapshot.seriesBibleRecord.bible.episodeArchitecture}</p></article></div><div className="motion-chip-groups"><div><strong>追更钩子</strong>{snapshot.seriesBibleRecord.bible.hookPatterns.map(item => <span key={item}>{item}</span>)}</div><div><strong>连续性锁</strong>{snapshot.seriesBibleRecord.bible.continuityRules.map(item => <span key={item}>{item}</span>)}</div></div></> : <EmptyStage icon={Library} title="先建立系列圣经" text="锁定观众承诺、整季弧线、可持续故事引擎、视听语言和连续性规则。" />}</section>}

        {view === 'asset-bible' && <section><div className="mm-material-filters"><label>物料分类<select aria-label="物料分类" value={assetFilter} onChange={e=>setAssetFilter(e.target.value)}>{[['all','全部'],['style','画风'],['character','角色'],['costume','服装'],['location','场景'],['prop','道具'],['voice','音色'],['sound','声音']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><input aria-label="搜索物料" placeholder="搜索名称或定义" value={assetSearch} onChange={e=>setAssetSearch(e.target.value)}/></div><div className="motion-rights"><label><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} />我确认上传素材拥有商业使用与随项目包再分发权利</label><span>图片和试听音频都会校验真实文件签名、记录哈希并锁定为可追溯版本。</span></div>{snapshot.assets.length ? <div className="motion-assets">{snapshot.assets.filter(subject=>(assetFilter==='all'||subject.kind===assetFilter)&&`${subject.label} ${subject.identity}`.includes(assetSearch)).map(subject => { const actual = snapshot.assetVersions.find(version => version.stableKey === subject.selectedVersionKey && version.blobObjectId != null); const isAudio = subject.kind === 'voice' || subject.kind === 'sound'; return <article key={subject.stableKey}><div className={`motion-asset-visual ${isAudio ? 'audio' : ''}`}>{previewUrls[subject.stableKey] ? isAudio ? <audio src={previewUrls[subject.stableKey]} controls preload="metadata" aria-label={`${subject.label} 试听参考`} /> : <img src={previewUrls[subject.stableKey]} alt={`${subject.label} 参考`} /> : <span>{isAudio ? 'SOUND' : subject.kind.toUpperCase()}</span>}<em>{actual ? 'REFERENCE LOCKED' : 'PROMPT ONLY'}</em></div><div className="motion-asset-copy"><small>{subject.kind} · {subject.stableKey}</small><h4>{subject.label}</h4><p>{subject.identity}</p><button disabled={busy} onClick={()=>void dialog.confirm({title:'删除这项物料？',message:'仅删除未被剧本、镜头引用的草稿物料；已冻结的素材交付版本保留。',confirmText:'删除物料'}).then(ok=>{if(ok)void act(()=>removeMotionMaterialSubject({scope,subjectKey:subject.stableKey,expectedRevision:snapshot.production.revision}))})}>删除物料</button><details><summary>外观与素材提示词</summary><p>{subject.appearance}</p><p>{subject.basePrompt}</p><p>{subject.negativePrompt}</p><p>{subject.referenceBrief}</p></details><label>参考版本<select aria-label={`${subject.label} 参考版本`} value={subject.selectedVersionKey??''} disabled={busy} onChange={e=>void act(()=>selectMotionMaterialReference({scope,subjectKey:subject.stableKey,versionKey:e.target.value||null,expectedRevision:snapshot.production.revision}))}><option value="">未选择实际参考</option>{snapshot.assetVersions.filter(v=>v.subjectKey===subject.stableKey&&v.blobObjectId!=null).map(v=><option key={v.stableKey} value={v.stableKey}>v{v.version} · {v.referenceNotes||'作者上传'}</option>)}</select></label><div>{subject.continuityLocks.map(lock => <span key={lock}>{lock}</span>)}</div><label className={rightsConfirmed ? 'motion-upload' : 'motion-upload disabled'}><Upload />{isAudio ? '上传试听参考' : '上传定稿参考'}<input type="file" accept={isAudio ? 'audio/mpeg,audio/wav,audio/ogg,audio/mp4,.mp3,.wav,.ogg,.m4a' : 'image/png,image/jpeg,image/webp'} disabled={!rightsConfirmed || busy} onChange={event => uploadSubject(subject.stableKey, event.target.files?.[0])} /></label></div></article> })}</div> : <EmptyStage icon={Boxes} title="生成系列物料圣经" text="角色身份与服装分开版本化；场景、道具、统一画风、音色与环境声音一次建立、逐集复用。" />}</section>}

        {view === 'episode-outline' && (episode ? <section className="motion-episode"><div className="motion-episode-title"><span>EP {String(episode.episodeNumber).padStart(2, '0')}</span><div><h4>{episode.title}</h4><p>{episode.logline}</p></div><strong>{episode.beats.reduce((sum, beat) => sum + beat.targetSeconds, 0)}s</strong></div><div className="motion-hook"><strong>OPEN</strong><p>{episode.openingHook}</p></div><div className="motion-beats">{episode.beats.map((beat, index) => <article key={beat.stableKey}><span>{String(index + 1).padStart(2, '0')}</span><div><small>{beat.function} · {beat.targetSeconds}s</small><h5>{beat.visibleAction}</h5><p>{beat.conflict}</p><em>{beat.turn}</em></div></article>)}</div><div className="motion-hook end"><strong>NEXT</strong><p>{episode.endHook}</p></div></section> : <EmptyStage icon={Layers3} title={`设计第 ${snapshot.production.currentEpisodeNumber} 集`} text="用冷开场、压力升级、反转兑现和尾钩构成可追更的单集时间合同。" />)}

        {view === 'episode-script' && (scenes.length ? <section className="motion-scenes">{scenes.map(scene => <article key={scene.stableKey}><header><span>{String(scene.sceneNumber).padStart(2, '0')}</span><div><small>{scene.heading}</small><h4>{scene.dramaticPurpose}</h4></div><strong>{scene.estimatedSeconds}s</strong></header><p className="motion-action">{scene.visibleAction}</p><div className="motion-dialogue">{scene.dialogue.map((line, index) => <p key={`${line.speakerKey}-${index}`}><strong>{line.speakerKey}</strong><span>{line.text}</span><em>{line.delivery}</em></p>)}</div><footer><span>IN · {scene.entryState}</span><ChevronRight /><span>OUT · {scene.exitState}</span></footer></article>)}</section> : <EmptyStage icon={Clapperboard} title="把单集节拍写成漫剧剧本" text="每场都要有状态变化；动作可见，对白可演，旁白克制，声音带时间意图。" />)}

        {view==='shot-design'&&<section><div className="motion-rights"><label><input type="checkbox" checked={rightsConfirmed} onChange={e=>setRightsConfirmed(e.target.checked)}/>我确认上传参考帧拥有商业使用与随素材包再分发权利</label><p>确认后可上传首帧、关键帧和尾帧；每次上传保留历史参考，已交付版本不变。</p></div>{shots.length?<div className="motion-storyboard">{shots.map(shot=><article key={shot.stableKey}><div className="motion-shot-copy"><small>镜头 {shot.shotNumber} · {shot.targetSeconds} 秒 · {shot.shotSize}</small><h4>{shot.visibleAction}</h4><p>{shot.composition}</p><p>{shot.performance}</p><p>{shot.lighting}</p><p>{shot.dialogue}</p><div className="mm-frames">{(['start-frame','key-frame','end-frame'] as const).map((role,i)=>{const rows=snapshot.shotReferences.filter(row=>row.shotKey===shot.stableKey&&row.role===role);const selected=rows.find(row=>row.selected);const label=['起始帧','关键帧','结束帧'][i];return <section key={role}><h5>{label}</h5>{selected&&previewUrls[selected.stableKey]?<img src={previewUrls[selected.stableKey]} alt={`镜头 ${shot.shotNumber} ${label}`}/>:<div className="mm-frame-empty">尚未选择{label}</div>}<p>{[shot.firstFramePrompt,shot.keyFramePrompt,shot.lastFramePrompt][i]||'尚未准备画面提示词'}</p><select aria-label={`镜头 ${shot.shotNumber} ${label}版本`} value={selected?.stableKey??''} disabled={busy} onChange={e=>void act(()=>selectMotionFrameReference({scope,shotKey:shot.stableKey,role,referenceKey:e.target.value||null,expectedRevision:snapshot.production.revision}))}><option value="">不使用参考</option>{rows.map((row,j)=><option key={row.stableKey} value={row.stableKey}>参考 {j+1} · {new Date(row.createdAt).toLocaleString()}</option>)}</select><label className="motion-upload">上传{label}<input aria-label={`上传镜头 ${shot.shotNumber} ${label}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={!rightsConfirmed||busy} onChange={e=>uploadFrame(shot.stableKey,e.target.files?.[0],role)}/></label></section>})}</div></div></article>)}</div>:<EmptyStage icon={Film} title="还没有分镜" text="准备单集剧本后，生成或手动编写分镜，再逐镜完善参考帧。"/>}</section>}


        {view === 'prompt-pack' && page!=='image' && page!=='video' && <section className="motion-pack-stage">
          <div className="motion-ir-switch"><button className={promptKind === 'image' ? 'active' : ''} onClick={() => setPromptKind('image')}>1 · Image Prompt IR</button><button className={promptKind === 'video' ? 'active' : ''} onClick={() => setPromptKind('video')}>2 · Video Prompt IR</button><span>{shots.filter(shot => promptKind === 'image' ? shot.imagePrompt : shot.videoPrompt).length}/{shots.length} 镜完成</span></div>
          <p className="motion-pack-intro">先确认画面与运动提示词，再整理上传顺序、镜头时序、前后衔接及返修要求。将提示词与参考素材交给外部工具后，再进行视频生成。</p>
          <div className="motion-provider-grid">{(targetSpec?.providerTargets ?? []).map(provider => {
            const pack = snapshot.promptPacks.filter(row => row.episodeNumber === snapshot.production.currentEpisodeNumber && row.provider === provider).sort((a, b) => b.version - a.version)[0]
            const manifest = packManifests[provider]
            const direct = manifest?.version === 2 && manifest.directUseReady
            return <article key={provider}><span>{provider.toUpperCase()}</span><h4>{provider === 'seedance' ? '生产执行包 v2' : provider === 'runway' ? '参考图 + 运动指令包' : provider === 'ltx' ? 'Elements + Storyboard 包' : '厂商中立逐镜包'}</h4><p>{pack ? `v${pack.version} · ${direct ? '可直接投喂' : pack.maturity === 'reference-ready' ? '参考物料就绪' : '提示词与待补物料'}` : '尚未编译当前集'}</p>{provider === 'seedance' && <select aria-label="Seedance 能力画像" value={seedanceProfileId} onChange={event => setSeedanceProfileId(event.target.value as SeedanceProviderProfileId)}><option value="seedance-2.5-2026-07">Seedance 2.5 · 30s / 30图</option><option value="seedance-2.0-2026-02">Seedance 2.0 兼容 · 15s / 9图</option></select>}<div><button onClick={() => compilePack(provider)} disabled={busy || shots.some(shot => !shot.imagePrompt || !shot.videoPrompt)}><RefreshCw />{pack ? '重新编译' : '编译适配包'}</button><button onClick={() => void exportLatestPack(provider)} disabled={!pack}><Download />导出</button></div></article>
          })}</div>

          {seedanceManifest && <section className="motion-execution-pack" aria-label="Seedance 生产执行包">
            <header><div><span>SEEDANCE EXECUTION PACK · SCHEMA V2</span><h4>逐镜生成、选片与交接运行单</h4><p>{seedanceManifest.providerProfile.label} · {seedanceManifest.target.aspectRatio} · 最长 {seedanceManifest.providerProfile.limits.maxDurationSeconds}s / 次 · 最多 {seedanceManifest.providerProfile.limits.maxImages} 图 + {seedanceManifest.providerProfile.limits.maxAudios} 音频</p></div><strong className={seedanceManifest.directUseReady ? 'ready' : ''}>{seedanceManifest.directUseReady ? '可直接投喂' : '待补参考物料'}</strong></header>
            <ol className="motion-run-checklist">{seedanceManifest.executionPlan.operatorChecklist.map(item => <li key={item}>{item}</li>)}</ol>
            <div className="motion-execution-shots">{seedanceManifest.shots.map((shot, index) => <article key={shot.shotKey}>
              <header><span>SHOT {String(index + 1).padStart(2, '0')}</span><div><strong>{shot.durationSeconds}s · {shot.generation.candidateCount} 个候选</strong><small>{shot.continuity.strategy} · {shot.generation.mode}</small></div><em className={shot.directUseReady ? 'ready' : ''}>{shot.directUseReady ? 'READY' : 'MATERIALS PENDING'}</em></header>
              <div className="motion-slot-map"><strong>上传顺序</strong>{shot.providerInputs.map(input => <div key={input.slot} className={input.ready ? 'ready' : ''}><span>{input.uploadOrder}</span><b>{input.slot}</b><p>{input.purpose}</p><em>{input.ready ? '已就绪' : '待补'}</em></div>)}</div>
              <div className="motion-handoff"><strong>镜间交接</strong><p>{shot.continuity.operatorInstruction}</p><small>{shot.continuity.transition}</small></div>
              <details open><summary>可直接复制的 Seedance 提示词 <button aria-label={`复制镜头 ${index + 1} Seedance 提示词`} onClick={event => { event.preventDefault(); void copyProviderPrompt(shot.shotKey, shot.providerPrompt) }}><Copy />{copiedShotKey === shot.shotKey ? '已复制' : '复制'}</button></summary><pre>{shot.providerPrompt}</pre></details>
              <details><summary>候选验收清单</summary><ul>{shot.generation.selectionChecks.map(check => <li key={check}>{check}</li>)}</ul></details>
              <details><summary>定点返修指令</summary><dl><div><dt>身份漂移</dt><dd>{shot.retryPrompts.identityDrift}</dd></div><div><dt>动作失败</dt><dd>{shot.retryPrompts.motionFailure}</dd></div><div><dt>衔接失败</dt><dd>{shot.retryPrompts.continuityFailure}</dd></div></dl></details>
            </article>)}</div>
          </section>}
        </section>}

        {(page==='image'||page==='video')&&<section className="mm-ir-list">{shots.length?shots.map(shot=><article key={shot.stableKey}><h4>镜头 {shot.shotNumber} · {shot.visibleAction}</h4>{(page==='image'?[['画面提示词',shot.imagePrompt],['画面负向约束',shot.negativeImagePrompt],['起始帧',shot.firstFramePrompt],['关键帧',shot.keyFramePrompt],['结束帧',shot.lastFramePrompt]]:[['运动提示词',shot.videoPrompt],['运动负向约束',shot.negativeVideoPrompt]]).map(([label,text])=><div key={label}><h5>{label}</h5><p>{text||'尚未填写'}</p></div>)}</article>):<p>先准备单集分镜，再生成或编辑逐镜提示词。</p>}</section>}
        {view === 'quality-review' && <section className="motion-review"><div className={`motion-quality-score ${quality?.ready ? 'ready' : ''}`}><div><small>DELIVERY READINESS</small><strong>{Math.round((quality?.metrics.promptCoverage ?? 0) * 100)}%</strong></div><dl><div><dt>场景</dt><dd>{quality?.metrics.sceneCount ?? 0}</dd></div><div><dt>镜头</dt><dd>{quality?.metrics.shotCount ?? 0}</dd></div><div><dt>时长</dt><dd>{quality?.metrics.totalSeconds ?? 0}s</dd></div><div><dt>适配包</dt><dd>{quality?.metrics.providerPackCount ?? 0}</dd></div><div><dt>可直投</dt><dd>{quality?.metrics.directUseReadyProviderCount ?? 0}</dd></div></dl><span>{quality?.achievableTier === 'reference-ready' ? 'REFERENCE READY' : 'PROMPT ONLY'}</span></div>{quality?.blockers.length ? <div className="motion-issues blockers"><h4>交付前待完成</h4>{quality.blockers.map(item => <p key={item}><AlertTriangle />{item}</p>)}</div> : <div className="motion-quality-pass"><PackageCheck /><div><strong>当前集通过结构与引用检查</strong><p>工具适配包已通过结构与能力校验；仍需在目标工具内逐镜生成、选片和定点返修。</p></div></div>}{quality?.warnings.length? <div className="motion-warning"><div><h4>仍需注意</h4>{quality.warnings.map(w=><p key={w}>{w}</p>)}</div></div>:null}{snapshot.reviewIssues.filter(issue => issue.episodeNumber === snapshot.production.currentEpisodeNumber).length > 0 && <div className="motion-issue-list">{snapshot.reviewIssues.filter(issue => issue.episodeNumber === snapshot.production.currentEpisodeNumber).map(issue => <article key={issue.stableKey} className={issue.severity}><span>{issue.severity} · {issue.category}</span><h4>{issue.problem}</h4><p>{issue.evidence}</p><em>{issue.suggestion}</em>{issue.status === 'open' && <div><button onClick={() => void act(() => updateMotionDramaReviewIssueStatusV1({ scope, issueId: issue.id!, status: 'resolved', expectedProductionRevision: snapshot.production.revision }))}>标记已解决</button><button onClick={() => void act(() => updateMotionDramaReviewIssueStatusV1({ scope, issueId: issue.id!, status: 'dismissed', expectedProductionRevision: snapshot.production.revision }))}>忽略</button></div>}</article>)}</div>}<div className="motion-release-actions"><label>交付范围<select aria-label="交付范围" value={deliveryRange} onChange={e=>setDeliveryRange(e.target.value)}><option value="current">当前集</option><option value="all">整季（逐集检查）</option></select></label><button className="motion-primary" disabled={!quality?.ready || busy} onClick={() => publish('prompt-only')}><PackageCheck />保存提示词交付版</button><button className="motion-primary accent" disabled={!quality?.ready || quality?.achievableTier !== 'reference-ready' || busy} onClick={() => publish('reference-ready')}><Image />保存含参考素材交付版</button></div>{releases.length > 0 && <div className="motion-releases"><h4>已冻结的素材版本</h4>{releases.map(release=><article className="mm-release" key={release.id}><strong>v{release.version} · {release.label}</strong><small>{new Date(release.createdAt).toLocaleString()}</small><button onClick={()=>void exportRelease(release)}>清单 JSON</button><button onClick={()=>void exportBundle(release)}>下载提示词与素材 ZIP</button><button onClick={()=>void readMotionDramaReleaseManifestV1(scope,release.id!).then(value=>setReleasePreview(JSON.stringify(value,null,2))).catch(c=>setError(String(c)))}>查看冻结内容</button></article>)}</div>}</section>}

        {currentStage && <section className="motion-author-note"><label>给当前岗位的附加要求<textarea value={authorInstruction} onChange={event=>{setAuthorInstruction(event.target.value);void saveMotionAuthorDraft(scope,`instruction:${currentStage}:${snapshot.production.currentEpisodeNumber}`,event.target.value).catch(c=>setError(String(c)))}} placeholder="例如：保持克制写实；第 3 个节拍必须用无对白动作完成。留空则使用提示词库。" /></label><button onClick={() => { setPromptEditorStage(currentStage); setShowPromptLibrary(true) }}><Library />查看当前提示词</button></section>}
      </main>
    </div>

    {!page&&<MotionDramaShowcase />}

    {candidate && <div className="motion-candidate-backdrop"><aside className="motion-candidate"><header><div><span>CANDIDATE · NOT ADOPTED</span><h3>{getMotionDramaPromptDefinitionV1(candidate.stage).label}候选</h3><p>逐项检查和修改，确认后写入素材；编辑草稿会自动保存。</p></div><button disabled={candidate.resuming} onClick={() => void rejectCandidate()}><X /></button></header><div className="mm-candidate-content">{candidate.stage==='asset-bible'&&<p>物料按编号逐项更新；移出本次更新不会删除已有物料。正式删除请使用物料卡片的删除入口。</p>}<fieldset disabled={busy||candidate.resuming}>{(()=>{try{return <MotionFields removalLabel={candidate.stage==='asset-bible'?'移出本次更新':undefined} value={JSON.parse(candidate.text)} onChange={value=>editCandidate(JSON.stringify(value,null,2))}/> }catch{return <p>高级 JSON 格式无效，请修正后切回表单。</p>}})()}<details><summary>高级 JSON</summary><textarea aria-label="候选 JSON" value={candidate.text} onChange={event=>editCandidate(event.target.value)} spellCheck={false}/></details></fieldset><p role="status">{candidate.resuming?'作者意图已冻结，继续采纳不会重新调用模型':draftStatus}</p></div><footer><button onClick={() => void rejectCandidate()} disabled={busy||candidate.resuming}>关闭候选</button><button className="motion-primary" onClick={() => void acceptCandidate()} disabled={busy}><Check />{candidate.resuming?'继续采纳':'确认写入'}</button></footer></aside></div>}

    {showPromptLibrary && <div className="motion-candidate-backdrop"><aside className="motion-prompt-library"><header><div><span>PROMPT LIBRARY</span><h3>漫剧专业提示词库</h3><p>优先级：单集覆盖 ＞ 项目覆盖 ＞ 内置专业基线</p></div><button onClick={() => setShowPromptLibrary(false)}><X /></button></header><div className="motion-prompt-controls"><select value={promptEditorStage} onChange={event => setPromptEditorStage(event.target.value as MotionDramaPromptStageV1)}>{(['series-bible', 'asset-bible', 'episode-outline', 'episode-script', 'shot-design', 'image-prompts', 'video-prompts', 'quality-review'] as MotionDramaPromptStageV1[]).map(stage => <option key={stage} value={stage}>{getMotionDramaPromptDefinitionV1(stage).label} · {getMotionDramaPromptDefinitionV1(stage).profession}</option>)}</select><select value={promptEditorScope} onChange={event => setPromptEditorScope(event.target.value as 'work' | 'episode')}><option value="work">整个项目</option><option value="episode">仅第 {snapshot.production.currentEpisodeNumber} 集</option></select></div><div className="motion-prompt-meta"><span>当前生效：{resolvedPrompt?.source === 'built-in' ? '内置基线' : resolvedPrompt?.source === 'work' ? '项目覆盖' : '单集覆盖'}</span><span>用途：{getMotionDramaPromptDefinitionV1(promptEditorStage).purpose}</span></div><label>历史版本<select aria-label="提示词历史" value={selectedHistory} onChange={e=>setSelectedHistory(e.target.value)}><option value="">选择历史版本对照</option>{promptHistory.map(h=><option key={h.key} value={h.key}>{new Date(Number(h.key)).toLocaleString()}</option>)}</select></label>{selectedHistory&&<details open><summary>历史提示词</summary><pre>{promptHistory.find(h=>h.key===selectedHistory)?.text}</pre><button onClick={()=>setPromptEditorText(promptHistory.find(h=>h.key===selectedHistory)?.text??promptEditorText)}>载入历史内容（保存后生效）</button></details>}<textarea value={promptEditorText} onChange={event => setPromptEditorText(event.target.value)} spellCheck={false} /><footer><button onClick={() => void resetPrompt()} disabled={busy}><RefreshCw />恢复下一级基线</button><button className="motion-primary" onClick={() => void savePrompt()} disabled={busy || !promptEditorText.trim()}><Save />保存覆盖提示词</button></footer></aside></div>}

    {releasePreview&&<div className="motion-candidate-backdrop"><aside className="motion-prompt-library"><header><h3>冻结的素材内容</h3><button onClick={()=>setReleasePreview(null)}>关闭</button></header><pre>{releasePreview}</pre></aside></div>}
    {error && <div className="motion-error" role="alert"><AlertTriangle />{error}<button onClick={() => setError('')}><X /></button></div>}
  </div>
}

function EmptyStage({ icon: Icon, title, text }: { icon: typeof Library; title: string; text: string }) {
  return <div className="motion-empty"><span><Icon /></span><h4>{title}</h4><p>{text}</p><em>点击右上角“生成专业候选”开始；模型输出不会自动写入。</em></div>
}
