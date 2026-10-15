import {test, expect} from '@playwright/test'

// Contract/lifecycle validation only: the new prompt binding is temporary in
// this isolated browser. The product registry is deliberately not activated.
test('persists reviewed memory reconciliation through browser reload and portable nested branches without changing facts', async ({page}) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const skills = await load('/storyforge/src/lib/agent/skill-registry.ts'), portable = await load('/storyforge/src/lib/export/json-export.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    const f = await fixture.seedChatNarrativeRuntimeFixture()
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const source = await api.commitInteractionPlayerMessage({...await command(), messageId: 'source', text: '我没有答应帮忙寻找铜印。'})
    await api.proposeInteractionMemory({...await command(), memoryId: 'old', participantKey: 'guard', kind: 'key-memory', content: '旧的未核对摘要', importance: 1, sourceEventSequences: [source.sequence], evidenceExcerpt: '没有答应帮忙'})
    const correction = await api.correctChatMemory({...await command(), memoryId: 'old', replacementMemoryId: 'corrected', content: '玩家没有答应帮忙。', sourceEventSequences: [source.sequence], evidenceExcerpt: '没有答应帮忙', reason: '依据原话修正'})
    await api.requestChatNarrativeTrigger({...await command(), kind: 'player-response', sourceEventSequence: source.sequence})
    const before = await api.readProductRuntimeState(f.sessionId), skill = skills.getAgentSkillV1('character.chat-narrative-action-review'), original = skill.promptVersion
    const action = {kind: 'speak', text: '我自己去检查门口。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    let injectedCalls = 0
    try {
      skill.promptVersion = 'chat-narrative-action-review-v20'
      const generated = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '隔离浏览器合同检查',
        runAI: async () => {injectedCalls++; return JSON.stringify(action)}, runReviewAI: async () => {injectedCalls++; return JSON.stringify({...fixture.chatActionReviewOutputFixture(),
          memoryChecks: [{memoryId: 'corrected', sourceSequence: correction.sequence, passed: true, reason: '注入的工程判定，不是模型质量证据。'}]})}})
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    } finally {skill.promptVersion = original}
    const after = await api.readProductRuntimeState(f.sessionId)
    if (JSON.stringify(before.interaction.chatNarrative.situation) !== JSON.stringify(after.interaction.chatNarrative.situation)) throw new Error('核对改写了既有情境')
    const child = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '核对分支'})
    const nested = await api.branchProductRuntimeSession({parentSessionId: child.id, throughSequence: (await api.readProductRuntimeStateVersion(child.id)).sequence, title: '核对继承'})
    const expected = (await api.readProductRuntimeState(nested.id)).interaction
    await api.deleteProductRuntimeSession(child.id); await api.deleteProductRuntimeSession(f.sessionId)
    const projectId = await portable.importProjectJSON(await portable.exportProjectJSON(f.scope.projectId))
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === '核对继承')
    if (JSON.stringify((await api.readProductRuntimeState(imported.id)).interaction) !== JSON.stringify(expected)) throw new Error('便携核对记录发生变化')
    return {sessionId: imported.id, expected, injectedCalls, productionBinding: skill.promptVersion}
  })
  expect(f.injectedCalls).toBe(2)
  expect(f.productionBinding).toBe('chat-narrative-action-review-v19')
  expect(f.expected.chatNarrative.memoryReconciliations).toHaveLength(1)
  expect(f.expected.chatNarrative.memoryReconciliations[0].sourceSequence).toBeLessThan(0)
  await page.reload()
  const after = await page.evaluate(async sessionId => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const rules = await load('/storyforge/src/lib/character-interaction/memory-reconciliation.ts'), skills = await load('/storyforge/src/lib/agent/skill-registry.ts')
    const state = (await api.readProductRuntimeState(sessionId)).interaction
    return {state, pending: rules.pendingChatMemoryCorrectionsV1(state, 'guard'), productionBinding: skills.getAgentSkillV1('character.chat-narrative-action-review').promptVersion}
  }, f.sessionId)
  expect(after).toEqual({state: f.expected, pending: [], productionBinding: 'chat-narrative-action-review-v19'})
})
