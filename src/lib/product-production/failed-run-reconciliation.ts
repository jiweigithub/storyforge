import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildRecordV1, ProductProductionRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1, appendAgentRunEventWithSettlementInTransactionV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { assertProductProductionRecoveryControlChainV1 } from './context'
import { parseProductProductionPlanV3 } from './plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from './hash'
import { assertProductProductionBudgetLedgerV1 } from './scheduler'

/** Verify outside the command transaction, as with existing paused recovery
 * preparation. Commit rechecks every Run/event/control witness under the same
 * write lock as Resume; no provider request or database repair occurs here. */
export async function preparePausedProductTaskFailureV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
  build: ProductBuildRecordV1
  failure: Record<string, unknown>
}) {
  const { scope, production, build, failure } = input
  const invalid = (detail: string): never => { throw new Error(`暂停失败 Run 终态核对失败：${detail}`) }
  const provenance = failure.failureProvenance
  if (provenance == null) return null // Unverified legacy failures gain no new authority.
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return invalid('来源格式')
  const { runId, rootRunId, controlEpoch, planHash, attempt } = provenance as Record<string, unknown>
  const taskKey = failure.taskKey
  if (typeof taskKey !== 'string' || typeof failure.code !== 'string'
    || typeof runId !== 'number' || !Number.isSafeInteger(runId) || runId < 1
    || typeof rootRunId !== 'number' || !Number.isSafeInteger(rootRunId) || rootRunId < 1
    || typeof controlEpoch !== 'number' || !Number.isSafeInteger(controlEpoch) || controlEpoch < 0
    || typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1
    || typeof planHash !== 'string' || !/^[a-f0-9]{64}$/.test(planHash)) return invalid('来源身份')
  const row = await db.agentRuns.get(runId)
  if (row?.status === 'failed') return null // Already terminal: preserve historical bytes.
  if (production.productType !== 'text-open-world' || production.status !== 'paused'
    || production.id !== build.productionId || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || build.status !== 'paused'
    || build.resumeState !== 'recovery-required' || build.releasedProductReleaseId != null
    || build.rootTerminalReceiptHash != null
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) return invalid('当前暂停 Build')
  const plan = parseProductProductionPlanV3(build.planJson)
  if (plan.productType !== production.productType || plan.buildNumber !== build.buildNumber
    || plan.controlEpoch !== controlEpoch || build.planHash !== planHash
    || await hashProductProductionValueV2(plan) !== planHash
    || !plan.tasks.some(task => task.taskKey === taskKey && task.executionMode === 'model'
      && task.failurePolicy === 'pause')) return invalid('冻结 Plan')
  const controls = await successfulControlReceipts(build.productionId, controlEpoch, build.controlEpoch)
  await assertProductProductionRecoveryControlChainV1({ scope, build, failedControlEpoch: controlEpoch,
    targetControlEpoch: build.controlEpoch, allowTrailingPause: true })
  const snapshot = await readAgentRunV1(scope, runId)
  const boundary = snapshot.contract.scope.productProduction
  const root = await readAgentRunV1(scope, rootRunId)
  const rootBoundary = root.contract.scope.productProduction
  if (snapshot.run.status !== 'running' || snapshot.run.productBuildId !== build.id
    || snapshot.run.parentRunId !== rootRunId || snapshot.run.parentRelation !== `task:${taskKey}`
    || !boundary || boundary.productBuildId !== build.id || boundary.buildNumber !== build.buildNumber
    || boundary.controlEpoch !== controlEpoch || boundary.planHash !== planHash || boundary.taskKey !== taskKey
    || root.run.productBuildId !== build.id || root.run.parentRunId != null
    || !rootBoundary || rootBoundary.productBuildId !== build.id || rootBoundary.buildNumber !== build.buildNumber
    || rootBoundary.controlEpoch !== controlEpoch || rootBoundary.planHash !== planHash
    || rootBoundary.taskKey !== '$root') return invalid('Run 与根 Run')
  const step = snapshot.projection.steps[taskKey]
  const last = snapshot.events[snapshot.events.length - 1]
  if (step?.status !== 'failed' || step.attempt !== attempt || step.failureCode !== failure.code
    || step.candidateHash || step.outputHash || step.adoptionHash
    || snapshot.events.some(event => ['model.responded', 'candidate.persisted', 'candidate.revised'].includes(event.type)
      && 'stepId' in event.payload && event.payload.stepId === taskKey
      && 'attempt' in event.payload && event.payload.attempt === attempt)
    || last?.type !== 'step.failed' || last.payload.stepId !== taskKey || last.payload.attempt !== attempt
    || last.payload.code !== failure.code || last.payload.retryable !== false
    || Object.values(snapshot.projection.steps).some(row => ['scheduled', 'running', 'awaiting_confirmation'].includes(row.status))) {
    return invalid('缺少唯一已持久化失败边界，或仍有活动/候选')
  }
  return { snapshot, root, taskKey, runId, rootRunId, controlEpoch, attempt, code: failure.code,
    controls }
}

