import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceScope, WorldRevision } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { cancelNarrativeCompilationTaskV1, continueNarrativeCompilationTaskV1, createNarrativeCompilationTaskV1,
  listNarrativeCompilationTasksV1, readNarrativeCompilationTaskV1, sealNarrativeCompilationTaskV1 } from '../../lib/world-engine/narrative-compilation-task'

type LoadedTask = Awaited<ReturnType<typeof readNarrativeCompilationTaskV1>>
const labels: Record<string, string> = { completed: '编译完成', paused: '等待继续', running: '编译中或等待恢复',
  recovering: '等待恢复', failed: '已失败', cancelled: '已取消' }

/** This entire panel is behind the development-only narrative preview gate. */
export default function NarrativeCompilationPanel({ scope, selectedTables, label, parentRevisionId, revisions, disabled, onSealed }: {
  scope: WorkspaceScope; selectedTables: string[]; label: string; parentRevisionId: number | null; disabled: boolean
  revisions: WorldRevision[]
  onSealed: (revision: WorldRevision) => Promise<void>
}) {
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof listNarrativeCompilationTasksV1>>>([])
  const [task, setTask] = useState<LoadedTask | null>(null)
  const [includeWork, setIncludeWork] = useState(false)
  const [baseRevisionId, setBaseRevisionId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])

  const reload = useCallback(async (id?: number) => {
    const rows = await listNarrativeCompilationTasksV1(scope)
    const selected = id ?? rows[0]?.id
    const loaded = selected == null ? null : await readNarrativeCompilationTaskV1(scope, selected)
    if (mounted.current) { setTasks(rows); setTask(loaded) }
  }, [scope])
  useEffect(() => { void reload().catch(error => setMessage(error instanceof Error ? error.message : '读取编译任务失败')) }, [reload])

  const act = async (action: () => Promise<void>) => {
    if (busy || disabled) return
    setBusy(true); setMessage('')
    try { await flushPendingEditsV1(); await action() }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '编译操作失败') }
    finally { if (mounted.current) setBusy(false) }
  }
  const compile = (create: boolean) => act(async () => {
    let runId = task?.snapshot.run.id
    if (create) {
      const created = await createNarrativeCompilationTaskV1({ scope, selectedTables, includeWorkSources: includeWork,
        ...(baseRevisionId === null ? {} : { baseRevisionId }) })
      runId = created.snapshot.run.id
    }
    if (runId == null) return
    await reload(runId)
    const abort = new AbortController(); controller.current = abort
    try {
      await continueNarrativeCompilationTaskV1({ scope, runId, signal: abort.signal,
        onProgress: () => { if (mounted.current) setMessage('正在整理并核验选定内容，离开页面后可回来继续。') } })
      if (mounted.current) setMessage('编译完成。确认后可将这份快照冻结为修订。')
    } finally { controller.current = null; await reload(runId) }
  })
  const state = task?.snapshot.projection.state
  const terminal = state && ['completed', 'failed', 'cancelled'].includes(state)
  const unavailable = !task || task.historicalOnly || Boolean(task.staleReason)
  const sealed = task?.checkpoint.result && revisions.find(row => row.contentHash === task.checkpoint.result!.contentHash)
  const update = task?.checkpoint.result?.update
  const impactNames = new Map(update?.impact.items.map(item => [item.key, item.label]) ?? [])
  const fieldLabel = (pointer: string) => pointer.startsWith('/payload') ? '已确认含义' : pointer.startsWith('/time') ? '时间'
    : pointer.startsWith('/visibility') ? '可见范围' : pointer.startsWith('/dependencies') ? '依赖'
      : pointer.startsWith('/provenance') || pointer.startsWith('/evidence') ? '来源证据' : pointer.startsWith('/author') ? '审核记录' : '内容'
  const comparisonRevisions = revisions.filter(row => {
    try { return JSON.parse(row.manifestJson).version === 4 } catch { return false }
  })
  const comparisonParent = task?.checkpoint.baseline ? revisions.find(row => row.contentHash === task.checkpoint.baseline!.contentHash)?.id : parentRevisionId
  return <div className="space-y-3 rounded border border-border p-3" aria-label="实验性叙事编译与恢复">
    <strong>实验：叙事世界编译</strong>
    <p className="text-sm text-text-secondary">先核验所选原文和已审核内容，再由你确认冻结。编译无需调用模型；完成后不会自动发布。</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeWork} disabled={busy || disabled}
      onChange={event => setIncludeWork(event.target.checked)} />同时包含当前工作区作品的已确认正文与叙事</label>
    {comparisonRevisions.length > 0 && <label className="sf-world-pipeline-field">修改影响的比较基准<select value={baseRevisionId ?? ''} disabled={busy || disabled}
      onChange={event => setBaseRevisionId(Number(event.target.value) || null)}>
      <option value="">首次或全量编译</option>
      {comparisonRevisions.map(row => <option key={row.id} value={row.id}>修订 {row.revision} · {row.label}</option>)}
    </select></label>}
    <button className="sf-button sf-button-secondary" disabled={busy || disabled || selectedTables.length === 0} onClick={() => compile(true)}>捕获并编译所选内容</button>
    {tasks.length > 0 && <label className="sf-world-pipeline-field">已保存的编译任务<select value={task?.snapshot.run.id ?? ''} disabled={busy || disabled}
      onChange={event => void act(() => reload(Number(event.target.value)))}>{tasks.map(row => <option key={row.id} value={row.id}>任务 {row.id} · {labels[row.status] ?? row.status}</option>)}</select></label>}
    {task && <>
      <p data-testid="narrative-compilation-state">{labels[state!] ?? state} · 已尝试 {task.snapshot.projection.steps['world.narrative.compile-v4']?.attempt ?? 0}/3 次</p>
      {sealed && <p>这份编译结果已冻结为修订 {sealed.revision}，发布状态见上方版本列表。</p>}
      <p className="text-sm text-text-secondary">这份快照包含 {task.checkpoint.selectedTables.length} 个内容领域；{task.checkpoint.includeWorkSources ? '含当前作品的确认内容' : '仅世界草稿内容'}。</p>
      {task.staleReason && <p role="alert">{task.staleReason}</p>}
      {update && <section aria-label="世界修改影响" className="space-y-2 rounded border border-border p-2">
        <strong>修改影响与分片复用</strong>
        <p>直接变更 {update.impact.changedSemanticIds.length} 项；依赖待重验 {update.impact.staleSemanticIds.length} 项；需作者复核 {update.impact.reviewKeys.length} 项。</p>
        <p>原文索引分片：重建 {update.indexReuse.rebuiltSources.length}，复用 {update.indexReuse.reusedSources.length}。语义核验和全局关系装配仍完整执行。</p>
        <p className="text-sm text-text-secondary">这是当前草稿的检查清单。正文、锁定内容和已封存版本均未被自动修改。</p>
        {update.impact.unknownCoverage.length > 0 && <p role="status">仍有未表达的内容或依赖，相关条目已标为待复核。</p>}
        <details><summary>查看逐项依据</summary><ul className="max-h-72 overflow-auto text-sm">
          {update.impact.items.filter(item => item.disposition !== 'unaffected').map(item => <li key={item.key}>
            <strong>{({ rebuild: '重建', stale: '待重验', review: '待复核' } as Record<string, string>)[item.disposition]}</strong>
            {item.locked && ' · 作者已锁定'} · {item.label}
            {item.fieldDiffs.length > 0 && <div>变更：{[...new Set(item.fieldDiffs.map(field => fieldLabel(field.pointer)))].join('、')}</div>}
            {item.path.length > 0 && <div>影响路径：{!item.pathComplete && `${impactNames.get(item.pathRootKey!) ?? '变更来源'} → … → `}{[impactNames.get(item.path[0].from) ?? '原文证据', ...item.path.map(edge => impactNames.get(edge.to) ?? '相关内容')].join(' → ')}{!item.pathComplete && '（这里只展示最近 64 个依赖，完整关系仍保留）'}</div>}
            {item.unknownEdges.length > 0 && <div>覆盖不足，无法排除未声明的语义影响。</div>}
          </li>)}
        </ul></details>
      </section>}
      <div className="sf-world-pipeline-actions">
        <button className="sf-button sf-button-secondary" disabled={busy || disabled || Boolean(terminal) || unavailable} onClick={() => compile(false)}>继续编译</button>
        <button className="sf-button sf-button-secondary" disabled={disabled || Boolean(terminal) || task.historicalOnly}
          onClick={() => { void cancelNarrativeCompilationTaskV1(scope, task.snapshot.run.id).then(() => reload(task.snapshot.run.id))
            .catch(error => setMessage(error instanceof Error ? error.message : '取消失败')) }}>取消任务</button>
        <button className="sf-button sf-button-secondary" disabled={busy || disabled} onClick={() => void act(() => reload(task.snapshot.run.id))}>刷新任务状态</button>
        <button className="sf-button sf-button-primary" disabled={busy || disabled || state !== 'completed' || unavailable || Boolean(sealed)} onClick={() => void act(async () => {
          const revision = await sealNarrativeCompilationTaskV1({ scope, runId: task.snapshot.run.id, label, parentRevisionId: comparisonParent })
          setMessage(`已冻结为修订 ${revision.revision}。发布版本仍需单独确认。`)
          await onSealed(revision)
        })}>将编译结果冻结为修订</button>
      </div>
    </>}
    {message && <p role="status">{message}</p>}
  </div>
}
