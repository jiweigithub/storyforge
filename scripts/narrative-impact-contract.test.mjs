import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sha256 } from './narrative-reader-contract.mjs'
import { IMPACT_SCHEMA, impactRequest, prepareImpactCases, validateImpactProtocol,
  validateImpactAnswer, validatePriorImpactCall, isRetainedInvalidImpactCall, impactMissingResultHashes, impactUsageWithinBudget, scoreImpactSuggestion, summarizeImpactSuggestions } from './narrative-impact-contract.mjs'

const corpus = JSON.parse(readFileSync(new URL('../tests/acceptance/narrative-world/corpus-v1.json', import.meta.url)))
const protocol = JSON.parse(readFileSync(new URL('../tests/acceptance/narrative-world/impact-model-protocol-20261015-v1.json', import.meta.url)))
const protocolV2 = JSON.parse(readFileSync(new URL('../tests/acceptance/narrative-world/impact-model-protocol-20261015-v2.json', import.meta.url)))
const family = corpus.families[0], edit = family.edits[0], request = impactRequest(family, edit, protocol)
const quote = text => [...text].slice(0, 35).join('')
const answer = () => ({ recommendations: request.targetSourceIds.map(sourceId => ({ sourceId, disposition: 'no-specific-impact',
  reason: '仅为合同反例使用的合成回答，不是模型证据。', evidence: [
    { sourceId, quote: quote(request.referenceTexts[sourceId]) }, { sourceId: 'AFTER', quote: quote(request.referenceTexts.AFTER) },
  ] })) })
const validate = value => validateImpactAnswer(JSON.stringify(value), request, protocol)

test('all 48 original edits freeze in the original 8/4 family partition with a blind stratified pilot', () => {
  const prepared = prepareImpactCases(corpus, protocol)
  assert.equal(prepared.length, 48)
  assert.equal(new Set(prepared.map(row => row.request.promptHash)).size, 48)
  assert.equal(new Set(prepared.filter(row => row.split === 'holdout').map(row => row.familyId)).size, 4)
  assert.equal(new Set(prepared.slice(0, 8).map(row => `${row.split}/${row.kind}`)).size, 8)
  for (const row of prepared) assert.equal(row.request.targetSourceIds.length, 3)
})

test('gold, edit kind, split and scoring rationale cannot alter model messages', () => {
  const copied = structuredClone(family), target = copied.edits[0]
  copied.split = 'POISON-SPLIT'; copied.queries = [{ answerAtoms: ['POISON-ANSWER'] }]
  Object.assign(target, { kind: 'POISON-KIND', mustReview: ['POISON-REVIEW'], mustNotReview: ['POISON-SKIP'],
    rationale: 'POISON-RATIONALE', dependencyEvidence: [{ quote: 'POISON-DEPENDENCY' }], protectedFact: 'POISON-PROTECTED' })
  copied.seed.truth = 'POISON-TRUTH'; copied.seed.belief = 'POISON-BELIEF'; copied.seed.plannedText = 'POISON-PLAN'
  assert.deepEqual(impactRequest(copied, target, protocol).messages, request.messages)
  assert.doesNotMatch(JSON.stringify(request.messages), /mustReview|mustNotReview|dependencyEvidence|answerAtoms|POISON/)
})

test('the locked statement is explicit existing fixture knowledge with an original source, not elevated Canon', () => {
  const payload = JSON.parse(request.messages[1].content)
  assert.equal(payload.protectedFact.predicate, 'knows')
  assert.equal(payload.protectedFact.value, family.seed.lockedQuote)
  assert.equal(payload.protectedFact.locked, true)
  assert(payload.storyBefore.find(source => source.sourceId === payload.protectedFact.originalSourceId).text.includes(payload.protectedFact.value))
  const bad = structuredClone(family); bad.seed.lockedQuote = '无原文依据的规则'
  assert.throws(() => impactRequest(bad, bad.edits[0], protocol), /original source/)
})

test('whole original sources and edited full text are retained; other branches never enter the request', () => {
  const payload = JSON.parse(request.messages[1].content)
  const sources = family.sources.filter(source => source.branch === 'canon' && source.kind !== 'hypothesis')
  assert.deepEqual(payload.storyBefore.map(source => source.text), sources.map(source => source.text))
  const source = family.sources.find(source => source.id === edit.sourceId)
  assert.equal(payload.proposedEdit.fullTextAfter.text, source.text.replace(edit.before, edit.after))
  assert(!request.targetSourceIds.includes(request.changedSourceId))
  const small = structuredClone(protocol); small.budget.maxInputBytes = 100
  assert.throws(() => impactRequest(family, edit, small), /must not be truncated/)
})

