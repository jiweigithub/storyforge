import type {
  TextOpenWorldItemRewardCatalogV1,
  TextOpenWorldItemAcquisitionSelectionV1,
  TextOpenWorldQuestFulfillmentSelectionsV1,
} from '../types'
import type { TextOpenWorldItemRewardCatalogInputContextV1 } from './item-reward-catalog-production'
import type { TextOpenWorldItemSourceChoiceV1 } from './item-source-production'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from './quest-finalize-production'

export const ITEM_DISPOSITION_CONTRACT_V1 = 'ordinary-delivery-v1' as const
/** Compact, lossless closed candidates: item demand, pickup source choice, later objective. */
export type TextOpenWorldOrdinaryDeliveryCandidateV1 = [number, number, number]
type ItemContext = Pick<TextOpenWorldItemRewardCatalogInputContextV1,
  'itemDemands' | 'questSkeletons' | 'contentRequirementManifest'>
function fail(message: string): never { throw new Error(`[text-open-world-ordinary-delivery] ${message}`) }

export function buildTextOpenWorldOrdinaryDeliveryCandidatesV1(
  context: ItemContext, choices: TextOpenWorldItemSourceChoiceV1[],
): TextOpenWorldOrdinaryDeliveryCandidateV1[] {
  const { quests, objectives, stages } = context.questSkeletons
  return context.itemDemands.flatMap(item => {
    if (item.demandKind !== 'content-requirement' || item.plannedKind !== 'misc' || item.criticality !== 'ordinary') return []
    const requirement = context.contentRequirementManifest.requirements.find(row => row.key === item.requirementKey)
    if (!requirement || requirement.minimumCount !== 1 || requirement.consumerRefs.length !== 2
      || requirement.consumerRefs.some(ref => ref.kind !== 'quest-objective')) return []
    const consumers = objectives.filter(objective => requirement.consumerRefs.some(ref => ref.consumerKey === objective.key)
      && objective.requirementKeys.includes(requirement.key))
      .sort((a, b) => (stages.find(stage => stage.key === a.stageKey)!.order - stages.find(stage => stage.key === b.stageKey)!.order) || a.order - b.order)
    const [pickup, delivery] = consumers
    if (consumers.length !== 2 || !pickup || !delivery || pickup.questKey !== delivery.questKey
      || quests.find(quest => quest.key === pickup.questKey)?.type !== 'ordinary'
      || pickup.optional || delivery.optional
      || !['collect', 'interact', 'investigate'].includes(pickup.playerIntent)
      || (pickup.stageKey === delivery.stageKey && pickup.order >= delivery.order)
      || (pickup.stageKey !== delivery.stageKey && stages.find(stage => stage.key === pickup.stageKey)!.order
        >= stages.find(stage => stage.key === delivery.stageKey)!.order)) return []
    const source = choices.find(choice => choice.kind === 'acquisition' && choice.sourceKey === pickup.key
      && choice.eligibleItemDemandNumbers.includes(item.demandNumber))
    return source ? [[item.demandNumber, source.choiceNumber, objectives.indexOf(delivery) + 1] as TextOpenWorldOrdinaryDeliveryCandidateV1] : []
  })
}

