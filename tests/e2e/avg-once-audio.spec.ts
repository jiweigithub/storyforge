import { expect, test, type Page } from '@playwright/test'

async function prepare(page: Page, durationMs = 100, ambience = true, broken = false, voice = false) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    const events: Array<{ type: string; channel: string; trusted: boolean; time: number; playingChannels: string[] }> = []
    const frames: Array<{ at: number; channels: Array<{ channel: string; time: number; duration: number; paused: boolean; ended: boolean }> }> = []
    Object.assign(window, { __avgOnceAudioEvents: events, __avgOnceAudioFrames: frames })
    let remainingFrames = 0, sampling = false
    const sample = () => {
      frames.push({ at: performance.now(), channels: Array.from(document.querySelectorAll('audio')).map(a => ({ channel: a.dataset.channel ?? '', time: a.currentTime, duration: a.duration, paused: a.paused, ended: a.ended })) })
      if (frames.length > 256) frames.shift()
      if (--remainingFrames > 0) requestAnimationFrame(sample); else sampling = false
    }
    for (const type of ['playing', 'ended', 'error']) document.addEventListener(type, event => {
      const audio = event.target
      if (audio instanceof HTMLAudioElement && event.type === 'playing') {
        remainingFrames = 120
        if (!sampling) { sampling = true; requestAnimationFrame(sample) }
      }
      if (audio instanceof HTMLAudioElement) events.push({ type: event.type, channel: audio.dataset.channel ?? '', trusted: event.isTrusted, time: audio.currentTime,
        playingChannels: Array.from(document.querySelectorAll('audio')).filter(a => !a.paused && !a.ended && (a === audio || a.currentTime > .001)).map(a => a.dataset.channel ?? '') })
    }, true)
  })
  await page.goto('./avg/library')
  const owned = await page.evaluate(async options => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [fixture, native, rules, runtime] = await Promise.all([load('/storyforge/tests/helpers/avg-reading-fixture.ts'),
      load('/storyforge/tests/helpers/avg-native-fixture.ts'), load('/storyforge/tests/helpers/avg-system-fixture.ts'), load('/storyforge/src/lib/product/runtime-instances.ts')])
    const sfx = await fixture.avgReadingAudioFixture(options.durationMs, options.broken)
    const bgm = await fixture.avgReadingAudioFixture(12_000)
    const media = [{ ...sfx, asset: { ...sfx.asset, assetKey: 'audio.once.sfx', kind: 'sfx' } },
      { ...bgm, asset: { ...bgm.asset, assetKey: 'audio.loop.bgm', kind: 'bgm' } }]
    if (options.ambience) {
      const rain = await fixture.avgReadingAudioFixture(2100)
      media.push({ ...rain, asset: { ...rain.asset, assetKey: 'audio.once.ambience', kind: 'ambience' } })
    }
    if (options.voice) media.push(await fixture.avgReadingAudioFixture(4000))
    const cues = media.filter(({ asset }) => asset.kind !== 'voice').map(({ asset }, order) => ({ cueKey: `cue.${asset.kind}`, beatKey: 'line.desk', assetKey: asset.assetKey,
      type: 'play-audio', phase: 'before', durationMs: 0, easing: 'linear', order, loop: asset.kind === 'bgm', volume: .5 }))
    const source = await native.seedAvgNativePreview(rules.avgSystemFixture(), media, options.voice ? fixture.avgReadingFixture() : undefined, cues)
    const session = await runtime.createProductRuntimeInstance({ scope: source.scope, kind: 'avg', title: '原生一次性音频恢复（非人声工程PCM）',
      productSource: { kind: 'build', productBuildId: source.buildId, expectedPreviewHash: source.preview.previewHash } })
    return { scope: source.scope, sessionId: session.id }
  }, { durationMs, ambience, broken, voice })
  await page.goto(`./avg/play?project=${owned.scope.projectId}&work=${owned.scope.workId}&session=${owned.sessionId}`)
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  return owned
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [runtime, player] = await Promise.all([load('/storyforge/src/lib/product/runtime-core.ts'), load('/storyforge/src/stores/avg-game-player.ts')])
    const id = player.useAvgGamePlayerStore.getState().selectedSessionId
    const state = await runtime.readProductRuntimeState(id)
    return { receipts: state.presentation?.onceAudio?.receipts ?? [], sequence: state.lastSequence }
  })
}
async function captured(page: Page) {
  return page.evaluate(() => (window as unknown as { __avgOnceAudioEvents: Array<{ type: string; channel: string; trusted: boolean; time: number; playingChannels: string[] }> }).__avgOnceAudioEvents)
}
async function capturedFrames(page: Page) {
  return page.evaluate(() => (window as unknown as { __avgOnceAudioFrames: Array<{ at: number; channels: Array<{ channel: string; time: number; duration: number; paused: boolean; ended: boolean }> }> }).__avgOnceAudioFrames)
}
async function musicPlaying(page: Page) {
  await expect.poll(() => page.locator('audio[data-channel="bgm"]').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
}

test('actual ended 100ms SFX and non-loop ambience survive refresh without replay while loop music restores', async ({ page }, info) => {
  await prepare(page)
  await expect.poll(async () => (await snapshot(page)).receipts.filter((r: { status: string }) => r.status === 'ended').length).toBe(2)
  const before = await snapshot(page), events = await captured(page)
  for (const channel of ['sfx', 'ambience']) {
    expect(events.filter(e => e.channel === channel && e.type === 'playing')).toHaveLength(1)
    expect(events.filter(e => e.channel === channel && e.type === 'ended')).toHaveLength(1)
    expect(events.filter(e => e.channel === channel).every(e => e.trusted)).toBe(true)
  }
  await info.attach('actual-one-shot-ended-before-refresh', { body: JSON.stringify({ before, events }, null, 2), contentType: 'application/json' })
  await page.reload()
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await musicPlaying(page)
  expect(await snapshot(page)).toEqual(before)
  expect((await captured(page)).filter(e => ['sfx', 'ambience'].includes(e.channel) && e.type === 'playing')).toEqual([])
  await page.screenshot({ path: info.outputPath('once-audio-ended-restored.png'), fullPage: true })
})

test('a refreshed in-flight one-shot stays unknown until explicit replay admits a fresh generation', async ({ page }) => {
  await prepare(page, 7000, false)
  await expect.poll(() => page.locator('audio[data-channel="sfx"]').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
  const before = await snapshot(page)
  expect(before.receipts[0].status).toBe('requested')
  await page.reload()
  await expect(page.getByText('上次声音播放未确认结束。', { exact: true })).toBeVisible()
  await musicPlaying(page)
  expect(await snapshot(page)).toEqual(before)
  expect((await captured(page)).filter(e => e.channel === 'sfx' && e.type === 'playing')).toEqual([])
  await page.getByRole('button', { name: '重新播放声音片段', exact: true }).click()
  await expect.poll(() => page.locator('audio[data-channel="sfx"]').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
  await expect.poll(async () => (await snapshot(page)).receipts[0].generation).toBeGreaterThan(before.receipts[0].generation)
  await expect.poll(async () => (await snapshot(page)).receipts[0].status, { timeout: 10_000 }).toBe('ended')
  expect((await snapshot(page)).receipts[0].playedMs).toBe(7000)
})

test('actual decoder failure is durable, never fabricated ended, and explicit retry remains a distinct failed generation', async ({ page }) => {
  await prepare(page, 100, false, true)
  await expect.poll(async () => (await snapshot(page)).receipts[0]?.status).toBe('failed')
  const before = await snapshot(page)
  expect(before.receipts[0].playedMs).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '重新播放声音片段', exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: '重新播放声音片段', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).receipts[0].generation).toBeGreaterThan(before.receipts[0].generation)
  await expect.poll(async () => (await snapshot(page)).receipts[0].status).toBe('failed')
  expect((await captured(page)).filter(e => e.channel === 'sfx' && e.type === 'ended')).toEqual([])
})


test('four native channels genuinely overlap with a 100ms SFX after durable playback admission', async ({ page }, info) => {
  await prepare(page, 100, true, false, true)
  try {
    await expect.poll(async () => (await capturedFrames(page)).some(frame => ['bgm', 'ambience', 'sfx', 'voice'].every(channel => frame.channels.some(a => a.channel === channel && !a.paused && !a.ended && a.time > 0 && a.time < a.duration))), { timeout: 10_000 }).toBe(true)
  } finally {
    await info.attach('actual-short-four-channel-playback', { body: JSON.stringify({ state: await snapshot(page), events: await captured(page), frames: await capturedFrames(page) }, null, 2), contentType: 'application/json' })
  }
  expect((await captured(page)).every(event => event.trusted)).toBe(true)
})
