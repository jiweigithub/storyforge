import { test, expect, type Page } from '@playwright/test'

test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview'))

/** Saved source/RulePack are isolated engineering input. All request/review/
 * composition/adoption operations below use normal product controls and the
 * real registered HTTP client; the local response is not a provider evaluation. */
async function prepare(page: Page) {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/ttrpg-open-design.ts')).createSavedOpenDesignFixtureV1()
    const source = await (await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')).prepareTtrpgOpenAuthoringDesignSourceV1(f)
    const boundary = await (await load('/storyforge/src/lib/product/source-contracts.ts')).resolveProductSourceReadBoundaryV1(source.source.sourcePlan)
    const world = await load('/storyforge/src/lib/context-gateway/world-release-client.ts')
    const descriptors = await world.listWorldSemanticResourceDescriptorsV1(boundary.sourceScope)
    const resources = await world.readWorldSemanticResourcesV1({ scope: boundary.sourceScope, descriptors })
    const campaign = (await load('/storyforge/tests/helpers/ttrpg-open-content.ts')).openCampaignFixture()
    ;(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'fixture-model',
      baseUrl: `${location.origin}/fixture-design-ui/v1`, apiKey: '', temperature: 0.7, maxTokens: 16000, contextWindow: 131072 })
    return { scope: f.scope, revision: f.revision, campaign, resources }
  })
  await page.goto(`./ttrpg/vision?project=${f.scope.projectId}&work=${f.scope.workId}`)
  const assistant = page.getByTestId('ttrpg-open-design-assistant')
  await expect(assistant).toBeVisible()
  await expect(assistant.getByRole('button', { name: '生成三个开放设计方向', exact: true })).toBeDisabled()
  return f
}
type Setup = Awaited<ReturnType<typeof prepare>>
function response(f: Setup, messages: { content: string }[], facts = false) {
  const keys = JSON.parse(messages[1].content.match(/【实际读取资源闭集】([^\n]+)/)![1])
  const resource = f.resources.find((item: any) => item.descriptor.resourceKey === keys[0])!
  const fieldPath = Object.keys(resource.value).find(key => /^[A-Za-z][A-Za-z0-9_-]*$/.test(key))!
  return JSON.stringify({ schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1,
    proposals: [0, 1, 2].map(index => ({ proposalKey: `design.${index}`, title: `方向${index + 1}：调查节奏`, pitch: `第${index + 1}种压力与事实候选，供作者核对。`, patch: {
      pressure: { clocks: f.campaign.clocks.map((clock: any) => ({ ...clock, maximum: 12 + index * 2, sourceRefs: [keys[0]] })),
        fronts: f.campaign.fronts.map((front: any) => ({ ...front, sourceRefs: [keys[0]] })) },
      ...(facts ? { factProposals: [0, 1].map(number => ({ ...f.campaign.frozenWorldPredicateIndex.entries[0], factKey: `fact.ui.${index}.${number}`,
        sourceResourceRefs: [keys[0]], sourceFieldRefs: [{ resourceKey: keys[0], fieldPath, contentHash: resource.descriptor.contentHash }] })) } : {}),
    } })) })
}
async function pressureRequest(page: Page, facts = false) {
  const assistant = page.getByTestId('ttrpg-open-design-assistant')
  for (const name of ['局势与动机', '开局局势', '后果与代价']) await assistant.getByRole('checkbox', { name, exact: true }).uncheck()
  if (facts) await assistant.getByRole('checkbox', { name: '新增世界事实', exact: true }).check()
  await assistant.getByLabel('本次设计要求', { exact: true }).fill('请起草三个不同的调查压力方向，保留作者选择。')
}
async function proof(page: Page, scope: Setup['scope']) {
  return page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await (await load('/storyforge/src/lib/ttrpg/authoring-service.ts')).readTtrpgDraft(scope)
    return { draft, settings: JSON.parse(draft.settingsJson), work: await db.works.get(scope.workId), runs: await db.agentRuns.toArray(),
      adoptions: (await db.agentRunEvents.toArray()).filter((event: any) => event.type === 'adoption.committed'),
      productions: await db.productProductions.count(), builds: await db.productBuilds.count() }
  }, scope)
}

