import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { readerMessages, sha256 } from './narrative-reader-contract.mjs'
import { inspectReaderPreflight, assertReaderPreflight } from './narrative-reader-preflight.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const readOnlySummary = output => JSON.parse(readFileSync(resolve(output, readdirSync(output).find(name => name.startsWith('summary-')))))
const currentProtocol = JSON.parse(readFileSync(resolve(root, 'tests/acceptance/narrative-world/reader-protocol-20261015-v2.json')))
const protocol = { ...currentProtocol, conditions: ['ir-lexical', 'ir-no-time', 'ir-no-knowledge', 'ir-no-evidence'],
  questionCount: 1, sceneFamilies: 1, holdoutFamilies: 0 }
function matrix(contrasting = true) {
  const base = { familyId: 'f1', split: 'development', question: { id: 'q1', question: '故事中的铜铃在哪里？', operation: 'chapter-cutoff', view: 'author', branch: 'canon' },
    context: { status: 'matched', diagnostics: [], documents: [
      { id: 'event', title: '交接', kind: 'event', text: '铜铃落进木箱。', atom: { place: '木箱' }, evidence: [{ text: '铜铃落进木箱。' }] },
      { id: 'belief', title: '认知', kind: 'epistemic-event', text: '小桥以为铜铃在桌上。', atom: { belief: '桌上' }, evidence: [{ text: '小桥以为铜铃在桌上。' }] },
    ] } }
  return protocol.conditions.map(condition => {
    const item = { ...structuredClone(base), id: `f1:q1:${condition}`, condition }
    if (contrasting) {
      if (condition === 'ir-no-time') item.context.documents.push({ id: 'later', title: '后来', kind: 'event', text: '铜铃被取出。', atom: null, evidence: [] })
      if (condition === 'ir-no-knowledge') item.context.documents = item.context.documents.filter(document => document.kind !== 'epistemic-event')
      if (condition === 'ir-no-evidence') item.context.documents = item.context.documents.map(document => ({ ...document, text: null, evidence: [] }))
    }
    return item
  })
}
const inspect = (items, contract = protocol) => inspectReaderPreflight(items.map(item => ({ item, request: readerMessages(item, contract) })), contract)

test('wholly identical ablations block dispatch; diagnostics alone do not establish a material contrast', () => {
  const items = matrix(false)
  items.find(item => item.condition === 'ir-no-time').context.diagnostics.push('removed-time-filter')
  const report = inspect(items)
  assert.equal(report.dispatchAllowed, false)
  assert.equal(report.comparisons[0].metadataOnlyPromptChanges, 1)
  assert.deepEqual(report.failures.map(item => item.condition), ['ir-no-time', 'ir-no-knowledge', 'ir-no-evidence'])
  assert.throws(() => assertReaderPreflight(report), /degenerate-ablation:ir-no-time/)
})

test('actual model-visible contrasts allow dispatch but never grant quality acceptance', () => {
  const report = inspect(matrix())
  assert.equal(report.dispatchAllowed, true)
  assert.deepEqual(report.comparisons.map(item => item.changedMaterialQuestions), [1, 1, 1])
  assert.equal(report.accepted, false); assert.equal(report.modelCalls, 0)
  assert.doesNotThrow(() => assertReaderPreflight(report))
})

test('document reordering and handle renumbering cannot manufacture an ablation', () => {
  const items = matrix(false)
  items[1].context.documents.reverse()
  const report = inspect(items)
  assert.equal(report.comparisons[0].identicalPrompts, 0)
  assert.equal(report.comparisons[0].changedMaterialQuestions, 0)
  assert.equal(report.dispatchAllowed, false)
})

test('contrasts discarded by the frozen input budget do not count as material reaching the model', () => {
  const items = matrix(false)
  for (const item of items) item.context.documents[0].text = `${item.condition} ${'铜铃'.repeat(30_000)}`
  const report = inspect(items)
  assert.deepEqual(report.comparisons.map(item => item.changedMaterialQuestions), [0, 0, 0])
  assert.equal(report.dispatchAllowed, false)
})