export type PreparedPausedProductTaskFailureV1 = Awaited<ReturnType<typeof preparePausedProductTaskFailureV1>>

async function successfulControlReceipts(productionId: number, failedEpoch: number, pausedEpoch: number) {
  const rows = await db.productProductionCommands.where('productionId').equals(productionId).toArray()
  return rows.filter(row => {
    if (row.status !== 'succeeded') return false
    const result = JSON.parse(row.resultJson) as { controlEpoch?: number }
    return typeof result.controlEpoch === 'number' && result.controlEpoch > failedEpoch && result.controlEpoch <= pausedEpoch
  })
}

async function assertRunUnchanged(snapshot: AgentRunSnapshotV1): Promise<void> {
  const row = await db.agentRuns.get(snapshot.run.id)
  const events = await db.agentRunEvents.where('runId').equals(snapshot.run.id).sortBy('sequence')
  const parsed = events.map(event => parseAgentRunEventV1({ version: 1, runId: event.runId,
    sequence: event.sequence, generation: event.generation, projectId: event.projectId,
    worldGroupId: event.worldGroupId ?? null, contractHash: event.contractHash, type: event.type,
    createdAt: event.createdAt, payload: JSON.parse(event.payloadJson) }))
  if (!row || canonicalProductProductionJsonV2(row) !== canonicalProductProductionJsonV2(snapshot.run)
    || canonicalProductProductionJsonV2(parsed) !== canonicalProductProductionJsonV2(snapshot.events)) {
    throw new Error('暂停失败 Run 终态核对失败：Run 或事件在验真后变化')
  }
}

/** Formal Resume only. The existing transaction commits the terminal event,
 * mandatory memory settlement, unchanged accounting resolution and command
 * receipt together. An interrupted attempt never becomes measured usage. */
export async function reconcilePausedProductTaskFailureV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1
  prepared: PreparedPausedProductTaskFailureV1
  budgetLedgerJson: string
  now: number
}) {
  const { scope, build, prepared } = input
  if (!prepared) return null
  const { snapshot, root, taskKey, runId, rootRunId, controlEpoch, attempt, code } = prepared
  const transaction = Dexie.currentTransaction
  if (!transaction || transaction.mode !== 'readwrite') throw new Error('失败终态补记必须在恢复事务内')
  await assertRunUnchanged(snapshot)
  await assertRunUnchanged(root)
  const controls = await successfulControlReceipts(build.productionId, controlEpoch, build.controlEpoch)
  if (canonicalProductProductionJsonV2(controls) !== canonicalProductProductionJsonV2(prepared.controls)) {
    throw new Error('暂停失败 Run 终态核对失败：暂停/恢复命令链在验真后变化')
  }
  assertProductProductionBudgetLedgerV1(input.budgetLedgerJson)
  const ledger = JSON.parse(input.budgetLedgerJson) as { version: number; rootRunId: number | null;
    tasks: Record<string, { status: string }>; attempts?: Array<{ taskKey: string; runId: number;
      attempt: number; controlEpoch: number; outcome: string; usageKnown: boolean; errorCode: string | null }> }
  const charge = ledger.attempts?.find(row => row.runId === runId && row.attempt === attempt)
  if (ledger.version !== 2 || ledger.rootRunId !== rootRunId || !charge
    || charge.taskKey !== taskKey || charge.controlEpoch !== controlEpoch || charge.outcome !== 'failed'
    || charge.errorCode !== code || !charge.usageKnown
    || Object.values(ledger.tasks).some(row => row.status === 'claimed')) {
    throw new Error('暂停失败 Run 终态核对失败：失败账本尚未完整封账')
  }
  if (Dexie.currentTransaction !== transaction || !transaction.active) throw new Error('恢复事务不再活动，未补记终态')
  // Use the existing transaction-aware Harness writer, not a separate Run
  // mutex which might be waiting on this transaction from an older writer.
  // The Harness settles through native crypto promises. Wrap its continuation
  // in Dexie's Promise so subsequent Resume writes keep the caller transaction.
  const terminal = await Dexie.Promise.resolve(appendAgentRunEventWithSettlementInTransactionV1({ scope, snapshot,
    event: parseAgentRunEventV1({ version: 1, runId, sequence: snapshot.projection.lastSequence + 1,
      generation: snapshot.projection.generation, projectId: snapshot.run.projectId,
      worldGroupId: snapshot.run.worldGroupId ?? null, contractHash: snapshot.run.contractHash,
      type: 'run.failed', createdAt: input.now, payload: { code, retryable: false } }) }))
  if (Dexie.currentTransaction !== transaction || !transaction.active) {
    transaction.abort()
    throw new Error('恢复事务在终态补记后失效，已回滚')
  }
  return { runId, taskKey, controlEpoch, attempt, terminalSequence: terminal.projection.lastSequence,
    source: 'persisted-step-failure', previousLastSequence: snapshot.projection.lastSequence }
}
