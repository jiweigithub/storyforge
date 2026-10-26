import { describe, expect, it } from 'vitest'
import { uniqueTextOpenWorldObjectiveInteractionLocationV1 } from '../../src/lib/open-world/objective-scene-location'
import { projectTextOpenWorldPlayerQuestLogV1 } from '../../src/lib/open-world/player-quest-log'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

const objectiveKey = 'objective.main.1'
const proofFlag = 'flag.fulfillment.interaction.interaction.channel'

// Frozen P9 ordering from the real Build18 failure: optional off-site combat,
// required on-site investigation, then a completion restricted to the well.
function legacyMisplacedObjective() {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const narrative = runtimePackage.modules.narrative.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  const scene = narrative.scenes.find((row: any) => row.key === 'scene.objective.main.1')
  scene.locationKey = 'location.ridge-channel'
  scene.regionKey = 'region.ridge'
  scene.openingText = '断脊渠口的专属旧正文。'
  scene.bodyText = '只属于断脊渠口的场景，不应移到别处冒充原稿。'
  scene.actionKeys = ['action.start-ridge-jackal', 'action.investigate-channel', 'action.complete-main-objective']
  for (const [key, actionKey] of [
    ['choice.optional-combat', 'action.start-ridge-jackal'],
    ['choice.confirm-main', 'action.complete-main-objective'],
  ]) {
    narrative.fixedChoices.push({ key, sceneKey: scene.key, label: key, description: key, actionKey })
    scene.fixedChoiceKeys.push(key)
    actions.inputBindings.actions.find((row: any) => row.actionKey === actionKey).fixedChoiceKeys.push(key)
  }
  const completion = actions.actions.find((row: any) => row.key === 'action.complete-main-objective')
  const investigation = actions.actions.find((row: any) => row.key === 'action.investigate-channel')
  investigation.locationKeys = ['location.salt-port']
  const conditionKey = `condition.fulfillment.${objectiveKey}.operations`
  actions.conditions.push({ key: conditionKey, expression: { op: 'any', conditions: [
    { op: 'all', conditions: [{ op: 'world-flag', flagKey: proofFlag, value: true }] },
  ] }, failureMessage: '必须先完成现场调查。' })
  completion.requirementConditionKeys.push(conditionKey)
  actions.effects.push({ key: 'effect.fulfillment.interaction.interaction.channel', operation: 'set-world-flag',
    payload: { flagKey: proofFlag, value: true } })
  investigation.successEffectKeys.push('effect.fulfillment.interaction.interaction.channel')
  return { runtimePackage, scene, actions, completion, investigation }
}

function active(input = legacyMisplacedObjective()) {
  const projection = createInitialTextOpenWorldSessionProjectionV1(input.runtimePackage)
  const instance = Object.values(projection.state.quests.instancesByKey).find(row => row.definitionKey === 'quest.main.1')!
  instance.status = 'active'
  instance.acceptedAtWorldMinute = projection.state.time.worldMinute
  instance.currentStageKey = 'quest-stage.main.1'
  instance.objectiveStatusByKey[objectiveKey] = 'active'
  return { ...input, projection, instance }
}

