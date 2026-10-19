import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'

test('before the first turn a public sample previews the selected speed, keeps pitch and survives reload without enabling playback or changing a game', async ({ page }, info) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview')
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const helper = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const f = await helper.readyOpenTtrpgSessionV1('进入前旁白试听')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts')
    return { sessionId: f.sessionId, state: JSON.stringify(await core.readProductRuntimeState(f.sessionId)) }
  })
  let inference = 0
  page.on('request', req => { if (req.method() === 'POST' && (/\/local-codex\/v1\/requests$/.test(req.url()) || /\/local-tts\/v1\/jobs(?:\/[^/]+\/start)?$/.test(req.url()) || req.url().includes('/chat/completions'))) inference++ })
  await page.goto(`./play/session/${f.sessionId}`)
  const settings = page.getByTestId('ttrpg-narration-listening-settings'), audio = settings.getByLabel('旁白语速试听', { exact: true })
  await expect(settings).toBeVisible(); await expect(settings.getByLabel('旁白语速', { exact: true })).toHaveValue('0.9')
  await expect(page.getByLabel('我的角色', { exact: true })).toBeVisible()
  await settings.getByLabel('旁白语速', { exact: true }).selectOption('0.8')
  await audio.evaluate(async (el: HTMLAudioElement) => { await el.play() })
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => ({ paused: el.paused, rate: el.playbackRate, pitch: el.preservesPitch }))).toEqual({ paused: false, rate: 0.8, pitch: true })
  const source = await audio.evaluate((el: HTMLAudioElement) => el.currentSrc)
  const wav = await (await page.request.get(source)).body()
  expect(createHash('sha256').update(wav).digest('hex')).toBe('315c6c8c0db734b5f03237f1e8c4cccfe57d78f689cf065b279afcc5286a49d9')
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeCloseTo(13.560454, 3)
  await page.screenshot({ path: info.outputPath('pre-game-narration-speed.png'), fullPage: true })
  await page.reload()
  await expect(settings.getByLabel('旁白语速', { exact: true })).toHaveValue('0.8')
  expect(await audio.evaluate((el: HTMLAudioElement) => ({ paused: el.paused, rate: el.playbackRate, currentTime: el.currentTime }))).toEqual({ paused: true, rate: 0.8, currentTime: 0 })
  const after = await page.evaluate(async sessionId => {
    const load = new Function('p', 'return import(p)')
    return JSON.stringify(await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId))
  }, f.sessionId)
  expect(after).toBe(f.state); expect(inference).toBe(0)
})
