import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { configureOpenSeatsV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1 } from '../../src/lib/ttrpg/runtime-commands'
import { previewTtrpgOpenContinuationV1, createTtrpgOpenContinuationFromPlanV1 } from '../../src/lib/ttrpg/continuity'
import { startTtrpgOpenTableV1, readTtrpgOpenTableV1, consentTtrpgOpenTableSeatV1 } from '../../src/lib/ttrpg/open-table-service'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
/** Normal production and immutable releases; initial model replies are explicit simulations. */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { beginProductProductionEvolutionV1, publishProductProductionV1 } from '../../src/lib/product-production/service'
import { readTtrpgDraft, saveTtrpgDraft, prepareTtrpgBrief, prepareTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/authoring-service'
import { settingsFromTtrpgDraft } from '../../src/lib/ttrpg/authoring-contract'
import { readTtrpgCompatibleOpeningAuthoringBaseV1, readTtrpgCompatibleOpeningReleaseV1 } from '../../src/lib/ttrpg/open-compatible-opening-source'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { assertTtrpgOpenReleaseCompatibilityV1 } from '../../src/lib/ttrpg/open-release-compatibility'
import { verifyProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { isTtrpgRuntimeContentV2 } from '../../src/lib/ttrpg/content-version'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { cloneTtrpgCompatibleOpeningTemplateV1 } from '../../src/lib/ttrpg/open-compatible-opening-contract'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readProductProductionDetailsV1, authorizeProductProductionStartV1, runAuthorizedProductProductionV1 } from '../../src/lib/product-production/service'

describe('R-TTRPGOPEN17 explicitly authored compatible new opening', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  async function pending() {
    const f = await seedOpenBrowserProductionV1({ runtimeAIEnabled: true })
    let result = await runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await runOpenBrowserProductionV1(f, true)
    expect(result.terminal).toBe(true)
    const published = await publishProductProductionV1(f)
    await beginProductProductionEvolutionV1({ ...f, userText: '保留原团局的规则和角色，追加新的续团开局。', affectedLanes: ['content', 'runtime'] })
    return { ...f, published }
  }
  async function edited(f: Awaited<ReturnType<typeof pending>>) {
    const base = await readTtrpgCompatibleOpeningAuthoringBaseV1(f), draft = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(draft)
    if (settings.runFormat !== 'open') throw Error('requires open')
    settings.openAuthoring = structuredClone(base.authoring)
    settings.openAuthoring.situationTemplates.push(cloneTtrpgCompatibleOpeningTemplateV1(base.authoring.situationTemplates[0], 'author.new-opening', '新的港口委托'))
    settings.openAuthoring.openingSituationKeys = ['author.new-opening']
    return { base, settings, draft }
  }
  async function current(f: { productionId: number }) {
    const production = (await db.productProductions.get(f.productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision!]).first())!
    return { production, row, brief: parseProductProductionBriefV3(row.briefJson) }
  }
  it('publishes an additional opening through a separate start with zero new model calls and identical original mechanics', async () => {
    const f = await pending(), edit = await edited(f), originalReleases = await db.productReleases.toArray(), originalArtifacts = await db.productBuildArtifacts.toArray()
    const draft = await saveTtrpgDraft(f.scope, edit.draft.revision, edit.settings, '追加兼容续团开局')
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/只支持调整/)
    const beforeRuns = await db.agentRuns.count()
    await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, openingRevision: 'revise-pending-compatible-opening' })
    const p = await current(f)
    expect(p.row.status).toBe('draft'); expect(p.row.authorizedAt).toBeNull()
    expect(p.brief.ttrpgOpen!.compatibleOpeningRevision!.appendedTemplateKeys).toEqual(['author.new-opening'])
    expect(await db.agentRuns.count()).toBe(beforeRuns)
    const start = await executeProductProductionCommand({ scope: f.scope, productionId: f.productionId, command: { type: 'authorize-start',
      commandId: 'opening.explicit-start', expectedStateRevision: p.production.stateRevision, briefRevision: p.row.revision,
      briefHash: p.row.briefHash, authorizationNonce: 'author.explicit-opening-start' } })
    expect(start.ok).toBe(true)
    const result = await runOpenBrowserProductionV1(f)
    const failure = (await db.productBuilds.get(result.buildId!))!.failureJson
    expect(result.terminal, failure).toBe(true)
    const build = (await db.productBuilds.get(result.buildId!))!, plan = parseProductProductionPlanV3(build.planJson)
    expect(plan.tasks.filter(t => t.taskKey.startsWith('ttrpg.open.')).every(t => t.executionMode === 'deterministic')).toBe(true)
    const attempts = JSON.parse(build.budgetLedgerJson).attempts
    expect(attempts.reduce((n: number, a: { usage: { modelCalls: number } | null }) => n + (a.usage?.modelCalls ?? 0), 0)).toBe(0)
    const published = await publishProductProductionV1(f)
    const from = await readTtrpgCompatibleOpeningReleaseV1({ ...f, productReleaseId: f.published.receipt.productReleaseId })
    const target = await verifyProductRuntimeSource({ scope: f.scope, source: { kind: 'release', productReleaseId: published.receipt.productReleaseId }, ttrpgProtocol: 2 })
    const content = target.runtimePackage.ttrpg!
    if (!isTtrpgRuntimeContentV2(content)) throw Error('requires open release')
    assertTtrpgOpenReleaseCompatibilityV1(from.content, content)
    expect(content.campaign.situationTemplates).toHaveLength(from.content.campaign.situationTemplates.length + 1)
    expect(content.campaign.openingSituationKeys).toEqual(['author.new-opening'])
    const parent = await createProductRuntimeInstanceFromSource({ scope: f.scope, source: { kind: 'release', productReleaseId: f.published.receipt.productReleaseId }, title: '原发布的工程团局', seed: 'author.compatible.seed' })
    await configureOpenSeatsV1(parent.id!)
    const initial = rt(await readProductRuntimeState(parent.id!)), selectedCharacterKeys = from.content.campaign.characterTemplates.filter(c => c.role === 'player').map(c => c.characterKey)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(parent.id!, 'author.parent.zero'), viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: initial.product.sessionZero.requiredItemKeys, selectedCharacterKeys })
    await startTtrpgOpenRunV1({ ...await openEnvelopeV1(parent.id!, 'author.parent.run'), viewerKey: OPEN_HUMAN_VIEWER })
    const parentState = await readProductRuntimeState(parent.id!)
    const preview = await previewTtrpgOpenContinuationV1({ scope: f.scope, parentSessionId: parent.id!, targetProductReleaseId: published.receipt.productReleaseId,
      transitionKey: 'author.new-opening.continue', approvedBy: OPEN_HUMAN_VIEWER, reason: '承接作者正式发布的新开局', openingTemplateKeys: content.campaign.openingSituationKeys })
    const child = await createTtrpgOpenContinuationFromPlanV1({ scope: f.scope, preview, title: '新开局承接工程团局' })
    await configureOpenSeatsV1(child.id!)
    await consentTtrpgOpenTableSeatV1({ scope: f.scope, sessionId: child.id!, viewerKey: OPEN_HUMAN_VIEWER, aiAdviceAllowed: false })
    await startTtrpgOpenTableV1({ scope: f.scope, sessionId: child.id!, viewerKey: OPEN_HUMAN_VIEWER, acceptedItemKeys: initial.product.sessionZero.requiredItemKeys })
    const view = await readTtrpgOpenTableV1({ scope: f.scope, sessionId: child.id!, viewerKey: OPEN_HUMAN_VIEWER })
    expect(view.started).toBe(true)
    expect(rt(await readProductRuntimeState(child.id!)).openRun!.situations.active.some(s => s.templateKey === 'author.new-opening')).toBe(true)
    expect(await readProductRuntimeState(parent.id!)).toEqual(parentState)

    for (const release of originalReleases) expect(await db.productReleases.get(release.id!)).toEqual(release)
    for (const artifact of originalArtifacts) expect(await db.productBuildArtifacts.get(artifact.id!)).toEqual(artifact)
    // A later ordinary budget revision remains available; this intent belongs to one frozen base.
    await beginProductProductionEvolutionV1({ ...f, userText: '为后续版本调整额度', affectedLanes: ['runtime'] })
    const laterDraft = await readTtrpgDraft(f.scope), laterSettings = settingsFromTtrpgDraft(laterDraft)
    if (laterSettings.runFormat !== 'open') throw Error('requires open')
    laterSettings.openAuthoring.runtimePolicy!.maximumEpochCostUsd += 0.01
    const later = await saveTtrpgDraft(f.scope, laterDraft.revision, laterSettings, '调整下一版额度')
    await prepareTtrpgBrief(f.scope, later.revision)
    expect((await current(f)).brief.ttrpgOpen!.compatibleOpeningRevision).toBeUndefined()
  })
  it('rejects a modified original situation, raised cap and unrelated settings without changing the pending Brief', async () => {
    const f = await pending(), edit = await edited(f), before = await current(f)
    const invalid = structuredClone(edit.settings); invalid.openAuthoring.situationTemplates[0].driverGoal += '篡改旧目标'
    let draft = await saveTtrpgDraft(f.scope, edit.draft.revision, invalid, '非法改写旧局势')
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, openingRevision: 'revise-pending-compatible-opening' })).rejects.toThrow(/原局势/)
    const raised = structuredClone(edit.settings); raised.openAuthoring.stageClosurePolicy!.maximumWorldTurns += 1
    draft = await saveTtrpgDraft(f.scope, draft.revision, raised, '非法抬高上限')
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, openingRevision: 'revise-pending-compatible-opening' })).rejects.toThrow(/上限/)
    const unrelated = structuredClone(edit.settings); unrelated.playerRole += '另换身份'
    draft = await saveTtrpgDraft(f.scope, draft.revision, unrelated, '非法换角色')
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, openingRevision: 'revise-pending-compatible-opening' })).rejects.toThrow(/其他配置/)
    expect(await current(f)).toEqual(before)
    await expect(readTtrpgCompatibleOpeningAuthoringBaseV1({ ...f, scope: { ...f.scope, workId: f.scope.workId + 900 } })).rejects.toThrow(/本作品/)
  })
  it('restores the pinned pending intent and produces it through the normal credential-free service after a backup roundtrip', async () => {
    const f = await pending(), edit = await edited(f)
    const draft = await saveTtrpgDraft(f.scope, edit.draft.revision, edit.settings, '备份前确认新开局')
    await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, openingRevision: 'revise-pending-compatible-opening' })
    const original = await current(f), projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const production = (await db.productProductions.where('projectId').equals(projectId).toArray()).find(p => p.productionKey === original.production.productionKey)!
    const scope = { projectId, worldId: production.worldId, workId: production.workId }, productionId = production.id!
    const imported = await current({ productionId })
    expect(imported.brief.ttrpgOpen!.compatibleOpeningRevision).toEqual(original.brief.ttrpgOpen!.compatibleOpeningRevision)
    await readTtrpgCompatibleOpeningAuthoringBaseV1({ scope, productionId })
    await authorizeProductProductionStartV1({ scope, details: await readProductProductionDetailsV1(scope, productionId) })
    const result = await runAuthorizedProductProductionV1({ scope, productionId })
    const currentProduction = (await db.productProductions.get(productionId))!
    const build = (await db.productBuilds.where('[productionId+buildNumber]').equals([productionId, currentProduction.currentBuildNumber!]).first())!
    expect(result.terminal, build.failureJson).toBe(true)
    expect(build.status).toBe('release-ready')
    expect(JSON.parse(build.budgetLedgerJson).attempts.every((a: { usage: { modelCalls: number } | null }) => (a.usage?.modelCalls ?? 0) === 0)).toBe(true)
    expect(await current(f)).toEqual(original)
  })
})
