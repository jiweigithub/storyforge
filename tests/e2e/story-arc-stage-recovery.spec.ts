import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const original = ' [{"id":"author-stage","title":"作者阶段","description":"保留描述","extra":{"note":"保留扩展"}}] '
const repaired = [{ id: 'author-stage', title: '作者阶段', description: '保留描述', extra: { note: '保留扩展' }, keyEvents: ['作者确认的事件'] }]

async function seed(page: Page) {
  await createLongform(page, '故事线阶段恢复隔离验收')
  await page.evaluate(async raw => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }] = await Promise.all([
      imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    const arcId = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', {
      name: '异常主线', type: 'main', stages: raw, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    await db.storylineProgress.add(stampNewRecord(scope, 'storylineProgress', {
      arcId, currentStageId: 'author-stage', status: 'active', progressNote: '保留进度',
      involvedEntities: '[]', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
  }, original)
  await page.getByRole('button', { name: '故事线', exact: true }).click()
  await expect(page.getByText('异常主线：阶段数据格式异常', { exact: true })).toBeVisible()
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return { arc: await db.storyArcs.toCollection().first(), progress: await db.storylineProgress.toCollection().first() }
  })
}

test('异常阶段可刷新恢复和检查，未经确认不会改写原文或发起模型调用', async ({ page }) => {
  const errors: string[] = []
  const modelRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (/\/(chat\/completions|responses|messages|[^/]+:generateContent)(?:\?|$)/.test(request.url())) modelRequests.push(request.method())
  })
  await seed(page)
  expect((await stored(page)).arc).toMatchObject({ stages: original, updatedAt: 1 })
  await expect(page.getByRole('button', { name: '扩写', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '添加阶段', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '检查并修复阶段数据', exact: true }).click()
  await expect(page.getByLabel('修复故事线阶段数据')).toHaveValue(original)
  await page.getByRole('button', { name: '确认保存阶段修复', exact: true }).click()
  await expect(page.getByText('阶段 1的关键事件必须是文本数组；没有事件时请填写 []。', { exact: true })).toBeVisible()
  expect((await stored(page)).arc.stages).toBe(original)
  await page.reload()
  await expect(page.getByText('异常主线：阶段数据格式异常', { exact: true })).toBeVisible()
  expect((await stored(page)).arc).toMatchObject({ stages: original, updatedAt: 1 })
  expect(errors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('显式保存修复保留阶段身份、扩展字段与进度，刷新后正常卡片可读', async ({ page }) => {
  await seed(page)
  const before = await stored(page)
  await page.getByRole('button', { name: '检查并修复阶段数据', exact: true }).click()
  await page.getByLabel('修复故事线阶段数据').fill(JSON.stringify(repaired))
  await page.getByRole('button', { name: '确认保存阶段修复', exact: true }).click()
  await expect(page.getByText('异常主线：阶段数据格式异常', { exact: true })).toHaveCount(0)
  const after = await stored(page)
  expect(JSON.parse(after.arc.stages)).toEqual(repaired)
  expect(after.arc.id).toBe(before.arc.id)
  expect(after.arc.workId).toBe(before.arc.workId)
  expect(after.progress.currentStageId).toBe('author-stage')
  expect(after.progress.progressNote).toBe('保留进度')
  await page.reload()
  await page.getByRole('button', { name: /作者阶段.*1 事件/ }).click()
  await expect(page.getByText('作者确认的事件', { exact: true })).toBeVisible()
})

test('原始阶段已被另一读取方改变时，拒绝旧修复并保留编辑稿', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: '检查并修复阶段数据', exact: true }).click()
  const editor = page.getByLabel('修复故事线阶段数据')
  await editor.fill(JSON.stringify(repaired))
  const newer = JSON.stringify([{ ...repaired[0], keyEvents: ['另一窗口的新事件'] }])
  await page.evaluate(async raw => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const arc = await db.storyArcs.toCollection().first()
    await db.storyArcs.update(arc.id, { stages: raw })
  }, newer)
  await page.getByRole('button', { name: '确认保存阶段修复', exact: true }).click()
  await expect(page.getByText('故事线阶段已变化，请刷新页面后检查，当前修复尚未保存。', { exact: true })).toBeVisible()
  await expect(editor).toHaveValue(JSON.stringify(repaired))
  expect((await stored(page)).arc.stages).toBe(newer)
  await page.reload()
  await page.getByRole('button', { name: /作者阶段.*1 事件/ }).click()
  await expect(page.getByText('另一窗口的新事件', { exact: true })).toBeVisible()
})
