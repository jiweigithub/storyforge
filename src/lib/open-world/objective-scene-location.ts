import type {
  TextOpenWorldActionDefinitionV1,
  TextOpenWorldConditionDefinitionV1,
  TextOpenWorldConditionExpressionV1,
  TextOpenWorldEffectDefinitionV1,
} from '../types'

export interface TextOpenWorldObjectiveLocationGraphV1 {
  actions: readonly TextOpenWorldActionDefinitionV1[]
  conditions: readonly TextOpenWorldConditionDefinitionV1[]
  effects: readonly TextOpenWorldEffectDefinitionV1[]
}

export function textOpenWorldActionCompletesObjectiveV1(
  action: TextOpenWorldActionDefinitionV1,
  objectiveKey: string,
  graph: TextOpenWorldObjectiveLocationGraphV1,
): boolean {
  return action.actorScope === 'player' && action.category === 'objective-action' && action.targetScope === 'quest'
    && graph.effects.some(effect => action.successEffectKeys.includes(effect.key)
      && effect.operation === 'complete-objective' && effect.payload.objectiveKey === objectiveKey)
}

function interactionFlags(expression: TextOpenWorldConditionExpressionV1): string[] | null {
  if (expression.op === 'world-flag' && expression.value === true
    && expression.flagKey.startsWith('flag.fulfillment.interaction.')) return [expression.flagKey]
  if ((expression.op !== 'any' && expression.op !== 'all') || !expression.conditions.length) return null
  const children = expression.conditions.map(interactionFlags)
  return children.some(child => child == null) ? null : children.flatMap(child => child!)
}

/** Only a unique, positively required interaction with a unique successful
 * proof owner supplies a legacy location. No title matching, current flags,
 * optional support order, or guessed OR branch may select it. */
export function uniqueTextOpenWorldObjectiveInteractionLocationV1(input: {
  objectiveKey: string
  completionActionKey: string
  supportActionKeys: readonly string[]
  graph: TextOpenWorldObjectiveLocationGraphV1
}): string | null {
  const { graph, objectiveKey } = input
  const completion = graph.actions.find(action => action.key === input.completionActionKey)
  if (!completion || !textOpenWorldActionCompletesObjectiveV1(completion, objectiveKey, graph)) return null
  const conditionKey = `condition.fulfillment.${objectiveKey}.operations`
  if (!completion.requirementConditionKeys.includes(conditionKey)) return null
  const condition = graph.conditions.find(row => row.key === conditionKey)
  const flags = condition ? interactionFlags(condition.expression) : null
  if (!flags || new Set(flags).size !== 1) return null
  const proofEffects = graph.effects.filter(effect => effect.operation === 'set-world-flag'
    && effect.payload.flagKey === flags[0] && effect.payload.value === true)
  if (proofEffects.length !== 1) return null
  const proofKey = proofEffects[0]!.key
  const owners = graph.actions.filter(action => [...action.successEffectKeys, ...action.costEffectKeys, ...action.failureEffectKeys].includes(proofKey))
  if (owners.length !== 1 || owners[0]!.actorScope !== 'player'
    || owners[0]!.costEffectKeys.includes(proofKey) || owners[0]!.failureEffectKeys.includes(proofKey)
    || !input.supportActionKeys.includes(owners[0]!.key)) return null
  const locations = [...new Set(owners[0]!.locationKeys.filter(locationKey => (
    !completion.locationKeys.length || completion.locationKeys.includes(locationKey)
  )))]
  return locations.length === 1 ? locations[0]! : null
}
