import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { CodexRuntime } from './local-codex/runtime.mjs'
import { READER_ENTRY_ID, READER_SCHEMA, sha256, readerMessages, validateReaderAnswer,
  readerUsageWithinBudget, scoreReader, summarizeReader } from './narrative-reader-contract.mjs'
import { inspectReaderPreflight, assertReaderPreflight } from './narrative-reader-preflight.mjs'
import { readerRequestArtifact, validateReaderCall, readReaderHistory, verifyReaderHistory,
  reserveReaderContinuation, readerExecutionCounts, readerSummaryName } from './narrative-reader-continuation.mjs'
import { READER_STORAGE_POLICY, createReaderReceiptStore, readerStorageDiagnostic } from './narrative-reader-storage.mjs'
import { readerEvaluationProtocol, readReaderQuarantine } from './narrative-reader-quarantine.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: { inputs: { type: 'string' }, protocol: { type: 'string' }, output: { type: 'string' },
  resume: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, 'max-calls': { type: 'string' },
  'continue-unstarted-from': { type: 'string' }, 'quarantine-unstarted-from': { type: 'string' } } })
if (!values.inputs || !values.protocol || !values.output) throw Error('Required: --inputs <frozen collection> --protocol <frozen protocol> --output <new directory>')
const output = resolve(root, values.output)
if (!relative(root, output).startsWith('tests/acceptance/narrative-world/raw/')) throw Error('Reader artifacts must stay in the explicit repository evaluation directory')
const limit = values['max-calls'] === undefined ? Infinity : Number(values['max-calls'])
if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw Error('max-calls must be a positive integer')
const protocolBytes = await readFile(resolve(root, values.protocol)), protocol = JSON.parse(protocolBytes)
const inputBytes = await readFile(resolve(root, values.inputs)), inputs = JSON.parse(inputBytes)
if (protocol.schema !== 'storyforge.narrative-reader-protocol' || ![2, 3, 4].includes(protocol.version) || protocol.entryId !== READER_ENTRY_ID
  || protocol.provider !== 'local-codex-subscription' || protocol.reasoningEffort !== 'medium' || protocol.retries !== 0
  || protocol.concurrency < 1 || protocol.concurrency > 2 || protocol.acceptance.accepted !== false
  || inputs.schema !== 'storyforge.narrative-reader-inputs' || inputs.version !== 1
  || (protocol.version >= 3 && inputs.profile !== 'compiler-v2-source-grounded-acquisition-v1')) throw Error('Unrecognized or unsafe frozen reader contract')
if ((protocol.version === 4) !== !!values['quarantine-unstarted-from']
  || (values['quarantine-unstarted-from'] && values['continue-unstarted-from'])) throw Error('Version 4 requires one explicit quarantine cohort; ordinary continuation is unchanged')
const evaluationProtocol = readerEvaluationProtocol(protocol)

async function assertOfflineEntry() {
  const registry = JSON.parse(await readFile(resolve(root, 'src/lib/agent/ai-entry-registry.json'), 'utf8'))
  const entry = registry.offlineEvaluations?.find(entry => entry.entryId === READER_ENTRY_ID)
  if (!entry || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || entry.transport !== protocol.provider || entry.caller !== relative(root, fileURLToPath(import.meta.url))
    || entry.contract !== 'scripts/narrative-reader-contract.mjs') throw Error('Offline AI entry is not registered for this runner')
}
await assertOfflineEntry()
const runtimePaths = ['scripts/evaluate-narrative-reader-local-codex.mjs', 'scripts/narrative-reader-contract.mjs',
  'scripts/narrative-reader-preflight.mjs', 'scripts/narrative-reader-continuation.mjs',
  'scripts/narrative-reader-storage.mjs',
  'scripts/narrative-reader-quarantine.mjs',
  'scripts/local-codex/runtime.mjs', 'src/lib/agent/ai-entry-registry.json']
