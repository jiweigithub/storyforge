import { describe, expect, it } from 'vitest'
import { parseAvgAssemblyBriefV1, parseAvgAssemblyBriefV2 } from '../../src/lib/avg/assembly-contract'
import { buildAvgAssemblyPlanV1, buildAvgMediaAssemblyPlanV2 } from '../../src/lib/avg/assembly-plan'
import type { ProviderCapabilityRequirementV1 } from '../../src/lib/types'
import {
  avgMediaChoiceArtifactKeyV1, avgRawMediaArtifactKeyV1, avgVisualBatchArtifactKeysV1,
  parseAvgAuthorMediaChoiceV1, parseAvgVisualProductionBatchV1, parseAvgVisualProductionRequirementV1,
  type AvgVisualProductionRequirementV1,
} from '../../src/lib/avg/media-production-contract'

function requirement(): AvgVisualProductionRequirementV1 {
  return { requirementKey: 'keeper.neutral', revision: 1, assetKey: 'avg.generated.keeper.neutral', name: '值班员平静立绘', altText: '同一服装的值班员',
    family: { subjectKey: 'keeper', familyKey: 'keeper.uniform', variantKey: 'neutral', revision: 1 },
    consumer: { consumerKey: 'desk.keeper.neutral', domain: 'stage', slot: 'actor', subjectKey: 'keeper', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
    triggerBeatKey: 'opening', itemStateKey: null, mediaKind: 'character-expression', prompt: '原创角色。', negativePrompt: '文字、水印',
    invariants: ['身份、服装、比例不变'], forbiddenDepictions: ['不可见的私密事实'], width: 864, height: 1152, resolutionTier: '1K', alpha: 'required', references: [] }
}
function batch(requirements = [requirement()]) {
  return { schema: 'storyforge.avg.visual-production-batch', version: 1, batchKey: 'visual.batch.1', revision: 1, baseWorkspaceHash: 'a'.repeat(64), requirements }
}

describe('AVG media production inputs and explicit choices', () => {
  it('原始图与作者选择分别结算，终态必须等到明确选择；V1 继续为零调用', () => {
    const base = { schema: 'storyforge.avg.assembly-brief' as const, version: 1 as const, title: '固定文本', sceneKeys: ['desk'], mediaAssetKeys: [requirement().assetKey], basePackageHash: null }
    const old = buildAvgAssemblyPlanV1({ brief: { avgAssembly: base }, briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    expect(old.tasks.every(t => t.budgetReservation.mediaCalls === 0 && t.budgetReservation.modelCalls === 0)).toBe(true)
    const capability: ProviderCapabilityRequirementV1 = { requirementKey: 'avg.media.image', mediaClass: 'image', operation: 'generate',
      adapterFamily: 'agnes', minimumCapabilityVersion: '1', allowedDataClasses: ['avg-reference'], maximumRequestCost: null,
      maximumTotalCost: null, rightsPolicyVersion: 'avg-rights.v1', capabilityHash: 'b'.repeat(64), required: true }
    const brief = { avgAssembly: parseAvgAssemblyBriefV2({ ...base, version: 2, mediaBatch: batch() }), capabilityRequirements: [capability] }
    const plan = buildAvgMediaAssemblyPlanV2({ brief, briefHash: 'c'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    const raw = plan.tasks.find(t => t.kind === 'avg-media-image-generate')!, choice = plan.tasks.find(t => t.kind === 'avg-author-media-choice')!
    expect(raw).toMatchObject({ executionMode: 'media-provider', maxAttempts: 1, budgetReservation: { mediaCalls: 1, modelCalls: 0, maximumCostUsd: null } })
    expect(choice).toMatchObject({ executionMode: 'human-import', inputArtifactKeys: raw.outputArtifactKeys, dependsOn: [raw.taskKey], budgetReservation: { mediaCalls: 0 } })
    expect(plan.tasks.find(t => t.taskKey === 'avg.author.stage')!.dependsOn).toContain(choice.taskKey)
    const visited = new Set<string>(), collect = (key: string) => { if (visited.has(key)) return; visited.add(key); plan.tasks.find(t => t.taskKey === key)!.dependsOn.forEach(collect) }
    collect(plan.terminalTaskKey); expect(visited.size).toBe(plan.tasks.length)
    expect(() => buildAvgMediaAssemblyPlanV2({ brief: { ...brief, capabilityRequirements: [] }, briefHash: 'c'.repeat(64), buildNumber: 1, controlEpoch: 0 })).toThrow(/唯一/)
  })
  it('V2 明确区分真实消费/参考目录并预留全部任务；V1 不会默默启用生成', () => {
    const v1 = { schema: 'storyforge.avg.assembly-brief', version: 1, title: '固定文本', sceneKeys: ['desk'], mediaAssetKeys: [], basePackageHash: null }
    expect(parseAvgAssemblyBriefV1(v1)).toEqual(v1)
    const v2 = { ...v1, version: 2, mediaAssetKeys: [requirement().assetKey], mediaBatch: batch() }
    expect(parseAvgAssemblyBriefV2(v2).version).toBe(2)
    expect(() => parseAvgAssemblyBriefV1(v2)).toThrow()
    expect(() => parseAvgAssemblyBriefV2({ ...v2, mediaAssetKeys: [] })).toThrow(/runtime/)
    expect(() => parseAvgAssemblyBriefV2({ ...v2, sceneKeys: Array.from({ length: 96 }, (_, i) => i ? `scene.${i}` : 'desk') })).toThrow(/100 任务/)
  })
  it('冻结有界需求并派生 raw/author-choice 输出，输入不冒充图片或自动绑定', () => {
    const parsed = parseAvgVisualProductionBatchV1(batch())
    expect(avgVisualBatchArtifactKeysV1(parsed)).toEqual([avgRawMediaArtifactKeyV1('keeper.neutral'), avgMediaChoiceArtifactKeyV1('keeper.neutral')])
    expect(parsed.requirements[0]).not.toHaveProperty('data')
    expect(parsed.requirements[0]).not.toHaveProperty('blobObjectId')
  })
  it('同角色不同触发拍允许差分，同一触发槽的冲突不采用后写覆盖', () => {
    const first = requirement(), second = { ...requirement(), requirementKey: 'keeper.smile', assetKey: 'avg.generated.keeper.smile', triggerBeatKey: 'answer' }
    expect(parseAvgVisualProductionBatchV1(batch([first, second])).requirements).toHaveLength(2)
    expect(() => parseAvgVisualProductionBatchV1(batch([first, { ...second, triggerBeatKey: first.triggerBeatKey }]))).toThrow(/consumer targets/)
  })
  it('同物件不同状态可有图标，详情不能按 ui 图标进入全屏舞台', () => {
    const icon: AvgVisualProductionRequirementV1 = { ...requirement(), mediaKind: 'ui', triggerBeatKey: null, itemStateKey: 'sealed',
      consumer: { ...requirement().consumer, domain: 'inventory', slot: 'icon', sceneKey: null }, alpha: 'not-required' }
    expect(parseAvgVisualProductionRequirementV1(icon).consumer.domain).toBe('inventory')
    expect(parseAvgVisualProductionBatchV1(batch([icon, { ...icon, requirementKey: 'keeper.open', assetKey: 'avg.generated.open', itemStateKey: 'open' }])).requirements).toHaveLength(2)
    expect(() => parseAvgVisualProductionRequirementV1({ ...icon, consumer: { ...icon.consumer, domain: 'stage', slot: 'cg', sceneKey: 'desk' }, triggerBeatKey: 'opening' })).toThrow(/不闭合/)
  })
  it('reference-only 可作为合法生产输入但不得变成 runtime 必需项', () => {
    const ref: AvgVisualProductionRequirementV1 = { ...requirement(), triggerBeatKey: null,
      consumer: { ...requirement().consumer, domain: 'reference', slot: 'identity', sceneKey: null, required: false } }
    expect(parseAvgVisualProductionRequirementV1(ref).consumer.domain).toBe('reference')
    expect(() => parseAvgVisualProductionRequirementV1({ ...ref, consumer: { ...ref.consumer, required: true } })).toThrow(/runtime/)
  })
  it('拒绝错主体、未实现消费者、错触发/状态、未知字段及超长合成输入', () => {
    const r = requirement()
    for (const value of [
      { ...r, family: { ...r.family, subjectKey: 'another-person' } },
      { ...r, consumer: { ...r.consumer, domain: 'gallery', slot: 'entry', sceneKey: null }, triggerBeatKey: null },
      { ...r, triggerBeatKey: null }, { ...r, itemStateKey: 'sealed' }, { ...r, providerOverride: 'hidden' },
      { ...r, invariants: Array.from({ length: 10 }, () => '长'.repeat(2000)) },
    ]) expect(() => parseAvgVisualProductionRequirementV1(value)).toThrow()
  })
  it('空、超量、重复输出及超长 task key 均在调用前拒绝', () => {
    expect(() => parseAvgVisualProductionBatchV1(batch([]))).toThrow(/明确需求/)
    expect(() => parseAvgVisualProductionBatchV1(batch(Array.from({ length: 9 }, () => requirement())))).toThrow(/有界/)
    expect(() => parseAvgVisualProductionBatchV1(batch([requirement(), requirement()]))).toThrow(/重复/)
    expect(() => parseAvgVisualProductionRequirementV1({ ...requirement(), requirementKey: 'a'.repeat(190) })).toThrow(/requirementKey/)
  })
  it('作者选择必须精确指向原始图片字节，不接受伪加工或另一需求', () => {
    const asset = { assetKey: 'avg.generated.keeper.neutral', version: 1, kind: 'character-expression', name: '值班员', mimeType: 'image/png',
      byteSize: 100, width: 864, height: 1152, durationMs: null, contentHash: 'b'.repeat(64), blobContentHash: 'b'.repeat(64),
      source: 'agnes.image-2.1-flash.v1', license: 'author-reviewed-provider-terms', altText: '值班员', characterTag: 'keeper', sceneTag: 'desk' }
    const choice = { schema: 'storyforge.avg.media-choice', version: 1, requirementKey: 'keeper.neutral', requirementRevision: 1,
      raw: { artifactKey: 'avg.media.raw.keeper.neutral', version: 1, contentHash: 'b'.repeat(64) }, asset, referenceOnly: false, declaration: '已查看此候选并核对其来源和当前用途。' }
    expect(parseAvgAuthorMediaChoiceV1(choice).asset.assetKey).toBe(asset.assetKey)
    expect(() => parseAvgAuthorMediaChoiceV1({ ...choice, requirementKey: 'keeper.smile' })).toThrow(/需求 key/)
    expect(() => parseAvgAuthorMediaChoiceV1({ ...choice, raw: { ...choice.raw, contentHash: 'c'.repeat(64) } })).toThrow(/原始图片/)
    expect(() => parseAvgAuthorMediaChoiceV1({ ...choice, blobObjectId: 42 })).toThrow(/字段/)
  })
})
