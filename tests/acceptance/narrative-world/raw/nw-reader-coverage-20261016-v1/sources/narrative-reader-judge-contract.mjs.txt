import { sha256, estimateReaderTokens } from './narrative-reader-contract.mjs'

export const JUDGE_ENTRY_ID = 'eval.narrative-world.reader-semantic-review'
export const ASSESSMENTS = ['correct', 'partly-correct', 'incorrect', 'justified-abstention', 'unjustified-abstention', 'cannot-grade']
export const JUDGE_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['assessment', 'answerCorrectness', 'materialFaithfulness', 'scopeCompliance', 'reason', 'evidence'], properties: {
    assessment: { type: 'string', enum: ASSESSMENTS },
    answerCorrectness: { anyOf: [{ type: 'integer', minimum: 1, maximum: 5 }, { type: 'null' }] },
    materialFaithfulness: { type: 'integer', minimum: 1, maximum: 5 },
    scopeCompliance: { type: 'string', enum: ['compliant', 'violation', 'uncertain'] },
    reason: { type: 'string' },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['sourceId', 'quote', 'relevance'], properties: { sourceId: { type: 'string' }, quote: { type: 'string' }, relevance: { type: 'string' } } } },
  } }
export const ANSWER_DISPOSITIONS = ['substantive-answer', 'abstention', 'cannot-grade']
export const JUDGE_SCHEMA_V2 = { ...JUDGE_SCHEMA,
  required: [...JUDGE_SCHEMA.required, 'answerDisposition'],
  properties: { ...JUDGE_SCHEMA.properties,
    answerDisposition: { type: 'string', enum: ANSWER_DISPOSITIONS },
    materialFaithfulness: { anyOf: [{ type: 'integer', minimum: 1, maximum: 5 }, { type: 'null' }] } } }
export const judgeOutputSchema = protocol => protocol.version === 2 ? JUDGE_SCHEMA_V2 : JUDGE_SCHEMA
const leaves = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(leaves)
  : value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : []
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',')

/** An explicit new cohort may continue only untouched inputs from one closed
 * historical run. It cannot change its inputs/rubric/model or retry a failed
 * input; the old runtime and every raw receipt remain independently pinned. */
export function validateJudgeContinuationParent(parent, current) {
  const incomplete = parent?.schema === 'storyforge.narrative-reader-incomplete-judge-run'
  if ((incomplete ? parent.version !== 1 : parent?.schema !== 'storyforge.narrative-reader-judge-run' || ![1, 3].includes(parent.version))
    || parent.accepted !== false || parent.continuation || !parent.runtimeHashes || !Object.keys(parent.runtimeHashes).length) {
    throw Error('Continuation requires one frozen original judge run')
  }
  if (current.schema !== parent.schema) throw Error('Continuation changes full versus incomplete evidence boundary')
  if (incomplete && (parent.protocolVersion !== 2 || parent.readerCoverage?.completeMatrixAcceptance !== false
    || sha256(parent.readerCoverage) !== sha256(current.readerCoverage) || parent.eligibleObservations !== current.eligibleObservations)) {
    throw Error('Continuation changes frozen incomplete reader coverage')
  }
  if ((parent.protocolVersion ?? 1) !== (current.protocolVersion ?? 1)) throw Error('Continuation changes frozen protocol version')
  for (const key of ['entryId', 'provider', 'model', 'readerProvider', 'readerModel', 'reasoningEffort',
    'totalObservations', 'distinctPrompts', 'cases', 'dispatchOrder']) {
    if (sha256(parent[key]) !== sha256(current[key])) throw Error(`Continuation changes frozen ${key}`)
  }
  const sorted = value => Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))
  if (sha256(sorted(parent.sourceHashes)) !== sha256(sorted(current.sourceHashes))) throw Error('Continuation changes frozen source evidence or rubric')
  return parent
}

