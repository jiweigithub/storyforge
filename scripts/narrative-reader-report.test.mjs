import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreGroundedReaderV2, summarizeGroundedReaderV2 } from './narrative-reader-report.mjs'

const family = { sources: [{ title: '渡口·记录1', text: '铜铃在木箱里。' }],
  queries: [{ id: 'q1', answerAtoms: ['木箱'], evidence: [{ sourceId: 's1', quote: '铜铃在木箱里。' }] }] }
const item = { question: { id: 'q1' } }
test('a supplied title is grounded but is not story-body evidence', () => {
  const prepared = { documents: [{ documentId: 'D1', original: { title: '渡口·记录1', kind: 'chapter', text: null, atom: null, evidence: [] } }] }
  const score = scoreGroundedReaderV2(item, prepared, { status: 'answered', answer: '找到记录1', citations: [{ documentId: 'D1', quote: '渡口·记录1' }] }, family)
  assert.equal(score.groundedCitations, 1); assert.equal(score.originalBodyCitations, 0); assert.equal(score.citedGoldSpanHits, 0)
})
test('direct atomic values can ground a quote; missing gold cannot be borrowed from the scorer', () => {
  const prepared = { documents: [{ documentId: 'D1', original: { title: '物品', kind: 'assertion', text: null, atom: { value: '木箱' }, evidence: [] } }] }
  const score = scoreGroundedReaderV2(item, prepared, { status: 'answered', answer: '木箱', citations: [
    { documentId: 'D1', quote: '木箱' }, { documentId: 'D1', quote: '铜铃在木箱里。' }, { documentId: 'D2', quote: '木箱' },
  ] }, family)
  assert.equal(score.groundedCitations, 1); assert.equal(score.unsupportedCitations, 2)
  assert.equal(score.citedGoldSpanHits, 0)
  const summary = summarizeGroundedReaderV2([{ familyId: 'f1', split: 'development', operation: 'state', condition: 'ir-no-evidence', questionId: 'q1', score }])
  assert.equal(summary.byCondition['ir-no-evidence'].invalidQuoteCount, 2)
})
test('matching words from the wrong source cannot earn source-specific evidence credit', () => {
  const prepared = { documents: [{ documentId: 'D1', original: { sourceId: 's2', title: '另一条记录', kind: 'chapter',
    text: '铜铃在木箱里。', atom: null, evidence: [] } }] }
  const answer = { status: 'answered', answer: '木箱', citations: [{ documentId: 'D1', quote: '铜铃在木箱里。' }] }
  const wrongSource = scoreGroundedReaderV2(item, prepared, answer, family)
  assert.equal(wrongSource.groundedCitations, 1); assert.equal(wrongSource.retrievedGoldSpanHits, 0); assert.equal(wrongSource.citedGoldSpanHits, 0)
  prepared.documents[0].original.sourceId = 's1'
  const rightSource = scoreGroundedReaderV2(item, prepared, answer, family)
  assert.equal(rightSource.retrievedGoldSpanHits, 1); assert.equal(rightSource.citedGoldSpanHits, 1)
})
