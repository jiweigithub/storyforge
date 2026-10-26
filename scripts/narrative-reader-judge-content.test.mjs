import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { judgeRequest, judgeOutputSchema, validateJudgeProtocol, validateJudgeAnswer,
  validatePriorJudgeCall, summarizeJudge, judgeExecutionCounts } from './narrative-reader-judge-contract.mjs'

const read = name => JSON.parse(readFileSync(new URL(`../tests/acceptance/narrative-world/${name}`, import.meta.url)))
const protocol = read('reader-judge-protocol-20261015-v2.json')
const legacy = read('reader-judge-protocol-20261015-v1.json')
const input = (status = 'insufficient', answer = '铜铃在阿澈手中。') => ({
  readerRequest: { messages: [{ role: 'user', content: JSON.stringify({ question: '铜铃在哪里？', operation: 'original-read',
    view: 'author', branch: 'canon', retrievalStatus: 'matched', diagnostics: [],
    documents: [{ documentId: 'D1', title: '第一幕', text: '铜铃在阿澈掌心。', atom: null, evidence: [] }] }) }] },
  readerAnswer: { status, answer, citations: [{ documentId: 'D1', quote: '铜铃在阿澈掌心。' }] },
  family: { sources: [{ id: 'scene', title: '第一幕', kind: 'chapter', branch: 'canon', text: '铜铃在阿澈掌心。' }] },
  question: { answerAtoms: ['铜铃在阿澈手中'], forbiddenAtom: null },
})
const judgment = () => ({ answerDisposition: 'substantive-answer', assessment: 'correct', answerCorrectness: 5,
  materialFaithfulness: 5, scopeCompliance: 'compliant', reason: '回答直接指出所在，材料支持这一改写。',
  evidence: [{ sourceId: 'answer', quote: '铜铃在阿澈手中。', relevance: '正文实质回答了地点问题。' },
    { sourceId: 'reader:D1', quote: '铜铃在阿澈掌心。', relevance: '实际获供材料支持其内容。' }] })

