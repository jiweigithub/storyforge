import {useState} from 'react'
import type { CharacterInteractionRuntimeState } from '../../lib/types'
import type { ChatPlayerTriggerV1 } from '../../lib/character-interaction/narrative-turn'

export default function NarrativeControls(props: {
  interaction: CharacterInteractionRuntimeState
  participantKey: string
  onParticipantChange: (key: string) => void
  disabled: boolean
  onAdvance: (kind: ChatPlayerTriggerV1) => void
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
  const disabled = props.disabled || !participantKey || interaction.remainingDirectorBudget < 2
  return <section data-testid="chat-narrative-controls" className="space-y-3 rounded border border-border bg-bg-surface p-4">
    <div><h2 className="text-sm font-semibold">{story.situation.title}</h2><p className="mt-1 text-xs text-text-muted">你扮演 {story.persona.name} · {story.situation.location} · {story.situation.timeLabel}</p></div>
    <details className="text-xs"><summary className="cursor-pointer text-text-muted">当前已知的局面</summary><ul className="mt-2 list-disc space-y-1 pl-4">{story.situation.facts.filter(f => f.audienceKeys.includes(interaction.playerKey)).map(f => <li key={f.factKey}>{f.text}</li>)}</ul></details>
    {active.length > 1 && <label className="block text-xs">本轮行动角色<select aria-label="本轮行动角色" value={participantKey} disabled={props.disabled} onChange={event => props.onParticipantChange(event.target.value)} className="ml-2 max-w-full rounded border border-border bg-bg-base p-2"><option value="">请选择</option>{active.map(p => <option key={p.participantKey} value={p.participantKey}>{p.name}</option>)}</select><span className="mt-1 block text-text-muted">当前由你选择一名角色行动；自动多人调度仍在开发。</span></label>}
    <p role="status" className="text-xs text-text-muted">{trigger?.status === 'waiting-player' ? '角色正在等你的回应。你可以接受、拒绝、换个办法，或请其自行继续。' : '角色根据自己的目标行动；每轮到需要你决定或达到上限时停下。刷新页面不会自动生成。'}</p>
    <div className="flex flex-wrap gap-2">{canOpen && story.permissions.triggers.includes('scene-start') && <button disabled={disabled} onClick={() => props.onAdvance('scene-start')} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">让角色开场</button>}{story.permissions.triggers.includes('continue') && <button disabled={disabled} onClick={() => props.onAdvance('continue')} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">让角色继续</button>}{!canOpen && story.permissions.triggers.includes('return') && <button disabled={disabled} onClick={() => props.onAdvance('return')} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">从上次局面继续</button>}</div>
    {story.permissions.triggers.includes('player-seed') && <details className="text-xs"><summary className="cursor-pointer text-text-muted">提出新的情境或矛盾</summary><div className="mt-2 space-y-2"><p className="text-text-muted">写下你希望引入的局面。系统会先结合已有故事形成背景与开放方向，通过检查后，再由所选角色演绎。这里的内容不会作为你的角色台词发送。</p><textarea aria-label="新的情境或矛盾" value={seed} maxLength={4000} disabled={props.disabled} onChange={event => setSeed(event.target.value)} placeholder="例如：门外突然传来敲门声，来者的身份暂时不明。" rows={3} className="w-full rounded border border-border bg-bg-base p-2" /><button disabled={disabled || props.situationDisabled || interaction.remainingDirectorBudget < 4 || !seed.trim()} onClick={() => props.onCreateSituation(seed.trim())} className="rounded border border-border px-3 py-2 disabled:opacity-40">构建情境并演绎</button></div></details>}
  </section>
}