/** A disposition is an explicit author choice, never a free-text tag or name heuristic. */
export function assertTextOpenWorldOrdinaryDeliveryCatalogV1(catalog: TextOpenWorldItemRewardCatalogV1): void {
  if (catalog.itemDispositionContract === undefined && catalog.ordinaryDeliveryPlans === undefined) return
  if (catalog.itemDispositionContract !== ITEM_DISPOSITION_CONTRACT_V1 || catalog.itemSourceContract !== 'explicit-producers-v1'
    || !Array.isArray(catalog.ordinaryDeliveryPlans)) fail('普通交付物合同或来源合同缺失')
  let previous = 0
  for (const plan of catalog.ordinaryDeliveryPlans) {
    if (!plan || Object.keys(plan).sort().join(',') !== 'deliveryObjectiveKey,itemKey,pickupObjectiveKey'
      || typeof plan.pickupObjectiveKey !== 'string' || !plan.pickupObjectiveKey
      || typeof plan.deliveryObjectiveKey !== 'string' || !plan.deliveryObjectiveKey
      || plan.deliveryObjectiveKey === plan.pickupObjectiveKey) fail('普通交付物计划字段无效')
    const item = catalog.items.find(item => item.key === plan.itemKey)
    const sources = catalog.itemSourcePlans?.find(row => row.itemKey === plan.itemKey)?.sources
    if (!item || item.order <= previous || item.kind !== 'misc' || item.critical || item.unique || item.consumable
      || item.sellable || !item.droppable || item.baseValue !== 0 || item.stackPolicy !== 'stacked'
      || !sources || sources.length !== 1 || sources[0]!.kind !== 'acquisition'
      || sources[0]!.sourceKey !== plan.pickupObjectiveKey) fail('普通交付物必须唯一领取来源、不可售且无交易价值')
    previous = item.order
  }
}

/** P8F must realize both ends of the declared delivery; it cannot retain a
 * free replenishable item while omitting, moving or duplicating its sink. */
export function assertTextOpenWorldOrdinaryDeliveryFulfillmentV1(
  context: TextOpenWorldQuestFinalizeInputContextV1,
  fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1,
  acquisitions: TextOpenWorldItemAcquisitionSelectionV1[],
): void {
  assertTextOpenWorldOrdinaryDeliveryCatalogV1(context.itemRewardCatalog)
  const { objectives, quests, stages } = context.questSkeletons
  for (const plan of context.itemRewardCatalog.ordinaryDeliveryPlans ?? []) {
    const itemNumber = context.itemRewardCatalog.items.findIndex(item => item.key === plan.itemKey) + 1
    const pickupIndex = objectives.findIndex(objective => objective.key === plan.pickupObjectiveKey)
    const deliveryIndex = objectives.findIndex(objective => objective.key === plan.deliveryObjectiveKey)
    const pickup = objectives[pickupIndex], delivery = objectives[deliveryIndex]
    const grants = acquisitions.filter(selection => selection.items.some(item => item.itemNumber === itemNumber))
    const sinks = fulfillment.objectives.filter(selection => selection.items.some(item => item.itemNumber === itemNumber && item.consume))
    const sink = sinks[0]?.items.find(item => item.itemNumber === itemNumber)
    const requirementKeys = context.itemRewardCatalog.items[itemNumber - 1]?.fulfilledRequirementKeys ?? []
    if (!pickup || !delivery || pickup.optional || delivery.optional || pickup.questKey !== delivery.questKey
      || quests.find(quest => quest.key === pickup.questKey)?.type !== 'ordinary'
      || !requirementKeys.some(key => pickup.requirementKeys.includes(key) && delivery.requirementKeys.includes(key))
      || (pickup.stageKey === delivery.stageKey ? pickup.order >= delivery.order
        : (stages.find(stage => stage.key === pickup.stageKey)?.order ?? Infinity)
          >= (stages.find(stage => stage.key === delivery.stageKey)?.order ?? -Infinity))
      || grants.length !== 1 || grants[0]!.objectiveNumber !== pickupIndex + 1
      || grants[0]!.items.length !== 1 || grants[0]!.items[0]!.quantity !== 1
      || sinks.length !== 1 || sinks[0]!.objectiveNumber !== deliveryIndex + 1 || sink?.quantity !== 1
      || fulfillment.interactions.some(selection => selection.consumedItems.some(item => item.itemNumber === itemNumber))
      || fulfillment.objectives.some(selection => selection.groupItems?.some(group => group.some(item => item.itemNumber === itemNumber)))) {
      fail('普通交付物必须落实同一普通任务的单件领取和唯一后续原子交付')
    }
  }
}