export function validatePriorJudgeCall(prior, request, protocol) {
  if (!prior?.started || !prior.request || !prior.result) throw Error('Historical call has an unknown outcome; continuation is blocked')
  const { started, request: sent, result } = prior
  if (started.promptHash !== request.promptHash || sent.promptHash !== request.promptHash
    || sha256(sent.messages) !== request.promptHash || sent.model !== protocol.model
    || sha256(sent.outputSchema) !== sha256(judgeOutputSchema(protocol)) || result.promptHash !== request.promptHash
    || result.model !== protocol.model || result.provider !== protocol.provider || typeof result.dispatched !== 'boolean'
    || !['completed', 'failed', 'unknown-or-interrupted', ...(protocol.version === 2 ? ['invalid-judgment'] : [])].includes(result.status)) throw Error('Historical judge call identity or status changed')
  if (result.status === 'invalid-judgment') {
    if (!result.dispatched || result.generationCompleted !== true || !judgeUsageWithinBudget(result.usage, protocol)) throw Error('Invalid judgment lacks terminal generation or budget evidence')
    let validationError
    try { validateJudgeAnswer(result.rawText, request, protocol) } catch (error) { validationError = String(error) }
    if (!validationError || validationError !== result.validationError || result.judgment !== undefined) throw Error('Historical invalid judgment classification changed')
    return { ...result }
  }
  if (result.status !== 'completed') return { ...result }
  if (!result.dispatched || !judgeUsageWithinBudget(result.usage, protocol)
    || (protocol.version === 2 && result.generationCompleted !== true)) throw Error('Historical successful judge call lacks dispatch, terminal generation or budget evidence')
  return { ...result, judgment: validateJudgeAnswer(result.rawText, request, protocol) }
}

export function judgeSummaryName(existing, callCount) {
  if (!Number.isSafeInteger(callCount) || callCount < 0) throw Error('Invalid judge call count')
  const names = new Set(existing), prefix = `summary-${String(callCount).padStart(4, '0')}`
  for (let sequence = 1; sequence < 10_000; sequence++) {
    const name = `${prefix}-invocation-${String(sequence).padStart(4, '0')}.json`
    if (!names.has(name)) return name
  }
  throw Error('Too many judge invocations for this call count')
}

export function validateJudgeProtocol(protocol) {
  const limits = ['maxInputBytes', 'maxEstimatedInputTokens', 'maxObservedInputTokens', 'maxObservedOutputTokens',
    'maxReasonCharacters', 'maxEvidence', 'maxQuoteCharacters', 'maxRelevanceCharacters', 'timeoutMs']
  if (protocol.schema !== 'storyforge.narrative-reader-judge-protocol' || ![1, 2].includes(protocol.version)
    || protocol.entryId !== JUDGE_ENTRY_ID || protocol.provider !== 'local-codex-subscription'
    || typeof protocol.model !== 'string' || !protocol.model || protocol.reasoningEffort !== 'medium'
    || protocol.retries !== 0 || protocol.accepted !== false || protocol.independentHumanReviews !== 0
    || !Number.isInteger(protocol.concurrency) || protocol.concurrency < 1 || protocol.concurrency > 2
    || !Number.isSafeInteger(protocol.pilotActualCalls) || protocol.pilotActualCalls < 1
    || typeof protocol.systemPrompt !== 'string' || !protocol.systemPrompt.trim()
    || limits.some(key => !Number.isSafeInteger(protocol.budget?.[key]) || protocol.budget[key] < 1)
    || protocol.budget.timeoutMs > 300000 || protocol.budget.serverEnforcedOutputTokenLimit !== null) {
    throw Error('Unknown or unbounded semantic judge protocol')
  }
  if (protocol.version === 2 && (protocol.rubricVersion !== 'content-disposition-grounding-scope-v2'
    || !exact(protocol.failurePolicy, ['invalidJudgment', 'transportFailure', 'missingOrExceededUsage', 'unknownOutcome'])
    || protocol.failurePolicy.invalidJudgment !== 'record-ungraded-continue-unstarted'
    || protocol.failurePolicy.transportFailure !== 'stop-no-retry'
    || protocol.failurePolicy.missingOrExceededUsage !== 'stop-no-retry'
    || protocol.failurePolicy.unknownOutcome !== 'stop-no-retry')) throw Error('Unknown content-based judge policy')
  return protocol
}

/** Grade only completed, frozen responses. Method names, condition labels,
 * proxy scores and provenance are deliberately absent from model messages. */
