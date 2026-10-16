import {test, expect} from '@playwright/test'

for (const reject of [false, true]) test(`a completed observation survives player input and its reviewed result informs the reply (reject=${reject})`, async ({page}) => {
  const inspected = '叶岑俯身查看了后门门闩的外侧，没有打开后门。'
  const direction = '确认这次外侧检查能否看出门闩有明显松动，不涉及门外情况。'
  const finding = '这次检查没有在门闩外侧看出明显松动，门外情况仍未知。'
  const reply = '不用你动手，刚才检查的门闩外侧没有明显松动，门外情况我仍不知道。'
  const calls: string[] = []; let actions = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-observation.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://chat-observation.invalid/**', async route => {
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const actionReview = prompt.includes('本次持久化行动候选'), situationReview = prompt.includes('本次持久化情境候选')
    const construction = !situationReview && prompt.includes('你是 StoryForge 受治理的幕后情境构建器')
    calls.push(actionReview ? 'action-review' : situationReview ? 'situation-review' : construction ? 'construction' : 'action')
    let output: unknown
    if (actionReview || situationReview) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', ...(actionReview ? ['consequences'] : []), 'meaningful-direction'].map(check => ({check, passed: !(reject && situationReview && check === 'continuity'), reason: '工程夹具，不是模型质量验收'}))}
    else if (construction) {
      expect(prompt).toContain('observation-result'); expect(prompt).toContain(inspected)
      output = {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚',
        newFacts: [{factKey: 'outside-checked', kind: 'observation', text: finding, audienceKeys: ['guard', 'player'], evidenceFactKeys: ['inspected'], seedExcerpt: '这次外侧检查能否看出门闩有明显松动'}],
        newGoals: [], newThreads: [], possibilities: []}
    } else {
      actions++; expect(prompt).not.toContain('柜台下')
      if (actions === 2) expect(prompt).toContain(finding)
      output = {kind: actions === 1 ? 'complete' : 'pause', text: actions === 1 ? inspected : reply,
        goalKey: 'find-seal', evidenceFactKeys: [actions === 1 ? 'lost' : 'outside-checked'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: actions === 1 ? [{factKey: 'inspected', kind: 'observation', text: inspected, evidenceFactKeys: ['lost'], evidenceExcerpt: inspected}] : [], disclosures: [], threadUpdates: [], goalStatus: null,
        situationRequest: actions === 1 ? {purpose: 'observation-result', threadKey: 'investigate', direction, evidenceFactKeys: ['lost', 'inspected'], evidenceExcerpt: inspected} : null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})})
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByRole('article').getByText(inspected, {exact: true})).toBeVisible()
  const observed = await read()
  expect(observed.chatNarrative.pendingSituation.purpose).toBe('observation-result')
  expect(observed.chatNarrative.factEvidence).toEqual({version: 1, records: [{factKey: 'inspected', kind: 'observation',
    evidenceFactKeys: ['lost'], actorKey: 'guard', goalKey: 'find-seal', source: 'action'}]})
  await page.reload(); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(observed); expect(calls).toHaveLength(2)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('我不动手，你自己决定。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  if (reject) await expect(page.getByText(/情境语义审查未通过/)).toBeVisible()
  else await expect(page.getByText(reply, {exact: true})).toBeVisible()
  const after = await read()
  expect(after.chatNarrative.situation.goals).toEqual(observed.chatNarrative.situation.goals)
  expect(after.chatNarrative.situation.possibilities).toEqual(observed.chatNarrative.situation.possibilities)
  expect(after.chatNarrative.situation.facts.filter((x: {factKey: string}) => x.factKey === 'inspected')).toHaveLength(1)
  expect(after.chatNarrative.situation.facts.filter((x: {factKey: string}) => x.factKey === 'outside-checked')).toHaveLength(reject ? 0 : 1)
  expect(after.chatNarrative.factEvidence.records).toEqual([...observed.chatNarrative.factEvidence.records, ...(reject ? [] : [{
    factKey: 'outside-checked', kind: 'observation', evidenceFactKeys: ['inspected'], actorKey: 'guard', goalKey: 'find-seal', source: 'situation',
  }])])
  if (reject) {
    expect(after.chatNarrative.pendingSituation).toEqual(observed.chatNarrative.pendingSituation)
    await expect(page.getByText(reply, {exact: true})).toHaveCount(0)
  } else expect(after.chatNarrative.pendingSituation).toBeUndefined()
  await page.reload(); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(after)
  expect(calls).toEqual(['action', 'action-review', 'construction', 'situation-review', ...(reject ? [] : ['action', 'action-review'])])
})
