import PromptInfluenceInfo from '../shared/PromptInfluenceInfo'
import type { AgentContextEvidence } from '../../lib/agent/context-policy'
import type { HarnessLifecycleEvidenceV1 } from '../../lib/agent/harness-evidence'
import type { PromptExecutionEvidenceV1 } from '../../lib/agent/prompt-execution'

const DELIVERY_LABELS = {
  full: '全文',
  compressed: '语义压缩',
  truncated: '确定性截断',
  none: '未输入',
} as const

const STATUS_STYLES = {
  passed: 'text-success',
  pending: 'text-accent',
  blocked: 'text-error',
  unavailable: 'text-text-muted',
} as const

function shortHash(value?: string): string {
  return value ? `${value.slice(0, 12)}…` : '无'
}

function count(value?: number): string {
  return value == null ? '未知' : value.toLocaleString()
}

export default function HarnessEvidencePanel({
  contextEvidence,
  lifecycle,
  promptExecutionEvidence,
}: {
  contextEvidence?: AgentContextEvidence
  lifecycle?: HarnessLifecycleEvidenceV1
  promptExecutionEvidence?: PromptExecutionEvidenceV1
}) {
  const context = contextEvidence ?? lifecycle?.contextEvidence
  const prompt = promptExecutionEvidence ?? lifecycle?.promptExecutionEvidence
  if (!context && !lifecycle && !prompt) return null
  const included = context?.included ?? []
  const omitted = context?.omitted ?? []
  const trimmed = context?.trimmed ?? []
  const estimatedInputTokens = context?.estimatedInputTokens ?? 0
  const inputBudgetTokens = context?.inputBudgetTokens ?? 0

  return (
    <details className="mt-2 rounded border border-border/60 bg-bg-base px-3 py-2 text-[10px] text-text-muted">
      <summary className="cursor-pointer text-text-secondary">
        <span>查看</span><span>本次实际输入证据</span>
        {context ? ` · ${included.length} 个来源` : ''}
        <span> · Harness 运行证据</span>
      </summary>
      <div className="mt-2 space-y-2 break-words">
        <PromptInfluenceInfo context={context} prompt={prompt} />
        {lifecycle && (
          <div aria-label="Harness 五段生命周期" className="grid gap-1 sm:grid-cols-5">
            {lifecycle.stages.map(item => (
              <div key={item.id} className="rounded border border-border/50 bg-bg-surface px-2 py-1.5">
                <p className={STATUS_STYLES[item.status]}>
                  {item.status === 'passed' ? '✓' : item.status === 'pending' ? '…' : item.status === 'blocked' ? '×' : '—'}{' '}
                  {item.label}
                </p>
                <p className="mt-0.5 leading-4">{item.detail}</p>
              </div>
            ))}
          </div>
        )}

        {context && (
          <div>
            <p>
              上下文 {estimatedInputTokens.toLocaleString()} / {inputBudgetTokens.toLocaleString()} tokens
              {' · '}策略 {context.profile}
            </p>
            {context.sourceEvidence?.length ? (
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border/50 text-text-secondary">
                      <th className="py-1 pr-2 font-medium">来源</th>
                      <th className="py-1 pr-2 font-medium">交付</th>
                      <th className="py-1 pr-2 font-medium">字符</th>
                      <th className="py-1 pr-2 font-medium">tokens</th>
                      <th className="py-1 font-medium">原文哈希</th>
                    </tr>
                  </thead>
                  <tbody>
                    {context.sourceEvidence.map(source => (
                      <tr key={source.key} className="border-b border-border/30 last:border-0">
                        <td className="py-1 pr-2 text-text-secondary">{source.key}</td>
                        <td className={source.delivery === 'truncated' ? 'py-1 pr-2 text-warning' : 'py-1 pr-2'}>
                          {DELIVERY_LABELS[source.delivery]}
                        </td>
                        <td className="py-1 pr-2">{count(source.originalCharacters)} → {count(source.inputCharacters)}</td>
                        <td className="py-1 pr-2">{source.originalTokens.toLocaleString()} → {source.inputTokens.toLocaleString()}</td>
                        <td className="py-1 font-mono" title={source.sourceHash}>{shortHash(source.sourceHash)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-1">已纳入：{included.join('、') || '无'}（旧候选没有逐来源证据）</p>
            )}
            {trimmed.length > 0 && <p className="mt-1 text-warning">因预算移除：{trimmed.join('、')}</p>}
            {omitted.length > 0 && <p className="mt-1">无数据/未启用：{omitted.join('、')}</p>}
          </div>
        )}

        {(lifecycle || prompt) && (
          <div className="grid gap-x-4 gap-y-1 border-t border-border/40 pt-2 sm:grid-cols-2">
            {lifecycle?.runId && <p>Run：#{lifecycle.runId}</p>}
            {lifecycle?.contentRevisionHash && <p>内容修订：<span className="font-mono">{shortHash(lifecycle.contentRevisionHash)}</span></p>}
            {lifecycle?.contextManifestHash && <p>Context Manifest：<span className="font-mono">{shortHash(lifecycle.contextManifestHash)}</span></p>}
            {lifecycle?.candidateHash && <p>候选：<span className="font-mono">{shortHash(lifecycle.candidateHash)}</span></p>}
            {lifecycle?.adoptionHash && <p>采纳：<span className="font-mono">{shortHash(lifecycle.adoptionHash)}</span></p>}
            {lifecycle?.terminalReceiptHash && <p>终态回执：<span className="font-mono">{shortHash(lifecycle.terminalReceiptHash)}</span></p>}
            {prompt && <p>Prompt 模板：<span className="font-mono">{shortHash(prompt.templateHash)}</span></p>}
            {prompt && <p>实际 Prompt：<span className="font-mono">{shortHash(prompt.renderedPromptHash)}</span></p>}
          </div>
        )}
      </div>
    </details>
  )
}