test('missing and duplicated paired conditions cannot pass through equal total case counts', () => {
  const items = matrix()
  items[1] = { ...structuredClone(items[0]), id: 'unique-id-but-duplicate-condition' }
  const report = inspect(items)
  assert.equal(report.dispatchAllowed, false)
  assert.ok(report.failures.some(item => item.code === 'duplicate-question-condition'))
  assert.ok(report.failures.some(item => item.code === 'missing-question-condition'))
})

test('question substitution and legacy protocol are refused without reading scoring gold', () => {
  const items = matrix()
  for (const item of items) Object.defineProperty(item.question, 'answerAtoms', { get() { throw Error('gold was read') } })
  assert.equal(inspect(items).dispatchAllowed, true)
  items[1].question.question = '改成另一个问题'
  assert.ok(inspect(items).failures.some(item => item.code === 'question-changed-between-conditions'))
  assert.throws(() => inspect(matrix(), { ...protocol, version: 1 }), /historical version 1 evidence remains read-only/)
})

test('archived 720-case inputs reproduce both degenerate ablations before any new model call', () => {
  const collection = JSON.parse(readFileSync(resolve(root, 'tests/acceptance/narrative-world/reader-inputs-20261015-v2.json')))
  const report = inspect(collection.families.flatMap(family => family.cases), currentProtocol)
  assert.equal(report.cases, 720); assert.equal(report.pairedQuestions, 120)
  assert.deepEqual(report.comparisons.map(item => item.changedMaterialQuestions), [0, 0, 60])
  assert.deepEqual(report.comparisons.map(item => item.identicalPrompts), [120, 120, 60])
  assert.equal(report.dispatchAllowed, false)
})

function runIsolated(contrasting, check) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'storyforge-reader-preflight-'))
  const output = resolve(root, 'tests/acceptance/narrative-world/raw', `test-preflight-${randomUUID()}`)
  try {
    const corpusPath = 'tests/acceptance/narrative-world/corpus-v1.json'
    const inputs = { schema: 'storyforge.narrative-reader-inputs', version: 1, inputCount: 4,
      sourceHashes: { [corpusPath]: sha256(readFileSync(resolve(root, corpusPath))) },
      families: [{ cases: matrix(contrasting) }] }
    writeFileSync(resolve(temporary, 'inputs.json'), JSON.stringify(inputs))
    writeFileSync(resolve(temporary, 'protocol.json'), JSON.stringify(protocol))
    const args = [resolve(root, 'scripts/evaluate-narrative-reader-local-codex.mjs'), '--inputs', resolve(temporary, 'inputs.json'),
      '--protocol', resolve(temporary, 'protocol.json'), '--output', output, '--dry-run']
    check(() => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 10_000 }), output)
  } finally {
    // Only disposable directories created by this isolated test are removed.
    rmSync(temporary, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true })
  }
}

test('runner retains blocked preflight and manifest before creating requests or starting the transport', () => {
  runIsolated(false, (run, output) => {
    assert.throws(run, error => error.status === 1 && /Reader preflight blocked model dispatch/.test(error.stderr))
    const report = JSON.parse(readFileSync(resolve(output, 'preflight.json')))
    const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json')))
    assert.equal(report.dispatchAllowed, false); assert.equal(manifest.preflight.sha256, sha256(report))
    assert.equal(existsSync(resolve(output, 'calls')), false)
  })
})

test('valid dry run freezes preflight, input requests and zero-call summary without invoking a model', () => {
  runIsolated(true, (run, output) => {
    run()
    const summary = readOnlySummary(output)
    assert.equal(summary.dryRun, true); assert.equal(summary.completedActualCalls, 0)
    assert.equal(summary.accepted, false); assert.equal(summary.sourceUnchangedAtSummary, true)
    assert.equal(JSON.parse(readFileSync(resolve(output, 'preflight.json'))).dispatchAllowed, true)
    assert.equal(readdirSync(resolve(output, 'calls')).length, 4)
    assert.ok(readdirSync(resolve(output, 'calls')).every(name => name.endsWith('.request.json')))
  })
})

