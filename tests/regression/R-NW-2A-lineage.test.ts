import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { deriveNovelToWorld } from '../../src/lib/world-engine/derivation'
import { createWorldPackage, importWorldPackage } from '../../src/lib/world-engine/world-package'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { verifyNarrativeLineageV1 } from '../../src/lib/world-engine/narrative-lineage'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { createWorldWork } from '../../src/lib/workspace/works'
import { resolveScope } from '../../src/lib/workspace/scope'
import { createWorldRevision } from '../../src/lib/world-engine/releases'
import * as worker from '../../src/lib/world-engine/narrative-release-worker'
import * as identity from '../../src/lib/memory/identity'
import * as worldIdentity from '../../src/lib/workspace/identity'

async function seed(profile: 'long' | 'short' = 'long') {
  const source = await createWorkspace({ name: '铜铃小说', genres: [], description: '原作不可移动', status: 'drafting', targetWordCount: 5000 },
    { purpose: 'independent-work', kind: 'novel', novelProfile: profile })
  const owner = { kind: 'work' as const, workCode: source.work.code }, scope = source.scope
  const now = Date.now(), actorIds: number[] = []
  for (const note of ['东岸的守渡人', '西岸的守渡人']) {
    const id = await db.characters.add(stampNewRecord(scope, 'characters', { name: '同名守渡人', shortDescription: note,
      roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
    const capture = await captureNarrativeDomainV1({ scope, owner }), row = capture.rows.get('characters')!.find(r => r.id === id)!
    await confirmNarrativeDomainAnnotationsV1({ scope, owner, table: 'characters', recordId: id,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', row),
      annotations: { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'lineage-fixture-v1' } } })
    actorIds.push(id)
  }
  const text = '东岸的人把铜铃交给西岸的人。\r\n铃沿刻着“e\u0301”。'
  const eventId = await db.storyTimelineEvents.add(stampNewRecord(scope, 'storyTimelineEvents', { title: '交铃', description: text,
    importance: 2, order: 0, createdAt: now, updatedAt: now }, { owner: 'work' }))
  const capture = await captureNarrativeDomainV1({ scope, owner }), row = capture.rows.get('storyTimelineEvents')!.find(r => r.id === eventId)!
  const chars = await db.characters.bulkGet(actorIds), hash = await hashNarrativeBytesV1(text)
  await confirmNarrativeDomainAnnotationsV1({ scope, owner, table: 'storyTimelineEvents', recordId: eventId,
    expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'storyTimelineEvents', row), annotations: {
      narrativeModalityV1: 'established', narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'lineage-fixture-v1' },
      narrativeEventV1: { eventType: 'action', participants: chars.map((actor, i) => ({ entity: { characterId: actor!.id!, sourceUid: actor!.ragDocumentId! }, role: i === 0 ? 'giver' : 'receiver' })),
        locations: [], propositions: [], effects: [], communication: null, observer: null, before: [] },
      narrativeEvidenceV1: [{ evidenceKey: 'handover', source: { self: true }, fieldPointer: '/description', sourceContentHash: hash,
        start: 0, end: new TextEncoder().encode(text).length, normalizationVersion: 'raw-utf8-v1', spanHash: hash, supportRole: 'supports' }],
    } })
  return { ...source, actorIds, eventId, text }
}
const allowedUses = { 'world-remix': true, ttrpg: true, 'character-interaction': true, 'ai-town': false, 'text-adventure': false, avg: false, 'text-open-world': false }

