import {useState} from 'react'
import type {ChatMessageEditPlanV1} from '../../lib/character-interaction/narrative-edit'
import type {ChatMessageEditDraftV1} from '../../lib/types/chat-narrative'

export function MessageEditPreview(props: {plan: ChatMessageEditPlanV1; disabled: boolean; maxCharacters: number; onConfirm: (text: string) => void; onCancel: () => void}) {
  const [text, setText] = useState(props.plan.text)
  return <section data-testid="chat-edit-preview" className="space-y-3 rounded border border-accent/30 bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">从这条消息前建立改写分支</h2>
    <p className="text-xs text-text-muted">原时间线保持原样。新分支将重新处理这条消息及之后的 {Math.max(0, props.plan.removedMessageCount - 1)} 条消息，不继承它们产生的事实、关系、记忆和打算。原模型调用及费用记录留在原会话。</p>
    <textarea aria-label="改写历史消息" rows={4} value={text} maxLength={props.maxCharacters} disabled={props.disabled} onChange={event => setText(event.target.value)} className="w-full rounded border border-border bg-bg-base p-2 text-sm" />
    <p className="text-xs text-text-muted">{props.plan.role === 'character' ? '先保存改写草稿；之后需要模型核对原角色表达和后果，通过审查才进入故事。' : '先保存改写草稿；确认后作为新分支中的玩家消息，后续回复重新生成。'}</p>
    <div className="flex gap-2"><button disabled={props.disabled || !text.trim()} onClick={() => props.onConfirm(text.trim())} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">建立改写分支</button><button disabled={props.disabled} onClick={props.onCancel} className="rounded border border-border px-3 py-2 text-xs">取消改写</button></div>
  </section>
}

export function PendingMessageEdit(props: {draft: ChatMessageEditDraftV1; disabled: boolean; canApply: boolean; maxCharacters: number; onApply: (text: string) => void; onCancel: () => void}) {
  const [text, setText] = useState(props.draft.text)
  return <section data-testid="chat-pending-edit" className="space-y-3 rounded border border-accent/30 bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">待采用的改写</h2>
    <p className="text-xs text-text-muted">这里是修改点之前的新分支。草稿尚未成为对话或事实；取消草稿会保留这个分支。</p>
    <textarea aria-label="待采用的改写" rows={4} value={text} maxLength={props.maxCharacters} disabled={props.disabled} onChange={event => setText(event.target.value)} className="w-full rounded border border-border bg-bg-base p-2 text-sm" />
    <div className="flex gap-2"><button disabled={props.disabled || !props.canApply || !text.trim()} onClick={() => props.onApply(text.trim())} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{props.draft.role === 'player' ? '保存改写消息' : '审查并采用改写'}</button><button disabled={props.disabled} onClick={props.onCancel} className="rounded border border-border px-3 py-2 text-xs">取消待处理改写</button></div>
    {props.draft.role === 'character' && <p className="text-xs text-text-muted">重新核对需要两次模型调用。失败后草稿保留；未结束的运行请先恢复或取消，重新点击才会发起新请求。</p>}
  </section>
}