test('v2 pins its disposition and failure policy, without changing the v1 schema', () => {
  assert.equal(validateJudgeProtocol(protocol), protocol)
  assert.equal(judgeOutputSchema(legacy).properties.answerDisposition, undefined)
  assert.ok(judgeOutputSchema(protocol).properties.answerDisposition)
  for (const change of [{ retries: 1 }, { rubricVersion: 'other' },
    { failurePolicy: { ...protocol.failurePolicy, transportFailure: 'retry' } },
    { failurePolicy: { ...protocol.failurePolicy, extra: 'hidden' } }]) {
    assert.throws(() => validateJudgeProtocol({ ...protocol, ...change }))
  }
})
test('declared status stays in receipt metadata and never changes the content judge prompt', () => {
  const values = ['answered', 'insufficient', 'unsupported'].map(status => {
    const original = input(status), before = JSON.stringify(original), prepared = judgeRequest(original, protocol)
    const payload = JSON.parse(prepared.messages[1].content)
    assert.deepEqual(payload.response, { answer: original.readerAnswer.answer, citations: original.readerAnswer.citations })
    assert.equal(payload.referenceSources.find(source => source.sourceId === 'answer').value, original.readerAnswer.answer)
    assert.equal(prepared.readerStatus, status)
    assert.equal(JSON.stringify(original), before)
    return prepared
  })
  assert.equal(new Set(values.map(value => value.promptHash)).size, 1)
  assert.equal(validateJudgeAnswer(JSON.stringify(judgment()), values[1], protocol).answerCorrectness, 5)
})
test('the real causal counterexample is representable without retroactively accepting its rejected v1 rating', () => {
  const hash = '2b912ed54820752a26c14b67f937b52ea56f6d0652aed0231695eac9447aebb0'
  const prefix = `raw/reader-semantic-judge-20261015-v3/calls/${hash}`
  const sent = read(`${prefix}.request.json`), originalResult = read(`${prefix}.result.json`)
  const payload = JSON.parse(sent.messages[1].content)
  const data = { readerRequest: { messages: [{ role: 'user', content: JSON.stringify({ ...payload.task,
    retrievalStatus: payload.readerMaterial.status, diagnostics: payload.readerMaterial.diagnostics,
    documents: payload.readerMaterial.documents }) }] }, readerAnswer: payload.response,
  family: { sources: payload.referenceSources.filter(source => source.sourceId.startsWith('story:'))
    .map(source => ({ id: source.sourceId.slice(6), ...source.value })) }, question: payload.declaredAuditGold }
  assert.equal(data.readerAnswer.status, 'insufficient')
  assert.match(data.readerAnswer.answer, /不能据此建立因果关系/)
  assert.throws(() => validateJudgeAnswer(originalResult.rawText, judgeRequest(data, legacy), legacy), /Abstentions/)
  const representationOnly = { ...JSON.parse(originalResult.rawText), answerDisposition: 'substantive-answer' }
  assert.equal(validateJudgeAnswer(JSON.stringify(representationOnly), judgeRequest(data, protocol), protocol).answerDisposition, 'substantive-answer')
  assert.equal(read(`${prefix}.result.json`).status, 'failed')
})
test('a real abstention gets no correctness score even when its own status claims answered', () => {
  const answer = '无法判断铜铃所在位置。', prepared = judgeRequest(input('answered', answer), protocol)
  const value = { ...judgment(), answerDisposition: 'abstention', assessment: 'unjustified-abstention', answerCorrectness: null,
    evidence: [{ sourceId: 'answer', quote: answer, relevance: '未提供所求地点。' }] }
  assert.equal(validateJudgeAnswer(JSON.stringify(value), prepared, protocol).answerCorrectness, null)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...value, answerCorrectness: 5 }), prepared, protocol), /Abstentions/)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...value, assessment: 'correct' }), prepared, protocol), /disposition/)
})
test('content disposition needs a source-bound quote from the answer, not just supplied material', () => {
  const prepared = judgeRequest(input(), protocol)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...judgment(), evidence: [judgment().evidence[1]] }), prepared, protocol), /answer prose/)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...judgment(), evidence: [
    { ...judgment().evidence[1], sourceId: 'answer' }] }), prepared, protocol), /named frozen source/)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...judgment(), answerDisposition: 'cannot-grade' }), prepared, protocol), /disposition/)
})
test('unknown content and unknown faithfulness remain nullable rather than acquiring invented scores', () => {
  const prepared = judgeRequest(input(), protocol), value = { ...judgment(), answerDisposition: 'cannot-grade', assessment: 'cannot-grade',
    answerCorrectness: null, materialFaithfulness: null, scopeCompliance: 'uncertain', evidence: [] }
  assert.equal(validateJudgeAnswer(JSON.stringify(value), prepared, protocol).materialFaithfulness, null)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...judgment(), materialFaithfulness: null }), prepared, protocol))
})
test('metrics separate content disposition, declaration mismatch and shared observations', () => {
  const row = { condition: 'method', operation: 'read', split: 'holdout', judgePromptHash: 'one', readerReportedStatus: 'answered', judgment: judgment() }
  const refused = { ...row, judgePromptHash: 'two', judgment: { ...judgment(), answerDisposition: 'abstention', assessment: 'justified-abstention', answerCorrectness: null } }
  const metrics = summarizeJudge([row, { ...row, readerReportedStatus: 'insufficient' }, refused]).byCondition.method
  assert.equal(metrics.observations, 3); assert.equal(metrics.distinctGradedPrompts, 2)
  assert.equal(metrics.answeredAndGradable, 2); assert.equal(metrics.answerCorrectnessMedian, 5)
  assert.equal(metrics.statusComparable, 3); assert.equal(metrics.statusDisagreements, 2)
  assert.equal(metrics.declaredStatusMatrix.insufficient['substantive-answer'], 1)
  assert.equal(metrics.declaredStatusMatrix.answered.abstention, 1)
})
test('invalid judgments may be retained only with a completed generation, valid usage and a reproducible validation error', () => {
  const request = judgeRequest(input(), protocol), rawText = '{}'
  let validationError
  try { validateJudgeAnswer(rawText, request, protocol) } catch (error) { validationError = String(error) }
  const prior = { started: { promptHash: request.promptHash }, request: { promptHash: request.promptHash,
    model: protocol.model, messages: request.messages, outputSchema: judgeOutputSchema(protocol) }, result: {
    promptHash: request.promptHash, provider: protocol.provider, model: protocol.model, dispatched: true,
    generationCompleted: true, status: 'invalid-judgment', usage: { inputTokens: 50, outputTokens: 50 }, rawText, validationError } }
  assert.equal(validatePriorJudgeCall(prior, request, protocol).status, 'invalid-judgment')
  for (const changes of [{ generationCompleted: false }, { usage: null }, { dispatched: false },
    { validationError: 'different' }, { rawText: JSON.stringify(judgment()) }]) {
    assert.throws(() => validatePriorJudgeCall({ ...prior, result: { ...prior.result, ...changes } }, request, protocol))
  }
})
test('dispatch, invalid review, transport failure and pre-dispatch failure have distinct denominators', () => {
  const result = judgeExecutionCounts([{ dispatched: true, status: 'completed' }, { dispatched: true, status: 'invalid-judgment' },
    { dispatched: false, status: 'failed' }, { dispatched: true, status: 'failed' }, { dispatched: true, status: 'unknown-or-interrupted' }], 10)
  assert.deepEqual(result, { attemptedPrompts: 5, dispatchedActualCalls: 4, completedActualCalls: 1,
    invalidJudgmentActualCalls: 1, failedActualCalls: 2, preDispatchFailures: 1, notYetAttempted: 5, notYetCalled: 6, executionComplete: false })
  const closed = judgeExecutionCounts([{ dispatched: true, status: 'completed' }, { dispatched: true, status: 'invalid-judgment' }], 2)
  assert.equal(closed.executionComplete, true)
  assert.equal(closed.completedActualCalls, 1)
})
