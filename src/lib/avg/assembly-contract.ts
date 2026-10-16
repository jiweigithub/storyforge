import { avgHash, avgKey, avgKeys, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseAvgVisualProductionBatchV1, type AvgVisualProductionBatchV1 } from './media-production-contract'

/** Frozen output domain for author assembly. Canonical rules/text remain adopted artifacts. */
export interface AvgAssemblyBriefV1 {
  schema: 'storyforge.avg.assembly-brief'
  version: 1
  title: string
  sceneKeys: string[]
  mediaAssetKeys: string[]
  basePackageHash: string | null
}
/** Nominal V2 input contract. It requires a matching bounded Plan, executor,
 * producer verification and explicit author-choice path before admission. */
export interface AvgAssemblyBriefV2 extends Omit<AvgAssemblyBriefV1, 'version'> {
  version: 2
  mediaBatch: AvgVisualProductionBatchV1
  imageBinding: { requirementKey: string; adapterId: 'agnes.image-2.1-flash.v1'; bindingHash: string; endpointRouteHash: string }
}
export type AvgAssemblyBrief = AvgAssemblyBriefV1 | AvgAssemblyBriefV2
/** Experimental production is opt-in. Codecs still read existing records when
 * disabled; command/dispatch boundaries enforce admission before new calls. */
export function avgMediaProductionEnabledV2(): boolean {
  return import.meta.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION === '1'
}
export const AVG_ASSEMBLY_GATE_IDS_V1 = [
  'avg.rules.confirmed','avg.scripts.confirmed','avg.stage.confirmed',
  'runtime.package.valid','avg.media.bytes.valid','avg.rights.declared',
] as const
export function avgMediaAssemblyGateIdsV2(batch: AvgVisualProductionBatchV1): string[] {
  return [...AVG_ASSEMBLY_GATE_IDS_V1, ...batch.requirements.flatMap(r => [
    `avg.media.raw.received.${r.requirementKey}`, `avg.media.choice.confirmed.${r.requirementKey}`,
  ])]
}
export function parseAvgAssemblyBrief(value: unknown): AvgAssemblyBrief {
  const body = avgProtocolBody(value)
  return (body as { version?: unknown } | null)?.version === 2 ? parseAvgAssemblyBriefV2(body) : parseAvgAssemblyBriefV1(body)
}
export function parseAvgAssemblyBriefV1(value: unknown): AvgAssemblyBriefV1 {
  const row = avgRecord(avgProtocolBody(value), ['schema','version','title','sceneKeys','mediaAssetKeys','basePackageHash'], 'AVG assembly Brief')
  if (row.schema !== 'storyforge.avg.assembly-brief' || row.version !== 1) throw new Error('[avg] 组装 Brief 版本无效')
  const sceneKeys = avgKeys(row.sceneKeys, 'sceneKeys'), mediaAssetKeys = avgKeys(row.mediaAssetKeys, 'mediaAssetKeys')
  // Existing shared production protocol permits 100 tasks: four joins plus scene inputs.
  if (!sceneKeys.length || sceneKeys.length > 96 || mediaAssetKeys.length > 128) throw new Error('[avg] 当前组装需 1～96 个场景、最多 128 项媒资')
  return { schema: row.schema, version: 1, title: avgText(row.title, 'title', 200), sceneKeys, mediaAssetKeys,
    basePackageHash: row.basePackageHash === null ? null : avgHash(row.basePackageHash, 'basePackageHash') }
}

export function parseAvgAssemblyBriefV2(value: unknown): AvgAssemblyBriefV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'title', 'sceneKeys', 'mediaAssetKeys', 'basePackageHash', 'mediaBatch', 'imageBinding'], 'AVG media assembly Brief')
  if (r.version !== 2) throw new Error('[avg-media] 媒资组装 Brief 版本无效')
  const { mediaBatch: rawBatch, imageBinding: rawBinding, ...baseInput } = r
  const base = parseAvgAssemblyBriefV1({ ...baseInput, version: 1 })
  const mediaBatch = parseAvgVisualProductionBatchV1(rawBatch)
  if (base.sceneKeys.length + 4 + 2 * mediaBatch.requirements.length > 100) throw new Error('[avg-media] 场景、原始候选、作者选择与终态 join 超过共享 100 任务上限')
  for (const requirement of mediaBatch.requirements) {
    const included = base.mediaAssetKeys.includes(requirement.assetKey)
    if (included === (requirement.consumer.domain === 'reference')) throw new Error('[avg-media] runtime 媒资目录必须包含消费图且排除 reference-only')
    if (requirement.consumer.sceneKey !== null && !base.sceneKeys.includes(requirement.consumer.sceneKey)) throw new Error('[avg-media] 图像 consumer 引用了未冻结的场景')
  }
  const b = avgRecord(rawBinding, ['requirementKey', 'adapterId', 'bindingHash', 'endpointRouteHash'], 'AVG image binding')
  if (b.adapterId !== 'agnes.image-2.1-flash.v1') throw new Error('[avg-media] 图片路由必须使用准确的 Agnes adapter')
  return { ...base, version: 2, mediaBatch, imageBinding: { requirementKey: avgKey(b.requirementKey, 'imageBinding.requirementKey'),
    adapterId: b.adapterId, bindingHash: avgHash(b.bindingHash, 'imageBinding.bindingHash'), endpointRouteHash: avgHash(b.endpointRouteHash, 'endpointRouteHash') } }
}
