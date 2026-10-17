import { expect, test, type Page } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function seed(page: Page) {
  await page.goto('./')
  return page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-identity-knowledge-runtime.ts')).setupIdentityKnowledgeRuntimeV1()
    return { owner: s.owner, rootKey: s.root.knowledgeKey, entityRef: s.entityRef }
  })
}
async function enter(page: Page, id: number, viewerKey = 'viewer.gm') {
  await page.goto('./play/session/' + id)
  if (viewerKey === 'viewer.gm') {
    await page.getByLabel('我的主持席位', { exact: true }).selectOption(viewerKey)
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
    await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  } else {
    await page.getByLabel('我的角色', { exact: true }).selectOption(viewerKey)
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  }
  const card = page.getByTestId('ttrpg-open-identity-knowledge-panel'); await expect(card).toBeVisible({ timeout: 30000 }); return card
}
async function inspect(page: Page, id: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)
    return { count: state.ttrpg.openRun.knowledge.length, grants: state.ttrpg.openRun.knowledge.filter((r: any) => r.identityGrant).map((r: any) => ({ knowledgeKey: r.knowledgeKey, mode: r.identityGrant.mode, reliability: r.reliability })),
      root: JSON.stringify(state.ttrpg.openRun.knowledge[0]), entities: JSON.stringify(state.entities), time: JSON.stringify(state.ttrpg.openRun.worldTime), calls: state.ttrpg.openRun.coordination.calls.length,
      events: (await db.productRuntimeEvents.where('sessionId').equals(id).toArray()).filter((r: any) => r.type === 'ttrpg.open.knowledge.identity-confirmed').length }
  }, id)
}
test('native identity observation requires exact review, retries actual storage, reloads and stays hidden from another actor', async ({ page }) => {
  test.setTimeout(240000); let sends = 0; page.on('request', request => { if (request.url().includes('/chat/completions')) sends++ })
  const s = await seed(page), before = await inspect(page, s.owner.sessionId), card = await enter(page, s.owner.sessionId)
  await card.getByLabel('原知识', { exact: true }).selectOption(s.rootKey)
  await card.getByRole('checkbox', { name: '新守灯人', exact: true }).check(); await card.getByRole('checkbox', { name: 'hero', exact: true }).check()
  await card.getByRole('button', { name: '核对这次内容与接收者', exact: true }).click()
  const review = card.getByTestId('ttrpg-open-identity-knowledge-review'); await expect(review).toBeVisible()
  expect((await inspect(page, s.owner.sessionId)).count).toBe(1)
  await expect(review.getByRole('button', { name: '明确保存这次知识', exact: true })).toBeDisabled()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => { if (row.type === 'ttrpg.open.knowledge.identity-confirmed') { db.productRuntimeEvents.add = add; throw new Error('NATIVE-IDENTITY-STORAGE-CUT') } return add(row, ...args) }
  })
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: '明确保存这次知识', exact: true }).click()
  await expect(card.getByRole('alert')).toBeVisible(); expect((await inspect(page, s.owner.sessionId)).count).toBe(1)
  await review.getByRole('button', { name: '明确保存这次知识', exact: true }).click(); await expect(review).toHaveCount(0)
  const after = await inspect(page, s.owner.sessionId)
  expect(after).toMatchObject({ count: 2, events: 1, root: before.root, entities: before.entities, time: before.time, calls: before.calls })
  const hero = await enter(page, s.owner.sessionId, 'viewer.seat.hero'); await expect(hero).toContainText('新守灯人')
  const outsider = await enter(page, s.owner.sessionId, 'viewer.seat.companion.2'); await expect(outsider).not.toContainText('新守灯人')
  expect(sends).toBe(0)
})
test('native explicit identity share remains hearsay after parent deletion and full backup on a narrow viewport', async ({ page }, info) => {
  test.setTimeout(240000)
  const s = await seed(page)
  const rootGrant = await page.evaluate(async s => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, service = await load('/storyforge/src/lib/ttrpg/open-identity-knowledge-service.ts')
    const review = await service.prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, submissionKey: 'native.original.identity', request: { mode: 'observation', actorKey: null,
      sourceKnowledgeKey: s.rootKey, entityRefs: [s.entityRef], audience: 'private', recipientActorKeys: ['hero'] } })
    const result = await service.confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review, decision: 'confirm-these-identities-and-recipients' })
    await (await load('/storyforge/tests/helpers/open-identity-knowledge-runtime.ts')).identityKnowledgeWindowV1(s.owner.sessionId, 'viewer.seat.hero')
    return result
  }, s)
  const card = await enter(page, s.owner.sessionId, 'viewer.seat.hero')
  await card.getByLabel('身份知识操作', { exact: true }).selectOption('share')
  await card.getByLabel('原知识', { exact: true }).selectOption(`${rootGrant.knowledgeKey}:hero`)
  await card.getByRole('checkbox', { name: '新守灯人', exact: true }).check(); await card.getByRole('checkbox', { name: 'companion.2', exact: true }).check()
  await card.getByRole('button', { name: '核对这次内容与接收者', exact: true }).click()
  const review = card.getByTestId('ttrpg-open-identity-knowledge-review'); await expect(review).toContainText('按转述保存')
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: '明确保存这次知识', exact: true }).click(); await expect(review).toHaveCount(0)
  expect((await inspect(page, s.owner.sessionId)).grants.map(row => row.reliability)).toEqual(['observed', 'hearsay'])
  const imported = await page.evaluate(async owner => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts'), commands = await load('/storyforge/src/lib/ttrpg/runtime-commands.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const child = await core.branchProductRuntimeSession({ parentSessionId: owner.sessionId, throughSequence: (await core.readProductRuntimeState(owner.sessionId)).lastSequence, title: 'identity native child' })
    const state = await core.readProductRuntimeState(child.id), version = await core.readProductRuntimeStateVersion(child.id)
    await commands.completeTtrpgOpenSessionZeroV1({ sessionId: child.id, ...{ baseSequence: version.sequence, baseStateHash: version.stateHash }, commandId: 'native.identity.child.zero', viewerKey: 'viewer.gm',
      acceptedItemKeys: state.ttrpg.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await core.deleteProductRuntimeSession(owner.sessionId)
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), projectId = await backup.importProjectJSON(await backup.exportProjectJSON(owner.scope.projectId))
    return (await db.productRuntimeSessions.where('projectId').equals(projectId).first()).id
  }, s.owner)
  await page.setViewportSize({ width: 390, height: 844 }); const child = await enter(page, imported, 'viewer.seat.companion.2')
  await expect(child).toContainText('新守灯人 · 转述'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await child.screenshot({ path: info.outputPath('identity-child-mobile.png') })
})
