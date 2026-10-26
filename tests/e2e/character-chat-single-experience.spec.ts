import {expect, test} from '@playwright/test'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {installChatVoiceFixture, type VoiceWindow} from './helpers/character-chat-voice'

// One author/player journey. Only the frozen world and provider/device outputs
// are fixtures; chat creation, confirmation, publication and actions use the UI.
for (const width of [390, 1440]) test(`single story from blank Work to illustrated voiced conversation and restoration at ${width}px`, async ({page, browser}, info) => {
  test.setTimeout(240_000)
  page.setDefaultTimeout(30_000)
  await page.setViewportSize({width, height: 844})
  await installChatVoiceFixture(page)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-journey.invalid/v1', model: 'test', maxTokens: 16000, apiKey: ''}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  const calls: string[] = []
  let actionCount = 0
  await page.route('https://chat-journey.invalid/**', async route => {
    if (await fulfillChatActionChoiceFixture(route)) {calls.push('choice'); return}
    const prompt = JSON.stringify(route.request().postDataJSON().messages)
    const opening = prompt.includes('初始情境编辑'), review = prompt.includes('开场的语义审查者')
    const actionReview = prompt.includes('本次持久化行动候选')
    calls.push(opening ? 'opening' : review ? 'opening-review' : actionReview ? 'action-review' : 'action')
    let output: unknown
    if (opening || review) output = await page.evaluate(async review => {
      const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
      const helper = await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')
      const source = JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'design.game').last()).payloadJson)
      const candidates = review ? JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'content.chat-candidates').last()).payloadJson) : helper.chatSituationCandidatesFixture(source)
      return review ? helper.chatOpeningPerspectiveReviewFixture(source, candidates) : candidates
    }, review)
    else if (actionReview) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '单角色完整流程的工程输入，不是模型质量评分。'}))}
    else {
      actionCount++
      output = {kind: 'pause', text: actionCount === 1 ? '我先自己核对旧账本，你可以安心休息。' : '我记得你想先看书，我会继续核对自己的记录。',
        goalKey: 'repair', evidenceFactKeys: ['clock'], audienceKeys: ['player', 'participant.001'], waitingForPlayer: false,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 100, total_tokens: 200}})})
  })
  await page.goto('./chat/library')
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    await (await load('/storyforge/tests/helpers/current-product-world.ts')).seedCurrentProductWorld('单角色技术预览世界')
  })
  await expect(page.getByRole('button', {name: '新建单角色故事', exact: true})).toHaveCount(0)
  await page.getByLabel('启用单角色故事新流程（技术预览）', {exact: true}).check()
  await page.getByLabel('作品名称', {exact: true}).fill('修钟铺的完整体验')
  await page.getByRole('button', {name: '新建单角色故事', exact: true}).click()
  await expect(page).toHaveURL(/chat\/vision\?/)
  const guide = page.getByRole('region', {name: '单角色体验指引', exact: true})
  await expect(guide).toBeVisible()
  await page.getByLabel('玩家身份', {exact: true}).fill('来店里借书的旅人，没有答应帮忙修钟。')
  await page.getByLabel('开场与场景目标', {exact: true}).fill('雨天，修钟铺的一台旧钟停了。')
  await page.getByLabel('每次触发的角色行动上限', {exact: true}).fill('1')
  await guide.getByRole('button', {name: '选择世界版本', exact: true}).click()
  await page.getByRole('button', {name: '选择此版本', exact: true}).first().click()
  await guide.getByRole('button', {name: '确认角色与知情范围', exact: true}).click()
  await page.getByRole('button', {name: '添加本体验新角色', exact: true}).click()
  await page.getByLabel('新角色 1 姓名', {exact: true}).fill('苏禾')
  await page.getByLabel('新角色 1 身份', {exact: true}).fill('修钟铺店主')
  await page.getByLabel('新角色 1 经历与目标', {exact: true}).fill('希望修好旧钟，愿意自己检查工具。')
  await page.getByLabel('新角色 1 性格与顾虑', {exact: true}).fill('温和而有主见。')
  const visuals = page.getByLabel('公开画面描述', {exact: true})
  await visuals.locator('summary').click()
  await page.getByLabel('苏禾 · 公开外观', {exact: true}).fill('短发，蓝色围裙，手中没有物品。')
  await page.getByLabel('开场背景画面描述', {exact: true}).fill('木质修钟铺，窗边书架和整洁的工作台。')
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.getByLabel('苏禾 姓名 用途', {exact: true}).selectOption('identity')
  await page.getByLabel('苏禾 姓名 可见范围', {exact: true}).selectOption('public')
  await page.getByLabel('苏禾 背景 用途', {exact: true}).selectOption('motivation')
  await page.getByLabel('苏禾 背景 可见范围', {exact: true}).selectOption('participants')
  await page.getByRole('button', {name: '确认可见范围并用于新制作', exact: true}).click()
  await guide.getByRole('button', {name: '确认方案并开始制作', exact: true}).click()
  await page.getByRole('button', {name: '启用自动制作', exact: true}).click()
  await page.getByLabel('视觉目标', {exact: true}).selectOption('key-scenes')
  await page.getByRole('button', {name: '分析可玩起点', exact: true}).click()
  await page.getByRole('button', {name: '生成严格 Brief', exact: true}).click()
  await page.getByRole('button', {name: '保存 Brief revision', exact: true}).click()
  await expect(page.getByText('Production 与 Brief revision 已保存；未授权前不会创建 Build 或调用生成能力。', {exact: true})).toBeVisible({timeout: 30_000})
  await guide.getByRole('button', {name: '继续制作与检查', exact: true}).click()
  await page.getByRole('button', {name: '作者授权并开始自动制作', exact: true}).click()
  await expect(page.getByTestId('chat-situation-selection')).toBeVisible({timeout: 60_000})
  expect(calls).toEqual(['opening', 'opening-review'])
  await page.reload()
  await page.getByRole('button', {name: '选择「旧账本」并继续', exact: true}).click()
  const media = page.getByTestId('chat-media-selection')
  await expect(media.getByRole('img')).toHaveCount(2, {timeout: 30_000})
  await media.getByRole('button', {name: '确认这些图片与用途并继续', exact: true}).click()
  await expect(page.getByRole('button', {name: '复验并原子发布', exact: true})).toBeEnabled({timeout: 30_000})
  await page.getByRole('button', {name: '复验并原子发布', exact: true}).click()
  await expect(page).toHaveURL(/chat\/play\?/, {timeout: 30_000})
  await page.getByRole('button', {name: '新建会话', exact: true}).click()
  const messages = page.getByRole('region', {name: '对话记录', exact: true})
  await expect(messages).toContainText('我先自己核对旧账本，你可以安心休息。', {timeout: 30_000})
  await expect(messages.getByRole('img')).toHaveCount(1)
  await expect.poll(() => messages.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('blob:')
  await page.getByRole('button', {name: '朗读', exact: true}).click()
  const voice = page.getByTestId('chat-voice-controls')
  await voice.locator('summary').first().click()
  await voice.getByRole('button', {name: '暂停朗读', exact: true}).click()
  await voice.getByRole('button', {name: '继续朗读', exact: true}).click()
  await voice.getByRole('button', {name: '停止朗读', exact: true}).click()
  await voice.getByRole('button', {name: '开始语音输入', exact: true}).click()
  await page.evaluate(() => (window as unknown as VoiceWindow).chatVoiceFixture.result('我先看会儿书，你按自己的打算来。'))
  await voice.getByRole('button', {name: '结束录音并查看转写', exact: true}).click()
  await expect(page.getByLabel('发送给角色的消息', {exact: true})).toHaveValue('')
  await voice.getByRole('button', {name: '添加到输入框', exact: true}).click()
  await voice.locator('summary').first().click()
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(messages).toContainText('我记得你想先看书，我会继续核对自己的记录。', {timeout: 30_000})
  const beforeReload = calls.length
  await page.reload()
  await expect(messages).toContainText('我记得你想先看书，我会继续核对自己的记录。')
  expect(calls).toHaveLength(beforeReload)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', {name: '发送并生成', exact: true})).toBeInViewport({ratio: 1})
  await page.screenshot({path: info.outputPath(`single-story-${width}.png`)})
  const backup = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), projectId = Number(new URL(location.href).searchParams.get('project'))
    return (await load('/storyforge/src/lib/export/json-export.ts')).exportProjectJSON(projectId)
  })
  const isolated = await browser.newContext({viewport: {width, height: 844}})
  try {
    const restored = await isolated.newPage()
    await restored.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    let restorationCalls = 0
    await restored.route('**/*', route => route.request().method() === 'POST' ? (restorationCalls++, route.abort()) : route.continue())
    await restored.goto(new URL('/storyforge/chat/library', page.url()).href)
    const ids = await restored.evaluate(async backup => {
      const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
      const projectId = await (await load('/storyforge/src/lib/export/json-export.ts')).importProjectJSON(backup)
      const session = await db.productRuntimeSessions.where('projectId').equals(projectId).last()
      return {projectId, workId: session.workId, sessionId: session.id}
    }, backup)
    await restored.goto(new URL(`/storyforge/chat/play?project=${ids.projectId}&work=${ids.workId}&session=${ids.sessionId}`, page.url()).href)
    await expect(restored.getByRole('region', {name: '对话记录', exact: true})).toContainText('我记得你想先看书，我会继续核对自己的记录。')
    await expect.poll(() => restored.getByRole('region', {name: '对话记录', exact: true}).evaluate(el => getComputedStyle(el).backgroundImage)).toContain('blob:')
    await restored.reload()
    await expect(restored.getByLabel('发送给角色的消息', {exact: true})).toBeVisible()
    expect(restorationCalls).toBe(0)
  } finally {await isolated.close()}
})
