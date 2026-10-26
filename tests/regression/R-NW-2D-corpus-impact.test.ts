import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { buildWorldImpactPlanV1, type WorldImpactSnapshotV1 } from '../../src/lib/consistency/world-impact'
import type { WorldImpactItemV1 } from '../../src/lib/types/world-impact'
import { canonicalNarrativeJsonV1 as json, hashNarrativeValueV1 as hash } from '../../src/lib/world-engine/narrative-json'
import corpus from '../acceptance/narrative-world/corpus-v1.json'

type PredictionEvidence = { sourceId: string; predicted: boolean; items: Array<Pick<WorldImpactItemV1,
  'key' | 'kind' | 'disposition' | 'operation' | 'confidence' | 'pathRootKey' | 'pathComplete' | 'path' | 'evidenceIds' | 'unknownEdges'>> }

type Observation = { id: string; family: string; split: string; kind: string; expected: string[]; predicted: string[];
  unscoredPredictions: string[]; truePositive: number; falsePositive: number; falseNegative: number;
  hardPredictions: string[]; predictionEvidence: PredictionEvidence[]; unknownCoverageCount: number; planHash: string; inputHashes: string[];
  lockedFactPreserved: boolean; foreignWorkPreserved: boolean; oldReleasePreserved: boolean }
const observations: Observation[] = []

