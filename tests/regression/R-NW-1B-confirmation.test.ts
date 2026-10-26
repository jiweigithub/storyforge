import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeFamily } from '../helpers/narrative-world-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { checkRegistry } from '../../src/lib/registry/validate'

async function fixture() {
  const seeded = await seedNarrativeFamily(corpus.families[0]!)
  const id = seeded.localIds.get(`${corpus.families[0]!.id}:character-a`)!
  const work = (await db.works.get(seeded.scope.workId))!
  const capture = () => captureNarrativeDomainV1({ scope: seeded.scope, owner: { kind: 'work', workCode: work.code } })
  const snapshot = await capture()
  const sourceHash = await hashNarrativeDomainSourceV1(snapshot, 'characters', snapshot.rows.get('characters')!.find(row => row.id === id)!)
  return { ...seeded, id, capture, input: { scope: seeded.scope, table: 'characters', recordId: id, expectedSourceHash: sourceHash } }
}

describe('NW-1B · 作者确认凭据与来源 CAS', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('注册表验证通过，作者确认只签发受约束字段且重复确认幂等', async () => {
    expect(checkRegistry().errors).toEqual([])
    const source = await fixture()
    const annotations = { narrativeAliasesV1: ['递信人'],
      narrativeVisibilityV1: { class: 'public' as const, audienceKeys: [], policyVersion: 'author-v1' } }
    const receipt = await confirmNarrativeDomainAnnotationsV1({ ...source.input, annotations })
    const capture = await source.capture()
    const row = capture.rows.get('characters')!.find(item => item.id === source.id)!
    expect(receipt.contentHash).toBe(await hashNarrativeDomainSourceV1(capture, 'characters', row))
    expect(row.narrativeAliasesV1).toEqual(['递信人'])
    expect(receipt.mode).toBe('author-declaration')
    const repeated = await confirmNarrativeDomainAnnotationsV1({ ...source.input, expectedSourceHash: receipt.contentHash, annotations })
    expect(repeated).toEqual(receipt)
    expect((await db.worldReleases.get(source.release.id!))!.manifestJson).toBe(source.release.manifestJson)
  })

  it('来源变化、未登记字段以及嵌套伪造确认都拒绝，失败不修改记录', async () => {
    const source = await fixture()
    const before = (await db.characters.get(source.id))!
    await expect(confirmNarrativeDomainAnnotationsV1({ ...source.input, annotations: { name: '改名' } as any }))
      .rejects.toThrow('不能通过此入口')
    await expect(confirmNarrativeDomainAnnotationsV1({ ...source.input, annotations: {
      narrativeAliasesV1: [{ narrativeAuthorityV1: {} }],
    } as any })).rejects.toThrow('系统确认凭据')
    expect(await db.characters.get(source.id)).toEqual(before)
    await db.characters.update(source.id, { name: '作者已改名' })
    const changed = await db.characters.get(source.id)
    await expect(confirmNarrativeDomainAnnotationsV1({ ...source.input, annotations: { narrativeAliasesV1: ['旧候选'] } }))
      .rejects.toThrow('重新审阅')
    expect(await db.characters.get(source.id)).toEqual(changed)
  })

  it('原始 UTF-8 证据有效才可确认，修改原文后旧 span/hash 被拒绝', async () => {
    const source = await fixture()
    const row = (await db.characters.get(source.id))!
    const sourceContentHash = await hashNarrativeBytesV1(row.name)
    const evidence = { evidenceKey: 'name-proof', source: { self: true as const }, fieldPointer: '/name',
      sourceContentHash, normalizationVersion: 'raw-utf8-v1' as const,
      start: 0, end: new TextEncoder().encode(row.name).length, spanHash: sourceContentHash, supportRole: 'supports' as const }
    const receipt = await confirmNarrativeDomainAnnotationsV1({ ...source.input, annotations: { narrativeEvidenceV1: [evidence] } })
    await db.characters.update(source.id, { name: '完全不同的姓名' })
    const capture = await source.capture(), changed = capture.rows.get('characters')!.find(item => item.id === source.id)!
    const expectedSourceHash = await hashNarrativeDomainSourceV1(capture, 'characters', changed)
    await expect(confirmNarrativeDomainAnnotationsV1({ ...source.input, expectedSourceHash,
      annotations: { narrativeEvidenceV1: [evidence] } })).rejects.toThrow('hash 不符')
    expect((await db.characters.get(source.id))!.narrativeAuthorityV1).toEqual(receipt)
  })

  it('World 所有者注释经完整恢复改变本地主键，内容确认 hash 仍可复验', async () => {
    const source = await fixture()
    const receipt = await confirmNarrativeDomainAnnotationsV1({ ...source.input, annotations: { narrativeAliasesV1: ['客人'] } })
    const backup = await deriveExportProjectJSON(source.scope.projectId)
    const restoredProject = await deriveImportProjectJSON(backup)
    const project = (await db.projects.get(restoredProject))!, work = (await db.works.get(project.activeWorkId!))!
    const restored = await captureNarrativeDomainV1({ scope: { projectId: restoredProject, worldId: project.activeWorldId!, workId: work.id! },
      owner: { kind: 'work', workCode: work.code } })
    const row = restored.rows.get('characters')!.find(item => item.narrativeAuthorityV1?.confirmationUid === receipt.confirmationUid)!
    expect(row.id).not.toBe(source.id)
    // Import of a colliding public World code currently forks its identity.
    // A fork must require review rather than silently reuse the old namespace.
    const freshHash = await hashNarrativeDomainSourceV1(restored, 'characters', row)
    expect(row.narrativeAuthorityV1!.contentHash).toBe(receipt.contentHash)
    if (restored.worldCode === (await source.capture()).worldCode) expect(freshHash).toBe(receipt.contentHash)
    else expect(freshHash).not.toBe(receipt.contentHash)
  })

  it('独立 World 确认不暗读活动 Work；读取作品必须声明稳定来源身份', async () => {
    const source = await fixture()
    const world = (await db.worlds.get(source.scope.worldId))!, work = (await db.works.get(source.scope.workId))!
    const owner = { kind: 'world' as const, worldCode: world.code, sourceWorkCode: null }
    const isolated = await captureNarrativeDomainV1({ scope: source.scope, owner })
    expect(isolated.rows.get('characters')!.some(row => row.id === source.id)).toBe(true)
    expect(isolated.rows.get('chapters')).toEqual([])
    const receipt = await confirmNarrativeDomainAnnotationsV1({ ...source.input, owner, annotations: { narrativeAliasesV1: ['世界中的旅人'] } })
    expect(receipt.mode).toBe('author-declaration')
    const chapter = (await db.chapters.where('projectId').equals(source.scope.projectId).toArray())[0]!
    await expect(confirmNarrativeDomainAnnotationsV1({ ...source.input, owner, table: 'chapters', recordId: chapter.id!, annotations: {} }))
      .rejects.toThrow('不属于当前作用域')
    const derived = await captureNarrativeDomainV1({ scope: source.scope, owner: { ...owner, sourceWorkCode: work.code } })
    expect(derived.rows.get('chapters')!.length).toBeGreaterThan(0)
    await expect(captureNarrativeDomainV1({ scope: source.scope, owner: { ...owner, sourceWorkCode: 'WK-AAAAAAAA' } }))
      .rejects.toThrow()
  })
})
