import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })

test('native stage recap source reads without a KP operation and retains semantic bytes across an actual request reservation and refresh', async ({ page }) => {
  test.setTimeout(120000)
  const requests: string[] = []
  page.on('request', r => { if (/\/v1\/(?:chat\/completions|responses)/.test(r.url())) requests.push(r.url()) })
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const { loadTtrpgOpenBriefContextV1 } = await importer('/storyforge/src/lib/ttrpg/open-brief-context.ts')
    const { CONTEXT_SOURCE_BY_KEY } = await importer('/storyforge/src/lib/registry/context-sources.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native recap source', (p: any) => { p.ttrpg.campaign.runtimePolicy.enabled = true })
    const viewerKey = helper.OPEN_HUMAN_VIEWER, e = await helper.openEnvelopeV1(f.sessionId, 'native.brief.gm.note')
    await api.recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey, draft: { revisionKey: 'native.brief.gm.note', observerKey: 'gm',
      reliability: 'observed', audience: 'gm-only', knownBy: [], summary: 'GM-BRIEF-PRIVATE-NOTE', fromEventSequence: 1, toEventSequence: e.baseSequence } })
    const input = { scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' }
    const before = await loadTtrpgOpenBriefContextV1(input), beforeRuns = await db.agentRuns.count()
    const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' }
    const fingerprints = await Promise.all(['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory'].map(key => CONTEXT_SOURCE_BY_KEY.get(key).resources.fingerprint(scope)))
    const rawInput = '调查河港'
    await api.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.brief.epoch'), viewerKey, triggerKind: 'submit-action', rawInput })
    const { prepareTtrpgOpenIntentInputV1 } = await importer('/storyforge/src/lib/ttrpg/open-intent-input.ts')
    await prepareTtrpgOpenIntentInputV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.brief.reserve'), scope: f.scope, actorKey: 'hero', viewerKey,
      rawInput, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const after = await loadTtrpgOpenBriefContextV1(input)
    return { input, frame: after.frame, entries: after.entries, resources: after.resources, fingerprints,
      stableBytes: JSON.stringify(before.resources) === JSON.stringify(after.resources), beforeRuns, afterRuns: await db.agentRuns.count(),
      movedEvidence: after.readEvidence.sequence > before.readEvidence.sequence, trustedStateExcluded: !('loaded' in after) }
  })
  expect(result.stableBytes && result.movedEvidence && result.trustedStateExcluded).toBe(true)
  expect(result.beforeRuns).toBe(0); expect(result.afterRuns).toBe(1)
  expect(result.fingerprints[0]).toBe(result.fingerprints[1])
  expect(result.frame.stage.status).toBe('open')
  const text = JSON.stringify(result.resources)
  for (const hidden of ['GM-BRIEF-PRIVATE-NOTE', 'viewerKey', '曾经离开港口', '害怕洪水', 'frozenContent']) expect(text).not.toContain(hidden)
  await page.reload()
  const restored = await page.evaluate(async input => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/open-brief-context.ts')).loadTtrpgOpenBriefContextV1(input)
  }, result.input)
  expect(restored.frame).toEqual(result.frame); expect(restored.entries).toEqual(result.entries)
  expect(requests).toEqual([])
})

test('native recap authority and attributed output preserve belief and refuse gameplay, Oracle and model relabeling', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const { CONTEXT_SOURCE_BY_KEY } = await importer('/storyforge/src/lib/registry/context-sources.ts')
    const output = await importer('/storyforge/src/lib/ttrpg/open-brief-output.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native passive recap', (p: any) => { p.ttrpg.campaign.runtimePolicy.enabled = true })
    const viewerKey = helper.OPEN_HUMAN_VIEWER, e = await helper.openEnvelopeV1(f.sessionId, 'native.brief.belief')
    await api.recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey, draft: { revisionKey: 'native.brief.belief', observerKey: 'hero', reliability: 'belief',
      audience: 'party', knownBy: [], summary: '我怀疑港口有人跟踪。', fromEventSequence: 1, toEventSequence: e.baseSequence } })
    const before = await readProductRuntimeState(f.sessionId)
    await api.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.brief.window'), viewerKey,
      triggerKind: 'request-brief', rawInput: '请复盘本桌共同资料' })
    const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' }, reads: any[] = []
    for (const key of ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory']) {
      const snapshot = await CONTEXT_SOURCE_BY_KEY.get(key).resources.openReadSession(scope)
      const page = await snapshot.provider.listMetadata({ scope, limit: 1000 })
      for (const d of page.items) reads.push({ sourceKey: key, resourceKey: d.resourceKey,
        content: (await snapshot.provider.read({ scope, resourceKey: d.resourceKey, depth: 'full', maxTokens: 16000 })).content })
      await snapshot.assertCurrent()
    }
    const sources = await output.ttrpgOpenDeliveredBriefAttributionsV1(reads), memory = sources.find((s: any) => s.kind === 'memory')
    const brief = output.parseTtrpgOpenBriefV1({ paragraphs: [{ text: '主角保留着个人推测。', sourceKeys: [memory.citationKey] }] }, sources)
    let relabelRejected = false
    try { output.parseTtrpgOpenBriefV1({ paragraphs: [{ ...brief.paragraphs[0], reliability: 'observed' }] }, sources) } catch { relabelRejected = true }
    let oracleRejected = false, actionRejected = false
    try { await api.consultTtrpgOracleV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.brief.no.oracle'), viewerKey,
      askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '码头安全吗？', likelihoodTierKey: 'even' }) } catch { oracleRejected = true }
    const action = f.runtimePackage.ttrpg.rulePack.content.actions[0]
    try { await api.startTtrpgOpenOperationV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.brief.no.action'), viewerKey,
      request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key,
        targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {} } }) } catch { actionRejected = true }
    const after = await readProductRuntimeState(f.sessionId)
    return { sessionId: f.sessionId, memory, brief, relabelRejected, oracleRejected, actionRejected,
      epoch: after.ttrpg.openRun.coordination.epochs[0], originalWorldTime: before.ttrpg.openRun.worldTime, worldTime: after.ttrpg.openRun.worldTime,
      unchangedEntities: JSON.stringify(before.entities) === JSON.stringify(after.entities) }
  })
  expect(result.memory).toMatchObject({ observerKey: 'hero', reliability: 'belief', origin: 'human-authored' })
  expect(result.relabelRejected && result.oracleRejected && result.actionRejected && result.unchangedEntities).toBe(true)
  expect(result.epoch).toMatchObject({ triggerKind: 'request-brief', budget: { maximumCalls: 1, maximumAiActions: 0 } })
  expect(result.worldTime).toEqual(result.originalWorldTime)
  await page.reload()
  const restored = await page.evaluate(async sessionId => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    return (await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)).ttrpg.openRun.coordination.epochs[0]
  }, result.sessionId)
  expect(restored).toEqual(result.epoch)
})