describe('NW-2D · 原 48 组修改的语义诊断（记录差距，不把收集成功算作质量通过）', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })
  for (const family of corpus.families) it(`${family.id}: 原文修改经过真实投影和影响计划，gold 只在输出后评分`, async () => {
    const fixture = await seedConfirmedNarrativeDomainV1(family)
    const logical = new Map<string, string>()
    for (const source of family.sources.filter(source => source.kind === 'chapter')) {
      const row = (await db.chapters.get(fixture.localIds.get(source.id)!))!
      logical.set(`chapter:${row.ragDocumentId}`, source.id)
    }
    const lockedBefore = json(await db.temporalFacts.get(fixture.factIds.get('locked')!))
    const foreignBefore = json({ chapter: await db.chapters.get(fixture.foreignChapterId), fact: await db.temporalFacts.get(fixture.foreignFactId) })
    const releaseBefore = json(await db.worldReleases.get(fixture.release.id!))
    const snapshot = async (): Promise<WorldImpactSnapshotV1> => {
      const projection = await projectNarrativeDomainsV1(fixture.input)
      const originals: NonNullable<WorldImpactSnapshotV1['originals']> = []
      for (const [sourceKey, id] of logical) {
        const row = (await db.chapters.get(fixture.localIds.get(id)!))!
        originals.push({ sourceKey, fields: { title: row.title, content: row.content } })
      }
      // Existing fixture annotations remain unchanged. No mustReview,
      // dependencyEvidence or expected answer becomes a dependency edge.
      return { projection, originals, lockedSemanticIds: [], semanticRootHash: await hash({ projection, originals }) }
    }
    const base = await snapshot()
    for (const edit of family.edits) {
      const original = family.sources.find(source => source.id === edit.sourceId)!
      expect(original.text).toContain(edit.before)
      const chapterId = fixture.localIds.get(edit.sourceId)!
      await db.chapters.update(chapterId, { content: original.text.replace(edit.before, edit.after) })
      try {
        const next = await snapshot(), plan = await buildWorldImpactPlanV1({ base, next })
        const itemsFor = (sourceKey: string) => plan.items.filter(item => item.key === `original:${sourceKey}`
          || item.key === `source:${json([sourceKey, '/content'])}`
          || [...base.projection.bundle.records, ...next.projection.bundle.records].some(record => record.semanticId === item.key && record.provenance.sourceResourceKey === sourceKey))
        const predicted = [...logical].filter(([key, id]) => id !== edit.sourceId && itemsFor(key).some(item => item.disposition !== 'unaffected')).map(([, id]) => id).sort()
        const hardPredictions = [...logical].filter(([key, id]) => id !== edit.sourceId && itemsFor(key).some(item => ['rebuild', 'stale'].includes(item.disposition))).map(([, id]) => id).sort()
        // Keep the actual item witnesses, including unaffected targets. These
        // diagnostic details do not change selection, dispositions, or scoring.
        const predictionEvidence: PredictionEvidence[] = [...logical].filter(([, id]) => id !== edit.sourceId)
          .map(([key, sourceId]) => ({ sourceId, predicted: predicted.includes(sourceId), items: itemsFor(key).map(item => ({
            key: item.key, kind: item.kind, disposition: item.disposition, operation: item.operation, confidence: item.confidence,
            pathRootKey: item.pathRootKey, pathComplete: item.pathComplete, path: item.path,
            evidenceIds: item.evidenceIds, unknownEdges: item.unknownEdges,
          })) }))
        // Scoring starts only here, after the production algorithm returned.
        const expected = [...edit.mustReview].sort(), universe = new Set([...expected, ...edit.mustNotReview])
        const scored = predicted.filter(id => universe.has(id))
        const observation: Observation = { id: edit.id, family: family.id, split: family.split, kind: edit.kind,
          predictionEvidence,
          expected, predicted: scored, unscoredPredictions: predicted.filter(id => !universe.has(id)), hardPredictions,
          truePositive: scored.filter(id => expected.includes(id)).length,
          falsePositive: scored.filter(id => !expected.includes(id)).length,
          falseNegative: expected.filter(id => !scored.includes(id)).length,
          unknownCoverageCount: plan.unknownCoverage.length, planHash: plan.planHash,
          inputHashes: [base.semanticRootHash, next.semanticRootHash],
          lockedFactPreserved: json(await db.temporalFacts.get(fixture.factIds.get('locked')!)) === lockedBefore,
          foreignWorkPreserved: json({ chapter: await db.chapters.get(fixture.foreignChapterId), fact: await db.temporalFacts.get(fixture.foreignFactId) }) === foreignBefore,
          oldReleasePreserved: json(await db.worldReleases.get(fixture.release.id!)) === releaseBefore }
        expect(observation.lockedFactPreserved && observation.foreignWorkPreserved && observation.oldReleasePreserved).toBe(true)
        expect(plan.writes).toEqual([])
        observations.push(observation)
      } finally { await db.chapters.update(chapterId, { content: original.text }) }
    }
  }, 30_000)

  afterAll(() => {
    expect(observations).toHaveLength(48)
    const metrics = (rows: Observation[]) => {
      const sum = (key: 'truePositive' | 'falsePositive' | 'falseNegative') => rows.reduce((sum, row) => sum + row[key], 0)
      const tp = sum('truePositive'), fp = sum('falsePositive'), fn = sum('falseNegative')
      return { cases: rows.length, truePositive: tp, falsePositive: fp, falseNegative: fn,
        precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null }
    }
    const overall = metrics(observations)
    const passed = overall.precision !== null && overall.precision >= 0.8 && overall.recall !== null && overall.recall >= 0.95
    const paths = ['src/lib/consistency/world-impact.ts', 'src/lib/types/world-impact.ts', 'src/lib/world-engine/narrative-domain-projection.ts',
      'src/lib/world-engine/narrative-ir.ts', 'src/lib/narrative-domain/json.ts', 'tests/helpers/narrative-domain-fixture.ts',
      'tests/helpers/narrative-world-evaluation.ts', 'tests/regression/R-NW-2D-corpus-impact.test.ts', 'tests/acceptance/narrative-world/corpus-v1.json']
    if (process.env.NW_IMPACT_SEMANTIC_REPORT) writeFileSync(process.env.NW_IMPACT_SEMANTIC_REPORT, JSON.stringify({
      schema: 'storyforge.narrative-impact-semantic-diagnostic', version: 1, workPackage: 'NW-2D',
      evidenceLevel: 'original synthetic engineering edit corpus with pre-existing fixture annotations; no model or independent author acceptance',
      annotationCoverage: 'Existing NW-1B annotations are deliberately incomplete; no automatic reannotation after edits and no gold-to-graph injection.',
      metricDefinition: 'Any rebuild/stale/review suggestion counts as a predicted review; score only mustReview union mustNotReview, and disclose other predictions separately.',
      hardDependencyAcceptance: 'Measured separately in R-NW-2D-impact; this report is semantic edit gold, not a hard-edge proof.',
      overall, byKind: Object.fromEntries([...new Set(observations.map(row => row.kind))].sort().map(kind => [kind, metrics(observations.filter(row => row.kind === kind))])),
      bySplit: Object.fromEntries([...new Set(observations.map(row => row.split))].sort().map(split => [split, metrics(observations.filter(row => row.split === split))])),
      meetsAutomaticSemanticTargets: passed, accepted: false, modelCalls: 0, independentHumanReviews: 0,
      sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), cases: observations,
    }, null, 2) + '\n', { flag: 'wx' })
    if (process.env.NW_IMPACT_SEMANTIC_REQUIRE_PASS === '1') expect(passed).toBe(true)
  })
})
