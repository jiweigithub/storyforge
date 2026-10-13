import {test, expect} from '@playwright/test'

test('author classifies long passages independently and confirmed compilation preserves only approved text', async ({page}) => {
  let modelRequests = 0
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/chat/completions', async route => {modelRequests++; await route.abort()})
  await page.goto('./chat/library')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const {seedCurrentProductWorld} = await load('/storyforge/tests/helpers/current-product-world.ts')
    const service = await load('/storyforge/src/lib/character-interaction/draft-service.ts')
    const {DEFAULT_CHAT_SETTINGS_V2} = await load('/storyforge/src/lib/character-interaction/authoring-contract.ts')
    const source = await load('/storyforge/src/lib/product-production/world-source.ts')
    const background = '公开的守灯经历。\n'.repeat(1000) + '尾段秘密：旧信被藏在钟座里。'
    const world = await seedCurrentProductWorld('长资料页面验收', {characterDetails: {background}})
    const {scope} = await service.createChatDraftV1('逐段确认人物资料')
    const linked = await service.selectChatWorldV1(scope, 0, world.release.id)
    const catalog = await source.loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId})
    const key = catalog.selectionOptions.characters.find((c: {label: string}) => c.label === '林舟').resourceKey
    await service.saveChatDraftV1(scope, linked.revision, {...DEFAULT_CHAT_SETTINGS_V2, playerRole: '修钟学徒', openingSituation: '核对旧信', characters: [{sourceKey: key, voiceRules: '', privateKnowledge: '', initialTrust: 0}]})
    return {scope, worldReleaseId: linked.worldReleaseId, background}
  })
  await page.goto(`./chat/cast?project=${fixture.scope.projectId}&work=${fixture.scope.workId}`)
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  const passages = page.getByLabel(/林舟 背景（片段 \d+\/\d+） 可见范围/)
  await expect(passages).toHaveCount(2)
  await passages.first().selectOption('participants')
  await expect(passages.last()).toHaveValue('unclassified')
  await passages.last().selectOption('author-only')
  await page.getByRole('button', {name: '确认可见范围并用于新制作', exact: true}).click()
  await expect(page.getByText('已保存资料确认。更换角色或世界后需要重新检查。', {exact: true})).toBeVisible()
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(passages.first()).toHaveValue('participants')
  await expect(passages.last()).toHaveValue('author-only')
  const preview = page.locator('details').filter({has: page.locator('summary').filter({hasText: '检查参与者实际获得的资料'})}).last()
  await preview.locator('summary').click()
  await preview.getByRole('combobox').selectOption({label: '林舟'})
  await expect(preview).toContainText('背景（片段 1/2）')
  await expect(preview).toContainText('公开的守灯经历')
  await expect(preview).not.toContainText('尾段秘密')
  const content = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)')
    const service = await load('/storyforge/src/lib/character-interaction/draft-service.ts')
    const consultation = await load('/storyforge/src/lib/product-production/consultation.ts')
    const source = await load('/storyforge/src/lib/product-production/world-source.ts')
    const compiler = await load('/storyforge/src/lib/product-production/product-module-compilers.ts')
    const draft = await service.readChatDraftV1(f.scope)
    const settings = JSON.parse(draft.settingsJson)
    const starting = await consultation.suggestProductStartingPoints({scope: f.scope, worldReleaseId: f.worldReleaseId})
    const brief = await consultation.draftProductProductionBriefV3({scope: f.scope, worldReleaseId: f.worldReleaseId,
      suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', characterChat: settings,
      playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
    const sourceCatalog = await source.loadProductProductionWorldSourceCatalogV2({scope: f.scope, worldReleaseId: f.worldReleaseId, selection: brief.source.selection})
    return compiler.prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog}).content
  }, fixture)
  expect(content.knowledge).toHaveLength(1)
  const approved = content.knowledge[0]
  expect(JSON.parse(approved.content)).toBe(fixture.background.slice(approved.source.textRange.start, approved.source.textRange.end))
  expect(JSON.stringify(content)).not.toContain('尾段秘密')
  expect(modelRequests).toBe(0)
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
