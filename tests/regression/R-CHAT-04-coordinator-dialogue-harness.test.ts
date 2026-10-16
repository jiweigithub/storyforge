import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readChatCandidateRetrievalVersion} from '../../src/lib/character-interaction/context-reader-version'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it.each(['current', 'saved-v8'] as const)('uses the original producer reader across review recovery and portable adoption: %s', async version => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  // v9's role bytes equal v8. Only the new review's dialogue policy changes.
  if (version === 'saved-v8') {
    const create = manifests.createContextManifestFromAssemblyV1
    vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => create({...input,
      readerVersion: input.readerVersion === 'chat-narrative-runtime-view-v9' ? 'chat-narrative-runtime-view-v8' : input.readerVersion}))
  }
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '读取版本与恢复工程验证', runAI: async () => {generated++; return JSON.stringify({kind: 'speak', text: '我会先核对铜印的借用登记。',
      goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})},
    onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  vi.restoreAllMocks(); db.close(); await db.open()
  const resumed = await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++
    expect(messages[1].content.includes('dialogueSelection')).toBe(version === 'current')
    return JSON.stringify(chatActionReviewOutputFixture())
  }})
  expect(await readChatCandidateRetrievalVersion(resumed.snapshot, f.scope.projectId, 'interactionRuntime', 'guard', before.interaction!))
    .toBe(version === 'current' ? 'chat-relevance-v5' : 'chat-relevance-v4')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toHaveLength(before.interaction!.messages.length + 1)
  expect(after.interaction!.chatNarrative!.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: 'dialogue-policy-branch'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  db.close(); await db.open()
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect((await db.worldReleases.toArray()).filter(w => w.projectId === f.scope.projectId)).toEqual(worlds)
  expect([generated, reviewed]).toEqual([1, 1])
})
