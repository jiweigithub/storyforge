import { expect, test, type Page, type Locator } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function seed(page: Page, humanGm = true) {
  await page.goto('./')
  return page.evaluate(async humanGm => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, helper = await load('/storyforge/tests/helpers/open-audio-runtime.ts')
    const s = await helper.setupAudioRuntimeV1(humanGm), core = await load('/storyforge/src/lib/product/runtime-core.ts'), state = await core.readProductRuntimeState(s.owner.sessionId)
    return { owner: s.owner, narrationSourceRef: s.narrationSourceRef, text: s.text, fileBytes: Array.from(new Uint8Array(await helper.audioWavFixtureV1().arrayBuffer())),
      beforeEntities: JSON.stringify(state.entities), beforeProduct: JSON.stringify(state.ttrpg.product), beforeTime: JSON.stringify(state.ttrpg.openRun.worldTime) }
  }, humanGm)
}
async function enter(page: Page, sessionId: number, humanGm = true) {
  await page.goto('./play/session/' + sessionId)
  if (humanGm) {
    await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
    await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  } else {
    await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  }
  const card = page.getByTestId('ttrpg-open-audio-panel'); await expect(card).toBeVisible({ timeout: 30000 })
  return card
}
async function fill(card: Locator, f: Awaited<ReturnType<typeof seed>>, channel = 'music', audience = 'party') {
  await card.getByText('主持音轨管理', { exact: true }).click()
  await card.getByLabel('音轨类型', { exact: true }).selectOption(channel)
  await card.getByLabel('音频接收范围', { exact: true }).selectOption(audience)
  await card.getByLabel('音频依据', { exact: true }).selectOption(JSON.stringify(f.narrationSourceRef))
  await card.getByLabel('音频文件', { exact: true }).setInputFiles({ name: '本机音轨.wav', mimeType: 'audio/wav', buffer: Buffer.from(f.fileBytes as number[]) })
  await card.getByLabel('音频来源', { exact: true }).fill('NATIVE-AUDIO-SOURCE-CANARY')
  await card.getByLabel('音频许可', { exact: true }).fill('NATIVE-AUDIO-LICENSE-CANARY；确定性静音样本，仅工程验证。')
  if (channel === 'voice') await card.getByLabel('我已试听并核对音频与上述文字一致。', { exact: true }).check()
  await card.getByRole('button', { name: '保存文件并核对音轨', exact: true }).click()
  const review = card.getByTestId('ttrpg-open-audio-review'); await expect(review).toBeVisible({ timeout: 30000 }); return review
}
async function approve(review: Locator) {
  const button = review.getByRole('button', { name: '确认本次音轨控制', exact: true }); await expect(button).toBeDisabled()
  await review.getByLabel('我已核对文件、文字与接收范围，并确认拥有本次使用许可。', { exact: true }).check(); await button.click()
}
async function inspect(page: Page, id: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)
    return { sequence: state.lastSequence, audio: state.ttrpg.openRun.audioReceipts?.length ?? 0, entities: JSON.stringify(state.entities), product: JSON.stringify(state.ttrpg.product),
      time: JSON.stringify(state.ttrpg.openRun.worldTime), assets: await db.productMediaAssets.where('productRuntimeSessionId').equals(id).count(), calls: state.ttrpg.openRun.coordination.calls.length }
  }, id)
}
test('native manual file review retries storage once, really decodes/plays, reloads silently and stops private playback on identity handoff', async ({ page }) => {
  test.setTimeout(240000); let sends = 0; page.on('request', req => { if (req.url().includes('/chat/completions')) sends++ })
  const f = await seed(page); let card = await enter(page, f.owner.sessionId)
  await expect(card.locator('audio')).toHaveCount(0)
  const review = await fill(card, f, 'music', 'gm-only'); expect((await inspect(page, f.owner.sessionId)).audio).toBe(0)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => { if (row.type === 'ttrpg.audio.cue.applied') { db.productRuntimeEvents.add = add; throw new Error('NATIVE-AUDIO-STORAGE-CUT') } return add(row, ...args) }
  })
  await approve(review); await expect(card.getByRole('alert')).toBeVisible(); expect((await inspect(page, f.owner.sessionId)).audio).toBe(0)
  await expect(review.getByRole('checkbox')).toBeChecked(); await review.getByRole('button', { name: '确认本次音轨控制', exact: true }).click()
  await expect(review).toHaveCount(0); await expect(card).toContainText('音轨控制已保存')
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  const audio = card.locator('audio'); await expect(audio).toHaveCount(1, { timeout: 30000 })
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0)
  const node = await audio.elementHandle(); await audio.focus(); await audio.press('Space')
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await card.getByRole('button', { name: '本机静音', exact: true }).click(); await expect(audio).toHaveCount(0); expect(await node!.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  await page.reload(); card = await enter(page, f.owner.sessionId); await expect(card.locator('audio')).toHaveCount(0)
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click(); await expect(card.locator('audio')).toHaveCount(1, { timeout: 30000 })
  const privateNode = await card.locator('audio').elementHandle(); await card.locator('audio').focus(); await card.locator('audio').press('Space')
  await expect.poll(() => card.locator('audio').evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  expect(await privateNode!.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  card = await enter(page, f.owner.sessionId, false); await expect(card.locator('audio')).toHaveCount(0)
  await expect(card).not.toContainText('NATIVE-AUDIO-LICENSE-CANARY'); await expect(card).not.toContainText('NATIVE-AUDIO-SOURCE-CANARY')
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ audio: 1, assets: 1, calls: 0, entities: f.beforeEntities, product: f.beforeProduct, time: f.beforeTime }); expect(sends).toBe(0)
})
test('native pending upload is not confirmed by reload; mobile child retains exact audio bytes after parent deletion and complete backup', async ({ page }, info) => {
  test.setTimeout(240000); const f = await seed(page); let card = await enter(page, f.owner.sessionId)
  await fill(card, f); await page.reload(); card = await enter(page, f.owner.sessionId)
  await expect(card.getByTestId('ttrpg-open-audio-review')).toHaveCount(0); expect((await inspect(page, f.owner.sessionId)).audio).toBe(0)
  const review = await fill(card, f); await approve(review); await expect(review).toHaveCount(0)
  const child = await page.evaluate(async owner => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts'), commands = await load('/storyforge/src/lib/ttrpg/runtime-commands.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await core.readProductRuntimeState(owner.sessionId), child = await core.branchProductRuntimeSession({ parentSessionId: owner.sessionId, throughSequence: state.lastSequence, title: 'audio native child' })
    const before = await core.readProductRuntimeState(child.id), version = await core.readProductRuntimeStateVersion(child.id)
    await commands.completeTtrpgOpenSessionZeroV1({ sessionId: child.id, commandId: 'native.audio.child.zero', baseSequence: version.sequence, baseStateHash: version.stateHash,
      viewerKey: owner.viewerKey, acceptedItemKeys: before.ttrpg.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await core.deleteProductRuntimeSession(owner.sessionId)
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(owner.scope.projectId)), copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    return { sessionId: copy.id, assets: await db.productMediaAssets.where('productRuntimeSessionId').equals(copy.id).count() }
  }, f.owner)
  expect(child.assets).toBe(1); await page.setViewportSize({ width: 390, height: 844 }); card = await enter(page, child.sessionId)
  await expect(card.locator('audio')).toHaveCount(0); await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  await expect(card.locator('audio')).toHaveCount(1, { timeout: 30000 }); await expect.poll(() => card.locator('audio').evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await card.screenshot({ path: info.outputPath('audio-child-mobile.png') })
})
test('native AI-host common voice binds the accepted script, hides private controls and falls back to text on corrupt bytes', async ({ page }) => {
  test.setTimeout(240000); let sends = 0; page.on('request', req => { if (req.url().includes('/chat/completions')) sends++ })
  const f = await seed(page, false), card = await enter(page, f.owner.sessionId, false), review = await fill(card, f, 'voice')
  await expect(card.getByLabel('音频接收范围', { exact: true })).toHaveCount(0)
  await expect(review).toContainText(f.text); await approve(review); await expect(review).toHaveCount(0)
  await expect(card.getByLabel('音频接收范围', { exact: true }).locator('option[value="gm-only"]')).toHaveCount(0)
  await expect(card.getByLabel('音频接收范围', { exact: true }).locator('option[value="private"]')).toHaveCount(0)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), object = await db.mediaBlobObjects.toCollection().first()
    await db.mediaBlobObjects.update(object.id, { data: new Uint8Array([0]).buffer })
  })
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  await expect(card).toContainText('音频不可用，已保留文字说明。', { timeout: 30000 }); await expect(card.locator('audio')).toHaveCount(0); await expect(card).toContainText(f.text)
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ audio: 1, calls: 0, entities: f.beforeEntities, product: f.beforeProduct, time: f.beforeTime }); expect(sends).toBe(0)
})
