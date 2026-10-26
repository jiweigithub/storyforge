import { describe, expect, it } from 'vitest'
import { assertTextOpenWorldMainlineRecognitionRuntimeContractV1 as validate } from '../../src/lib/open-world/mainline-recognition-runtime-contract'

// Isolated runtime contract fixture; complete generated-package integration is
// exercised separately by the Salt Ridge production DAG.
function fixture() {
  const proof = 'effect.proof'
  const grant = 'effect.recognition.objective.main.faction.harbor'
  return {
    version: 21,
    actions: [
      { key: 'action.complete', category: 'objective-action', actorScope: 'player', targetScope: 'quest', locationKeys: ['location.harbor'],
        requirementConditionKeys: ['condition.proof', 'condition.unclaimed'], costEffectKeys: [], successEffectKeys: ['effect.complete', grant], failureEffectKeys: [] },
      { key: 'action.dialogue.objective.main.actor.witness', category: 'talk', actorScope: 'player', targetScope: 'actor', locationKeys: ['location.harbor'],
        requirementConditionKeys: [], costEffectKeys: [], successEffectKeys: [proof], failureEffectKeys: [] },
    ],
    effects: [
      { key: 'effect.complete', operation: 'complete-objective', payload: { objectiveKey: 'objective.main' } },
      { key: grant, operation: 'change-faction-affinity', payload: { factionKey: 'faction.harbor', amount: 10 } },
      { key: proof, operation: 'set-world-flag', payload: { flagKey: 'flag.fulfillment.dialogue.objective.main.actor.witness', value: true } },
    ],
    conditions: [
      { key: 'condition.proof', expression: { op: 'any', conditions: [{ op: 'all', conditions: [{ op: 'world-flag', flagKey: 'flag.fulfillment.dialogue.objective.main.actor.witness', value: true }] }] } },
      { key: 'condition.unclaimed', expression: { op: 'not', condition: { op: 'quest-objective', objectiveKey: 'objective.main', status: 'completed' } } },
    ],
    quests: [{ key: 'quest.main', type: 'mainline', lifecyclePolicy: 'protected-wait', repeatable: false }],
    stages: [{ key: 'stage.main', questKey: 'quest.main' }],
    objectives: [{ key: 'objective.main', stageKey: 'stage.main', optional: false, actionKeys: ['action.complete'] }],
    factionKeys: new Set(['faction.harbor']), otherModules: [] as unknown[],
  }
}

describe('mainline recognition runtime contract v21', () => {
  it('accepts one atomic recognition suffix and preserves old packages without recognition', () => {
    const current = fixture()
    expect([...validate(current)]).toEqual(['action.complete'])
    const legacy = fixture()
    legacy.version = 20
    legacy.actions[0]!.successEffectKeys.pop()
    legacy.effects.splice(1, 1)
    expect([...validate(legacy)]).toEqual([])
  })

  it.each<[string, (value: any) => void]>([
    ['downgrade', value => { value.version = 20 }],
    ['amount', value => { value.effects[1].payload.amount = 99 }],
    ['unbound faction', value => { value.effects[1].payload.factionKey = 'faction.foreign' }],
    ['wrong key', value => { value.effects[1].key = 'effect.recognition.objective.foreign.faction.harbor' }],
    ['wrong order', value => { value.actions[0].successEffectKeys.reverse() }],
    ['optional', value => { value.objectives[0].optional = true }],
    ['ordinary', value => { value.quests[0].type = 'ordinary' }],
    ['restartable', value => { value.quests[0].repeatable = true }],
    ['no unclaimed gate', value => { value.actions[0].requirementConditionKeys.pop() }],
    ['no proof gate', value => { value.actions[0].requirementConditionKeys.shift() }],
    ['unproven OR branch', value => { value.conditions[0].expression.conditions.push({ op: 'world-flag', flagKey: 'flag.unrelated', value: true }) }],
    ['wrong location', value => { value.actions[0].locationKeys = ['location.foreign'] }],
    ['no proof action', value => { value.actions.pop() }],
    ['fake proof writer', value => { value.actions[1].category = 'wait' }],
    ['failed proof', value => { value.actions[1].failureEffectKeys = ['effect.proof'] }],
    ['cost proof', value => { value.actions[1].costEffectKeys = ['effect.proof'] }],
    ['duplicate grant owner', value => { value.actions[1].successEffectKeys.push(value.effects[1].key) }],
    ['grant in cost', value => { value.actions[0].costEffectKeys.push(value.effects[1].key) }],
    ['reward bypass', value => { value.otherModules.push({ rewards: [{ effectKeys: [value.effects[1].key] }] }) }],
    ['director proof bypass', value => { value.otherModules.push({ rules: [{ successEffectKeys: ['effect.proof'] }] }) }],
  ])('rejects %s', (_label, mutate) => {
    const copy = fixture()
    mutate(copy)
    expect(() => validate(copy)).toThrow(/运行认可/)
  })
})
