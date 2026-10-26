import type {
  TextOpenWorldMainlineRecognitionSelectionV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestFulfillmentSelectionsV1,
} from '../types'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from './quest-finalize-production'
import { buildTextOpenWorldObjectiveFulfillmentDemandsV1 } from './objective-fulfillment-production'

export const MAINLINE_RECOGNITION_CONTRACT_V1 = 'mainline-faction-recognition-v1' as const
type Context = TextOpenWorldQuestFinalizeInputContextV1
function fail(message: string): never { throw new Error(`[text-open-world-mainline-recognition] ${message}`) }

/** A faction must be an actual catalog fulfillment of this fixed mainline
 * objective's requirement. Nearby factions or free semantic labels confer no authority. */
export function buildTextOpenWorldMainlineRecognitionCandidatesV1(context: Omit<Context, 'contextSelectionHash'>) {
  return context.questSkeletons.objectives.flatMap((objective, index) => {
    if (objective.optional || context.questSkeletons.quests.find(quest => quest.key === objective.questKey)?.type !== 'mainline') return []
    const requirementKeys = context.contentRequirementManifest.requirements.filter(requirement => requirement.kind === 'faction'
      && objective.requirementKeys.includes(requirement.key)
      && requirement.consumerRefs.some(ref => ref.kind === 'quest-objective' && ref.consumerKey === objective.key)).map(row => row.key)
    const factions = context.npcRuntimeCatalog.factions.flatMap((faction, index) => (
      faction.fulfilledRequirementKeys.some(key => requirementKeys.includes(key))
        ? [{ factionNumber: index + 1, factionKey: faction.key, title: faction.title }] : []
    ))
    return factions.length ? [{ objectiveNumber: index + 1, objectiveKey: objective.key, title: objective.title, factions }] : []
  })
}

export function parseTextOpenWorldMainlineRecognitionSelectionsV1(value: unknown, context: Context,
  fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1): TextOpenWorldMainlineRecognitionSelectionV1[] {
  const candidates = buildTextOpenWorldMainlineRecognitionCandidatesV1(context)
  const demands = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context)
  if (!Array.isArray(value) || value.length > candidates.length) fail('主线认可选择必须是有界数组')
  let previous = 0
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).sort().join(',') !== 'factionNumbers,objectiveNumber') fail('主线认可字段不精确')
    const candidate = candidates.find(candidate => candidate.objectiveNumber === row.objectiveNumber)
    if (!Number.isSafeInteger(row.objectiveNumber) || row.objectiveNumber <= previous || !candidate
      || !Array.isArray(row.factionNumbers) || !row.factionNumbers.length || row.factionNumbers.length > 3
      || row.factionNumbers.some((number: unknown, index: number) => !Number.isSafeInteger(number)
        || (index > 0 && Number(number) <= row.factionNumbers[index - 1])
        || !candidate.factions.some(faction => faction.factionNumber === number))) fail('主线认可必须按序选择同一目标的既有阵营')
    previous = row.objectiveNumber
    const demand = demands.find(demand => demand.objectiveNumber === row.objectiveNumber)!
    const selected = fulfillment.objectives.find(selection => selection.objectiveNumber === row.objectiveNumber)
    if (!selected?.anyActionGroups.length || selected.anyActionGroups.some(group => !group.some(number => {
      const operation = demand.candidates[number - 1]
      return operation && (operation.kind === 'interaction' || operation.kind === 'dialogue') && operation.locationKeys.length
    }))) fail('每条主线认可路径都必须有同一目标的实际对话或核验操作')
    return { objectiveNumber: row.objectiveNumber as number, factionNumbers: [...row.factionNumbers] as number[] }
  })
}

/** Append to the existing atomic objective completion batch AFTER fulfillment
 * compilation. No independent claim action can grant reputation without proof. */
export function compileTextOpenWorldMainlineRecognitionV1(input: {
  context: Context
  selections: TextOpenWorldMainlineRecognitionSelectionV1[]
  fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1
} & Pick<TextOpenWorldQuestDesignDocumentsV1, 'actions' | 'conditions' | 'effects' | 'objectives'>): void {
  const { context, selections, actions, conditions, effects, objectives } = input
  const demands = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context)
  for (const selection of selections) {
    const source = context.questSkeletons.objectives[selection.objectiveNumber - 1]!
    const objective = objectives.find(row => row.key === source.key) ?? fail('主线认可缺少正式目标')
    const owner = actions.find(row => row.key === objective.completionActionKey) ?? fail('主线认可缺少目标提交动作')
    const demand = demands.find(demand => demand.objectiveNumber === selection.objectiveNumber)!
    const proof = input.fulfillment.objectives.find(row => row.objectiveNumber === selection.objectiveNumber)!
    const locations = [...new Set(proof.anyActionGroups.flat().flatMap(number => {
      const candidate = demand.candidates[number - 1]!
      return candidate.kind === 'interaction' || candidate.kind === 'dialogue' ? candidate.locationKeys : []
    }))]
    owner.locationKeys = owner.locationKeys.filter(key => locations.includes(key))
    if (!owner.locationKeys.length) fail('主线认可操作地点不属于该任务')
    const conditionKey = `condition.recognition.${source.key}.unclaimed`
    conditions.push({ key: conditionKey, expression: { op: 'not', condition: { op: 'quest-objective', objectiveKey: source.key, status: 'completed' } },
      failureMessage: '该主线核验已完成，认可不能重复取得。' })
    owner.requirementConditionKeys.push(conditionKey)
    objective.completionConditionKeys = [...owner.requirementConditionKeys]
    for (const number of selection.factionNumbers) {
      const factionKey = context.npcRuntimeCatalog.factions[number - 1]!.key
      const key = `effect.recognition.${source.key}.${factionKey}`
      effects.push({ key, operation: 'change-faction-affinity', payload: { factionKey, amount: 10 } })
      owner.successEffectKeys.push(key)
    }
  }
}
