import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { db } from '../../src/lib/db/schema'
import { collectReaderFamily, readerQuestions, lexicalReaderContext, READER_CONDITIONS } from '../helpers/narrative-reader-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import manifest from '../acceptance/narrative-world/manifest-v1.json'

describe('NW-2E fixed reader input boundary; no live model calls in tests', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    await db.delete(); await db.open()
  })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('derives requests only from explicit question inputs, never expected answers or gold evidence', () => {
    const family = structuredClone(corpus.families[0])
    const before = readerQuestions(family)
    for (const query of family.queries) {
      query.expectedResourceIds = ['POISON-EXPECTED']
      query.answerAtoms = ['POISON-ANSWER']
      query.evidence = []
      query.forbiddenAtom = 'POISON-SECRET'
    }
    expect(readerQuestions(family)).toEqual(before)
    expect(before.find(item => item.operation === 'original-read')?.sourceTitle).toBe('南汀渡口·记录1')
    expect(JSON.stringify(before)).not.toMatch(/POISON|answerAtoms|expectedResourceIds|forbiddenAtom|spanHash/)
  })

  it('literal reference refuses character secrets and simulation, and does not pretend to apply a time cutoff', () => {
    const family = corpus.families[0], questions = readerQuestions(family)
    expect(lexicalReaderContext(family, questions[6])).toMatchObject({ status: 'unsupported', documents: [] })
    expect(lexicalReaderContext(family, questions[9])).toMatchObject({ status: 'unsupported', documents: [] })
    expect(lexicalReaderContext(family, questions[5]).diagnostics).toEqual(['lexical-reference-has-no-time-filter'])
  })

  it('collects actual registered v3/v4 reads and isolates ablations without inventing story claims', async () => {
    const paths = [...new Set([...manifest.sourceFingerprintPaths, 'tests/helpers/narrative-reader-evaluation.ts',
      'tests/regression/R-NW-2E-reader-evaluation.test.ts', 'tests/regression/R-NW-2E-reader-routing.test.ts', 'src/lib/agent/ai-entry-registry.json',
      'tests/acceptance/narrative-world/corpus-v1.json'])].sort()
    const fingerprint = () => Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]))
    const sourceHashes = fingerprint()
    const families = process.env.NW_READER_INPUTS ? corpus.families : corpus.families.slice(0, 1)
    const collected = []
    for (const family of families) {
      await db.delete(); await db.open()
      const result = await collectReaderFamily(family)
      expect(result.cases).toHaveLength(10 * READER_CONDITIONS.length)
      for (const item of result.cases) {
        expect(item.question).not.toHaveProperty('expectedResourceIds')
        expect(item.question).not.toHaveProperty('answerAtoms')
        expect(item.question).not.toHaveProperty('evidence')
        if (item.condition === 'ir-no-evidence') expect(item.context.documents.every(doc => doc.text === null && doc.evidence.length === 0)).toBe(true)
        if (item.condition === 'ir-no-knowledge') expect(item.context.documents.every(doc => doc.kind !== 'epistemic-event')).toBe(true)
        if (item.question.view === 'character' && item.condition.startsWith('ir-')) {
          // Unknown acquired time is preserved. Canon truth must not be put in
          // the reader context merely to make this deliberately incomplete case answerable.
          expect(JSON.stringify(item.context.documents)).not.toContain(family.seed.truth)
        }
      }
      const original = result.cases.find(item => item.question.operation === 'original-read' && item.condition === 'ir-lexical')!
      expect(original.context.documents.some(doc => doc.evidence.some(span => span.text === family.sources[0].text))).toBe(true)
      const legacyOriginal = result.cases.find(item => item.question.operation === 'original-read' && item.condition === 'v3-provider')!
      expect(legacyOriginal.context.documents).toHaveLength(1)
      expect(legacyOriginal.context.documents[0].kind).toBe('chapter')
      const rows = await db.storyTimelineEvents.where('projectId').equals((await db.projects.toArray())[0].id!).toArray()
      expect(rows).toEqual([])
      expect(await db.worldGroups.count()).toBe(0)
      collected.push(result)
    }
    expect(fingerprint()).toEqual(sourceHashes)
    if (process.env.NW_READER_INPUTS) {
      writeFileSync(process.env.NW_READER_INPUTS, JSON.stringify({ schema: 'storyforge.narrative-reader-inputs', version: 1,
        boundary: 'Synthetic engineering corpus; manually declared literal spans, not autonomous extraction or human literary acceptance.',
        conditions: READER_CONDITIONS, questionCount: 120, inputCount: collected.flatMap(item => item.cases).length,
        independentHumanReviews: 0, sourceHashes, families: collected }, null, 2) + '\n', { flag: 'wx' })
    }
  }, 120_000)
})
