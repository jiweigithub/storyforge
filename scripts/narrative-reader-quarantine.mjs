import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { sha256 } from './narrative-reader-contract.mjs'
import { validateReaderCall, validateReaderContinuationParent, readReaderHistory,
  verifyReaderHistory } from './narrative-reader-continuation.mjs'

// Protocols 2/3 retain their original stop rules. Version 4 adds only an
// explicitly selected, audited cohort; it never resumes the interrupted run.
export function readerEvaluationProtocol(protocol) {
  if (protocol.version !== 4) return protocol
  const { recoveryPolicy: policy, ...evaluation } = protocol
  if (policy?.version !== 1 || policy.mode !== 'audited-quarantine-unattempted-only'
    || policy.repeatAttemptedInputs !== false || policy.replaceHistoricalResults !== false
    || policy.unknownCountsAsPassed !== false || policy.automaticRecoveryAfterNewFailure !== false
    || typeof policy.parentRun !== 'string' || typeof policy.auditPath !== 'string'
    || !/^[a-f0-9]{64}$/.test(policy.auditSha256)) throw Error('Unsafe reader quarantine policy')
  return { ...evaluation, version: 3 }
}

function rawPath(root, path) {
  const full = resolve(root, path), rel = relative(root, full)
  if (!rel.startsWith('tests/acceptance/narrative-world/raw/')) throw Error('Quarantine requires repository raw evidence')
  return full
}

