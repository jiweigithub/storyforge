import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenAudioPanel from '../../src/components/ttrpg/TtrpgOpenAudioPanel'
import { setupAudioRuntimeV1, audioWavFixtureV1 } from '../helpers/open-audio-runtime'
import * as audio from '../../src/lib/ttrpg/open-audio-service'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN10 actual audio component confirmation, local listening and identity', { timeout: 120000 }, () => {
  let host: HTMLDivElement, root: Root, props: Parameters<typeof TtrpgOpenAudioPanel>[0], release: (() => void) | null
  let createDescriptor: PropertyDescriptor | undefined, revokeDescriptor: PropertyDescriptor | undefined
  beforeEach(async () => {
    await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); release = null
    createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'); revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:audio-test-${crypto.randomUUID()}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    release?.(); await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks()
    if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor); else Reflect.deleteProperty(URL, 'createObjectURL')
    if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor); else Reflect.deleteProperty(URL, 'revokeObjectURL')
    db.close()
  })
  async function until(check: () => boolean) {
    for (let n = 0; n < 2400; n++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); if (check()) return }
    throw new Error('Audio UI did not settle: ' + host.textContent)
  }
  const button = (text: string) => [...host.querySelectorAll('button')].find(row => row.textContent === text)!
  const render = () => root.render(createElement(StrictMode, null, createElement(TtrpgOpenAudioPanel, props)))
  async function click(text: string) { await act(async () => button(text).click()) }
  async function setup(audience: 'party' | 'private' = 'party', voice = false) {
    const s = await setupAudioRuntimeV1(), review = await audio.prepareTtrpgOpenAudioUploadV1({ ...s.owner,
      request: s.request('ui.original', voice ? 'voice' : 'music', audience), file: audioWavFixtureV1(), name: 'AUDIO-PRIVATE-METADATA-CANARY', source: 'OWN-AUDIO-SOURCE',
      license: 'OWN-AUDIO-LICENSE', durationMs: 250, decision: 'prepare-this-file-for-reviewed-audio' })
    await audio.confirmTtrpgOpenAudioReviewV1({ ...s.owner, review, decision: 'confirm-this-audio-and-audience' })
    props = { input: s.owner, sequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence, paused: false, busy: false,
      onChanged: async () => { props = { ...props, sequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence }; render() } }
    await act(async () => render())
    await until(() => host.textContent?.includes('本桌可读的已保存音轨') ?? false)
    return s
  }
  it('keeps reads silent, requires exact review and retries a failed original confirmation without importing or sending again', async () => {
    let settledReads = 0; const actualRead = audio.readTtrpgOpenAudioDeskV1
    vi.spyOn(audio, 'readTtrpgOpenAudioDeskV1').mockImplementation(async input => { const result = await actualRead(input); settledReads++; return result })
    const s = await setup(), before = await db.productRuntimeEvents.count(), assets = await db.productMediaAssets.count(), models = await db.agentRuns.count()
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(host.querySelector('audio')).toBeNull()
    expect(host.textContent).not.toContain('背景音乐暂不可用。')
    await click('核对重播'); await until(() => !!host.querySelector('[data-testid="ttrpg-open-audio-review"]'))
    expect(button('确认本次音轨控制').disabled).toBe(true)
    const check = host.querySelector('[data-testid="ttrpg-open-audio-review"] input[type="checkbox"]') as HTMLInputElement
    await act(async () => check.click())
    const write = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('actual audio UI storage failure'))
    await click('确认本次音轨控制'); await until(() => !button('确认本次音轨控制').disabled && !!host.querySelector('[role="alert"]'))
    expect(check.checked).toBe(true); expect(await db.productRuntimeEvents.count()).toBe(before); write.mockRestore()
    await click('确认本次音轨控制'); await until(() => !host.querySelector('[data-testid="ttrpg-open-audio-review"]'))
    expect(await db.productRuntimeEvents.count()).toBe(before + 1); expect(await db.productMediaAssets.count()).toBe(assets); expect(await db.agentRuns.count()).toBe(models)
    await click('开启本机音频'); await until(() => !!host.querySelector('audio'))
    expect(host.textContent).not.toContain('背景音乐暂不可用。')
    const element = host.querySelector('audio')!, pause = vi.mocked(HTMLMediaElement.prototype.pause), calls = pause.mock.calls.length
    const readCount = settledReads
    props = { ...props, sequence: props.sequence + 1 }; await act(async () => render())
    await until(() => settledReads > readCount)
    expect(host.querySelector('audio')).toBe(element); expect(pause.mock.calls.length).toBe(calls)
    props = { ...props, paused: true }; await act(async () => render())
    expect(host.querySelector('audio')).toBeNull(); expect(pause.mock.calls.length).toBeGreaterThan(calls); expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect((await readProductRuntimeState(s.owner.sessionId)).lastSequence).toBe(before + 1)
  })
  it('silences identity handoff immediately and drops an old private file result on the same component', async () => {
    const s = await setup('private'), actual = audio.readTtrpgOpenAudioClipV1
    let started = false
    vi.spyOn(audio, 'readTtrpgOpenAudioClipV1').mockImplementationOnce(async input => {
      const result = await actual(input); started = true; await new Promise<void>(resolve => { release = resolve }); return result
    })
    await click('开启本机音频'); await until(() => started)
    props = { ...props, input: { ...s.owner, viewerKey: OPEN_HUMAN_VIEWER } }
    await act(async () => render())
    expect(host.textContent).not.toContain('AUDIO-PRIVATE-METADATA-CANARY'); expect(host.querySelector('audio')).toBeNull()
    await act(async () => { release?.(); release = null }); await until(() => !button('开启本机音频').disabled)
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(host.querySelector('audio')).toBeNull()
    expect(host.textContent).not.toContain('OWN-AUDIO-LICENSE'); expect(host.textContent).not.toContain('主持音轨管理')
  })
  it('uses text on corrupt bytes or an invalid actual voice duration, without changing the saved game', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.owner.sessionId), object = (await db.mediaBlobObjects.toArray())[0]
    await db.mediaBlobObjects.update(object.id!, { data: new Uint8Array([0]).buffer })
    await click('开启本机音频'); await until(() => host.textContent?.includes('音频不可用，已保留文字说明。') ?? false)
    expect(host.textContent).toContain('背景音乐暂不可用。')
    expect(host.querySelector('audio')).toBeNull(); expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(before)
    await act(async () => root.unmount()); host.remove(); await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await setup('party', true); await click('开启本机音频'); await until(() => !!host.querySelector('audio'))
    const element = host.querySelector('audio')!; Object.defineProperty(element, 'duration', { configurable: true, value: 20 })
    await act(async () => element.dispatchEvent(new Event('loadedmetadata')))
    await until(() => host.querySelector('audio') === null)
    expect(host.textContent).toContain('音频不可用，已保留文字说明。')
  })
  it('does not restore an old unconfirmed review after leaving and returning to the same identity', async () => {
    const s = await setup(), before = await db.productRuntimeEvents.count(), actual = audio.prepareTtrpgOpenRetainedAudioV1
    let started = false, returned = false
    vi.spyOn(audio, 'prepareTtrpgOpenRetainedAudioV1').mockImplementationOnce(async input => {
      const result = await actual(input); started = true
      await new Promise<void>(resolve => { release = resolve }); returned = true; return result
    })
    await click('核对重播'); await until(() => started)
    props = { ...props, input: { ...s.owner, viewerKey: OPEN_HUMAN_VIEWER } }
    await act(async () => render()); await until(() => !button('开启本机音频').disabled)
    props = { ...props, input: s.owner }
    await act(async () => render()); await until(() => !!button('核对重播'))
    expect(host.querySelector('[data-testid="ttrpg-open-audio-review"]')).toBeNull()
    await act(async () => { release?.(); release = null })
    await until(() => returned)
    expect(host.querySelector('[data-testid="ttrpg-open-audio-review"]')).toBeNull()
    await click('核对重播'); await until(() => !!host.querySelector('[data-testid="ttrpg-open-audio-review"]'))
    expect(button('确认本次音轨控制').disabled).toBe(true)
    expect(await db.productRuntimeEvents.count()).toBe(before)
  })
  it('keeps the saved acknowledgement when the outer game refresh fails after a real confirmation', async () => {
    const s = await setup(), before = await db.productRuntimeEvents.count()
    props = { ...props, onChanged: async () => { throw new Error('outer page refresh cut after commit') } }
    await act(async () => render())
    await click('核对重播'); await until(() => !!host.querySelector('[data-testid="ttrpg-open-audio-review"]'))
    const check = host.querySelector('[data-testid="ttrpg-open-audio-review"] input[type="checkbox"]') as HTMLInputElement
    await act(async () => check.click()); await click('确认本次音轨控制')
    await until(() => host.textContent?.includes('音轨已保存，桌面尚未刷新') ?? false)
    expect(host.querySelector('[data-testid="ttrpg-open-audio-review"]')).toBeNull(); expect(await db.productRuntimeEvents.count()).toBe(before + 1)
    expect((await readProductRuntimeState(s.owner.sessionId)).ttrpg!.openRun!.audioReceipts).toHaveLength(2)
  })
  it('does not let a previous identity refresh discard the new identity read after a saved confirmation', async () => {
    const s = await setup('private'), actual = audio.readTtrpgOpenAudioDeskV1
    let outerStarted = false, readerStarted = false, finishOuter: (() => void) | undefined, finishRead: (() => void) | undefined
    release = () => { finishOuter?.(); finishRead?.() }
    props = { ...props, onChanged: async () => { outerStarted = true; await new Promise<void>(resolve => { finishOuter = resolve }) } }
    await act(async () => render())
    await click('核对重播'); await until(() => !!host.querySelector('[data-testid="ttrpg-open-audio-review"]'))
    await act(async () => (host.querySelector('[data-testid="ttrpg-open-audio-review"] input[type="checkbox"]') as HTMLInputElement).click())
    await click('确认本次音轨控制'); await until(() => outerStarted)
    vi.spyOn(audio, 'readTtrpgOpenAudioDeskV1').mockImplementationOnce(async input => {
      const result = await actual(input); readerStarted = true
      await new Promise<void>(resolve => { finishRead = resolve }); return result
    })
    props = { ...props, input: { ...s.owner, viewerKey: OPEN_HUMAN_VIEWER }, sequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence }
    await act(async () => render()); await until(() => readerStarted)
    await act(async () => { finishOuter?.() })
    expect(host.textContent).not.toContain('AUDIO-PRIVATE-METADATA-CANARY')
    await act(async () => { finishRead?.() }); await until(() => !button('开启本机音频').disabled)
    expect(host.textContent).not.toContain('主持音轨管理'); expect(host.querySelector('audio')).toBeNull()
    expect((await readProductRuntimeState(s.owner.sessionId)).ttrpg!.openRun!.audioReceipts).toHaveLength(2)
  })
})
