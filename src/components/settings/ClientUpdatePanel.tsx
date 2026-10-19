import { useEffect, useState } from 'react'
import { getClientBridge, type ClientBridge, type ClientUpdateState } from '../../lib/platform/client-updates'

/** Native channels only. No user projects, API keys or manuscripts enter update requests. */
export default function ClientUpdatePanel({ notice = false }: { notice?: boolean }) {
  const [bridge, setBridge] = useState<ClientBridge>()
  const [state, setState] = useState<ClientUpdateState>()
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    void getClientBridge().then(async client => {
      if (!client || !active) return
      setBridge(client)
      const off = await client.subscribe(next => { if (active) setState(next) })
      if (!active) { off(); return }
      unsubscribe = off
      setState(await client.getState())
      if (notice) timer = setTimeout(() => { void client.check().then(next => { if (active) setState(next) }).catch(() => {}) }, 15_000)
    }).catch(() => {})
    return () => { active = false; unsubscribe?.(); clearTimeout(timer) }
  }, [notice])
  if (!bridge || !state || (notice && (dismissed || !['available', 'downloading', 'downloaded'].includes(state.status)))) return null
  const busy = ['checking', 'downloading'].includes(state.status)
  const run = async (action: 'check' | 'download' | 'install') => {
    try {
      if (action === 'install') {
        const { flushPendingEditsV1 } = await import('../../lib/authoring/pending-edit-coordinator')
        await flushPendingEditsV1()
      }
      setState(await bridge[action]())
    } catch { setState({ ...state, status: 'error', error: '操作未完成，客户端未更新。请确认编辑已保存后重试。' }) }
  }
  return <section aria-label="客户端更新" className={notice
    ? 'fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-border bg-bg-surface p-4 shadow-xl'
    : 'mb-6 rounded-xl border border-border bg-bg-surface p-4'}>
    <h3 className="text-sm font-semibold text-text-primary">客户端更新 · {state.currentVersion}</h3>
    <p className="my-2 text-xs text-text-secondary" role="status">
      {state.status === 'idle' && '从项目 GitHub Release 接收正式版本更新。'}
      {state.status === 'checking' && '正在检查 GitHub 更新…'}
      {state.status === 'current' && '暂无适用于当前客户端的新版本。'}
      {state.status === 'available' && `发现新版本 ${state.version}，可以下载更新。`}
      {state.status === 'downloading' && `正在下载 ${state.version}… ${state.progress ?? 0}%`}
      {state.status === 'downloaded' && `${state.version} 已下载并校验。请保存编辑、结束生成任务后安装。`}
      {state.status === 'error' && state.error}
    </p>
    <div className="flex flex-wrap gap-2">
      <button className="lf-action" disabled={busy} onClick={() => void run('check')}>检查更新</button>
      {state.status === 'available' && <button className="lf-action" onClick={() => void run('download')}>下载更新</button>}
      {state.status === 'downloaded' && <button className="lf-action" onClick={() => void run('install')}>安装更新</button>}
      {notice && <button className="lf-action" onClick={() => setDismissed(true)}>稍后</button>}
    </div>
    {!notice && <p className="mt-2 text-xs text-text-muted">升级前建议导出完整备份。更新不负责设备间同步；不要卸载或清除应用数据来升级。</p>}
  </section>
}
