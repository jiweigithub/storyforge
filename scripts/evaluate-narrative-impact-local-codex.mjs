import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { CodexRuntime } from './local-codex/runtime.mjs'
import { sha256 } from './narrative-reader-contract.mjs'
import { judgeSummaryName } from './narrative-reader-judge-contract.mjs'
import { IMPACT_ENTRY_ID, IMPACT_SCHEMA, validateImpactProtocol, prepareImpactCases,
  validateImpactAnswer, validatePriorImpactCall, isRetainedInvalidImpactCall, impactMissingResultHashes, impactUsageWithinBudget, scoreImpactSuggestion, summarizeImpactSuggestions } from './narrative-impact-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: { protocol: { type: 'string' }, output: { type: 'string' },
  resume: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, 'max-calls': { type: 'string' } } })
if (!values.protocol || !values.output) throw Error('Required: --protocol <frozen protocol> --output <new evaluation directory>')
const output = resolve(root, values.output), outputPath = relative(root, output)
if (!/^tests\/acceptance\/narrative-world\/raw\/impact-model-[A-Za-z0-9_-]+$/.test(outputPath)) throw Error('Impact output must be a new named evaluation directory')
const limit = values['max-calls'] === undefined ? 48 : Number(values['max-calls'])
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 48) throw Error('max-calls must be an integer in 1..48')
const corpusPath = 'tests/acceptance/narrative-world/corpus-v1.json'
const baselinePath = 'tests/acceptance/narrative-world/impact-semantic-20261015-v2.json'
const registryPath = 'src/lib/agent/ai-entry-registry.json'
const read = path => readFile(resolve(root, path))
const readJson = async path => JSON.parse(await read(path))
const protocol = validateImpactProtocol(await readJson(values.protocol))
const corpus = await readJson(corpusPath), baseline = await readJson(baselinePath)
async function assertOfflineEntry() {
  const registry = await readJson(registryPath)
  const entry = registry.offlineEvaluations?.find(item => item.entryId === IMPACT_ENTRY_ID)
  if (!entry || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || entry.transport !== protocol.provider || entry.caller !== relative(root, fileURLToPath(import.meta.url))
    || entry.contract !== 'scripts/narrative-impact-contract.mjs') throw Error('Impact evaluation must use its registered read-only entry')
}
await assertOfflineEntry()
if (baseline.schema !== 'storyforge.narrative-impact-semantic-diagnostic' || baseline.overall.cases !== 48
  || baseline.accepted !== false || baseline.sourceHashes[corpusPath] !== sha256(await read(corpusPath))) throw Error('Frozen deterministic comparison is incompatible')
const cases = prepareImpactCases(corpus, protocol)
if (baseline.cases.length !== cases.length || baseline.cases.some(row => !cases.some(item => item.id === row.id))) throw Error('Deterministic baseline and model cases differ')
const runtimePaths = ['scripts/evaluate-narrative-impact-local-codex.mjs', 'scripts/narrative-impact-contract.mjs',
  'scripts/narrative-reader-contract.mjs', 'scripts/narrative-reader-judge-contract.mjs', 'scripts/local-codex/runtime.mjs', registryPath]
const runtimeHashes = Object.fromEntries(await Promise.all(runtimePaths.map(async path => [path, sha256(await read(path))])))
const sourceHashes = { ...baseline.sourceHashes,
  [corpusPath]: sha256(await read(corpusPath)), [baselinePath]: sha256(await read(baselinePath)),
  [relative(root, resolve(root, values.protocol))]: sha256(await read(values.protocol)) }
async function assertUnchanged() {
  for (const [path, hash] of Object.entries({ ...sourceHashes, ...runtimeHashes })) {
    if (sha256(await read(path)) !== hash) throw Error(`Frozen impact source changed: ${path}`)
  }
}
await assertUnchanged()
const frozen = { schema: 'storyforge.narrative-impact-model-run', version: 1, entryId: IMPACT_ENTRY_ID,
  protocolPath: values.protocol, protocolSha256: sha256(await read(values.protocol)), sourceHashes, runtimeHashes,
  provider: protocol.provider, model: protocol.model, reasoningEffort: protocol.reasoningEffort,
  deterministicComparison: baselinePath, totalCases: cases.length, distinctPrompts: cases.length,
  cases: cases.map(item => ({ id: item.id, familyId: item.familyId, split: item.split, kind: item.kind,
    promptHash: item.request.promptHash, inputBytes: item.request.inputBytes,
    estimatedInputTokens: item.request.estimatedInputTokens, sourceMap: item.request.sourceMap, targetSourceIds: item.request.targetSourceIds })),
  dispatchOrder: cases.map(item => item.request.promptHash),
  retryPolicy: protocol.version === 1 ? 'zero; prior failed, invalid or unknown calls block resume; never repeat a started input'
    : 'zero; completed invalid outputs remain ungraded and are never resent; prior transport, budget or unknown outcomes block resume',
  accepted: false, independentHumanReviews: 0, costUsd: null }
