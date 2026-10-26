import {afterEach, beforeEach, expect, it} from 'vitest'
import {AIError} from '../../src/lib/types'
import {db} from '../../src/lib/db/schema'
import {seedChatMediaPlayerFixture} from '../helpers/chat-media-fixture'
import {createCharacterInteractionInstance} from '../../src/lib/product/runtime-instances'
import {readProductRuntimeState, readProductRuntimeStateVersion, startInteractionScene, requestChatNarrativeTrigger, commitChatNarrativeAction, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {readChatRuntimeVisualContextV1, planChatRuntimeVisualsV1} from '../../src/lib/character-interaction/runtime-visual-context'
import {generateChatRuntimeVisualsV1, readChatRuntimeVisualJobsV1, latestChatVisualJobsV1} from '../../src/lib/character-interaction/runtime-visuals'
import {resolveProductMediaProviderAdapterV1, type RedactedMediaTransportRequestV1} from '../../src/lib/product-production/media-adapters'
import type {ResolvedProductMediaCapabilityV1} from '../../src/lib/product-production/media-transport'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {readResumableInteractionRunsV1} from '../../src/lib/character-interaction/runtime-run-recovery'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {db.close(); await db.delete()})

async function playable() {
  const f = await seedChatMediaPlayerFixture({dynamic: true})
  const session = await createCharacterInteractionInstance({scope: f.scope, productReleaseId: f.releaseId, title: '动态配图测试'})
  const envelope = async (commandId: string) => {const v = await readProductRuntimeStateVersion(session.id!); return {sessionId: session.id!, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash}}
  const scene = await startInteractionScene({...await envelope('start'), sceneId: 'inn.current', sceneKey: 'inn'})
  const trigger = await requestChatNarrativeTrigger({...await envelope('trigger'), kind: 'scene-start', sourceEventSequence: scene.sequence})
  const action: ChatNarrativeActionV1 = {kind: 'complete', text: '叶岑检查了后门。后门闩完好，没有撬动痕迹。他把看到的情况告诉了两人。', goalKey: 'find-seal',
    evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: false,
    newFacts: [{factKey: 'door-checked', kind: 'observation', text: '后门闩完好，没有撬动痕迹。', evidenceFactKeys: ['lost'], evidenceExcerpt: '后门闩完好，没有撬动痕迹。'}],
    disclosures: [], threadUpdates: [], goalStatus: null}
  const committed = await commitChatNarrativeAction({...await envelope('action'), actorKey: 'guard', triggerSequence: trigger.sequence, messageId: 'inspection', factEvidenceVersion: 1, action, review: chatActionReviewFixture(action)})
  expect(committed.type).toBe('interaction.narrative.action-reviewed.committed')
  return {...f, sessionId: session.id!}
}
function capability(failure: boolean | 'unknown' = false) {
  const outgoing: RedactedMediaTransportRequestV1[] = [], adapterId = 'agnes.image-2.1-flash.v1'
  const value: ResolvedProductMediaCapabilityV1 = {adapter: resolveProductMediaProviderAdapterV1(adapterId),
    binding: {requirementKey: 'chat.runtime.image', adapterId, bindingHash: 'a'.repeat(64)},
    receipt: {schema: 'storyforge.configured-agnes-image-binding-receipt', version: 1, requirementKey: 'chat.runtime.image', adapterId,
      adapterVersion: 1, provider: 'agnes', model: 'agnes-image-2.1-flash', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
      credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: 'a'.repeat(64), boundAt: 1, receiptHash: 'b'.repeat(64)},
    transport: {executionLocation: 'browser-direct', request: async request => {
      outgoing.push(request)
      if (failure === 'unknown') throw new Error('transport-outcome-unknown')
      if (failure) throw new AIError(503, 'fixture-provider-unavailable')
      // Protocol bytes only; browser E2E separately verifies decodable PNGs.
      const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
      new DataView(bytes.buffer).setUint32(16, request.body.ratio === '3:4' ? 768 : 1536)
      new DataView(bytes.buffer).setUint32(20, 1024)
      return {status: 200, contentType: 'application/json', body: null, providerRequestId: 'fixture', usage: {}, costUsd: null,
        json: {data: [{b64_json: btoa(String.fromCharCode(...bytes))}]}}
    }}}
  return {value, outgoing}
}

