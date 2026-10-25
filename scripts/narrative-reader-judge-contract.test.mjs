import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { judgeRequest, validateJudgeProtocol, validateJudgeAnswer, judgeUsageWithinBudget,
  orderJudgeRequests, summarizeJudge, validateJudgeContinuationParent, validatePriorJudgeCall, judgeSummaryName, JUDGE_SCHEMA } from './narrative-reader-judge-contract.mjs'

const protocol = JSON.parse(readFileSync(new URL('../tests/acceptance/narrative-world/reader-judge-protocol-20261015-v1.json', import.meta.url)))
const input = () => ({ readerRequest: { model: 'POISON-MODEL', condition: 'POISON-CONDITION',
  messages: [{ role: 'user', content: JSON.stringify({ question: '铜铃在哪里？', operation: 'original-read', view: 'author', branch: 'canon',
    retrievalStatus: 'matched', diagnostics: [], documents: [{ documentId: 'D1', title: '第一幕', text: '铜铃在阿澈掌心。', atom: null, evidence: [] }] }) }] },
  readerAnswer: { status: 'answered', answer: '铜铃在阿澈手中。', citations: [{ documentId: 'D1', quote: '铜铃在阿澈掌心。' }] },
  family: { sources: [{ id: 'story-a', title: '第一幕', kind: 'chapter', branch: 'canon', text: '铜铃在阿澈掌心。小桥并不知道。' }],
    score: 'POISON-SCORE', condition: 'POISON-CONDITION' }, question: { answerAtoms: ['铜铃在阿澈手中'], forbiddenAtom: null } })
const judgment = () => ({ assessment: 'correct', answerCorrectness: 5, materialFaithfulness: 5, scopeCompliance: 'compliant',
  reason: '掌心与手中是忠实改写。', evidence: [{ sourceId: 'reader:D1', quote: '铜铃在阿澈掌心。', relevance: '读者材料支持回答。' }] })

test('independent judge messages are blinded while retaining actual materials and explicit audit evidence', () => {
  const value = judgeRequest(input(), protocol), text = JSON.stringify(value.messages)
  assert.doesNotMatch(text, /POISON/)
  assert.match(text, /小桥并不知道/)
  assert.match(text, /declaredAuditGold/)
  assert.equal(validateJudgeAnswer(JSON.stringify(judgment()), value, protocol).answerCorrectness, 5)
})
test('quotes are bound to their named source; matching another source or inventing a sentence fails', () => {
  const value = judgeRequest(input(), protocol)
  for (const evidence of [
    { sourceId: 'reader:D1', quote: '小桥并不知道。', relevance: 'wrong source' },
    { sourceId: 'story:story-a', quote: '铜铃已在河底。', relevance: 'invented' },
    { sourceId: 'missing', quote: '铜铃在阿澈掌心。', relevance: 'unknown identity' },
  ]) assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...judgment(), evidence: [evidence] }), value, protocol), /quotation/)
})
test('abstentions do not inflate correctness; actual response status constrains dispositions', () => {
  const data = input(); data.readerAnswer = { status: 'insufficient', answer: '无法判断。', citations: [] }
  const value = judgeRequest(data, protocol)
  const answer = { ...judgment(), assessment: 'unjustified-abstention', answerCorrectness: null }
  assert.equal(validateJudgeAnswer(JSON.stringify(answer), value, protocol).answerCorrectness, null)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...answer, answerCorrectness: 5 }), value, protocol), /Abstentions/)
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...answer, assessment: 'correct' }), value, protocol), /disposition/)
  assert.throws(() => validateJudgeAnswer(JSON.stringify(answer), judgeRequest(input(), protocol), protocol), /correctness score|disposition/)
})
test('uncertainty remains representable and cannot be given a manufactured answer score', () => {
  const value = judgeRequest(input(), protocol), answer = { ...judgment(), assessment: 'cannot-grade', answerCorrectness: null, evidence: [] }
  assert.equal(validateJudgeAnswer(JSON.stringify(answer), value, protocol).assessment, 'cannot-grade')
  assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...answer, answerCorrectness: 3 }), value, protocol), /ungradable/)
})
test('fixed input budget refuses a whole oversized case without modifying or clipping it', () => {
  const data = input(), before = JSON.stringify(data)
  assert.throws(() => judgeRequest(data, { ...protocol, budget: { ...protocol.budget, maxInputBytes: 30 } }), /fixed budget/)
  assert.equal(JSON.stringify(data), before)
})
test('unknown output fields, unsupported scores, missing proof and long reasons are rejected', () => {
  const value = judgeRequest(input(), protocol)
  for (const changes of [{ adopted: true }, { materialFaithfulness: 6 }, { assessment: 'passed' },
    { evidence: [] }, { reason: 'x'.repeat(protocol.budget.maxReasonCharacters + 1) }]) {
    assert.throws(() => validateJudgeAnswer(JSON.stringify({ ...judgment(), ...changes }), value, protocol))
  }
})
test('protocol bounds and observed usage are explicit, finite and nonnegative', () => {
  assert.equal(validateJudgeProtocol(protocol), protocol)
  for (const budget of [{ ...protocol.budget, timeoutMs: 900000 }, { ...protocol.budget, maxInputBytes: Infinity },
    { ...protocol.budget, maxEvidence: undefined }]) assert.throws(() => validateJudgeProtocol({ ...protocol, budget }), /unbounded/)
  assert.equal(judgeUsageWithinBudget({ inputTokens: 20, outputTokens: 30 }, protocol), true)
  for (const usage of [null, { inputTokens: -1, outputTokens: 1 }, { inputTokens: 20, outputTokens: 6001 }]) {
    assert.equal(judgeUsageWithinBudget(usage, protocol), false)
  }
})
test('pilot ordering covers operations before remaining cases and never uses scores', () => {
  const values = [{ operation: 'b', request: { promptHash: 'a' } }, { operation: 'b', request: { promptHash: 'b' } },
    { operation: 'a', request: { promptHash: 'c' } }, { operation: 'a', request: { promptHash: 'c' } }]
  assert.deepEqual([...orderJudgeRequests(values).keys()], ['c', 'a', 'b'])
  assert.deepEqual([...orderJudgeRequests(values.reverse().map(row => ({ ...row, score: -100 }))).keys()], ['c', 'a', 'b'])
})
test('aggregation preserves repeated observations and abstention denominators without treating them as independent calls', () => {
  const row = { condition: 'method', operation: 'read', split: 'holdout', judgePromptHash: 'one', judgment: judgment() }
  const refused = { ...row, judgePromptHash: 'two', judgment: { ...judgment(), assessment: 'justified-abstention', answerCorrectness: null } }
  const result = summarizeJudge([row, { ...row }, refused]).byCondition.method
  assert.equal(result.observations, 3); assert.equal(result.distinctGradedPrompts, 2)
  assert.equal(result.answeredAndGradable, 2); assert.equal(result.answerCorrectnessMedian, 5)
  assert.equal(result.assessments['justified-abstention'], 1)
})

