import type {ChatSchedulingModeV1} from '../../lib/character-interaction/narrative-scheduling'
import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Bot,
  Check,
  GitBranch,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  UserRound,
} from 'lucide-react'
import NarrativeMessageRetrieval from './NarrativeMessageRetrieval'
import {readChatMessageRetrievalPlanV1, type ChatMessageRetrievalPlanV1} from '../../lib/character-interaction/narrative-retrieval-service'
import NarrativeControls from './NarrativeControls'
import RunProgress from './RunProgress'
import NarrativeOptions from './NarrativeOptions'
import NarrativeHistoryOptions from './NarrativeHistoryOptions'
import NarrativeContextInspector from './NarrativeContextInspector'
import {readChatHistoricalOptionsPlanV1, type ChatHistoricalOptionsPlanV1} from '../../lib/character-interaction/narrative-options-history'
import {MessageEditPreview, PendingMessageEdit} from './NarrativeMessageEdit'
import {readChatMessageContinuationPlanV1, readChatMessageEditPlanV1, type ChatMessageEditPlanV1} from '../../lib/character-interaction/narrative-edit'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveRequestConfig } from '../../lib/ai/client'
import type { Project, WorkspaceScope } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { useCharacterInteractionPlayerStore } from '../../stores/character-interaction-player'
import {useChatComposerDraft} from './useChatComposerDraft'
import {CHAT_COMPOSER_MAX_CHARACTERS} from '../../lib/character-interaction/composer-draft-contract'

