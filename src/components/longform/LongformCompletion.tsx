import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import type { Project } from '../../lib/types'
import { resolveScope } from '../../lib/workspace/scope'
import { commitLongformCompletionV1, readLongformCompletionV1 } from '../../lib/longform/completion'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { exportProjectJSON, downloadJSON } from '../../lib/export/json-export'
import { useProjectStore } from '../../stores/project'

export default function LongformCompletion({ project }: { project: Project }) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof readLongformCompletionV1>> | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const sub = liveQuery(async () => readLongformCompletionV1(await resolveScope({ projectId: project.id! }))).subscribe({ next: setReport, error: cause => setMessage(String(cause)) })
    return () => sub.unsubscribe()
  }, [project.id])
  useEffect(() => setAccepted(false), [report?.contentHash])
  const complete = async () => {
    if (!accepted || !report?.ready || busy) return
    setBusy(true); setMessage('')
    try {
      await flushPendingEditsV1()
      const scope = await resolveScope({ projectId: project.id! })
      const fresh = await readLongformCompletionV1(scope)
      if (fresh.contentHash !== report.contentHash || !fresh.ready) throw new Error('作品或运行状态已变化，请重新检查并确认。')
      // Registered export validates the complete lifecycle before the author marks the work complete.
      const backup = await exportProjectJSON(project.id!)
      await downloadJSON(backup, `${fresh.work.title}-完稿备份.json`)
      await commitLongformCompletionV1(scope, report.contentHash)
      await useProjectStore.getState().loadProjects()
      setMessage('已记录作品完成，并生成完稿前的完整备份。下方仍可导出正文及最新状态。')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  if (!report) return null
  return <details className="lf-paper" open><summary className="cursor-pointer text-lg">全书验收与交付</summary><p>{report.chapterCount} 个章纲 · {report.words.toLocaleString()} 字 · 目标 {report.work.targetWordCount.toLocaleString()} 字</p>{report.problems.length ? <ul className="my-3 max-h-40 overflow-auto text-sm">{report.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul> : <p>现有章纲均已有正文，已持久化的创作运行没有待处理项。</p>}<label className="flex gap-2 items-start my-4"><input type="checkbox" checked={accepted} disabled={!report.ready || busy} onChange={event => setAccepted(event.target.checked)}/><span>我已核对全书目标、结局、卷章覆盖与必要修订，确认当前作品可以交付。</span></label><button className="lf-action lf-action-primary" disabled={!accepted || !report.ready || busy} onClick={() => void complete()}>{busy ? '验收与备份中…' : '确认作品完成并备份'}</button>{message && <p role="status">{message}</p>}</details>
}