describe('NW-2A · 显式复制的 namespace、确认与来源对照', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks(); vi.useRealTimers() })

  it.each(['long', 'short'] as const)('%s 小说派生新世界：同名不合并，原文/引用保持，源 owner 和旧确认不变', async profile => {
    const source = await seed(profile)
    const original = { project: await db.projects.get(source.scope.projectId), work: await db.works.get(source.scope.workId),
      characters: await db.characters.where('projectId').equals(source.scope.projectId).toArray(), event: await db.storyTimelineEvents.get(source.eventId) }
    const derived = await deriveNovelToWorld({ sourceScope: source.scope, formatVersion: 4, publish: true,
      selectedTables: ['characters', 'storyTimelineEvents'] })
    const verified = await verifyWorldReleaseRecordV1(derived.release!)
    expect(verified.version).toBe(4)
    if (verified.version !== 4) throw Error('v4 expected')
    const bundle = verified.manifest.narrative.bundle, lineage = await verifyNarrativeLineageV1(verified.manifest.sourceManifest.lineage)
    expect(bundle.records.filter(r => r.kind === 'entity')).toHaveLength(2)
    expect(bundle.records.filter(r => r.kind === 'event')).toHaveLength(1)
    expect(bundle.aliases).toHaveLength(3)
    expect(lineage.sourceOwner).toEqual({ kind: 'work', workCode: source.work.code })
    expect(bundle.aliases.every(a => a.from.kind === 'semantic' && a.from.semanticId !== a.toSemanticId)).toBe(true)
    expect(verified.manifest.records.storyTimelineEvents[0].description).toBe(source.text)
    expect(derived.derivation.sourceKind).toBe(profile === 'long' ? 'long-novel' : 'short-novel')
    expect({ project: await db.projects.get(source.scope.projectId), work: await db.works.get(source.scope.workId),
      characters: await db.characters.where('projectId').equals(source.scope.projectId).toArray(), event: await db.storyTimelineEvents.get(source.eventId) }).toEqual(original)
    const exported = await deriveExportProjectJSON(derived.targetProjectId)
    const restoredId = await deriveImportProjectJSON(exported)
    expect((await db.worldDerivations.where('projectId').equals(restoredId).first())!.narrativeLineageJson).toBe(derived.derivation.narrativeLineageJson)
    await cascadeDeleteProject(source.scope.projectId)
    expect((await verifyWorldReleaseRecordV1(derived.release!)).version).toBe(4)
    const pkg = await createWorldPackage(derived.release!.id!, { authorName: '作者', license: 'CC-BY-4.0', allowedUses })
    const before = canonicalNarrativeJsonV1(pkg)
    const copiedId = await importWorldPackage(pkg)
    const copied = (await db.worldDerivations.where('projectId').equals(copiedId).first())!
    const copyLineage = await verifyNarrativeLineageV1(JSON.parse(copied.narrativeLineageJson!))
    expect(copyLineage.kind).toBe('world-copy')
    expect(copyLineage.targetWorldCode).not.toBe(lineage.targetWorldCode)
    expect(copyLineage.aliases).toHaveLength(3)
    expect((await db.worldReleases.where('projectId').equals(copiedId).first())!.manifestJson).toBe(derived.release!.manifestJson)
    expect(canonicalNarrativeJsonV1(pkg)).toBe(before)
  })

  it('不完整选择或编译期间原作改变时不留下新目标；来源、既有版本不被清理', async () => {
    const source = await seed()
    await expect(deriveNovelToWorld({ sourceScope: source.scope, formatVersion: 4, selectedTables: ['storyTimelineEvents'] })).rejects.toThrow()
    expect(await db.projects.count()).toBe(1)
    const compile = worker.compileNarrativeReleaseInWorkerV1
    vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1').mockImplementationOnce(async (...args) => {
      const result = await compile(...args)
      await db.storyTimelineEvents.update(source.eventId, { description: '编译期间原作已修改' })
      return result
    })
    await expect(deriveNovelToWorld({ sourceScope: source.scope, formatVersion: 4, selectedTables: ['characters', 'storyTimelineEvents'] })).rejects.toThrow('stale')
    expect(await db.projects.count()).toBe(1)
    expect(await db.worldRevisions.count()).toBe(0)
    expect((await db.storyTimelineEvents.get(source.eventId))!.description).toBe('编译期间原作已修改')
  })

  it('备份中篡改派生回执或跨目标身份，在任何导入写入前拒绝', async () => {
    const source = await seed()
    const derived = await deriveNovelToWorld({ sourceScope: source.scope, formatVersion: 4, selectedTables: ['characters', 'storyTimelineEvents'] })
    const exported = await deriveExportProjectJSON(derived.targetProjectId)
    const bad = structuredClone(exported), lineage = JSON.parse(bad.worldDerivations[0].narrativeLineageJson!)
    lineage.sourceContentHash = 'f'.repeat(64)
    bad.worldDerivations[0].narrativeLineageJson = canonicalNarrativeJsonV1(lineage)
    await expect(deriveImportProjectJSON(bad)).rejects.toThrow('回执')
    expect(await db.projects.count()).toBe(2)
  })

  it('更换派生世界的内部 Work 后，旧发布仍可读；新修订只含当前 owner 内容且保留历史来源回执', async () => {
    const source = await seed()
    const derived = await deriveNovelToWorld({ sourceScope: source.scope, formatVersion: 4, selectedTables: ['characters', 'storyTimelineEvents'], publish: true })
    const oldRelease = canonicalNarrativeJsonV1(await db.worldReleases.get(derived.release!.id!))
    const lineageBefore = derived.derivation.narrativeLineageJson
    const replacement = await createWorldWork(derived.targetProjectId, { title: '新的世界工作稿' })
    await deleteWork(derived.targetScope.workId)
    const scope = await resolveScope({ projectId: derived.targetProjectId })
    expect(scope.workId).toBe(replacement.id)
    expect(await db.storyTimelineEvents.where('projectId').equals(derived.targetProjectId).count()).toBe(0)
    expect(await db.storyTimelineEvents.get(source.eventId)).toBeDefined()
    expect(canonicalNarrativeJsonV1(await db.worldReleases.get(derived.release!.id!))).toBe(oldRelease)
    const old = await verifyWorldReleaseRecordV1((await db.worldReleases.get(derived.release!.id!))!)
    expect(old.version).toBe(4)
    if (old.version !== 4) throw Error('expected v4')
    expect(old.manifest.narrative.bundle.records.some(record => record.kind === 'event')).toBe(true)
    const revision = await createWorldRevision({ scope, formatVersion: 4, includeWorkSources: true,
      selectedTables: ['characters', 'storyTimelineEvents'], label: '更换工作稿后的当前快照' })
    const next = JSON.parse(revision.manifestJson)
    expect(next.narrative.bundle.records.every((record: { kind: string }) => record.kind !== 'event')).toBe(true)
    expect(next.narrative.bundle.aliases).toEqual([])
    expect(next.sourceManifest.sourceWorkCode).toBe(replacement.code)
    expect(next.sourceManifest.lineage.sourceOwner).toEqual({ kind: 'work', workCode: source.work.code })
    expect((await db.worldDerivations.get(derived.derivation.id!))!.narrativeLineageJson).toBe(lineageBefore)
    const backup = await deriveExportProjectJSON(derived.targetProjectId)
    const restored = await deriveImportProjectJSON(backup)
    expect((await db.worldReleases.where('projectId').equals(restored).first())!.manifestJson).toBe(derived.release!.manifestJson)
  })

  it('事务内派生回执写入失败整笔回滚，保留原作', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    const source = await seed()
    const original = await deriveExportProjectJSON(source.scope.projectId)
    vi.spyOn(db.worldDerivations, 'add').mockRejectedValueOnce(Error('injected-after-target-import'))
    await expect(deriveNovelToWorld({ sourceScope: source.scope, formatVersion: 4, selectedTables: ['characters', 'storyTimelineEvents'] })).rejects.toThrow('injected-after-target-import')
    expect(await db.projects.count()).toBe(1)
    expect(await db.worldReleases.count()).toBe(0)
    expect(await deriveExportProjectJSON(source.scope.projectId)).toEqual(original)
  })

  it.each(['revision', 'release', 'receipt-finalize'] as const)('最后的 %s 写入失败时没有半成品；显式重试只产生一个完整目标', async phase => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    const source = await seed(), original = await deriveExportProjectJSON(source.scope.projectId)
    const fail = Error(`atomic-${phase}`)
    if (phase === 'revision') vi.spyOn(db.worldRevisions, 'add').mockRejectedValueOnce(fail)
    else if (phase === 'release') vi.spyOn(db.worldReleases, 'add').mockRejectedValueOnce(fail)
    else vi.spyOn(db.worldDerivations, 'update').mockRejectedValueOnce(fail)
    const request = { sourceScope: source.scope, formatVersion: 4 as const, publish: true,
      selectedTables: ['characters', 'storyTimelineEvents'] }
    await expect(deriveNovelToWorld(request)).rejects.toThrow(fail.message)
    expect(await db.projects.count()).toBe(1)
    expect(await db.worlds.count()).toBe(1)
    expect(await db.works.count()).toBe(1)
    expect(await db.characters.count()).toBe(2)
    expect(await db.storyTimelineEvents.count()).toBe(1)
    expect(await db.worldDerivations.count()).toBe(0)
    expect(await db.worldRevisions.count()).toBe(0)
    expect(await db.worldReleases.count()).toBe(0)
    expect(await deriveExportProjectJSON(source.scope.projectId)).toEqual(original)
    const retry = await deriveNovelToWorld(request)
    expect(await db.projects.count()).toBe(2)
    expect(await db.worldDerivations.count()).toBe(1)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.count()).toBe(1)
    expect((await verifyWorldReleaseRecordV1(retry.release!)).version).toBe(4)
  })

  it('编译在无目标持久化的状态完成；Worker 失败或无效结果不能启动导入', async () => {
    const source = await seed(), compile = worker.compileNarrativeReleaseInWorkerV1
    const request = { sourceScope: source.scope, formatVersion: 4 as const, selectedTables: ['characters', 'storyTimelineEvents'] }
    vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1').mockImplementationOnce(async () => {
      expect(await db.projects.count()).toBe(1)
      expect(await db.worldDerivations.count()).toBe(0)
      throw Error('worker-before-persistence')
    })
    await expect(deriveNovelToWorld(request)).rejects.toThrow('worker-before-persistence')
    const added = vi.spyOn(db.projects, 'add')
    vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1').mockImplementationOnce(async (...args) => {
      expect(await db.projects.count()).toBe(1)
      return { ...await compile(...args), contentHash: '0'.repeat(64) }
    })
    await expect(deriveNovelToWorld(request)).rejects.toThrow()
    expect(added).not.toHaveBeenCalled()
    expect(await db.projects.count()).toBe(1)
  })

  it('新工作区或世界编号冲突拒绝整笔派生，不把已编译内容重新绑定到另一个身份', async () => {
    const source = await seed()
    const request = { sourceScope: source.scope, formatVersion: 4 as const, selectedTables: ['characters', 'storyTimelineEvents'] }
    vi.spyOn(identity, 'generateWorkspaceUid').mockReturnValueOnce(source.project.workspaceUid)
    await expect(deriveNovelToWorld(request)).rejects.toThrow('identity')
    expect(await db.projects.count()).toBe(1)
    const previous = await deriveNovelToWorld(request)
    const world = (await db.worlds.get(previous.targetScope.worldId))!
    vi.spyOn(worldIdentity, 'generateWorldCode').mockReturnValueOnce(world.code)
    await expect(deriveNovelToWorld(request)).rejects.toThrow('identity')
    expect(await db.projects.count()).toBe(2)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldDerivations.count()).toBe(1)
  })

  it('编译后源作品改名拒绝旧派生，不能让回执与当前作品修订脱节', async () => {
    const source = await seed(), compile = worker.compileNarrativeReleaseInWorkerV1
    vi.spyOn(worker, 'compileNarrativeReleaseInWorkerV1').mockImplementationOnce(async (...args) => {
      const result = await compile(...args)
      await db.works.update(source.scope.workId, { title: '作者新改的标题' })
      return result
    })
    await expect(deriveNovelToWorld({ sourceScope: source.scope, formatVersion: 4,
      selectedTables: ['characters', 'storyTimelineEvents'] })).rejects.toThrow('stale')
    expect(await db.projects.count()).toBe(1)
    expect((await db.works.get(source.scope.workId))!.title).toBe('作者新改的标题')
    expect(await db.worldRevisions.count()).toBe(0)
  })
})
