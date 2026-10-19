import { db } from '../db/schema'
import type { AssembleContextInput } from '../registry/types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgConfirmedSoundPlanV1, readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import type { AvgMediaSourceInputV1 } from './media-source'
import { validateAvgSoundPlanningSourcesV1 } from './sound-source'
import { parseAvgSoundPlanningBriefV1 } from './sound-production-brief'
import { AVG_SOUND_COMPILED_KEY_V1, AVG_SOUND_PROPOSAL_KEY_V1 } from './sound-production-plan'

/** The complete canonical rules/scripts are used only to verify freshness.
 * Default model input contains the explicitly declared sound purposes and
 * catalogue, never whole dialogue, rules/secrets, binary media or local paths. */
export async function projectAvgSoundPlanningInputsV1(declaration: unknown, source: AvgMediaSourceInputV1) {
  const sound = parseAvgSoundPlanningBriefV1(declaration)
  if (source.presentation.aspectRatio !== sound.aspectRatio) throw new Error('[avg-sound-context] 画幅不属于准确冻结声音来源')
  const scope = await validateAvgSoundPlanningSourcesV1(sound.scope, source)
  return { schema: 'storyforge.avg.sound-planning-inputs' as const, version: 1 as const,
    sourceInputHash: scope.sourceInputHash, scopeHash: await hashProductProductionValueV2(scope),
    requirements: scope.templates.map(t => ({ requirementKey: t.requirementKey, channel: t.channel,
      purpose: t.purpose, constraints: t.constraints, cue: t.cue, source: t.source })),
    librarySources: scope.librarySources.map(s => ({ ...s, observation: 'metadata-only; original audio not delivered or heard' })) }
}

/** A registered Context reader, with actual frozen author/start authority.
 * This is not an alternative context assembler or caller-supplied source. */
export async function readAvgSoundPlanningContextV1(input: AssembleContextInput): Promise<string> {
  const { scope } = input
  if (!scope || input.projectId !== scope.projectId || !input.productBuildId || !input.productProductionId
    || !input.productProductionTaskKey) throw new Error('[avg-sound-context] 缺少准确Work/Build/任务')
  const build = await db.productBuilds.get(input.productBuildId), production = await db.productProductions.get(input.productProductionId)
  if (!build || !production || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' }) || build.productionId !== production.id
    || production.productType !== 'avg' || production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.currentBriefRevision !== build.briefRevision || production.controlEpoch !== build.controlEpoch || build.status !== 'building') {
    throw new Error('[avg-sound-context] 制作来源已stale或跨Work')
  }
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, build.briefRevision]).first()
  if (!row || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized'
    || row.briefHash !== build.briefHash || row.authorizedAt !== build.authorizedAt) throw new Error('[avg-sound-context] 缺少准确授权Brief')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (!brief.avgSoundPlanning || await hashProductProductionValueV2(brief) !== build.briefHash) throw new Error('[avg-sound-context] 必须保留完整原始声音Brief/hash，不能借用旧图声合同')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash), task = plan.tasks.find(t => t.taskKey === input.productProductionTaskKey)
  if (!task || await hashProductProductionValueV2(plan) !== build.planHash || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch
    || canonicalProductProductionJsonV2(input.productArtifactKeys ?? []) !== canonicalProductProductionJsonV2(task.inputArtifactKeys)) throw new Error('[avg-sound-context] 任务及准确依赖已变化')
  const proposal = task.kind === 'avg-sound-plan-propose' && task.executionMode === 'model' && task.skillId === 'avg.sound-plan.v1'
    && canonicalProductProductionJsonV2(task.outputArtifactKeys) === canonicalProductProductionJsonV2([AVG_SOUND_PROPOSAL_KEY_V1])
  const compilation = task.kind === 'avg-sound-requirements-compile' && task.executionMode === 'deterministic' && task.skillId === null
    && task.contextProfile === 'avg-sound-planning-v1' && canonicalProductProductionJsonV2(task.outputArtifactKeys) === canonicalProductProductionJsonV2([AVG_SOUND_COMPILED_KEY_V1])
  if (!proposal && !compilation) throw new Error('[avg-sound-context] 真实声音producer/演出执行投影尚未接通')
  // This existing reader checks actual start command, SourcePlan/confirmed
  // Brief, author candidates/receipts and physical source hashes in its own
  // complete snapshot. It does not inherit another Build's adoption authority.
  const source = await readAvgSystemPlanForCompilationV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, includeSceneScripts: true })
  const adopted = compilation ? await readAvgConfirmedSoundPlanV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }) : null
  const refs = [source.artifact, ...source.scripts.map(s => s.artifact), ...(adopted ? [adopted.artifact] : [])]
  if (refs.length !== task.inputArtifactKeys.length || refs.some(r => !task.inputArtifactKeys.includes(r.artifactKey))) throw new Error('[avg-sound-context] 已采用规则/脚本未覆盖准确任务输入')
  const projected = await projectAvgSoundPlanningInputsV1(brief.avgSoundPlanning, { systemPlan: source.plan,
    scripts: source.scripts.map(s => s.payload), presentation: { aspectRatio: brief.avgSoundPlanning.aspectRatio } })
  const packet = adopted ? { schema: projected.schema, version: projected.version, sourceInputHash: projected.sourceInputHash,
    scopeHash: projected.scopeHash, operation: 'compile-adopted-sound-requirements', soundPlan: adopted.payload } : projected
  const current = await db.productBuilds.get(build.id!), owner = await db.productProductions.get(production.id!)
  if (!current || !owner || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
    || current.planHash !== build.planHash || current.briefHash !== build.briefHash || current.status !== build.status
    || owner.status !== production.status || owner.controlEpoch !== production.controlEpoch || owner.currentBriefRevision !== production.currentBriefRevision
    || owner.currentBuildNumber !== production.currentBuildNumber) throw new Error('[avg-sound-context] 读取期间制作状态已变化')
  return canonicalProductProductionJsonV2({ ...packet, taskKey: task.taskKey, productionKey: production.productionKey,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash, briefHash: build.briefHash,
    briefRevision: row.revision, sourcePlanHash: row.sourcePlanHash, confirmedBriefHash: row.confirmedBriefHash,
    sourceWorldContentHash: row.sourceWorldContentHash,
    artifacts: task.inputArtifactKeys.map(key => refs.find(r => r.artifactKey === key)!), taskBudget: task.budgetReservation })
}
