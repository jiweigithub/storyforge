import {test, expect} from '@playwright/test'

test('editing a character message creates a recoverable draft branch and reconciles only the edited consequences', async ({page}) => {
  const original = '我把灯移到门边。门边亮了起来。', edited = '我先坐下听你说。'
  let actions = 0, reviews = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-edit.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://chat-edit.invalid/**', async route => {
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n'), review = prompt.includes('本次持久化行动候选')
    let output: unknown
    if (review) {reviews++; output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是语义验收'}))}}
    else {
      actions++
      if (actions === 2) {expect(prompt).toContain(edited); expect(prompt).not.toContain(original); expect(prompt).not.toContain('lit-door')}
      output = {kind: actions === 1 ? 'complete' : 'pause', text: actions === 1 ? original : edited,
        goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: actions === 1 ? [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}] : [],
        disclosures: [], threadUpdates: [], goalStatus: actions === 1 ? null : 'paused', nextPossibilities: []}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText(original, {exact: true})).toBeVisible()
  const parent = await read()
  await page.getByRole('button', {name: `改写消息 ${parent.messages[0].eventSequence}`, exact: true}).click()
  await page.getByLabel('改写历史消息', {exact: true}).fill(edited)
  await page.getByRole('button', {name: '建立改写分支', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toBeVisible()
  await expect(page.getByText(original, {exact: true})).toHaveCount(0)
  expect(await read()).toEqual(parent)
  await page.reload()
  await expect(page.getByLabel('待采用的改写', {exact: true})).toHaveValue(edited)
  expect(actions).toBe(1)
  await page.getByRole('button', {name: '审查并采用改写', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toHaveCount(0)
  await expect(page.getByText(edited, {exact: true})).toBeVisible()
  const child = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().runtimeState.interaction})
  expect(child.messages.map((m: {text: string}) => m.text)).toEqual([edited])
  expect(child.chatNarrative.situation.facts.some((fact: {factKey: string}) => fact.factKey === 'lit-door')).toBe(false)
  expect(actions).toBe(2); expect(reviews).toBe(2)
  expect(await read()).toEqual(parent)
  await page.reload()
  await expect(page.getByText(edited, {exact: true})).toBeVisible()
  expect(actions).toBe(2)
})

test('a player edit preserves private recipients and can be saved without a model', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    const message = await api.commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'private', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'private', text: '只对守卫说的话。', audienceKeys: ['guard']})
    return {...f, sequence: message.sequence}
  })
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: `改写消息 ${f.sequence}`, exact: true}).click()
  await page.getByLabel('改写历史消息', {exact: true}).fill('我改为等一会儿。')
  await page.getByRole('button', {name: '建立改写分支', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toBeVisible()
  await page.getByRole('button', {name: '保存改写消息', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toHaveCount(0)
  await expect(page.getByText('我改为等一会儿。', {exact: true})).toBeVisible()
  const result = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); const s = (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState(); return {id: s.selectedSessionId, state: s.runtimeState.interaction}})
  expect(result.id).not.toBe(f.sessionId)
  expect(result.state.messages[0].audienceKeys).toEqual(['guard'])
  expect(result.state.messages).toHaveLength(1)
  await page.reload()
  await expect(page.getByText('我改为等一会儿。', {exact: true})).toBeVisible()
})
