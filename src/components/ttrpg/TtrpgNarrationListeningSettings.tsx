import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import sampleUrl from '../../assets/ttrpg/narration-preview.wav'
import { applyTtrpgNarrationRateV1, saveTtrpgNarrationRateV1, TTRPG_NARRATION_RATES_V1, useTtrpgNarrationRateV1 } from '../../lib/ttrpg/narration-listening-preferences'

/** A public fixed sample; playing it reveals no session text or private role. */
export default function TtrpgNarrationListeningSettings({ paused = false }: { paused?: boolean }) {
  const rate = useTtrpgNarrationRateV1(), audio = useRef<HTMLAudioElement | null>(null)
  const [error, setError] = useState('')
  useLayoutEffect(() => { if (audio.current) applyTtrpgNarrationRateV1(audio.current, rate) }, [rate])
  useLayoutEffect(() => { if (paused) audio.current?.pause() }, [paused])
  useEffect(() => {
    const element = audio.current
    const stop = () => element?.pause()
    const hidden = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop)
    return () => { stop(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop) }
  }, [])
  return <section className="sf-open-table-card" data-testid="ttrpg-narration-listening-settings">
    <h3>旁白试听与选择</h3>
    <p>先听一小段，再选适合自己的语速。设置会保存在当前浏览器，进入冒险后也可调整。</p>
    <label>旁白语速<select aria-label="旁白语速" value={rate} onChange={event => {
      setError(saveTtrpgNarrationRateV1(Number(event.target.value)) ? '' : '浏览器暂不能保存设置，请检查存储权限。')
    }}>{TTRPG_NARRATION_RATES_V1.map(value => <option key={value} value={value}>{value.toFixed(2)} 倍{value === 0.9 ? '（默认，稍慢）' : value === 1 ? '（原速）' : ''}</option>)}</select></label>
    <p>当前音色：中文自然旁白。</p>
    <audio ref={audio} src={paused ? undefined : sampleUrl} controls preload="none" aria-label="旁白语速试听" onPlay={event => {
      if (paused) event.currentTarget.pause()
      else applyTtrpgNarrationRateV1(event.currentTarget, rate)
    }} onError={() => setError('试听暂不可用，仍可继续文字游玩。')}/>
    {error && <p role="status">{error}</p>}
  </section>
}
