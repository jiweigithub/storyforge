import { useEffect, useState } from 'react'
import type { AvgAudioProductionProcessingPlanV1 } from '../../lib/avg/audio-production-contract'
import type { AvgVoiceRequirementV1 } from '../../lib/avg/voice-production-contract'
import { assertAvgVoiceProcessingDraftV1 } from '../../lib/avg/voice-processing-draft-contract'
import { AVG_AUDIO_GAIN_MIN_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 } from '../../lib/avg/audio-gain-kernel'

type Props = {
  requirements: readonly AvgVoiceRequirementV1[]; saved?: AvgAudioProductionProcessingPlanV1
  disabled: boolean; ready: boolean; onPending: (value: boolean) => void
  onSave: (plan: AvgAudioProductionProcessingPlanV1 | null) => Promise<boolean>
}

export default function VoiceProcessingDraftPanel({ requirements, saved, disabled, ready, onPending, onSave }: Props) {
  const [rows, setRows] = useState(() => requirements.map(r => {
    const entry = saved?.entries.find(e => e.domain === 'voice' && e.requirementKey === r.requirementKey)
    return { requirementKey: r.requirementKey, enabled: !!entry, gainDb: String((entry?.recipe.gainMilliDb ?? 0) / 1000),
      declaration: entry?.recipe.declaration ?? '' }
  }))
  const [baseline, setBaseline] = useState(rows), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const pending = JSON.stringify(rows) !== JSON.stringify(baseline)
  useEffect(() => { onPending(pending); return () => onPending(false) }, [pending, onPending])
  const change = (index: number, update: Partial<typeof rows[number]>) => {
    setError(''); setRows(old => old.map((r, i) => i === index ? { ...r, ...update } : r))
  }
  const save = async () => {
    setSaving(true); setError('')
    try {
      const entries = rows.filter(r => r.enabled).map(row => {
        const gain = Number(row.gainDb)
        if (!row.gainDb.trim() || !Number.isFinite(gain)
          || gain < AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000 || gain > AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000) {
          throw new Error('请填写有效的音量调整值。')
        }
        return { domain: 'voice' as const, requirementKey: row.requirementKey,
          recipe: { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const,
            gainMilliDb: Math.round(gain * 1000), maximumDurationMs: requirements.find(r => r.requirementKey === row.requirementKey)!.maximumDurationMs,
            sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const, timelinePolicy: 'preserve' as const,
            overflowPolicy: 'reject' as const, declaration: row.declaration } }
      })
      const plan = entries.length ? assertAvgVoiceProcessingDraftV1({ schema: 'storyforge.avg.audio-production-processing-plan', version: 1, entries }, requirements) : null
      if (await onSave(plan)) setBaseline(rows)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  return <section aria-label="配音本地音量调整"><h4>本地音量调整 <small>实验</small></h4>
    <p>逐句选择要调整的音量，原音频始终保留。调整保持原时长、采样率和声道；结果仍须独立试听、确认采用。</p>
    {!ready && <p>目前可以保存调整要求，正式加工尚未开放。保存不会生成或修改音频。</p>}
    <fieldset className="avg-form" disabled={disabled || saving}>
      <legend>已保存的逐句配音</legend>
      {rows.map((row, index) => <fieldset key={row.requirementKey}><legend>第 {index + 1} 句</legend>
        <p>{requirements[index].text}</p>
        <label><input type="checkbox" checked={row.enabled} onChange={e => change(index, { enabled: e.target.checked })} />调整此句音量</label>
        {row.enabled && <><label>音量增减（dB）<input type="number" min={AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 / 1000}
          max={AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 / 1000} step={0.1} value={row.gainDb} onChange={e => change(index, { gainDb: e.target.value })} /></label>
          <p>负数调低，正数调高；超出音频可承受范围时会停止，不会直接削平失真。</p>
          <label>调整说明<textarea maxLength={2000} value={row.declaration} onChange={e => change(index, { declaration: e.target.value })} /></label></>}
      </fieldset>)}
      <button type="button" className="lf-action" disabled={!pending} onClick={() => void save()}>保存音量调整要求</button>
      <button type="button" className="lf-action" disabled={!pending} onClick={() => { setRows(baseline); setError('') }}>撤销未保存的音量调整</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section>
}
