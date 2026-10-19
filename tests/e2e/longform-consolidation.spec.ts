import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

async function create(page: Page, name: string) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://consolidation.invalid/v1', model: 'isolated', temperature: 0.7, maxTokens: 4000, contextWindow: 100000 }))
  })
  await createLongform(page, name)
  return Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
}
async function seed(page: Page, projectId: number) {
  return page.evaluate(async projectId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { resolveScope, stampNewRecord } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const scope = await resolveScope({ projectId }); const now = Date.now()
    const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', { projectId, name: '测试', domain: 'humanity', icon: 'X', fieldSchema: '[{"key":"a","label":"甲","type":"text"},{"key":"b","label":"乙","type":"longtext"}]' , sortOrder: 99, createdAt: now, updatedAt: now }))
    const entryId = await db.codexEntries.add(stampNewRecord(scope, 'codexEntries', { projectId, categoryId, name: '测试条目', summary: '旧印记', description: '旧地图', fields: '{"a":"旧","b":"旧"}', tags: '[]', sortOrder: 0, createdAt: now, updatedAt: now }))
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { projectId, parentId: null, type: 'chapter', title: '测试章', summary: '', order: 0, createdAt: now, updatedAt: now }))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { projectId, outlineNodeId, title: '测试章', content: '<p>apple 旧印记</p>', wordCount: 8, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now }))
    return { entryId, chapterId, outlineNodeId }
  }, projectId)
}

test('旧全局替换入口统一保存多字段、保留 HTML、可撤销且拦截过期预览', async ({ page }) => {
  const projectId = await create(page, '统一替换隔离验收'); const ids = await seed(page, projectId)
  await page.goto(`./workspace/${projectId}?module=global-replace`)
  await page.getByRole('button', { name: '跨设定字段', exact: true }).click()
  await page.getByLabel('设定查找', { exact: true }).fill('旧')
  await page.getByLabel('设定替换为', { exact: true }).fill('新')
  await page.getByRole('button', { name: '预览替换', exact: true }).click()
  await page.getByRole('button', { name: '创建快照并替换', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '创建快照并替换', exact: true }).click()
  await expect(page.getByText(/已保存 2 条记录/)).toBeVisible()
  const read = () => page.evaluate(async ids => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { entry: await db.codexEntries.get(ids.entryId), chapter: await db.chapters.get(ids.chapterId), snapshots: await db.snapshots.count() }
  }, ids)
  let saved = await read()
  expect(JSON.parse(saved.entry.fields)).toEqual({ a: '新', b: '新' }); expect(saved.chapter.content).toBe('<p>apple 新印记</p>'); expect(saved.snapshots).toBeGreaterThan(0)
  await page.getByRole('button', { name: '撤销上次替换', exact: true }).click()
  await expect(page.getByText('已撤销上次替换。', { exact: true })).toBeVisible()
  saved = await read(); expect(JSON.parse(saved.entry.fields)).toEqual({ a: '旧', b: '旧' }); expect(saved.chapter.content).toBe('<p>apple 旧印记</p>')
  await page.getByRole('button', { name: '预览替换', exact: true }).click()
  await expect(page.getByRole('button', { name: '创建快照并替换', exact: true })).toBeEnabled()
  await expect(page.locator('summary').filter({ hasText: '章节标题、摘要与正文' })).toHaveCount(1)
  await page.evaluate(async id => { const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))(); await db.chapters.update(id, { content: '<p>后续手稿</p>' }) }, ids.chapterId)
  await page.getByRole('button', { name: '创建快照并替换', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '创建快照并替换', exact: true }).click()
  await expect(page.getByText(/资料已变化/)).toBeVisible(); expect((await read()).entry.summary).toBe('旧印记')
})

