import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readerMessages, validateReaderAnswer, readerUsageWithinBudget, scoreReader, summarizeReader } from './narrative-reader-contract.mjs'

const protocol = JSON.parse(readFileSync(new URL('../tests/acceptance/narrative-world/reader-protocol-20261015-v1.json', import.meta.url)))
const makeItem = () => ({ condition: 'ir-lexical', question: { id: 'q1', question: '铜铃在哪里？', operation: 'state', view: 'author', branch: 'canon', answerAtoms: ['POISON'] },
  context: { status: 'matched', diagnostics: [], provenance: { secretGold: 'POISON' }, documents: [{ id: 'private-semantic-id', sourceId: 's1',
    title: '铜铃', kind: 'assertion', text: '铜铃在木箱里。', atom: { value: '木箱' }, evidence: [{ text: '铜铃在木箱里。' }] }] } })
test('condition and scoring gold cannot enter model messages; byte-identical ablations share identity', () => {
  const item = makeItem(), a = readerMessages(item, protocol)
  item.condition = 'ir-no-time'; item.context.provenance.secretGold = 'DIFFERENT-POISON'
  const b = readerMessages(item, protocol)
  assert.deepEqual(a.messages, b.messages); assert.equal(a.promptHash, b.promptHash)
  assert.doesNotMatch(JSON.stringify(a.messages), /POISON|condition|provenance|answerAtoms|private-semantic-id/)
})
test('input budget omits whole records and retains an explicit insufficient receipt', () => {
  const item = makeItem()
  item.context.documents[0].text = '铜铃'.repeat(30_000)
  const result = readerMessages(item, protocol)
  assert.equal(result.documents.length, 0); assert.deepEqual(result.omittedDocumentIds, ['private-semantic-id'])
  const request = JSON.parse(result.messages[1].content)
  assert.equal(request.retrievalStatus, 'insufficient'); assert.equal(request.documents.length, 0)
  assert.ok(result.inputBytes <= protocol.budget.maxInputBytes)
})
test('unknown or excess observed usage and malformed/overlong outputs are never accepted', () => {
  assert.equal(readerUsageWithinBudget(null, protocol), false)
  assert.equal(readerUsageWithinBudget({ inputTokens: 100, outputTokens: 4001 }, protocol), false)
  assert.equal(readerUsageWithinBudget({ inputTokens: 100, outputTokens: 4000 }, protocol), true)
  for (const answer of [{ status: 'answered', answer: 'x'.repeat(601), citations: [] },
    { status: 'answered', answer: 'x', citations: [], injected: true },
    { status: 'answered', answer: 'x', citations: [{ documentId: 'invented', quote: '铜铃' }] }]) {
    assert.throws(() => validateReaderAnswer(JSON.stringify(answer), protocol))
  }
})
test('automatic scores reject invented citations and explicitly leave semantic correctness unscored', () => {
  const item = makeItem(), request = readerMessages(item, protocol)
  const answer = { status: 'answered', answer: '木箱', citations: [{ documentId: 'D1', quote: '铜铃在石箱里。' }] }
  const family = { sources: [{ text: '铜铃在木箱里。' }], queries: [{ id: 'q1', answerAtoms: ['木箱'], evidence: [{ quote: '铜铃在木箱里。' }] }] }
  const score = scoreReader(item, request, answer, family)
  assert.equal(score.exactAllAnswerAtoms, true); assert.equal(score.validOriginalCitations, 0)
  assert.equal(score.semanticCorrectness, 'not-independently-scored')
  const summary = summarizeReader([{ condition: 'ir-lexical', familyId: 'f1', split: 'development', operation: 'state', questionId: 'q1', score }])
  assert.equal(summary.byCondition['ir-lexical'].invalidQuoteCount, 1)
})
