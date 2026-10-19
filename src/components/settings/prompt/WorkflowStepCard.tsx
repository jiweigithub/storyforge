import { useEffect, useState } from 'react'
import {
  Check,
  ChevronRight,
  ClipboardCopy,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react'
import type { TokenUsage } from '../../../lib/ai/logger'
import type { PromptWorkflowStep } from '../../../lib/types/workflow'

export interface StepResult {
  stepId: string
  output: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
  error?: string
  tokenUsage?: TokenUsage | null
}

interface Props {
  step: PromptWorkflowStep
  index: number
  result: StepResult
  isCurrent: boolean
  onSkip: () => void
  onRetry: () => void
  onExtract: (output: string) => void
  onUserInputChange: (value: string) => void
  onOutputChange: (value: string) => void
  hasProject: boolean
  actionsDisabled?: boolean
}

export function WorkflowStepCard({
  step,
  index,
  result,
  isCurrent,
  onSkip,
  onRetry,
  onExtract,
  onUserInputChange,
  onOutputChange,
  hasProject,
  actionsDisabled = false,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const [userInput, setUserInput] = useState('')
  const [editedOutput, setEditedOutput] = useState('')
  useEffect(() => { setEditedOutput(result.output || '') }, [result.output])

  const handleCopy = () => {
    if (!editedOutput) return
    navigator.clipboard.writeText(editedOutput).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([editedOutput], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `storyforge-draft-${step.stepId}.txt`; link.click(); URL.revokeObjectURL(url)
  }
  const statusIcon = {
    pending: <ChevronRight className="w-4 h-4 text-text-muted" />,
    running: <Loader2 className="w-4 h-4 text-accent animate-spin" />,
    done: <Check className="w-4 h-4 text-success" />,
    skipped: <X className="w-4 h-4 text-text-muted" />,
    failed: <X className="w-4 h-4 text-error" />,
  }[result.status]

  const borderClass = isCurrent
    ? 'border-accent'
    : result.status === 'done'
      ? 'border-success/40'
      : result.status === 'failed'
        ? 'border-error/40'
        : 'border-border'

  return (
    <div className={`bg-bg-surface border-2 rounded-xl overflow-hidden ${borderClass}`}>
      <button onClick={() => setExpanded(value => !value)} className="w-full flex items-center gap-2 p-3 hover:bg-bg-hover">
        {statusIcon}
        <span className="text-text-muted text-xs w-6">{index + 1}.</span>
        <span className="text-sm font-medium text-text-primary">{step.label}</span>
        <span className="text-xs text-text-muted">→ {step.promptModuleKey}</span>
        {step.userConfirmRequired && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">⏸ 需确认</span>
        )}
        <span className="ml-auto text-xs text-text-muted">
          {result.status === 'done' && `${result.output.length} 字`}
          {result.status === 'failed' && '失败'}
          {result.status === 'skipped' && '已跳过'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 space-y-2 bg-bg-base">
          {step.userHint && <p className="text-xs text-text-muted">💡 {step.userHint}</p>}
          <textarea
            value={userInput}
            onChange={event => {
              setUserInput(event.target.value)
              onUserInputChange(event.target.value)
            }}
            rows={2}
            placeholder="你的输入(可选)：在此写本步内容,AI 会在你写的基础上生成/扩展"
            className="w-full px-2 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
          />
          {result.status === 'pending' && <p className="text-xs text-text-muted">待执行</p>}
          {result.status === 'running' && (
            <p className="text-xs text-accent flex items-center gap-1">
              <Sparkles className="w-3 h-3 animate-pulse" /> AI 生成中...
            </p>
          )}
          {result.status === 'done' && result.tokenUsage && (
            <div className="text-[10px] text-text-muted">
              Token: ↑{result.tokenUsage.inputTokens.toLocaleString()} ↓{result.tokenUsage.outputTokens.toLocaleString()}
            </div>
          )}
          {result.status === 'done' && (
            <>
              <textarea
                value={editedOutput}
                disabled={actionsDisabled}
                onChange={event => {
                  setEditedOutput(event.target.value)
                  onOutputChange(event.target.value)
                }}
                rows={8}
                className="w-full max-h-72 resize-y rounded border border-border bg-bg-surface p-2 font-sans text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <p className="text-[10px] text-text-muted">AI 草稿可直接编辑；复制、导出和提取候选均使用编辑后的内容。</p>
            </>
          )}
          {result.error && <p className="text-xs text-error">⚠ {result.error}</p>}
          {(result.status === 'done' || result.status === 'failed') && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={onRetry}
                disabled={actionsDisabled}
                className="text-xs text-accent hover:underline disabled:opacity-40"
              >
                重新生成
              </button>
              {result.status === 'done' && (
                <>
                  <span className="text-text-muted">·</span>
                  <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
                    {copied ? <Check className="w-3 h-3 text-success" /> : <ClipboardCopy className="w-3 h-3" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                  <button onClick={download} className="text-xs text-text-secondary">导出草稿</button>
                  <span className="text-text-muted">·</span>
                  <button
                    onClick={() => onExtract(editedOutput)}
                    disabled={!hasProject || actionsDisabled || !editedOutput.trim()}
                    title={!hasProject ? '需先进入项目' : '通过词条库提取候选，确认后才能写入'}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-3 h-3" /> 提取为设定候选
                  </button>
                </>
              )}
              {result.status !== 'done' && (
                <>
                  <span className="text-text-muted">·</span>
                  <button
                    type="button"
                    onClick={onSkip}
                    disabled={actionsDisabled}
                    className="text-xs text-text-secondary hover:underline disabled:opacity-40"
                  >
                    跳过此步
                  </button>
                </>
              )}
            </div>
          )}
          {result.status === 'pending' && isCurrent && (
            <button
              type="button"
              onClick={onSkip}
              disabled={actionsDisabled}
              className="text-xs text-text-secondary hover:underline disabled:opacity-40"
            >
              跳过此步
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default WorkflowStepCard
