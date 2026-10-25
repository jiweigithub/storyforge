import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { CodexRuntime } from './local-codex/runtime.mjs'
import { createReaderReceiptStore, READER_STORAGE_POLICY } from './narrative-reader-storage.mjs'
import { renderAuthorQualityHumanPacket } from './narrative-author-quality-review.mjs'
import { AUTHOR_QUALITY_ENTRY_ID, AUTHOR_QUALITY_CONDITIONS, authorQualityHash,
  validateAuthorQualityProtocol, validateAuthorQualityInputs, validateAuthorQualitySourceReceipt, authorQualityWriterRequest,
  AUTHOR_QUALITY_WRITER_SCHEMA, validateAuthorQualityWriting, createAuthorQualityBlindPacket,
  authorQualityJudgeRequest, AUTHOR_QUALITY_JUDGE_SCHEMA, validateAuthorQualityJudgment,
  authorQualityUsageWithinBudget } from './narrative-author-quality-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: { protocol: { type: 'string' }, input: { type: 'string' },
  output: { type: 'string' }, execute: { type: 'boolean', default: false } } })
if (!values.protocol || !values.input || !values.output) throw Error('Provide --protocol, --input and a new --output; --execute is explicit')
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex')
const read = path => readFile(resolve(root, path))
const readJson = async path => JSON.parse(await read(path))
const output = resolve(root, values.output), outputPath = relative(root, output)
if (!/^tests\/acceptance\/narrative-world\/raw\/author-quality-[A-Za-z0-9_-]+$/.test(outputPath)) throw Error('Use a new named author-quality evidence directory')
const boundaryPath = async path => {
  const name = relative(root, resolve(root, path))
  if (!name.startsWith('tests/acceptance/narrative-world/')
    || !relative(root, await realpath(resolve(root, name))).startsWith('tests/acceptance/narrative-world/')) {
    throw Error('Input must be a repository evaluation artifact')
  }
  return name
}
const protocolPath = await boundaryPath(values.protocol), inputPath = await boundaryPath(values.input)
const protocol = validateAuthorQualityProtocol(await readJson(protocolPath))
const input = validateAuthorQualityInputs(await readJson(inputPath))
const registryPath = 'src/lib/agent/ai-entry-registry.json'
async function assertOfflineEntry() {
  const registry = await readJson(registryPath)
  const entry = registry.offlineEvaluations?.find(row => row.entryId === AUTHOR_QUALITY_ENTRY_ID)
  if (!entry || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || entry.transport !== protocol.provider || entry.caller !== relative(root, fileURLToPath(import.meta.url))
    || entry.contract !== 'scripts/narrative-author-quality-contract.mjs') throw Error('Author quality evaluation needs its registered read-only boundary')
}
await assertOfflineEntry()
for (const receipt of input.sourceReceipts) {
  await boundaryPath(receipt.path)
  if (bytesHash(await read(receipt.path)) !== receipt.sha256) throw Error('Frozen source receipt changed')
}
const implementationHashes = validateAuthorQualitySourceReceipt(input, await readJson(input.sourceReceipts[0].path))
for (const [path, expected] of Object.entries(implementationHashes)) {
  const actual = relative(root, await realpath(resolve(root, path)))
  if (actual.startsWith('../') || actual === '..' || bytesHash(await read(path)) !== expected) {
    throw Error('Source preparation no longer matches the current implementation')
  }
}
const runtimePaths = ['scripts/evaluate-narrative-author-quality-local-codex.mjs', 'scripts/narrative-author-quality-contract.mjs',
  'scripts/narrative-author-quality-review.mjs',
  'scripts/narrative-reader-storage.mjs', 'scripts/narrative-reader-contract.mjs', 'scripts/local-codex/runtime.mjs', registryPath,
  'package.json', 'package-lock.json']
const hashes = { ...Object.fromEntries(await Promise.all([...new Set([...runtimePaths, protocolPath, inputPath,
  ...input.sourceReceipts.map(row => row.path)])].map(async path => [path, bytesHash(await read(path))]))), ...implementationHashes }
const assertUnchanged = async () => {
  for (const [path, expected] of Object.entries(hashes)) if (bytesHash(await read(path)) !== expected) throw Error('Frozen author quality input or runtime changed')
}
const writerRequests = Object.fromEntries(AUTHOR_QUALITY_CONDITIONS.map(condition => [condition,
  authorQualityWriterRequest(input, condition, protocol)]))
const envelope = (request, outputSchema) => ({ model: request.model, messages: request.messages, outputSchema,
  promptHash: request.promptHash, callId: authorQualityHash({ model: request.model, messages: request.messages, outputSchema }) })
