import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const corpusPath = 'tests/acceptance/narrative-world/corpus-v1.json'
export const manifestPath = 'tests/acceptance/narrative-world/manifest-v1.json'
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
export const hashFile = relative => sha256(fs.readFileSync(path.join(root, relative)))
export const physicalWorldReleaseType = source => /(?:WorldReleaseManifestV\d+|parsePureWorldReleaseManifestV\d+)/.test(source)
export const importsNarrativeGold = source => /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"][^'"]*(?:acceptance\/narrative-world|narrative-world-evaluation)/.test(source)

export function validateNarrativeCorpus(corpus) {
  assert.equal(corpus.schema, 'storyforge.narrative-world-evaluation-corpus')
  assert.equal(corpus.version, 1)
  assert.equal(corpus.purpose, 'evaluation-only')
  assert.equal(corpus.license, 'MIT')
  assert.match(corpus.annotationStatus, /not-independent-human-review/)
  assert.ok(corpus.families.length >= 12, 'at least 12 scenario families')
  const ids = new Set()
  const familyTexts = new Set()
  const operations = new Set(['metadata-search', 'original-read', 'body-search', 'entity-filter', 'arc-filter',
    'chapter-cutoff', 'character-knowledge-scope', 'causal-query', 'development-query', 'hypothesis-query'])
  let queries = 0
  let edits = 0
  let holdout = 0
  const unique = id => { assert.ok(!ids.has(id), `duplicate id ${id}`); ids.add(id) }
  for (const family of corpus.families) {
    unique(family.id)
    assert.ok(['development', 'holdout'].includes(family.split), 'explicit family split required')
    if (family.split === 'holdout') holdout++
    const sources = new Map(family.sources.map(source => [source.id, source]))
    assert.equal(sources.size, family.sources.length)
    const wholeText = family.sources.filter(source => source.kind === 'chapter').map(source => source.text).join('\n')
    assert.ok(!familyTexts.has(wholeText), 'duplicate story across families/splits')
    familyTexts.add(wholeText)
    for (const source of family.sources) {
      unique(source.id)
      assert.ok(source.id.startsWith(`${family.id}:`), 'source crosses family')
      assert.ok(source.text.length > 8)
      assert.ok(['chapter', 'character', 'story-arc', 'hypothesis'].includes(source.kind))
      if (source.kind === 'hypothesis') {
        assert.equal(source.authority, 'hypothesis')
        assert.equal(source.branch, 'H')
      } else assert.equal(source.branch, 'canon')
    }
    const evidence = span => {
      const source = sources.get(span.sourceId)
      assert.ok(source, `missing evidence source ${span.sourceId}`)
      assert.equal(span.field, 'text')
      assert.equal(span.normalization, 'raw-utf8-v1')
      const bytes = Buffer.from(source.text, 'utf8')
      assert.ok(Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= 0 && span.end > span.start && span.end <= bytes.length, 'invalid byte span')
      const selected = bytes.subarray(span.start, span.end)
      assert.equal(selected.toString('utf8'), span.quote, `evidence quote drift: ${span.sourceId}`)
      assert.ok(selected.equals(Buffer.from(span.quote, 'utf8')), 'span splits a UTF-8 code point')
      assert.equal(sha256(bytes), span.sourceHash, 'source hash drift')
      assert.equal(sha256(selected), span.spanHash, 'span hash drift')
    }
    for (const query of family.queries) {
      unique(query.id)
      assert.ok(query.id.startsWith(`${family.id}:`))
      assert.ok(operations.has(query.operation), `unsupported evaluation operation ${query.operation}`)
      assert.ok(query.question.length > 6 && query.answerAtoms.length > 0 && query.answerAtoms.every(x => x.length > 0))
      assert.ok(query.evidence.length > 0)
      query.evidence.forEach(evidence)
      assert.ok(query.expectedResourceIds.length > 0)
      assert.equal(new Set(query.expectedResourceIds).size, query.expectedResourceIds.length)
      query.expectedResourceIds.forEach(id => assert.ok(sources.has(id)
        || (query.operation === 'character-knowledge-scope' && id === `${family.id}:knowledge-a`), `unknown gold resource ${id}`))
      if (query.operation === 'hypothesis-query') {
        assert.equal(query.branch, 'H')
        assert.equal(query.view, 'hypothesis')
      } else assert.equal(query.branch, 'canon')
      if (query.operation === 'entity-filter') assert.equal(sources.get(query.entityId)?.kind, 'character')
      if (query.operation === 'arc-filter') assert.equal(sources.get(query.arcId)?.kind, 'story-arc')
      if (query.operation === 'chapter-cutoff') assert.equal(sources.get(query.throughId)?.kind, 'chapter')
      queries++
    }
    assert.deepEqual(new Set(family.queries.map(q => q.operation)), operations, 'each family must exercise every declared operation')
    for (const edit of family.edits) {
      unique(edit.id)
      const source = sources.get(edit.sourceId)
      assert.equal(source?.kind, 'chapter')
      assert.notEqual(edit.before, edit.after)
      assert.equal(source.text.split(edit.before).length - 1, 1, 'edit anchor must be unique')
      evidence(edit.evidence)
      assert.equal(edit.evidence.quote, edit.before)
      assert.equal(edit.evidence.sourceId, edit.sourceId)
      const targets = [...edit.mustReview, ...edit.mustNotReview]
      assert.equal(new Set(targets).size, targets.length, 'contradictory impact labels')
      const downstream = family.sources.filter(s => s.kind === 'chapter' && s.order > source.order).map(s => s.id).sort()
      assert.deepEqual([...targets].sort(), downstream, 'all downstream labels must be explicit')
      edit.dependencyEvidence.forEach(evidence)
      assert.deepEqual(edit.dependencyEvidence.map(s => s.sourceId).sort(), [...edit.mustReview].sort())
      assert.ok(edit.rationale.length > 10)
      assert.equal(edit.protectedFact, 'locked-rule')
      edits++
    }
  }
  assert.ok(queries >= 120, 'at least 120 queries')
  assert.ok(edits >= 40, 'at least 40 edit sets')
  assert.ok(holdout / corpus.families.length >= 0.3, 'at least 30% family holdout')
  return { families: corpus.families.length, developmentFamilies: corpus.families.length - holdout,
    holdoutFamilies: holdout, queries, edits }
}

export function validateNarrativeBaselineFiles() {
  const corpus = readJson(corpusPath)
  const counts = validateNarrativeCorpus(corpus)
  const manifest = readJson(manifestPath)
  assert.equal(manifest.schema, 'storyforge.narrative-world-evaluation-manifest')
  assert.equal(manifest.version, 1)
  assert.equal(manifest.corpus.path, corpusPath)
  assert.equal(manifest.corpus.sha256, hashFile(corpusPath), 'frozen corpus changed; create a new dataset version')
  assert.deepEqual(manifest.counts, counts)
  assert.equal(manifest.productionUse, false)
  assert.equal(manifest.humanReviewed, false)
  assert.equal(manifest.liveModelEvaluated, false)
  assert.ok(manifest.sourceFingerprintPaths.length > 5)
  for (const source of manifest.sourceFingerprintPaths) assert.ok(fs.existsSync(path.join(root, source)), `missing input ${source}`)
  return { corpus, counts, manifest }
}

export function baselineInputFingerprint(manifest) {
  const hashes = Object.fromEntries([...manifest.sourceFingerprintPaths, corpusPath].sort().map(relative => [relative, hashFile(relative)]))
  return { hashes, sha256: sha256(JSON.stringify(hashes)) }
}
