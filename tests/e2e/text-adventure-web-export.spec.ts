import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import JSZip from 'jszip'
import { expect, test, type Locator } from '@playwright/test'
import { openTextAdventurePage } from './helpers/text-adventure-entry'

async function finish(player: Locator) {
  const next = player.locator('.adventure-narrative-continue')
  for (let index = 0; index < 400 && await next.count(); index++) await next.last().click()
  await expect(next).toHaveCount(0)
}

async function choose(player: Locator, name: string) {
  await finish(player)
  const button = player.getByRole('button', { name: new RegExp(`${name}$`) }).last()
  await expect(button).toBeEnabled()
  const entries = player.locator('.adventure-console-entry')
  const before = await entries.count()
  await button.click()
  await expect.poll(() => entries.count()).toBeGreaterThan(before)
  await finish(player)
}

test('独立网页 ZIP 在全新浏览器和子目录启动，刷新续玩、存档分支并达到两个结局', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'standalone-web-export-e2e'))
  await page.goto('./', { waitUntil: 'domcontentloaded' })
  const source = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [worldModule, candidateModule, e2eModule] = await Promise.all([
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/text-adventure-community-package.ts'),
      importer('/storyforge/tests/helpers/text-adventure-flagship-e2e.ts'),
    ])
    const owned = await worldModule.seedCurrentProductWorld('独立网页游戏技术验证工作区')
    const sourceCatalog = await worldModule.loadCurrentProductWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id, productType: 'text-adventure' })
    const candidate = await candidateModule.createTextAdventureCommunityPackageFixtureV1({ worldRelease: owned.release, sourceCatalog })
    await e2eModule.seedAuthoredTextAdventureCandidateForExportV1({ scope: owned.scope, worldRelease: owned.release, candidate })
    return { scope: owned.scope, title: candidate.dossier.title }
  })
  await openTextAdventurePage(page, source.scope, 'production')
  const panel = page.getByTestId('text-adventure-package-panel')
  await expect(panel).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await panel.getByRole('button', { name: '导出独立网页游戏', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('独立网页游戏已下载', { timeout: 30_000 })
  const download = await downloadPromise
  const output = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(output)
  await expect(panel.getByRole('status')).toContainText('独立网页游戏已下载')
  const zip = await JSZip.loadAsync(await readFile(output))
  const files = new Map<string, Buffer>()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) files.set(`/games/technical-fixture/${name}`, await entry.async('nodebuffer'))
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname
    const bytes = files.get(path)
    if (!bytes) { response.writeHead(404); response.end(); return }
    const mime = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript'
      : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : path.endsWith('.txt') ? 'text/plain' : 'application/octet-stream'
    response.writeHead(200, { 'content-type': mime, 'content-length': bytes.length })
    response.end(bytes)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const context = await browser.newContext()
  try {
    const gamePage = await context.newPage()
    const external: string[] = []
    const errors: string[] = []
    gamePage.on('request', request => { if (!request.url().startsWith(origin)) external.push(request.url()) })
    gamePage.on('pageerror', error => errors.push(error.message))
    // Existing same-origin author settings must not be read, changed or cleared.
    await gamePage.addInitScript(() => localStorage.setItem('author-test-sentinel', 'untouched'))
    await gamePage.goto(`${origin}/games/technical-fixture/index.html`)
    const player = gamePage.getByTestId('adventure-game-player')
    await expect(player).toBeVisible({ timeout: 30_000 })
    await player.getByRole('button', { name: new RegExp(`查看游戏：${source.title}`) }).click()
    await gamePage.setViewportSize({ width: 390, height: 844 })
    expect(await gamePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await player.getByRole('button', { name: '开始新冒险', exact: true }).click()
    await expect(player.getByRole('heading', { name: '封港仓房', exact: true })).toBeVisible()
    await gamePage.reload()
    await expect(player.getByRole('heading', { name: '封港仓房', exact: true })).toBeVisible({ timeout: 30_000 })
    await gamePage.setViewportSize({ width: 1280, height: 900 })
    for (const name of ['装备守灯披风', '前往回声盐沼', '辨认稳定路线', '沿石脊前往灯塔', '取下备用透镜', '带着透镜进入灯塔核心', '继续听完争论', '先承诺不放弃任何求救者']) await choose(player, name)
    await player.getByRole('button', { name: '存档', exact: true }).first().click()
    const saves = gamePage.getByRole('region', { name: '存档与时间线' })
    await saves.getByPlaceholder('为此刻命名').fill('网页终局分支点')
    await saves.getByRole('button', { name: '保存', exact: true }).click()
    await expect(saves.getByRole('button', { name: /网页终局分支点.*从这里分支/ })).toBeVisible()
    await saves.getByRole('button', { name: '关闭面板' }).click()
    for (const name of ['校准归航光路', '把灯火引向求救船', '确认获救者已经靠岸', '承担裂隙仍存的后果']) await choose(player, name)
    await expect(player).toContainText('冒险结束')
    await gamePage.reload()
    await expect(player).toContainText('冒险结束', { timeout: 30_000 })
    await player.getByRole('button', { name: '存档', exact: true }).first().click()
    await saves.getByRole('button', { name: /网页终局分支点.*从这里分支/ }).click()
    await saves.getByRole('button', { name: '关闭面板' }).click()
    for (const name of ['校准封闭光路', '封闭裂隙保护港城', '确认港城屏障已经稳定', '承担船队失去灯火的后果']) await choose(player, name)
    await expect(player).toContainText('冒险结束')
    expect(errors).toEqual([])
    expect(external).toEqual([])
    expect(await gamePage.evaluate(async () => (await indexedDB.databases()).map(row => row.name)))
      .toEqual([expect.stringMatching(/^storyforge-adventure-player-v1-[a-f0-9]{64}$/)])
    expect(await gamePage.evaluate(() => localStorage.getItem('author-test-sentinel'))).toBeNull()
    const raw = await context.newPage()
    await raw.goto(`${origin}/games/technical-fixture/README.txt`)
    expect(await raw.evaluate(() => localStorage.getItem('author-test-sentinel'))).toBe('untouched')
  } finally {
    await context.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
