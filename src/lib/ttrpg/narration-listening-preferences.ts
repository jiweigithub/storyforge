import { useSyncExternalStore } from 'react'

/** Presentation preference on this browser only. No manuscript, game state,
 * voice-generation request, owner consent or media adoption is stored here. */
const KEY = 'storyforge:ttrpg:narration-listening:v1'
const EVENT = 'storyforge:ttrpg:narration-listening-changed'
export const TTRPG_NARRATION_DEFAULT_RATE_V1 = 0.9
export const TTRPG_NARRATION_RATES_V1 = [0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25] as const

export function readTtrpgNarrationRateV1(): number {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return value?.version === 1 && TTRPG_NARRATION_RATES_V1.some(rate => rate === value.rate) ? value.rate : TTRPG_NARRATION_DEFAULT_RATE_V1
  } catch { return TTRPG_NARRATION_DEFAULT_RATE_V1 }
}
export function saveTtrpgNarrationRateV1(rate: number): boolean {
  if (!TTRPG_NARRATION_RATES_V1.some(value => value === rate)) throw new Error('请选择支持的旁白语速')
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, rate })) }
  catch { return false }
  window.dispatchEvent(new Event(EVENT))
  return true
}
function subscribe(changed: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) changed() }
  window.addEventListener(EVENT, changed); window.addEventListener('storage', storage)
  return () => { window.removeEventListener(EVENT, changed); window.removeEventListener('storage', storage) }
}
export function useTtrpgNarrationRateV1() {
  return useSyncExternalStore(subscribe, readTtrpgNarrationRateV1, () => TTRPG_NARRATION_DEFAULT_RATE_V1)
}
export function applyTtrpgNarrationRateV1(element: HTMLAudioElement, rate: number) {
  element.preservesPitch = true
  // A new src/load restores the default rate in native browsers. Keep both
  // rates aligned so an audition source installation cannot undo the choice.
  element.defaultPlaybackRate = rate
  element.playbackRate = rate
}