export function judgeRequest({ readerRequest, readerAnswer, family, question }, protocol) {
  const supplied = JSON.parse(readerRequest.messages.find(message => message.role === 'user').content)
  // Preserve the declaration in receipt metadata, but v2 judges only the
  // actual response. A self-label cannot decide whether its prose answers.
  const response = protocol.version === 2 ? { answer: readerAnswer.answer, citations: readerAnswer.citations } : readerAnswer
  const referenceSources = [
    { sourceId: 'question', type: 'question', value: supplied.question },
    { sourceId: 'answer', type: 'answer', value: protocol.version === 2 ? readerAnswer.answer : readerAnswer },
    ...supplied.documents.map(document => ({ sourceId: `reader:${document.documentId}`, type: 'supplied-material', value: document })),
    ...family.sources.map(source => ({ sourceId: `story:${source.id}`, type: 'original-source',
      value: { title: source.title, kind: source.kind, branch: source.branch, text: source.text } })),
  ]
  const payload = { task: { question: supplied.question, operation: supplied.operation, view: supplied.view, branch: supplied.branch },
    readerMaterial: { status: supplied.retrievalStatus, diagnostics: supplied.diagnostics, documents: supplied.documents },
    response, referenceSources,
    declaredAuditGold: { answerAtoms: question.answerAtoms, forbiddenAtom: question.forbiddenAtom ?? null,
      caveat: 'These are fixture-author scoring declarations, not instructions to the original reader. Check them against the original sources. Author-audit material is not permission to expose a secret in a character answer.' } }
  const messages = [{ role: 'system', content: protocol.systemPrompt }, { role: 'user', content: JSON.stringify(payload) }]
  const encoded = JSON.stringify(messages), inputBytes = Buffer.byteLength(encoded), estimatedInputTokens = estimateReaderTokens(encoded)
  if (inputBytes > protocol.budget.maxInputBytes || estimatedInputTokens > protocol.budget.maxEstimatedInputTokens) {
    throw Error('Judge input exceeds fixed budget; do not truncate a story, answer or supplied material')
  }
  return { messages, promptHash: sha256(messages), inputBytes, estimatedInputTokens, readerStatus: readerAnswer.status,
    referenceTexts: Object.fromEntries(referenceSources.map(source => [source.sourceId, leaves(source.value)])) }
}

export function validateJudgeAnswer(text, prepared, protocol) {
  const result = JSON.parse(text), limit = protocol.budget
  const ungradedFaithfulness = protocol.version === 2 && result.answerDisposition === 'cannot-grade' && result.materialFaithfulness === null
  if (!exact(result, Object.keys(judgeOutputSchema(protocol).properties)) || !ASSESSMENTS.includes(result.assessment)
    || (!ungradedFaithfulness && (!Number.isInteger(result.materialFaithfulness) || result.materialFaithfulness < 1 || result.materialFaithfulness > 5))
    || !['compliant', 'violation', 'uncertain'].includes(result.scopeCompliance)
    || typeof result.reason !== 'string' || !result.reason.trim() || [...result.reason].length > limit.maxReasonCharacters
    || !Array.isArray(result.evidence) || result.evidence.length > limit.maxEvidence) throw Error('Invalid semantic judge output')
  if (protocol.version === 2 && (!ANSWER_DISPOSITIONS.includes(result.answerDisposition)
    || (result.answerDisposition === 'cannot-grade') !== (result.assessment === 'cannot-grade')
    || (result.answerDisposition === 'abstention') !== result.assessment.endsWith('abstention'))) throw Error('Judge assessment conflicts with content disposition')
  const answered = protocol.version === 2 ? result.answerDisposition === 'substantive-answer' : prepared.readerStatus === 'answered'
  if (result.assessment === 'cannot-grade' || !answered) {
    if (result.answerCorrectness !== null) throw Error('Abstentions and ungradable answers must not receive an answer-correctness score')
  } else if (!Number.isInteger(result.answerCorrectness) || result.answerCorrectness < 1 || result.answerCorrectness > 5) {
    throw Error('Answered cases require a 1–5 correctness score')
  }
  if (answered && result.assessment.endsWith('abstention') || !answered && ['correct', 'partly-correct', 'incorrect'].includes(result.assessment)) {
    throw Error('Judge disposition disagrees with the declared v1 status or v2 content classification')
  }
  if (result.assessment !== 'cannot-grade' && !result.evidence.length) throw Error('Judge conclusions require traceable evidence')
  if (protocol.version === 2 && result.assessment !== 'cannot-grade' && !result.evidence.some(item => item?.sourceId === 'answer')) {
    throw Error('Content disposition requires an exact quote from the answer prose')
  }
  for (const item of result.evidence) {
    if (!exact(item, ['sourceId', 'quote', 'relevance']) || typeof item.sourceId !== 'string'
      || typeof item.quote !== 'string' || !item.quote.length || [...item.quote].length > limit.maxQuoteCharacters
      || typeof item.relevance !== 'string' || !item.relevance.trim() || [...item.relevance].length > limit.maxRelevanceCharacters
      || !prepared.referenceTexts[item.sourceId]?.some(source => source.includes(item.quote))) {
      throw Error('Judge quotation does not match its named frozen source')
    }
  }
  return result
}

