import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import {
  baselineInputFingerprint, importsNarrativeGold, physicalWorldReleaseType, root, validateNarrativeBaselineFiles, validateNarrativeCorpus,
} from '../../scripts/narrative-world-baseline-contract.mjs'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { WORLD_RELEASE_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/world-release-provider'
import { evaluateAdapterBaselines, evaluateNarrativeFamily, type BaselineObservation } from '../helpers/narrative-world-evaluation'

describe('NW-0B · 冻结原创语料、标注证据和场景族留出', () => {
  it('校验全部120查询/48修改、UTF-8跨度/hash、原文、完整影响标签与留出边界', () => {
    expect(validateNarrativeBaselineFiles().counts).toEqual({ families: 12, developmentFamilies: 8,
      holdoutFamilies: 4, queries: 120, edits: 48 })
  })
  it.each(['span', 'hash', 'foreign-reference', 'split', 'duplicate-family', 'impact-overlap', 'empty-answer', 'hypothesis'])(
    '拒绝损坏的考卷而不把它计为产品缺口：%s', mutation => {
      const changed = structuredClone(corpus)
      const family = changed.families[0]!
      if (mutation === 'span') family.queries[0]!.evidence[0]!.start++
      if (mutation === 'hash') family.queries[0]!.evidence[0]!.sourceHash = '0'.repeat(64)
      if (mutation === 'foreign-reference') family.queries[0]!.evidence[0]!.sourceId = changed.families[1]!.sources[0]!.id
      if (mutation === 'split') changed.families.forEach(f => { f.split = 'development' })
      if (mutation === 'duplicate-family') changed.families[1] = structuredClone(family)
      if (mutation === 'impact-overlap') family.edits[0]!.mustNotReview.push(family.edits[0]!.mustReview[0]!)
      if (mutation === 'empty-answer') family.queries[0]!.answerAtoms = []
      if (mutation === 'hypothesis') family.sources.find(s => s.kind === 'hypothesis')!.branch = 'canon'
      expect(() => validateNarrativeCorpus(changed)).toThrow()
    },
  )
  it('封存表来自注册表，候选/运行账本/产品媒资和Work缓存不得成为世界语义域', () => {
    const semantic = PROJECT_TABLES.filter(s => s.worldSemantic)
    expect(semantic.length).toBeGreaterThan(0)
    for (const spec of semantic) {
      expect(spec.domainOwner).toBeDefined()
      expect(spec.resourceIdentity).toBeDefined()
      expect(spec.exportable).toBe(true)
      expect(['agentRunArtifacts', 'productRuntimeSessions', 'productRuntimeEvents', 'productMediaAssets',
        'retrievalChunks', 'narrativeSummaryNodes']).not.toContain(spec.name)
      if (spec.worldSemantic!.canonPolicy === 'confirmed-rows-only') {
        expect(spec.worldSemantic!.confirmedStatusValues).not.toEqual(expect.arrayContaining(['candidate']))
        expect(spec.worldSemantic!.confirmedStatusValues).not.toEqual(expect.arrayContaining(['hypothesis']))
      }
    }
  })
  it('物理世界类型守门覆盖未来版本，产品中立接口不被误拦截', () => {
    expect(physicalWorldReleaseType('parsePureWorldReleaseManifestV3(payload)')).toBe(true)
    expect(physicalWorldReleaseType('const value: PureWorldReleaseManifestV4 = input')).toBe(true)
    expect(physicalWorldReleaseType('readWorldResourceV1(input); type T = WorldReferenceV1')).toBe(false)
  })
  it('禁止生产代码通过静态、动态或副作用导入评测答案', () => {
    for (const source of [
      "import corpus from '../../tests/acceptance/narrative-world/corpus-v1.json'",
      "await import('../../tests/helpers/narrative-world-evaluation')",
      "require('../../tests/acceptance/narrative-world/manifest-v1.json')",
      "import '../../tests/acceptance/narrative-world/corpus-v1.json'",
    ]) expect(importsNarrativeGold(source)).toBe(true)
    expect(importsNarrativeGold("import { searchWorldReleaseV1 } from './world-release-provider'")).toBe(false)
  })
})

function counts(items: readonly BaselineObservation[]) {
  return { total: items.length, pass: items.filter(x => x.status === 'pass').length,
    gap: items.filter(x => x.status === 'gap').length, unsupported: items.filter(x => x.status === 'unsupported').length }
}

describe('NW-0B · 当前真实实现的确定性基线（已知缺口单列，非产品验收）', () => {
  const families: Awaited<ReturnType<typeof evaluateNarrativeFamily>>[] = []
  let adapters: BaselineObservation[] = []
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each(corpus.families)('$title [$split]：运行当前provider、原文对照和修改影响', async family => {
    const observed = await evaluateNarrativeFamily(family)
    expect(observed.queries).toHaveLength(10)
    expect(observed.edits).toHaveLength(4)
    expect(observed.lexical).toHaveLength(2)
    // New unexpected failures stop the harness. Known gaps stay explicit in
    // the report; they are never reclassified as successful capabilities.
    expect([...observed.queries, ...observed.controls].filter(row => row.issue === 'NW-REGRESSION')).toEqual([])
    expect(observed.edits.every(row => row.lockedPreserved && row.frozenReleaseUnchanged && row.otherWorkPreserved)).toBe(true)
    for (const edit of observed.edits) {
      expect(edit.sourceFactStatus).toBe(edit.operation === 'impact:knowledge-timing' ? 'stale' : 'confirmed')
    }
    families.push(observed)
  }, 30_000)

  it('六适配器分别比较通用plan与已有确定性编译路径，保留较强路径的正例', async () => {
    adapters = await evaluateAdapterBaselines(corpus.families[0]!)
    expect(adapters).toHaveLength(24)
    expect(adapters.filter(row => row.operation === 'production-compilation-selected-completeness').every(row => row.status === 'pass')).toBe(true)
  }, 30_000)

  afterAll(() => {
    expect(families).toHaveLength(corpus.families.length)
    expect(adapters).toHaveLength(24)
    const { manifest } = validateNarrativeBaselineFiles()
    const input = baselineInputFingerprint(manifest)
    const order = <T extends BaselineObservation>(items: T[]) => items.sort((a, b) => a.id.localeCompare(b.id, 'en'))
    const queries = order(families.flatMap(f => f.queries))
    const edits = order(families.flatMap(f => f.edits))
    const controls = order(families.flatMap(f => f.controls))
    const lexical = order(families.flatMap(f => f.lexical))
    order(adapters)
    const total = (field: 'truePositive' | 'falsePositive' | 'falseNegative') => edits.reduce((sum, e) => sum + e[field], 0)
    const tp = total('truePositive'), fp = total('falsePositive'), fn = total('falseNegative')
    const observationSets = { queries, edits, controls, lexical, adapters }
    const issues = [...new Set(Object.values(observationSets).flat().map(x => x.issue).filter(Boolean))].sort()
      .map(id => ({ id, caseIds: Object.values(observationSets).flat().filter(x => x.issue === id).map(x => x.id).sort() }))
    const findings = JSON.parse(fs.readFileSync(path.join(root, manifest.findings?.path ?? 'tests/acceptance/narrative-world/findings-v1.json'), 'utf8'))
    expect(findings.issues.map((item: { id: string }) => item.id).sort()).toEqual(issues.map(item => item.id))
    for (const issue of issues) {
      const finding = findings.issues.find((item: { id: string }) => item.id === issue.id)
      expect(finding.caseCount).toBe(issue.caseIds.length)
      expect(['P1', 'P2', 'P3']).toContain(finding.priority)
      for (const id of finding.representativeCaseIds) expect(issue.caseIds).toContain(id)
    }
    const deterministic = {
      schema: 'storyforge.narrative-world-baseline', version: 1, datasetVersion: 1,
      providerVersion: WORLD_RELEASE_RESOURCE_PROVIDER_V1.providerVersion,
      evidenceLevel: 'deterministic-synthetic-fixture; not-model-QA-or-product-acceptance',
      modelCalls: 0, productE2ERuns: 0, independentHumanReviews: 0,
      summary: { queries: counts(queries), controls: counts(controls), adapters: counts(adapters), lexical: counts(lexical),
        edits: { ...counts(edits), truePositive: tp, falsePositive: fp, falseNegative: fn,
          microPrecision: tp + fp ? tp / (tp + fp) : null, microRecall: tp + fn ? tp / (tp + fn) : null,
          denominator: 'downstream chapter review candidates; not automatic edits or deletion',
          lockedPreserved: edits.filter(e => e.lockedPreserved).length, frozenReleaseUnchanged: edits.filter(e => e.frozenReleaseUnchanged).length,
          otherWorkPreserved: edits.filter(e => e.otherWorkPreserved).length },
        bySplit: Object.fromEntries(['development', 'holdout'].map(split => [split, counts(queries.filter(q => q.split === split))])) },
      issues, observations: observationSets,
    }
    if (process.env.NW_BASELINE_REPORT) {
      const report = { ...deterministic, input,
        run: { evaluatedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
          generatedAt: new Date().toISOString(), node: process.version, platform: os.platform(), architecture: os.arch(),
          cpu: os.cpus()[0]?.model ?? null, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(),
          database: 'fake-indexeddb in Vitest happy-dom; isolated per case', browser: null,
          performanceAcceptance: 'not-run; reference browser and cold/warm measurements required by NW-2E' } }
      fs.writeFileSync(process.env.NW_BASELINE_REPORT, JSON.stringify(report, null, 2) + '\n')
    } else {
      const frozen = JSON.parse(fs.readFileSync(path.join(root, manifest.baseline.path), 'utf8'))
      const { input: previousInput, run: _run, ...previous } = frozen
      expect(deterministic, 'Observed behavior drifted: inspect improvements/regressions and preserve a versioned new receipt.').toEqual(previous)
      expect(input, 'Evaluated inputs changed: run the baseline and review the new receipt.').toEqual(previousInput)
    }
    console.log(`NW-0B capability outcomes: ${queries.filter(q => q.status === 'pass').length}/${queries.length} passed; ${queries.filter(q => q.status === 'gap').length} gaps; ${queries.filter(q => q.status === 'unsupported').length} unsupported. Harness success is NOT target acceptance.`)
  })
})
