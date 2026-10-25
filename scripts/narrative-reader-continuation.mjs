import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { READER_SCHEMA, sha256, validateReaderAnswer, readerUsageWithinBudget } from './narrative-reader-contract.mjs'

export const readerRequestArtifact = (request, protocol) => ({ promptHash: request.promptHash, model: protocol.model,
  outputSchema: READER_SCHEMA, messages: request.messages, estimatedInputTokens: request.estimatedInputTokens, inputBytes: request.inputBytes })

export function validateReaderCall(prior, request, protocol) {
  const hash = request.promptHash
  if (!prior.request || sha256(prior.request) !== sha256(readerRequestArtifact(request, protocol))) throw Error('Historical reader request changed')
  if (!prior.started) {
    if (prior.result) throw Error('Historical result has no start receipt')
    return null // Reader requests are prepared before dispatch; a request alone is not an attempt.
  }
  if (prior.started.promptHash !== hash || prior.started.model !== protocol.model || !Number.isFinite(Date.parse(prior.started.startedAt))) throw Error('Invalid historical reader start')
  if (!prior.result || prior.result.status === 'unknown-or-interrupted') throw Error('Historical reader outcome is unknown; continuation is blocked')
  const value = prior.result
  if (value.promptHash !== hash || value.provider !== protocol.provider || value.model !== protocol.model
    || value.startedAt !== prior.started.startedAt || typeof value.dispatched !== 'boolean'
    || !['completed', 'failed'].includes(value.status) || typeof value.rawText !== 'string'
    || !Number.isFinite(value.durationMs) || value.durationMs < 0
    || !Number.isFinite(Date.parse(value.completedAt)) || Date.parse(value.completedAt) < Date.parse(value.startedAt)) throw Error('Invalid historical reader result')
  if (value.status === 'completed') {
    const answer = validateReaderAnswer(value.rawText, protocol)
    if (!value.dispatched || !readerUsageWithinBudget(value.usage, protocol) || value.usage.inputTokens < 0 || value.usage.outputTokens < 0
      || sha256(answer) !== sha256(value.answer)) throw Error('Historical completed reader call is invalid')
  } else if (typeof value.error !== 'string' || !value.error) throw Error('Historical failure is missing its diagnostic')
  return value
}

export function validateReaderContinuationParent(parent, frozen) {
  if (parent.schema !== 'storyforge.narrative-reader-run' || ![1, 2].includes(parent.version) || parent.accepted !== false
    || (parent.version === 2 && parent.continuation?.version !== 1)) throw Error('Unrecognized parent reader run')
  for (const key of ['entryId', 'inputsPath', 'inputsSha256', 'protocolPath', 'protocolSha256', 'provider', 'model',
    'reasoningEffort', 'preflight', 'sourceHashes', 'cases', 'totalCases', 'distinctPrompts']) {
    if (sha256(parent[key]) !== sha256(frozen[key])) throw Error(`Continuation changes frozen reader ${key}`)
  }
  // Only orchestration may change. Prompt/scoring, transport, preflight and entry
  // registration must retain their original bytes across the entire chain.
  for (const [path, hash] of Object.entries(parent.runtimeHashes)) {
    if (path === 'scripts/evaluate-narrative-reader-local-codex.mjs') continue
    if (frozen.runtimeHashes[path] !== hash) throw Error(`Continuation changes reader runtime: ${path}`)
  }
}

function rawPath(root, path) {
  const full = resolve(root, path), rel = relative(root, full)
  if (!rel.startsWith('tests/acceptance/narrative-world/raw/') || rel.split('/').includes('..')) throw Error('Continuation requires repository raw evidence')
  return full
}

export async function verifyReaderHistory(root, evidence) {
  for (const [path, hash] of Object.entries(evidence.files)) {
    if (sha256(await readFile(rawPath(root, path))) !== hash) throw Error(`Historical reader evidence changed: ${path}`)
  }
  for (const [path, names] of Object.entries(evidence.directories)) {
    if (sha256((await readdir(rawPath(root, path))).sort()) !== sha256(names)) throw Error(`Historical reader inventory changed: ${path}`)
  }
}