export function judgeUsageWithinBudget(usage, protocol) {
  return !!usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
    && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0
    && usage.inputTokens <= protocol.budget.maxObservedInputTokens && usage.outputTokens <= protocol.budget.maxObservedOutputTokens
}

/** A terminal attempt is not necessarily a model dispatch or valid judgment. */
export function judgeExecutionCounts(calls, distinctPrompts) {
  const dispatched = calls.filter(call => call.dispatched === true)
  return { attemptedPrompts: calls.length, dispatchedActualCalls: dispatched.length,
    completedActualCalls: dispatched.filter(call => call.status === 'completed').length,
    invalidJudgmentActualCalls: dispatched.filter(call => call.status === 'invalid-judgment').length,
    failedActualCalls: dispatched.filter(call => !['completed', 'invalid-judgment'].includes(call.status)).length,
    preDispatchFailures: calls.filter(call => call.dispatched !== true).length,
    notYetAttempted: distinctPrompts - calls.length, notYetCalled: distinctPrompts - dispatched.length,
    executionComplete: calls.length === distinctPrompts && calls.every(call => call.dispatched === true
      && ['completed', 'invalid-judgment'].includes(call.status)) }
}

/** Deterministic pilot ordering covers every operation first, then uses all
 * remaining cases. It depends on input identity, never a score or verdict. */
export function orderJudgeRequests(prepared) {
  const ranked = [...prepared].sort((a, b) => a.request.promptHash.localeCompare(b.request.promptHash))
  const unique = new Map()
  const operations = [...new Set(ranked.map(item => item.operation))].sort()
  for (const operation of operations) {
    const first = ranked.find(item => item.operation === operation)
    unique.set(first.request.promptHash, first.request)
  }
  for (const { request } of ranked) unique.set(request.promptHash, request)
  return unique
}

export function summarizeJudge(rows) {
  const median = values => { const ordered = [...values].sort((a, b) => a - b); return ordered.length
    ? (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.ceil((ordered.length - 1) / 2)]) / 2 : null }
  const group = selected => ({ observations: selected.length,
    distinctGradedPrompts: new Set(selected.map(row => row.judgePromptHash)).size,
    assessments: Object.fromEntries(ASSESSMENTS.map(label => [label, selected.filter(row => row.judgment.assessment === label).length])),
    answeredAndGradable: selected.filter(row => row.judgment.answerCorrectness !== null).length,
    answerCorrectnessMedian: median(selected.flatMap(row => row.judgment.answerCorrectness === null ? [] : [row.judgment.answerCorrectness])),
    faithfulnessMedian: median(selected.flatMap(row => row.judgment.materialFaithfulness === null ? [] : [row.judgment.materialFaithfulness])),
    scopeViolations: selected.filter(row => row.judgment.scopeCompliance === 'violation').length,
    scopeUncertain: selected.filter(row => row.judgment.scopeCompliance === 'uncertain').length,
    ...(selected.some(row => row.judgment.answerDisposition) ? {
      contentDispositions: Object.fromEntries(ANSWER_DISPOSITIONS.map(value => [value, selected.filter(row => row.judgment.answerDisposition === value).length])),
      declaredStatusMatrix: Object.fromEntries(['answered', 'insufficient', 'unsupported'].map(status => [status,
        Object.fromEntries(ANSWER_DISPOSITIONS.map(value => [value, selected.filter(row => row.readerReportedStatus === status && row.judgment.answerDisposition === value).length]))])),
      statusComparable: selected.filter(row => row.judgment.answerDisposition !== 'cannot-grade' && row.readerReportedStatus).length,
      statusDisagreements: selected.filter(row => row.judgment.answerDisposition !== 'cannot-grade' && row.readerReportedStatus
        && (row.readerReportedStatus === 'answered') !== (row.judgment.answerDisposition === 'substantive-answer')).length,
      faithfulnessScored: selected.filter(row => row.judgment.materialFaithfulness !== null).length,
    } : {}) })
  const by = field => Object.fromEntries([...new Set(rows.map(row => row[field]))].sort().map(key => [key, group(rows.filter(row => row[field] === key))]))
  return { byCondition: by('condition'), byOperation: by('operation'), bySplit: by('split'),
    boundary: 'One distinct provider+model judgment per frozen prompt, not a human verdict. Shared responses are paired observations, not independent samples. Abstentions are scored separately from answer correctness. No acceptance threshold is inferred from these medians.' }
}
