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