const rawRoot = dirname(output), priorDirectories = (await readdir(rawRoot, { withFileTypes: true }))
  .filter(item => item.isDirectory() && item.name.startsWith('author-quality-')).map(item => resolve(rawRoot, item.name))
if (!relative(root, await realpath(rawRoot)).startsWith('tests/acceptance/narrative-world/')) throw Error('Evaluation output escaped its artifact root')
async function assertNeverStarted(callId) {
  for (const prior of priorDirectories) {
    let names
    try { names = await readdir(resolve(prior, 'calls')) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (names.includes(`${callId}.started.json`)) throw Error('A prior request was already started. Inspect its receipt; never resubmit automatically.')
  }
}
await assertUnchanged()
for (const request of Object.values(writerRequests)) await assertNeverStarted(envelope(request, AUTHOR_QUALITY_WRITER_SCHEMA).callId)
await mkdir(output)
await mkdir(resolve(output, 'calls'))
const store = createReaderReceiptStore(output)
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const manifest = { schema: 'storyforge.narrative-author-quality-run', version: 1, entryId: AUTHOR_QUALITY_ENTRY_ID,
  head, startedAt: new Date().toISOString(), sourceHashes: hashes, inputHash: authorQualityHash(input),
  provider: protocol.provider, writerModel: protocol.writerModel, reviewerModel: protocol.reviewerModel,
  reasoningEffort: protocol.reasoningEffort, plannedWriterConditions: AUTHOR_QUALITY_CONDITIONS,
  plannedIndependentReviewCalls: 1, retryPolicy: 'zero; any started historical request forbids automatic redispatch',
  budget: protocol.budget, execute: values.execute, costUsd: null, accepted: false,
  boundary: 'Frozen evaluation-owned source documents only. No author database, adoption, publication or quality promotion. Human participation is a separate explicit receipt.' }
store.writeJson(resolve(output, 'manifest.json'), manifest)
store.writeJson(resolve(output, 'runtime-sources.json'), {
  files: Object.fromEntries(await Promise.all(runtimePaths.map(async path => [path, { sha256: hashes[path], source: (await read(path)).toString('utf8') }]))),
}, READER_STORAGE_POLICY.maximumSummaryBytes)
const writeRequest = request => store.writeJson(resolve(output, 'calls', `${request.callId}.request.json`), request)
const written = new Set()
for (const request of Object.values(writerRequests)) {
  const sent = envelope(request, AUTHOR_QUALITY_WRITER_SCHEMA)
  if (!written.has(sent.callId)) { writeRequest(sent); written.add(sent.callId) }
}
const results = new Map(), attempts = new Map(), bindings = [], runtime = new CodexRuntime()
let controller = null, interrupted = false, cliVersion = null, failure = null
const interrupt = () => { interrupted = true; controller?.abort() }
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
async function call(request, outputSchema, validate, stage) {
  const sent = envelope(request, outputSchema)
  if (results.has(sent.callId)) {
    const prior = results.get(sent.callId)
    if (prior.status !== 'completed') throw Error('A started failed or unknown input cannot be repeated')
    bindings.push({ stage, callId: sent.callId, reusedKnownSuccess: true })
    return prior.value
  }
  if (interrupted) throw Error('Evaluation interrupted before dispatch')
  await assertUnchanged(); await assertNeverStarted(sent.callId)
  if (!written.has(sent.callId)) { writeRequest(sent); written.add(sent.callId) }
  const startedAt = new Date().toISOString(), start = performance.now()
  const result = { callId: sent.callId, promptHash: sent.promptHash, provider: protocol.provider, model: sent.model,
    cliVersion, startedAt, dispatched: false, generationCompleted: false, status: 'running', rawText: '', usage: null, costUsd: null }
  attempts.set(sent.callId, result)
  const journal = store.begin({ promptHash: sent.callId, startedAt, model: sent.model }, resolve(output, 'calls', `${sent.callId}.started.json`))
  controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), protocol.budget.timeoutMs)
  let phase = 'transport'
  try {
    console.log(JSON.stringify({ stage, state: 'requesting', callId: sent.callId }))
    await runtime.generate({ id: sent.callId, model: sent.model, messages: sent.messages, outputSchema }, update => {
      if (update.dispatched && !result.dispatched) {
        journal.append('submission-intent', { provider: protocol.provider, model: sent.model })
        result.dispatched = true
      }
      if (update.text !== undefined) result.rawText = update.text
      if (update.usage) {
        result.usage = update.usage; journal.append('usage', update.usage)
        if (!authorQualityUsageWithinBudget(update.usage, protocol)) controller.abort()
      }
    }, controller.signal)
    result.generationCompleted = true
    journal.append('generation-completed', { rawText: result.rawText, usage: result.usage })
    phase = 'budget'
    if (!authorQualityUsageWithinBudget(result.usage, protocol, true)) throw Error('Missing or excessive observed usage')
    phase = 'output-contract'
    result.value = validate(result.rawText)
    result.status = 'completed'
  } catch (error) {
    result.status = result.dispatched && !result.generationCompleted ? 'unknown-or-interrupted'
      : phase === 'output-contract' ? 'invalid-output' : 'failed'
    result.failureStage = phase
    result.codexDiagnostic = error.codexDiagnostic ?? null
  } finally {
    clearTimeout(timer); controller = null
    result.endedAt = new Date().toISOString(); result.durationMs = performance.now() - start
    try {
      journal.append('terminal-receipt', result)
      store.writeJson(resolve(output, 'calls', `${sent.callId}.result.json`), result)
    } finally { journal.close() }
  }
  results.set(sent.callId, result); bindings.push({ stage, callId: sent.callId, reusedKnownSuccess: false })
  console.log(JSON.stringify({ stage, status: result.status, durationMs: Math.round(result.durationMs), usage: result.usage }))
  await assertUnchanged()
  if (result.status !== 'completed') throw Error('Model call did not produce a verified terminal output; later work stopped without retry')
  return result.value
}
try {
  if (values.execute) {
    store.assertCapacity(); await runtime.start()
    if ((await runtime.account()).state !== 'ready') throw Error('Local subscription is unavailable')
    const models = await runtime.models()
    if (![protocol.writerModel, protocol.reviewerModel].every(id => models.some(model => model.id === id))) throw Error('A frozen model is unavailable')
    cliVersion = runtime.version
    const writings = {}
    for (const condition of AUTHOR_QUALITY_CONDITIONS) writings[condition] = await call(writerRequests[condition],
      AUTHOR_QUALITY_WRITER_SCHEMA, raw => validateAuthorQualityWriting(raw, protocol), `writer:${condition}`)
    const { packet, key } = createAuthorQualityBlindPacket(input, writings, protocol, randomBytes(32).toString('hex'))
    store.writeJson(resolve(output, 'blind-packet.json'), packet)
    store.writeJson(resolve(output, 'blind-key.json'), key)
    const humanView = renderAuthorQualityHumanPacket(packet), humanViewPath = resolve(output, 'human-review.html')
    if (Buffer.byteLength(humanView) > 1024 * 1024) throw Error('Human review view exceeds its artifact budget')
    store.assertCapacity()
    await writeFile(humanViewPath, humanView, { flag: 'wx' })
    const viewHash = bytesHash(Buffer.from(humanView))
    if (bytesHash(await readFile(humanViewPath)) !== viewHash) throw Error('Human review view readback differs')
    store.writeJson(resolve(output, 'human-review-view.json'), { packetHash: authorQualityHash(packet),
      path: 'human-review.html', sha256: viewHash, derivedReadOnlyView: true, humanReviews: 0, accepted: false })
    const judgment = await call(authorQualityJudgeRequest(packet, protocol), AUTHOR_QUALITY_JUDGE_SCHEMA,
      raw => validateAuthorQualityJudgment(raw, packet, protocol), 'independent-review')
    store.writeJson(resolve(output, 'independent-judgment.json'), { packetHash: authorQualityHash(packet), judgment,
      provider: protocol.provider, model: protocol.reviewerModel, humanReviews: 0, accepted: false })
  }
} catch (error) {
  failure = { kind: 'evaluation-stopped', message: error instanceof Error ? error.message : 'unknown error', diagnostic: error.codexDiagnostic ?? null }
} finally {
  runtime.close(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
  let sourceUnchanged = false
  try { await assertUnchanged(); sourceUnchanged = true } catch { failure ??= { kind: 'source-changed' } }
  store.writeJson(resolve(output, 'terminal.json'), { schema: 'storyforge.narrative-author-quality-terminal', version: 1,
    completedAt: new Date().toISOString(), execute: values.execute, sourceUnchanged, failure, interrupted,
    actualCallsObserved: [...attempts.values()].filter(result => result.dispatched).length,
    persistedTerminalCalls: results.size, bindings,
    uncommittedAttempts: [...attempts.values()].filter(result => !results.has(result.callId))
      .map(result => ({ callId: result.callId, dispatched: result.dispatched, generationCompleted: result.generationCompleted,
        statusObservedInMemory: result.status, automaticRedispatchAllowed: false })),
    results: [...results.values()].map(({ rawText: _raw, value: _value, ...result }) => result),
    independentHumanReviews: 0, costUsd: null, accepted: false, finalQualityGate: 'not-run; requires genuine human review and edit/time records' },
  READER_STORAGE_POLICY.maximumSummaryBytes)
}
if (failure) process.exitCode = 2
