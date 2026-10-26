import { sha256, readerMessages, validateReaderAnswer, readerUsageWithinBudget } from './narrative-reader-contract.mjs'

const prefix = 'tests/acceptance/narrative-world/'
const countBy = (rows, key) => Object.fromEntries([...new Set(rows.map(row => row[key]))].sort().map(value => {
  const selected = rows.filter(row => row[key] === value)
  return [value, { planned: selected.length, eligible: selected.filter(row => row.status === 'completed').length,
    failed: selected.filter(row => row.status === 'failed').length, unknown: selected.filter(row => row.status === 'unknown').length }]
}))
const same = (left, right) => sha256(left) === sha256(right)
const identityKeys = ['id', 'questionId', 'familyId', 'split', 'operation', 'condition', 'promptHash']

/** A separate diagnostic input contract. It never creates a complete reader
 * report, fabricates a missing answer or dispatches a historical reader call. */
export async function loadIncompleteReaderJudgeCoverageV1({ diagnosticPath, policyPath, readFrozen, listDirectory }) {
  const policy = JSON.parse(await readFrozen(policyPath)), diagnosticBytes = await readFrozen(diagnosticPath)
  if (policy.schema !== 'storyforge.narrative-reader-judge-coverage-policy' || policy.version !== 1
    || policy.mode !== 'incomplete-diagnostic-only' || policy.accepted !== false
    || policy.diagnosticPath !== diagnosticPath || policy.diagnosticSha256 !== sha256(diagnosticBytes)
    || policy.rubricVersion !== 'content-disposition-grounding-scope-v2'
    || policy.missingReaderPolicy !== 'retain-planned-denominator-never-dispatch-or-grade'
    || policy.completeMatrixAcceptance !== false) throw Error('Unknown incomplete reader coverage policy')
  const report = JSON.parse(diagnosticBytes)
  if (report.schema !== 'storyforge.narrative-reader-incomplete-diagnostic' || report.version !== 1
    || report.accepted !== false || report.executionComplete !== false || report.semanticAcceptance !== false
    || report.cohortFinishedUnattemptedInputs !== true || report.conditionObservations?.unattempted !== 0) {
    throw Error('Reader diagnostic is not a frozen incomplete terminal cohort')
  }
  const evidence = new Map()
  for (const [path, expected] of Object.entries(report.hashes ?? {})) {
    // Runtime hashes describe the historical collection, not current code.
    // Every immutable source, request, receipt, journal and manifest is read.
    if (!path.startsWith(prefix)) continue
    const bytes = await readFrozen(path)
    if (sha256(bytes) !== expected) throw Error(`Historical diagnostic evidence changed: ${path}`)
    evidence.set(path, bytes)
  }
  const readEvidence = path => {
    if (!evidence.has(path)) throw Error(`Unpinned reader evidence: ${path}`)
    return JSON.parse(evidence.get(path))
  }
  const directoryEntries = new Map(), absentEmptyDirectories = []
  for (const [path, expected] of Object.entries(report.inventories ?? {})) {
    if (!path.startsWith(`${prefix}raw/`) || !Array.isArray(expected)) throw Error('Invalid historical reader directory inventory')
    try { directoryEntries.set(path, await listDirectory(path)) }
    catch (error) {
      // Git and frozen file copies do not materialize empty directories. This
      // exception cannot hide a single file or a directory with unknown contents.
      if (error.code !== 'ENOENT' || expected.length) throw error
      absentEmptyDirectories.push(path); directoryEntries.set(path, [])
    }
  }
  for (const [path, expected] of Object.entries(report.inventories ?? {})) {
    const materialized = expected.filter(name => !absentEmptyDirectories.includes(`${path}/${name}`))
    if (!same([...directoryEntries.get(path)].sort(), materialized.sort())) {
      throw Error('Historical reader directory inventory changed')
    }
  }
  const manifestPath = `${report.run}/manifest.json`, readerManifest = readEvidence(manifestPath)
  if (sha256(evidence.get(manifestPath)) !== report.manifestSha256 || readerManifest.accepted !== false) throw Error('Reader manifest binding changed')
  const inputs = readEvidence(readerManifest.inputsPath), readerProtocol = readEvidence(readerManifest.protocolPath)
  const corpusPath = `${prefix}corpus-v1.json`, corpus = readEvidence(corpusPath)
  if (sha256(evidence.get(readerManifest.inputsPath)) !== readerManifest.inputsSha256
    || sha256(evidence.get(readerManifest.protocolPath)) !== readerManifest.protocolSha256
    || sha256(evidence.get(corpusPath)) !== inputs.sourceHashes[corpusPath]
    || readerManifest.provider !== readerProtocol.provider || readerManifest.model !== readerProtocol.model) throw Error('Reader source identity changed')
  const cases = inputs.families.flatMap(family => family.cases), observations = new Map(report.observations.map(row => [row.id, row]))
  const identities = new Map(readerManifest.cases.map(row => [row.id, row])), rows = new Map(report.rows.map(row => [row.id, row]))
  if (observations.size !== report.observations.length || identities.size !== readerManifest.cases.length
    || rows.size !== report.rows.length || new Set(cases.map(row => row.id)).size !== cases.length
    || cases.length !== readerManifest.totalCases || cases.length !== observations.size || cases.length !== identities.size) {
    throw Error('Incomplete diagnostic must retain every original observation exactly once')
  }
  const calls = new Map(), unavailable = [], verifiedObservations = []
  for (const item of cases) {
    const observation = observations.get(item.id), identity = identities.get(item.id)
    const expected = { id: item.id, questionId: item.question.id, familyId: item.familyId, split: item.split,
      operation: item.question.operation, condition: item.condition, promptHash: identity?.promptHash }
    if (!observation || !identity || identityKeys.some(key => observation[key] !== expected[key])
      || !['completed', 'failed', 'unknown'].includes(observation.status)) throw Error('Reader observation identity or terminal status changed')
    const basePath = observation.status === 'unknown'
      ? observation.unknownStartPath?.replace(/\.started\.json$/, '') : observation.resultPath?.replace(/\.result\.json$/, '')
    if (!basePath?.endsWith(`/calls/${identity.promptHash}`)) throw Error('Reader receipt path is not bound to its request')
    const callInventory = report.inventories?.[basePath.slice(0, basePath.lastIndexOf('/'))]
    if (!Array.isArray(callInventory)) throw Error('Reader call directory lacks a frozen inventory')
    const request = readEvidence(`${basePath}.request.json`), started = readEvidence(`${basePath}.started.json`)
    const rebuilt = readerMessages(item, readerProtocol)
    if (request.model !== readerProtocol.model || request.promptHash !== identity.promptHash || started.promptHash !== identity.promptHash
      || sha256(request.messages) !== identity.promptHash || rebuilt.promptHash !== identity.promptHash) throw Error('Reader request or frozen material changed')
    if (observation.status === 'unknown') {
      if (observation.resultPath !== null || evidence.has(`${basePath}.result.json`)
        || callInventory.includes(`${identity.promptHash}.result.json`) || rows.has(item.id)) throw Error('Unknown reader result cannot be supplied or scored')
      unavailable.push({ ...expected, status: 'unknown', unknownStartPath: observation.unknownStartPath })
    } else {
      const result = readEvidence(`${basePath}.result.json`)
      if (result.promptHash !== identity.promptHash || result.status !== observation.status || !result.dispatched
        || result.provider !== readerProtocol.provider || result.model !== readerProtocol.model) throw Error('Reader result status or identity changed')
      if (observation.status === 'failed') {
        if (rows.has(item.id)) throw Error('Failed reader result cannot be scored')
        unavailable.push({ ...expected, status: 'failed', resultPath: observation.resultPath })
      } else {
        if (!readerUsageWithinBudget(result.usage, readerProtocol)) throw Error('Successful reader result lacks bounded usage')
        const answer = validateReaderAnswer(result.rawText, readerProtocol), row = rows.get(item.id)
        if (!row || identityKeys.some(key => row[key] !== expected[key]) || !same(answer, row.answer)) throw Error('Diagnostic row differs from original reader answer')
        const prior = calls.get(identity.promptHash)
        if (prior && (!same(prior.request, request) || !same(prior.answer, answer))) throw Error('Shared reader response changed')
        calls.set(identity.promptHash, { request, answer })
      }
    }
    verifiedObservations.push({ ...expected, status: observation.status })
  }
  const eligible = verifiedObservations.filter(row => row.status === 'completed').length
  const counts = { planned: cases.length, eligible, failed: unavailable.filter(row => row.status === 'failed').length,
    unknown: unavailable.filter(row => row.status === 'unknown').length, distinctReaderInputs: new Set(verifiedObservations.map(row => row.promptHash)).size,
    successfulReaderInputs: calls.size }
  if (!unavailable.length || rows.size !== eligible || counts.distinctReaderInputs !== readerManifest.distinctPrompts
    || !same(counts, policy.expectedCoverage)
    || !same(unavailable.map(({ id, promptHash, status }) => ({ id, promptHash, status })), policy.unavailableReaderObservations)) {
    throw Error('Incomplete reader coverage or unavailable input inventory changed')
  }
  return { report, readerManifest, inputs, readerProtocol, corpus, calls,
    coverage: { mode: policy.mode, policyPath, diagnosticPath, diagnosticSha256: sha256(diagnosticBytes), counts,
      unavailable, absentEmptyDirectories, byCondition: countBy(verifiedObservations, 'condition'), bySplit: countBy(verifiedObservations, 'split'),
      byOperation: countBy(verifiedObservations, 'operation'), completeMatrixAcceptance: false } }
}
