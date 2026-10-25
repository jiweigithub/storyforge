import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { makeRagEntryKey } from '../../src/lib/retrieval/rag-library'
import { captureNarrativeDomainV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { prepareNarrativeCandidateV1, compileNarrativeAnnotationProposalV1, assertNarrativeCandidateBaselineV1 } from '../../src/lib/world-engine/narrative-domain-candidate'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { CANON_RESOURCE_PROVIDER_V1, CanonResourceProviderError } from '../../src/lib/context-gateway/canon-provider'

async function setup() {
  const fixture = await seedConfirmedNarrativeDomainV1()
  const text = '传信😀\r\n一封信。一封信。'
  await db.storyTimelineEvents.update(fixture.event.id, { description: text })
  const prepared = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection: {
    table: 'storyTimelineEvents', sourceUid: fixture.event.row.ragDocumentId,
    owner: fixture.input.owner, entryKeys: [makeRagEntryKey(fixture.event.row.ragDocumentId, 'description')],
  } })
  const proposal = { annotations: { narrativeEvidenceV1: [{ evidenceKey: 'letter', source: { self: true },
    fieldPointer: '/description', quote: '一封信', occurrence: 1, supportRole: 'supports' }] }, clearFields: [] }
  return { fixture, prepared, proposal, text }
}

