/** Isolated governed production with a genuine downstream parser failure.
 * All three model outputs below are fixtures; no provider or author data. */
import { db } from '../../src/lib/db/schema'
import { openProductionFixtureV1 } from './open-ttrpg-production'
import { openProductionCompilerFixtureV1 } from './open-ttrpg-production-artifacts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'

export async function openContentRevisionFixtureV1() {
  const f = await openProductionFixtureV1(), { brief, scope, productionId } = f
  Object.assign(brief.productionBudget, { maximumModelCalls: 16, maximumInputTokens: 384000,
    maximumOutputTokens: 120000, maximumDurationMs: 3600000, maximumMediaCalls: 0 })
  const data = await openProductionCompilerFixtureV1(true, { brief, scope, productionId })
  const visual = data.situationLayer.metadata.visualBible as { characters: unknown[] }
  visual.characters = [{ characterKey: data.ruleSystem.characterTemplates[0].characterKey,
    identityPrompt: '虚构港口调查者', silhouette: '修长', attire: '风衣', markers: [], colorPalette: ['灰蓝'],
    expressionBaselines: [], referenceAssetKeys: [] }]
  let p = (await db.productProductions.get(productionId))!
  const command = (value: unknown) => executeProductProductionCommand({ scope, productionId, command: value })
  const saved = await command({ type: 'save-brief-revision', commandId: 'content-revision.fixture.save',
    expectedStateRevision: p.stateRevision, parentRevision: p.currentBriefRevision, brief })
  if (!saved.ok) throw Error(JSON.stringify(saved))
  p = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, p.currentBriefRevision!]).first())!
  const start = await command({ type: 'authorize-start', commandId: 'content-revision.fixture.start',
    expectedStateRevision: p.stateRevision, briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit-fixture-author' })
  if (!start.ok) throw Error(JSON.stringify(start))
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const calls: string[] = []
  const runText: ProductionTextRunnerV1 = async request => {
    const key = request.system.includes('storyforge.ttrpg-open-source-facts') ? 'ttrpg.open.source-facts'
      : request.system.includes('storyforge.ttrpg-open-rule-system') ? 'ttrpg.open.rule-system' : 'ttrpg.open.situation-layer'
    calls.push(key)
    return { output: JSON.stringify(key === 'ttrpg.open.source-facts' ? data.sourceFacts
      : key === 'ttrpg.open.rule-system' ? data.ruleSystem : data.situationLayer),
      usage: { inputTokens: 100, outputTokens: 200 }, bindingReceipt: {
        schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey,
        adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-only',
        endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
        credentialPresent: true, capabilityHash: 'a'.repeat(64), boundAt: 1, receiptHash: 'a'.repeat(64) } }
  }
  const run = async () => runProductProductionUntilBlockedV1({ scope, productionId,
    capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: 'a'.repeat(64) }],
    executor: createConfiguredProductProductionExecutorV1({ brief, production: (await db.productProductions.get(productionId))!, runText }) })
  const review = async (key: string, suffix: string) => {
    const current = (await db.productProductions.get(productionId))!
    const result = await command({ type: 'resolve-blocker', commandId: 'content-revision.fixture.review.' + suffix,
      expectedStateRevision: current.stateRevision, blockerKey: key, resolution: { action: 'author-edit',
        note: '测试作者逐项确认实际来源与属性', authorDraftJson: JSON.stringify(key === 'ttrpg.open.source-facts' ? data.sourceFacts : data.ruleSystem) } })
    if (!result.ok) throw Error(JSON.stringify(result))
  }
  for (const key of ['ttrpg.open.source-facts', 'ttrpg.open.rule-system']) {
    const stopped = await run(), build = (await db.productBuilds.get(stopped.buildId))!
    if (JSON.parse(build.failureJson).taskKey !== key) throw Error(build.failureJson)
    await review(key, key)
  }
  const stopped = await run(), build = (await db.productBuilds.get(stopped.buildId))!
  if (JSON.parse(build.failureJson).taskKey !== 'ttrpg.open.media-plan') throw Error(build.failureJson)
  p = (await db.productProductions.get(productionId))!
  const paused = await command({ type: 'pause', commandId: 'content-revision.fixture.pause',
    expectedStateRevision: p.stateRevision, reason: '明确暂停后修订上游原稿' })
  if (!paused.ok) throw Error(JSON.stringify(paused))
  return { ...f, data, calls, run, review, command, buildId: build.id! }
}
