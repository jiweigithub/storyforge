import type {CharacterInteractionRuntimeState} from '../types'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

export function parseChatInquiryEvidenceVersionV1(value: unknown): 1 | undefined {
  if (value === undefined || value === 1) return value
  throw new Error('[chat-inquiry] 询问前提证据版本无效')
}

/** This version belongs to the frozen run and committed event, never the model. */
export function chatInquiryEvidenceVersionForContractV1(contract: {
  executionBindings?: ReadonlyArray<{stepId: string; skillId: string; promptVersion: string}>
}): 1 | undefined {
  const bindings = contract.executionBindings ?? []
  const producers = bindings.filter(b => b.stepId === 'interaction:runtime-candidate')
  const reviewers = bindings.filter(b => b.stepId === 'interaction:situation-review')
  if (!bindings.some(b => b.promptVersion === 'chat-situation-construction-v13' || b.promptVersion === 'chat-situation-review-v12')) return undefined
  if (producers.length !== 1 || reviewers.length !== 1
    || producers[0].skillId !== 'character.chat-situation-construction' || producers[0].promptVersion !== 'chat-situation-construction-v13'
    || reviewers[0].skillId !== 'character.chat-situation-review' || reviewers[0].promptVersion !== 'chat-situation-review-v12') {
    throw new Error('[chat-inquiry] 询问前提证据与原生成和审查合同不一致')
  }
  return 1
}

/** Coordinator-only references. Targets are eligible for review, not discovered.
 * A pending question normally blocks later actor actions/knowledge settlement.
 * If later changes exist, current visibility cannot prove knowledge at question
 * time: do not expand its evidence using the current projection. */
export function chatInquiryEvidenceContextV1(state: CharacterInteractionRuntimeState) {
  const story = state.chatNarrative, pending = story?.pendingSituation, scene = state.activeScene
  if (!story || !pending || pending.purpose !== undefined || !scene || !story.permissions.allowInquiryResults
    || !story.permissions.allowActorSituationExpansion || !scene.activeParticipantKeys.includes(pending.actorKey)) return null
  const at = pending.sourceEventSequence
  const question = state.messages.find(m => m.role === 'character' && m.speakerKey === pending.actorKey
    && m.eventSequence === at && m.supersededBySequence == null)
  if (!question || !isChatMessageRetrievableV1(state, question) || at < scene.startedAtSequence) return null
  const unchangedKnowledge = !story.triggers.some(t => t.actionSequences.some(sequence => sequence > at))
    && !story.discoveryHistory?.some(d => d.discoverySequence > at)
    && !story.inquiryHistory?.some(i => i.resultSequence > at)
  const known = story.situation.facts.filter(f => f.audienceKeys.includes(pending.actorKey)
    && (f.sourceEventSequence === 0 || f.sourceEventSequence <= at))
  const knownKeys = new Set(known.map(f => f.factKey))
  const questionEvidenceFactKeys = pending.evidenceFactKeys.filter(key => knownKeys.has(key))
  const targets = unchangedKnowledge && story.permissions.maxDiscoveriesPerSituation
    ? story.situation.facts.filter(f => !f.audienceKeys.includes(pending.actorKey) && f.discovery?.sceneKey === scene.sceneKey
      && f.discovery.actorKeys.includes(pending.actorKey) && f.discovery.prerequisiteFactKeys.every(key => knownKeys.has(key)))
      .map(f => ({factKey: f.factKey, requiredEvidenceFactKeys: [...f.discovery!.prerequisiteFactKeys]}))
    : []
  return {schema: 'storyforge.chat-inquiry-evidence', version: 1, actorKey: pending.actorKey, questionSequence: at,
    questionEvidenceFactKeys, targets}
}