const splitProtocol = { ...JSON.parse(readFileSync(resolve(root, 'tests/acceptance/narrative-world/reader-protocol-20261015-v3.json'))),
  conditions: protocol.conditions, questionCount: 2, sceneFamilies: 2, holdoutFamilies: 1 }
function splitMatrix(holdoutContrast = true) {
  return [...matrix(), ...matrix(holdoutContrast).map(item => ({ ...item, id: `holdout:${item.id}`, familyId: 'f2', split: 'holdout' }))]
}

test('version 3 requires real contrasts within both existing scene-family splits', () => {
  const good = inspect(splitMatrix(), splitProtocol)
  assert.equal(good.version, 2); assert.equal(good.dispatchAllowed, true)
  assert.deepEqual(good.comparisons.map(item => item.bySplit), Array(3).fill({
    development: { pairedQuestions: 1, changedMaterialQuestions: 1 }, holdout: { pairedQuestions: 1, changedMaterialQuestions: 1 } }))
  const partial = inspect(splitMatrix(false), splitProtocol)
  assert.equal(partial.dispatchAllowed, false)
  assert.ok(partial.failures.every(item => item.code === 'degenerate-split-ablation' && item.split === 'holdout'))
  assert.ok(partial.comparisons.every(item => item.changedMaterialQuestions === 1))
})

test('version 3 rejects split substitution, missing families and lowered contrast policy', () => {
  const switched = splitMatrix(); switched.at(-1).split = 'development'
  assert.ok(inspect(switched, splitProtocol).failures.some(item => item.code === 'invalid-family-split'))
  const relabelled = splitMatrix().map(item => ({ ...item, split: 'development' }))
  assert.ok(inspect(relabelled, splitProtocol).failures.some(item => item.code === 'incomplete-family-splits'))
  assert.throws(() => inspect(splitMatrix(), { ...splitProtocol, preflight: { ...splitProtocol.preflight,
    minimumChangedQuestionsPerSplit: { development: 1, holdout: 0 } } }), /explicit version 2\/3/)
})

test('selector changes and metadata-only coordinate declarations cannot manufacture a valid contrast', () => {
  const changed = splitMatrix(); changed[1].question = { ...changed[1].question, holderId: 'other-character' }
  assert.ok(inspect(changed, splitProtocol).failures.some(item => item.code === 'question-changed-between-conditions'))
  const metadata = splitMatrix(false)
  for (const item of metadata.filter(item => item.split === 'holdout')) item.context.provenance = { declaredOrigin: item.condition }
  assert.ok(inspect(metadata, splitProtocol).failures.some(item => item.code === 'degenerate-split-ablation'))
})

test('version 3 dry run binds its profile and freezes both-split evidence without a model call', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'storyforge-reader-v3-'))
  const output = resolve(root, 'tests/acceptance/narrative-world/raw', `test-preflight-${randomUUID()}`)
  try {
    const corpusPath = 'tests/acceptance/narrative-world/corpus-v1.json'
    const inputs = { schema: 'storyforge.narrative-reader-inputs', version: 1, inputCount: 8,
      profile: 'compiler-v2-source-grounded-acquisition-v1', sourceHashes: { [corpusPath]: sha256(readFileSync(resolve(root, corpusPath))) },
      families: [{ cases: splitMatrix() }] }
    writeFileSync(resolve(temporary, 'inputs.json'), JSON.stringify(inputs)); writeFileSync(resolve(temporary, 'protocol.json'), JSON.stringify(splitProtocol))
    const args = [resolve(root, 'scripts/evaluate-narrative-reader-local-codex.mjs'), '--inputs', resolve(temporary, 'inputs.json'),
      '--protocol', resolve(temporary, 'protocol.json'), '--output', output, '--dry-run']
    execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 10_000 })
    const preflight = JSON.parse(readFileSync(resolve(output, 'preflight.json')))
    assert.equal(preflight.version, 2); assert.equal(preflight.dispatchAllowed, true)
    const summary = readOnlySummary(output)
    assert.equal(summary.completedActualCalls, 0); assert.equal(summary.accepted, false)
  } finally {
    rmSync(temporary, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true })
  }
})
