import {useEffect, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {listChatContextInspectionsV1, readChatContextInspectionV1, type ChatContextInspectionV1} from '../../lib/character-interaction/context-inspector'

export default function NarrativeContextInspector(props: {scope: WorkspaceScope; sessionId: number; disabled: boolean; sequence: number}) {
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0)
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listChatContextInspectionsV1>>>([])
  const [runId, setRunId] = useState<number | null>(null), [inspection, setInspection] = useState<ChatContextInspectionV1 | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const {projectId, worldId, workId} = props.scope
  useEffect(() => {
    if (!open || props.disabled) return
    let current = true
    setLoading(true); setError(''); setInspection(null); setRunId(null)
    void listChatContextInspectionsV1({projectId, worldId, workId}, props.sessionId).then(list => {
      if (current) {setRows(list); setRunId(list[0]?.runId ?? null); setLoading(false)}
    }).catch(() => {if (current) {setRows([]); setError('暂时无法读取调用记录，请稍后重新读取。'); setLoading(false)}})
    return () => {current = false}
  }, [open, props.disabled, props.sessionId, props.sequence, projectId, worldId, workId, revision])
  useEffect(() => {
    if (!open || runId == null || props.disabled) return
    let current = true
    setLoading(true); setError(''); setInspection(null)
    void readChatContextInspectionV1({projectId, worldId, workId}, props.sessionId, runId).then(value => {
      if (current) {setInspection(value); setLoading(false)}
    }).catch(() => {if (current) {setError('这次调用的上下文记录不完整或无法核验。现有故事不受影响。'); setLoading(false)}})
    return () => {current = false}
  }, [open, runId, props.disabled, props.sessionId, projectId, worldId, workId, revision])
  const list = (items: string[]) => items.length ? <ul className="list-disc space-y-1 pl-4">{items.map((text, i) => <li key={i} className="whitespace-pre-wrap">{text}</li>)}</ul> : <p className="text-text-muted">没有可展示的条目。</p>
  return <section className="rounded border border-border bg-bg-surface p-4">
    <button disabled={props.disabled && !open} aria-expanded={open} onClick={() => setOpen(value => !value)} className="text-xs text-text-muted disabled:opacity-40">{open ? '收起本次上下文' : '查看本次上下文'}</button>
    {open && <div data-testid="chat-context-inspector" className="mt-3 space-y-3 text-xs">
      <p className="text-text-muted">核对角色这次实际读到的内容，仅展示你在当时也已知的部分。角色私有目标、猜测、打算、记忆与关系不会在这里展开；查看不会调用模型。</p>
      {!!rows.length && <label className="block">选择调用<select aria-label="上下文调用记录" value={runId ?? ''} disabled={props.disabled} onChange={event => setRunId(Number(event.target.value))} className="ml-2 max-w-full rounded border border-border bg-bg-base p-2">{rows.map((row, index) => <option key={row.runId} value={row.runId}>{index === 0 ? '最近一次' : `较早第 ${index} 次`} · {new Date(row.createdAt).toLocaleString()}</option>)}</select></label>}
      {loading && <p role="status">正在核对实际输入…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !rows.length && <p>当前分支还没有角色行动调用记录；原分支的记录保留在原会话。</p>}
      {inspection && !inspection.available && <p role="status">{inspection.reason}</p>}
      {inspection?.available && <div className="space-y-3">
        <p>行动角色：{inspection.actorName} · 你扮演：{inspection.persona.name}</p>
        <p className="whitespace-pre-wrap">{inspection.persona.description}</p>
        <div><h3 className="mb-1 font-semibold">当时共同已知的事实</h3>{list(inspection.facts)}</div>
        <div><h3 className="mb-1 font-semibold">已读的来源知识</h3>{list(inspection.knowledge)}</div>
        <div><h3 className="mb-1 font-semibold">共同已知的剧情线</h3>{list(inspection.threads.map(t => `${t.title}：${t.question}`))}</div>
        <div><h3 className="mb-1 font-semibold">双方已有的已确认记忆</h3>{list(inspection.memories)}</div>
        <div><h3 className="mb-1 font-semibold">实际选入的共同对话</h3>{list(inspection.messages.map(m => `${m.speaker}：${m.text}`))}</div>
        <p className="text-text-muted">共同可见的历史对话中，用户排除 {inspection.omissions.excludedMessages} 条，长度预算省略 {inspection.omissions.budgetMessages} 条。排除原文不撤销已确认的事实或记忆。</p>
        <details className="break-all text-text-muted"><summary className="cursor-pointer">核验依据</summary><p>来源：角色互动单一视角 · 当时会话进度 {inspection.baseSequence} · 输入约 {inspection.inputTokens} token</p><p>版本：{inspection.sourceReleaseHash}</p><p>输入记录：{inspection.manifestHash}</p></details>
      </div>}
      <button disabled={props.disabled || loading} onClick={() => setRevision(value => value + 1)} className="rounded border border-border px-3 py-2 disabled:opacity-40">重新读取上下文记录</button>
    </div>}
  </section>
}