describe('NW-1C · 原文选择和候选协议', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('通过登记源读取完整原文，UTF-8 证据由逐字引文和明确出现序号生成', async () => {
    const { fixture, prepared, proposal, text } = await setup()
    expect(prepared.baseline.originalFields[0].text).toBe(text)
    expect(prepared.assembled.sourceEvidence?.[0].delivery).toBe('full')
    const result = await compileNarrativeAnnotationProposalV1({ ...prepared, raw: JSON.stringify(proposal) })
    const evidence = result.annotations.narrativeEvidenceV1![0]
    expect(evidence.start).toBe(new TextEncoder().encode('传信😀\r\n一封信。').length)
    expect(evidence.end - evidence.start).toBe(9)
    expect((await db.storyTimelineEvents.get(fixture.event.id))!.narrativeEvidenceV1).not.toEqual(result.annotations.narrativeEvidenceV1)
    expect(JSON.stringify(prepared.baseline)).not.toContain('recordId')
  })

  it('拒绝伪造确认、本地引用、伪造证据哈希、不存在的引文和未选择的来源', async () => {
    const { prepared, proposal } = await setup()
    const variants = [
      { ...proposal, annotations: { narrativeAuthorityV1: { confirmedAt: 1 } } },
      { ...proposal, annotations: { narrativeTimeV1: { narratedAt: { chapter: { chapterId: 1, sourceUid: 'stolen' }, spanStart: 0 } } } },
      { ...proposal, annotations: { narrativeEvidenceV1: [{ ...proposal.annotations.narrativeEvidenceV1[0], quote: '不在原文' }] } },
      { ...proposal, annotations: { narrativeEvidenceV1: [{ ...proposal.annotations.narrativeEvidenceV1[0], spanHash: 'a'.repeat(64) }] } },
      { ...proposal, annotations: { narrativeEvidenceV1: [{ ...proposal.annotations.narrativeEvidenceV1[0], fieldPointer: '/title' }] } },
    ]
    for (const invalid of variants) await expect(compileNarrativeAnnotationProposalV1({ ...prepared, raw: JSON.stringify(invalid) })).rejects.toThrow()
  })

  it('抽取中途来源改动、停用读取策略和超预算都不能悄悄继续', async () => {
    const { fixture, prepared } = await setup()
    await db.storyTimelineEvents.update(fixture.event.id, { description: '已修改' })
    const changed = await captureNarrativeDomainV1(fixture.input)
    await expect(assertNarrativeCandidateBaselineV1(changed, prepared.baseline)).rejects.toThrow('已变化')
    await db.storyTimelineEvents.update(fixture.event.id, { ragPolicy: { enabled: false } })
    await expect(prepareNarrativeCandidateV1({ scope: fixture.scope, selection: prepared.selection })).rejects.toThrow('停用')
    await db.storyTimelineEvents.update(fixture.event.id, { ragPolicy: { enabled: true }, description: '完整原文'.repeat(200) })
    await expect(assembleContext({ projectId: fixture.scope.projectId, scope: fixture.scope, sourceKeys: ['ragSelection'],
      ragReadMode: 'original-evidence-v1', ragEntryKeys: prepared.selection.entryKeys, inputBudgetTokens: 30 })).rejects.toThrow('超过输入预算')
  })

  it('没有 IR 投影的登记原文也可作证据，选定字段变化仍使候选失效', async () => {
    const { fixture, prepared } = await setup()
    const id = await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', { worldOrigin: '驿站由流亡者共同建立。', createdAt: Date.now(), updatedAt: Date.now() }, { owner: 'world' }))
    const source = (await db.worldviews.get(id))!
    const selected = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection: { ...prepared.selection,
      entryKeys: [...prepared.selection.entryKeys, makeRagEntryKey(source.ragDocumentId!, 'worldOrigin')] } })
    const compiled = await compileNarrativeAnnotationProposalV1({ ...selected, raw: JSON.stringify({ annotations: { narrativeEvidenceV1: [{
      evidenceKey: 'origin', source: { worldviewId: null, sourceUid: source.ragDocumentId }, fieldPointer: '/worldOrigin',
      quote: '流亡者共同建立', occurrence: 0, supportRole: 'context',
    }] }, clearFields: [] }) })
    expect(compiled.annotations.narrativeEvidenceV1![0].source).toEqual({ worldviewId: id, sourceUid: source.ragDocumentId })
    await db.worldviews.update(id, { worldOrigin: '来源已经改变。' })
    await expect(assertNarrativeCandidateBaselineV1(await captureNarrativeDomainV1(fixture.input), selected.baseline)).rejects.toThrow('已变化')
    await expect(prepareNarrativeCandidateV1({ scope: fixture.scope, selection: { ...selected.selection,
      table: 'worldviews', sourceUid: source.ragDocumentId! } })).rejects.toThrow('目标尚未登记')
  })

  it('实体的已选简介变化会使待采纳候选失效，即使该字段不在旧语义投影中', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const actor = (await db.characters.get(fixture.ids.a))!
    const prepared = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection: {
      table: 'characters', sourceUid: actor.ragDocumentId!, owner: fixture.input.owner,
      entryKeys: [makeRagEntryKey(actor.ragDocumentId!, 'shortDescription')],
    } })
    expect(prepared.baseline.originalFields[0].text).toBe(actor.shortDescription)
    expect(actor.shortDescription).not.toBe('已改成另一位同名人物的简介')
    await db.characters.update(actor.id!, { shortDescription: '已改成另一位同名人物的简介' })
    const changed = await captureNarrativeDomainV1(fixture.input)
    await expect(assertNarrativeCandidateBaselineV1(changed, prepared.baseline)).rejects.toThrow('原文已变化')
  })

  it('逐字校验所有已选来源，但不把未选择的简介变化误报为候选过期', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const actor = (await db.characters.get(fixture.ids.a))!, peer = (await db.characters.get(fixture.ids.b))!
    await db.characters.update(peer.id!, { shortDescription: '桥边😀\r\n等候。' })
    const prepared = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection: {
      table: 'characters', sourceUid: actor.ragDocumentId!, owner: fixture.input.owner,
      entryKeys: [makeRagEntryKey(actor.ragDocumentId!, 'name'), makeRagEntryKey(peer.ragDocumentId!, 'shortDescription')],
    } })
    await db.characters.update(actor.id!, { shortDescription: '未被选择的简介可以独立修改' })
    await expect(assertNarrativeCandidateBaselineV1(await captureNarrativeDomainV1(fixture.input), prepared.baseline)).resolves.toBeUndefined()
    // Normalizing the selected raw bytes is a source change even if a reader
    // would consider the two strings semantically equivalent.
    await db.characters.update(peer.id!, { shortDescription: '桥边😀\n等候。' })
    await expect(assertNarrativeCandidateBaselineV1(await captureNarrativeDomainV1(fixture.input), prepared.baseline)).rejects.toThrow('原文已变化')
  })

  it('已有子记录只能保留登记身份，模型不得按文字重新分配或自造身份', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const actor = (await db.characters.get(fixture.ids.a))!
    const prepared = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection: {
      table: 'foreshadows', sourceUid: fixture.foreshadow.ragDocumentId!, owner: fixture.input.owner,
      entryKeys: [makeRagEntryKey(fixture.foreshadow.ragDocumentId!, 'description'), makeRagEntryKey(actor.ragDocumentId!, 'name')],
    } })
    const child = { ...fixture.development, statement: '作者修订了这条承诺', owners: [{ characterId: null, sourceUid: actor.ragDocumentId }] }
    const raw = (value: unknown) => JSON.stringify({ annotations: { narrativeDevelopmentsV1: [value] }, clearFields: [] })
    const compiled = await compileNarrativeAnnotationProposalV1({ ...prepared, raw: raw(child) })
    expect(compiled.subKeys).toEqual([fixture.development.semanticSubKey])
    const { semanticSubKey: _key, ...missingKey } = child
    await expect(compileNarrativeAnnotationProposalV1({ ...prepared, raw: raw(missingKey) })).rejects.toThrow('保留稳定身份')
    await expect(compileNarrativeAnnotationProposalV1({ ...prepared, raw: raw({ ...child, semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000099' }) })).rejects.toThrow('不能签发')
  })

  it('调用模型前的目录变化只允许从头重读一次，连续变化时停止并保留错误', async () => {
    const { fixture, prepared } = await setup()
    const original = CANON_RESOURCE_PROVIDER_V1.listMetadata.bind(CANON_RESOURCE_PROVIDER_V1)
    const reader = vi.spyOn(CANON_RESOURCE_PROVIDER_V1, 'listMetadata')
      .mockRejectedValueOnce(new CanonResourceProviderError('catalog-mutated', 'fixture: directory changed'))
      .mockImplementation(original)
    const current = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection: prepared.selection })
    expect(JSON.parse(current.assembled.text).catalogReadRestarts).toBe(1)
    expect(current.baselineHash).toBe(prepared.baselineHash)
    reader.mockReset().mockRejectedValue(new CanonResourceProviderError('catalog-mutated', 'fixture: still changing'))
    await expect(prepareNarrativeCandidateV1({ scope: fixture.scope, selection: prepared.selection })).rejects.toThrow('still changing')
    expect(reader).toHaveBeenCalledTimes(2)
  })
})
