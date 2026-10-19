import { useEffect, useRef, useState } from 'react'
import { FIELD_REGISTRY } from '../../lib/registry/field-registry'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { previewTextReplacementV1, commitTextReplacementV1, undoTextReplacementV1, TEXT_REPLACEMENT_TARGETS, type TextReplacementPreviewV1, type AuthorTextEditReceiptV1 } from '../../lib/editor/registered-text-replacement'
import { useBackupStore } from '../../stores/backup'
import { useWorldviewStore } from '../../stores/worldview'
import { useCharacterStore } from '../../stores/character'
import { useCodexStore } from '../../stores/codex'
import { useChapterStore } from '../../stores/chapter'
import { useStoryArcStore } from '../../stores/story-arc'
import { useWorldRulesStore } from '../../stores/world-rules'
import { useDialog } from '../shared/Dialog'

const LABELS: Record<string, string> = { worldviews: '世界观', storyCores: '故事核心', powerSystems: '力量体系', characters: '角色描述', codexEntries: '设定词条', chapters: '章节标题、摘要与正文', storyArcs: '故事线', worldRulesProfiles: '真实与幻想' }

export default function RegisteredTextReplacePanel({ projectId, worldGroupId, onEntityRename }: {
  projectId: number; worldGroupId: number | null; onEntityRename: () => void
}) {
  const dialog = useDialog()
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [targets, setTargets] = useState<string[]>(TEXT_REPLACEMENT_TARGETS)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [preview, setPreview] = useState<TextReplacementPreviewV1 | null>(null)
  const [receipt, setReceipt] = useState<AuthorTextEditReceiptV1 | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const active = useRef(true)
  const locked = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { setPreview(null); setMessage('') }, [query, replacement, targets, caseSensitive])
  const refresh = () => Promise.all([
    useWorldviewStore.getState().loadAll(projectId, worldGroupId), useCharacterStore.getState().loadAll(projectId),
    useCodexStore.getState().loadExisting(projectId), useChapterStore.getState().loadAll(projectId),
    useStoryArcStore.getState().loadAll(projectId), useWorldRulesStore.getState().loadProfile(projectId, worldGroupId),
  ])
  const run = async (operation: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setMessage('')
    try { await flushPendingEditsV1(); if (active.current) await operation() }
    catch (error) { if (active.current) setMessage(error instanceof Error ? error.message : String(error)) }
    finally { locked.current = false; if (active.current) setBusy(false) }
  }
  const createPreview = () => run(async () => {
    const next = await previewTextReplacementV1({ projectId, worldGroupId, query, replacement, targets, caseSensitive })
    if (active.current) { setPreview(next); setMessage(next.changes.length ? '' : '没有可替换的描述文字。') }
  })
  const apply = () => run(async () => {
    if (!preview) return
    const ok = await dialog.confirm({ title: '确认批量替换？', message: `将修改 ${preview.changes.length} 条记录。执行前自动保存快照，所有修改一起保存；资料变化时会停止。`, confirmText: '创建快照并替换', cancelText: '取消', tone: 'danger' })
    if (!ok || !active.current) return
    // A draft may have changed while the confirmation dialog was open.
    await flushPendingEditsV1()
    const result = await commitTextReplacementV1(preview, useBackupStore.getState().createSnapshot)
    if (!active.current) return
    setReceipt(result); setPreview(null); setMessage(`已保存 ${result.changes.length} 条记录；快照 #${result.snapshotId} 可在版本历史中恢复。`)
    try { await refresh() } catch { setMessage('替换已保存，但视图刷新失败；请重新打开页面查看结果。') }
  })
  const undo = () => run(async () => {
    if (!receipt) return
    await undoTextReplacementV1(receipt)
    if (!active.current) return
    setReceipt(null); setPreview(null); setMessage('已撤销上次替换。')
    try { await refresh() } catch { setMessage('撤销已保存，但视图刷新失败；请重新打开页面。') }
  })
  return <div className="space-y-3 p-4 text-sm">
    <p className="text-xs text-text-muted">保留原有设定批量编辑范围。仅修改描述文字；角色、地点与词条名称请使用实体改名，同步已有引用。</p>
    <fieldset disabled={busy} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label>查找<input aria-label="设定查找" className="mt-1 w-full rounded border border-border bg-bg-base p-2" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>替换为<input aria-label="设定替换为" className="mt-1 w-full rounded border border-border bg-bg-base p-2" value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="留空表示删除命中文字" /></label>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />区分大小写</label>
      <div className="flex flex-wrap gap-3">{TEXT_REPLACEMENT_TARGETS.map(target => <label key={target} className="flex items-center gap-1"><input type="checkbox" checked={targets.includes(target)} onChange={event => setTargets(current => event.target.checked ? [...current, target] : current.filter(value => value !== target))} />{LABELS[target] ?? target}</label>)}</div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void createPreview()} disabled={!query.trim() || !targets.length} className="rounded border border-border px-3 py-2 disabled:opacity-50">预览替换</button>
        <button onClick={() => void apply()} disabled={!preview?.changes.length} className="rounded bg-accent px-3 py-2 text-white disabled:opacity-50">创建快照并替换</button>
        <button onClick={() => void undo()} disabled={!receipt} className="rounded border border-border px-3 py-2 disabled:opacity-50">撤销上次替换</button>
      </div>
    </fieldset>
    {busy && <p role="status">正在处理，请稍候…</p>}
    {message && <p role="status" className="text-text-secondary">{message}</p>}
    {!!preview?.protectedNames.length && <div className="rounded bg-warning/10 p-2"><p>{preview.protectedNames.join('；')}</p><button onClick={onEntityRename} disabled={busy} className="text-accent underline">打开实体改名</button></div>}
    {preview && <div className="max-h-96 space-y-2 overflow-auto">{preview.changes.map(change => <details key={`${change.target}:${change.id}`} className="rounded border border-border p-2">
      <summary>{LABELS[change.target]} · {change.label} · {change.count} 处（{change.fields.join('、')}）</summary>
      {Object.keys(change.after).filter(field => field !== 'wordCount').map(field => <div key={field} className="mt-2">
        <p>{FIELD_REGISTRY.find(spec => spec.target === change.target && spec.field === field)?.labels?.[0] ?? field}</p>
        <div className="grid gap-2 sm:grid-cols-2"><pre className="whitespace-pre-wrap break-all rounded bg-bg-base p-2 text-xs">{typeof change.before[field] === 'string' ? change.before[field] as string : JSON.stringify(change.before[field], null, 2)}</pre><pre className="whitespace-pre-wrap break-all rounded bg-accent/5 p-2 text-xs">{typeof change.after[field] === 'string' ? change.after[field] as string : JSON.stringify(change.after[field], null, 2)}</pre></div>
      </div>)}
    </details>)}</div>}
    <p className="text-xs text-text-muted">关闭页面后仍可从版本历史恢复快照；撤销会检查后续编辑，避免覆盖新内容。</p>
  </div>
}
