import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createWorldRevision, publishWorldRevision, assertReleaseUnchanged } from '../../src/lib/world-engine/releases'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import * as compiler from '../../src/lib/world-engine/narrative-release-v4'
import { createWorldWork } from '../../src/lib/workspace/works'

async function setup() {
  const created = await createWorkspace({ name: '封存反例', genres: [], status: 'drafting', description: '',
    targetWordCount: 1000, enableMultiWorld: false }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const { scope } = created
  const owner = { kind: 'world' as const, worldCode: created.world.code, sourceWorkCode: created.work.code }
  const now = Date.now()
  const actorId = await db.characters.add(stampNewRecord(scope, 'characters', { name: '递信人', shortDescription: '看守驿站',
    roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
  const confirm = async (table: string, id: number) => {
    const capture = await captureNarrativeDomainV1({ scope, owner })
    const row = capture.rows.get(table)!.find(item => item.id === id)!
    await confirmNarrativeDomainAnnotationsV1({ scope, table, recordId: id,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, table, row),
      annotations: { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'fixture-v1' } } })
  }
  await confirm('characters', actorId)
  const input = { scope, label: 'v4 首次封存', selectedTables: ['characters'], formatVersion: 4 as const }
  return { ...created, actorId, confirm, input }
}

describe('NW-2A · 现有修订/发布入口的 v4 接入', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks() })

  it('明确选择 v4 后封存，重复点击复用同一修订/发布，回读完整索引', async () => {
    const { input } = await setup()
    const a = await createWorldRevision(input), b = await createWorldRevision(input)
    expect(a.id).toBe(b.id)
    const release = await publishWorldRevision(a.id!)
    expect((await publishWorldRevision(a.id!)).id).toBe(release.id)
    await assertReleaseUnchanged(release.id!)
    const decoded = await verifyWorldReleaseRecordV1(release)
    expect(decoded.version).toBe(4)
    expect(decoded.index?.indexes.recordKeys.length).toBeGreaterThan(0)
    expect(decoded.manifest.worldCode).toBe(release.sourceWorldCode)
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.count()).toBe(1)
  })

  it('异步编译期间来源改写则零提交，旧发布和作者改动保留', async () => {
    const { input, actorId } = await setup()
    const revision = await createWorldRevision(input), release = await publishWorldRevision(revision.id!)
    const realCompile = compiler.compileWorldReleaseContentV4
    vi.spyOn(compiler, 'compileWorldReleaseContentV4').mockImplementationOnce(async value => {
      const result = await realCompile(value)
      await db.characters.update(actorId, { name: '作者同时改名' })
      return result
    })
    await expect(createWorldRevision({ ...input, label: '并发编译' })).rejects.toThrow('来源或审核状态已变化')
    expect(await db.worldRevisions.count()).toBe(1)
    expect(await db.worldReleases.get(release.id!)).toEqual(release)
    expect((await db.characters.get(actorId))!.name).toBe('作者同时改名')
  })

  it('显式选择 Work 来源后保留合法历史；默认不读取 Work，候选与另一 Work 始终排除', async () => {
    const { input, scope, actorId, confirm } = await setup()
    const base = { characterId: actorId, subjectName: '递信人', predicate: 'goal', factKind: 'state' as const,
      sourceType: 'manual' as const, locked: false, createdAt: Date.now(), updatedAt: Date.now() }
    const prior = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', { ...base, value: '守住旧驿站', status: 'superseded' }))
    const current = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', { ...base, value: '建立新驿站', status: 'confirmed', supersedesFactId: prior }))
    await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', { ...base, value: '未经确认的建议', status: 'candidate' }))
    const other = await createWorldWork(scope.projectId, { title: '另一作品' })
    await db.temporalFacts.add(stampNewRecord({ ...scope, workId: other.id! }, 'temporalFacts', { ...base, value: '另一作品的意图', status: 'confirmed' }))
    await confirm('temporalFacts', prior); await confirm('temporalFacts', current)
    const withoutWork = await createWorldRevision({ ...input, selectedTables: ['characters', 'temporalFacts'] })
    expect(JSON.parse(withoutWork.manifestJson).records.temporalFacts).toEqual([])
    const revision = await createWorldRevision({ ...input, selectedTables: ['characters', 'temporalFacts'], includeWorkSources: true })
    const release = await publishWorldRevision(revision.id!), decoded = await verifyWorldReleaseRecordV1(release)
    expect(decoded.manifest.records.temporalFacts).toHaveLength(2)
    expect(release.manifestJson).not.toContain('未经确认的建议')
    expect(release.manifestJson).not.toContain('另一作品的意图')
    if (decoded.version !== 4) throw Error('wrong codec')
    expect(decoded.manifest.narrative.bundle.records.filter(row => row.kind === 'assertion').map(row => row.reviewState).sort())
      .toEqual(['accepted', 'historical'])
    expect(decoded.manifest.narrative.bundle.records.every(row => row.scope.owner.kind === 'world')).toBe(true)
    expect((await db.temporalFacts.get(prior))!.workId).toBe(scope.workId)
  })

  it('父修订跨 World、重复领域和独立作品身份都不能创建修订', async () => {
    const first = await setup(), other = await setup()
    const parent = await createWorldRevision(other.input)
    await expect(createWorldRevision({ ...first.input, parentRevisionId: parent.id })).rejects.toThrow('父修订')
    await expect(createWorldRevision({ ...first.input, selectedTables: ['characters', 'characters'] })).rejects.toThrow('封存领域')
    await db.worlds.update(first.scope.worldId, { identityKind: 'workspace-scope' })
    await expect(createWorldRevision(first.input)).rejects.toThrow('世界引擎草稿')
    expect(await db.worldRevisions.count()).toBe(1)
  })
})
