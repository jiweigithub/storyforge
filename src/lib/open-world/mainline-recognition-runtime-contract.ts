type Row = Record<string, unknown>
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const keys = (value: unknown): string[] => Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []
function fail(): never { throw new Error('[text-open-world-mainline-recognition] 运行认可必须归属唯一受保护主线目标，完成真实核验后原子授予一次') }

/** Runtime v21 alone admits this bounded suffix. Production separately checks
 * the exact objective/faction source requirements before freezing the package. */
export function assertTextOpenWorldMainlineRecognitionRuntimeContractV1(input: {
  version: number; actions: Row[]; effects: Row[]; conditions: Row[]
  quests: Row[]; stages: Row[]; objectives: Row[]; factionKeys: ReadonlySet<string>; otherModules: unknown[]
}): Set<string> {
  const grants = input.effects.filter(effect => String(effect.key).startsWith('effect.recognition.'))
  const owners = new Set<string>()
  const proofKeys = new Set<string>()
  if (!grants.length) return owners
  if (input.version !== 21) fail()
  const references = (action: Row) => ['costEffectKeys', 'successEffectKeys', 'failureEffectKeys'].flatMap(field => keys(action[field]))
  for (const grant of grants) {
    const matches = input.actions.filter(action => references(action).includes(String(grant.key)))
    if (matches.length !== 1 || !keys(matches[0]!.successEffectKeys).includes(String(grant.key))
      || keys(matches[0]!.costEffectKeys).includes(String(grant.key)) || keys(matches[0]!.failureEffectKeys).includes(String(grant.key))) fail()
    owners.add(String(matches[0]!.key))
  }
  for (const ownerKey of owners) {
    const action = input.actions.find(action => action.key === ownerKey)!
    const success = keys(action.successEffectKeys).map(key => input.effects.find(effect => effect.key === key)!)
    const objectiveKey = object(success[0]?.payload).objectiveKey
    const objective = input.objectives.find(objective => objective.key === objectiveKey)
    const stage = input.stages.find(stage => stage.key === objective?.stageKey)
    const quest = input.quests.find(quest => quest.key === stage?.questKey)
    const suffix = success.slice(1)
    if (action.category !== 'objective-action' || success[0]?.operation !== 'complete-objective'
      || !objective || objective.optional !== false || !keys(objective.actionKeys).includes(ownerKey)
      || quest?.type !== 'mainline' || quest.lifecyclePolicy !== 'protected-wait' || quest.repeatable !== false
      || suffix.length < 1 || suffix.length > 3
      || suffix.some(effect => {
        const payload = object(effect.payload)
        return effect.operation !== 'change-faction-affinity' || payload.amount !== 10
          || !input.factionKeys.has(String(payload.factionKey))
          || effect.key !== `effect.recognition.${String(objectiveKey)}.${String(payload.factionKey)}`
      }) || new Set(suffix.map(effect => object(effect.payload).factionKey)).size !== suffix.length) fail()
    const requirements = keys(action.requirementConditionKeys).map(key => object(input.conditions.find(condition => condition.key === key)?.expression))
    if (!requirements.some(expression => expression.op === 'not' && object(expression.condition).op === 'quest-objective'
      && object(expression.condition).objectiveKey === objectiveKey && object(expression.condition).status === 'completed')) fail()
    const locations = new Set<string>()
    const provesOperation = (value: unknown): boolean => {
      const expression = object(value)
      if (expression.op === 'all' || expression.op === 'any') {
        const children = Array.isArray(expression.conditions) ? expression.conditions : []
        const proofs = children.map(provesOperation)
        return proofs.length > 0 && (expression.op === 'all' ? proofs.some(Boolean) : proofs.every(Boolean))
      }
      if (expression.op !== 'world-flag' || expression.value !== true || typeof expression.flagKey !== 'string') return false
      const interaction = expression.flagKey.startsWith('flag.fulfillment.interaction.')
      const dialogue = expression.flagKey.startsWith(`flag.fulfillment.dialogue.${String(objectiveKey)}.`)
      if (!interaction && !dialogue) return false
      const writers = input.effects.filter(effect => effect.operation === 'set-world-flag'
        && object(effect.payload).flagKey === expression.flagKey && object(effect.payload).value === true)
      if (writers.length !== 1) fail()
      const actions = input.actions.filter(action => references(action).includes(String(writers[0]!.key)))
      const expected = interaction ? `action.interaction.${expression.flagKey.slice('flag.fulfillment.interaction.'.length)}`
        : `action.dialogue.${expression.flagKey.slice('flag.fulfillment.dialogue.'.length)}`
      if (actions.length !== 1 || actions[0]!.key !== expected || !keys(actions[0]!.successEffectKeys).includes(String(writers[0]!.key))
        || keys(actions[0]!.costEffectKeys).includes(String(writers[0]!.key))
        || keys(actions[0]!.failureEffectKeys).includes(String(writers[0]!.key))
        || actions[0]!.actorScope !== 'player' || (dialogue && (actions[0]!.category !== 'talk' || actions[0]!.targetScope !== 'actor'))
        || !keys(actions[0]!.locationKeys).length) fail()
      proofKeys.add(String(writers[0]!.key))
      keys(actions[0]!.locationKeys).forEach(key => locations.add(key))
      return true
    }
    const proofResults = requirements.map(provesOperation)
    if (!proofResults.some(Boolean) || !keys(action.locationKeys).length || keys(action.locationKeys).some(key => !locations.has(key))) fail()
  }
  const grantKeys = new Set([...grants.map(grant => String(grant.key)), ...proofKeys])
  const rejectForeignReferences = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(rejectForeignReferences); return }
    for (const [field, child] of Object.entries(object(value))) {
      if (/(?:^effect|Effect)Keys?$/.test(field)
        && (typeof child === 'string' ? grantKeys.has(child) : keys(child).some(key => grantKeys.has(key)))) fail()
      rejectForeignReferences(child)
    }
  }
  input.otherModules.forEach(rejectForeignReferences)
  return owners
}
