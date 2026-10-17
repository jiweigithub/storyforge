import type { ProductProductionPlanTaskV3 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { prepareAvgProfessionalArtifactV1 } from './artifact-contract'
import { avgHash, avgKey, avgProtocolBody, avgRecord } from './protocol-validation'
import { avgMediaBriefArtifactKeyV1, type AvgVisualPlanningScopeV1, type AvgVisualBibleV1, type AvgMediaBriefV1 } from './visual-planning-contract'
import { AVG_VISUAL_PLANNING_ROLES_V1 } from './visual-planning-roles'
import { avgVisualProposalArtifactKeyV4 } from './visual-planning-plan'

export interface AvgVisualRoleProposalV1 {
  schema: 'storyforge.avg.visual-role-proposal'; version: 1
  targetArtifactKey: string; scopeHash: string
  payload: AvgVisualBibleV1 | AvgMediaBriefV1
}

/** Semantic output never owns scope, route, authority, ids or acceptance. */
export function validateAvgVisualSemanticV4(value: unknown, scope: AvgVisualPlanningScopeV1, targetArtifactKey: string) {
  const payload = prepareAvgProfessionalArtifactV1({ artifactKey: targetArtifactKey, kind: 'narrative', payload: value,
    allowedOutputKeys: [targetArtifactKey] }).payload
  const subjects = new Map(scope.templates.map(t => [t.parameters.family.subjectKey, t.subjectKind]))
  if (payload.schema === 'storyforge.avg.visual-bible') {
    if (payload.subjects.length !== subjects.size || payload.subjects.some(s => subjects.get(s.subjectKey) !== s.subjectKind)) throw new Error('[avg-visual-plan] 方向必须准确覆盖冻结主体')
  } else if (payload.schema === 'storyforge.avg.media-brief') {
    if (subjects.get(payload.subjectKey) !== payload.subjectKind) throw new Error('[avg-visual-plan] 方案主体或岗位越界')
    const templates = scope.templates.filter(t => t.parameters.family.subjectKey === payload.subjectKey)
    if (payload.outputs.length !== templates.length) throw new Error('[avg-visual-plan] 方案必须覆盖本主体准确需求')
    for (const output of payload.outputs) {
      const t = templates.find(t => t.parameters.requirementKey === output.requirementKey)
      if (!t || output.referenceKeys.some(key => !t.allowedReferenceKeys.includes(key))
        || t.requiredReferenceKeys.some(key => !output.referenceKeys.includes(key))) throw new Error('[avg-visual-plan] 需求或必需/允许参考越界')
    }
  } else throw new Error('[avg-visual-plan] 只接受视觉方向或主体方案')
  return payload
}

export function avgVisualRoleTargetV4(task: ProductProductionPlanTaskV3, scope: AvgVisualPlanningScopeV1): string {
  const role = AVG_VISUAL_PLANNING_ROLES_V1.find(r => r.skillId === task.skillId)
  if (!role || task.executionMode !== 'model' || task.outputArtifactKeys.length !== 1
    || task.kind !== (role.subjectKind === null ? 'avg-v4-visual-direction-proposal' : 'avg-v4-subject-visual-proposal')) throw new Error('[avg-visual-plan] 模型任务不属于登记岗位')
  if (role.subjectKind === null && task.outputArtifactKeys[0] === avgVisualProposalArtifactKeyV4(null)) return 'avg.media.visual-bible'
  const selected = [...new Map(scope.templates.map(t => [t.parameters.family.subjectKey, t.subjectKind])).entries()]
    .filter(([key, kind]) => kind === role.subjectKind && task.outputArtifactKeys[0] === avgVisualProposalArtifactKeyV4(kind, key))
  if (selected.length !== 1) throw new Error('[avg-visual-plan] 模型任务与准确主体写域不一致')
  return avgMediaBriefArtifactKeyV1(selected[0][1], selected[0][0])
}

export async function prepareAvgVisualRoleProposalV4(output: string, task: ProductProductionPlanTaskV3, scope: AvgVisualPlanningScopeV1): Promise<AvgVisualRoleProposalV1> {
  const targetArtifactKey = avgVisualRoleTargetV4(task, scope)
  return { schema: 'storyforge.avg.visual-role-proposal', version: 1, targetArtifactKey,
    scopeHash: await hashProductProductionValueV2(scope), payload: validateAvgVisualSemanticV4(parseProductionModelJsonObjectV1(output, task.taskKey), scope, targetArtifactKey) }
}

export async function assertAvgVisualRoleProposalV4(value: unknown, task: ProductProductionPlanTaskV3, scope: AvgVisualPlanningScopeV1) {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'targetArtifactKey', 'scopeHash', 'payload'], 'visual role proposal')
  if (r.schema !== 'storyforge.avg.visual-role-proposal' || r.version !== 1 || avgKey(r.targetArtifactKey, 'proposal target') !== avgVisualRoleTargetV4(task, scope)
    || avgHash(r.scopeHash, 'scopeHash') !== await hashProductProductionValueV2(scope)) throw new Error('[avg-visual-plan] 原始方案与冻结范围/岗位不一致')
  const payload = validateAvgVisualSemanticV4(r.payload, scope, String(r.targetArtifactKey))
  if (canonicalProductProductionJsonV2(payload) !== canonicalProductProductionJsonV2(r.payload)) throw new Error('[avg-visual-plan] 原始方案不是严格语义输出')
  return { schema: r.schema, version: 1 as const, targetArtifactKey: String(r.targetArtifactKey), scopeHash: String(r.scopeHash), payload }
}
