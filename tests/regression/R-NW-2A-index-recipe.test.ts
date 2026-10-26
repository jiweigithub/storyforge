import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { compileNarrativeIndexV1, narrativeLexicalTermsV1, resolveNarrativeIndexClosureV1, verifyNarrativeIndexV1 } from '../../src/lib/world-engine/narrative-index'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1, hashNarrativeValueV1 } from '../../src/lib/world-engine/narrative-json'
import { NARRATIVE_KINDS_V1 } from '../../src/lib/types/narrative-ir'
import { narrativeIRFixture } from '../helpers/narrative-ir-fixture'
import type { NarrativeDomainProjectionV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

describe('NW-2A · 冻结索引的确定性 recipe（尚非 v4 发布入口）', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  async function setup() {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const projection = await projectNarrativeDomainsV1(fixture.input)
    // Test compiler input root only. The eventual v4 release compiler binds
    // this field to its full semantic payload, rather than this fixture root.
    const input = { inputRootHash: await hashNarrativeValueV1(projection), projection }
    const index = await compileNarrativeIndexV1(input)
    const { indexHash, ...body } = index
    expect(indexHash).toBe(createHash('sha256').update(canonicalNarrativeJsonV1(body)).digest('hex'))
    return { fixture, input, index }
  }

  it('超过一个数字分段的索引仍与完整严格规范编码一致，公开结果保持可变', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const prose = 'abc '.repeat(80_000) + '尾😀\r\n'
    await db.storyTimelineEvents.update(fixture.event.id, { description: prose })
    await fixture.confirm('storyTimelineEvents', fixture.event.id, {
      narrativeEvidenceV1: [await fixture.selfEvidence('storyTimelineEvents', fixture.event.id, 'description')],
    })
    const projection = await projectNarrativeDomainsV1(fixture.input)
    const input = { inputRootHash: await hashNarrativeValueV1(projection), projection }
    const index = await compileNarrativeIndexV1({ ...input, retainIncrementalShards: false })
    expect(index.indexes.sourcePostings.some(row => row.groups.some(group => group.chunkIndexes.length > 256))).toBe(true)
    const { indexHash, ...body } = index
    expect(indexHash).toBe(createHash('sha256').update(canonicalNarrativeJsonV1(body)).digest('hex'))
    expect(index.indexes.byKind.filter(row => row.recordIndexes.length)).toHaveLength(8)
    expect(Object.isFrozen(index)).toBe(false)
    expect(Object.isFrozen(index.indexes.sourcePostings[0].groups[0].chunkIndexes)).toBe(false)
  })

  it('编译过的外部对象不获得快速编码权限，深层 accessor 和自重算篡改仍被拒绝', async () => {
    const { input, index } = await setup()
    let getterCalls = 0
    const accessor = structuredClone(index)
    Object.defineProperty(accessor.indexes.sourcePostings[0].groups[0].chunkIndexes, 0, {
      enumerable: true, get() { getterCalls++; return 0 },
    })
    await expect(verifyNarrativeIndexV1(accessor, input)).rejects.toThrow('accessor')
    expect(getterCalls).toBe(0)
    const tampered = structuredClone(index)
    tampered.indexes.dependencies[0].requiredIndexes.push(999_999)
    const { indexHash: _prior, ...body } = tampered
    tampered.indexHash = await hashNarrativeValueV1(body)
    await expect(verifyNarrativeIndexV1(tampered, input)).rejects.toThrow('index-integrity')
  })

  it('固定身份、原始 CRLF 和补充平面字符的索引 golden 不随环境和执行时间漂移', async () => {
    const fixture = await narrativeIRFixture()
    const sourceKeys = fixture.bundle.records.map(record => record.provenance.sourceResourceKey).sort()
    const projection: NarrativeDomainProjectionV1 = {
      version: 1, bundle: fixture.bundle, sources: fixture.sources, sourceGroups: fixture.bundle.records.map(record => ({ semanticId: record.semanticId, worldGroupSourceUid: null })),
      dependencyEvidence: [], coverage: { version: 1, eligibleSelected: sourceKeys, projectedSourceKeys: sourceKeys, explicitlyUnsupportedSourceKeys: [],
        gaps: [], excluded: [], fields: [], declaredAtoms: fixture.bundle.records.length, projectedAtoms: fixture.bundle.records.length, sourceSpans: [] },
    }
    const index = await compileNarrativeIndexV1({ inputRootHash: await hashNarrativeValueV1(projection), projection })
    const observed = { schema: 'storyforge.narrative-index-recipe-golden', version: 1,
      evidenceLevel: 'deterministic-fixture', modelCalls: 0,
      inputRootHash: index.inputRootHash, recipeVersion: index.recipeVersion, indexHash: index.indexHash,
      recordKeys: index.indexes.recordKeys, chunkHashes: index.indexes.chunks.map(chunk => chunk.spanHash),
      adjacency: index.indexes.adjacency, unknownTime: index.indexes.unknownTime,
      terms: index.indexes.sourcePostings.map(posting => posting.term),
    }
    const path = 'tests/acceptance/narrative-world/index-recipe-golden-v1.json'
    if (process.env.NW_CAPTURE_INDEX_GOLDEN === '1') writeFileSync(path, `${JSON.stringify(observed, null, 2)}\n`, { flag: 'wx' })
    expect(observed).toEqual(JSON.parse(readFileSync(path, 'utf8')))
  })

  it('确定性构建八类映射、认知流、揭示和独立意图集合；来源数组排列不影响索引', async () => {
    const { input, index } = await setup()
    expect(index.indexes.byKind.filter(bucket => bucket.recordIndexes.length).map(bucket => bucket.kind).sort()).toEqual([...NARRATIVE_KINDS_V1].sort())
    expect(index.indexes.epistemic).toHaveLength(1)
    expect(index.indexes.epistemic[0]).toMatchObject({ attitude: 'believe', transition: 'acquire', acquiredAt: { kind: 'tick', value: '2' } })
    expect(index.indexes.disclosures[0].audienceKeys).toEqual(['reader'])
    expect(index.indexes.developments[0]).toMatchObject({ modality: 'intent', state: 'open' })
    expect(index.indexes.intentIndexes).toContain(index.indexes.developments[0].recordIndex)
    expect(await compileNarrativeIndexV1({ ...input, projection: { ...input.projection, sources: [...input.projection.sources].reverse() } })).toEqual(index)
    expect(await verifyNarrativeIndexV1(index, input)).toEqual(index)
    expect(index.indexes.chunks.every(chunk => chunk.end - chunk.start <= 1024)).toBe(true)
    for (const chunk of index.indexes.chunks) {
      const source = input.projection.sources.find(item => item.sourceResourceKey === chunk.sourceResourceKey
        && item.sourceRevision === chunk.sourceRevision && item.fieldPointer === chunk.fieldPointer)!
      const bytes = new TextEncoder().encode(source.text).slice(chunk.start, chunk.end)
      expect(await hashNarrativeBytesV1(bytes)).toBe(chunk.spanHash)
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow()
    }
  })

  it('直接构建与保留增量分片的完整字节相同，跨来源偏移和外部篡改校验保持', async () => {
    const { input, index } = await setup()
    const directInput = { ...input, retainIncrementalShards: false }
    const direct = await compileNarrativeIndexV1(directInput)
    expect(canonicalNarrativeJsonV1(direct)).toBe(canonicalNarrativeJsonV1(index))
    expect(direct.indexes.sourcePostings.some(posting => posting.groups.some(group =>
      group.chunkIndexes.some(position => position > 0)))).toBe(true)
    const changed = structuredClone(direct)
    changed.indexes.sourcePostings[0].groups[0].chunkIndexes = [direct.indexes.chunks.length]
    await expect(verifyNarrativeIndexV1(changed, directInput)).rejects.toThrow('index-integrity')
    expect(await verifyNarrativeIndexV1(index, directInput)).toEqual(index)
  })

  it('原文、根 hash、编译版本、倒排或额外字段被篡改均拒绝，不接受自行重算的包内 hash', async () => {
    const { input, index } = await setup()
    for (const corrupt of [
      { ...index, inputRootHash: '0'.repeat(64) },
      { ...index, recipeVersion: 'future-v99' },
      { ...index, extra: 'must-not-be-ignored' },
      { ...index, indexes: { ...index.indexes, sourcePostings: [] } },
    ]) await expect(verifyNarrativeIndexV1(corrupt, input)).rejects.toThrow('index-integrity')
    const changed = structuredClone(input)
    changed.projection.sources[0].text += '\r\n改写'
    await expect(compileNarrativeIndexV1(changed)).rejects.toThrow()
    const corruptCoverage = structuredClone(input)
    corruptCoverage.projection.coverage.eligibleSelected.pop()
    await expect(compileNarrativeIndexV1(corruptCoverage)).rejects.toThrow('index-coverage')
  })

  it('UTF-8 关键词跨度保持原文；ASCII 折小写，汉字和补充平面字符不依赖地区分词', () => {
    const raw = 'ABC 真相\r\nA😀B'
    const tokens = narrativeLexicalTermsV1(raw)
    expect(tokens.slice(0, 4)).toEqual([
      { term: 'abc', start: 0, end: 3 }, { term: '真', start: 4, end: 7 },
      { term: '真相', start: 4, end: 10 }, { term: '相', start: 7, end: 10 },
    ])
    const bytes = new TextEncoder().encode(raw)
    for (const token of tokens) {
      const exact = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(token.start, token.end))
      expect(exact.replace(/[A-Z]/g, char => char.toLowerCase())).toBe(token.term)
    }
    expect(tokens.find(token => token.term === '😀')).toMatchObject({ start: 13, end: 17 })
  })

  it('部分公开证据不能洗白其余原文，跨权限边界的关键词也继承完整跨度权限', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    await db.storyTimelineEvents.update(fixture.event.id, { description: '公开秘密' })
    const evidence = await fixture.selfEvidence('storyTimelineEvents', fixture.event.id, 'description')
    await fixture.confirm('storyTimelineEvents', fixture.event.id, { narrativeEvidenceV1: [{ ...evidence, end: 6, spanHash: await hashNarrativeBytesV1('公开') }] })
    const projection = await projectNarrativeDomainsV1(fixture.input)
    const index = await compileNarrativeIndexV1({ inputRootHash: await hashNarrativeValueV1(projection), projection })
    const evidenceRevision = await hashNarrativeBytesV1('公开秘密')
    const postings = (term: string) => index.indexes.sourcePostings.find(item => item.term === term)!.groups.map(group => ({ ...group,
      chunkIndexes: group.chunkIndexes.filter(chunk => index.indexes.chunks[chunk].sourceResourceKey.endsWith(`:${fixture.event.row.ragDocumentId}`)
        && index.indexes.chunks[chunk].sourceRevision === evidenceRevision),
    })).filter(group => group.chunkIndexes.length)
    expect(postings('公开').map(group => group.visibility.class)).toEqual(['public'])
    expect(postings('秘密').map(group => group.visibility.class)).toEqual(['unclassified'])
    const crossing = postings('开秘')
    expect(crossing.map(group => group.visibility.class)).toEqual(['unclassified'])
    expect(crossing[0].chunkIndexes).toHaveLength(2)
    expect(index.indexes.sourcePostings.find(item => item.term === '秘密')!.groups.some(group => group.visibility.class === 'public')).toBe(false)
    expect(index.indexes.atomPostings.some(item => item.term === '秘密')).toBe(false)
  })

  it('重复词按完整原文跨度入索引，跨块、跨权限、长 ASCII 和末尾词不丢失或串权', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const publicText = '公开'.repeat(300)
    const text = publicText + '公开秘密'.repeat(150) + 'XYZ'.repeat(90) + '😀尾'
    await db.storyTimelineEvents.update(fixture.event.id, { description: text })
    const evidence = await fixture.selfEvidence('storyTimelineEvents', fixture.event.id, 'description')
    await fixture.confirm('storyTimelineEvents', fixture.event.id, { narrativeEvidenceV1: [{ ...evidence,
      end: new TextEncoder().encode(publicText).length, spanHash: await hashNarrativeBytesV1(publicText),
    }] })
    const projection = await projectNarrativeDomainsV1(fixture.input)
    const input = { inputRootHash: await hashNarrativeValueV1(projection), projection }
    const index = await compileNarrativeIndexV1({ ...input, retainIncrementalShards: false })
    const retained = await compileNarrativeIndexV1(input)
    expect(canonicalNarrativeJsonV1(index)).toBe(canonicalNarrativeJsonV1(retained))
    const revision = await hashNarrativeBytesV1(text)
    const chunks = index.indexes.chunks.map((chunk, position) => ({ ...chunk, position })).filter(chunk =>
      chunk.sourceResourceKey.endsWith(`:${fixture.event.row.ragDocumentId}`)
      && chunk.sourceRevision === revision && chunk.fieldPointer === '/description')
    expect(chunks.length).toBeGreaterThan(3)
    expect(new Set(chunks.map(chunk => chunk.visibility.class))).toEqual(new Set(['public', 'unclassified']))
    const positions = new Set(chunks.map(chunk => chunk.position))
    const expected = new Map<string, Set<number>>()
    // Deliberately use a per-occurrence full overlap scan as the reference,
    // independent of the compiler's monotone range batching.
    for (const token of narrativeLexicalTermsV1(text)) {
      const touched = chunks.filter(chunk => chunk.start < token.end && chunk.end > token.start)
      const policy = touched.every(chunk => chunk.visibility.class === 'public') ? 'public' : 'unclassified'
      const key = JSON.stringify([token.term, policy]), members = expected.get(key) ?? new Set<number>()
      touched.forEach(chunk => members.add(chunk.position)); expected.set(key, members)
    }
    const actual = new Map<string, Set<number>>()
    for (const posting of index.indexes.sourcePostings) for (const group of posting.groups) {
      const members = group.chunkIndexes.filter(position => positions.has(position))
      if (members.length) actual.set(JSON.stringify([posting.term, group.visibility.class]), new Set(members))
    }
    expect(actual).toEqual(expected)
    expect(actual.has(JSON.stringify(['公开', 'public']))).toBe(true)
    expect(actual.has(JSON.stringify(['公开', 'unclassified']))).toBe(true)
    expect(actual.get(JSON.stringify(['尾', 'unclassified']))).toEqual(new Set([chunks.at(-1)!.position]))
  })

  it('依赖闭包精确包含主体、事件和时制，预算不足时阻断而不是静默截断', async () => {
    const { index } = await setup()
    const belief = index.indexes.epistemic[0]
    const closure = resolveNarrativeIndexClosureV1(index, [belief.recordIndex], 100)
    expect(closure).toContain(belief.recordIndex)
    expect(closure).toContain(belief.holderIndex)
    expect(closure).toContain(belief.propositionIndex)
    expect(closure).toContain(belief.sourceEventIndex)
    expect(closure).not.toContain(index.indexes.intentIndexes[0])
    expect(() => resolveNarrativeIndexClosureV1(index, [belief.recordIndex], 1)).toThrow('index-budget')
    const broken = structuredClone(index)
    broken.indexes.dependencies.pop()
    expect(() => resolveNarrativeIndexClosureV1(broken, [belief.recordIndex], 100)).toThrow('index-reference')
    expect(canonicalNarrativeJsonV1(resolveNarrativeIndexClosureV1(index, [...closure].reverse(), 100))).toBe(canonicalNarrativeJsonV1(closure))
  })

  it('确定因果边缺证据时不降级成有效边，也不把普通时间先后推成因果', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    await fixture.confirm('characterRelations', fixture.relation.id, { narrativeDependenciesV1: [{
      target: fixture.eventRef, role: 'causes', evidenceKeys: ['self'],
    }] })
    const projection = await projectNarrativeDomainsV1(fixture.input)
    expect(projection.dependencyEvidence).toHaveLength(1)
    const input = { inputRootHash: await hashNarrativeValueV1(projection), projection }
    const index = await compileNarrativeIndexV1(input)
    expect(index.indexes.adjacency.filter(edge => edge.kind === 'causes').every(edge => edge.evidenceIds.length > 0 && edge.basis === 'declared')).toBe(true)
    await expect(compileNarrativeIndexV1({ ...input, projection: { ...projection, dependencyEvidence: [] } })).rejects.toThrow('index-dependency-evidence')
  })
})
