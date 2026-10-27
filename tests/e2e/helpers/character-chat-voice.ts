import type {Page} from '@playwright/test'

export interface VoiceFixture {
  mode: 'allow' | 'deny' | 'network'
  starts: number; spoken: Array<{text: string; voice: string; volume: number}>; pauses: number; resumes: number; cancels: number
  result(text: string): void; failPlayback(): void
}
export type VoiceWindow = Window & {chatVoiceFixture: VoiceFixture}

/** Browser speech adapter fixture; it does not certify microphone or listening quality. */
export async function installChatVoiceFixture(page: Page) {
  await page.addInitScript(() => {
    let recognition: () => Recognition, utterance: Utterance
    const state: VoiceFixture = {mode: 'allow', starts: 0, spoken: [], pauses: 0, resumes: 0, cancels: 0,
      result: text => recognition().onresult?.({results: [{isFinal: true, 0: {transcript: text}}]}), failPlayback: () => utterance.onerror?.()}
    class Recognition {
      onstart?: () => void; onend?: () => void; onerror?: (event: {error: string}) => void
      onresult?: (event: {results: Array<{isFinal: boolean; 0: {transcript: string}}>}) => void
      start() {recognition = () => this; state.starts++; if (state.mode === 'allow') this.onstart?.(); else this.onerror?.({error: state.mode === 'deny' ? 'not-allowed' : 'network'})}
      stop() {this.onend?.()} abort() {}
    }
    class Utterance {
      onstart?: () => void; onend?: () => void; onerror?: () => void; volume = 1; voice?: SpeechSynthesisVoice
      constructor(public text: string) {}
    }
    const events = new EventTarget(), voices = [{voiceURI: 'isolated.zh', name: '工程测试音色', lang: 'zh-CN', localService: true, default: true}]
    Object.defineProperty(window, 'SpeechRecognition', {configurable: true, value: Recognition})
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable: true, value: Utterance})
    Object.defineProperty(window, 'speechSynthesis', {configurable: true, value: {
      getVoices: () => voices, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      speak: (item: Utterance) => {utterance = item; state.spoken.push({text: item.text, voice: item.voice?.voiceURI ?? '', volume: item.volume}); item.onstart?.()},
      cancel: () => {state.cancels++}, pause: () => {state.pauses++}, resume: () => {state.resumes++},
    }})
    ;(window as unknown as VoiceWindow).chatVoiceFixture = state
  })
}
