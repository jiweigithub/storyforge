import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { sha256, readerMessages, validateReaderAnswer, readerUsageWithinBudget } from './narrative-reader-contract.mjs'
import { scoreGroundedReaderV2, summarizeGroundedReaderV2 } from './narrative-reader-report.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: { run: { type: 'string' }, output: { type: 'string' } } })
if (!values.run || !values.output) throw Error('Required: --run <completed frozen run directory> --output <new JSON report>')
const directory = resolve(root, values.run), output = resolve(root, values.output)
if (!relative(root, directory).startsWith('tests/acceptance/narrative-world/raw/')
  || !relative(root, output).startsWith('tests/acceptance/narrative-world/')) throw Error('Expected repository-owned evaluation artifacts')
const manifestBytes = await readFile(resolve(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes)
const inputBytes = await readFile(resolve(root, manifest.inputsPath)), inputs = JSON.parse(inputBytes)
const protocolBytes = await readFile(resolve(root, manifest.protocolPath)), protocol = JSON.parse(protocolBytes)
if (sha256(inputBytes) !== manifest.inputsSha256 || sha256(protocolBytes) !== manifest.protocolSha256) throw Error('Frozen protocol/input identity mismatch')
const corpusBytes = await readFile(resolve(root, 'tests/acceptance/narrative-world/corpus-v1.json'))
if (sha256(corpusBytes) !== inputs.sourceHashes['tests/acceptance/narrative-world/corpus-v1.json']) throw Error('Corpus changed since collection')
const corpus = JSON.parse(corpusBytes), results = new Map(), rawHashes = {}, rows = []
const calls = new Set(await readdir(resolve(directory, 'calls')))
for (const entry of manifest.cases) if (!results.has(entry.promptHash)) {
  const prefix = entry.promptHash
  for (const suffix of ['request', 'started', 'result']) {
    const name = `${prefix}.${suffix}.json`
    if (!calls.has(name)) throw Error(`Run incomplete: ${name}`)
    const bytes = await readFile(resolve(directory, 'calls', name)); rawHashes[`calls/${name}`] = sha256(bytes)
    if (suffix === 'result') {
      const result = JSON.parse(bytes)
      if (result.promptHash !== prefix || result.status !== 'completed' || result.provider !== protocol.provider || result.model !== protocol.model
        || !result.dispatched || !readerUsageWithinBudget(result.usage, protocol)) throw Error(`Failed or incompatible actual call: ${prefix}`)
      validateReaderAnswer(result.rawText, protocol)
      results.set(prefix, result)
    }
  }
}
for (const familyInput of inputs.families) for (const item of familyInput.cases) {
  const request = readerMessages(item, protocol), expected = manifest.cases.find(entry => entry.id === item.id)
  if (!expected || expected.promptHash !== request.promptHash) throw Error('Prompt changed during scoring')
  const call = results.get(request.promptHash)
  const rawRequest = JSON.parse(await readFile(resolve(directory, 'calls', `${request.promptHash}.request.json`), 'utf8'))
  if (sha256(rawRequest.messages) !== request.promptHash || rawRequest.model !== protocol.model) throw Error('Raw request does not match its prompt hash')
  const answer = validateReaderAnswer(call.rawText, protocol)
  rows.push({ id: item.id, questionId: item.question.id, familyId: item.familyId, split: item.split, operation: item.question.operation,
    condition: item.condition, promptHash: request.promptHash, retrievalStatus: item.context.status,
    inputBytes: request.inputBytes, estimatedInputTokens: request.estimatedInputTokens, omittedDocuments: request.omittedDocumentIds,
    answer, usage: call.usage, durationMs: call.durationMs,
    score: scoreGroundedReaderV2(item, request, answer, corpus.families.find(family => family.id === item.familyId)) })
}
if (rows.length !== manifest.totalCases || results.size !== manifest.distinctPrompts) throw Error('Incomplete result denominator')
const ablations = ['ir-no-time', 'ir-no-knowledge', 'ir-no-evidence'].map(condition => {
  const paired = rows.filter(row => row.condition === 'ir-lexical').map(base => ({ base,
    ablated: rows.find(row => row.questionId === base.questionId && row.condition === condition) }))
  return { condition, pairs: paired.length, identicalPrompts: paired.filter(pair => pair.base.promptHash === pair.ablated.promptHash).length,
    differentPrompts: paired.filter(pair => pair.base.promptHash !== pair.ablated.promptHash).length,
    interpretation: 'Identical prompts reuse one response and provide no evidence about the removed feature; no independent repetition is claimed.' }
})
const actual = [...results.values()], percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
const scorerPaths = ['scripts/report-narrative-reader.mjs', 'scripts/narrative-reader-report.mjs', 'scripts/narrative-reader-report.test.mjs']
const scorerHashes = Object.fromEntries(await Promise.all(scorerPaths.map(async path => [path, sha256(await readFile(resolve(root, path)))])))
const summaryCandidates = []
for (const name of (await readdir(directory)).filter(name => /^summary-.*\.json$/.test(name))) {
  const bytes = await readFile(resolve(directory, name)), summary = JSON.parse(bytes)
  if (summary.manifestSha256 === sha256(manifest) && !summary.dryRun && !summary.runError
    && summary.completedActualCalls === results.size && summary.completedCases === rows.length
    && summary.failedActualCalls === 0 && summary.notYetCalled === 0) summaryCandidates.push({ name, bytes, summary })
}
summaryCandidates.sort((a, b) => b.summary.savedAt.localeCompare(a.summary.savedAt))
if (!summaryCandidates.length) throw Error('Run has no matching complete terminal summary')
const { name: summaryName, bytes: rawSummaryBytes, summary: rawSummary } = summaryCandidates[0]
const report = { schema: 'storyforge.narrative-reader-comparison', version: 2, createdAt: new Date().toISOString(),
  run: values.run, manifestSha256: sha256(manifestBytes), inputsSha256: sha256(inputBytes), protocolSha256: sha256(protocolBytes),
  originalScoring: { path: `${values.run}/${summaryName}`, sha256: sha256(rawSummaryBytes), preserved: true },
  correction: 'Pilot v1 labelled quotations outside story-body text as invalid, even when a supplied title or direct structured value supported them, and matched gold quotations without checking the source identity. Scoring v2 separates supplied-material grounding from original-body evidence and requires the original source ID for gold-span credit. This post-hoc correction is applied equally to every frozen response; no model call or answer-string rule changes.',
  scorerHashes, sourceHashes: inputs.sourceHashes, rawHashes,
  provider: { channel: protocol.provider, model: protocol.model, cliVersions: [...new Set(actual.map(call => call.cliVersion))], modelSnapshotVersion: null },
  matrix: { questions: protocol.questionCount, sceneFamilies: inputs.families.length, conditions: protocol.conditions,
    conditionObservations: rows.length, actualModelCalls: actual.length, sharedPromptObservations: rows.length - actual.length,
    sourceUnchangedAtRunSummary: rawSummary.sourceUnchangedAtSummary, failedActualCalls: rawSummary.failedActualCalls,
    unknownActualCalls: [...calls].filter(name => name.endsWith('.started.json') && !calls.has(name.replace('.started.json', '.result.json'))).length },
  budget: { ...protocol.budget, allObservedCallsWithinBudget: actual.every(call => readerUsageWithinBudget(call.usage, protocol)),
    totalInputTokens: actual.reduce((sum, call) => sum + call.usage.inputTokens, 0), totalOutputTokens: actual.reduce((sum, call) => sum + call.usage.outputTokens, 0),
    maxInputTokens: Math.max(...actual.map(call => call.usage.inputTokens)), maxOutputTokens: Math.max(...actual.map(call => call.usage.outputTokens)),
    callDurationP50Ms: percentile(actual.map(call => call.durationMs), 0.5), callDurationP95Ms: percentile(actual.map(call => call.durationMs), 0.95), costUsd: null },
  metrics: summarizeGroundedReaderV2(rows), ablations, rows,
  evidenceBoundary: 'Actual fixed-reader responses on synthetic engineering scenes with explicit minimal fixture annotations. No autonomous extraction, independent semantic grading, human acceptance, full-story quality or product acceptance.',
  semanticQuality: { independentlyScored: false, humanReviews: 0, accepted: false }, accepted: false }
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ output: values.output, cases: rows.length, actualCalls: actual.length,
  ablations, withinBudget: report.budget.allObservedCallsWithinBudget, accepted: false }))
