import { avgKey, avgHash, avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgAssemblyBriefV1, type AvgAssemblyBriefV1, type AvgAssemblyBriefV2 } from './assembly-contract'
import { parseAvgVisualPlanningScopeV1, type AvgVisualPlanningScopeV1 } from './visual-planning-contract'

/** Explicit next private contract. Existing assembly V1/V2/V3 bytes retain
 * their original meaning; no placeholder request is stored in this Brief. */
export interface AvgVisualPlanningBriefV4 {
  schema: 'storyforge.avg.visual-planning-brief'
  version: 4
  assembly: AvgAssemblyBriefV1
  scope: AvgVisualPlanningScopeV1
  imageBinding: AvgAssemblyBriefV2['imageBinding']
}

export function parseAvgVisualPlanningBriefV4(value: unknown): AvgVisualPlanningBriefV4 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'assembly', 'scope', 'imageBinding'], 'visual planning Brief')
  if (r.schema !== 'storyforge.avg.visual-planning-brief' || r.version !== 4) throw new Error('[avg-visual-plan] 专业视觉 Brief 版本无效')
  const assembly = parseAvgAssemblyBriefV1(r.assembly), scope = parseAvgVisualPlanningScopeV1(r.scope)
  const b = avgRecord(r.imageBinding, ['requirementKey', 'adapterId', 'bindingHash', 'endpointRouteHash'], 'planning image binding')
  if (b.adapterId !== 'agnes.image-2.1-flash.v1' || b.requirementKey !== 'avg.media.image') throw new Error('[avg-visual-plan] 图片能力与准确 Agnes 路由不一致')
  for (const template of scope.templates) {
    const p = template.parameters
    if (p.consumer.sceneKey !== null && !assembly.sceneKeys.includes(p.consumer.sceneKey)) throw new Error('[avg-visual-plan] 消费槽不在冻结场景中')
    if (assembly.mediaAssetKeys.includes(p.assetKey) === (p.consumer.domain === 'reference')) throw new Error('[avg-visual-plan] runtime 媒资目录与图片用途不一致')
  }
  return { schema: r.schema, version: 4, assembly, scope, imageBinding: { requirementKey: avgKey(b.requirementKey, 'requirementKey'),
    adapterId: b.adapterId, bindingHash: avgHash(b.bindingHash, 'bindingHash'), endpointRouteHash: avgHash(b.endpointRouteHash, 'endpointRouteHash') } }
}

/** No UI/start/dispatch admission until the complete author-adoption and
 * compiled-request consumer slice is installed. Readability grants no call. */
export function assertAvgVisualPlanningStartReadyV4(): never {
  throw new Error('[avg-visual-plan] 专业视觉候选采用和需求消费尚未接通，不能开始新调用')
}