const parentManifest = () => ({ schema: 'storyforge.narrative-reader-judge-run', version: 1, accepted: false,
  entryId: 'eval.narrative-world.reader-semantic-review', provider: protocol.provider, model: protocol.model,
  readerProvider: protocol.provider, readerModel: 'reader-model', reasoningEffort: protocol.reasoningEffort,
  sourceHashes: { rubric: 'one', story: 'two' }, runtimeHashes: { driver: 'old-code' },
  totalObservations: 2, distinctPrompts: 1, cases: [{ id: 'one' }, { id: 'two' }], dispatchOrder: ['prompt'] })
test('explicit continuation retains original evidence/model/order but records a new runtime separately', () => {
  const parent = parentManifest(), current = { ...structuredClone(parent), runtimeHashes: { driver: 'new-code' } }
  assert.equal(validateJudgeContinuationParent(parent, current), parent)
  for (const change of [{ model: 'other' }, { sourceHashes: { rubric: 'changed', story: 'two' } },
    { cases: [{ id: 'two' }, { id: 'one' }] }, { dispatchOrder: ['another'] }]) {
    assert.throws(() => validateJudgeContinuationParent(parent, { ...current, ...change }), /Continuation changes/)
  }
  assert.throws(() => validateJudgeContinuationParent({ ...parent, version: 2 }, current), /original judge run/)
})
const priorCall = () => {
  const request = judgeRequest(input(), protocol)
  return { request, prior: { started: { promptHash: request.promptHash },
    request: { promptHash: request.promptHash, model: protocol.model, messages: request.messages, outputSchema: JUDGE_SCHEMA },
    result: { promptHash: request.promptHash, model: protocol.model, provider: protocol.provider, dispatched: true,
      status: 'completed', rawText: JSON.stringify(judgment()), usage: { inputTokens: 50, outputTokens: 50 } } } }
}
test('prior successes are revalidated and prior failures stay failures without fabricated judgments', () => {
  const { request, prior } = priorCall()
  assert.equal(validatePriorJudgeCall(prior, request, protocol).judgment.assessment, 'correct')
  for (const status of ['failed', 'unknown-or-interrupted']) {
    const failed = { ...prior, result: { ...prior.result, status, usage: null, rawText: '' } }
    const value = validatePriorJudgeCall(failed, request, protocol)
    assert.equal(value.status, status); assert.equal(value.judgment, undefined)
  }
})
test('missing terminal receipts, altered prompts, model substitutions and invalid successful usage block continuation', () => {
  const { request, prior } = priorCall()
  for (const bad of [{ ...prior, result: undefined }, { ...prior, started: undefined },
    { ...prior, request: { ...prior.request, messages: [] } },
    { ...prior, result: { ...prior.result, model: 'other' } },
    { ...prior, result: { ...prior.result, dispatched: false } },
    { ...prior, result: { ...prior.result, usage: null } }]) {
    assert.throws(() => validatePriorJudgeCall(bad, request, protocol))
  }
})
test('a zero-dispatch failure after dry-run has its own summary and cannot mask or overwrite earlier evidence', () => {
  const names = ['summary-0021.json'], before = [...names]
  assert.equal(judgeSummaryName(names, 21), 'summary-0021-invocation-0001.json')
  assert.deepEqual(names, before)
  assert.equal(judgeSummaryName([...names, 'summary-0021-invocation-0001.json'], 21), 'summary-0021-invocation-0002.json')
  assert.throws(() => judgeSummaryName(names, -1), /Invalid/)
})