const writeNew = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const requestEnvelope = item => ({ promptHash: item.request.promptHash, model: protocol.model,
  messages: item.request.messages, outputSchema: IMPACT_SCHEMA, inputBytes: item.request.inputBytes,
  estimatedInputTokens: item.request.estimatedInputTokens })
if (values.resume) {
  if (sha256(await readJson(`${outputPath}/manifest.json`)) !== sha256(frozen)) throw Error('Resume changes frozen inputs, model, protocol, runtime or comparison')
} else {
  await mkdir(output)
  await writeNew(resolve(output, 'manifest.json'), frozen)
  await writeNew(resolve(output, 'runtime-sources.json'), { schema: 'storyforge.evaluation-runtime-sources', version: 1,
    files: Object.fromEntries(await Promise.all(runtimePaths.map(async path => [path, { sha256: runtimeHashes[path], source: (await read(path)).toString('utf8') }]))) })
  await mkdir(resolve(output, 'calls'))
  for (const item of cases) await writeNew(resolve(output, 'calls', `${item.request.promptHash}.request.json`), requestEnvelope(item))
}
const files = new Set(await readdir(resolve(output, 'calls'))), results = new Map()
for (const item of cases) {
  const hash = item.request.promptHash, prefix = `${outputPath}/calls/${hash}`
  if (sha256(await readJson(`${prefix}.request.json`)) !== sha256(requestEnvelope(item))) throw Error('Archived request changed')
  if (files.has(`${hash}.result.json`)) {
    const result = validatePriorImpactCall({ result: await readJson(`${prefix}.result.json`),
      started: await readJson(`${prefix}.started.json`), request: await readJson(`${prefix}.request.json`) }, item.request, protocol)
    results.set(hash, result)
  } else if (files.has(`${hash}.started.json`)) throw Error('Prior impact outcome is unknown; automatic replay is forbidden')
}
const pending = cases.filter(item => !results.has(item.request.promptHash))
const runtime = new CodexRuntime(), controllers = new Set()
let cursor = 0, attempts = 0, stopped = false, runError = null, cliVersion = null
const interrupt = () => { stopped = true; for (const controller of controllers) controller.abort() }
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
async function worker() {
  while (!stopped && cursor < pending.length && attempts < limit) {
    const item = pending[cursor++], hash = item.request.promptHash
    attempts++
    await assertUnchanged()
    const startedAt = new Date().toISOString(), start = performance.now(), controller = new AbortController()
    const result = { promptHash: hash, provider: protocol.provider, model: protocol.model, cliVersion,
      startedAt, status: 'running', dispatched: false, generationCompleted: false, rawText: '', usage: null,
      costUsd: null, serverEnforcedOutputTokenLimit: null }
    await writeNew(resolve(output, 'calls', `${hash}.started.json`), { promptHash: hash, startedAt, model: protocol.model })
    controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), protocol.budget.timeoutMs)
    let stage = 'transport'
    try {
      console.log(JSON.stringify({ phase: 'requesting', case: item.id, hash: hash.slice(0, 12) }))
      await runtime.generate({ id: hash, model: protocol.model, messages: item.request.messages, outputSchema: IMPACT_SCHEMA }, update => {
        if (update.dispatched) result.dispatched = true
        if (update.text !== undefined) result.rawText = update.text
        if (update.usage) { result.usage = update.usage; if (!impactUsageWithinBudget(update.usage, protocol)) controller.abort() }
      }, controller.signal)
      result.generationCompleted = true
      stage = 'usage'
      if (!impactUsageWithinBudget(result.usage, protocol)) throw Error('Missing or excessive impact usage')
      stage = 'output-contract'
      result.answer = validateImpactAnswer(result.rawText, item.request, protocol)
      result.status = 'completed'
    } catch (error) {
      result.status = result.dispatched && !result.generationCompleted && controller.signal.aborted ? 'unknown-or-interrupted'
        : stage === 'output-contract' ? 'invalid-output' : 'failed'
      result.failureStage = stage
      result.codexDiagnostic = error.codexDiagnostic ?? null
      if (!isRetainedInvalidImpactCall(result, item.request, protocol)) stopped = true
    } finally {
      clearTimeout(timer); controllers.delete(controller)
      result.completedAt = new Date().toISOString(); result.durationMs = performance.now() - start
      await writeNew(resolve(output, 'calls', `${hash}.result.json`), result)
      results.set(hash, result)
      console.log(JSON.stringify({ phase: 'recorded', case: item.id, status: result.status, durationMs: Math.round(result.durationMs), usage: result.usage }))
    }
  }
}
try {
  if (!values['dry-run'] && pending.length) {
    await runtime.start()
    if ((await runtime.account()).state !== 'ready') throw Error('Subscription not ready')
    if (!(await runtime.models()).some(model => model.id === protocol.model)) throw Error('Frozen model unavailable')
    cliVersion = runtime.version
    const workers = await Promise.allSettled(Array.from({ length: protocol.concurrency }, async () => {
      try { await worker() } catch (error) { interrupt(); throw error }
    }))
    const rejected = workers.find(result => result.status === 'rejected')
    if (rejected) throw rejected.reason
  }
} catch (error) {
  stopped = true
  runError = { kind: 'startup-or-run-error', diagnostic: error.codexDiagnostic ?? null }
} finally {
  runtime.close(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
  const rows = cases.flatMap(item => {
    const result = results.get(item.request.promptHash)
    if (result?.status !== 'completed') return []
    const family = corpus.families.find(family => family.id === item.familyId), edit = family.edits.find(edit => edit.id === item.id)
    return [{ id: item.id, familyId: item.familyId, split: item.split, kind: item.kind, promptHash: item.request.promptHash,
      answer: result.answer, score: scoreImpactSuggestion(edit, item.request, result.answer), usage: result.usage, durationMs: result.durationMs }]
  })
  const calls = [...results.values()], dispatched = calls.filter(call => call.dispatched)
  const terminalFiles = new Set(await readdir(resolve(output, 'calls')))
  const startedWithoutPersistedResult = impactMissingResultHashes(cases, terminalFiles, results)
  const sourceUnchanged = (await Promise.all(Object.entries({ ...sourceHashes, ...runtimeHashes })
    .map(async ([path, hash]) => sha256(await read(path)) === hash))).every(Boolean)
  const summary = { schema: 'storyforge.narrative-impact-model-results', version: 1, createdAt: new Date().toISOString(),
    manifestSha256: sha256(frozen), dryRun: values['dry-run'], provider: protocol.provider, model: protocol.model, cliVersion, runError,
    totalCases: cases.length, attemptedCases: calls.length + startedWithoutPersistedResult.length,
    dispatchedActualCalls: dispatched.length, completedCases: rows.length,
    invalidOutputCases: calls.filter(call => call.status === 'invalid-output').length,
    failedCases: calls.filter(call => call.status === 'failed').length,
    unknownCases: calls.filter(call => call.status === 'unknown-or-interrupted').length,
    preDispatchFailures: calls.filter(call => !call.dispatched).length,
    startedWithoutPersistedResult, missingReceiptDispatchStatus: 'No usable complete receipt, including a partial result file: unknown; excluded from known dispatch and usage counts, never safe to retry',
    notYetAttempted: cases.length - calls.length - startedWithoutPersistedResult.length,
    attemptedAllCases: calls.length + startedWithoutPersistedResult.length === cases.length,
    complete: rows.length === cases.length && !startedWithoutPersistedResult.length && sourceUnchanged, sourceUnchanged,
    usage: { inputTokens: dispatched.reduce((sum, call) => sum + (call.usage?.inputTokens ?? 0), 0),
      outputTokens: dispatched.reduce((sum, call) => sum + (call.usage?.outputTokens ?? 0), 0),
      unknownDispatchedCalls: dispatched.filter(call => !call.usage).length },
    metrics: summarizeImpactSuggestions(rows), deterministicComparison: { report: baselinePath,
      overall: baseline.overall, byKind: baseline.byKind, bySplit: baseline.bySplit }, rows,
    accepted: false, independentHumanReviews: 0, costUsd: null,
    boundary: 'Read-only model suggestions on frozen synthetic originals. No deterministic plan replacement, author adoption or quality acceptance. Invalid/failed/unknown cases are ungraded and never retried; protocol v2 may continue independent inputs after a known completed invalid output.' }
  const name = judgeSummaryName(await readdir(output), calls.length)
  await writeNew(resolve(output, name), summary)
  console.log(JSON.stringify({ phase: 'summary', attempted: calls.length, completed: rows.length, sourceUnchanged, stopped, path: `${outputPath}/${name}` }))
}
if (stopped) process.exitCode = 1
