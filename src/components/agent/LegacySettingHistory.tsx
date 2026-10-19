import { useState } from 'react'
import { LEGACY_SETTING_HISTORY_KEY, claimLegacySettingHistoryV1, parseLegacySettingHistory } from '../../lib/agent/legacy-setting-history'
import { useDialog } from '../shared/Dialog'
import { resolveScope } from '../../lib/workspace/scope'

export default function LegacySettingHistory({ projectId, worldGroupId, onClaimed }: { projectId: number; worldGroupId: number | null; onClaimed: () => void }) {
  const dialog = useDialog()
  const [opened, setOpened] = useState(false)
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inspect = () => {
    try { setRaw(localStorage.getItem(LEGACY_SETTING_HISTORY_KEY)); setOpened(true) } catch { setError('浏览器不允许读取旧历史。') }
  }
  const download = () => {
    if (!raw) return
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'storyforge-unclaimed-setting-history.json'; link.click(); URL.revokeObjectURL(url)
  }
  const claim = async () => {
    if (!raw || busy) return
    setBusy(true); setError('')
    try {
      parseLegacySettingHistory(raw)
      const scope = await resolveScope({ projectId })
      if (!await dialog.confirm({ title: '确认旧历史属于当前作品？', message: '旧版本没有记录作品归属。确认后将复制到当前作品的炉娘对话；原始历史继续保留，不会直接写入设定或正文。', confirmText: '认领并复制', cancelText: '取消', tone: 'info' })) return
      await claimLegacySettingHistoryV1(projectId, worldGroupId, raw, scope)
      onClaimed()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-2 text-xs">
    <button type="button" onClick={inspect} className="text-text-muted underline">查看待认领的旧设定问答历史</button>
    {opened && <div className="rounded border border-border p-3">
      <p>旧记录未标记所属作品，尚未载入当前创作对话。</p>
      {raw ? <><pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{raw}</pre><div className="flex gap-3"><button type="button" onClick={download}>导出原始历史</button><button type="button" disabled={busy} onClick={() => void claim()} className="text-accent">确认属于当前作品并认领</button></div></> : <p>没有可认领的旧历史。</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>
}
