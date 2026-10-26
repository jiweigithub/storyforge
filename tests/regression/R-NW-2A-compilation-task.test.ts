import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeReleaseV4 } from '../helpers/narrative-release-fixture'
import { createNarrativeCompilationTaskV1, continueNarrativeCompilationTaskV1, readNarrativeCompilationTaskV1, cancelNarrativeCompilationTaskV1,
  sealNarrativeCompilationTaskV1, listNarrativeCompilationTasksV1 } from '../../src/lib/world-engine/narrative-compilation-task'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import * as worker from '../../src/lib/world-engine/narrative-release-worker'

describe('NW-2A · 零模型编译检查点与显式恢复', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks() })

  it('刷新后从同一输入恢复；完成回执只确认编译，既不发布也不改领域原件', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    expect(started.snapshot.projection.state).toBe('paused')
    db.close(); await db.open()
    const result = await continueNarrativeCompilationTaskV1({ scope: fixture.scope, runId: started.snapshot.run.id })
    expect(result.snapshot.projection.state).toBe('completed')
    expect(result.checkpoint.result!.contentHash).toBe(fixture.release.contentHash)
    expect(result.checkpoint.receipt!.modelCalls).toBe(0)
    expect(result.snapshot.events.some(e => e.type === 'model.requested')).toBe(false)
    expect(result.snapshot.projection.memorySettlement?.state).toBe('settled')
    expect((await continueNarrativeCompilationTaskV1({ scope: fixture.scope, runId: started.snapshot.run.id })).checkpoint.receiptHash).toBe(result.checkpoint.receiptHash)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
  })

  it('Worker 中断不自动重试；显式继续从相同快照恢复，三次上限可见', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    const spy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1').mockRejectedValueOnce(Error('worker-interrupted'))
    const request = { scope: fixture.scope, runId: started.snapshot.run.id }
    await expect(continueNarrativeCompilationTaskV1(request)).rejects.toThrow('worker-interrupted')
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await readNarrativeCompilationTaskV1(fixture.scope, request.runId)).snapshot.projection.state).toBe('paused')
    const recovered = await continueNarrativeCompilationTaskV1(request)
    expect(recovered.snapshot.projection.steps['world.narrative.compile-v4'].attempt).toBe(2)
    expect(recovered.snapshot.projection.state).toBe('completed')
    const exhausted = await createNarrativeCompilationTaskV1(fixture.input)
    spy.mockRejectedValue(Error('worker-interrupted'))
    const again = { scope: fixture.scope, runId: exhausted.snapshot.run.id }
    for (let i = 0; i < 3; i++) await expect(continueNarrativeCompilationTaskV1(again)).rejects.toThrow('worker-interrupted')
    await expect(continueNarrativeCompilationTaskV1(again)).rejects.toThrow('三次')
    expect((await readNarrativeCompilationTaskV1(fixture.scope, again.runId)).snapshot.projection.state).toBe('failed')
  })

  it('来源变化或作者取消阻断派发，旧发布保留', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    await db.characters.update(fixture.actorId, { name: '捕获之后改名' })
    const spy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1')
    await expect(continueNarrativeCompilationTaskV1({ scope: fixture.scope, runId: started.snapshot.run.id })).rejects.toThrow('stale')
    expect(spy).not.toHaveBeenCalled()
    await cancelNarrativeCompilationTaskV1(fixture.scope, started.snapshot.run.id)
    expect((await readNarrativeCompilationTaskV1(fixture.scope, started.snapshot.run.id)).snapshot.projection.state).toBe('cancelled')
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
  })

  it('便携导入只保留历史编译证据，不恢复原工作区任务或自动发布', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const started = await createNarrativeCompilationTaskV1(fixture.input)
    const projectId = await deriveImportProjectJSON(await deriveExportProjectJSON(fixture.scope.projectId))
    const project = (await db.projects.get(projectId))!
    const scope = { projectId, worldId: project.activeWorldId!, workId: project.activeWorkId! }
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    const historical = await readNarrativeCompilationTaskV1(scope, run.id!)
    expect(historical.historicalOnly).toBe(true)
    await expect(continueNarrativeCompilationTaskV1({ scope, runId: run.id! })).rejects.toThrow('历史副本')
    expect((await readNarrativeCompilationTaskV1(fixture.scope, started.snapshot.run.id)).snapshot.projection.state).toBe('paused')
  })

  it('作者显式冻结核验已完成快照；重复操作不重编译，之后的来源改变不能偷换封存', async () => {
    const fixture = await seedNarrativeReleaseV4()
    const task = await createNarrativeCompilationTaskV1(fixture.input)
    const request = { scope: fixture.scope, runId: task.snapshot.run.id, label: '完成后确认冻结', parentRevisionId: fixture.revision.id }
    await expect(sealNarrativeCompilationTaskV1(request)).rejects.toThrow('尚未完成')
    await continueNarrativeCompilationTaskV1(request)
    const spy = vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1')
    const revision = await sealNarrativeCompilationTaskV1(request)
    expect(revision.contentHash).toBe(fixture.release.contentHash)
    expect((await sealNarrativeCompilationTaskV1(request)).id).toBe(revision.id)
    expect(spy).not.toHaveBeenCalled()
    expect(await db.worldReleases.count()).toBe(1)
    expect((await listNarrativeCompilationTasksV1(fixture.scope))[0]).toEqual({ id: task.snapshot.run.id, status: 'completed' })
    await db.characters.update(fixture.actorId, { name: '完成编译后修改' })
    await expect(sealNarrativeCompilationTaskV1(request)).rejects.toThrow('stale')
    expect(await db.worldRevisions.count()).toBe(2)
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(fixture.release)
  })
})
