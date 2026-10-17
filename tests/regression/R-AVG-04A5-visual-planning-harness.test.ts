import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/visual-planning-brief'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { resolveConfiguredTextCapabilityV1 } from '../../src/lib/product-production/capabilities'
import { resolveAvgImageExecutionCapabilityV2 } from '../../src/lib/avg/media-capability'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { stageAvgAuthorArtifactV1, readAvgConfirmedVisualArtifactsV4 } from '../../src/lib/avg/author-artifacts'
import { verifyAcceptedProductBuildArtifactV1, verifyHistoricalAvgVisualPlanningArtifactV4 } from '../../src/lib/product-production/artifact-store'
import { readAvgVisualProposalEvidenceV4 } from '../../src/lib/avg/visual-planning-evidence'
import { importAvgMediaV1 } from '../../src/lib/avg/editor-service'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import type { AvgMediaBriefV1, AvgVisualBibleV1 } from '../../src/lib/avg/visual-planning-contract'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'

const config = { provider: 'agnes' as const, baseUrl: 'https://visual.fixture.invalid/v1',
  apiKey: 'test-only-no-network', model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0 }

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig(config)
  // Only the intentionally closed feature fence and external model runner
  // are replaced. Build/start/SourcePlan/Harness/producer/adoption stay real.
  vi.spyOn(readiness, 'avgVisualPlanningExecutionReadyV4').mockReturnValue(true)
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function setup(options: { malformed?: boolean; wrongBinding?: boolean; unknown?: boolean; reference?: 'valid' | 'missing' | 'tampered' } = {}) {
  const fixture = await avgVisualPlanningFixtureV4(), { owner, source } = fixture
  const brief = structuredClone(fixture.brief)
  if (options.reference) {
    const data = await deterministicRegionMapPngV1({ width: 32, height: 32, palette: ['#112233', '#445566', '#778899'] })
    const asset = await importAvgMediaV1({ scope: owner.scope, data, mimeType: 'image/png', kind: 'background', name: '原创工程风格参考',
      license: '原创工程参考，仅用于本测试声明用途', altText: '工程色块', characterTag: '' })
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...unhashed } = brief.avgVisualPlanning!.scope
    unhashed.templates[0].allowedReferenceKeys = unhashed.templates[0].requiredReferenceKeys = ['design-reference']
    unhashed.referenceCatalog = [{ referenceKey: 'design-reference', reference: { assetKey: asset.assetKey, assetVersion: asset.version,
      contentHash: asset.contentHash, mimeType: 'image/png', byteSize: asset.byteSize, purpose: 'style', allowedChange: '只参考配色',
      dataClass: 'image-reference', license: asset.license, providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null } }]
    brief.avgVisualPlanning!.scope = await freezeAvgVisualPlanningScopeV1(unhashed, source)
    brief.capabilityRequirements.find(c => c.mediaClass === 'image')!.allowedDataClasses.push('image-reference')
    brief.externalDataPolicy.allowedDataClasses.push('image-reference'); brief.externalDataPolicy.allowReferenceImages = true
    const upload = (await db.avgDraftMedia.where('workId').equals(owner.scope.workId).first())!
    if (options.reference === 'missing') await db.avgDraftMedia.delete(upload.id!)
    if (options.reference === 'tampered') {
      const blob = (await db.mediaBlobObjects.get(upload.blobObjectId))!, corrupt = new Uint8Array(data.slice(0)); corrupt[corrupt.length - 1] ^= 1
      await db.mediaBlobObjects.update(blob.id!, { data: corrupt.buffer })
    }
  }
  const text = await resolveConfiguredTextCapabilityV1({ projectId: owner.scope.projectId,
    category: 'product-production', requirementKey: 'avg.visual.planning.text' })
  brief.capabilityRequirements.find(c => c.mediaClass === 'text')!.capabilityHash = text.receipt.capabilityHash
  const image = await resolveAvgImageExecutionCapabilityV2({ projectId: owner.scope.projectId,
    requirement: brief.capabilityRequirements.find(c => c.mediaClass === 'image')! })
  brief.avgVisualPlanning!.imageBinding = { ...image.binding, endpointRouteHash: image.endpointRouteHash }
  const parsed = parseProductProductionBriefV3(brief)
  const saved = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'save-brief-revision', commandId: 'visual.actual.save', expectedStateRevision: owner.details.production.stateRevision,
      parentRevision: owner.details.brief!.revision, brief: parsed } })
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  const prepared = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const started = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'authorize-start', commandId: 'visual.actual.start', expectedStateRevision: prepared.production.stateRevision,
      briefRevision: prepared.brief!.revision, briefHash: prepared.brief!.briefHash, authorizationNonce: 'explicit-test-author-start' } })
  if (!started.ok) throw new Error(JSON.stringify(started))
  const details = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const buildId = details.build!.id!
  const subjectKey = parsed.avgVisualPlanning!.scope.templates[0].parameters.family.subjectKey
  const bible: AvgVisualBibleV1 = { schema: 'storyforge.avg.visual-bible', version: 1,
    style: { medium: '二维插画', rendering: '清晰轮廓', palette: ['暖灰'], lighting: '左上主光', composition: '保留对白区' },
    subjects: [{ subjectKey, subjectKind: 'environment', identityInvariants: ['门窗位置'], allowedChanges: ['允许的光照'], forbiddenDepictions: ['新增秘密'] }] }
  const media: AvgMediaBriefV1 = { schema: 'storyforge.avg.media-brief', version: 1, subjectKey, subjectKind: 'environment',
    designIntent: '同一地点的准确背景', outputs: parsed.avgVisualPlanning!.scope.templates.map(t => ({ requirementKey: t.parameters.requirementKey,
      prompt: '左上柔光，门窗布局稳定，下方留出对白区域', negativePrompt: '水印', invariants: ['窗框保持'], forbiddenDepictions: ['额外人物'], referenceKeys: [...t.requiredReferenceKeys] })) }
  const runText = vi.fn<ProductionTextRunnerV1>(async input => {
    expect(input.category).toBe('product-production')
    expect(input.expectedCapabilityHash).toBe(text.receipt.capabilityHash)
    if (options.unknown) throw new TypeError('Failed to fetch')
    return { output: options.malformed ? '{broken response' : JSON.stringify(input.system.includes('storyforge.avg.visual-bible') ? bible : media),
      bindingReceipt: { ...text.receipt, ...(options.wrongBinding ? { capabilityHash: 'f'.repeat(64) } : {}) }, usage: { inputTokens: 300, outputTokens: 300 } }
  })
  const executor = createConfiguredProductProductionExecutorV1({ production: details.production, brief: parsed, runText })
  const capabilityBindings = [{ requirementKey: text.receipt.requirementKey, adapterId: text.receipt.adapterId,
    bindingHash: text.receipt.capabilityHash, provider: text.receipt.provider, model: text.receipt.model }, image.binding]
  await runProductProductionUntilBlockedV1({ scope: owner.scope, productionId: owner.productionId, executor, capabilityBindings })
  const initialized = (await db.productBuilds.get(buildId))!
  const plan = parseProductProductionPlanV3(initialized.planJson, parsed, initialized.briefHash)
  const s = { ...owner, buildId, source, brief: parsed, plan, bible, media, runText, executor, capabilityBindings }
  return s
}
type Setup = Awaited<ReturnType<typeof setup>>
async function current(s: Setup) { return (await db.productBuilds.get(s.buildId))! }
async function cycle(s: Setup) { return runProductProductionSchedulerCycleV1(s) }
async function run(s: Setup) { return runProductProductionUntilBlockedV1(s) }
async function accepted(s: Setup, artifactKey: string) {
  return db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, artifactKey]).filter(r => r.status === 'accepted').first()
}
async function stage(s: Setup, artifactKey: string, payload: unknown) {
  const build = await current(s), task = s.plan.tasks.find(t => t.outputArtifactKeys.includes(artifactKey))!
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, taskKey: task.taskKey, artifactKey, kind: artifactKey === 'avg.system.plan' ? 'product-module' : 'narrative', payload,
    declaration: '确认这份工程候选；受控输出不作为真实美术或商业验收' })
}
async function adopt(s: Setup, candidate: ProductBuildArtifactRecordV1) {
  const build = await current(s), production = (await db.productProductions.get(s.productionId))!
  const result = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId,
    command: { type: 'adopt-avg-artifact', commandId: `visual.author.${crypto.randomUUID()}`,
      expectedStateRevision: production.stateRevision, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
      buildNumber: build.buildNumber, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
      candidateHash: JSON.parse(candidate.metadataJson).candidateHash } })
  if (!result.ok) throw new Error(JSON.stringify(result))
}
async function sources(s: Setup) {
  await adopt(s, await stage(s, 'avg.system.plan', s.source.systemPlan))
  for (const script of s.source.scripts) await adopt(s, await stage(s, `avg.content.scene-script.${script.sceneKey}`, script))
}