export async function readReaderQuarantine(root, path, frozen, unique, protocol) {
  const evaluation = readerEvaluationProtocol(protocol), policy = protocol.recoveryPolicy
  if (protocol.version !== 4 || path !== policy.parentRun) throw Error('Quarantine requires the exact versioned parent')
  const directory = rawPath(root, path), run = relative(root, directory)
  const evidence = { files: {}, directories: {} }
  async function json(full) {
    const bytes = await readFile(full)
    evidence.files[relative(root, full)] = sha256(bytes)
    return JSON.parse(bytes)
  }
  const auditFile = rawPath(root, policy.auditPath), audit = await json(auditFile)
  if (evidence.files[relative(root, auditFile)] !== policy.auditSha256
    || audit.schema !== 'storyforge.narrative-reader-continuation-evidence' || audit.version !== 2
    || audit.run !== run || audit.accepted !== false || audit.executionComplete !== false
    || !Number.isInteger(audit.observedProcessTerminal?.sessionId)
    || !Number.isInteger(audit.observedProcessTerminal?.exitCode) || audit.observedProcessTerminal.exitCode === 0
    || !Number.isFinite(Date.parse(audit.observedProcessTerminal.terminalObservedAt))
    || audit.observedProcessTerminal.runnerSummaryWritten !== false
    || !Array.isArray(audit.unknown) || !audit.unknown.length) throw Error('Missing interrupted-process audit')
  const parent = await json(resolve(directory, 'manifest.json'))
  const manifestSha256 = evidence.files[`${run}/manifest.json`]
  if (audit.manifestSha256 !== manifestSha256) throw Error('Quarantine audit does not bind the parent manifest')
  const oldProtocolPath = resolve(root, parent.protocolPath)
  if (!relative(root, oldProtocolPath).startsWith('tests/acceptance/narrative-world/')) throw Error('Invalid parent protocol path')
  const oldProtocolBytes = await readFile(oldProtocolPath), oldProtocol = JSON.parse(oldProtocolBytes)
  if (sha256(oldProtocolBytes) !== parent.protocolSha256 || sha256(oldProtocol) !== sha256(evaluation)) {
    throw Error('Quarantine changes the original model, prompts, budget, scoring or preflight protocol')
  }
  validateReaderContinuationParent(parent, { ...frozen, protocolPath: parent.protocolPath, protocolSha256: parent.protocolSha256 })
  if (sha256(await json(resolve(directory, 'preflight.json'))) !== parent.preflight.sha256) throw Error('Historical preflight changed')
  let previous = { results: new Map(), evidence: { files: {}, directories: {} } }
  if (parent.continuation) {
    previous = await readReaderHistory(root, parent.continuation.run, parent, unique, oldProtocol)
    if (previous.manifestSha256 !== parent.continuation.manifestSha256
      || sha256(previous.evidence) !== sha256(parent.continuation.evidence)
      || sha256([...previous.results.keys()]) !== sha256(parent.continuation.inheritedPromptHashes)
      || sha256([...previous.results].filter(([, value]) => value.status !== 'completed').map(([hash]) => hash))
        !== sha256(parent.continuation.unresolvedPromptHashes)) throw Error('Quarantine ancestry changed')
    const claimPath = rawPath(root, parent.continuation.claimPath), claim = await json(claimPath)
    if (evidence.files[relative(root, claimPath)] !== parent.continuation.claimSha256
      || sha256(claim) !== sha256({ version: 1, parent: parent.continuation.run,
        parentManifestSha256: previous.manifestSha256, output: run })) throw Error('Historical continuation claim changed')
    Object.assign(evidence.files, previous.evidence.files)
    Object.assign(evidence.directories, previous.evidence.directories)
  }
  const results = new Map(previous.results), quarantined = new Map()
  const names = (await readdir(resolve(directory, 'calls'))).sort(), files = new Set(names)
  evidence.directories[`${run}/calls`] = names
  for (const name of names) {
    const match = /^([a-f0-9]{64})\.(request|started|result)\.json$/.exec(name)
    if (!match || !unique.has(match[1]) || results.has(match[1])) throw Error('Unexpected or repeated quarantined reader call')
  }
  for (const [hash, request] of unique) {
    if (results.has(hash)) continue
    const prior = {}
    for (const kind of ['request', 'started', 'result']) {
      if (files.has(`${hash}.${kind}.json`)) prior[kind] = await json(resolve(directory, 'calls', `${hash}.${kind}.json`))
    }
    if (prior.started && !prior.result) {
      // Validate the prepared request without inventing a model result or a
      // dispatch acknowledgement for the missing receipt.
      validateReaderCall({ request: prior.request }, request, oldProtocol)
      const missing = audit.unknown.filter(item => item.promptHash === hash)
      const startReceipt = `${run}/calls/${hash}.started.json`
      if (prior.started.promptHash !== hash || prior.started.model !== protocol.model
        || !Number.isFinite(Date.parse(prior.started.startedAt))
        || Date.parse(prior.started.startedAt) > Date.parse(audit.observedProcessTerminal.terminalObservedAt)
        || missing.length !== 1 || missing[0].startReceipt !== startReceipt || missing[0].startedAt !== prior.started.startedAt
        || missing[0].providerDispatchAcknowledgedInDurableReceipt !== null || missing[0].result !== null
        || missing[0].usage !== null || missing[0].costUsd !== null) throw Error('Unknown attempt differs from its interruption audit')
      quarantined.set(hash, { promptHash: hash, startReceipt, startedAt: prior.started.startedAt,
        outcome: 'unknown', providerDispatchAcknowledged: null, result: null, usage: null, costUsd: null })
    } else {
      const value = validateReaderCall(prior, request, oldProtocol)
      if (value) results.set(hash, value)
    }
  }
  if (audit.unknown.length !== quarantined.size || !quarantined.size) throw Error('Unknown attempt inventory changed')
  const topNames = (await readdir(directory)).sort()
  evidence.directories[run] = topNames
  for (const name of topNames) if (name !== 'calls') {
    const full = resolve(directory, name)
    evidence.files[relative(root, full)] = sha256(await readFile(full))
  }
  // Audit every interrupted-cohort byte, including prewritten unattempted
  // requests and earlier summaries; a missing terminal is never fabricated.
  for (const [file, hash] of Object.entries(evidence.files)) if (file.startsWith(`${run}/`) && audit.rawHashes?.[file] !== hash) {
    throw Error(`Quarantine evidence differs from its audit: ${file}`)
  }
  for (const [file, hash] of Object.entries(audit.rawHashes ?? {})) if (file.startsWith(`${run}/`) && evidence.files[file] !== hash) {
    throw Error(`Audited quarantine evidence is missing or changed: ${file}`)
  }
  const actual = [...results.values()].filter(value => value.dispatched)
  const counts = { distinctInputSlots: unique.size, attemptedInputSlots: results.size + quarantined.size,
    knownActualCalls: actual.length, completedResults: actual.filter(value => value.status === 'completed').length,
    knownFailedResults: actual.filter(value => value.status === 'failed').length, unknownAttempts: quarantined.size,
    unattemptedInputSlots: unique.size - results.size - quarantined.size }
  if (Object.entries(counts).some(([key, value]) => audit.combined?.[key] !== value) || counts.unattemptedInputSlots < 1) {
    throw Error('Quarantine attempt accounting differs from the audit or has no unattempted inputs')
  }
  await verifyReaderHistory(root, evidence)
  return { results, quarantined, evidence, manifestSha256, counts,
    parentProtocol: { path: parent.protocolPath, sha256: parent.protocolSha256 },
    audit: { path: policy.auditPath, sha256: policy.auditSha256 } }
}
