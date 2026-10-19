import PromptInfluenceInfo from './PromptInfluenceInfo'
import type { AgentContextEvidence } from '../../lib/agent/context-policy'
import { useEffect, useMemo, useState } from 'react'
import { Eye, RotateCcw, Send } from 'lucide-react'
import { estimateTokens } from '../../lib/ai/context-budget'
import type { ChatMessage } from '../../lib/types'

interface Props {
  contextEvidence?: Pick<AgentContextEvidence, 'included' | 'omitted' | 'trimmed' | 'sourceEvidence'>
  messages: ChatMessage[]
  onBack: () => void
  onConfirm: (messages: ChatMessage[]) => void
  backLabel?: string
}

const ROLE_LABEL: Record<ChatMessage['role'], string> = {
  system: 'System Prompt',
  user: 'User Prompt',
  assistant: 'Assistant 上文',
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => ({ ...message }))
}

/**
 * PIPELINE-1 最终消息闸门。草稿仅存在于组件 state，关闭或重新发起请求即丢弃。
 */
export default function PromptPreviewGate({
  messages,
  onBack,
  onConfirm,
  contextEvidence,
  backLabel = '返回生成依据',
}: Props) {
  const [draft, setDraft] = useState(() => cloneMessages(messages))
  useEffect(() => {
    setDraft(cloneMessages(messages))
  }, [messages])
  const originalTokens = useMemo(
    () => messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
    [messages],
  )
  const draftTokens = draft.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  )
  const valid = draft.length > 0 && draft.every(message => message.content.trim())

  const updateContent = (index: number, content: string) => {
    setDraft(current => current.map((message, messageIndex) => (
      messageIndex === index ? { ...message, content } : message
    )))
  }

  return (
    <div className="space-y-3" data-testid="prompt-preview-gate">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-text-primary">
            <Eye className="h-3.5 w-3.5 text-accent" />
            最终发送内容
          </div>
          <p className="mt-1 text-[10px] leading-4 text-text-muted">
            这里是模板、参数和作品上下文拼接后的真实消息。修改只影响本次调用，不写回模板或作品资料。
          </p>
        </div>
        <span className="text-[10px] tabular-nums text-text-muted">
          约 {draftTokens.toLocaleString()} tokens
          {draftTokens !== originalTokens && `（原 ${originalTokens.toLocaleString()}）`}
        </span>
      </div>

      <PromptInfluenceInfo context={contextEvidence} messages={draft} />
      <div className="max-h-[28rem] space-y-3 overflow-auto pr-1">
        {draft.map((message, index) => (
          <label key={`${message.role}-${index}`} className="block space-y-1">
            <span className="text-[10px] font-medium text-text-secondary">
              {ROLE_LABEL[message.role]}
            </span>
            <textarea
              aria-label={`${ROLE_LABEL[message.role]} ${index + 1}`}
              value={message.content}
              onChange={event => updateContent(index, event.target.value)}
              rows={message.role === 'system' ? 8 : 14}
              className="w-full resize-y rounded border border-border bg-bg-base px-2.5 py-2 font-mono text-[11px] leading-5 text-text-primary focus:border-accent focus:outline-none"
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setDraft(cloneMessages(messages))}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
        >
          <RotateCcw className="h-3 w-3" /> 还原拼接结果
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
          >
            {backLabel}
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onConfirm(cloneMessages(draft))}
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3 w-3" /> 发送本次版本
          </button>
        </div>
      </div>
    </div>
  )
}
