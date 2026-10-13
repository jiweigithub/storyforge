import {useState} from 'react'
import type { CharacterInteractionRuntimeState } from '../../lib/types'
import type { ChatNarrativeTurnResumeV1, ChatPlayerTriggerV1 } from '../../lib/character-interaction/narrative-turn'
import type {ChatSchedulingModeV1} from '../../lib/character-interaction/narrative-scheduling'

export default function NarrativeControls(props: {
  interaction: CharacterInteractionRuntimeState
  participantKey: string
  onParticipantChange: (key: string) => void
  actionLimit: number
  onActionLimitChange: (limit: number) => void
  schedulingMode: ChatSchedulingModeV1
  onSchedulingModeChange: (mode: ChatSchedulingModeV1) => void
  disabled: boolean
  actionDisabled?: boolean
  onAdvance: (kind: ChatPlayerTriggerV1) => void
  turnResume: ChatNarrativeTurnResumeV1 | null
  onResume: () => void
  onCompare: (kind: ChatPlayerTriggerV1) => void
  comparisonDisabled?: boolean
  situationDisabled?: boolean
  onCreateSituation: (seed: string) => void
}) {
  const [seed, setSeed] = useState('')
  const {interaction, participantKey} = props
  const story = interaction.chatNarrative, scene = interaction.activeScene
  if (!story || !scene) return null
  const active = interaction.profiles.filter(p => scene.activeParticipantKeys.includes(p.participantKey))
  const trigger = story.triggers.slice(-1)[0]
  const canOpen = !interaction.messages.some(m => m.eventSequence > scene.startedAtSequence)
    && !story.triggers.some(t => t.kind === 'scene-start' && t.sourceEventSequence === scene.startedAtSequence)
  const automatic = props.schedulingMode !== 'manual'
  const disabled = props.disabled || !automatic && !participantKey || interaction.remainingDirectorBudget < 2
  const compareKind = canOpen && story.permissions.triggers.includes('scene-start') ? 'scene-start' : 'continue'
  const expands = !!story.pendingSituation && (automatic || story.pendingSituation.actorKey === participantKey) && compareKind === 'continue'
  const resumeActor = props.turnResume?.actorKey || participantKey
  const needsSituation = trigger?.kind === 'player-seed' && story.situation.seed.sourceEventSequence !== trigger.requestedSequence
  return <section data-testid="chat-narrative-controls" className="space-y-3 rounded border border-border bg-bg-surface p-4">
    <label className="block text-xs">角色接续方式<select aria-label="角色接续方式" value={props.schedulingMode} disabled={props.disabled} onChange={event => props.onSchedulingModeChange(event.target.value as ChatSchedulingModeV1)} className="ml-2 rounded border border-border bg-bg-base p-2"><option value="manual">指定角色</option><option value="natural">按局面接续</option><option value="round-robin">依次接续</option></select><span className="mt-1 block text-text-muted">{automatic ? props.schedulingMode === 'natural' ? '结合可见对话、被提及的角色和各自目标选择下一位；没有可推进内容时可以停下。' : '在本轮能听到对话的在场角色间依次行动，跳过已暂停或结束的目标。' : '由你选择本轮行动的角色。'} 改变方式不会立即生成，也不会改动已经开始的轮次。</span></label>
    <label className="block text-xs">演绎节奏<select aria-label="演绎节奏" value={props.actionLimit} disabled={props.disabled} onChange={event => props.onActionLimitChange(Number(event.target.value))} className="ml-2 rounded border border-border bg-bg-base p-2">{Array.from({length: story.permissions.maxActionsPerTrigger}, (_, index) => index + 1).map(limit => <option key={limit} value={limit}>{limit === 1 ? '一步一停' : `最多连续 ${limit} 步`}</option>)}</select><span className="mt-1 block text-text-muted">只影响下一轮开场、回应或继续。连续演绎遇到需要你决定、角色暂停或额度上限就停；你可以取消或发消息打断。补齐未完成本轮仍沿用本轮原有的角色安排和剩余额度。</span></label>
    <div><h2 className="text-sm font-semibold">{story.situation.title}</h2><p className="mt-1 text-xs text-text-muted">你扮演 {story.persona.name} · {story.situation.location} · {story.situation.timeLabel}</p></div>
    <details className="text-xs"><summary className="cursor-pointer text-text-muted">当前已知的局面</summary><ul className="mt-2 list-disc space-y-1 pl-4">{story.situation.facts.filter(f => f.audienceKeys.includes(interaction.playerKey)).map(f => <li key={f.factKey}>{f.text}</li>)}</ul></details>
    {active.length > 1 && !automatic && <label className="block text-xs">本轮行动角色<select aria-label="本轮行动角色" value={participantKey} disabled={props.disabled} onChange={event => props.onParticipantChange(event.target.value)} className="ml-2 max-w-full rounded border border-border bg-bg-base p-2"><option value="">请选择</option>{active.map(p => <option key={p.participantKey} value={p.participantKey}>{p.name}</option>)}</select></label>}
    <p role="status" className="text-xs text-text-muted">{trigger?.status === 'waiting-player' ? '角色正在等你的回应。你可以接受、拒绝、换个办法，或请其自行继续。' : '让角色继续会开始下一次行动，不延长上一条回复。每轮到需要你决定或达到上限时停下；刷新页面不会自动生成。'}</p>
    {props.turnResume && <div data-testid="chat-turn-resume" className="space-y-2 rounded border border-border p-3"><p className="text-xs text-text-muted">这一轮还有最多 {props.turnResume.remainingActions} 次行动额度。{props.turnResume.schedulingMode ? `补齐沿用本轮原有的${props.turnResume.schedulingMode === 'natural' ? '按局面接续' : '依次接续'}安排；下一位是 ${interaction.profiles.find(profile => profile.participantKey === props.turnResume!.actorKey)?.name ?? '暂无可行动角色'}。` : <>补齐会沿用{props.turnResume.actorKey ? ` ${interaction.profiles.find(profile => profile.participantKey === props.turnResume!.actorKey)?.name ?? props.turnResume.actorKey} 的` : '所选角色的'}当前轮次。</>}保留已发生的内容；遇到需要你回应时仍会停下。</p><button disabled={props.disabled || props.actionDisabled || !resumeActor || !!props.turnResume.blockedReason || needsSituation && (props.situationDisabled || interaction.remainingDirectorBudget < 4)} onClick={props.onResume} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">补齐未完成本轮</button>{props.turnResume.blockedReason && <p className="text-xs text-text-muted">{props.turnResume.blockedReason}</p>}</div>}
    <div className="flex flex-wrap gap-2">{canOpen && story.permissions.triggers.includes('scene-start') && <button disabled={disabled || props.actionDisabled} onClick={() => props.onAdvance('scene-start')} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">让角色开场</button>}{story.permissions.triggers.includes('continue') && <button disabled={disabled || props.actionDisabled} onClick={() => props.onAdvance('continue')} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">让角色继续</button>}{!canOpen && story.permissions.triggers.includes('return') && <button disabled={disabled || props.actionDisabled} onClick={() => props.onAdvance('return')} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">从上次局面继续</button>}</div>
    {story.permissions.triggers.includes(compareKind) && <div className="space-y-2"><button disabled={disabled || props.comparisonDisabled || expands && interaction.remainingDirectorBudget < 4} onClick={() => props.onCompare(compareKind)} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">{expands ? '发展局面并比较行动' : '比较两种行动'}</button><p className="text-xs text-text-muted">{expands ? '先承接角色已有方向，保存共同背景，再生成两条行动供你选择。取消候选会保留已经发展的背景。' : '生成并审查两条行动，选择前不会把它们写进故事。'}</p></div>}
    {story.permissions.triggers.includes('player-seed') && <details className="text-xs"><summary className="cursor-pointer text-text-muted">提出新的情境或矛盾</summary><div className="mt-2 space-y-2"><p className="text-text-muted">写下你希望引入的局面。系统会先结合已有故事形成背景与开放方向，通过检查后，再由本轮选定或调度的角色演绎。这里的内容不会作为你的角色台词发送。</p><textarea aria-label="新的情境或矛盾" value={seed} maxLength={4000} disabled={props.disabled} onChange={event => setSeed(event.target.value)} placeholder="例如：门外突然传来敲门声，来者的身份暂时不明。" rows={3} className="w-full rounded border border-border bg-bg-base p-2" /><button disabled={disabled || props.situationDisabled || interaction.remainingDirectorBudget < 4 || !seed.trim()} onClick={() => props.onCreateSituation(seed.trim())} className="rounded border border-border px-3 py-2 disabled:opacity-40">构建情境并演绎</button></div></details>}
  </section>
}
