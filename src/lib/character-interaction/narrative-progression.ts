import type {CharacterInteractionRuntimeState} from '../types'

/** Only an already reviewed intention can request a local background extension.
 * A trigger authorizes at most one construction, with no offline or mount work. */
export function chatSituationConstructionRequestV1(state: CharacterInteractionRuntimeState, actorKey?: string) {
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  if (!story || !state.activeScene || !trigger || trigger.status !== 'ready') return null
  if (story.situation.seed.sourceEventSequence === trigger.requestedSequence
    && ['player-request', 'continued-thread'].includes(story.situation.seed.origin)) return null
  if (trigger.kind === 'player-seed') return trigger.seed && !trigger.actionSequences.length
    ? {text: trigger.seed, origin: 'player-request' as const, actorKey: null, sourceThreadKey: null} : null
  const pending = story.pendingSituation
  const observationResult = pending?.purpose === 'observation-result'
  if (!pending || story.permissions.allowActorSituationExpansion !== true
    || actorKey != null && pending.actorKey !== actorKey
    || !state.activeScene.activeParticipantKeys.includes(pending.actorKey)
    || !['continue', 'return'].includes(trigger.kind) && !(observationResult && trigger.kind === 'player-response') && !trigger.actionSequences.includes(pending.sourceEventSequence)
    || !story.situation.goals.some(g => g.goalKey === pending.goalKey && g.actorKey === pending.actorKey && g.status === 'active')
    || !story.situation.threads.some(t => t.threadKey === pending.threadKey && ['open', 'blocked'].includes(t.status))
    || !observationResult && state.messages.some(m => m.role === 'player' && m.supersededBySequence == null && m.eventSequence > pending.sourceEventSequence)) return null
  return {text: pending.direction, origin: 'continued-thread' as const, actorKey: pending.actorKey, sourceThreadKey: pending.threadKey}
}
