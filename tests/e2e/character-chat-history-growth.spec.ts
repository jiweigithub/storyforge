import {test, expect} from '@playwright/test'
import {writeFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'

const target = Number(process.env.CHAT_HISTORY_GROWTH_ACTIONS ?? 100)
if (![100, 300, 1000].includes(target)) throw new Error('CHAT_HISTORY_GROWTH_ACTIONS must be 100, 300 or 1000')

test(`native IndexedDB retains ${target} consequential actions, actual historical input and portable checkpoints`, async ({page}, info) => {
  test.setTimeout(target === 100 ? 600_000 : 1_800_000)
  let externalCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://history-growth.invalid/v1', model: 'test', maxTokens: 8000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://history-growth.invalid/**', async route => {externalCalls++; await route.abort()})
  page.on('console', message => {if (message.text().startsWith('CHAT_GROWTH ')) console.info(message.text())})
  await page.goto('./chat/library')
  const outcome = await page.evaluate(async target => {
    const load = new Function('p', 'return import(p)')
    const helper = await load('/storyforge/tests/helpers/chat-history-growth.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    const portable = await load('/storyforge/src/lib/export/json-export.ts')
    const f = await helper.seedChatHistoryGrowthFixture(), started = performance.now()
    const worlds = JSON.stringify(await db.worldReleases.toArray())
    const progress: {actions: number; elapsedMs: number; lastActionMs: number}[] = []
    const checkpoints: {actions: number; sequence: number; facts: number; actorRead: boolean; reviewRead: boolean}[] = []
    let actions = 0, failure: string | null = null
    try {
      for (let i = 0; i < target; i++) {
        const before = performance.now(); await f.perform(helper.chatHistoryGrowthObservation(i)); actions++
        if (actions % 25 === 0) {const row = {actions, elapsedMs: Math.round(performance.now() - started), lastActionMs: Math.round(performance.now() - before)}; progress.push(row); console.info('CHAT_GROWTH ' + JSON.stringify(row))}
        if ([100, 300, 1000].includes(actions)) {
          const inputRead = {actor: false, review: false}
          const reply = {...helper.chatHistoryGrowthObservation(i), kind: 'speak', text: '旧登记上的靛蓝地图旁有杉木叶标记。', evidenceFactKeys: ['capacity-0'], newFacts: []}
          await f.perform(reply, '以前靛蓝地图的杉木叶标记是什么？', (phase: 'actor' | 'review', text: string) => {
            if (!text.includes('capacity-0') || !text.includes('靛蓝地图登记旁有杉木叶标记')) throw new Error('原线索没有进入实际' + phase + '输入')
            if (phase === 'actor' && text.includes('柜台下')) throw new Error('角色输入包含幕后秘密')
            inputRead[phase] = true
          })
          const state = await api.readProductRuntimeState(f.sessionId), session = await db.productRuntimeSessions.get(f.sessionId)
          const full = core.replayProductRuntimeEvents(core.parseProductRuntimeState(session.initialStateJson), await core.readSessionEvents(session))
          if (JSON.stringify(state) !== JSON.stringify(full)) throw new Error('完整重放与当前状态不一致')
          const facts = state.interaction.chatNarrative.situation.facts.length
          if (facts !== actions * 2 + 4) throw new Error('完整事实数量不一致')
          checkpoints.push({actions, sequence: state.lastSequence, facts, actorRead: inputRead.actor, reviewRead: inputRead.review})
        }
      }
    } catch (error) {failure = String(error)}
    const state = await api.readProductRuntimeState(f.sessionId)
    const result = {target, actions, failure, calls: f.calls(), progress, checkpoints, facts: state.interaction.chatNarrative.situation.facts.length,
      database: 'native IndexedDB', elapsedMs: Math.round(performance.now() - started)}
    if (failure) return {result, backup: JSON.stringify(await portable.exportProjectJSON(f.scope.projectId)), branches: [], worldUnchanged: JSON.stringify(await db.worldReleases.toArray()) === worlds}
    const branches: {title: string; stateHash: string; sessionId: number}[] = []
    for (const checkpoint of checkpoints) {
      const title = `native-growth-${checkpoint.actions}`
      const branch = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: checkpoint.sequence, title})
      branches.push({title, stateHash: await core.hashStateJson(JSON.stringify((await api.readProductRuntimeState(branch.id)).interaction)), sessionId: branch.id})
    }
    await api.deleteProductRuntimeSession(f.sessionId)
    const backup = await portable.exportProjectJSON(f.scope.projectId)
    const imported = await portable.importProjectJSON(backup)
    const sessions = await db.productRuntimeSessions.where('projectId').equals(imported).toArray()
    for (const branch of branches) {
      branch.sessionId = sessions.find((s: {title: string}) => s.title === branch.title).id
      if (await core.hashStateJson(JSON.stringify((await api.readProductRuntimeState(branch.sessionId)).interaction)) !== branch.stateHash) throw new Error('删除父档后的导入恢复不一致')
    }
    return {result: {...result, elapsedMs: Math.round(performance.now() - started)}, backup: JSON.stringify(backup), branches,
      worldUnchanged: JSON.stringify(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()) === worlds}
  }, target)
  writeFileSync(info.outputPath('native-growth-backup.json.gz'), gzipSync(outcome.backup))
  writeFileSync(info.outputPath('native-growth-result.json'), JSON.stringify({...outcome.result, externalCalls, worldUnchanged: outcome.worldUnchanged}, null, 2))
  await info.attach('native-growth-result', {body: JSON.stringify({...outcome.result, externalCalls, worldUnchanged: outcome.worldUnchanged}, null, 2), contentType: 'application/json'})
  expect(outcome.result.failure).toBeNull(); expect(outcome.result.actions).toBe(target); expect(outcome.result.facts).toBe(target * 2 + 4)
  expect(outcome.result.calls).toBe(target * 2 + outcome.result.checkpoints.length * 2)
  expect(outcome.result.checkpoints.every(c => c.actorRead && c.reviewRead)).toBe(true)
  expect(outcome.worldUnchanged).toBe(true); expect(externalCalls).toBe(0)
  await page.reload()
  const restored = await page.evaluate(async branches => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), core = await load('/storyforge/src/lib/product/runtime-core.ts')
    return Promise.all(branches.map(async branch => ({title: branch.title, equal: await core.hashStateJson(JSON.stringify((await api.readProductRuntimeState(branch.sessionId)).interaction)) === branch.stateHash})))
  }, outcome.branches)
  expect(restored.every(item => item.equal)).toBe(true); expect(externalCalls).toBe(0)
  writeFileSync(info.outputPath('native-growth-refresh.json'), JSON.stringify(restored, null, 2))
  await info.attach('native-growth-refresh', {body: JSON.stringify(restored), contentType: 'application/json'})
})
