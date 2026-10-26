import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { compileNarrativeIndexIncrementalV1, compileNarrativeIndexV1, verifyNarrativeIndexV1 } from '../../src/lib/world-engine/narrative-index'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1, hashNarrativeValueV1 } from '../../src/lib/world-engine/narrative-json'

type Token = { term: string; start: number; end: number }
function knownText() {
  // Hand-listed token spans for a deliberately limited alphabet. This oracle
  // does not call the production lexical scanner or range batching routine.
  const pieces: Array<{ text: string; tokens: Token[] }> = [
    { text: '甲😀乙', tokens: [
      { term: '甲', start: 0, end: 3 }, { term: '甲😀', start: 0, end: 7 },
      { term: '😀', start: 3, end: 7 }, { term: '😀乙', start: 3, end: 10 }, { term: '乙', start: 7, end: 10 },
    ] },
    { text: 'Ab_7', tokens: [{ term: 'ab_7', start: 0, end: 4 }] },
    { text: '乙甲', tokens: [{ term: '乙', start: 0, end: 3 }, { term: '乙甲', start: 0, end: 6 }, { term: '甲', start: 3, end: 6 }] },
    { text: 'Z'.repeat(257), tokens: [
      { term: 'z'.repeat(128), start: 0, end: 128 }, { term: 'z'.repeat(128), start: 128, end: 256 }, { term: 'z', start: 256, end: 257 },
    ] },
  ]
  let text = '', offset = 0
  const tokens: Token[] = [], boundaries: number[] = [0]
  for (let index = 0; index < 160; index++) {
    const piece = pieces[(index * index + index + Math.floor(index / 3)) % pieces.length]
    tokens.push(...piece.tokens.map(token => ({ ...token, start: token.start + offset, end: token.end + offset })))
    text += piece.text + ' | '
    offset += Buffer.byteLength(piece.text) + 3
    boundaries.push(offset)
  }
  return { text, tokens, boundaries }
}

describe('NW-2E · 倒排成员完整性与增量私有分片隔离', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('非均匀重复、补充平面、长 ASCII 与重叠证据按每次出现完整归属到所有块', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1(), raw = knownText()
    await db.storyTimelineEvents.update(fixture.event.id, { description: raw.text })
    const evidence = await fixture.selfEvidence('storyTimelineEvents', fixture.event.id, 'description')
    const bytes = new TextEncoder().encode(raw.text)
    const ranges = [[0, raw.boundaries[60]], [raw.boundaries[45], raw.boundaries[100]]] as const
    await fixture.confirm('storyTimelineEvents', fixture.event.id, { narrativeEvidenceV1: await Promise.all(ranges.map(async ([start, end], index) => ({
      ...evidence, evidenceKey: `window-${index}`, start, end, spanHash: await hashNarrativeBytesV1(bytes.slice(start, end)),
    }))) })
    const projection = await projectNarrativeDomainsV1(fixture.input)
    const input = { inputRootHash: await hashNarrativeValueV1(projection), projection }
    const retained = await compileNarrativeIndexV1(input)
    const direct = await compileNarrativeIndexV1({ ...input, retainIncrementalShards: false })
    expect(canonicalNarrativeJsonV1(direct)).toBe(canonicalNarrativeJsonV1(retained))
    const revision = await hashNarrativeBytesV1(raw.text)
    const chunks = direct.indexes.chunks.map((chunk, position) => ({ ...chunk, position })).filter(chunk =>
      chunk.sourceResourceKey.endsWith(`:${fixture.event.row.ragDocumentId}`)
      && chunk.sourceRevision === revision && chunk.fieldPointer === '/description')
    expect(chunks.length).toBeGreaterThan(5)
    expect(new Set(chunks.map(chunk => chunk.visibility.class))).toEqual(new Set(['public', 'unclassified']))
    const selected = new Set(chunks.map(chunk => chunk.position)), expected = new Map<string, number[]>()
    for (const token of raw.tokens) {
      const touched = chunks.filter(chunk => token.start < chunk.end && token.end > chunk.start)
      expect(touched.length).toBeGreaterThan(0)
      const visibility = touched.every(chunk => chunk.visibility.class === 'public') ? 'public' : 'unclassified'
      const key = JSON.stringify([token.term, visibility]), values = expected.get(key) ?? []
      expected.set(key, [...new Set([...values, ...touched.map(chunk => chunk.position)])].sort((a, b) => a - b))
    }
    const actual = new Map<string, number[]>()
    for (const posting of direct.indexes.sourcePostings) for (const group of posting.groups) {
      const members = group.chunkIndexes.filter(position => selected.has(position))
      if (members.length) actual.set(JSON.stringify([posting.term, group.visibility.class]), members)
    }
    expect(actual).toEqual(expected)
    expect([...expected.keys()].some(key => key.includes('unclassified'))).toBe(true)
  })

  it('调用者改写索引、块、权限和成员数组不能污染下一次增量或其他读取者', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const projection = await projectNarrativeDomainsV1(fixture.input)
    const input = { inputRootHash: await hashNarrativeValueV1(projection), projection }
    const base = await compileNarrativeIndexV1(input)
    const expected = canonicalNarrativeJsonV1(base), originalHash = base.indexHash
    base.indexHash = '0'.repeat(64)
    base.indexes.recordKeys.reverse()
    base.indexes.chunks[0].recordIndexes.push(999999)
    base.indexes.chunks[0].sourceResourceKey = 'caller-poison'
    base.indexes.sourcePostings[0].groups[0].chunkIndexes.splice(0, 1, 999999)
    base.indexes.sourcePostings[0].groups[0].visibility.audienceKeys.push('caller-poison')
    base.indexes.atomPostings[0].recordIndexes.push(999999)
    const incremental = await compileNarrativeIndexIncrementalV1(input, base)
    expect(incremental.receipt.baseIndexHash).toBe(originalHash)
    expect(incremental.receipt.rebuiltSources).toHaveLength(0)
    expect(incremental.receipt.reusedSources.length).toBeGreaterThan(0)
    expect(canonicalNarrativeJsonV1(incremental.index)).toBe(expected)
    const { indexHash, ...body } = incremental.index
    expect(indexHash).toBe(await hashNarrativeValueV1(body))
    expect(canonicalNarrativeJsonV1(await compileNarrativeIndexV1(input))).toBe(expected)
    await expect(verifyNarrativeIndexV1(base, input)).rejects.toThrow('index-integrity')
  })
})
