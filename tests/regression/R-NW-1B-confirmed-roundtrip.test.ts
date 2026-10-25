import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { NARRATIVE_KINDS_V1 } from '../../src/lib/types/narrative-ir'

describe('NW-1B · 已确认闭包的完整备份往返', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('空 FK 的 absent/null 规范化保持八类原子、证据、依赖和确认；实际内容修改仍失效', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const before = await projectNarrativeDomainsV1(fixture.input)
    expect(new Set(before.bundle.records.map(row => row.kind))).toEqual(new Set(NARRATIVE_KINDS_V1))
    const backup = await deriveExportProjectJSON(fixture.scope.projectId)
    const projectId = await deriveImportProjectJSON(backup)
    const work = (await db.works.where('projectId').equals(projectId).toArray()).find(row => row.code === fixture.input.owner.workCode)!
    const input = { ...fixture.input, scope: { projectId, workId: work.id!, worldId: work.worldId } }
    const after = await projectNarrativeDomainsV1(input)
    expect(after.bundle).toEqual(before.bundle)
    expect(after.sources).toEqual(before.sources)
    expect(after.coverage).toEqual(before.coverage)
    expect(after.dependencyEvidence).toEqual(before.dependencyEvidence)
    const original = (await db.temporalFacts.get(fixture.ids.fact))!
    const restored = (await db.temporalFacts.where('projectId').equals(projectId).toArray()).find(row => row.ragDocumentId === original.ragDocumentId)!
    await db.temporalFacts.update(restored.id!, { value: `${restored.value}（作者已改）` })
    const changed = await projectNarrativeDomainsV1(input)
    expect(changed.coverage.gaps).toContainEqual(expect.objectContaining({ table: 'temporalFacts', code: 'stale' }))
    expect(changed.bundle.records.some(row => row.kind === 'epistemic-event')).toBe(false)
    expect((await projectNarrativeDomainsV1(fixture.input)).bundle).toEqual(before.bundle)
    expect((await db.worldReleases.get(fixture.release.id!))!.manifestJson).toBe(fixture.release.manifestJson)
  })
})