const runtimeHashes = Object.fromEntries(await Promise.all(runtimePaths.map(async path => [path, sha256(await readFile(resolve(root, path)))])))
const corpusPath = 'tests/acceptance/narrative-world/corpus-v1.json'
const corpusBytes = await readFile(resolve(root, corpusPath))
if (sha256(corpusBytes) !== inputs.sourceHashes[corpusPath]) throw Error('Scoring corpus differs from collected source identity')
// Gold stays in this process and is read only by scoreReader after completion.
const corpus = JSON.parse(corpusBytes)
const cases = inputs.families.flatMap(family => family.cases)
if (cases.length !== inputs.inputCount || new Set(cases.map(item => item.id)).size !== cases.length
  || cases.length !== protocol.questionCount * protocol.conditions.length) throw Error('Incomplete or duplicate evaluation matrix')
const prepared = cases.map(item => ({ item, request: readerMessages(item, evaluationProtocol) }))
const preflight = inspectReaderPreflight(prepared, evaluationProtocol)
const unique = new Map(prepared.map(({ request }) => [request.promptHash, request]))
const frozen = { schema: 'storyforge.narrative-reader-run', version: 1, entryId: READER_ENTRY_ID,
  inputsPath: values.inputs, inputsSha256: sha256(inputBytes), protocolPath: values.protocol, protocolSha256: sha256(protocolBytes),
  provider: protocol.provider, model: protocol.model, reasoningEffort: protocol.reasoningEffort, runtimeHashes,
  preflight: { version: preflight.version, sha256: sha256(preflight), dispatchAllowed: preflight.dispatchAllowed },
  sourceHashes: inputs.sourceHashes, cases: prepared.map(({ item, request }) => ({ id: item.id, promptHash: request.promptHash,
    inputBytes: request.inputBytes, estimatedInputTokens: request.estimatedInputTokens, omittedDocumentIds: request.omittedDocumentIds })),
  totalCases: cases.length, distinctPrompts: unique.size, retryPolicy: 'zero; started without result is unknown and never resubmitted',
  deduplication: 'Byte-identical messages under the same frozen model/protocol share one recorded call; not independent repeated samples.',
  receiptStorage: READER_STORAGE_POLICY, costUsd: null, accepted: false }
let inherited = new Map(), quarantined = new Map(), history = null
if (values['continue-unstarted-from']) {
  history = await readReaderHistory(root, values['continue-unstarted-from'], frozen, unique, protocol)
  inherited = history.results
  if (![...inherited.values()].some(value => value.status === 'failed') || inherited.size === unique.size) throw Error('Continuation requires a settled failed batch with unattempted inputs')
  const claimPath = await reserveReaderContinuation(root, values['continue-unstarted-from'], history.manifestSha256, values.output)
  frozen.version = 2
  frozen.continuation = { version: 1, run: relative(root, resolve(root, values['continue-unstarted-from'])),
    manifestSha256: history.manifestSha256, claimPath, claimSha256: sha256(await readFile(resolve(root, claimPath))), evidence: history.evidence,
    inheritedPromptHashes: [...inherited.keys()], unresolvedPromptHashes: [...inherited].filter(([, value]) => value.status !== 'completed').map(([hash]) => hash),
    policy: 'New cohort for requests with no prior start or result. Historical failures retain their denominator and unknown usage. No repeated call, branch, protocol/model/prompt/budget/scorer change or result replacement. Unknown terminal outcomes block continuation. Any new failure stops the cohort.' }
  frozen.retryPolicy = 'zero; inherited failures remain unresolved and excluded; any new failure or unknown outcome blocks this cohort resume'
}
if (values['quarantine-unstarted-from']) {
  history = await readReaderQuarantine(root, values['quarantine-unstarted-from'], frozen, unique, protocol)
  inherited = history.results; quarantined = history.quarantined
  const claimPath = await reserveReaderContinuation(root, values['quarantine-unstarted-from'], history.manifestSha256, values.output)
  frozen.version = 3
  frozen.recovery = { version: 1, run: relative(root, resolve(root, values['quarantine-unstarted-from'])),
    manifestSha256: history.manifestSha256, parentProtocol: history.parentProtocol, audit: history.audit,
    claimPath, claimSha256: sha256(await readFile(resolve(root, claimPath))), evidence: history.evidence,
    inheritedPromptHashes: [...inherited.keys()], quarantinedAttempts: [...quarantined.values()],
    pendingPromptHashes: [...unique.keys()].filter(hash => !inherited.has(hash) && !quarantined.has(hash)),
    policy: 'Separately versioned cohort for audited never-attempted inputs only. Missing historical results/dispatch/usage remain unknown, never fabricated, retried, replaced or scored as successful. Any new failure stops this cohort; complete-run acceptance remains false.' }
  frozen.retryPolicy = 'zero; every prior start/result is excluded; quarantined unknown attempts remain unresolved'
}
if (values.resume) {
  const prior = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'))
  if (sha256(prior) !== sha256(frozen)) throw Error('Resume would change the frozen inputs, runner, transport, protocol or model')
  if (sha256(JSON.parse(await readFile(resolve(output, 'preflight.json'), 'utf8'))) !== sha256(preflight)) throw Error('Frozen preflight changed before resume')
} else {
  // Verify collection identity once before first dispatch. Later development
  // changes cannot rewrite these already-frozen inputs or their provenance.
  if (!history) for (const [path, hash] of Object.entries(inputs.sourceHashes)) if (sha256(await readFile(resolve(root, path))) !== hash) throw Error(`Collected source changed before run: ${path}`)
  await mkdir(output)
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' })
  await writeFile(resolve(output, 'preflight.json'), JSON.stringify(preflight, null, 2) + '\n', { flag: 'wx' })
  assertReaderPreflight(preflight)
  await mkdir(resolve(output, 'calls'))
  for (const [hash, request] of unique) if (!inherited.has(hash) && !quarantined.has(hash)) await writeFile(resolve(output, 'calls', `${hash}.request.json`),
    JSON.stringify(readerRequestArtifact(request, protocol), null, 2) + '\n', { flag: 'wx' })
}
assertReaderPreflight(preflight)