describe('P9 objective location from governed fulfillment evidence', () => {
  it('旧包错置目标在唯一调查地点恢复入口，保留证据门、原包和原Action地点', () => {
    const { projection, runtimePackage, scene } = active()
    const frozen = JSON.stringify(runtimePackage)
    const before = projectTextOpenWorldScenesV1(projection).scenes.find(row => row.key === scene.key)
    expect(before).toMatchObject({ locationKey: 'location.salt-port', regionKey: 'region.salt-port',
      presentationMode: 'legacy-objective-location-fallback', actionKeys: ['action.investigate-channel'] })
    expect(before!.openingText).not.toContain('断脊渠口')
    expect(before!.bodyText).not.toContain('断脊渠口')
    expect(before!.compatibilityNotice).toContain('目标地点')
    const log = projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] }).entries.find(row => row.definitionKey === 'quest.main.1')!
    expect(log.locations.filter(row => row.roles.includes('quest-scene')).map(row => row.locationKey)).toEqual(['location.salt-port'])
    projection.state.world.flags[proofFlag] = true
    const after = projectTextOpenWorldScenesV1(projection).scenes.find(row => row.key === scene.key)!
    expect(after.actionKeys).toContain('action.complete-main-objective')
    expect(after.fixedChoices.some(choice => choice.key === 'choice.confirm-main')).toBe(true)
    expect(after.actionKeys).not.toContain('action.start-ridge-jackal')
    const registry = createTextOpenWorldActionRegistryV1(runtimePackage)
    expect(registry.project(deriveTextOpenWorldContextsV1(projection).action)
      .find(row => row.action.key === 'action.complete-main-objective')?.available).toBe(true)
    projection.state.map.currentLocationKey = 'location.ridge-channel'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    expect(projectTextOpenWorldScenesV1(projection).scenes.some(row => row.key === scene.key)).toBe(false)
    expect(registry.project(deriveTextOpenWorldContextsV1(projection).action)
      .find(row => row.action.key === 'action.complete-main-objective')?.available).toBe(false)
    expect(JSON.stringify(runtimePackage)).toBe(frozen)
  })

  it.each(['missing-proof', 'unbound-proof', 'target-outside-completion', 'not-legacy-combat', 'wrong-objective'])(
    '证据不充分或不属于旧编译形状时不移动场景：%s', mode => {
      const f = legacyMisplacedObjective()
      if (mode === 'missing-proof') f.completion.requirementConditionKeys = []
      if (mode === 'unbound-proof') f.investigation.successEffectKeys = ['effect.investigate-time']
      if (mode === 'target-outside-completion') {
        f.investigation.locationKeys = ['location.ridge-channel']
      }
      if (mode === 'not-legacy-combat') f.scene.actionKeys.reverse()
      if (mode === 'wrong-objective') {
        f.scene.sourceKey = 'objective.other'
        expect(() => active(f)).toThrow(/sourceKey与sourceKind不一致/)
        return
      }
      const { projection } = active(f)
      expect(projectTextOpenWorldScenesV1(projection).scenes.some(row => row.key === f.scene.key)).toBe(false)
    },
  )

  it.each(['negative', 'false', 'alternative', 'multiple-owners', 'multiple-proofs', 'cost-proof', 'failure-proof', 'not-supported', 'foreign-objective', 'ambiguous-location'])(
    '不能把不唯一的证明解释成目标地点：%s', mode => {
      const f = legacyMisplacedObjective()
      const condition = f.actions.conditions.find((row: any) => row.key === `condition.fulfillment.${objectiveKey}.operations`)
      const proof = f.actions.effects.find((row: any) => row.key === 'effect.fulfillment.interaction.interaction.channel')
      const flag = { op: 'world-flag', flagKey: proofFlag, value: true }
      if (mode === 'negative') condition.expression = { op: 'not', condition: flag }
      if (mode === 'false') condition.expression = { ...flag, value: false }
      if (mode === 'alternative') condition.expression = { op: 'any', conditions: [flag,
        { ...flag, flagKey: 'flag.fulfillment.interaction.interaction.other' }] }
      if (mode === 'multiple-owners') f.completion.successEffectKeys.push(proof.key)
      if (mode === 'multiple-proofs') f.actions.effects.push({ ...proof, key: `${proof.key}.duplicate` })
      if (mode === 'cost-proof') f.investigation.costEffectKeys.push(proof.key)
      if (mode === 'failure-proof') f.investigation.failureEffectKeys.push(proof.key)
      if (mode === 'not-supported') f.scene.actionKeys = f.scene.actionKeys.filter((key: string) => key !== f.investigation.key)
      if (mode === 'foreign-objective') f.actions.effects.find((row: any) => row.key === 'effect.complete-main-objective').payload.objectiveKey = 'objective.other'
      if (mode === 'ambiguous-location') {
        f.completion.locationKeys.push('location.ridge-channel')
        f.investigation.locationKeys.push('location.ridge-channel')
      }
      expect(uniqueTextOpenWorldObjectiveInteractionLocationV1({ objectiveKey,
        completionActionKey: f.completion.key, supportActionKeys: f.scene.actionKeys, graph: f.actions })).toBeNull()
    },
  )

  it('正确的新包沿用作者正文，生命周期仍阻止未接取和已完成目标', () => {
    const f = legacyMisplacedObjective()
    f.scene.locationKey = 'location.salt-port'
    f.scene.regionKey = 'region.salt-port'
    const { projection, instance } = active(f)
    expect(projectTextOpenWorldScenesV1(projection).scenes.find(row => row.key === f.scene.key))
      .toMatchObject({ presentationMode: 'authored', bodyText: f.scene.bodyText, compatibilityNotice: null })
    expect(projectTextOpenWorldScenesV1(createInitialTextOpenWorldSessionProjectionV1(f.runtimePackage))
      .scenes.some(row => row.key === f.scene.key)).toBe(false)
    instance.objectiveStatusByKey[objectiveKey] = 'completed'
    expect(projectTextOpenWorldScenesV1(projection).scenes.some(row => row.key === f.scene.key)).toBe(false)
  })
})