export async function readReaderHistory(root, path, frozen, unique, protocol, seen = new Set()) {
  const directory = rawPath(root, path), run = relative(root, directory)
  if (seen.has(run) || seen.size >= 16) throw Error('Cyclic or excessive reader continuation chain')
  seen.add(run)
  const evidence = { files: {}, directories: {} }
  async function json(file) {
    const full = resolve(directory, file), bytes = await readFile(full)
    evidence.files[relative(root, full)] = sha256(bytes)
    return JSON.parse(bytes)
  }
  const parent = await json('manifest.json')
  validateReaderContinuationParent(parent, frozen)
  if (sha256(await json('preflight.json')) !== parent.preflight.sha256) throw Error('Historical preflight changed')
  let results = new Map()
  if (parent.continuation) {
    const previous = await readReaderHistory(root, parent.continuation.run, frozen, unique, protocol, seen)
    if (previous.manifestSha256 !== parent.continuation.manifestSha256
      || sha256(previous.evidence) !== sha256(parent.continuation.evidence)
      || sha256([...previous.results.keys()]) !== sha256(parent.continuation.inheritedPromptHashes)
      || sha256([...previous.results].filter(([, value]) => value.status !== 'completed').map(([hash]) => hash)) !== sha256(parent.continuation.unresolvedPromptHashes)) throw Error('Reader continuation ancestry changed')
    const claimPath = rawPath(root, parent.continuation.claimPath), claimBytes = await readFile(claimPath), claim = JSON.parse(claimBytes)
    if (sha256(claimBytes) !== parent.continuation.claimSha256
      || sha256(claim) !== sha256({ version: 1, parent: parent.continuation.run,
        parentManifestSha256: previous.manifestSha256, output: run })) throw Error('Historical continuation claim changed')
    evidence.files[relative(root, claimPath)] = sha256(claimBytes)
    results = new Map(previous.results)
    Object.assign(evidence.files, previous.evidence.files); Object.assign(evidence.directories, previous.evidence.directories)
  }
  const names = (await readdir(resolve(directory, 'calls'))).sort(), files = new Set(names)
  evidence.directories[`${run}/calls`] = names
  for (const name of names) {
    const match = /^([a-f0-9]{64})\.(request|started|result)\.json$/.exec(name)
    if (!match || !unique.has(match[1]) || results.has(match[1])) throw Error('Unexpected or repeated historical reader call')
  }
  for (const [hash, request] of unique) {
    if (results.has(hash)) continue
    const prior = {}
    for (const kind of ['request', 'started', 'result']) {
      if (files.has(`${hash}.${kind}.json`)) prior[kind] = await json(`calls/${hash}.${kind}.json`)
    }
    const value = validateReaderCall(prior, request, protocol)
    if (value) results.set(hash, value)
  }
  const topNames = (await readdir(directory)).sort()
  evidence.directories[run] = topNames
  let settled = false
  for (const name of topNames.filter(name => /^summary-.*\.json$/.test(name))) {
    const summary = await json(name)
    if (summary.manifestSha256 !== sha256(parent) || summary.notYetCalled !== unique.size - results.size
      || summary.completedActualCalls !== [...results.values()].filter(value => value.status === 'completed').length
      || summary.failedActualCalls !== [...results.values()].filter(value => value.status !== 'completed').length) continue
    const expected = frozen.cases.filter(item => results.get(item.promptHash)?.status === 'completed')
    if (summary.completedCases !== expected.length || summary.rows?.length !== expected.length
      || new Set(summary.rows.map(row => row.id)).size !== expected.length) continue
    settled = expected.every(item => {
      const row = summary.rows.find(value => value.id === item.id), call = results.get(item.promptHash)
      return row?.promptHash === item.promptHash && sha256(row.answer) === sha256(call.answer)
        && sha256(row.usage) === sha256(call.usage) && row.durationMs === call.durationMs
    })
    if (settled) break
  }
  // Freeze every summary, even if a prior one already proves settlement.
  for (const name of topNames.filter(name => /^summary-.*\.json$/.test(name))) {
    if (!evidence.files[`${run}/${name}`]) await json(name)
  }
  if (!settled) throw Error('Historical reader batch has no matching terminal summary')
  await verifyReaderHistory(root, evidence)
  return { results, evidence, manifestSha256: sha256(await readFile(resolve(directory, 'manifest.json'))) }
}

export async function reserveReaderContinuation(root, run, parentManifestSha256, output) {
  const parent = relative(root, rawPath(root, run)), target = relative(root, rawPath(root, output))
  if (parent === target) throw Error('Continuation must use a new run directory')
  const directory = resolve(root, 'tests/acceptance/narrative-world/raw/reader-continuation-claims')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `${sha256({ parent, parentManifestSha256 })}.json`)
  const claim = { version: 1, parent, parentManifestSha256, output: target }
  try { await writeFile(path, JSON.stringify(claim, null, 2) + '\n', { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (sha256(JSON.parse(await readFile(path))) !== sha256(claim)) throw Error('Parent reader batch already has a different continuation; use its latest descendant')
  }
  return relative(root, path)
}

export function readerExecutionCounts(calls, distinctPrompts) {
  const actual = calls.filter(call => call.dispatched)
  return { recordedAttempts: calls.length, actualCalls: actual.length,
    completedActualCalls: actual.filter(call => call.status === 'completed').length,
    failedActualCalls: actual.filter(call => call.status === 'failed').length,
    unknownActualCalls: actual.filter(call => call.status === 'unknown-or-interrupted').length,
    preDispatchFailures: calls.filter(call => !call.dispatched).length,
    unknownUsageCalls: actual.filter(call => !call.usage).length, unattempted: distinctPrompts - calls.length }
}

// A dry run, startup failure and zero-new-call resume must never collide.
export const readerSummaryName = count => `summary-${String(count).padStart(4, '0')}-${randomUUID()}.json`