const results = new Map(inherited), unknown = [], failure = []
const files = new Set(await readdir(resolve(output, 'calls')))
for (const file of files) {
  const match = /^([a-f0-9]{64})\.(request|started|result)\.json$/.exec(file)
  if (!match || !unique.has(match[1]) || inherited.has(match[1]) || quarantined.has(match[1])) throw Error('Unexpected or repeated reader call artifact')
}
for (const [hash, request] of unique) {
  if (inherited.has(hash) || quarantined.has(hash)) continue
  const prior = {}
  for (const kind of ['request', 'started', 'result']) if (files.has(`${hash}.${kind}.json`)) prior[kind] = JSON.parse(await readFile(resolve(output, 'calls', `${hash}.${kind}.json`), 'utf8'))
  if (files.has(`${hash}.result.json`)) {
    const result = validateReaderCall(prior, request, protocol)
    results.set(hash, result)
    if (result.status !== 'completed') failure.push(hash)
  } else if (files.has(`${hash}.started.json`)) unknown.push(hash)
  else validateReaderCall(prior, request, protocol)
}
if (unknown.length || failure.length) throw Error(`Stopped: ${unknown.length} unknown and ${failure.length} failed prior calls. No automatic retry is allowed.`)
const pending = [...unique].filter(([hash]) => !results.has(hash) && !quarantined.has(hash))
const receiptStore = createReaderReceiptStore(output), unpersistedAttempts = new Map()
let dispatched = 0, cursor = 0, stopped = false, cliVersion = null, runError = null
const runtime = new CodexRuntime(), controllers = new Set()
const interrupt = () => { stopped = true; for (const controller of controllers) controller.abort() }
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
async function assertRuntimeUnchanged() {
  for (const [path, hash] of Object.entries(runtimeHashes)) if (sha256(await readFile(resolve(root, path))) !== hash) throw Error(`Runtime changed during frozen evaluation: ${path}`)
  if (history) await verifyReaderHistory(root, history.evidence)
  if (frozen.continuation && sha256(await readFile(resolve(root, frozen.continuation.claimPath))) !== frozen.continuation.claimSha256) throw Error('Continuation reservation changed')
  if (frozen.recovery && (sha256(await readFile(resolve(root, frozen.recovery.claimPath))) !== frozen.recovery.claimSha256
    || sha256(await readFile(resolve(root, frozen.recovery.parentProtocol.path))) !== frozen.recovery.parentProtocol.sha256)) throw Error('Quarantine reservation or parent protocol changed')
}
async function worker() {
  while (!stopped && cursor < pending.length && dispatched < limit) {
    const [hash, request] = pending[cursor++]
    dispatched++
    await assertRuntimeUnchanged()
    if (stopped) return
    const startedAt = new Date().toISOString(), start = performance.now()
    const result = { promptHash: hash, provider: protocol.provider, model: protocol.model, cliVersion,
      startedAt, status: 'running', dispatched: false, rawText: '', usage: null, costUsd: null,
      serverEnforcedOutputTokenLimit: null }
    const startedPath = resolve(output, 'calls', `${hash}.started.json`)
    let journal
    try { journal = receiptStore.begin({ promptHash: hash, startedAt, model: protocol.model }, startedPath) }
    catch (error) {
      if (existsSync(startedPath)) unpersistedAttempts.set(hash, { promptHash: hash, phase: 'before-provider',
        dispatchedByThisWorker: false, storageDiagnostic: readerStorageDiagnostic(error) })
      throw error
    }
    const controller = new AbortController(); controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), protocol.budget.timeoutMs)
    try {
      console.log(JSON.stringify({ phase: 'requesting', distinctCall: results.size + 1, promptHash: hash.slice(0, 12), model: protocol.model }))
      await runtime.generate({ id: hash, model: protocol.model, messages: request.messages, outputSchema: READER_SCHEMA }, update => {
        try {
          if (update.dispatched) {
            // The bridge emits this before turn/start: record intent, not a
            // provider acknowledgement. Failure here prevents transmission.
            journal.append('submission-intent', { provider: protocol.provider, model: protocol.model })
            result.dispatched = true
          }
          if (update.text !== undefined) result.rawText = update.text
          if (update.usage) {
            result.usage = update.usage; journal.append('usage', update.usage)
            if (!readerUsageWithinBudget(update.usage, protocol)) controller.abort()
          }
        } catch (error) {
          result.storageDiagnostic = readerStorageDiagnostic(error); interrupt(); throw error
        }
      }, controller.signal)
      result.generationCompleted = true
      journal.append('generation-completed', { rawText: result.rawText, usage: result.usage })
      result.answer = validateReaderAnswer(result.rawText, protocol)
      if (!readerUsageWithinBudget(result.usage, protocol)) throw Error('Missing usage or observed token budget exceeded')
      result.status = 'completed'
    } catch (error) {
      result.status = result.dispatched && controller.signal.aborted ? 'unknown-or-interrupted' : 'failed'
      result.error = String(error); result.codexDiagnostic = error.codexDiagnostic ?? null; stopped = true
      if (error.receiptOperation) { result.storageDiagnostic = readerStorageDiagnostic(error); interrupt() }
    } finally {
      clearTimeout(timer); controllers.delete(controller)
      result.completedAt = new Date().toISOString(); result.durationMs = performance.now() - start
      try {
        journal.append('terminal-receipt', result)
        receiptStore.writeJson(resolve(output, 'calls', `${hash}.result.json`), result)
        // A later journal-close failure must not erase a committed call from
        // the denominator or label its input as never attempted.
        results.set(hash, result)
      } catch (error) {
        unpersistedAttempts.set(hash, { promptHash: hash, phase: 'result-commit',
          submissionIntentRecorded: result.dispatched, generationCompletedObserved: result.generationCompleted === true,
          statusObservedInMemory: result.status, journal: relative(root, journal.path),
          storageDiagnostic: readerStorageDiagnostic(error) })
        throw error
      } finally { journal.close() }
      console.log(JSON.stringify({ phase: 'recorded', promptHash: hash.slice(0, 12), status: result.status, durationMs: Math.round(result.durationMs), usage: result.usage }))
    }
  }
}