test('ambiguous, absent and no-op replacements are refused before a call', () => {
  assert.throws(() => impactRequest(family, { ...edit, before: 'not-in-original' }, protocol), /exactly one/)
  assert.throws(() => impactRequest(family, { ...edit, after: edit.before }, protocol), /exactly one/)
  const duplicate = structuredClone(family); duplicate.sources.find(source => source.id === edit.sourceId).text += edit.before
  assert.throws(() => impactRequest(duplicate, edit, protocol), /exactly one/)
})

test('the output contract accepts exactly one recommendation for each target', () => {
  assert.deepEqual(validate(answer()), answer())
  assert.equal(IMPACT_SCHEMA.additionalProperties, false)
  const omitted = answer(); omitted.recommendations.pop(); assert.throws(() => validate(omitted), /Incomplete/)
  const duplicate = answer(); duplicate.recommendations[1].sourceId = duplicate.recommendations[0].sourceId
  assert.throws(() => validate(duplicate), /Invalid/)
  const foreign = answer(); foreign.recommendations[0].sourceId = 'OTHER-WORK'
  assert.throws(() => validate(foreign), /Invalid/)
  const self = answer(); self.recommendations[0].sourceId = request.changedSourceId
  assert.throws(() => validate(self), /Invalid/)
})

test('each recommendation cites both the target and the modified source with exact named quotes', () => {
  const fabricated = answer(); fabricated.recommendations[0].evidence[0].quote = '不存在的原文'
  assert.throws(() => validate(fabricated), /named frozen source/)
  const wrong = answer(); wrong.recommendations[0].evidence[0].sourceId = request.targetSourceIds[1]
  assert.throws(() => validate(wrong), /named frozen source/)
  const noTarget = answer(); noTarget.recommendations[0].evidence = [noTarget.recommendations[0].evidence[1], noTarget.recommendations[0].evidence[1]]
  assert.throws(() => validate(noTarget), /both/)
  const noChange = answer(); noChange.recommendations[0].evidence = [noChange.recommendations[0].evidence[0], noChange.recommendations[0].evidence[0]]
  assert.throws(() => validate(noChange), /both/)
})

test('model output cannot introduce a write action or deterministic unaffected certificate', () => {
  assert.throws(() => validate({ ...answer(), adopt: true }), /Incomplete/)
  const write = answer(); write.recommendations[0].disposition = 'delete'
  assert.throws(() => validate(write), /Invalid/)
  const certificate = answer(); certificate.recommendations[0].disposition = 'unaffected'
  assert.throws(() => validate(certificate), /Invalid/)
  const long = answer(); long.recommendations[0].reason = '字'.repeat(protocol.budget.maxReasonCharacters + 1)
  assert.throws(() => validate(long), /Invalid/)
})

test('a lock declaration is metadata and cannot substitute for its evidence text', () => {
  const payload = JSON.parse(request.messages[1].content)
  const value = answer()
  value.recommendations[0].evidence.push({ sourceId: 'LOCK', quote: payload.protectedFact.declaration })
  assert.throws(() => validate(value), /named frozen source/)
  value.recommendations[0].evidence.at(-1).quote = payload.protectedFact.value
  assert.deepEqual(validate(value), value)
})

test('uncertainty remains a predicted review and missing positive suggestions remain false negatives', () => {
  const value = answer()
  value.recommendations[0].disposition = 'uncertain'
  validate(value)
  const targetIds = request.targetSourceIds.map(id => request.sourceMap[id])
  const gold = { mustReview: [targetIds[1]], mustNotReview: [targetIds[0]], unrelatedGold: 'ignored' }
  const score = scoreImpactSuggestion(gold, request, value)
  assert.equal(score.falsePositive, 1); assert.equal(score.falseNegative, 1)
  assert.equal(score.uncertainRecommendations, 1)
  assert.throws(() => scoreImpactSuggestion({ mustReview: ['other-owner'], mustNotReview: [] }, request, value), /Invalid separate/)
})

test('unscored predictions are disclosed rather than counted as scored successes or dropped', () => {
  const value = answer(); value.recommendations[2].disposition = 'review'
  const target = request.sourceMap[request.targetSourceIds[0]]
  const score = scoreImpactSuggestion({ mustReview: [], mustNotReview: [target] }, request, value)
  assert.equal(score.unscoredPredictions.length, 1)
  const summary = summarizeImpactSuggestions([{ id: 'example', familyId: 'family', split: 'holdout', kind: 'cosmetic', score }])
  assert.equal(summary.overall.precision, null); assert.equal(summary.overall.recall, null)
  assert.equal(summary.overall.unscoredPredictions, 1)
})

