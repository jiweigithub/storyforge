import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgVisualProductionBatchV1, type AvgVisualProductionBatchV1 } from './media-production-contract'
import type { AvgSystemPlan } from './system-contract'
import { composeAvgCharacterFamilyRequirementsV1, hashAvgCharacterFamilyProposalV1 } from './character-family-contract'

export type AvgMediaSourceInputV1 = Pick<AvgAuthorWorkspaceV1, 'systemPlan' | 'scripts'> & {
  presentation: Pick<AvgAuthorWorkspaceV1['presentation'], 'aspectRatio'>
}

/** Selection, cues, reading preferences and the batch itself cannot recursively
 * invalidate a request. Canonical rules/text/aspect still fence its meaning.
 * This projection is not a SourcePlan, context grant or author adoption. */
function sourceInput(value: AvgMediaSourceInputV1) {
  const source = parseAvgAuthorWorkspaceV1({ schema: 'storyforge.avg.author-workspace', version: 1, basePreviewHash: null,
    systemPlan: value.systemPlan, scripts: value.scripts,
    presentation: { schema: 'storyforge.avg.author-stage', version: 1, aspectRatio: value.presentation.aspectRatio,
      stage: { version: 1, cues: [], assets: [] } } })
  const scenes = new Set(source.systemPlan.scenes.map(s => s.key)), characters = new Set(source.systemPlan.characters.map(c => c.key))
  for (const script of source.scripts) {
    if (!scenes.has(script.sceneKey) || script.lines.some(line => line.speakerKey !== null && !characters.has(line.speakerKey))) {
      throw new Error('[avg-media] 媒资来源脚本引用未知场景或人物')
    }
  }
  return { schema: 'storyforge.avg.media-source-input' as const, version: 1 as const, systemPlan: source.systemPlan,
    scripts: [...source.scripts].sort((a, b) => a.sceneKey < b.sceneKey ? -1 : a.sceneKey > b.sceneKey ? 1 : 0),
    aspectRatio: source.presentation.aspectRatio }
}

export async function hashAvgMediaSourceInputV1(input: AvgMediaSourceInputV1): Promise<string> {
  return hashProductProductionValueV2(sourceInput(input))
}

/** Verify exact existing consumer slots. A gameplay state is not a display
 * variant; never invent predicates or rewrite rules to make a target exist. */
export async function validateAvgVisualProductionBatchSourceV1(value: unknown, input: AvgMediaSourceInputV1): Promise<AvgVisualProductionBatchV1> {
  const batch = parseAvgVisualProductionBatchV1(value), source = sourceInput(input)
  if (batch.aspectRatio !== source.aspectRatio || batch.sourceInputHash !== await hashProductProductionValueV2(source)) {
    throw new Error('[avg-media] 系统、文本或画幅已变化，请重新冻结媒资需求')
  }
  const plan = source.systemPlan
  if(batch.characterFamily){
    const {proposal}=batch.characterFamily,{proposalHash,...body}=proposal
    if(proposalHash!==await hashAvgCharacterFamilyProposalV1(body)||proposal.sourceInputHash!==batch.sourceInputHash
      ||!plan.characters.some(character=>character.key===proposal.plan.subjectKey)
      ||canonicalProductProductionJsonV2(composeAvgCharacterFamilyRequirementsV1(proposal.plan))!==canonicalProductProductionJsonV2(batch.requirements))throw new Error('[avg-family] 家族提案、授权或准确变体需求已变化，请重新核对')
  }
  for (const r of batch.requirements) {
    const c = r.consumer
    if (c.domain === 'stage') {
      const scene = plan.scenes.find(s => s.key === c.sceneKey), script = source.scripts.find(s => s.sceneKey === c.sceneKey)
      // The current script codec requires beatKey === lineKey, and the
      // executable module uses that canonical line identity as its Cue clock.
      if (!scene || !script?.lines.some(line => line.lineKey === r.triggerBeatKey)) throw new Error('[avg-media] 演出消费缺少准确场景和触发拍')
      if (c.slot === 'actor' ? !plan.characters.some(p => p.key === c.subjectKey) : c.subjectKey !== scene.key) {
        throw new Error('[avg-media] 演出消费主体与人物或场景不一致')
      }
    } else if (c.domain === 'inventory' || c.domain === 'evidence') {
      const item = plan.version === 2 ? plan.inventory.items.find(i => i.key === c.subjectKey) : undefined
      if (!item || r.itemVariantKey !== null && !item.variants.some(v => v.key === r.itemVariantKey)) {
        throw new Error('[avg-media] 物件消费缺少准确物件或显示变体；不能用玩法状态代替')
      }
    } else if (c.domain === 'reference') {
      if (!plan.characters.some(p => p.key === c.subjectKey) && !plan.scenes.some(s => s.key === c.subjectKey)
        && !(plan.version === 2 && plan.inventory.items.some(i => i.key === c.subjectKey))) {
        throw new Error('[avg-media] 参考图主体未在当前系统声明')
      }
    } else throw new Error('[avg-media] 未实现的图像消费域')
  }
  return batch
}

/** Item slots must be declared before media dispatch freezes canonical rules.
 * Draft preparation may propose these references; execution never adds them. */
export function assertAvgMediaConsumerDeclarationsV1(batch: AvgVisualProductionBatchV1, plan: AvgSystemPlan) {
  for (const r of batch.requirements) {
    if (r.consumer.domain !== 'inventory' && r.consumer.domain !== 'evidence') continue
    const item = plan.version === 2 ? plan.inventory.items.find(item => item.key === r.consumer.subjectKey) : undefined
    const view = r.itemVariantKey === null ? item : item?.variants.find(view => view.key === r.itemVariantKey)
    if (!view || (r.consumer.domain === 'inventory' ? view.iconAssetKey : view.detailAssetKey) !== r.assetKey) {
      throw new Error('[avg-media] 请在生成前确认准确物件显示槽的图片声明，再冻结需求')
    }
  }
}

/** Caller must save and explicitly review/start this bounded input. This helper
 * neither reads provider configuration nor makes a call, candidate or binding. */
export async function freezeAvgVisualProductionBatchV1(value: Omit<AvgVisualProductionBatchV1, 'sourceInputHash' | 'aspectRatio'>, input: AvgMediaSourceInputV1) {
  const batch = { ...value, aspectRatio: input.presentation.aspectRatio, sourceInputHash: await hashAvgMediaSourceInputV1(input) }
  return validateAvgVisualProductionBatchSourceV1(batch, input)
}
