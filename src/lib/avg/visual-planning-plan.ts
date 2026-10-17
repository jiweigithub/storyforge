import type { ProductProductionBriefV3, ProductProductionPlanTaskV3, ProductProductionPlanV3 } from '../types'
import { buildAvgMediaAssemblyPlanV2 } from './assembly-plan'
import { parseAvgVisualPlanningBriefV4, type AvgVisualPlanningBriefV4 } from './visual-planning-brief'
import { avgMediaBriefArtifactKeyV1, type AvgVisualDesignKindV1 } from './visual-planning-contract'
import { avgKey } from './protocol-validation'
import { AVG_VISUAL_TEXT_CAPABILITY_V4, avgVisualPlanningRoleV1 } from './visual-planning-roles'

export const AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 = 'avg.media.compiled-visual-requirements'
export function avgVisualProposalArtifactKeyV4(kind: AvgVisualDesignKindV1 | null, subjectKey?: string): string {
  return avgKey(kind === null ? 'avg.proposal.visual-bible' : `avg.proposal.${kind}-brief.${avgKey(subjectKey, 'subjectKey')}`, 'proposal artifactKey')
}

/** Fixed topology before any model output. Receiving a raw proposal is a
 * separate task from adopting the canonical professional artifact. */
export function buildAvgVisualPlanningPlanV4(input: {
  brief: Pick<ProductProductionBriefV3, 'capabilityRequirements'> & { avgVisualPlanning: AvgVisualPlanningBriefV4 }
  briefHash: string; buildNumber: number; controlEpoch: number
}): ProductProductionPlanV3 {
  const v = parseAvgVisualPlanningBriefV4(input.brief.avgVisualPlanning), image = input.brief.capabilityRequirements.filter(c => c.requirementKey === 'avg.media.image')
  const text = input.brief.capabilityRequirements.filter(c => c.requirementKey === AVG_VISUAL_TEXT_CAPABILITY_V4)
  if (image.length !== 1 || text.length !== 1 || input.brief.capabilityRequirements.length !== 2
    || text[0].mediaClass !== 'text' || !text[0].required) throw new Error('[avg-visual-plan] 必须冻结准确图片和专业文本能力')
  // Reuse the existing consumer/review/stage topology only. These inert words
  // are never serialized as V4 requests or sent to a provider. The V4 executor
  // must read the adopted, receipt-bound compilation artifact instead.
  const mediaBatch = { schema: 'storyforge.avg.visual-production-batch' as const, version: 1 as const,
    batchKey: v.scope.batchKey, revision: v.scope.revision, aspectRatio: v.scope.aspectRatio, sourceInputHash: v.scope.sourceInputHash,
    visualReviewPolicy: 'author-visual-v1' as const,
    requirements: v.scope.templates.map(t => ({ ...t.parameters, prompt: 'Topology validation only', negativePrompt: '',
      invariants: [...new Set(t.requiredDetails)], forbiddenDepictions: [...new Set(t.forbiddenDepictions)],
      references: t.requiredReferenceKeys.map(key => v.scope.referenceCatalog.find(r => r.referenceKey === key)!.reference) })) }
  const base = buildAvgMediaAssemblyPlanV2({ ...input, brief: { capabilityRequirements: image,
    avgAssembly: { ...v.assembly, version: 2, mediaBatch, imageBinding: v.imageBinding } } })
  const sourceTasks = base.tasks.filter(t => ['avg-author-rules', 'avg-author-script'].includes(t.kind))
  const sourceKeys = sourceTasks.flatMap(t => t.outputArtifactKeys), sourceTaskKeys = sourceTasks.map(t => t.taskKey)
  const template = sourceTasks[0]!, additions: ProductProductionPlanTaskV3[] = []
  const addDirection = (kind: AvgVisualDesignKindV1 | null, subjectKey?: string) => {
    const role = avgVisualPlanningRoleV1(kind), proposal = avgVisualProposalArtifactKeyV4(kind, subjectKey)
    const canonical = kind === null ? 'avg.media.visual-bible' : avgMediaBriefArtifactKeyV1(kind, subjectKey!)
    const modelTask = kind === null ? 'avg.visual.propose.direction' : avgKey(`avg.visual.propose.${kind}.${subjectKey}`, 'proposal task')
    const authorTask = kind === null ? 'avg.author.visual-bible' : avgKey(`avg.author.${kind}-brief.${subjectKey}`, 'author task')
    const parents = [...sourceTaskKeys, ...(kind === null ? [] : ['avg.author.visual-bible'])]
    const inputs = [...sourceKeys, ...(kind === null ? [] : ['avg.media.visual-bible'])]
    additions.push({ ...structuredClone(template), taskKey: modelTask, kind: kind === null ? 'avg-v4-visual-direction-proposal' : 'avg-v4-subject-visual-proposal',
      lane: 'visual', executionMode: 'model', skillId: role.skillId, outputArtifactKeys: [proposal], inputArtifactKeys: inputs,
      dependsOn: parents, requiredReceipts: parents.map(taskKey => ({ taskKey, receiptHash: null })),
      capabilityRequirementKeys: [AVG_VISUAL_TEXT_CAPABILITY_V4], concurrencyGroup: 'avg-visual-planning', subjectLockKeys: [canonical],
      maxAttempts: 1, timeoutMs: 360_000, acceptanceGateIds: [`${proposal}.received`],
      budgetReservation: { modelCalls: 1, inputTokens: 24_000, outputTokens: role.outputTokens, mediaCalls: 0,
        maximumCostUsd: text[0].maximumRequestCost, durationMs: 360_000, storageBytes: 4 * 1024 * 1024 } })
    const authorParents = [...parents, modelTask]
    additions.push({ ...structuredClone(template), taskKey: authorTask, kind: kind === null ? 'avg-author-visual-bible' : 'avg-author-media-brief',
      lane: 'visual', outputArtifactKeys: [canonical], inputArtifactKeys: [...inputs, proposal], dependsOn: authorParents,
      requiredReceipts: authorParents.map(taskKey => ({ taskKey, receiptHash: null })), subjectLockKeys: [canonical], acceptanceGateIds: [`${canonical}.confirmed`] })
    return { canonical, authorTask }
  }
  const adopted = [addDirection(null)]
  const subjects = new Map(v.scope.templates.map(t => [t.parameters.family.subjectKey, t.subjectKind]))
  for (const [subject, kind] of subjects) adopted.push(addDirection(kind, subject))
  const compileTask = 'avg.visual.compile.requirements', compileInputs = [...sourceKeys, ...adopted.map(a => a.canonical)]
  const compileParents = [...sourceTaskKeys, ...adopted.map(a => a.authorTask)]
  additions.push({ ...structuredClone(template), taskKey: compileTask, kind: 'avg-v4-visual-requirements-compile', lane: 'visual', executionMode: 'deterministic', contextProfile: 'avg-visual-planning-v4',
    inputArtifactKeys: compileInputs, outputArtifactKeys: [AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4], dependsOn: compileParents,
    requiredReceipts: compileParents.map(taskKey => ({ taskKey, receiptHash: null })), subjectLockKeys: [AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4],
    acceptanceGateIds: ['avg.visual.requirements.compiled'], budgetReservation: { modelCalls: 0, inputTokens: 24_000, outputTokens: 0, mediaCalls: 0,
      maximumCostUsd: 0, durationMs: 60_000, storageBytes: 4 * 1024 * 1024 } })
  const tasks = base.tasks.map(task => task.taskKey === base.terminalTaskKey ? { ...task,
    acceptanceGateIds: [...task.acceptanceGateIds, 'avg.visual.requirements.compiled', ...adopted.map(a => `${a.canonical}.confirmed`)] }
    : task.kind === 'avg-media-image-generate' ? { ...task,
    inputArtifactKeys: [...task.inputArtifactKeys, AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4],
    dependsOn: [...task.dependsOn, compileTask], requiredReceipts: [...task.requiredReceipts, { taskKey: compileTask, receiptHash: null }] } : task)
  const firstImage = tasks.findIndex(t => t.kind === 'avg-media-image-generate')
  tasks.splice(firstImage, 0, ...additions)
  if (tasks.length > 100) throw new Error('[avg-visual-plan] 方案候选、作者采用、消费和终态超出共享任务上界')
  return { ...base, tasks }
}
