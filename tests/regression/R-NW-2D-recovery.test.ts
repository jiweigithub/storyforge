import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeRelationReleaseV4 } from '../helpers/narrative-release-fixture'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createNarrativeCompilationTaskV1, continueNarrativeCompilationTaskV1, readNarrativeCompilationTaskV1,
  sealNarrativeCompilationTaskV1 } from '../../src/lib/world-engine/narrative-compilation-task'
import { captureWorldReleaseInputV4 } from '../../src/lib/world-engine/narrative-release-capture'
import { compileWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import * as worker from '../../src/lib/world-engine/narrative-release-worker'

describe('NW-2D · 真实领域修改、检查点、显式新修订与旧档保留', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks() })

  async function edited() {
    const fixture = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    await db.characters.update(fixture.actorId, { shortDescription: '穿灰外衣，仍持铜铃', updatedAt: Date.now() })
    const capture = await captureNarrativeDomainV1({ scope: fixture.scope, owner: { kind: 'world', worldCode: fixture.world.code, sourceWorkCode: null } })
    const actor = capture.rows.get('characters')!.find(row => row.id === fixture.actorId)!
    await confirmNarrativeDomainAnnotationsV1({ scope: fixture.scope, table: 'characters', recordId: fixture.actorId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', actor),
      annotations: { narrativeVisibilityV1: actor.narrativeVisibilityV1!, narrativeEvidenceV1: actor.narrativeEvidenceV1! } })
    const request = { scope: fixture.scope, selectedTables: ['characters', 'characterRelations'], baseRevisionId: fixture.revision.id! }
    return { fixture, request }
  }

  it('失败不隐藏重试；刷新恢复同一操作，增量等于全量，新版本须单独确认且不触碰旧发布', async () => {
    const { fixture, request } = await edited(), oldRelease = await db.worldReleases.get(fixture.release.id!)
    const task = await createNarrativeCompilationTaskV1(request), startedCount = await db.worldRevisions.count()
    const workerSpy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1').mockRejectedValueOnce(Error('injected-interruption'))
    const run = { scope: fixture.scope, runId: task.snapshot.run.id }
    await expect(continueNarrativeCompilationTaskV1(run)).rejects.toThrow('injected-interruption')
    expect(workerSpy).toHaveBeenCalledTimes(1)
    db.close(); await db.open()
    const completed = await continueNarrativeCompilationTaskV1(run)
    const result = completed.checkpoint.result!, update = result.update!
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.snapshot.projection.steps['world.narrative.compile-v4'].attempt).toBe(2)
    expect(update.baseContentHash).toBe(fixture.revision.contentHash)
    expect(update.indexReuse.reusedSources.length).toBeGreaterThan(0)
    // This field is retained in frozen originals but is not the registered
    // entity-name projection. Its unchanged lexical shards are all reusable.
    expect(update.indexReuse.rebuiltSources).toEqual([])
    expect(update.impact.writes).toEqual([])
    expect(update.impact.changedSemanticIds).toHaveLength(1)
    expect(update.impact.staleSemanticIds).toEqual([])
    expect(update.impact.unknownCoverage.some(item => item.includes('/shortDescription:unprojected-original'))).toBe(true)
    const full = await compileWorldReleaseContentV4((await captureWorldReleaseInputV4(request)).input)
    expect(result.contentHash).toBe(full.contentHash)
    expect(result.manifest).toEqual(full.manifest)
    expect(result.index).toEqual(full.index)
    expect(await db.worldRevisions.count()).toBe(startedCount)
    const repeat = await continueNarrativeCompilationTaskV1(run)
    expect(repeat.checkpoint.receipt!.operationKey).toBe(update.impact.operationKey)
    await expect(sealNarrativeCompilationTaskV1({ ...run, label: '错误父版本' })).rejects.toThrow('父版本')
    const seal = { ...run, label: '只改外貌后的新修订', parentRevisionId: fixture.revision.id! }
    const revision = await sealNarrativeCompilationTaskV1(seal)
    expect((await sealNarrativeCompilationTaskV1(seal)).id).toBe(revision.id)
    expect(await db.worldRevisions.count()).toBe(startedCount + 1)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(oldRelease)
    expect((await db.characters.get(fixture.actorId))!.shortDescription).toBe('穿灰外衣，仍持铜铃')
  })

  it('完成计划随既有 run 备份；导入为历史证据，不能恢复到另一个 owner', async () => {
    const { fixture, request } = await edited(), task = await createNarrativeCompilationTaskV1(request)
    const run = { scope: fixture.scope, runId: task.snapshot.run.id }
    const completed = await continueNarrativeCompilationTaskV1(run)
    const projectId = await deriveImportProjectJSON(await deriveExportProjectJSON(fixture.scope.projectId))
    const project = (await db.projects.get(projectId))!, scope = { projectId, worldId: project.activeWorldId!, workId: project.activeWorkId! }
    const saved = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    const imported = await readNarrativeCompilationTaskV1(scope, saved.id!)
    expect(imported.historicalOnly).toBe(true)
    expect(imported.checkpoint.result!.update).toEqual(completed.checkpoint.result!.update)
    await expect(continueNarrativeCompilationTaskV1({ scope, runId: saved.id! })).rejects.toThrow('历史副本')
  })

  it('捕获之后的来源变化在派发前被阻断，不能用旧依赖图继续；基准不能跨世界', async () => {
    const { fixture, request } = await edited(), task = await createNarrativeCompilationTaskV1(request)
    await db.characters.update(fixture.actorId, { name: '漂移后的称呼' })
    const spy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1')
    await expect(continueNarrativeCompilationTaskV1({ scope: fixture.scope, runId: task.snapshot.run.id })).rejects.toThrow('stale')
    expect(spy).not.toHaveBeenCalled()
    const other = await seedNarrativeRelationReleaseV4()
    await expect(createNarrativeCompilationTaskV1({ ...request, baseRevisionId: other.revision.id! })).rejects.toThrow('不属于当前世界')
  })
})