it('only illustrates committed observations and the visible speaker; future goals and secrets do not cross the source', async () => {
  const f = await playable(), context = await readChatRuntimeVisualContextV1(f.scope, f.sessionId)
  expect(context.requests.map(request => request.kind)).toEqual(['background', 'character-expression', 'cg'])
  expect(JSON.stringify(context)).toContain('后门闩完好')
  expect(JSON.stringify(context)).not.toContain('误指控')
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  const shifted = structuredClone(state); shifted.activeScene!.location = '雨后的庭院'
  const moved = await planChatRuntimeVisualsV1(f.runtimePackage.interaction!.chatVisualDesign!, shifted)
  expect(moved.requests[0].kind).toBe('background'); expect(moved.requests[0].prompt).toContain('雨后的庭院')
  expect(moved.frameKey).not.toBe(context.frameKey)
  shifted.chatNarrative!.situation.facts.find(fact => fact.factKey === 'door-checked')!.audienceKeys = ['guard']
  expect((await planChatRuntimeVisualsV1(f.runtimePackage.interaction!.chatVisualDesign!, shifted)).requests.some(request => request.kind === 'cg')).toBe(false)
})

it('persists event-owned images and receipts, does not regenerate on refresh, and restores with the save', async () => {
  const f = await playable(), provider = capability(), before = await readProductRuntimeStateVersion(f.sessionId)
  const releases = await db.productReleases.toArray(), worlds = await db.worldReleases.toArray()
  const jobs = await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: provider.value})
  expect(jobs.map(job => [job.status, job.issue])).toEqual([['available', null], ['available', null], ['available', null]])
  expect(provider.outgoing).toHaveLength(3)
  expect(jobs.every(job => job.asset?.ownerKind === 'runtime' && job.asset.productRuntimeSessionId === f.sessionId && job.asset.productReleaseId === null)).toBe(true)
  db.close(); await db.open()
  expect(await readChatRuntimeVisualJobsV1(f.scope, f.sessionId)).toHaveLength(3)
  await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: provider.value})
  expect(provider.outgoing).toHaveLength(3)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  expect(await db.productReleases.toArray()).toEqual(releases); expect(await db.worldReleases.toArray()).toEqual(worlds)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(session => session.title === '动态配图测试')!
  const restoredJobs = await readChatRuntimeVisualJobsV1({projectId: imported, workId: restored.workId!, worldId: restored.worldId!}, restored.id!)
  expect(restoredJobs.map(job => job.asset?.contentHash)).toEqual(jobs.map(job => job.asset?.contentHash))
  expect(await readResumableInteractionRunsV1({projectId: imported, workId: restored.workId!, worldId: restored.worldId!}, restored.id!)).toEqual([])
}, 30000)

it('uses reviewed visible situation observations, while private results and heard claims remain out of illustrations', async () => {
  const f = await playable(), state = (await readProductRuntimeState(f.sessionId)).interaction!, story = state.chatNarrative!
  const fact = story.situation.facts.find(item => item.factKey === 'door-checked')!
  const evidence = story.factEvidence!.records.find(item => item.factKey === fact.factKey)!
  fact.origin = 'runtime-situation'; fact.text = '门闩内侧的铆钉已锈住。'; evidence.source = 'situation'
  const design = f.runtimePackage.interaction!.chatVisualDesign!
  expect((await planChatRuntimeVisualsV1(design, state)).requests.some(request => request.kind === 'cg' && request.prompt.includes(fact.text))).toBe(true)
  fact.audienceKeys = ['guard']
  expect(JSON.stringify(await planChatRuntimeVisualsV1(design, state))).not.toContain(fact.text)
  fact.audienceKeys = ['guard', 'player']; evidence.source = 'inquiry'
  expect((await planChatRuntimeVisualsV1(design, state)).requests.some(request => request.kind === 'cg')).toBe(false)
  evidence.source = 'situation'
  story.situation.facts.push({...fact, factKey: 'heard-claim', text: '听人说屋顶今晚会坍塌。'})
  story.factEvidence!.records.push({...evidence, factKey: 'heard-claim', source: 'inquiry'})
  const illustrated = await planChatRuntimeVisualsV1(design, state)
  expect(illustrated.requests.some(request => request.kind === 'background')).toBe(true)
  expect(JSON.stringify(illustrated)).not.toContain('屋顶今晚会坍塌')
})

