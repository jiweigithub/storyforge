import type {CharacterInteractionRuntimeState} from '../types'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

export function parseChatInquiryEvidenceVersionV1(value: unknown): 1 | 2 | undefined {
  if (value === undefined || value === 1 || value === 2) return value
  throw new Error('[chat-inquiry] 询问前提证据版本无效')
}

/** This version belongs to the frozen run and committed event, never the model. */
export function chatInquiryEvidenceVersionForContractV1(contract: {
  executionBindings?: ReadonlyArray<{stepId: string; skillId: string; promptVersion: string}>
}): 1 | 2 | undefined {
  const bindings = contract.executionBindings ?? []
  const producers = bindings.filter(b => b.stepId === 'interaction:runtime-candidate')
  const reviewers = bindings.filter(b => b.stepId === 'interaction:situation-review')
  const versions = ['chat-situation-construction-v13', 'chat-situation-review-v12', 'chat-situation-construction-v14', 'chat-situation-review-v13']
  if (!bindings.some(b => versions.includes(b.promptVersion))) return undefined
  const version = producers[0]?.promptVersion === 'chat-situation-construction-v14' ? 2 : 1
  if (producers.length !== 1 || reviewers.length !== 1
    || producers[0].skillId !== 'character.chat-situation-construction' || producers[0].promptVersion !== `chat-situation-construction-v${version === 2 ? 14 : 13}`
    || reviewers[0].skillId !== 'character.chat-situation-review' || reviewers[0].promptVersion !== `chat-situation-review-v${version === 2 ? 13 : 12}`) {
    throw new Error('[chat-inquiry] 询问前提证据与原生成和审查合同不一致')
  }
  return version
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
  return {schema: 'storyforge.chat-inquiry-evidence', version: 1 as const, actorKey: pending.actorKey, questionSequence: at,
    questionEvidenceFactKeys, targets}
}

/** A request can follow its question in another utterance of the same actor
 * turn. Own actions cannot reveal an existing fact to their actor; new facts
 * are filtered by creation time. Another actor, discovery or inquiry could
 * change earlier visibility, so that span cannot establish question-time
 * knowledge from the current projection. No semantic question detection here:
 * the independent reviewer must check the selected message and request. */
export function chatInquiryQuestionEvidenceContextV1(state: CharacterInteractionRuntimeState) {
  const current = chatInquiryEvidenceContextV1(state)
  if (!current) return null
  const story = state.chatNarrative!, pending = story.pendingSituation!, scene = state.activeScene!
  const turn = story.triggers.find(t => t.actionSequences.includes(pending.sourceEventSequence))
  if (!turn) return null
  const actions = story.triggers.flatMap(t => t.actionSequences)
  const questions = state.messages.filter(m => m.role === 'character' && m.speakerKey === pending.actorKey
    && m.supersededBySequence == null && isChatMessageRetrievableV1(state, m)
    && turn.actionSequences.includes(m.eventSequence) && m.eventSequence >= scene.startedAtSequence
    && m.eventSequence <= pending.sourceEventSequence && !story.inquiryHistory?.some(r => r.questionSequence === m.eventSequence))
    .filter(question => !actions.some(at => at > question.eventSequence && (at > pending.sourceEventSequence
      || !turn.actionSequences.includes(at) || !state.messages.some(m => m.eventSequence === at && m.role === 'character' && m.speakerKey === pending.actorKey)))
      && !state.messages.some(m => m.role === 'player' && m.eventSequence > question.eventSequence && m.eventSequence <= pending.sourceEventSequence)
      && !story.discoveryHistory?.some(d => d.discoverySequence > question.eventSequence)
      && !story.inquiryHistory?.some(i => i.resultSequence > question.eventSequence))
    .map(question => {
      const known = new Set(story.situation.facts.filter(f => f.audienceKeys.includes(pending.actorKey)
        && (f.sourceEventSequence === 0 || f.sourceEventSequence <= question.eventSequence)).map(f => f.factKey))
      return {messageId: question.messageId, questionSequence: question.eventSequence,
        questionEvidenceFactKeys: pending.evidenceFactKeys.filter(key => known.has(key)),
        targets: story.permissions.maxDiscoveriesPerSituation ? story.situation.facts.filter(f => !f.audienceKeys.includes(pending.actorKey)
          && f.discovery?.sceneKey === scene.sceneKey && f.discovery.actorKeys.includes(pending.actorKey)
          && f.discovery.prerequisiteFactKeys.every(key => known.has(key)))
          .map(f => ({factKey: f.factKey, requiredEvidenceFactKeys: [...f.discovery!.prerequisiteFactKeys]})) : []}
    })
  return {schema: 'storyforge.chat-inquiry-evidence', version: 2 as const, actorKey: pending.actorKey,
    requestSequence: pending.sourceEventSequence, questions}
}

export function chatInquiryContextForVersionV1(state: CharacterInteractionRuntimeState, version: 1 | 2) {
  return version === 2 ? chatInquiryQuestionEvidenceContextV1(state) : chatInquiryEvidenceContextV1(state)
}
