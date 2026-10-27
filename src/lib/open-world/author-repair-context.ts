import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { preserveProductProductionContextV1, validateProductProductionRecoveryDirectiveV1, type ValidatedProductProductionRecoveryDirectiveV1 } from '../product-production/context'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { readProductProductionRecoveryTaskKeyV1 } from '../product-production/recovery-policy'
import type { WorkspaceScope } from '../types'
function recoveryWitness(value: ValidatedProductProductionRecoveryDirectiveV1): string {
  const run = value.snapshot?.run
  return canonicalProductProductionJsonV2({
    previousFailure: value.previousFailure, resolution: value.resolution,
    resolvedDirective: value.resolvedDirective, failedAttempt: value.failedAttempt,
    recoveredFailureProvenance: value.recoveredFailureProvenance ?? false,
    run: run ? { id: run.id, contractHash: run.contractHash, lastSequence: run.lastSequence,
      projectionHash: run.projectionHash, status: run.status } : null,
  })
}

export type TextOpenWorldAuthorRepairTaskV1 = 'p8f.quest-finalize' | 'p8.catalog.items-rewards'
  | 'p8.catalog.crafting-economy' | 'p8.catalog.npc-runtime' | 'p9.scene-scripts'
const REPAIR_TASKS = {
  'p9.scene-scripts': { skillId: 'text-open-world.production.scene-scripts.v1', sourceKey: 'text-open-world.scene-scripts-input' },
  'p8.catalog.crafting-economy': { skillId: 'text-open-world.production.crafting-economy-catalog.v1', sourceKey: 'text-open-world.crafting-economy-input' },
  'p8.catalog.npc-runtime': { skillId: 'text-open-world.production.npc-runtime-catalog.v1', sourceKey: 'text-open-world.npc-runtime-input' },
  'p8f.quest-finalize': { skillId: 'text-open-world.production.quest-finalize.v1', sourceKey: 'text-open-world.quest-finalize-input' },
  'p8.catalog.items-rewards': { skillId: 'text-open-world.production.item-reward-catalog.v1', sourceKey: 'text-open-world.item-reward-catalog-input' },
} as const

/** Read-only author recovery. Uses the registered source, never a database
 * export or a second candidate generator, and never starts a model request. */
export async function readTextOpenWorldAuthorRepairPageV1<T extends object>(input: {
  scope: WorkspaceScope
  productionId: number
  expectedBuildId: number
  expectedControlEpoch: number
  taskKey: TextOpenWorldAuthorRepairTaskV1
}, project: (contextText: string) => Promise<T>) {
  const route = Object.prototype.hasOwnProperty.call(REPAIR_TASKS, input.taskKey) ? REPAIR_TASKS[input.taskKey] : null
  if (!route) throw new Error('此任务没有登记修订候选入口')
  const scope = await resolveScope({ scope: input.scope })
  const [production, build] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.expectedBuildId),
  ])
  if (!production || !build || production.productType !== 'text-open-world'
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || build.productionId !== production.id || build.buildNumber !== production.currentBuildNumber
    || build.controlEpoch !== input.expectedControlEpoch || build.status !== 'recovery-required'
    || production.status !== 'producing' || production.controlEpoch !== build.controlEpoch
    || build.releasedProductReleaseId != null || build.rootTerminalReceiptHash != null
    || readProductProductionRecoveryTaskKeyV1(build.failureJson) !== input.taskKey) throw new Error('修订候选不属于当前受阻的制作版本')
  const plan = parseProductProductionPlanV3(build.planJson)
  if (plan.productType !== production.productType || plan.buildNumber !== build.buildNumber
    || plan.controlEpoch > build.controlEpoch || await hashProductProductionValueV2(plan) !== build.planHash) {
    throw new Error('修订候选的 Build Plan 身份不闭合')
  }
  const task = plan.tasks.find(row => row.taskKey === input.taskKey)
  if (!task || task.skillId !== route.skillId
    || task.executionMode !== 'model') throw new Error('当前计划没有登记的修订岗位')
  // A formal pause/resume keeps the original failed Plan until the explicit
  // repair command. Prove that exact Run/Plan and every intervening control
  // receipt; accepting an arbitrary older Plan would authorize stale sources.
  const recoveryInput = { scope, productProductionId: production.id!, productBuildId: build.id!,
    productProductionTaskKey: task.taskKey, expectedState: 'blocked' as const, requestedAction: 'author-edit' as const }
  const recovery = await validateProductProductionRecoveryDirectiveV1(recoveryInput)
  const boundary = recovery.snapshot?.contract.scope.productProduction
  if (!boundary || boundary.controlEpoch !== plan.controlEpoch || boundary.planHash !== build.planHash
    || boundary.productBuildId !== build.id || boundary.buildNumber !== build.buildNumber) {
    throw new Error('修订候选缺少原失败 Run 与冻结 Plan 的完整来源')
  }
  const assembled = await assembleContext({
    scope, projectId: scope.projectId, productProductionId: production.id,
    productBuildId: build.id, productProductionTaskKey: task.taskKey,
    productArtifactKeys: task.inputArtifactKeys,
    sourceKeys: [route.sourceKey],
    inputBudgetTokens: task.budgetReservation.inputTokens,
    sourceTransformer: preserveProductProductionContextV1,
  })
  if (assembled.overBudgetAfterTrim || assembled.sourceEvidence?.length !== 1
    || assembled.sourceEvidence[0]?.status !== 'included' || assembled.sourceEvidence[0]?.delivery !== 'full') {
    throw new Error('修订候选输入不完整，未调用模型')
  }
  const page = await project(assembled.text)
  const [latestProduction, latestBuild] = await Promise.all([
    db.productProductions.get(production.id!), db.productBuilds.get(build.id!),
  ])
  if (latestProduction?.stateRevision !== production.stateRevision
    || latestProduction.currentBuildNumber !== production.currentBuildNumber
    || latestBuild?.controlEpoch !== build.controlEpoch || latestBuild.status !== build.status
    || latestBuild.planHash !== build.planHash || latestBuild.failureJson !== build.failureJson
    || latestProduction.status !== production.status) throw new Error('读取期间制作状态已变化，请重新读取候选')
  const tailRecovery = await validateProductProductionRecoveryDirectiveV1(recoveryInput)
  if (recoveryWitness(tailRecovery) !== recoveryWitness(recovery)) {
    throw new Error('读取期间修复来源已变化，请重新读取候选')
  }
  return { buildId: build.id!, controlEpoch: build.controlEpoch, ...page }
}
