import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {buildChatHistoryCoordinatorProjectionV1} from '../../src/lib/character-interaction/history-coordinator-context'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {chatHistorySelectionFixture} from '../helpers/chat-history-selection'
import {db} from '../../src/lib/db/schema'
import * as api from '../../src/lib/character-interaction/runtime-api'
import {generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readAgentRunArtifactExactV1} from '../../src/lib/memory/artifact-store'
import {readChatCoordinatorSelectionEvidenceV1} from '../../src/lib/registry/context-sources'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
it('keeps complete coordinator decisions outside model text and retains actor-delivered and candidate evidence', () => {
  const state = chatHistorySelectionFixture(220), before = structuredClone(state)
  const actor = buildInteractionContextWindow(state, 'guard')
  const omitted = actor.selection!.history!.find(f => f.kind === 'facts' && !f.included)!
  const projection = buildChatHistoryCoordinatorProjectionV1(state, {retrievalVersion: 'chat-relevance-v9', actorKey: 'guard', text: JSON.stringify({evidenceFactKeys: [omitted.key]})})
  const model = JSON.parse(projection.text.slice(projection.text.indexOf('{')))
  expect(projection.selection.history.filter(d => d.kind === 'facts')).toHaveLength(224)
  expect(model.selection.version).toBe(6)
  expect(typeof model.selection.history.facts.omitted).toBe('number')
  expect(model.situation.facts.some((f: {factKey: string}) => f.factKey === omitted.key)).toBe(true)
  for (const fact of actor.chatNarrative!.facts) expect(model.situation.facts).toContainEqual(fact)
  expect(projection.selection.history.find(d => d.key === omitted.key)?.required).toContain('candidate-reference')
  const unselected = projection.selection.history.find(d => d.kind === 'facts' && !d.included)!
  expect(projection.text).not.toContain(JSON.stringify(unselected.key))
  expect(formatInteractionRuntimeContextV1(state.profiles[0], actor)).not.toContain('柜台下')
  expect(state).toEqual(before)
})
it('persists the actual review audit with its manifest and rejects a different assembly without a call', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await api.readProductRuntimeStateVersion(f.sessionId)
  await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'audit', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '审查选择证据工程检查',
    runAI: async () => {calls++; return JSON.stringify({kind: 'speak', text: '我先核对登记。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})},
    runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}})
  const packets = generated.snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-packet')
  expect(packets).toHaveLength(2)
  const recorded = packets.find(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === 'interaction:action-review')!
  if (recorded.type !== 'evidence.artifact.recorded') throw Error('missing review packet')
  const packet = JSON.parse(await readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'context-packet', contentHash: recorded.payload.contentHash}))
  expect(packet.manifest.sources[0].readerVersion).toBe('chat-action-review-v13')
  expect(packet.coordinatorSelection.history.find((d: {key: string}) => d.key === 'secret')).toMatchObject({included: true})
  const input = {projectId: f.scope.projectId, scope: f.scope, productRuntimeSessionId: f.sessionId, chatActionCandidateRunId: generated.snapshot.run.id}
  db.close(); await db.open()
  expect(await readChatCoordinatorSelectionEvidenceV1(input, packet.text)).toEqual(packet.coordinatorSelection)
  await expect(readChatCoordinatorSelectionEvidenceV1(input, 'unrelated assembly')).rejects.toThrow('实际输入不一致')
  expect(calls).toBe(2)
})
