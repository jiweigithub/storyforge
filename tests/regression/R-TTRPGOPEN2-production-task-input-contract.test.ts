import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { runProductProductionUntilBlockedV1, ProductProductionResultUnknownErrorV1 } from '../../src/lib/product-production/scheduler'
/** Registered task views only; no new default Plan, provider or author acceptance. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openProductionFixtureV1 } from '../helpers/open-ttrpg-production'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { projectTtrpgOpenProductionTaskBriefV1 } from '../../src/lib/ttrpg/open-production-task-brief'
import { ttrpgOpenProductionSystemPromptV3 } from '../../src/lib/ttrpg/open-production-prompts'
import { TTRPG_OPEN_PRODUCTION_BINDINGS_V3 } from '../../src/lib/ttrpg/open-production-bindings'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())
const fixture = openProductionFixtureV1

it.each(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'] as const)(
  'registered %s projection preserves required complete values and original identity without duplicating orchestration', async taskKey => {
  const data = await fixture(), briefHash = await hashProductProductionValueV2(data.brief), original = structuredClone(data.brief)
  const view = await projectTtrpgOpenProductionTaskBriefV1({ brief: data.brief, briefHash, briefRevision: 2,
    productionKey: 'fixture.profile3', taskKey })
  expect(view.original).toMatchObject({ briefHash, briefRevision: 2, worldReference: data.brief.ttrpgOpen!.worldReference,
    sourcePlanHash: data.brief.ttrpgOpen!.sourcePlan.planHash, rulePackHash: data.brief.ttrpgOpen!.rulePackHash })
  expect(view).not.toHaveProperty('sourcePlan.requirements')
  if (taskKey === 'ttrpg.open.source-facts') expect(view).toHaveProperty('confirmedFacts', data.brief.ttrpgOpen!.settings.openAuthoring.factPolicy)
  else {
    expect(view).toHaveProperty('rulePack', data.brief.ttrpgOpen!.rulePack)
    if (data.brief.ttrpgOpen!.settings.authoringSeatPlan) expect(view).toHaveProperty('settings.authoringSeatPlan', data.brief.ttrpgOpen!.settings.authoringSeatPlan)
    else expect(view).not.toHaveProperty('settings.authoringSeatPlan')
    expect(view).not.toHaveProperty('settings.openAuthoring')
  }
  if (taskKey === 'ttrpg.open.situation-layer') {
    const { factPolicy: _facts, ...authoring } = data.brief.ttrpgOpen!.settings.openAuthoring
    expect(view).toHaveProperty('authoring', authoring)
  }
  expect(data.brief).toEqual(original)
  await expect(projectTtrpgOpenProductionTaskBriefV1({ brief: data.brief, briefHash: 'f'.repeat(64), briefRevision: 2,
    productionKey: 'fixture.profile3', taskKey })).rejects.toThrow(/身份/)
})

it('registered task Skills preserve complete content reads and existing media write authority', () => {
  for (const key of ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'ttrpg.open.media-plan'] as const) {
    const descriptor = getAgentSkillV1(TTRPG_OPEN_PRODUCTION_BINDINGS_V3[key].skillId)
    expect(descriptor.contextSourceKeys).toContain('product-production.ttrpg-open-task-brief')
    expect(descriptor.contextSourceKeys).not.toContain('product-production.brief')
    expect(ttrpgOpenProductionSystemPromptV3(key)).toContain('【请求格式版本3】')
    if (key === 'ttrpg.open.media-plan') {
      expect(descriptor.contextSourceKeys).toContain('product-production.ttrpg-open-media-inputs')
      expect(descriptor.optionalContextSourceKeys).not.toContain('product-production.artifact-inputs')
      expect(descriptor.contextGateway).toBeUndefined()
      expect(descriptor.writeTargets).toEqual(getAgentSkillV1('product-production.media-requirements.v1').writeTargets)
    } else expect(descriptor.contextGateway?.providerSourceKeys).toContain('worldRelease')
  }
})

it('default source discovery never enables new views for an unrelated product or a complete retained Plan', async () => {
  const { scope, productionId, brief } = await fixture()
  const p = (await db.productProductions.get(productionId))!
  expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
    commandId: 'views.save', expectedStateRevision: p.stateRevision, parentRevision: p.currentBriefRevision, brief } })).ok).toBe(true)
  const saved = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, saved.currentBriefRevision!]).first())!
  expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
    commandId: 'views.start', expectedStateRevision: saved.stateRevision, briefRevision: row.revision,
    briefHash: row.briefHash, authorizationNonce: 'explicit.fixture.views' } })).ok).toBe(true)
  const args = { brief, briefHash: row.briefHash, buildNumber: 1, ttrpgOpenExecutionProfile: 2 as const }
  const plan = await createProductProductionPlanV3(args)
  let calls = 0
  const result = await runProductProductionUntilBlockedV1({ scope, productionId, suppliedPlan: plan,
    executor: async () => { calls++; throw new ProductProductionResultUnknownErrorV1() },
    capabilityBindings: [{ requirementKey: brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey,
      adapterId: 'configured-text.v1', bindingHash: 'a'.repeat(64) }] })
  expect(calls).toBe(1)
  const build = (await db.productBuilds.get(result.buildId))!
  expect(build.planRevision).toBeGreaterThan(0)
  const original = JSON.stringify(build)
  const input = { projectId: scope.projectId, scope, productProductionId: productionId, productBuildId: build.id! }
  for (const key of ['product-production.ttrpg-open-task-brief', 'product-production.ttrpg-open-media-inputs']) {
    const source = CONTEXT_SOURCE_BY_KEY.get(key)!
    for (const taskKey of ['content.design', 'media.visual', 'ttrpg.open.source-facts', 'ttrpg.open.media-plan']) {
      expect(await source.enabled!({ ...input, productProductionTaskKey: taskKey })).toBe(false)
    }
    expect(await source.enabled!({ projectId: scope.projectId })).toBe(false)
  }
  expect(JSON.stringify(await db.productBuilds.get(build.id!))).toBe(original)
}, 30000)
