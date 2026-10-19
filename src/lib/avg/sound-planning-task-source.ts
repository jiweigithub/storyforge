import type { ProductProductionBriefV3 } from '../types'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { db } from '../db/schema'
import { assertRecordInScope } from '../workspace/scope'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertAvgTaskHarnessClaimV1, hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { AVG_SOUND_CONTEXT_V1 } from './sound-production-brief'

export async function readAvgSoundPlanningExecutionSourcesV1(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3) {
  const planning = brief.avgSoundPlanning, build = await db.productBuilds.get(input.buildId)
  if (!planning || !build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' }) || build.status !== 'building'
    || build.productionId !== input.productionId || build.buildNumber !== input.buildNumber || build.controlEpoch !== input.controlEpoch
    || build.planHash !== input.planHash || build.briefHash !== await hashProductProductionValueV2(brief)) throw new Error('[avg-sound-plan] 执行来源或完整Brief已stale')
  const claim = await assertAvgTaskHarnessClaimV1(input, build.budgetLedgerJson)
  if (claim.child.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1(input)) throw new Error('[avg-sound-plan] 本次路由不是实际Harness claim')
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
    productProductionId: input.productionId, productBuildId: input.buildId, productProductionTaskKey: input.task.taskKey,
    productArtifactKeys: input.task.inputArtifactKeys, sourceKeys: [AVG_SOUND_CONTEXT_V1],
    inputBudgetTokens: input.task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  if (assembled.text !== input.contextText || assembled.overBudgetAfterTrim || assembled.segments.length !== 1
    || canonicalProductProductionJsonV2(assembled.included) !== canonicalProductProductionJsonV2([AVG_SOUND_CONTEXT_V1])
    || !assembled.sourceEvidence?.length || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) throw new Error('[avg-sound-plan] 实际上下文不是完整登记投影')
  const packet = JSON.parse(assembled.segments[0].content) as { artifacts: Array<{ artifactKey: string; version: number; contentHash: string }> }
  const supplied = input.inputArtifacts.map(r => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash }))
  const refs = input.task.inputArtifactKeys.map(key => supplied.find(r => r.artifactKey === key))
  if (supplied.length !== refs.length || new Set(supplied.map(r => r.artifactKey)).size !== refs.length || refs.some(r => !r)
    || canonicalProductProductionJsonV2(packet.artifacts) !== canonicalProductProductionJsonV2(refs)) throw new Error('[avg-sound-plan] Harness准确依赖与作者来源不一致')
  for (const row of input.inputArtifacts) if (await hashProductProductionValueV2(JSON.parse(row.payloadJson)) !== row.contentHash) throw new Error('[avg-sound-plan] 依赖字节已损坏')
  return { ...claim, planning, build, refs, packet }
}
