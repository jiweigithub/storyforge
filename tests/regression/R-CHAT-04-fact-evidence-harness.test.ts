import {sha256Text} from '../../src/lib/ai/chapter-memory/text-normalization'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as api from '../../src/lib/character-interaction/runtime-api'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatFactEvidenceAction as action} from '../helpers/chat-fact-evidence'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'
import {chatInquiryDraftFixture, chatInquiryInputFixture, chatInquiryReviewFixture, prepareChatInquiryFixture} from '../helpers/chat-inquiry-result'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const runtime = async (id: number) => (await api.readProductRuntimeState(id)).interaction!

it.each(['current', 'saved-v9'] as const)('freezes provenance policy across review recovery and a crash after command commit: %s', async reader => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await api.readProductRuntimeStateVersion(f.sessionId)
  await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const before = await runtime(f.sessionId), worlds = await db.worldReleases.toArray()
  if (reader === 'saved-v9') {
    const create = manifests.createContextManifestFromAssemblyV1
    vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => create({...input,
      readerVersion: input.readerVersion === 'chat-narrative-runtime-view-v10' ? 'chat-narrative-runtime-view-v9' : input.readerVersion}))
  }
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '事实依据持久化工程检查', runAI: async () => {calls++; return JSON.stringify(action)},
    onNarrativeActionSaved: id => {runId = id; throw Error('before-review')}})).rejects.toThrow('before-review')
  expect(await runtime(f.sessionId)).toEqual(before); vi.restoreAllMocks(); db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}})
  // Crash between the SIM transaction and the separate durable run adoption.
  const commit = api.commitChatNarrativeAction
  vi.spyOn(api, 'commitChatNarrativeAction').mockImplementationOnce(async input => {await commit(input); throw Error('after-command')})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow('after-command')
  const committed = await api.readProductRuntimeStateVersion(f.sessionId)
  vi.restoreAllMocks(); db.close(); await db.open()
  const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(adopted.snapshot.projection.state).toBe('completed')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(await api.readProductRuntimeStateVersion(f.sessionId)).toEqual(committed)
  const state = await runtime(f.sessionId), metadata = state.chatNarrative!.factEvidence
  expect(metadata?.records.length).toBe(reader === 'current' ? 2 : undefined)
  expect(JSON.parse(adopted.event!.payloadJson).factEvidenceVersion).toBe(reader === 'current' ? 1 : undefined)
  expect(state.chatNarrative!.situation.facts.slice(0, 4)).toEqual(before.chatNarrative!.situation.facts)
  expect(state.chatNarrative!.situation.facts.at(-1)!.factKey).toBe('card-corner')
  if (reader === 'current') {
    const badEvent = await exportProjectJSON(f.scope.projectId)
    const event = badEvent.productRuntimeEvents.find(e => e.type === 'interaction.narrative.action-reviewed.committed')!
    const portable = event as unknown as {_portablePayloadJson: string}
    const payload = JSON.parse(portable._portablePayloadJson); payload.factEvidenceVersion = 99; portable._portablePayloadJson = JSON.stringify(payload)
    const projects = await db.projects.count()
    await expect(importProjectJSON(badEvent)).rejects.toThrow('事实来源')
    expect(await db.projects.count()).toBe(projects)
  }
  let parent = f.sessionId
  for (const title of ['first', 'nested']) {
    const source = await api.readProductRuntimeState(parent)
    const child = await api.branchProductRuntimeSession({parentSessionId: parent, throughSequence: source.lastSequence, title})
    await api.deleteProductRuntimeSession(parent); parent = child.id!
  }
  const expected = await runtime(parent)
  expect(expected.chatNarrative!.factEvidence).toEqual(metadata)
  expect(expected.chatNarrative!.situation.facts.at(-1)!.sourceEventSequence).toBeLessThan(0)
  expect(await db.productRuntimeEvents.where('sessionId').equals(parent).count()).toBe(0)
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(parent).count()).toBe(0)
  await api.createProductRuntimeCheckpoint({sessionId: parent, name: 'evidence-checkpoint'})
  const backup = await exportProjectJSON(f.scope.projectId)
  if (reader === 'current') for (const field of ['initialStateJson', 'runtimeHeadStateJson', 'stateJson'] as const) {
    const corrupt = structuredClone(backup)
    const row = field === 'stateJson' ? corrupt.productRuntimeCheckpoints[0] : corrupt.productRuntimeSessions.find(s => s.title === 'nested')!
    const container = row as unknown as Record<string, string>
    const initial = JSON.parse(container[field])
    initial.interaction.chatNarrative.factEvidence.records[0].evidenceFactKeys = ['card-corner']
    container[field] = JSON.stringify(initial)
    if (field === 'stateJson') container.stateHash = await sha256Text(container[field])
    const projects = await db.projects.count()
    await expect(importProjectJSON(corrupt)).rejects.toThrow('事实依据')
    expect(await db.projects.count()).toBe(projects)
    expect(await runtime(parent)).toEqual(expected)
  }
  const importedId = await importProjectJSON(backup)
  db.close(); await db.open()
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(s => s.title === 'nested')!
  expect(await runtime(imported.id!)).toEqual(expected)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(calls).toBe(2)
})

it.each(['current', 'saved-v11'] as const)('records player situation facts only under its frozen producer policy: %s', async reader => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await api.readProductRuntimeStateVersion(f.sessionId)
  await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'seed', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'player-seed', sourceEventSequence: v.sequence, seed: '门外传来敲门声。'})
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: '门外的声响', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['player', 'guard', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
    newGoals: [], newThreads: [], possibilities: []}
  if (reader === 'saved-v11') {
    const create = manifests.createContextManifestFromAssemblyV1
    vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => create({...input,
      readerVersion: input.readerVersion === 'chat-situation-runtime-view-v12' ? 'chat-situation-runtime-view-v11' : input.readerVersion}))
  }
  const result = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction',
    objective: '情境事实来源工程检查', runAI: async () => JSON.stringify(draft), runReviewAI: async () => JSON.stringify({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具'}))})})
  vi.restoreAllMocks()
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const metadata = (await runtime(f.sessionId)).chatNarrative!.factEvidence
  expect(metadata).toEqual(reader === 'current' ? {version: 1, records: [{factKey: 'knocking', kind: 'observation', evidenceFactKeys: ['road'], actorKey: null, goalKey: null, source: 'situation'}]} : undefined)
})

it('records attributed inquiry speech without replacing discovered fact identities or creating provenance for old truths', async () => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId)
  const original = (await runtime(f.sessionId)).chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!
  const result = await generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: async () => JSON.stringify(draft), runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(draft))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const story = (await runtime(f.sessionId)).chatNarrative!
  expect(story.factEvidence).toEqual({version: 1, records: [{factKey: 'clerk-statement', kind: 'observation', evidenceFactKeys: draft.inquiryResult!.evidenceFactKeys,
    actorKey: 'guard', goalKey: 'find-seal', source: 'inquiry'}]})
  expect(story.situation.facts.find(f => f.factKey === 'secret')).toEqual({...original, audienceKeys: ['guard', 'player']})
})