describe('AVG V4 actual visual planning Harness and explicit author boundary', () => {
  it('runs registered roles only after actual source adoption and compiles only author-adopted direction', async () => {
    const s = await setup()
    await run(s); expect(s.runText).not.toHaveBeenCalled()
    await sources(s)
    await run(s)
    expect(s.runText, (await current(s)).failureJson).toHaveBeenCalledTimes(1)
    const raw = await accepted(s, 'avg.proposal.visual-bible')
    expect(raw, (await current(s)).failureJson).toBeDefined()
    const original = await readAvgVisualProposalEvidenceV4(s.scope, raw!)
    expect(JSON.parse(original.rawText)).toEqual(s.bible)
    expect(original.request.systemPrompt).toContain('反例')
    expect(original.request.contextText).not.toContain(s.source.scripts[0].lines[0].text)
    expect(await accepted(s, 'avg.media.visual-bible')).toBeUndefined()
    await run(s); expect(s.runText).toHaveBeenCalledTimes(1)
    const candidate = await stage(s, 'avg.media.visual-bible', s.bible)
    expect(JSON.parse(candidate.metadataJson)).toMatchObject({ version: 6, origin: 'model-proposal', visualProposalValidation: { authorEdited: false } })
    await run(s); expect(s.runText).toHaveBeenCalledTimes(1)
    await adopt(s, candidate)
    await run(s)
    expect(s.runText).toHaveBeenCalledTimes(2)
    const subjectRaw = await accepted(s, `avg.proposal.environment-brief.${s.media.subjectKey}`)
    expect(subjectRaw, (await current(s)).failureJson).toBeDefined()
    const revised = structuredClone(s.media); revised.outputs[0].prompt += '，作者修订：墙面保持灰色'
    const edited = await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, revised)
    expect(JSON.parse(edited.metadataJson).visualProposalValidation.authorEdited).toBe(true)
    await adopt(s, edited)
    // One scheduler cycle deliberately stops before the unwired image consumer.
    await cycle(s)
    const compiled = await accepted(s, 'avg.media.compiled-visual-requirements')
    expect(compiled, (await current(s)).failureJson).toBeDefined()
    const proved = await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId,
      artifactKey: compiled!.artifactKey, version: compiled!.version, contentHash: compiled!.contentHash })
    expect(proved.producerRunId).not.toBeNull()
    expect(proved.payloadJson).toContain('作者修订：墙面保持灰色')
    expect(s.runText).toHaveBeenCalledTimes(2)
    expect((await db.mediaBlobObjects.toArray())).toHaveLength(0)
    await expect(stage(s, 'avg.media.visual-bible', s.bible)).rejects.toThrow(/下游执行消费/)
  })

  it.each(['malformed', 'wrongBinding'] as const)('retains the actual %s response, blocks author adoption and never automatically resends', async mode => {
    const s = await setup({ [mode]: true }); await sources(s); await run(s)
    expect(s.runText, (await current(s)).failureJson).toHaveBeenCalledTimes(1)
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
    expect(await db.agentRunArtifacts.filter(r => r.artifactKind === 'raw-response').count()).toBe(1)
    await run(s); expect(s.runText).toHaveBeenCalledTimes(1)
    await expect(stage(s, 'avg.media.visual-bible', s.bible)).rejects.toThrow()
  })

  it('refuses adopted visual reads after original response evidence disappears', async () => {
    const s = await setup(); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible))
    const raw = await accepted(s, 'avg.proposal.visual-bible')!, proof = await readAvgVisualProposalEvidenceV4(s.scope, raw!)
    const row = await db.agentRunArtifacts.where('contentHash').equals(String(proof.quality.rawResponseHash)).first()
    await db.agentRunArtifacts.delete(row!.id!)
    const build = await current(s)
    await expect(readAvgConfirmedVisualArtifactsV4({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision,
      controlEpoch: build.controlEpoch, artifactKeys: ['avg.media.visual-bible'] })).rejects.toThrow()
  })

  it('preserves original request/response, author provenance and compiled producer through actual backup/remap and Work deletion', async () => {
    const s = await setup(); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
    await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, s.media)); await cycle(s)
    const original = (await accepted(s, 'avg.proposal.visual-bible'))!
    const evidence = await readAvgVisualProposalEvidenceV4(s.scope, original)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, worldId: build.worldId, workId: build.workId }
    const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    for (const artifactKey of ['avg.proposal.visual-bible', 'avg.media.compiled-visual-requirements']) {
      const row = rows.find(r => r.artifactKey === artifactKey && r.status === 'accepted')!
      expect(row).toBeDefined()
      await verifyHistoricalAvgVisualPlanningArtifactV4({ scope, buildId: build.id!, artifactKey, version: row.version, contentHash: row.contentHash,
        expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash, sourceControlEpoch: row.controlEpoch })
    }
    const importedRaw = rows.find(r => r.artifactKey === original.artifactKey && r.status === 'accepted')!
    expect(importedRaw.producerRunId).not.toBe(original.producerRunId)
    const importedEvidence = await readAvgVisualProposalEvidenceV4(scope, importedRaw)
    expect(importedEvidence.rawText).toBe(evidence.rawText)
    expect(importedEvidence.requestText).toBe(evidence.requestText)
    const adoptedBible = rows.find(r => r.artifactKey === 'avg.media.visual-bible' && r.status === 'accepted')!
    expect(JSON.parse(adoptedBible.metadataJson).candidate).toMatchObject({ version: 6, origin: 'model-proposal', visualProposalValidation: { authorEdited: false } })
    await expect(stageAvgAuthorArtifactV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
      controlEpoch: build.controlEpoch, taskKey: 'avg.author.visual-bible', artifactKey: 'avg.media.visual-bible', kind: 'narrative',
      payload: s.bible, declaration: '导入历史不授权新采用' })).rejects.toThrow()
    await deleteWork(scope.workId)
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).count()).toBe(0)
    expect(await db.agentRuns.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await accepted(s, original.artifactKey)).toBeDefined()
    expect(s.runText).toHaveBeenCalledTimes(2)
  })

  it('verifies actual Work-owned reference bytes while delivering only permitted metadata to the visual text role', async () => {
    const s = await setup({ reference: 'valid' }); await sources(s); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1)
    const packet = s.runText.mock.calls[0][0].contextText
    expect(packet).toContain('design-reference'); expect(packet).toContain('metadata-only')
    expect(packet).not.toContain('data:image'); expect(packet).not.toContain(s.source.scripts[0].lines[0].text)
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeDefined()
  })

  it.each(['missing', 'tampered'] as const)('rejects %s reference evidence before any text or image request', async reference => {
    const s = await setup({ reference }); await sources(s); await run(s)
    expect(s.runText).not.toHaveBeenCalled()
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
  })

  it('keeps unknown transport usage reserved and does not replay after DB reopen', async () => {
    const s = await setup({ unknown: true }); await sources(s); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1)
    const build = await current(s), ledger = JSON.parse(build.budgetLedgerJson)
    expect(build.failureJson).toContain('task-result-unknown')
    expect(ledger.attempts).toContainEqual(expect.objectContaining({ taskKey: 'avg.visual.propose.direction', usageKnown: false }))
    db.close(); await db.open(); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1)
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
  })

  it('blocks changed adopted source bytes before a model request', async () => {
    const s = await setup(); await sources(s)
    const script = (await accepted(s, `avg.content.scene-script.${s.source.scripts[0].sceneKey}`))!
    const payload = JSON.parse(script.payloadJson); payload.lines[0].text += '篡改已采用字节'
    await db.productBuildArtifacts.update(script.id!, { payloadJson: JSON.stringify(payload) })
    await run(s); expect(s.runText).not.toHaveBeenCalled()
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
  })

  it('rejects a caller-supplied route that differs from the actual frozen child Run before dispatch', async () => {
    const s = await setup(); await sources(s)
    await runProductProductionUntilBlockedV1({ ...s, executor: input => s.executor({ ...input,
      capabilityBindings: input.capabilityBindings.map(b => ({ ...b, bindingHash: 'f'.repeat(64) })) }) })
    expect(s.runText).not.toHaveBeenCalled()
    expect((await current(s)).failureJson).toContain('Harness claim')
  })
})