try {
  if (!values['dry-run'] && pending.length) {
    receiptStore.assertCapacity()
    await runtime.start()
    if ((await runtime.account()).state !== 'ready') throw Error('Local subscription is not ready; no API fallback')
    if (!(await runtime.models()).some(model => model.id === protocol.model)) throw Error('Frozen model is unavailable; model substitution is forbidden')
    cliVersion = runtime.version
    const outcomes = await Promise.allSettled(Array.from({ length: protocol.concurrency }, () => worker().catch(error => { interrupt(); throw error })))
    const failure = outcomes.find(outcome => outcome.status === 'rejected')
    if (failure) throw failure.reason
  }
} catch (error) {
  runError = { error: String(error), codexDiagnostic: error.codexDiagnostic ?? null,
    storageDiagnostic: error.receiptOperation ? readerStorageDiagnostic(error) : null,
    reservedInputs: dispatched, newCohortAttempts: results.size - inherited.size + unpersistedAttempts.size }
  console.error(JSON.stringify({ phase: 'run-failed-before-summary', ...runError }))
  throw error
} finally {
  runtime.close(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
  const rows = prepared.flatMap(({ item, request }) => {
    const result = results.get(request.promptHash)
    if (result?.status !== 'completed') return []
    return [{ id: item.id, questionId: item.question.id, familyId: item.familyId, split: item.split,
      condition: item.condition, operation: item.question.operation, promptHash: request.promptHash,
      retrievalStatus: item.context.status, inputBytes: request.inputBytes, estimatedInputTokens: request.estimatedInputTokens,
      answer: result.answer, usage: result.usage, durationMs: result.durationMs,
      score: scoreReader(item, request, result.answer, corpus.families.find(family => family.id === item.familyId)) }]
  })
  const sourceDrift = (await Promise.all(Object.entries(inputs.sourceHashes).map(async ([path, hash]) => sha256(await readFile(resolve(root, path))) === hash ? null : path))).filter(Boolean)
  const sourceUnchanged = sourceDrift.length === 0
  let finalEvidenceUnchanged = true
  try { await assertRuntimeUnchanged() }
  catch (error) {
    finalEvidenceUnchanged = false; stopped = true
    runError ??= { error: String(error), codexDiagnostic: null,
      reservedInputs: dispatched, newCohortAttempts: results.size - inherited.size + unpersistedAttempts.size }
    console.error(JSON.stringify({ phase: 'final-evidence-check-failed', error: String(error) }))
  }
  const rawResults = [...results.values()]
  const summary = { schema: 'storyforge.narrative-reader-results', version: 2, savedAt: new Date().toISOString(),
    manifestSha256: sha256(frozen), dryRun: values['dry-run'], totalCases: cases.length, completedCases: rows.length,
    distinctPrompts: unique.size, completedActualCalls: rawResults.filter(result => result.status === 'completed').length,
    failedActualCalls: rawResults.filter(result => result.status !== 'completed').length,
    notYetCalled: unique.size - results.size - quarantined.size - unpersistedAttempts.size, sourceUnchangedAtSummary: sourceUnchanged,
    sourceDrift, evaluationEvidenceUnchanged: finalEvidenceUnchanged,
    historicalEvidenceUnchanged: history && finalEvidenceUnchanged ? true : null, runError,
    counts: { ...readerExecutionCounts(rawResults, unique.size),
      recordedAttempts: results.size + quarantined.size, quarantinedUnknownAttempts: quarantined.size,
      unknownDispatchAttempts: quarantined.size,
      unpersistedAttempts: unpersistedAttempts.size, unattempted: unique.size - results.size - quarantined.size - unpersistedAttempts.size },
    quarantinedAttempts: [...quarantined.values()],
    unpersistedAttempts: [...unpersistedAttempts.values()],
    cohort: { inheritedAttempts: inherited.size, quarantinedUnknownAttempts: quarantined.size,
      newRecordedAttempts: results.size - inherited.size,
      completed: !stopped && !runError && results.size + quarantined.size === unique.size },
    executionComplete: !stopped && !runError && finalEvidenceUnchanged && unpersistedAttempts.size === 0
      && rawResults.length === unique.size && rawResults.every(value => value.status === 'completed'),
    totalObservedUsage: { inputTokens: rawResults.reduce((sum, result) => sum + (result.usage?.inputTokens ?? 0), 0),
      outputTokens: rawResults.reduce((sum, result) => sum + (result.usage?.outputTokens ?? 0), 0) },
    metrics: summarizeReader(rows), rows, costUsd: null, accepted: false,
    evidenceBoundary: 'Live subscription responses to frozen synthetic engineering queries. Exact-string/quote proxies only. No independent semantic, author, product or performance acceptance. Byte-identical prompts share a call.' }
  const summaryPath = readerSummaryName(results.size)
  receiptStore.writeJson(resolve(output, summaryPath), summary, READER_STORAGE_POLICY.maximumSummaryBytes)
  console.log(JSON.stringify({ phase: 'summary', path: summaryPath, completedCases: rows.length,
    ...summary.counts, distinctPrompts: unique.size, sourceUnchanged, stopped }))
}
if (stopped) process.exitCode = 1
