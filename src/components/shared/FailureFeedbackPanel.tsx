import { useRef, useState } from 'react'
import { buildFailureSummary } from '../../lib/diagnostics/build-failure-summary'
import { failureFeedbackLink, FAILURE_FEEDBACK_URL, type FailureSummary } from '../../lib/diagnostics/failure-summary'
import { resetRuntimeDiagnostics } from '../../lib/diagnostics/runtime-errors'
import { clientMetadata, feedbackDiagnostics, submitClientFeedback, type ClientFeedback } from '../../lib/feedback/client-support'

/** Works without a Router, project, database, or global dialog provider. */
export default function FailureFeedbackPanel() {
  const [report, setReport] = useState<FailureSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<'bug' | 'feature'>('bug')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState('')
  const [expected, setExpected] = useState('')
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [sending, setSending] = useState(false)
  const submission = useRef<{ signature: string; body: ClientFeedback } | null>(null)
  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    if (sending || !confirmed) return
    if (title.trim().length < 2 || description.trim().length < 5) { setMessage('请填写标题和至少 5 个字的问题描述或建议。'); return }
    const contents = { kind, title: title.trim(), description: description.trim(), steps: kind === 'bug' ? steps : '', expected,
      client: clientMetadata(), ...(kind === 'bug' && includeDiagnostics && report ? { diagnostics: feedbackDiagnostics(report.errors) } : {}) }
    const signature = JSON.stringify(contents)
    if (submission.current?.signature !== signature) submission.current = { signature, body: { version: 1, id: crypto.randomUUID(), ...contents } }
    setSending(true); setMessage('')
    try {
      const receipt = await submitClientFeedback(submission.current.body)
      setMessage(`提交成功，回执编号：${receipt}。反馈已进入维护者收件箱。`)
      setTitle(''); setDescription(''); setSteps(''); setExpected(''); setConfirmed(false); setIncludeDiagnostics(false)
      submission.current = null
    } catch (error) { setMessage(error instanceof Error && error.name !== 'TimeoutError' ? error.message : '网络中断或超时，提交结果未确认。内容已保留，可以用同一编号重试。') }
    finally { setSending(false) }
  }
  const prepare = async () => {
    setBusy(true); setMessage('')
    try { setReport(await buildFailureSummary()) }
    catch { setMessage('诊断摘要暂不可用，仍可打开官方反馈页手动填写。') }
    finally { setBusy(false) }
  }
  return <section className="mt-5 w-full max-w-3xl rounded-xl border border-border bg-bg-surface p-4 text-left" aria-label="问题与故障反馈">
    <h3 className="text-sm font-semibold text-text-primary">问题与建议</h3>
    <p className="mt-2 text-xs leading-6 text-text-muted">遇到 Bug、页面报错或启动失败，可以先查看诊断摘要再反馈。浏览器允许存储时，最近 7 天最多 20 条错误留在本机；空间或权限不足时只保留当前会话。此处的反馈需确认后发送；自动错误上报由统计设置单独控制。不读取手稿、提示词、API Key 或完整浏览记录。</p>
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={sending} onClick={() => { setKind('bug'); setOpen(true) }} className="rounded bg-accent px-3 py-2 text-white">报告问题</button>
      <button type="button" disabled={sending} onClick={() => { setKind('feature'); setOpen(true); setIncludeDiagnostics(false) }} className="rounded border border-border px-3 py-2">功能建议</button>
      <button type="button" disabled={busy} onClick={() => void prepare()} className="rounded border border-border px-3 py-2 disabled:opacity-50">{busy ? '正在整理…' : '查看故障摘要并反馈'}</button>
      <a href={FAILURE_FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="rounded border border-border px-3 py-2">直接反馈问题</a>
      <button type="button" onClick={() => { resetRuntimeDiagnostics(); setReport(null); setMessage('浏览器中的本地错误记录已清空；作品和模型配置未改变。') }} className="rounded border border-border px-3 py-2">清空本地错误记录</button>
    </div>
    {message && <p role="status" className="mt-3 text-xs text-text-muted">{message}</p>}
    {open && <form onSubmit={event => void send(event)} className="mt-4 space-y-3 text-sm" aria-label={kind === 'bug' ? '报告问题表单' : '功能建议表单'}>
      <p className="text-xs leading-6 text-text-muted">{kind === 'bug' ? '按钮无反应、结果不符合预期、界面显示错误等都可以报告，不需要先发生崩溃。' : '请描述使用场景、目前遇到的困难，以及希望怎样改进。'}提交后直接进入官方维护者收件箱，不会自动公开到 GitHub。反馈明细保存 90 天；不要填写私人手稿或凭证。</p>
      <fieldset disabled={sending} className="space-y-3">
        <label className="block">标题<input required minLength={2} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>
        <label className="block">{kind === 'bug' ? '问题描述' : '建议与使用场景'}<textarea aria-label={kind === 'bug' ? '问题描述' : '建议与使用场景'} required minLength={5} maxLength={5000} rows={4} value={description} onChange={event => setDescription(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>
        {kind === 'bug' && <label className="block">复现步骤（可选）<textarea maxLength={3000} rows={3} value={steps} onChange={event => setSteps(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>}
        <label className="block">{kind === 'bug' ? '期望结果（可选）' : '希望怎样改进（可选）'}<textarea maxLength={2000} rows={2} value={expected} onChange={event => setExpected(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /></label>
        {kind === 'bug' && <label className="flex items-center gap-2"><input type="checkbox" checked={includeDiagnostics} onChange={event => { setIncludeDiagnostics(event.target.checked); if (event.target.checked) void prepare() }} />附带下方预览的脱敏错误记录（可选）</label>}
        <p className="text-xs text-text-muted">自动附带应用版本、操作系统类别和客户端类型。没有错误记录也可以提交。</p>
        <label className="flex items-center gap-2"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已检查填写内容，确认发送给维护者。</label>
        <button type="submit" disabled={!confirmed || busy || (includeDiagnostics && !report)} className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50">{sending ? '正在提交…' : '提交反馈'}</button>
      </fieldset>
    </form>}
    {report && <div className="mt-4 space-y-3 text-xs leading-6">
      <p>下方是本机故障摘要。应用内反馈只会附带你勾选的错误记录；也可以选择备用网页表单，网页表单提交的内容会进入公开 Issue。</p>
      <pre aria-label="故障摘要预览" className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-base p-3">{JSON.stringify(report, null, 2)}</pre>
      {report.launcher?.kind === 'interrupted' && <p>上次启动器可能未正常结束，也可能是断电或强制关闭；记录时间是本次检测时间，不是已知的崩溃时刻，也不证明发生了程序崩溃。</p>}
      <a href={failureFeedbackLink(report)} target="_blank" rel="noopener noreferrer" className="inline-block rounded bg-accent px-3 py-2 text-white">带摘要打开官方反馈表单</a>
    </div>}
  </section>
}
