import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgVisualBatchDraftV1, prepareAvgAssemblyBriefV1, startAvgAssemblyV1, stageAvgWorkspaceInputV1,
  confirmAvgWorkspaceInputV1, runAvgAssemblyV1, stageAvgMediaChoiceV2, configureAvgChosenMediaDraftV2 } from '../../src/lib/avg/assembly-service'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'
import { avgExecutableModule } from '../../src/lib/avg/executable-module'

const requirement = (): AvgVisualProductionRequirementV1 => ({ requirementKey: 'desk.background', revision: 1,
  assetKey: 'avg.generated.desk', name: '原创工程背景', altText: '仅用于管线验证的原创色块',
  family: { subjectKey: 'desk', familyKey: 'desk.day', variantKey: 'day', revision: 1 },
  consumer: { consumerKey: 'desk.background', domain: 'stage', slot: 'background', subjectKey: 'desk', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
  triggerBeatKey: 'line.desk', itemVariantKey: null, mediaKind: 'background', prompt: '原创房间的工程图', negativePrompt: '', invariants: [], forbiddenDepictions: [],
  width: 576, height: 324, resolutionTier: '1K', alpha: 'not-required', references: [] })

async function prepare() {
  const s = await prepareNativeAvgAssembly(), draft = await readAvgDraftV1(s.scope)
  const saved = await saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision, batchKey: 'engineering.batch', revision: 1, requirements: [requirement()] })
  const details = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
  return { ...s, details }
}
async function start(s: Awaited<ReturnType<typeof prepare>>) {
  const details = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: s.details.brief!.briefHash })
  return { ...s, details, buildId: details.build!.id! }
}
async function confirm(s: Awaited<ReturnType<typeof start>>, artifactKey: string) {
  const draft = await readAvgDraftV1(s.scope)
  const candidate = await stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: draft.revision, artifactKey,
    declaration: '确认原创工程输入及准确媒资清单；不代表商业或艺术质量验收' })
  await confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey, candidateVersion: candidate.version,
    candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
}
async function confirmSources(s: Awaited<ReturnType<typeof start>>) {
  for (const key of ['avg.system.plan', ...s.details.executionBrief!.avgAssembly!.sceneKeys.map(key => `avg.content.scene-script.${key}`)]) await confirm(s, key)
}
async function response() {
  const data = new Uint8Array(await deterministicRegionMapPngV1({ width: 576, height: 324, palette: ['#18213b', '#39506b', '#c8dce8'] }))
  let binary = ''; for (let i = 0; i < data.length; i += 16384) binary += String.fromCharCode(...data.subarray(i, i + 16384))
  return JSON.stringify({ data: [{ b64_json: btoa(binary) }] })
}