it('retains a failed request without retrying it or substituting a placeholder', async () => {
  const f = await playable(), provider = capability(true)
  const first = await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: provider.value})
  expect(first.map(job => job.status)).toEqual(['failed']); expect(first[0].asset).toBeNull()
  // An explicit later call may fill the other slot, but cannot resend the failed one.
  await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: provider.value})
  expect(new Set(provider.outgoing.map(request => request.requestId)).size).toBe(2)
  expect(await db.productMediaAssets.where('productRuntimeSessionId').equals(f.sessionId).count()).toBe(0)
})

it('keeps committed observations usable after branch sequence rebasing without changing the parent request', async () => {
  const f = await playable(), before = await readProductRuntimeStateVersion(f.sessionId)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.sequence, title: '画面分支'})
  const context = await readChatRuntimeVisualContextV1(f.scope, branch.id!)
  expect(context.requests.map(request => request.kind)).toEqual(['background', 'character-expression', 'cg'])
  expect(context.requests.find(request => request.kind === 'cg')!.sourceSequence).toBeLessThanOrEqual(0)
  const provider = capability()
  expect((await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: branch.id!, capability: provider.value})).every(job => job.status === 'available')).toBe(true)
  expect(await readChatRuntimeVisualJobsV1(f.scope, f.sessionId)).toEqual([])
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
})

it('keeps a transport interruption unknown and never resends that request', async () => {
  const f = await playable(), provider = capability('unknown')
  const jobs = await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: provider.value})
  expect(jobs[0].status).toBe('unknown')
  expect(jobs[0].issue).toContain('尚未确认')
  expect((await db.agentRuns.get(jobs[0].runId))?.status).toBe('paused')
  await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: provider.value})
  expect(provider.outgoing).toHaveLength(2)
  expect(provider.outgoing[1].body.prompt).not.toBe(provider.outgoing[0].body.prompt)
})

it('explicitly creates a new bounded attempt after a confirmed failure, retaining the old record', async () => {
  const f = await playable(), failed = capability(true), working = capability()
  const original = await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: failed.value})
  const recovered = await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: working.value, retryFailed: true})
  expect(recovered.find(job => job.runId === original[0].runId)?.status).toBe('failed')
  expect([...latestChatVisualJobsV1(recovered).values()].map(job => job.status)).toEqual(['available', 'available', 'available'])
  expect(new Set([...failed.outgoing, ...working.outgoing].map(request => request.requestId)).size).toBe(4)
  await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: working.value, retryFailed: true})
  expect(working.outgoing).toHaveLength(3)
})

it('caps explicit attempts per slot and never treats an unknown outcome as a confirmed failure', async () => {
  const f = await playable(), failed = capability(true)
  for (let i = 0; i < 4; i++) await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: f.sessionId, capability: failed.value, retryFailed: true})
  expect((await readChatRuntimeVisualJobsV1(f.scope, f.sessionId)).filter(job => job.request.kind === 'background')).toHaveLength(3)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: '未知结果'})
  const unknown = capability('unknown')
  await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: branch.id!, capability: unknown.value})
  await generateChatRuntimeVisualsV1({scope: f.scope, sessionId: branch.id!, capability: unknown.value, retryFailed: true})
  expect((await readChatRuntimeVisualJobsV1(f.scope, branch.id!)).filter(job => job.request.kind === 'background')).toHaveLength(1)
})
