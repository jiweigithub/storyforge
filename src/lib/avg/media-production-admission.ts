import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { productProductionTaskExecutionIdentityHashV1 } from '../product-production/scheduler'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { assertAvgMediaConsumerDeclarationsV1, validateAvgVisualProductionBatchSourceV1 } from './media-source'
import { assertAvgVisualProductionPolicyV2 } from './media-production-policy'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { avgHash } from './protocol-validation'

/** Extra product admission inside the shared sealed-producer transaction.
 * The caller separately verifies exact checkpoint/result/Plan/Blob proof. */
export async function assertAvgMediaRawProducerAdmissionV2(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  task: ProductProductionPlanTaskV3
  producerRunId: number
  artifact: Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'qualityJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize'>
}) {
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId, input.build.briefRevision]).first()
  if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized'
    || row.briefHash !== input.build.briefHash) throw new Error('[avg-media] 原图接收缺少准确的已授权 Brief')
  const brief = parseProductProductionBriefV3(row.briefJson)
  assertAvgVisualProductionPolicyV2(brief)
  if (await hashProductProductionValueV2(brief) !== input.build.briefHash) throw new Error('[avg-media] 原图 Brief 已 stale')
  const raw = await assertAvgRawImageArtifactV1(brief, input.artifact), r = raw.payload.requirement, task = input.task
  if (task.taskKey !== `avg.media.generate.${r.requirementKey}` || task.kind !== 'avg-media-image-generate'
    || task.executionMode !== 'media-provider' || task.skillId !== 'product-production.media-request.v1'
    || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== input.artifact.artifactKey || task.maxAttempts !== 1) {
    throw new Error('[avg-media] 原图 producer 不在准确的已登记图片任务中')
  }
  const run = await db.agentRuns.get(input.producerRunId)
  const binding = { requirementKey: brief.capabilityRequirements[0]!.requirementKey, adapterId: raw.payload.request.request.adapterId,
    bindingHash: raw.payload.capabilityBindingHash }
  const runtimeBindingHash = await hashProductProductionValueV2({ schema: 'storyforge.product-production-task-runtime', version: 1,
    executor: 'product-production-scheduler', planHash: input.build.planHash, taskKey: task.taskKey, taskKind: task.kind,
    executionMode: task.executionMode, skillId: task.skillId, executionIdentityHash: await productProductionTaskExecutionIdentityHashV1(task),
    capabilityBindingHash: await hashProductProductionValueV2([binding]) })
  if (!run || (JSON.parse(run.contractJson) as { runtimeBindingHash?: string }).runtimeBindingHash !== runtimeBindingHash) {
    throw new Error('[avg-media] 原图 receipt 与 Harness 的实际能力绑定不一致')
  }
  const source = await readAvgSystemPlanForCompilationV1({ scope: input.scope, buildId: input.build.id,
    expectedBuildRevision: input.build.stateRevision, controlEpoch: input.build.controlEpoch, includeSceneScripts: true })
  await validateAvgVisualProductionBatchSourceV1(brief.avgAssembly.mediaBatch, { systemPlan: source.plan,
    scripts: source.scripts.map(row => row.payload), presentation: { aspectRatio: brief.avgAssembly.mediaBatch.aspectRatio } })
  assertAvgMediaConsumerDeclarationsV1(brief.avgAssembly.mediaBatch, source.plan)
  const quality = JSON.parse(input.artifact.qualityJson) as Record<string, unknown>
  const evidenceHash = avgHash(quality.responseEvidenceHash, 'responseEvidenceHash')
  if (quality.received !== true || quality.rawResponseRecorded !== true || quality.headerVerified !== true || quality.contentHashVerified !== true || quality.decoderVerified !== false
    || canonicalProductProductionJsonV2(quality.sourceRule) !== canonicalProductProductionJsonV2(source.artifact)
    || canonicalProductProductionJsonV2(quality.sourceScripts) !== canonicalProductProductionJsonV2(source.scripts.map(row => row.artifact))) {
    throw new Error('[avg-media] 原图接收证据不能冒充解码或替换来源')
  }
  const events = await db.agentRunEvents.where('runId').equals(input.producerRunId).toArray()
  if (!events.some(event => {
    if (event.type !== 'evidence.artifact.recorded') return false
    const p = JSON.parse(event.payloadJson) as { artifactKind?: string; contentHash?: string; stepId?: string; attempt?: number }
    return p.artifactKind === 'raw-response' && p.contentHash === evidenceHash && p.stepId === task.taskKey && p.attempt === 1
  })) throw new Error('[avg-media] 原图缺少准确图片任务的解析前回执事件')
  const evidence = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, 'raw-response', evidenceHash]).first()
  if (!evidence || evidence.retentionState !== 'available' || evidence.content === null
    || await sha256MediaData(new TextEncoder().encode(evidence.content).buffer) !== evidenceHash
    || new TextEncoder().encode(evidence.content).byteLength !== evidence.byteLength) throw new Error('[avg-media] 原始响应回执缺失或损坏')
}
