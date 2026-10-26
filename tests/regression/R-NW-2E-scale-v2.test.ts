import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { buildNarrativeScaleInputV2 } from '../helpers/narrative-scale-v2-fixture'
import { compileWorldReleaseContentV4, verifyWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import plan from '../acceptance/narrative-world/scale-plan-20261015-v2.json'

describe('NW-2E · compiler-v2 scale fixture, isolated engineering evidence only', () => {
  it('compiles exact source characters and independently visible beliefs without promoting private truth', async () => {
    const fixture = await buildNarrativeScaleInputV2(4000)
    expect(fixture.stats.unicodeCharacters).toBe(4000)
    expect(fixture.stats.distinctTextCharacters).toBe(4000)
    expect(fixture.stats.duplicateExactTextCharacters).toBe(0)
    expect(fixture.stats.declaredKnowledgeRecords).toBe(2)
    const result = await compileWorldReleaseContentV4(fixture.input)
    expect(result.manifest.narrative.coverage.gaps).toEqual([])
    expect(result.manifest.narrative.bundle.records).toHaveLength(fixture.stats.declaredRecords)
    const beliefs = result.manifest.narrative.bundle.records.filter(row => row.kind === 'epistemic-event')
    const facts = result.manifest.narrative.bundle.records.filter(row => row.kind === 'assertion')
    expect(beliefs).toHaveLength(2); expect(facts).toHaveLength(2)
    for (const belief of beliefs) {
      expect(belief.visibility.class).toBe('public')
      expect(belief.time.acquiredAt).toBeNull()
      const fact = facts.find(row => row.semanticId === belief.payload.propositionRef.semanticId)!
      expect(fact.visibility.class).toBe('author-only')
      expect(belief.payload.assertedValue).not.toEqual(fact.payload.value)
      expect(belief.payload.sourceEventRef).toBeNull()
    }
    expect(result.index.indexes.adjacency.length).toBeGreaterThanOrEqual(fixture.stats.declaredReferenceEdges)
    expect((await verifyWorldReleaseContentV4({ manifest: result.manifestJson, expectedContentHash: result.contentHash })).manifest).toEqual(result.manifest)
    expect(await compileWorldReleaseContentV4((await buildNarrativeScaleInputV2(4000)).input)).toEqual(result)
    // A separate legacy compile still intersects private truth permission.
    const legacy = await compileWorldReleaseContentV4({ ...fixture.input, compilerVersion: 'narrative-domain-v1' })
    expect(legacy.manifest.narrative.bundle.records.filter(row => row.kind === 'epistemic-event')
      .every(row => row.visibility.class === 'author-only')).toBe(true)
  }, 30_000)

  it.each([1999, 1_000_001, 4000.5, NaN])('rejects unsupported source size %s before allocation', async size => {
    await expect(buildNarrativeScaleInputV2(size)).rejects.toThrow('v2 scale character count out of range')
  })

  it.runIf(!!process.env.NW_SCALE_V2_VECTORS)('freezes all three complete v2 input/output vectors before browser measurements', async () => {
    const results = []
    for (const size of plan.sourceUnicodeCharacters) {
      const fixture = await buildNarrativeScaleInputV2(size)
      const compiled = await compileWorldReleaseContentV4(fixture.input)
      expect(fixture.stats.unicodeCharacters).toBe(size)
      expect(compiled.manifest.narrative.coverage.gaps).toEqual([])
      expect(compiled.manifest.narrative.bundle.records).toHaveLength(fixture.stats.declaredRecords)
      expect(compiled.index.indexes.adjacency.length).toBeGreaterThanOrEqual(fixture.stats.declaredReferenceEdges)
      if (size === 1_000_000) {
        expect(compiled.manifest.narrative.bundle.records.length).toBeGreaterThanOrEqual(plan.thresholds.minimumSemanticRecordsAtMillion)
        expect(compiled.index.indexes.adjacency.length).toBeGreaterThanOrEqual(plan.thresholds.minimumEdgesAtMillion)
      }
      results.push({ size, stats: fixture.stats, inputHash: await hashNarrativeBytesV1(canonicalNarrativeJsonV1(fixture.input)),
        contentHash: compiled.contentHash, indexHash: compiled.index.indexHash,
        records: compiled.manifest.narrative.bundle.records.length, edges: compiled.index.indexes.adjacency.length })
    }
    writeFileSync(process.env.NW_SCALE_V2_VECTORS!, JSON.stringify({ schema: 'storyforge.narrative-scale-v2-vectors', version: 1,
      plan: 'scale-plan-20261015-v2.json', compilerVersion: 'narrative-domain-v2', results,
      evidenceBoundary: 'Deterministic Node vector preparation only; no measured browser performance or author acceptance.',
      modelCalls: 0, accepted: false }, null, 2) + '\n', { flag: 'wx' })
  }, 180_000)
})
