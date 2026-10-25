import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTHOR_QUALITY_ENTRY_ID, authorQualityHash, validateAuthorQualityInputs,
  validateAuthorQualityProtocol, validateAuthorQualitySourceReceipt, authorQualityWriterRequest, validateAuthorQualityWriting,
  validateAuthorQualityHumanReview, createAuthorQualityBlindPacket, authorQualityJudgeRequest,
  validateAuthorQualityJudgment, authorQualityUsageWithinBudget } from './narrative-author-quality-contract.mjs'

const h = 'a'.repeat(64)
const protocol = () => ({ schema: 'storyforge.narrative-author-quality-protocol', version: 1,
  entryId: AUTHOR_QUALITY_ENTRY_ID, provider: 'local-codex-subscription', writerModel: 'writer', reviewerModel: 'reviewer',
  reasoningEffort: 'medium', retries: 0, budget: { maxInputBytes: 10000, maxObservedInputTokens: 4000,
    maxObservedOutputTokens: 4000, timeoutMs: 300000, maxOutputCharacters: 10000, serverEnforcedOutputTokenLimit: null },
  writerPrompt: '根据完整原文修订并续写两章。', reviewerPrompt: '根据原文与修订要求独立评阅。', accepted: false })
const inputs = () => ({ schema: 'storyforge.narrative-author-quality-input', version: 1,
  original: '灯下，她把红线系在孩子的手腕上。', originalHash: authorQualityHash('灯下，她把红线系在孩子的手腕上。'),
  revisionRequest: '只改红线去向。', revisionRequestHash: authorQualityHash('只改红线去向。'),
  releaseContentHash: h, sourceReceipts: [{ path: 'tests/acceptance/narrative-world/input-receipt.json', sha256: h }], accepted: false,
  conditions: Object.fromEntries(['original-lexical', 'original-ir'].map(id => [id, {
    documents: [{ id: 'source-1', text: '冻结材料', hash: authorQualityHash('冻结材料') }], selectionReceiptHash: h, releaseContentHash: h,
  }])) })
const writing = () => ({ revisedStory: '红线系在孩子腕上。', continuation: [{ title: '一', text: '孩子扶住船沿。' }, { title: '二', text: '他带着铜铃回来了。' }] })
const blind = () => createAuthorQualityBlindPacket(inputs(), Object.fromEntries(['original-lexical', 'original-ir'].map(id => [id, writing()])), protocol(), 'fixed-test-seed').packet

test('paired writer inputs retain the complete original and hide condition metadata', () => {
  const input = inputs(), p = protocol()
  const a = authorQualityWriterRequest(input, 'original-lexical', p)
  const b = authorQualityWriterRequest(input, 'original-ir', p)
  assert.deepEqual(a.messages, b.messages)
  assert.equal(a.promptHash, b.promptHash)
  const body = JSON.parse(a.messages[1].content)
  assert.equal(body.original, input.original)
  assert.deepEqual(Object.keys(body).sort(), ['documents', 'original', 'revisionRequest'])
})
test('reject source drift, incomplete pairs, release substitution and hidden extra fields', () => {
  for (const mutate of [x => { x.original += '变更' }, x => { delete x.conditions['original-ir'] },
    x => { x.conditions['original-ir'].releaseContentHash = 'b'.repeat(64) },
    x => { x.conditions['original-ir'].documents[0].text += '变更' }, x => { x.gold = '答案' },
    x => { x.sourceReceipts[0].path = 'tests/acceptance/narrative-world/../../private.json' }]) {
    const input = inputs(); mutate(input)
    assert.throws(() => validateAuthorQualityInputs(input))
  }
})
test('paired selections bind to the completed source receipt and its implementation fingerprints', () => {
  const input = inputs(), originalPath = 'tests/acceptance/narrative-world/test-original.txt'
  input.sourceReceipts.push({ path: originalPath, sha256: input.originalHash })
  const selections = Object.fromEntries(Object.entries(input.conditions).map(([condition, row]) => [condition, {
    schema: 'storyforge.author-quality-source-selection', version: 1, releaseContentHash: input.releaseContentHash,
    documents: row.documents.map(({ id, hash }) => ({ id, hash })),
  }]))
  for (const condition of Object.keys(selections)) input.conditions[condition].selectionReceiptHash = authorQualityHash(selections[condition])
  const receipt = { schema: 'storyforge.narrative-author-quality-source-preparation', version: 1,
    sourcePreparationComplete: true, inputContractVerified: true, completed: true, sourceFilesUnchanged: true, accepted: false,
    releaseContentHash: input.releaseContentHash, originalSource: { path: originalPath, sha256: input.originalHash },
    selections, sourceHashes: { 'package.json': h } }
  assert.deepEqual(validateAuthorQualitySourceReceipt(input, receipt), receipt.sourceHashes)
  for (const mutate of [r => { r.completed = false }, r => { r.inputContractVerified = false },
    r => { r.releaseContentHash = 'b'.repeat(64) }, r => { r.selections['original-ir'].documents[0].hash = 'c'.repeat(64) },
    r => { r.sourceHashes = { '../private.json': h } }, r => { r.originalSource.path = '../../private.json' }]) {
    const changed = structuredClone(receipt); mutate(changed)
    assert.throws(() => validateAuthorQualitySourceReceipt(input, changed))
  }
})
test('same-model review, retries, missing budgets and input overflows cannot dispatch', () => {
  for (const mutate of [x => { x.reviewerModel = x.writerModel }, x => { x.retries = 1 },
    x => { x.budget.maxObservedInputTokens = 0 }, x => { x.budget.timeoutMs = 300001 }]) {
    const p = protocol(); mutate(p); assert.throws(() => validateAuthorQualityProtocol(p))
  }
  const p = protocol(); p.budget.maxInputBytes = 10
  assert.throws(() => authorQualityWriterRequest(inputs(), 'original-ir', p), /budget/)
})
test('writing schema requires the revision and both chapters, without treating valid shape as quality', () => {
  const writing = { revisedStory: '完整修订。', continuation: [{ title: '一', text: '第一章。' }, { title: '二', text: '第二章。' }] }
  assert.deepEqual(validateAuthorQualityWriting(JSON.stringify(writing), protocol()), writing)
  writing.continuation.pop()
  assert.throws(() => validateAuthorQualityWriting(JSON.stringify(writing), protocol()))
})
test('human participation is bound to exact blind outputs; missing time or edit data remain null', () => {
  const packet = blind()
  const review = { schema: 'storyforge.narrative-author-quality-human-review', version: 1,
    packetHash: authorQualityHash(packet), reviewerId: 'task-author', completedAt: '2026-10-16T00:00:00Z',
    source: 'explicit-human-reply', judgments: packet.items.map(({ label, outputHash }) => ({ label, outputHash, consistency: 4,
      consistencyChange: 'not-lower',
      motivation: 4, acceptance: 4, hardContradictions: [], reason: '测试用回执形状；不是真人评审。',
      editRecord: null, elapsedSeconds: null })) }
  assert.equal(validateAuthorQualityHumanReview(review, packet).judgments[0].elapsedSeconds, null)
  for (const mutate of [x => { x.source = 'model' }, x => { x.packetHash = 'c'.repeat(64) },
    x => { x.judgments[1].label = '甲' }, x => { x.judgments[0].outputHash = 'd'.repeat(64) },
    x => { x.judgments[0].consistencyChange = 'assumed' },
    x => { x.judgments[0].consistency = 6 }, x => { x.judgments[0].elapsedSeconds = -1 }]) {
    const changed = structuredClone(review); mutate(changed)
    assert.throws(() => validateAuthorQualityHumanReview(changed, packet))
  }
})