test('budget, model, retry and acceptance boundaries are checked before dispatch', () => {
  assert.equal(validateImpactProtocol(protocol), protocol)
  for (const change of [{ model: 'another-model' }, { retries: 1 }, { concurrency: 3 }, { accepted: true }, { independentHumanReviews: 1 }]) {
    assert.throws(() => validateImpactProtocol({ ...protocol, ...change }), /Unknown/)
  }
  assert.equal(impactUsageWithinBudget({ inputTokens: 1000, outputTokens: 100 }, protocol), true)
  for (const usage of [null, {}, { inputTokens: -1, outputTokens: 0 }, { inputTokens: 1, outputTokens: Infinity },
    { inputTokens: protocol.budget.maxObservedInputTokens + 1, outputTokens: 0 }]) assert.equal(impactUsageWithinBudget(usage, protocol), false)
})

test('missing families or repeated edit identities cannot form a complete experiment', () => {
  const missing = structuredClone(corpus); missing.families.pop()
  assert.throws(() => prepareImpactCases(missing, protocol), /Incomplete/)
  const duplicate = structuredClone(corpus); duplicate.families[0].edits[1].id = duplicate.families[0].edits[0].id
  assert.throws(() => prepareImpactCases(duplicate, protocol), /Duplicate/)
})

test('resume only reuses a complete identity-bound success and never replays unknown or failed attempts', () => {
  const prior = () => ({ started: { promptHash: request.promptHash, model: protocol.model },
    request: { promptHash: request.promptHash, model: protocol.model, messages: structuredClone(request.messages), outputSchema: structuredClone(IMPACT_SCHEMA) },
    result: { promptHash: request.promptHash, provider: protocol.provider, model: protocol.model, status: 'completed',
      dispatched: true, generationCompleted: true, usage: { inputTokens: 1000, outputTokens: 100 }, rawText: JSON.stringify(answer()), answer: answer() } })
  const valid = prior(); assert.equal(validatePriorImpactCall(valid, request, protocol), valid.result)
  for (const field of ['started', 'request', 'result']) {
    const missing = prior(); delete missing[field]
    assert.throws(() => validatePriorImpactCall(missing, request, protocol), /no replay/)
  }
  for (const status of ['failed', 'invalid-output', 'unknown-or-interrupted', 'running']) {
    const failure = prior(); failure.result.status = status
    assert.throws(() => validatePriorImpactCall(failure, request, protocol), /no replay/)
  }
  for (const change of [value => { value.started.model = 'another-model' },
    value => { value.request.messages[1].content += 'changed' }, value => { value.result.usage = null },
    value => { value.result.generationCompleted = false }, value => { value.result.answer.recommendations[0].reason = 'changed' }]) {
    const altered = prior(); change(altered)
    assert.throws(() => validatePriorImpactCall(altered, request, protocol), /no replay/)
  }
})

test('a partial result file remains an unknown attempt instead of an unattempted input', () => {
  const cases = ['complete', 'partial', 'no-result', 'unstarted'].map(promptHash => ({ request: { promptHash } }))
  const files = new Set(['complete.started.json', 'complete.result.json', 'partial.started.json',
    'partial.result.json', 'no-result.started.json', 'unstarted.request.json'])
  const results = new Map([['complete', { status: 'completed' }]])
  assert.deepEqual(impactMissingResultHashes(cases, files, results), ['partial', 'no-result'])
})

test('v1 archived inputs remain byte-identical while v2 gives all 48 requests new identities', () => {
  const old = prepareImpactCases(corpus, protocol), next = prepareImpactCases(corpus, protocolV2)
  assert.equal(sha256(old.map(item => item.request.messages)), '7f9e1de8d26a0f43e6947dcdbca1365ed695d14ec27581ef80e5dd9f4b2b08f1')
  assert.equal(next.length, 48)
  assert.equal(new Set(next.slice(0, 8).map(item => `${item.split}/${item.kind}`)).size, 8)
  assert(next.every(item => !old.some(previous => previous.request.promptHash === item.request.promptHash)))
  assert.throws(() => validateImpactProtocol({ ...protocolV2, failurePolicy: 'continue-every-error' }), /Unknown/)
  assert.throws(() => validateImpactProtocol({ ...protocolV2, quotableSources: 'all-metadata' }), /Unknown/)
})