test('自由试写刷新可恢复，拆分与采纳复用正式候选，未确认前不写入', async ({ page }) => {
  const projectId = await create(page, '自由对话隔离验收'); let calls = 0
  await page.route('https://consolidation.invalid/v1/chat/completions', async route => {
    calls++
    if (calls === 1) expect(route.request().postDataJSON().messages[0].content).toContain('自由讨论与试写')
    const content = calls === 1 ? '海上孤城的钟楼里，修钟师展开了雨中的来信。' : JSON.stringify([{ name: '海上孤城', icon: '', summary: '拥有钟楼的孤城', description: '海上孤城的钟楼里，修钟师展开了雨中的来信。', fields: {}, tags: [], importance: 1, evidenceQuotes: ['海上孤城的钟楼里'], provenance: 'verbatim-extraction' }])
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }) })
  })
  await page.goto(`./workspace/${projectId}?module=info&mode=agent&discussion=free`)
  await expect(page.getByLabel('交流方式')).toHaveValue('free')
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('试写第八章的一幕，先不存。')
  await page.getByRole('button', { name: '发送讨论 / 试写', exact: true }).click()
  await expect(page.getByText('海上孤城的钟楼里，修钟师展开了雨中的来信。', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('海上孤城的钟楼里，修钟师展开了雨中的来信。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '提取为设定候选', exact: true }).click()
  await expect(page.getByText('对话 → 设定候选', { exact: true })).toBeVisible()
  const counts = await page.evaluate(async () => { const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))(); return [await db.chapters.count(), await db.outlineNodes.count(), await db.codexEntries.count()] })
  expect(counts).toEqual([0, 0, 0]); expect(calls).toBe(1)
  await page.getByRole('button', { name: '人文环境', exact: true }).click()
  await page.getByText('城池重镇', { exact: true }).click()
  await page.getByRole('button', { name: 'AI 从内容拆分词条', exact: true }).click()
  await expect(page.getByPlaceholder('粘贴或编辑要拆分的整段设定内容')).toHaveValue('海上孤城的钟楼里，修钟师展开了雨中的来信。')
  await page.getByRole('checkbox', { name: /AI 补充词条标签/ }).uncheck()
  await page.getByRole('button', { name: '开始拆分', exact: true }).click()
  await expect(page.getByRole('button', { name: '写入所选 1 项', exact: true })).toBeEnabled()
  expect(await page.evaluate(async () => { const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))(); return db.codexEntries.count() })).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: '提取为设定候选', exact: true }).click()
  await page.getByRole('button', { name: '人文环境', exact: true }).click()
  await page.getByText('城池重镇', { exact: true }).click()
  await page.getByRole('button', { name: 'AI 从内容拆分词条', exact: true }).click()
  await page.getByRole('button', { name: '写入所选 1 项', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => { const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))(); return db.codexEntries.count() })).toBe(1)
  const entry = await page.evaluate(async () => { const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))(); return db.codexEntries.toArray() })
  expect(entry[0]).toMatchObject({ name: '海上孤城', origin: 'verbatim-extraction' }); expect(entry[0].producerRunId).toBeGreaterThan(0)
  expect(calls).toBe(2)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

})

test('设定查询不自动展示或认领旧历史，地点旧链接进入统一视图', async ({ page }) => {
  const projectId = await create(page, '旧入口隔离验收'); const ids = await seed(page, projectId)
  await page.evaluate(() => localStorage.setItem('storyforge-setting-qa-messages', JSON.stringify([{ role: 'user', content: '另一作品独有秘密' }])))
  await page.goto(`./workspace/${projectId}?module=chapters-list&chapter=${ids.outlineNodeId}`)
  await page.getByRole('button', { name: '设定查询', exact: true }).click()
  await expect(page.getByRole('region', { name: '设定查询', exact: true })).toBeVisible()
  await expect(page.getByText('另一作品独有秘密', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: '查看待认领的旧设定问答历史', exact: true }).click()
  await expect(page.getByText(/另一作品独有秘密/)).toBeVisible()
  await page.getByRole('button', { name: '确认属于当前作品并认领', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '认领并复制', exact: true }).click()
  await expect(page.getByText('另一作品独有秘密', { exact: true })).toBeVisible()
  for (const module of ['geography', 'world-map', 'locations']) {
    await page.goto(`./workspace/${projectId}?module=${module}`)
    await expect(page.getByRole('region', { name: '地点与地图工作区' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '地点与地图视图' }).getByRole('button', { name: module === 'geography' ? '地理设定' : module === 'world-map' ? '世界地图' : '地点库', exact: true })).toHaveAttribute('aria-current', 'page')
  }
})

test('旧提示词工作流默认不运行，预览后复制到正式节点且保留原资产', async ({ page }) => {
  const projectId = await create(page, '工作流收口隔离验收')
  const legacyId = await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.promptWorkflows.add({ scope: 'user', name: '隔离起源链', description: '原始流程保留', isDefault: false, createdAt: Date.now(), updatedAt: Date.now(), steps: [{ stepId: 'origin', label: '起源', promptModuleKey: 'worldview.dimension', userHint: '海上孤城', saveTarget: { type: 'worldview-field', field: 'worldOrigin' } }], graph: { version: 1, nodes: [{ stepId: 'origin', x: 0, y: 0 }], edges: [] } })
  })
  await page.goto(`./workspace/${projectId}?module=prompts`)
  await page.getByRole('button', { name: '提示词实验', exact: true }).click()
  await expect(page.getByRole('button', { name: '运行工作流 隔离起源链', exact: true })).toBeDisabled()
  const card = page.locator('div.rounded-xl').filter({ has: page.getByRole('heading', { name: '隔离起源链', exact: true }) }).last()
  await card.getByRole('button', { name: '转换为正式节点', exact: true }).click()
  await expect(page.getByRole('region', { name: '工作流转换预览' })).toContainText('起源 → 世界来源')
  await page.getByRole('button', { name: '确认复制为正式节点', exact: true }).click()
  await expect(page).toHaveURL(/module=visual-workflows/)
  const data = await page.evaluate(async legacyId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { legacy: await db.promptWorkflows.get(legacyId), flows: await db.nodeFlows.toArray(), worlds: await db.worldviews.count() }
  }, legacyId)
  expect(data.legacy.name).toBe('隔离起源链'); expect(data.flows).toHaveLength(1); expect(data.worlds).toBe(0)
  expect(JSON.parse(data.flows[0].graphJson).nodes[0].config.request).toBe('海上孤城')
})