test('blind packet and judge messages exclude condition keys and model metadata', () => {
  const packet = blind(), request = authorQualityJudgeRequest(packet, protocol())
  assert.ok(!JSON.stringify(packet).includes('original-ir'))
  assert.ok(!JSON.stringify(request.messages).includes('original-lexical'))
  assert.deepEqual(Object.keys(JSON.parse(request.messages[1].content)).sort(), ['original', 'revisionRequest', 'variants'])
  packet.items[0].writing.revisedStory += '变更'
  assert.throws(() => authorQualityJudgeRequest(packet, protocol()), /changed/)
})
test('independent review rejects fabricated, swapped and source-only quotations', () => {
  const packet = blind()
  const judgment = { judgments: packet.items.map(item => ({ label: item.label, consistency: 4, motivation: 4,
    consistencyChange: 'not-lower',
    acceptance: 4, reason: '测试评分形状，不是实际模型评价。',
    evidence: [{ sourceId: item.label + ':revision', quote: '红线系在孩子腕上。' },
      { sourceId: 'original', quote: packet.original }], hardContradictions: [] })) }
  assert.deepEqual(validateAuthorQualityJudgment(JSON.stringify(judgment), packet, protocol()), judgment)
  for (const mutate of [x => { x.judgments[0].evidence[0].quote = '不存在的原句' },
    x => { x.judgments[0].evidence[0].sourceId = x.judgments[1].label + ':revision' },
    x => { x.judgments[0].evidence = [{ sourceId: 'original', quote: packet.original }] },
    x => { x.judgments[0].evidence = [{ sourceId: x.judgments[0].label + ':revision', quote: '红线系在孩子腕上。' }] },
    x => { x.judgments[0].consistencyChange = 'not-checked' },
    x => { x.judgments[0].hardContradictions = [{ reason: '没有证据的判断', evidence: [] }] }]) {
    const changed = structuredClone(judgment); mutate(changed)
    assert.throws(() => validateAuthorQualityJudgment(JSON.stringify(changed), packet, protocol()))
  }
})
test('partial usage may have zero output; completed receipts need positive bounded actual usage', () => {
  assert.ok(authorQualityUsageWithinBudget({ inputTokens: 100, outputTokens: 0 }, protocol()))
  assert.ok(!authorQualityUsageWithinBudget({ inputTokens: 100, outputTokens: 0 }, protocol(), true))
  assert.ok(authorQualityUsageWithinBudget({ inputTokens: 100, outputTokens: 200 }, protocol(), true))
  for (const usage of [null, {}, { inputTokens: -1, outputTokens: 1 }, { inputTokens: 4001, outputTokens: 1 },
    { inputTokens: 1, outputTokens: 4001 }, { inputTokens: 1.5, outputTokens: 1 }]) {
    assert.ok(!authorQualityUsageWithinBudget(usage, protocol()))
  }
})