export default function CharacterInteractionPanel(props: {
  project: Project
  worldGroupId: number | null
  workspaceScope?: WorkspaceScope
  view?: "chat" | "memory" | "history"
  onSessionSelected?: (id:number|null)=>void
  initialSessionId?: number | null
}) {
  const store = useCharacterInteractionPlayerStore()
  const { config } = useAIConfigStore()
  const composer = useChatComposerDraft(props.workspaceScope, store.selectedSessionId)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const messageList = useRef<HTMLDivElement>(null)
  const readingSession = useRef<number | null>(null)
  const followsLatest = useRef(true)
  const [unseenMessages, setUnseenMessages] = useState(false)
  const message = composer.text
  const [checkpointName, setCheckpointName] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const [localError, setLocalError] = useState('')
  const [participantKey, setParticipantKey] = useState('')
  const [actionLimit, setActionLimit] = useState(1)
  const [schedulingMode, setSchedulingMode] = useState<ChatSchedulingModeV1>('manual')
  const [editPlan, setEditPlan] = useState<ChatMessageEditPlanV1 | null>(null)
  const [retrievalPlan, setRetrievalPlan] = useState<ChatMessageRetrievalPlanV1 | null>(null)
  const [historyPlan, setHistoryPlan] = useState<ChatHistoricalOptionsPlanV1 | null>(null)
  useEffect(() => { setSessionsOpen(false); setParticipantKey(''); setActionLimit(1); setSchedulingMode('manual'); setEditPlan(null); setRetrievalPlan(null); setHistoryPlan(null) }, [store.selectedSessionId])

  const initialized = useRef(false)
  const onSessionSelected = props.onSessionSelected
  useEffect(() => {
    const current = useCharacterInteractionPlayerStore.getState()
    // Selecting or forking already loaded this session. Echoing its ID into the
    // URL must not load it again and disable controls after they became usable.
    if (initialized.current && !current.loading && current.selectedSessionId === props.initialSessionId
      && current.scope?.projectId === props.workspaceScope?.projectId && current.scope?.worldId === props.workspaceScope?.worldId
      && current.scope?.workId === props.workspaceScope?.workId && current.worldGroupId === props.worldGroupId) return
    let active = true
    initialized.current = false
    if (props.workspaceScope) {
      void store.load(props.workspaceScope, props.worldGroupId, props.initialSessionId).then(() => {
        if (active) initialized.current = true
      })
    }
    return () => { active = false }
  // The store actions are stable. Loading already restores the requested session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workspaceScope?.projectId, props.workspaceScope?.worldId, props.workspaceScope?.workId, props.worldGroupId, props.initialSessionId])

  useEffect(() => {
    if (initialized.current && !store.loading && !store.busy && store.scope?.workId === props.workspaceScope?.workId) {
      onSessionSelected?.(store.selectedSessionId)
    }
  }, [store.selectedSessionId, store.loading, store.busy, store.scope?.workId, props.workspaceScope?.workId, onSessionSelected])

  const selected = store.sessions.find(item => item.id === store.selectedSessionId) ?? null
  const interaction = store.runtimeState.interaction
  const scene = interaction?.activeScene ?? null
  const visibleMessages = useMemo(() => interaction?.messages
    .filter(item => item.supersededBySequence == null && (item.role === 'player' || (item.audienceKeys == null || item.audienceKeys.includes(interaction!.playerKey)))) ?? [], [interaction])
  const lastVisibleSequence = visibleMessages[visibleMessages.length - 1]?.eventSequence
  const jumpToLatest = () => {
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight
    followsLatest.current = true
    setUnseenMessages(false)
  }
  useEffect(() => {
    if (!messageList.current) return
    if (readingSession.current !== store.selectedSessionId || followsLatest.current) jumpToLatest()
    else setUnseenMessages(true)
    readingSession.current = store.selectedSessionId
  }, [store.selectedSessionId, lastVisibleSequence])
  const story = interaction?.chatNarrative
  const narrativeActor = scene?.activeParticipantKeys.length === 1 ? scene.activeParticipantKeys[0] : participantKey
  const resolved = resolveRequestConfig(config, { category: story ? 'runtime.character.chat-narrative-action' : 'runtime.character.interaction-reply' })
  const aiReady = isAIConfigReady(resolved.config)
  const situationConfig = resolveRequestConfig(config, {category: 'runtime.character.chat-situation-construction'}).config
  const situationReady = isAIConfigReady(situationConfig)
  const optionsConfig = resolveRequestConfig(config, {category: 'runtime.character.chat-narrative-options'}).config
  const optionsReady = isAIConfigReady(optionsConfig)
  const reviewConfig = (id: number) => store.narrativeOptionRunIds.includes(id) ? optionsConfig : store.pendingActionReviewRunIds.includes(id) ? resolved.config : situationConfig
  const generationActive = store.generatingRunId != null
  const error = localError || store.error

  const run = async (action: () => Promise<void>) => {
    setLocalError('')
    try { await action() } catch (reason) { setLocalError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const send = async () => {
    const text = message.trim()
    if (!text || !scene) return
    const interrupting = !!story && generationActive
    if (story && aiReady && !interrupting && schedulingMode === 'manual' && !narrativeActor) throw new Error('请选择本轮行动的角色。')
    const draft = await composer.prepareSend()
    let sequence: number
    try {sequence = await store.sendPlayerMessage(draft.binding.text.trim(), undefined, draft)}
    catch (cause) {if (!draft.onFailed(cause)) throw cause; return}
    finally {draft.finish()}
    if (interrupting) return
    if (!aiReady) return
    if (useCharacterInteractionPlayerStore.getState().busy) return
    await store.generateReplies({ aiConfig: resolved.config, replyToSequence: sequence, preferredParticipantKey: story ? narrativeActor : undefined, actionLimit: story ? actionLimit : undefined, schedulingMode: story ? schedulingMode : undefined })
  }

  if (!props.workspaceScope) {
    return <div className="product-runtime-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属未就绪</h2><p>先在世界引擎建立 World/Work，再从正式 ProductRelease 启动角色互动。</p></div>
  }

  return <div data-view={props.view ?? "all"} className="chat-player flex min-w-0 flex-col bg-bg-base">
    {props.view !== 'memory' && <div className="chat-session-picker border-b border-border bg-bg-surface">
      {selected && props.view !== 'history' && <button type="button" aria-expanded={sessionsOpen} aria-controls="chat-session-list" onClick={() => setSessionsOpen(open => !open)} className="w-full px-4 py-3 text-left text-sm">作品与存档 <span aria-hidden="true">{sessionsOpen ? '−' : '+'}</span></button>}
      {(!selected || sessionsOpen || props.view === 'history') && <aside id="chat-session-list" className="w-full p-4">
      <div className="mb-3 flex items-center gap-2"><MessageCircle className="h-4 w-4 text-accent" /><strong className="text-sm">可玩的作品</strong></div>
      <p className="mb-4 text-xs leading-relaxed text-text-muted">选择已发布版本开始新会话，或继续下面的存档。</p>
      <div className="space-y-2">{store.releases.map(item => <article key={item.release.id} className="rounded border border-border bg-bg-base p-3">
        <strong className="block text-sm">{item.manifest?.definition.title ?? item.release.label}</strong>
        <span className="mt-1 block text-[10px] text-text-muted">版本 {item.release.version} · {item.manifest?.interaction.profiles.length ?? 0} 角色 · {item.manifest?.interaction.sceneTemplates.length ?? 0} 场景</span>
        {item.error && <p className="mt-2 text-[10px] text-danger">{item.error}</p>}
        <button disabled={!item.manifest || !!item.error || store.busy} onClick={() => void run(async () => { await store.start(item.release.id!); const current = useCharacterInteractionPlayerStore.getState().runtimeState.interaction; if (current?.chatNarrative?.permissions.triggers.includes('scene-start') && current.activeScene?.activeParticipantKeys.length === 1) { const actionConfig = resolveRequestConfig(config, {category: 'runtime.character.chat-narrative-action'}).config; if (isAIConfigReady(actionConfig)) await store.advanceNarrative({kind: 'scene-start', aiConfig: actionConfig, actionLimit: 1}) } })} className="mt-3 flex w-full items-center justify-center gap-1 rounded bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-40"><Plus className="h-3 w-3" />新建会话</button>
      </article>)}</div>
      {!store.releases.length && !store.loading && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-text-muted">尚无角色互动发布。切换到作者工作台创建并发布。</div>}
      <div className="mb-2 mt-6 text-xs font-semibold">互动存档</div>
      <div className="space-y-1">{store.sessions.map(session => <div key={session.id} className={`flex rounded ${session.id === selected?.id ? 'bg-accent/10' : ''}`}><button disabled={store.busy || store.loading} className="min-w-0 flex-1 px-2 py-2 text-left text-xs" onClick={() => void store.select(session.id!)}><strong className="block truncate">{session.title}</strong><span className="text-[9px] text-text-muted">{session.id === selected?.id ? `事件 ${store.runtimeState.lastSequence}` : '可继续'}</span></button><button aria-label="删除存档" disabled={store.busy || store.loading} className="px-2 text-text-muted hover:text-danger" onClick={() => void run(async () => { await store.remove(session.id!) })}><Trash2 className="h-3 w-3" /></button></div>)}</div>
    </aside>}</div>}

    <main className="min-w-0 flex-1 p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-4">
      {error && <div role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {!selected && <div className="product-runtime-empty"><MessageCircle className="h-8 w-8" /><h2>选择一个作品开始</h2><p>对话会自动保存。你可以继续已有会话，也可以从保存的位置分出另一条故事。</p></div>}
      {selected && interaction && <>
        <header className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-[10px] text-accent">{selected.productBuildId != null ? "角色聊天 · 制作试玩" : "角色聊天 · 正式版本"}</span><h1 className="mt-1 text-xl font-semibold">{selected.title}</h1><p className="mt-1 text-xs text-text-muted">{scene ? `${scene.title} · ${scene.location} · ${scene.timeLabel}` : '当前场景已结束'}</p></div>{scene && <button disabled={store.busy || store.loading} onClick={() => void run(async () => { await store.finishScene(undefined, aiReady ? resolved.config : undefined) })} className="rounded border border-border px-3 py-1.5 text-xs hover:bg-bg-hover">结束场景</button>}</header>

        {!scene && <section className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">选择下一场景</h2><div className="flex flex-wrap gap-2">{interaction.sceneTemplates.map(template => <button key={template.sceneKey} onClick={() => void run(async () => { await store.startScene(template.sceneKey) })} className="rounded border border-border px-3 py-2 text-xs hover:border-accent">{template.title}</button>)}</div></section>}

        {!!store.pendingNarrativeRunIds.filter(id => !store.recoverableRunIds.includes(id) && !store.pendingNarrativeReviewRunIds.includes(id) && !store.narrativeOptions.some(c => c.runId === id)).length && <section className="rounded border border-warning/30 bg-warning/5 p-4"><h2 className="text-sm font-semibold">上次角色行动尚未结束</h2><p className="my-2 text-xs text-text-muted">若另一页面仍在生成，请等它结束；中断后不会自动重发。你可以取消该运行，再明确继续。已经发生的调用费用不会撤销。</p>{store.pendingNarrativeRunIds.filter(id => !store.recoverableRunIds.includes(id) && !store.pendingNarrativeReviewRunIds.includes(id) && !store.narrativeOptions.some(c => c.runId === id)).map(id => <div key={id} className="mt-2 space-y-2">{!generationActive && store.scope && <RunProgress scope={store.scope} sessionId={selected.id!} runId={id} active={false} />}<button disabled={store.busy} onClick={() => void run(async () => { await store.cancelPendingRun(id) })} className="rounded border border-border px-3 py-2 text-xs">取消未完成行动 #{id}</button></div>)}</section>}
        {store.actionRevisionRunId != null && <section className="rounded border border-warning/30 bg-warning/5 p-4" data-testid="chat-action-revision">
          <h2 className="text-sm font-semibold">上一条回复未通过后果检查</h2>
          <p className="my-2 text-xs text-text-muted">原回复尚未发生。可以保留它的表达，修订后果记录并重新检查一次，最多新增两次模型调用。失败记录会保留；刷新不会自动修订，也不会继续下一步剧情。</p>
          <button disabled={store.busy || store.loading || !aiReady} onClick={() => void run(async () => {await store.reviseNarrativeAction(store.actionRevisionRunId!, resolved.config)})} className="rounded border border-border px-3 py-2 text-xs">修订未通过回复</button>
        </section>}
        {!!store.pendingNarrativeReviewRunIds.length && <section className="rounded border border-warning/30 bg-warning/5 p-4"><h2 className="text-sm font-semibold">叙事候选等待审查</h2><p className="my-2 text-xs text-text-muted">候选已保存，尚未改变故事。继续时会使用已有审查结果；若审查尚未发起，将调用原模型一次。结果未知时会停止，不会重复发送。</p><div className="flex flex-wrap gap-2">{store.pendingNarrativeReviewRunIds.map(id => <div key={id} className="space-y-2">{!generationActive && store.scope && <RunProgress scope={store.scope} sessionId={selected.id!} runId={id} active={false} />}<div className="flex gap-2"><button disabled={store.busy || !isAIConfigReady(reviewConfig(id))} onClick={() => void run(async () => {await store.resumeNarrativeReview(id, reviewConfig(id))})} className="rounded border border-border px-3 py-2 text-xs">{store.narrativeOptionRunIds.includes(id) ? '继续审查候选' : '继续审查并应用'} #{id}</button><button disabled={store.busy} onClick={() => void run(async () => {await store.cancelPendingRun(id)})} className="rounded border border-border px-3 py-2 text-xs">取消候选 #{id}</button></div></div>)}</div></section>}
        {!!store.recoverableRunIds.filter(id => !store.pendingNarrativeReviewRunIds.includes(id)).length && <section className="rounded border border-warning/30 bg-warning/5 p-4"><h2 className="text-sm font-semibold">已保存的回复可以恢复</h2><p className="my-2 text-xs text-text-muted">上次运行已持久化候选但未完成采用，可从同一检查点继续，不重复调用模型。</p><div className="flex flex-wrap gap-2">{store.recoverableRunIds.filter(id => !store.pendingNarrativeReviewRunIds.includes(id)).map(runId => <button key={runId} disabled={store.busy || store.loading} onClick={() => void run(async () => { await store.resumeRun(runId) })} className="rounded border border-border px-3 py-1.5 text-xs"> 恢复 Run #{runId}</button>)}</div></section>}

        {retrievalPlan && story && retrievalPlan.sessionId === selected.id && <NarrativeMessageRetrieval plan={retrievalPlan} disabled={store.busy || store.loading} onCancel={() => setRetrievalPlan(null)} onConfirm={() => void run(async () => {await store.applyMessageRetrieval(retrievalPlan); setRetrievalPlan(null)})} onEdit={() => void run(async () => {const plan = await readChatMessageEditPlanV1(store.scope!, selected.id!, retrievalPlan.messageId); if (useCharacterInteractionPlayerStore.getState().selectedSessionId === selected.id) {setEditPlan(plan); setRetrievalPlan(null); setHistoryPlan(null)}})} />}
        {editPlan && story && editPlan.sessionId === selected.id && <MessageEditPreview key={`${editPlan.messageId}:${editPlan.mode ?? 'edit'}`} plan={editPlan} disabled={store.busy || store.loading} maxCharacters={editPlan.role === 'player' ? 12000 : story.permissions.maxActionCharacters} onCancel={() => setEditPlan(null)} onConfirm={text => void run(async () => {await store.forkMessageEdit(editPlan, text); setEditPlan(null)})} />}
        {story?.pendingEdit && <PendingMessageEdit key={`${selected.id}:${story.pendingEdit.sourceMessageId}:${story.pendingEdit.requestedSequence}`} draft={story.pendingEdit} disabled={store.busy || store.loading} canApply={!store.pendingNarrativeRunIds.length && (story.pendingEdit.role === 'player' || aiReady)} maxCharacters={story.pendingEdit.role === 'player' ? 12000 : story.permissions.maxActionCharacters} onApply={text => void run(async () => {await store.applyMessageEdit(text, resolved.config)})} onCancel={() => void run(async () => {await store.cancelMessageEdit()})} />}

        {historyPlan && story && historyPlan.edit.sessionId === selected.id && <NarrativeHistoryOptions plan={historyPlan} names={Object.fromEntries([[interaction.playerKey, '你'], ...interaction.profiles.map(profile => [profile.participantKey, profile.name])])} disabled={store.busy || store.loading} onCancel={() => setHistoryPlan(null)} onChoose={key => void run(async () => {await store.forkHistoricalOption(historyPlan, key); setHistoryPlan(null)})} />}
        {store.narrativeOptions.map(candidate => <NarrativeOptions key={candidate.runId} candidate={candidate} disabled={store.busy || store.loading} onChoose={key => void run(async () => {await store.selectNarrativeOption(candidate.runId, key)})} onCancel={() => void run(async () => {await store.cancelPendingRun(candidate.runId)})} />)}

        {<section data-section="chat" className="rounded-lg border border-border bg-bg-surface"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-accent" />{scene?.title ?? '对话记录'}<span className="text-xs font-normal text-text-muted">· {scene?.activeParticipantKeys.map(key => interaction.profiles.find(item => item.participantKey === key)?.name ?? key).join('、')}</span></div><details className="text-[10px] text-text-muted"><summary className="cursor-pointer">会话用量</summary><span>剩余回复预算 {interaction.remainingDirectorBudget} · 玩家回合 {scene?.playerTurns ?? 0}/{scene?.maxTurns ?? '—'}</span></details></div>
          <div ref={messageList} role="region" aria-label="对话记录" tabIndex={0} onScroll={() => {const list = messageList.current; if (!list) return; followsLatest.current = list.scrollHeight - list.clientHeight - list.scrollTop < 48; if (followsLatest.current) setUnseenMessages(false)}} className="chat-message-list max-h-[31rem] space-y-3 overflow-y-auto p-4">{visibleMessages.map(item => <div key={item.eventSequence} className={`flex ${item.role === 'player' ? 'justify-end' : 'justify-start'}`}><article className={`max-w-[84%] rounded-lg px-3 py-2 text-sm ${item.role === 'player' ? 'bg-accent/15' : 'bg-bg-base'}`}><div className="mb-1 flex items-center gap-1 text-[10px] text-text-muted">{item.role === 'player' ? <UserRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />}{item.role === 'player' ? '玩家' : interaction.profiles.find(profile => profile.participantKey === item.speakerKey)?.name ?? item.speakerKey}{story?.excludedMessageIds?.includes(item.messageId) && <span className="ml-1" data-testid="chat-message-excluded">已排除对话上下文</span>}</div><p className="whitespace-pre-wrap">{item.text}</p>{story && <details className="mt-2 text-xs" data-testid="chat-message-tools"><summary aria-label={`消息操作 ${item.eventSequence}`} className="cursor-pointer text-text-muted">消息操作</summary><div className="flex flex-wrap gap-x-3">{story && <button aria-label={`上下文设置 ${item.eventSequence}`} disabled={store.busy || store.loading} onClick={() => void run(async () => {const plan = await readChatMessageRetrievalPlanV1(store.scope!, selected.id!, item.messageId); if (useCharacterInteractionPlayerStore.getState().selectedSessionId === selected.id) {setRetrievalPlan(plan); setEditPlan(null); setHistoryPlan(null)}})} className="mt-2 block text-xs text-accent disabled:opacity-40">{story.excludedMessageIds?.includes(item.messageId) ? '恢复上下文' : '排除上下文'}</button>}{story && <button aria-label={`改写消息 ${item.eventSequence}`} disabled={store.busy || store.loading} onClick={() => void run(async () => {const plan = await readChatMessageEditPlanV1(store.scope!, selected.id!, item.messageId); if (useCharacterInteractionPlayerStore.getState().selectedSessionId === selected.id) {setEditPlan(plan); setRetrievalPlan(null); setHistoryPlan(null)}})} className="mt-2 block text-xs text-accent disabled:opacity-40">改写并分支</button>}{story && store.historicalOptionMessageIds.includes(item.messageId) && <button aria-label={`历史候选 ${item.eventSequence}`} disabled={store.busy || store.loading} onClick={() => void run(async () => {const plan = await readChatHistoricalOptionsPlanV1(store.scope!, selected.id!, item.messageId); if (useCharacterInteractionPlayerStore.getState().selectedSessionId === selected.id) {setHistoryPlan(plan); setEditPlan(null); setRetrievalPlan(null)}})} className="mt-2 block text-xs text-accent disabled:opacity-40">查看其他候选</button>}{story && item.role === 'character' && item.messageId === visibleMessages[visibleMessages.length - 1]?.messageId && <button aria-label={`续写消息 ${item.eventSequence}`} disabled={store.busy || store.loading} onClick={() => void run(async () => {const plan = await readChatMessageContinuationPlanV1(store.scope!, selected.id!, item.messageId); if (useCharacterInteractionPlayerStore.getState().selectedSessionId === selected.id) {setEditPlan(plan); setRetrievalPlan(null); setHistoryPlan(null)}})} className="mt-2 block text-xs text-accent disabled:opacity-40">续写当前回复</button>}</div></details>}{item.role === 'player' && item.eventSequence === [...visibleMessages].reverse().find(m=>m.role==='player')?.eventSequence && (!story || !story.triggers.some(trigger => trigger.kind === 'player-response' && trigger.sourceEventSequence === item.eventSequence)) && <button disabled={!scene||!aiReady||store.busy||store.loading||generationActive||!!story?.excludedMessageIds?.includes(item.messageId)} onClick={()=>void run(async()=>{await store.generateReplies({aiConfig:resolved.config,replyToSequence:item.eventSequence,preferredParticipantKey:story?narrativeActor:undefined,actionLimit:story?actionLimit:undefined,schedulingMode:story?schedulingMode:undefined})})} className="mt-2 text-xs text-accent disabled:opacity-40">{story ? '生成本轮回复' : '生成或继续此轮回复'}</button>}{item.role === 'character' && !story && <button disabled={!scene || !aiReady || store.busy || store.loading || generationActive} onClick={() => void run(async () => { await store.retryReply({ aiConfig: resolved.config, replySequence: item.eventSequence }) })} className="mt-2 flex items-center gap-1 text-[10px] text-text-muted hover:text-accent disabled:opacity-40"><RefreshCw className="h-3 w-3" />重试该回复</button>}</article></div>)}{generationActive && store.scope && <RunProgress key={`${selected.id}:${store.generatingRunId}`} scope={store.scope} sessionId={selected.id!} runId={store.generatingRunId!} active />}{!visibleMessages.length && <p className="py-8 text-center text-xs text-text-muted">{story ? '可以让角色先开场，也可以先说出你的想法。' : '可以先说出你的想法，也可以使用下方的场景行动。'}</p>}</div>
          {unseenMessages && <button onClick={jumpToLatest} className="mx-4 mb-2 rounded border border-border px-3 py-2 text-xs">有新消息，回到底部</button>}
          {!story && !!scene?.relationshipRules.length && <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">{scene.relationshipRules.map(rule => <button key={rule.ruleKey} disabled={store.busy || store.loading} title={rule.reason} onClick={() => void run(async () => { await store.applyFixedAction(rule.ruleKey) })} className="rounded border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs text-accent disabled:opacity-40">{rule.playerText}</button>)}</div>}
          <div className="chat-composer border-t border-border p-3">
            {composer.error && <div role="alert" className="mb-2 space-y-2 text-xs text-danger"><p>{composer.error}</p>
              {composer.conflict !== undefined ? <><details><summary>查看另一份已保存草稿</summary><p className="whitespace-pre-wrap break-words">{composer.conflict?.text || '空草稿'}</p></details>
                <button type="button" onClick={() => composer.resolve(true)}>保留此处文字并覆盖草稿</button><button type="button" onClick={() => composer.resolve(false)}>使用已保存草稿</button></>
                : <button type="button" onClick={() => void composer.retry()}>重试保存草稿</button>}
            </div>}
            {(composer.loading || composer.saving || (composer.saved && !!message)) && <span role="status" className="block text-[10px] text-text-muted">{composer.loading ? '正在读取草稿…' : composer.saving ? '正在保存草稿…' : '草稿已保存，仅在此存档可见'}</span>}
            <textarea aria-label="发送给角色的消息" value={message} onChange={event => composer.change(event.target.value)} maxLength={CHAT_COMPOSER_MAX_CHARACTERS} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void run(send) } }} disabled={!scene || composer.loading || composer.sending || store.loading || (store.busy && !(story && generationActive))} placeholder="对当前场景中的角色说话…" rows={2} className="w-full resize-y rounded border border-border bg-bg-base px-3 py-2 text-sm disabled:opacity-50" /><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] text-text-muted">{story && store.busy && !generationActive ? '正在处理当前操作；已保存的消息会保留。' : aiReady ? 'Enter 发送 · Shift + Enter 换行' : '尚未连接模型：可保存消息，稍后再生成回复。'}</span><div className="flex gap-2">{generationActive && <button onClick={() => void store.cancelGeneration()} className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs"><Square className="h-3 w-3" />取消</button>}<button disabled={!scene || !message.trim() || composer.loading || composer.sending || !!composer.error || store.loading || (store.busy && !(story && generationActive))} onClick={() => void run(send)} className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"><Send className="h-3 w-3" />{story && generationActive ? '打断并发送' : aiReady ? '发送并生成' : '仅保存消息'}</button></div></div></div>
        </section>}

        {story && <NarrativeControls interaction={interaction} turnResume={store.narrativeTurnResume} onResume={() => void run(async () => {await store.resumeNarrativeTurn({aiConfig: resolved.config, situationAiConfig: situationConfig, participantKey: store.narrativeTurnResume?.actorKey || narrativeActor})})} actionLimit={actionLimit} onActionLimitChange={setActionLimit} schedulingMode={schedulingMode} onSchedulingModeChange={setSchedulingMode} participantKey={narrativeActor} onParticipantChange={setParticipantKey} actionDisabled={!aiReady} disabled={store.busy || store.loading || store.pendingNarrativeRunIds.length > 0 || !!story.pendingEdit} onAdvance={kind => void run(async () => { await store.advanceNarrative({kind, aiConfig: resolved.config, participantKey: narrativeActor, actionLimit, schedulingMode}) })} comparisonDisabled={!optionsReady} onCompare={kind => void run(async () => {await store.advanceNarrative({kind, compare: true, aiConfig: optionsConfig, participantKey: narrativeActor, actionLimit, schedulingMode})})} situationDisabled={!situationReady || !aiReady} onCreateSituation={seed => void run(async () => { await store.createSituation({seed, aiConfig: situationConfig, actionAiConfig: resolved.config, participantKey: narrativeActor, actionLimit, schedulingMode}) })} />}

        {story && store.scope && <NarrativeContextInspector key={selected.id} scope={store.scope} sessionId={selected.id!} disabled={store.busy || store.loading} sequence={store.runtimeState.lastSequence} />}

        <section data-section="memory" className="grid gap-3 lg:grid-cols-2"><div className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">关系摘要与原因</h2><div className="space-y-2">{interaction.relationships.map(item => { const last = [...interaction.relationshipHistory].reverse().find(change => change.fromParticipantKey === item.fromParticipantKey && change.toParticipantKey === item.toParticipantKey && change.dimensionKey === item.dimensionKey); return <article key={`${item.fromParticipantKey}:${item.toParticipantKey}:${item.dimensionKey}`} className="rounded bg-bg-base p-2 text-xs"><div className="flex justify-between"><strong>{interaction.profiles.find(profile => profile.participantKey === item.fromParticipantKey)?.name} → {item.toParticipantKey === 'player' ? '你' : interaction.profiles.find(profile => profile.participantKey === item.toParticipantKey)?.name} · {item.label}</strong><span>{item.value}</span></div>{last && <p className="mt-1 text-[10px] text-text-muted">{last.before} → {last.after}：{last.reason} · 证据 #{last.sourceEventSequence}</p>}</article>})}</div></div>
          <div className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">角色关键记忆</h2><div className="space-y-2">{interaction.memories.filter(item => (item.status === 'accepted' || item.status === 'proposed') && item.sourceEventSequences.every(sequence => visibleMessages.some(message => message.eventSequence === sequence))).map(item => <article key={item.memoryId} className="rounded bg-bg-base p-2 text-xs"><strong>{interaction.profiles.find(profile => profile.participantKey === item.participantKey)?.name} · {item.kind}</strong><p className="mt-1 text-text-secondary">{item.content}</p><span className="text-[9px] text-text-muted">来源 {item.sourceEventSequences.map(value => `#${value}`).join('、')}</span>{item.status === 'proposed' && <div className="mt-2 flex gap-2"><button onClick={() => void run(async () => { await store.resolveMemory(item.memoryId, 'accepted') })} className="flex items-center gap-1 text-accent"><Check className="h-3 w-3" />采用</button><button onClick={() => void run(async () => { await store.resolveMemory(item.memoryId, 'rejected') })} className="text-text-muted">拒绝</button></div>}</article>)}{!interaction.memories.length && <p className="text-xs text-text-muted">记忆候选只能在真实消息证据上提议，采用后才持久化。</p>}</div></div></section>

        {!story && store.runtimeState.narrative?.version === 2 && !store.runtimeState.narrative.completed && <section className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">Narrative Choice 连接</h2><div className="flex flex-wrap gap-2">{(store.runtimeState.narrative.choices ?? []).filter(choice => store.runtimeState.narrative?.visibleChoiceKeys?.includes(choice.choiceKey)).map(choice => <button key={choice.choiceKey} disabled={!store.runtimeState.narrative?.availableChoiceKeys?.includes(choice.choiceKey) || store.busy} onClick={() => void run(async () => { await store.chooseNarrative(choice.choiceKey) })} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">{choice.text}</button>)}</div></section>}

        <section data-section="history" className="grid gap-3 md:grid-cols-2"><p className="text-xs text-text-muted md:col-span-2">存档 #{selected.id} · {selected.parentSessionId ? `来自分支 #${selected.parentSessionId}` : '独立会话'} · {selected.productReleaseId ? `发布版本 #${selected.productReleaseId}` : `制作试玩 #${selected.productBuildId}`} · 保存于 {new Date(selected.updatedAt).toLocaleString()}</p><div className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Save className="h-4 w-4 text-accent" />检查点</div><div className="flex gap-2"><input value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="检查点名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs" /><button disabled={!checkpointName.trim()} onClick={() => void run(async () => { await store.saveCheckpoint(checkpointName); setCheckpointName('') })} className="rounded border border-border px-3 text-xs">保存</button></div><div className="mt-2 space-y-1">{store.checkpoints.map(item => <button key={item.id} onClick={() => void run(async () => { await store.forkCheckpoint(item.id!) })} className="block w-full rounded bg-bg-base px-2 py-1 text-left text-[10px] text-text-muted">{item.name} · #{item.throughSequence} → 分支</button>)}</div></div><div className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><GitBranch className="h-4 w-4 text-accent" />当前时间线分支</div><div className="flex gap-2"><input value={branchTitle} onChange={event => setBranchTitle(event.target.value)} placeholder="分支名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs" /><button disabled={!branchTitle.trim()} onClick={() => void run(async () => { await store.forkCurrent(branchTitle); setBranchTitle('') })} className="rounded border border-border px-3 text-xs">建立分支</button></div></div></section>

      </>}
    </div></main>
  </div>
}
