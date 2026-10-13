import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {useAIConfigStore} from '../../stores/ai-config'
import {isAIConfigReady} from '../../lib/ai/config-readiness'
import {generateChatSourceReviewSuggestionsV1, readLatestChatSourceReviewRunV1, recoverChatSourceReviewRunV1, cancelChatSourceReviewRunV1, type ChatSourceReviewRunViewV1} from '../../lib/character-interaction/source-review-harness'

const PURPOSES = {identity: '身份与价值观', motivation: '目标与顾虑', voice: '语言与举止', knowledge: '事实与经历'}
const CAUTIONS = {ordinary: '仍需作者判断', secret: '留意秘密与知情范围', future: '留意尚未发生的情节', uncertain: '原文有待判断之处'}

export default function SourceSuggestions(props: {
  scope: WorkspaceScope; revision: number; projectionHash: string; fragmentKeys: string[]; disabled: boolean
  labels: Map<string, string>
}) {
  const config = useAIConfigStore(state => state.config)
  const [view, setView] = useState<ChatSourceReviewRunViewV1 | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const epoch = useRef({value: 0}).current
  const {projectId, worldId, workId} = props.scope
  useEffect(() => {
    const ticket = ++epoch.value
    setView(null); setBusy(false); setError('')
    void readLatestChatSourceReviewRunV1({projectId, worldId, workId}).then(next => {if (ticket === epoch.value) setView(next)})
      .catch(cause => {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))})
    return () => {epoch.value++}
  }, [epoch, projectId, workId, worldId, props.revision, props.projectionHash])
  const act = async (action: () => Promise<unknown>) => {
    const ticket = ++epoch.value
    setBusy(true); setError('')
    try {await action()} catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {
      if (ticket === epoch.value) {
        try {const next = await readLatestChatSourceReviewRunV1(props.scope); if (ticket === epoch.value) setView(next)}
        catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
        if (ticket === epoch.value) setBusy(false)
      }
    }
  }
  const unfinished = view?.status === 'unknown' || view?.status === 'pending'
  return <section aria-label="原文整理建议" className="space-y-2 rounded border border-border p-3">
    <h5>原文整理建议</h5>
    <p>勾选下方想讨论的资料，一次最多12项。AI 会解释用途并提示秘密、时态等风险；引用可对照原文，解释仍需你判断。建议不会修改资料或知情范围。</p>
    <p>已选 {props.fragmentKeys.length} 项。以已保存的方案为依据。</p>
    {!isAIConfigReady(config) && <p>配置全局 AI 后可生成建议，仍可直接手动检查资料。</p>}
    <button type="button" className="lf-action" disabled={props.disabled || busy || unfinished || !isAIConfigReady(config) || !props.fragmentKeys.length || props.fragmentKeys.length > 12}
      onClick={() => void act(() => generateChatSourceReviewSuggestionsV1({scope: props.scope, request: {draftRevision: props.revision, projectionHash: props.projectionHash, fragmentKeys: [...props.fragmentKeys]}, config}))}>
      {busy ? '正在整理…' : '生成所选资料的建议'}
    </button>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {unfinished && <div className="space-y-2">
      <p>{view.status === 'unknown' ? '这次请求的结果尚未留存，刷新不会重新发送。可稍后查看；结束等待后，再次生成会发起新请求。'
        : view.result ? '这次整理尚未完成，可恢复已保存的结果；恢复不调用模型。' : '这次准备尚未完成，没有可恢复的模型回复。请结束该任务后重新选择资料。'}</p>
      {view.result && <button type="button" className="lf-action" disabled={busy} onClick={() => void act(() => recoverChatSourceReviewRunV1(props.scope, view.runId))}>恢复已保存的建议</button>}
      <button type="button" className="lf-action" disabled={busy} onClick={() => void act(() => cancelChatSourceReviewRunV1(props.scope, view.runId))}>结束这次整理</button>
      <button type="button" className="lf-action" disabled={busy} onClick={() => void act(async () => undefined)}>查看最新结果</button>
    </div>}
    {view?.status === 'stale' && <p role="status">方案或来源已经变化，下面是历史建议，请按当前资料重新判断。</p>}
    {view?.status === 'cancelled' && <p>这次整理已结束，没有自动重发。</p>}
    {view?.status === 'blocked' && !view.result && <p>模型服务拒绝了这次请求，没有生成建议。请检查配置或服务状态后再明确发起新请求。</p>}
    {view?.result?.artifact.issues.map(issue => <p key={issue.code} className={issue.severity === 'error' ? 'text-danger' : 'text-text-muted'}>{issue.message}</p>)}
    {view?.result?.suggestions?.suggestions.map(row => <article key={row.fragmentKey} className="space-y-1 rounded bg-bg-base p-3" data-testid="chat-source-suggestion">
      <strong>{props.labels.get(row.fragmentKey) ?? '历史资料片段'} · {PURPOSES[row.purpose]}</strong>
      <p className="text-xs">{CAUTIONS[row.caution]}</p><p className="whitespace-pre-wrap break-words">{row.interpretation}</p>
      {row.evidenceQuotes.map((quote, index) => <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm" key={index}>{quote}</blockquote>)}
    </article>)}
  </section>
}