describe('R-AVG-BASE01B · actual public media Harness with controlled HTTP/decoder', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
    useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'test-only-agnes-no-network', model: 'agnes-2.5-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0.7, maxTokens: 0 })
    // jsdom has no image decoder. Browser E2E must separately prove decoding.
    vi.spyOn(mediaVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ environment: input.environment, measuredAt: Date.now(),
      assets: input.assets.map(asset => ({ assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
        mediaClass: 'image', status: 'decoded', decodedWidth: 576, decodedHeight: 324, decodedDurationMs: null, decodedHasAlpha: false,
        decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null, truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [], failureCode: null })) }))
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

  it('one POST retains original response, waits for author choice, configures exact bytes and joins the native Preview', async () => {
    const body = await response(), dispatch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'engineering.http.1' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare())
    await confirmSources(s)
    const generated = await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const build = (await db.productBuilds.get(s.buildId))!
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(generated.buildStatus, build.failureJson).toBe('building')
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).filter(row => row.status === 'accepted').first())!
    expect(raw, build.failureJson).toBeDefined()
    await expect(stageAvgMediaChoiceV2({ scope: s.scope, productionId: s.productionId, requirementKey: 'desk.background', rawVersion: raw.version + 1,
      rawContentHash: raw.contentHash, declaration: '错误版本探针' })).rejects.toThrow(/准确/)
    await expect(stageAvgMediaChoiceV2({ scope: s.scope, productionId: s.productionId, requirementKey: 'desk.background', rawVersion: raw.version,
      rawContentHash: 'f'.repeat(64), declaration: '错误 hash 探针' })).rejects.toThrow(/准确/)
    await expect(confirm(s, 'avg.system.plan')).rejects.toThrow(/新建 Build/)
    expect(build.previewHash).toBe('')
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.choice.desk.background']).count()).toBe(0)
    const evidence = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response')!
    expect(JSON.parse(evidence.content!).rawText).toBe(body)
    await expect(configureAvgChosenMediaDraftV2({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })).rejects.toThrow()
    const choice = await stageAvgMediaChoiceV2({ scope: s.scope, productionId: s.productionId, requirementKey: 'desk.background', rawVersion: raw.version,
      rawContentHash: raw.contentHash, declaration: '作者选择准确原图用于背景；工程验证不代表艺术验收' })
    expect(choice.status).toBe('pending')
    const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, changed = blob.data!.slice(0)
    new Uint8Array(changed)[changed.byteLength - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: changed })
    await expect(confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: choice.artifactKey, candidateVersion: choice.version,
      candidateHash: JSON.parse(choice.metadataJson).candidateHash })).rejects.toThrow(/哈希/)
    expect((await db.productBuildArtifacts.get(choice.id!))!.status).toBe('pending')
    await db.mediaBlobObjects.update(blob.id!, { data: blob.data })
    await confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: choice.artifactKey, candidateVersion: choice.version,
      candidateHash: JSON.parse(choice.metadataJson).candidateHash })
    const configured = await configureAvgChosenMediaDraftV2({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const workspace = JSON.parse(configured.editorJson!)
    expect(workspace.presentation.stage.assets[0]).toMatchObject({ assetKey: 'avg.generated.desk', contentHash: raw.contentHash })
    expect(workspace.presentation.stage.cues[0]).toMatchObject({ type: 'set-background', beatKey: 'line.desk', assetKey: 'avg.generated.desk' })
    await confirm(s, 'avg.author.stage')
    db.close(); await db.open()
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '0')
    useAIConfigStore.getState().setConfig({ apiKey: '' })
    const finished = await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(finished.buildStatus, details.build!.failureJson).toBe('preview-ready')
    const preview = await verifyStoredProductBuildPreview(details.build!)
    expect(avgExecutableModule(preview!.runtimePackage)!.stage.assets).toHaveLength(1)
    expect(avgExecutableModule(preview!.runtimePackage)!.stage.assets[0]).toMatchObject({ assetKey: 'avg.generated.desk', contentHash: raw.contentHash })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('route path drift and a disabled start reject before creating a Build or making HTTP requests', async () => {
    const dispatch = vi.fn(); vi.stubGlobal('fetch', dispatch)
    const s = await prepare()
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://apihub.agnes-ai.com/different/v1' })
    await expect(start(s)).rejects.toThrow(/路由已变化/)
    expect(await db.productBuilds.count()).toBe(0)
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://apihub.agnes-ai.com/v1' })
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '0')
    await expect(start(s)).rejects.toThrow(/尚未启用/)
    expect(await db.productBuilds.count()).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
    // Disabling new production never makes the saved Brief unreadable.
    expect((await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).executionBrief!.avgAssembly!.version).toBe(2)
  })

  it.each([202, 200])('an operation-only %i keeps raw evidence/reservation and never silently reposts after reopen', async status => {
    const dispatch = vi.fn(async () => new Response(JSON.stringify({ task_id: 'engineering.operation.1' }), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    const result = await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    expect(result.buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(s.buildId))!
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(ledger.tasks['avg.media.generate.desk.background']).toMatchObject({ status: 'failed', errorCode: 'task-result-unknown', usage: null })
    expect(ledger.attempts.find((attempt: { taskKey: string }) => attempt.taskKey === 'avg.media.generate.desk.background')).toMatchObject({ usageKnown: false, usage: { mediaCalls: 1 } })
    expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content?.includes('engineering.operation.1'))).toBe(true)
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).count()).toBe(0)
    db.close(); await db.open()
    await expect(runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).rejects.toThrow(/不可组装/)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('authentication failure is settled as one observed request and does not create a selectable raw image', async () => {
    const dispatch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'engineering authentication failure' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    expect((await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(s.buildId))!
    expect(JSON.parse(build.budgetLedgerJson).tasks['avg.media.generate.desk.background'].usage.mediaCalls).toBe(1)
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).count()).toBe(0)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('malformed JSON retains the bounded pre-parse response and an unresolved call without resending', async () => {
    const body = '{"data":unfinished'
    const dispatch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    expect((await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).buildStatus).toBe('recovery-required')
    const evidence = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response')!
    expect(JSON.parse(evidence.content!).rawText).toBe(body)
    const ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson)
    expect(ledger.attempts.find((attempt: { taskKey: string }) => attempt.taskKey === 'avg.media.generate.desk.background')).toMatchObject({ usageKnown: false, usage: { mediaCalls: 1 } })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
