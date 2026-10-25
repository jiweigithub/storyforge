import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { buildNarrativeScaleInputV1 } from '../helpers/narrative-scale-fixture'
import { compileWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import scalePlan from '../acceptance/narrative-world/scale-plan-20261015-v1.json'
import { packNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-package-packing'

describe('NW-2E · 规模输入合同（CI 小样本不是性能验收）', () => {
  it('真实注册 codec 编译具有不同场景和固定早/晚针事实的输入，原文字符量与去重统计可核对', async () => {
    const fixture = await buildNarrativeScaleInputV1(1000)
    expect(fixture.stats.unicodeCharacters).toBe(1000)
    expect(fixture.stats.distinctTextCharacters).toBe(1000)
    expect(fixture.stats.duplicateExactTextCharacters).toBe(0)
    expect(fixture.stats.sourceFields).toBe(fixture.stats.declaredRecords)
    for (const needle of fixture.needles) {
      const row = fixture.input.records.historicalTimelineEvents.find(row => row.ragDocumentId === needle.sourceUid)!
      expect(row.description).toContain(needle.quote)
    }
    const compiled = await compileWorldReleaseContentV4(fixture.input)
    expect(compiled.manifest.narrative.bundle.records).toHaveLength(fixture.stats.declaredRecords)
    expect(compiled.index.indexes.adjacency.length).toBeGreaterThanOrEqual(fixture.stats.declaredParticipantEdges)
    expect(compiled.manifest.narrative.coverage.gaps).toEqual([])
    expect(await compileWorldReleaseContentV4(fixture.input)).toEqual(compiled)
  }, 30_000)

  it.runIf(process.env.NW_SCALE_DIAGNOSTIC === '1')('首次三规模诊断保存实际失败和耗时，不能替代五次冷/三十次热浏览器证据', async () => {
    const results: unknown[] = []
    const output = process.env.NW_SCALE_DIAGNOSTIC_REPORT
    if (!output) throw Error('A new NW_SCALE_DIAGNOSTIC_REPORT destination is required')
    const generatedAt = new Date().toISOString()
    try {
      const sizes = process.env.NW_SCALE_DIAGNOSTIC_SIZES?.split(',').map(Number) ?? scalePlan.sourceUnicodeCharacters
      if (sizes.some(size => !scalePlan.sourceUnicodeCharacters.includes(size))) throw Error('Only frozen plan sizes may be measured')
      for (const size of sizes) {
        const generationStart = performance.now(), fixture = await buildNarrativeScaleInputV1(size)
        const generationMs = performance.now() - generationStart
        const inputHash = await hashNarrativeBytesV1(canonicalNarrativeJsonV1(fixture.input))
        const profilePath = process.env.NW_SCALE_CPU_PROFILE
        const profiler = profilePath ? new (await import('node:inspector/promises')).Session() : null
        if (profiler) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start') }
        const start = performance.now()
        try {
          const compiled = await compileWorldReleaseContentV4(fixture.input)
          const compileMs = performance.now() - start
          const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
          const fieldBytes = (value: object) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bytes(item)]))
          const packed = packNarrativeJsonV1({ manifest: compiled.manifest, index: compiled.index })
          results.push({ size, stats: fixture.stats, inputHash, generationMs, compileMs,
            contentHash: compiled.contentHash, indexHash: compiled.index.indexHash,
            records: compiled.manifest.narrative.bundle.records.length, edges: compiled.index.indexes.adjacency.length,
            componentFieldBytes: { manifest: fieldBytes(compiled.manifest), projection: fieldBytes(compiled.manifest.narrative),
              bundle: fieldBytes(compiled.manifest.narrative.bundle), indexes: fieldBytes(compiled.index.indexes) },
            packedTransport: { bytes: bytes(packed), strings: packed.strings.length, shapes: packed.shapes.length,
              stringTableBytes: bytes(packed.strings), shapeTableBytes: bytes(packed.shapes), rootBytes: bytes(packed.root) },
            compiledComponentBytes: new TextEncoder().encode(canonicalNarrativeJsonV1({ manifest: compiled.manifest, index: compiled.index })).length })
        } catch (error) {
          results.push({ size, stats: fixture.stats, inputHash, generationMs, compileMs: performance.now() - start, error: error instanceof Error ? error.message : String(error) })
        } finally {
          if (profiler) {
            const { profile } = await profiler.post('Profiler.stop')
            writeFileSync(`${profilePath}-${size}.cpuprofile`, JSON.stringify(profile), { flag: 'wx' })
            profiler.disconnect()
          }
        }
      }
    } finally {
      writeFileSync(output, JSON.stringify({ schema: 'storyforge.narrative-scale-diagnostic', version: 1, generatedAt,
        plan: 'scale-plan-20261015-v1.json', evidenceLevel: 'single Node diagnostic; not browser performance acceptance',
        node: process.version, cpuProfilingEnabled: !!process.env.NW_SCALE_CPU_PROFILE,
        modelCalls: 0, independentHumanReviews: 0, results }, null, 2) + '\n', { flag: 'wx' })
    }
  }, 1_200_000)
})