test('v2 keeps complete story and protected knowledge but only original and AFTER text can be quoted', () => {
  const next = impactRequest(family, edit, protocolV2), oldPayload = JSON.parse(request.messages[1].content)
  const payload = JSON.parse(next.messages[1].content)
  assert.deepEqual(payload.storyBefore, oldPayload.storyBefore)
  assert.deepEqual(payload.proposedEdit, oldPayload.proposedEdit)
  assert.equal(payload.protectedFact.value, oldPayload.protectedFact.value)
  assert.equal(payload.protectedFact.predicate, 'knows')
  assert.equal(payload.protectedFact.sourceId, undefined)
  assert.equal(payload.protectedFact.declaration, undefined)
  assert.equal(payload.nonEvidenceNotes.protectedKnowledge, oldPayload.protectedFact.declaration)
  assert.equal(Object.hasOwn(next.referenceTexts, 'LOCK'), false)
  assert.deepEqual(validateImpactAnswer(JSON.stringify(answer()), next, protocolV2), answer())
  for (const evidence of [{ sourceId: 'LOCK', quote: payload.protectedFact.value },
    { sourceId: 'S1', quote: payload.nonEvidenceNotes.protectedKnowledge }]) {
    const bad = answer(); bad.recommendations[0].evidence.push(evidence)
    assert.throws(() => validateImpactAnswer(JSON.stringify(bad), next, protocolV2), /named frozen source/)
  }
})

test('v2 rendering still excludes gold, rationale, split and edit-category labels', () => {
  const copied = structuredClone(family), target = copied.edits[0]
  copied.split = 'POISON-SPLIT'; copied.queries = [{ answerAtoms: ['POISON-ANSWER'] }]
  Object.assign(target, { kind: 'POISON-KIND', mustReview: ['POISON-REVIEW'], mustNotReview: ['POISON-SKIP'],
    rationale: 'POISON-RATIONALE', dependencyEvidence: [{ quote: 'POISON-DEPENDENCY' }] })
  assert.deepEqual(impactRequest(copied, target, protocolV2).messages, impactRequest(family, edit, protocolV2).messages)
})

const requestV2 = impactRequest(family, edit, protocolV2)
const invalidPriorV2 = () => {
  const bad = answer()
  bad.recommendations[0].evidence.push({ sourceId: 'LOCK', quote: family.seed.lockedQuote })
  return { started: { promptHash: requestV2.promptHash, model: protocolV2.model },
    request: { promptHash: requestV2.promptHash, model: protocolV2.model, messages: requestV2.messages, outputSchema: IMPACT_SCHEMA },
    result: { promptHash: requestV2.promptHash, model: protocolV2.model, provider: protocolV2.provider,
      status: 'invalid-output', failureStage: 'output-contract', dispatched: true, generationCompleted: true,
      usage: { inputTokens: 1000, outputTokens: 100 }, rawText: JSON.stringify(bad) } }
}

test('v2 retains a complete invalid receipt as ungraded and excludes its identity from pending calls', () => {
  const prior = invalidPriorV2()
  assert.equal(isRetainedInvalidImpactCall(prior.result, requestV2, protocolV2), true)
  assert.equal(validatePriorImpactCall(prior, requestV2, protocolV2), prior.result)
  const retained = new Map([[requestV2.promptHash, prior.result]])
  assert.equal(prepareImpactCases(corpus, protocolV2).filter(item => !retained.has(item.request.promptHash)).length, 47)
  assert.equal(isRetainedInvalidImpactCall(prior.result, requestV2, protocol), false)
})

test('v2 cannot continue transport, budget, unknown or incomplete calls by relabeling them invalid', () => {
  for (const change of [{ status: 'failed' }, { failureStage: 'transport' }, { status: 'unknown-or-interrupted' },
    { dispatched: false }, { generationCompleted: false }, { usage: null },
    { usage: { inputTokens: 30001, outputTokens: 100 } }, { promptHash: 'foreign-input' }]) {
    const prior = invalidPriorV2(); Object.assign(prior.result, change)
    assert.equal(isRetainedInvalidImpactCall(prior.result, requestV2, protocolV2), false)
    assert.throws(() => validatePriorImpactCall(prior, requestV2, protocolV2), /no replay/)
  }
})

test('invalid receipts cannot carry a scored answer or silently become valid during resume', () => {
  for (const change of [{ answer: answer() }, { rawText: JSON.stringify(answer()) }, { rawText: null }]) {
    const prior = invalidPriorV2(); Object.assign(prior.result, change)
    assert.equal(isRetainedInvalidImpactCall(prior.result, requestV2, protocolV2), false)
    assert.throws(() => validatePriorImpactCall(prior, requestV2, protocolV2), /no replay/)
  }
})