test('normal author saves current edits, requests once, mixes sections, confirms only chosen new facts and reloads current canonical draft', async ({ page }, info) => {
  const f = await prepare(page); let requests = 0
  await page.route('**/fixture-design-ui/v1/chat/completions', async route => {
    requests++; const output = response(f, route.request().postDataJSON().messages, true)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  await page.getByRole('textbox', { name: '开场与核心目标', exact: true }).fill('请求前本人修改并保存的开场')
  await pressureRequest(page, true)
  const assistant = page.getByTestId('ttrpg-open-design-assistant')
  await assistant.getByRole('button', { name: '生成三个开放设计方向', exact: true }).click()
  await expect(assistant.locator('.ttrpg-design-proposal')).toHaveCount(3)
  const generated = await proof(page, f.scope)
  expect(generated.draft.revision).toBe(f.revision + 1); expect(generated.adoptions).toHaveLength(0)
  expect(generated.settings.openingSituation).toBe('请求前本人修改并保存的开场')
  expect(generated.settings.openAuthoring.pressure.clocks).toHaveLength(0)
  await assistant.getByLabel('本次设计要求', { exact: true }).fill('尚未发送的另一份要求')
  await expect(assistant.getByRole('button', { name: '确认选择并保存到开放草稿', exact: true })).toBeDisabled()
  await expect(assistant).toContainText('这份候选的原要求：请起草三个不同的调查压力方向')
  await assistant.getByRole('button', { name: '放弃本页未保存的要求与选择', exact: true }).click()
  await assistant.getByLabel('选择压力与威胁来源', { exact: true }).selectOption('design.1')
  await assistant.getByLabel('选择新增世界事实来源', { exact: true }).selectOption('design.2')
  await assistant.getByRole('checkbox', { name: /^我确认新增事实 fact\.ui\.2\.0/ }).check()
  // A donor change cannot borrow the old fact confirmation.
  await assistant.getByLabel('选择新增世界事实来源', { exact: true }).selectOption('design.1')
  await assistant.getByLabel('选择新增世界事实来源', { exact: true }).selectOption('design.2')
  await expect(assistant.getByRole('checkbox', { name: /^我确认新增事实 fact\.ui\.2\.0/ })).not.toBeChecked()
  await assistant.getByRole('checkbox', { name: /^我确认新增事实 fact\.ui\.2\.0/ }).check()
  await page.getByRole('navigation', { name: '跑团内容导航', exact: true }).getByRole('button', { name: '规则与村规', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/vision\?/); await expect(page.getByRole('alert')).toContainText('未保存的选择')
  await assistant.getByRole('button', { name: '确认选择并保存到开放草稿', exact: true }).click()
  await expect(assistant).toContainText(`这份设计已保存到草稿版本 ${f.revision + 2}`)
  const adopted = await proof(page, f.scope)
  expect(adopted.settings.openAuthoring.pressure.clocks[0].maximum).toBe(14)
  expect(adopted.settings.openAuthoring.factPolicy.map((item: any) => [item.fact.factKey, item.authorConfirmed])).toEqual([['fact.ui.2.0', true], ['fact.ui.2.1', false]])
  expect(adopted.work.title).toBe('作者保留的战役名称'); expect(adopted.adoptions).toHaveLength(1)
  expect(adopted.productions).toBe(0); expect(adopted.builds).toBe(0); expect(requests).toBe(1)
  await page.getByLabel('战役名称', { exact: true }).fill('采纳后人工名称')
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click(); await page.reload()
  await expect(page.getByLabel('战役名称', { exact: true })).toHaveValue('采纳后人工名称')
  await expect(assistant).toContainText(`这份设计已保存到草稿版本 ${f.revision + 2}`)
  const reloaded = await proof(page, f.scope)
  expect(reloaded.draft.revision).toBe(f.revision + 3); expect(reloaded.adoptions).toHaveLength(1); expect(requests).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('normal-author-design-adopted.png'), fullPage: true })
  await info.attach('normal-author-composition-adoption', { body: JSON.stringify({ generated, adopted, reloaded, requests }), contentType: 'application/json' })
})

test('human edits made while the original HTTP result is pending survive, and saving them makes the old candidate read-only', async ({ page }, info) => {
  const f = await prepare(page); let requests = 0, release!: () => void
  const received = new Promise<void>(resolve => { release = resolve })
  let acknowledge!: () => void; const started = new Promise<void>(resolve => { acknowledge = resolve })
  await page.route('**/fixture-design-ui/v1/chat/completions', async route => {
    requests++; acknowledge(); await received
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: response(f, route.request().postDataJSON().messages) }, finish_reason: 'stop' }] }) })
  })
  await pressureRequest(page); const assistant = page.getByTestId('ttrpg-open-design-assistant')
  await assistant.getByRole('button', { name: '生成三个开放设计方向', exact: true }).click(); await started
  await page.getByLabel('战役名称', { exact: true }).fill('模型等待期间的人工新标题'); release()
  await expect(assistant.locator('.ttrpg-design-proposal')).toHaveCount(3)
  await expect(assistant.getByRole('button', { name: '确认选择并保存到开放草稿', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(assistant).toContainText('这份设计只可参考')
  await expect(page.getByLabel('战役名称', { exact: true })).toHaveValue('模型等待期间的人工新标题')
  await assistant.getByRole('button', { name: '结束这份请求，不采用候选', exact: true }).click()
  await expect(assistant).toContainText('这份请求已明确结束')
  const current = await proof(page, f.scope)
  expect(current.work.title).toBe('模型等待期间的人工新标题'); expect(current.settings.openAuthoring.pressure.clocks).toHaveLength(0)
  expect(current.adoptions).toHaveLength(0); expect(current.runs[0].status).toBe('cancelled'); expect(requests).toBe(1)
  await expect(assistant.locator('.ttrpg-design-proposal')).toHaveCount(3)
  await expect(assistant).toContainText('原请求已结束，内容保留参考')
  await info.attach('human-edit-preserved', { body: JSON.stringify({ current, requests }), contentType: 'application/json' })
})

test('network-unknown refresh retains the original request and requires a separate acknowledgment to end it without resending', async ({ page }, info) => {
  const f = await prepare(page); let requests = 0
  await page.route('**/fixture-design-ui/v1/chat/completions', async route => { requests++; await route.abort('failed') })
  await pressureRequest(page); const assistant = page.getByTestId('ttrpg-open-design-assistant')
  await assistant.getByRole('button', { name: '生成三个开放设计方向', exact: true }).click()
  await expect(assistant).toContainText('我已核对原请求'); expect(requests).toBe(1)
  await page.reload(); await expect(assistant).toContainText('我已核对原请求'); expect(requests).toBe(1)
  await expect(assistant.getByRole('button', { name: '结束这份请求，不采用候选', exact: true })).toBeDisabled()
  await assistant.getByRole('button', { name: '读取原回答并恢复候选', exact: true }).click()
  await expect(assistant.getByRole('alert')).toContainText('没有唯一已保存回答'); expect(requests).toBe(1)
  await assistant.getByRole('checkbox', { name: /^我已核对原请求/ }).check()
  await assistant.getByRole('button', { name: '结束这份请求，不采用候选', exact: true }).click()
  await expect(assistant).toContainText('这份请求已明确结束')
  const current = await proof(page, f.scope)
  expect(current.runs).toHaveLength(1); expect(current.runs[0].status).toBe('cancelled')
  expect(current.draft.revision).toBe(f.revision); expect(current.adoptions).toHaveLength(0); expect(requests).toBe(1)
  await info.attach('original-unknown-not-resent', { body: JSON.stringify({ current, requests }), contentType: 'application/json' })
})

test('a locally changed world export must be explicitly saved before any new model request', async ({ page }, info) => {
  const f = await prepare(page); let requests = 0
  await page.route('**/fixture-design-ui/v1/chat/completions', async route => { requests++; await route.abort('failed') })
  const nav = page.getByRole('navigation', { name: '跑团页面导航', exact: true })
  await nav.getByRole('button', { name: '世界引擎', exact: true }).click()
  const save = page.getByRole('button', { name: '保存出口范围', exact: true })
  await expect(save).toBeVisible()
  const choices = page.locator('section').filter({ has: page.getByRole('heading', { name: '选择本战役读取的资源', exact: true }) }).getByRole('checkbox')
  const first = choices.first(); if (await first.isChecked()) await first.uncheck(); else await first.check()
  await nav.getByRole('button', { name: '制作台', exact: true }).click()
  await pressureRequest(page); const assistant = page.getByTestId('ttrpg-open-design-assistant')
  await assistant.getByRole('button', { name: '生成三个开放设计方向', exact: true }).click()
  await expect(assistant.getByRole('alert')).toContainText('明确保存读取范围')
  const current = await proof(page, f.scope)
  expect(requests).toBe(0); expect(current.runs).toHaveLength(0); expect(current.draft.revision).toBe(f.revision)
  expect(current.productions).toBe(0); expect(current.builds).toBe(0)
  await info.attach('unsaved-export-no-send', { body: JSON.stringify({ current, requests }), contentType: 'application/json' })
})
