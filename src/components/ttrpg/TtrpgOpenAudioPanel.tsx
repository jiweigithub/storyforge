import { useCallback, useEffect, useRef, useState } from 'react'
import { readTtrpgOpenAudioDeskV1, prepareTtrpgOpenAudioUploadV1, prepareTtrpgOpenRetainedAudioV1, confirmTtrpgOpenAudioReviewV1,
  readTtrpgOpenAudioClipV1, type TtrpgOpenAudioDeskInputV1, type TtrpgOpenAudioDeskV1, type TtrpgOpenAudioReviewV1 } from '../../lib/ttrpg/open-audio-service'
import type { TtrpgAudioAudienceV1, TtrpgAudioChannelV1 } from '../../lib/ttrpg/open-audio-runtime'
import type { TtrpgOpenAudioRequestV1 } from '../../lib/ttrpg/open-audio-contract'
import TtrpgOpenAudioPlayer, { type TtrpgLocalAudioStopV1 } from './TtrpgOpenAudioPlayer'
import { rememberTtrpgAudioPositionV1 } from '../../lib/ttrpg/open-audio-playback'

const channels: Record<TtrpgAudioChannelV1, string> = { music: '背景音乐', ambience: '环境声', sfx: '音效', voice: '配音' }
const audiences: Record<TtrpgAudioAudienceV1, string> = { public: '公开', party: '本次全队', private: '指定角色', 'gm-only': '仅主持' }
function duration(file: File, signal: AbortSignal): Promise<number | null> {
  return new Promise(resolve => {
    const element = document.createElement('audio'), url = URL.createObjectURL(file)
    const finish = (value: number | null) => { clearTimeout(timer); element.onloadedmetadata = null; element.onerror = null; signal.removeEventListener('abort', abort); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); resolve(value) }
    const abort = () => finish(null), timer = setTimeout(() => finish(null), 10000)
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? Math.round(element.duration * 1000) : null)
    element.onerror = () => finish(null); signal.addEventListener('abort', abort, { once: true })
    element.preload = 'metadata'; element.src = url
  })
}
export default function TtrpgOpenAudioPanel(props: {
  input: TtrpgOpenAudioDeskInputV1; sequence: number; paused: boolean; busy: boolean; onChanged: () => Promise<void>
}) {
  const { projectId, worldId, workId } = props.input.scope, { sessionId, viewerKey } = props.input
  const identity = `${projectId}:${worldId}:${workId}:${sessionId}:${viewerKey}`, currentIdentity = useRef({ identity })
  // A return to the same seat is still a new visit. Earlier promises must not
  // restore its cleared review or unlock a new visit's operation.
  if (currentIdentity.current.identity !== identity) currentIdentity.current = { identity }
  const [page, setPage] = useState<{ identity: string; value: TtrpgOpenAudioDeskV1 } | null>(null), [enabled, setEnabled] = useState(false)
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [review, setReview] = useState<{ identity: string; value: TtrpgOpenAudioReviewV1 } | null>(null), [agreed, setAgreed] = useState(false)
  const [channel, setChannel] = useState<TtrpgAudioChannelV1>('music'), [audience, setAudience] = useState<TtrpgAudioAudienceV1>('party'), [actor, setActor] = useState('')
  const [cause, setCause] = useState(''), [file, setFile] = useState<File | null>(null), [durationMs, setDurationMs] = useState<number | null>(null)
  const [source, setSource] = useState(''), [license, setLicense] = useState(''), [voiceChecked, setVoiceChecked] = useState(false), [fadeMs, setFadeMs] = useState(0)
  const [urls, setUrls] = useState<Record<string, string>>({}), [clipFailures, setClipFailures] = useState<Record<string, boolean>>({}), [reload, setReload] = useState(0)
  const revision = useRef(0), live = useRef(false), operationLocked = useRef(false), clips = useRef(new Map<string, string>()), elements = useRef(new Map<string, TtrpgLocalAudioStopV1>()), bookmarks = useRef(new Map<string, number>()), fileRead = useRef<AbortController | null>(null)
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const visit = currentIdentity.current
  const remember = useCallback((key: string, seconds: number) => { if (currentIdentity.current === visit) rememberTtrpgAudioPositionV1(bookmarks.current, key, seconds) }, [visit])
  const releaseLocal = useCallback(() => {
    for (const stop of elements.current.values()) stop()
    for (const url of clips.current.values()) URL.revokeObjectURL(url)
    clips.current.clear()
  }, [])
  const stopLocal = useCallback(() => { releaseLocal(); setUrls({}) }, [releaseLocal])
  const register = useCallback((key: string, stop: TtrpgLocalAudioStopV1 | null) => { if (stop) elements.current.set(key, stop); else elements.current.delete(key) }, [])
  const refresh = useCallback(async () => {
    const owner = currentIdentity.current
    if (owner.identity !== identity) return
    const token = ++revision.current
    try {
      const value = await readTtrpgOpenAudioDeskV1(input())
      if (live.current && revision.current === token && currentIdentity.current === owner) { setPage({ identity, value }); setError('') }
    } catch {
      if (live.current && revision.current === token && currentIdentity.current === owner) { setPage(null); setEnabled(false); stopLocal(); setError('音频资料暂不可读取，请重新读取或核对原存档。') }
    }
  }, [identity, input, stopLocal])
  useEffect(() => {
    live.current = true; operationLocked.current = false
    setPage(null); setEnabled(false); setReview(null); setAgreed(false); setWorking(false); setError(''); setNotice('')
    setFile(null); setDurationMs(null); setSource(''); setLicense(''); setCause(''); setActor(''); setChannel('music'); setAudience('party'); setVoiceChecked(false); setFadeMs(0); bookmarks.current.clear()
    fileRead.current?.abort(); stopLocal()
    return () => { live.current = false; fileRead.current?.abort(); releaseLocal() }
  }, [identity, releaseLocal, stopLocal])
  useEffect(() => { void refresh() }, [props.sequence, refresh])
  const view = page?.identity === identity ? page.value : null, pending = review?.identity === identity ? review.value : null
  const currentTracks = useRef<TtrpgOpenAudioDeskV1['tracks']>([])
  currentTracks.current = view?.tracks ?? []
  const silenced = props.paused || view?.paused !== false, trackKey = view?.tracks.map(track => track.clipKey).join('|') ?? ''
  useEffect(() => {
    let cancelled = false
    const owner = currentIdentity.current
    const tracks = currentTracks.current
    if (!enabled || silenced) { stopLocal(); return }
    const active = new Set(tracks.map(track => track.clipKey))
    for (const [key, url] of clips.current) if (!active.has(key)) { URL.revokeObjectURL(url); clips.current.delete(key) }
    setUrls(Object.fromEntries(clips.current)); setClipFailures({})
    for (const track of tracks) if (!clips.current.has(track.clipKey)) {
      void readTtrpgOpenAudioClipV1({ ...input(), sourceRef: track.sourceRef, expectedClipKey: track.clipKey }).then(result => {
        if (cancelled || currentIdentity.current !== owner) return
        const url = URL.createObjectURL(result.blob); clips.current.set(track.clipKey, url); setUrls(Object.fromEntries(clips.current))
      }).catch(() => { if (!cancelled && currentIdentity.current === owner) setClipFailures(old => ({ ...old, [track.clipKey]: true })) })
    }
    return () => { cancelled = true }
    // Sequence-only game updates keep unchanged authorized tracks playing.
  }, [identity, enabled, silenced, trackKey, reload, input, stopLocal])
  const resetReview = () => { setReview(null); setAgreed(false); setError(''); setNotice('') }
  async function perform(job: () => Promise<void>) {
    if (!live.current || operationLocked.current) return
    operationLocked.current = true
    const owner = currentIdentity.current
    setWorking(true); setError(''); setNotice('')
    try { await job() } catch { if (live.current && currentIdentity.current === owner) setError('音频操作未完成。请核对原文件、接收者和当前进度；已保存的规则结果不受影响。') }
    finally { if (live.current && currentIdentity.current === owner) { operationLocked.current = false; setWorking(false) } }
  }
  const selectedCause = view?.causes.find(row => JSON.stringify(row.sourceRef) === cause)
  const prepareFile = () => perform(async () => {
    if (!file || !selectedCause) return
    const owner = currentIdentity.current, submissionKey = `audio.upload.${crypto.randomUUID()}`
    const request: TtrpgOpenAudioRequestV1 = { action: 'play', channel, audience, privateActorKey: audience === 'private' ? actor : null,
      narrationSourceRef: selectedCause.sourceRef, fade: channel === 'voice' ? 0 : fadeMs, media: { kind: 'upload', submissionKey }, voiceTimeline: channel === 'voice' && durationMs ? {
        granularity: 'char', speakerVoiceId: 'voice.uploaded', styleKey: null, styleDegree: null,
        marks: [{ textOffset: 0, textLength: selectedCause.text.length, startMs: 0, durationMs }] } : null }
    const value = await prepareTtrpgOpenAudioUploadV1({ ...input(), request, file, name: file.name, source, license, durationMs, decision: 'prepare-this-file-for-reviewed-audio' })
    if (live.current && currentIdentity.current === owner) { setReview({ identity, value }); setAgreed(false) }
  })
  const prepareSaved = (sourceRef: TtrpgOpenAudioDeskV1['tracks'][number]['sourceRef'], action: 'play' | 'stop') => perform(async () => {
    const owner = currentIdentity.current, value = await prepareTtrpgOpenRetainedAudioV1({ ...input(), sourceRef, action, submissionKey: `audio.${action}.${crypto.randomUUID()}` })
    if (live.current && currentIdentity.current === owner) { setReview({ identity, value }); setAgreed(false) }
  })
  return <section className="sf-open-audio" data-testid="ttrpg-open-audio-panel">
    <h2>本机音频</h2>
    <p>音频可随时静音。刷新或交接身份后默认关闭，本局的文字与规则进度会保留。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="sf-open-audio-actions"><button onClick={() => { stopLocal(); setEnabled(false); setNotice('本机音频已关闭。') }}>本机静音</button>
      <button disabled={!view || silenced || enabled} onClick={() => { setClipFailures({}); setEnabled(true) }}>开启本机音频</button>
      <button disabled={working} onClick={() => void refresh()}>重新读取音轨</button></div>
    {view?.tracks.length === 0 && <p>尚未保存音轨，可继续文字游玩。</p>}
    {view?.tracks.map(track => <article key={track.clipKey} className="sf-open-audio-track">
      <h3>{channels[track.channel]} · {audiences[track.audience]}</h3>
      <TtrpgOpenAudioPlayer key={`${identity}:${track.clipKey}`} track={track} url={enabled && !silenced ? urls[track.clipKey] : undefined}
        failed={!!clipFailures[track.clipKey]} resumeSeconds={bookmarks.current.get(track.clipKey) ?? 0} register={register} remember={remember}
        onFailure={() => setClipFailures(old => ({ ...old, [track.clipKey]: true }))} />
      {clipFailures[track.clipKey] && <><p role="status">音频不可用，已保留文字说明。</p><button onClick={() => { const url = clips.current.get(track.clipKey); if (url) URL.revokeObjectURL(url); clips.current.delete(track.clipKey); setReload(value => value + 1) }}>重新加载此音轨</button></>}
      {view.humanHost && <button disabled={working || props.busy || !view.canStop} onClick={() => void prepareSaved(track.sourceRef, 'stop')}>核对停止{channels[track.channel]}</button>}
    </article>)}
    {view?.humanHost && <details><summary>主持音轨管理</summary>
      {view.unavailable && <p>{view.unavailable}</p>}
      {!pending && <fieldset disabled={working || props.busy || !view.canPlay}>
        <legend>选择文件并核对播放范围</legend>
        <label>音轨类型<select value={channel} aria-label="音轨类型" onChange={event => { resetReview(); setVoiceChecked(false); const next = event.target.value as TtrpgAudioChannelV1; setChannel(next); if (next === 'voice') setFadeMs(0); if (next === 'voice' && audience === 'public') setAudience('party') }}>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {channel !== 'voice' && <label>播放时渐入<select aria-label="音轨播放渐入" value={fadeMs} onChange={event => { resetReview(); setFadeMs(Number(event.target.value)) }}><option value={0}>立即播放</option><option value={1000}>1 秒渐入</option><option value={3000}>3 秒渐入</option></select></label>}
        <label>接收范围<select value={audience} aria-label="音频接收范围" onChange={event => { resetReview(); setAudience(event.target.value as TtrpgAudioAudienceV1) }}>{Object.entries(audiences).filter(([key]) => (key !== 'public' || channel !== 'voice') && (key === 'party' || key === 'public' || view.privateControlAllowed)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {audience === 'private' && <label>指定角色<select aria-label="音频指定角色" value={actor} onChange={event => setActor(event.target.value)}><option value="">选择角色</option>{view.players.map(row => <option key={row.actorKey} value={row.actorKey}>{row.name}</option>)}</select></label>}
        <label>本次已确认叙述<select aria-label="音频依据" value={cause} onChange={event => { setCause(event.target.value); setVoiceChecked(false) }}><option value="">选择已完成的行动</option>{view.causes.map(row => <option key={JSON.stringify(row.sourceRef)} value={JSON.stringify(row.sourceRef)}>{row.text.slice(0, 60)}</option>)}</select></label>
        {channel === 'voice' && selectedCause && <><p className="sf-open-audio-caption">{selectedCause.text}</p><p>整段字幕按文件总时长显示，须由上传者试听核对。</p>
          <label><input type="checkbox" checked={voiceChecked} onChange={event => setVoiceChecked(event.target.checked)} />我已试听并核对音频与上述文字一致。</label></>}
        <label>音频文件<input key={identity} type="file" aria-label="音频文件" accept="audio/wav,audio/mpeg,audio/ogg,.wav,.mp3,.ogg" onChange={event => {
          resetReview(); setVoiceChecked(false); fileRead.current?.abort(); const chosen = event.target.files?.[0] ?? null; setFile(chosen); setDurationMs(null)
          if (chosen) { const owner = currentIdentity.current, controller = new AbortController(); fileRead.current = controller; void duration(chosen, controller.signal).then(value => {
            if (!controller.signal.aborted && currentIdentity.current === owner && fileRead.current === controller) setDurationMs(value)
          }) }
        }} /></label>
        <label>文件来源<input aria-label="音频来源" value={source} onChange={event => setSource(event.target.value)} maxLength={5000} /></label>
        <label>许可说明<textarea aria-label="音频许可" value={license} onChange={event => setLicense(event.target.value)} maxLength={5000} /></label>
        <p>文件将保存在本团局，来源与许可由上传者声明。此处不调用供应商。</p>
        <button disabled={!file || !selectedCause || !source.trim() || !license.trim() || audience === 'private' && !actor || channel === 'voice' && (!voiceChecked || !durationMs)} onClick={() => void prepareFile()}>保存文件并核对音轨</button>
      </fieldset>}
      {pending && <section className="sf-open-audio-review" data-testid="ttrpg-open-audio-review">
        <h3>核对{pending.request.action === 'stop' ? '停止' : '播放'}{channels[pending.request.channel]}</h3>
        <p>范围：{audiences[pending.request.audience]}；本次接收者：{pending.recipients.join('、')}{pending.request.audience === 'public' ? '及公开听众' : ''}</p>
        {pending.request.action === 'play' && pending.request.channel !== 'voice' && <p>播放时渐入：{pending.request.fade ? `${pending.request.fade / 1000} 秒` : '无'}；开始播放仍由听众选择。</p>}
        {pending.asset && <><p>文件：{pending.asset.name}；版本 {pending.asset.version}</p><p>来源：{pending.asset.source}</p><p>许可：{pending.asset.license}</p></>}
        <p className="sf-open-audio-caption">{pending.request.channel === 'voice' ? pending.fallbackText : '音轨用于辅助展示，不改变本次已确认行动。'}</p>
        <label><input type="checkbox" disabled={working} checked={agreed} onChange={event => setAgreed(event.target.checked)} />我已核对文件、文字与接收范围，并确认拥有本次使用许可。</label>
        <button disabled={!agreed || working || props.busy} onClick={() => void perform(async () => {
          const owner = currentIdentity.current; await confirmTtrpgOpenAudioReviewV1({ ...input(), review: pending, decision: 'confirm-this-audio-and-audience' })
          if (live.current && currentIdentity.current === owner) {
            setReview(null); setAgreed(false); setNotice('音轨控制已保存。本机播放仍由本人开启。')
            try { await props.onChanged(); await refresh() } catch { if (live.current && currentIdentity.current === owner) setError('音轨已保存，桌面尚未刷新，请重新读取进度。') }
          }
        })}>确认本次音轨控制</button>
        <button disabled={working} onClick={resetReview}>返回重新核对</button>
      </section>}
      {view.library.length > 0 && <details><summary>本桌可读的已保存音轨</summary>{view.library.map(row => <p key={JSON.stringify(row.sourceRef)}>{row.name} · {channels[row.channel]} · {audiences[row.audience]}
        <button disabled={working || props.busy || !view.canPlay || !!pending} onClick={() => void prepareSaved(row.sourceRef, 'play')}>核对重播</button></p>)}</details>}
    </details>}
  </section>
}
