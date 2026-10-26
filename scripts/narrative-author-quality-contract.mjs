import { createHash } from 'node:crypto'

export const AUTHOR_QUALITY_ENTRY_ID = 'eval.narrative-world.author-quality'
export const AUTHOR_QUALITY_CONDITIONS = ['original-lexical', 'original-ir']
export const authorQualityHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= maximum
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const score = value => Number.isInteger(value) && value >= 1 && value <= 5
const consistencyChange = value => ['not-lower', 'lower', 'uncertain'].includes(value)
const check = (value, message) => { if (!value) throw Error(message) }

/** Evaluation contracts only. These functions cannot write author data or
 * establish semantic correctness from shape checks. */
export function validateAuthorQualityProtocol(protocol) {
  check(exact(protocol, ['schema', 'version', 'entryId', 'provider', 'writerModel', 'reviewerModel',
    'reasoningEffort', 'retries', 'budget', 'writerPrompt', 'reviewerPrompt', 'accepted']), 'Unknown author quality protocol fields')
  check(protocol.schema === 'storyforge.narrative-author-quality-protocol' && protocol.version === 1
    && protocol.entryId === AUTHOR_QUALITY_ENTRY_ID && protocol.provider === 'local-codex-subscription'
    && text(protocol.writerModel, 100) && text(protocol.reviewerModel, 100)
    && protocol.writerModel !== protocol.reviewerModel && protocol.reasoningEffort === 'medium'
    && protocol.retries === 0 && protocol.accepted === false, 'Invalid model identity or evaluation boundary')
  check(exact(protocol.budget, ['maxInputBytes', 'maxObservedInputTokens', 'maxObservedOutputTokens',
    'timeoutMs', 'maxOutputCharacters', 'serverEnforcedOutputTokenLimit']), 'Unknown budget fields')
  for (const key of ['maxInputBytes', 'maxObservedInputTokens', 'maxObservedOutputTokens', 'timeoutMs', 'maxOutputCharacters']) {
    check(Number.isSafeInteger(protocol.budget[key]) && protocol.budget[key] > 0, 'Unbounded author quality budget')
  }
  check(protocol.budget.timeoutMs <= 300000 && protocol.budget.serverEnforcedOutputTokenLimit === null
    && text(protocol.writerPrompt, 8000) && text(protocol.reviewerPrompt, 12000), 'Invalid prompt or timeout')
  return protocol
}

export function validateAuthorQualityInputs(input) {
  check(exact(input, ['schema', 'version', 'original', 'originalHash', 'revisionRequest', 'revisionRequestHash',
    'releaseContentHash', 'conditions', 'sourceReceipts', 'accepted']), 'Unknown paired input fields')
  check(input.schema === 'storyforge.narrative-author-quality-input' && input.version === 1 && input.accepted === false
    && text(input.original, 30000) && input.originalHash === authorQualityHash(input.original)
    && text(input.revisionRequest, 4000) && input.revisionRequestHash === authorQualityHash(input.revisionRequest)
    && hash(input.releaseContentHash), 'Invalid frozen original or revision identity')
  check(Array.isArray(input.sourceReceipts) && input.sourceReceipts.length > 0
    && input.sourceReceipts.every(receipt => exact(receipt, ['path', 'sha256']) && hash(receipt.sha256)
      && typeof receipt.path === 'string' && /^tests\/acceptance\/narrative-world\/[A-Za-z0-9_./-]+$/.test(receipt.path)
      && !receipt.path.split('/').includes('..'))
    && new Set(input.sourceReceipts.map(receipt => receipt.path)).size === input.sourceReceipts.length,
  'Missing source lineage receipts')
  check(exact(input.conditions, AUTHOR_QUALITY_CONDITIONS), 'Incomplete paired conditions')
  for (const condition of AUTHOR_QUALITY_CONDITIONS) {
    const row = input.conditions[condition]
    check(exact(row, ['documents', 'selectionReceiptHash', 'releaseContentHash']) && hash(row.selectionReceiptHash)
      && row.releaseContentHash === input.releaseContentHash && Array.isArray(row.documents) && row.documents.length > 0,
    'Condition is not bound to the shared frozen release')
    const ids = new Set()
    for (const document of row.documents) {
      check(exact(document, ['id', 'text', 'hash']) && text(document.id, 160) && text(document.text, 30000)
        && document.hash === authorQualityHash(document.text) && !ids.has(document.id), 'Invalid actual source document')
      ids.add(document.id)
    }
  }
  return input
}

/** Bind the pair to the source builder's actual receipt, not just two equal
 * release strings supplied by the caller. This checks provenance, not prose
 * quality or the historical model's semantic correctness. */
export function validateAuthorQualitySourceReceipt(input, receipt) {
  validateAuthorQualityInputs(input)
  check(receipt?.schema === 'storyforge.narrative-author-quality-source-preparation' && receipt.version === 1
    && receipt.sourcePreparationComplete === true && receipt.inputContractVerified === true
    && receipt.completed === true && receipt.sourceFilesUnchanged === true && receipt.accepted === false
    && receipt.releaseContentHash === input.releaseContentHash && receipt.originalSource?.sha256 === input.originalHash
    && input.sourceReceipts.some(source => source.path === receipt.originalSource.path && source.sha256 === input.originalHash),
  'Source preparation is incomplete or belongs to another original/release')
  check(exact(receipt.selections, AUTHOR_QUALITY_CONDITIONS), 'Source preparation lacks paired selections')
  for (const condition of AUTHOR_QUALITY_CONDITIONS) {
    const selection = receipt.selections[condition], row = input.conditions[condition]
    check(selection?.schema === 'storyforge.author-quality-source-selection' && selection.version === 1
      && selection.releaseContentHash === input.releaseContentHash
      && authorQualityHash(selection) === row.selectionReceiptHash
      && JSON.stringify(selection.documents) === JSON.stringify(row.documents.map(({ id, hash }) => ({ id, hash }))),
    'Selected documents differ from the frozen source receipt')
  }
  check(receipt.sourceHashes && typeof receipt.sourceHashes === 'object' && !Array.isArray(receipt.sourceHashes)
    && Object.keys(receipt.sourceHashes).length > 0, 'Missing source implementation fingerprints')
  for (const [path, value] of Object.entries(receipt.sourceHashes)) {
    check(hash(value) && typeof path === 'string' && !path.split('/').includes('..')
      && (path.startsWith('src/') || /^tests\/regression\/R-NW-[A-Za-z0-9-]+\.test\.ts$/.test(path)
        || path === receipt.originalSource.path
        || ['scripts/narrative-author-quality-contract.mjs', 'package.json', 'package-lock.json',
          'vitest.config.ts', 'tests/setup.ts'].includes(path)), 'Unexpected source implementation fingerprint')
  }
  return receipt.sourceHashes
}

export function authorQualityWriterRequest(input, condition, protocol) {
  validateAuthorQualityInputs(input); validateAuthorQualityProtocol(protocol)
  check(AUTHOR_QUALITY_CONDITIONS.includes(condition), 'Unknown condition')
  // Condition names, fixture expectations, prior scores and acceptance gates
  // do not cross the writer boundary. Both variants receive the same story
  // and request, with their actual bounded source documents.
  const messages = [{ role: 'system', content: protocol.writerPrompt }, { role: 'user', content: JSON.stringify({
    original: input.original, revisionRequest: input.revisionRequest,
    documents: input.conditions[condition].documents.map(({ id, text }) => ({ id, text })),
  }) }]
  check(Buffer.byteLength(JSON.stringify(messages)) <= protocol.budget.maxInputBytes, 'Writer input exceeds frozen budget')
  return { messages, promptHash: authorQualityHash(messages), model: protocol.writerModel,
    inputHash: authorQualityHash(input), condition }
}

export const AUTHOR_QUALITY_WRITER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['revisedStory', 'continuation'],
  properties: { revisedStory: { type: 'string' }, continuation: { type: 'array', minItems: 2, maxItems: 2,
    items: { type: 'object', additionalProperties: false, required: ['title', 'text'],
      properties: { title: { type: 'string' }, text: { type: 'string' } } } } },
}

export function validateAuthorQualityWriting(raw, protocol) {
  validateAuthorQualityProtocol(protocol)
  check(typeof raw === 'string' && [...raw].length <= protocol.budget.maxOutputCharacters, 'Output exceeds frozen limit')
  const output = JSON.parse(raw)
  check(exact(output, ['revisedStory', 'continuation']) && text(output.revisedStory, 12000)
    && Array.isArray(output.continuation) && output.continuation.length === 2, 'Expected revised story and two complete chapters')
  for (const chapter of output.continuation) {
    check(exact(chapter, ['title', 'text']) && text(chapter.title, 120) && text(chapter.text, 6000), 'Invalid continuation chapter')
  }
  return output
}

export function createAuthorQualityBlindPacket(input, writings, protocol, blindSeed) {
  validateAuthorQualityInputs(input); validateAuthorQualityProtocol(protocol)
  check(exact(writings, AUTHOR_QUALITY_CONDITIONS) && text(blindSeed, 200), 'Missing paired writing or blind seed')
  const order = [...AUTHOR_QUALITY_CONDITIONS]
  if (parseInt(authorQualityHash(blindSeed).slice(0, 2), 16) % 2) order.reverse()
  const items = order.map((condition, index) => {
    const writing = validateAuthorQualityWriting(JSON.stringify(writings[condition]), protocol)
    return { label: index === 0 ? '甲' : '乙', outputHash: authorQualityHash(writing), writing }
  })
  const packet = { schema: 'storyforge.narrative-author-quality-blind-packet', version: 1,
    original: input.original, originalHash: input.originalHash, revisionRequest: input.revisionRequest,
    items, accepted: false }
  // Keep this separate from the human/model packet until their judgments are
  // frozen. The key is evaluation metadata, never a source of story facts.
  return { packet, key: { packetHash: authorQualityHash(packet), inputHash: authorQualityHash(input),
    seedHash: authorQualityHash(blindSeed), labels: items.map((item, index) => ({ label: item.label, condition: order[index] })) } }
}

function blindPacketSources(packet) {
  check(exact(packet, ['schema', 'version', 'original', 'originalHash', 'revisionRequest', 'items', 'accepted'])
    && packet.schema === 'storyforge.narrative-author-quality-blind-packet' && packet.version === 1
    && packet.accepted === false && packet.originalHash === authorQualityHash(packet.original)
    && text(packet.original, 30000) && text(packet.revisionRequest, 4000)
    && Array.isArray(packet.items) && packet.items.length === 2
    && packet.items.map(item => item.label).sort().join('|') === ['甲', '乙'].sort().join('|'), 'Invalid blind packet')
  const sources = new Map([['original', packet.original], ['request', packet.revisionRequest]])
  for (const item of packet.items) {
    check(exact(item, ['label', 'outputHash', 'writing']) && item.outputHash === authorQualityHash(item.writing)
      && exact(item.writing, ['revisedStory', 'continuation']) && text(item.writing.revisedStory, 12000)
      && Array.isArray(item.writing.continuation) && item.writing.continuation.length === 2, 'Blind output changed')
    sources.set(`${item.label}:revision`, item.writing.revisedStory)
    item.writing.continuation.forEach((chapter, index) => {
      check(exact(chapter, ['title', 'text']) && text(chapter.title, 120) && text(chapter.text, 6000), 'Invalid blind chapter')
      sources.set(`${item.label}:chapter${index + 1}`, chapter.text)
    })
  }
  return sources
}

export function validateAuthorQualityBlindPacket(packet) {
  blindPacketSources(packet)
  return packet
}

export function authorQualityJudgeRequest(packet, protocol) {
  validateAuthorQualityProtocol(protocol); blindPacketSources(packet)
  const messages = [{ role: 'system', content: protocol.reviewerPrompt },
    { role: 'user', content: JSON.stringify({ original: packet.original, revisionRequest: packet.revisionRequest,
      variants: packet.items.map(({ label, writing }) => ({ label, ...writing })) }) }]
  check(Buffer.byteLength(JSON.stringify(messages)) <= protocol.budget.maxInputBytes, 'Review input exceeds frozen budget')
  return { messages, model: protocol.reviewerModel, promptHash: authorQualityHash(messages), packetHash: authorQualityHash(packet) }
}

const quoteSchema = { type: 'object', additionalProperties: false, required: ['sourceId', 'quote'],
  properties: { sourceId: { type: 'string' }, quote: { type: 'string' } } }
export const AUTHOR_QUALITY_JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['judgments'],
  properties: { judgments: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false,
    required: ['label', 'consistency', 'consistencyChange', 'motivation', 'acceptance', 'reason', 'evidence', 'hardContradictions'], properties: {
      label: { type: 'string', enum: ['甲', '乙'] }, consistency: { type: 'integer', minimum: 1, maximum: 5 },
      consistencyChange: { type: 'string', enum: ['not-lower', 'lower', 'uncertain'] },
      motivation: { type: 'integer', minimum: 1, maximum: 5 }, acceptance: { type: 'integer', minimum: 1, maximum: 5 },
      reason: { type: 'string' }, evidence: { type: 'array', minItems: 1, maxItems: 12, items: quoteSchema },
      hardContradictions: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
        required: ['reason', 'evidence'], properties: { reason: { type: 'string' },
          evidence: { type: 'array', minItems: 2, maxItems: 4, items: quoteSchema } } } },
    } } } } }

export function validateAuthorQualityJudgment(raw, packet, protocol) {
  validateAuthorQualityProtocol(protocol)
  check(typeof raw === 'string' && [...raw].length <= protocol.budget.maxOutputCharacters, 'Review output exceeds frozen limit')
  const sources = blindPacketSources(packet), result = JSON.parse(raw)
  check(exact(result, ['judgments']) && Array.isArray(result.judgments) && result.judgments.length === 2
    && result.judgments.map(row => row.label).sort().join('|') === ['甲', '乙'].sort().join('|'), 'Incomplete paired review')
  for (const judgment of result.judgments) {
    check(exact(judgment, ['label', 'consistency', 'consistencyChange', 'motivation', 'acceptance', 'reason', 'evidence', 'hardContradictions'])
      && [judgment.consistency, judgment.motivation, judgment.acceptance].every(score)
      && consistencyChange(judgment.consistencyChange) && text(judgment.reason, 3000)
      && Array.isArray(judgment.evidence) && judgment.evidence.length >= 1 && judgment.evidence.length <= 12
      && Array.isArray(judgment.hardContradictions) && judgment.hardContradictions.length <= 12, 'Invalid review scores or evidence')
    const verifyQuote = quote => check(exact(quote, ['sourceId', 'quote']) && text(quote.quote, 1000)
      && (['original', 'request'].includes(quote.sourceId) || quote.sourceId.startsWith(judgment.label + ':'))
      && sources.get(quote.sourceId)?.includes(quote.quote), 'Review quote is absent or belongs to the other blind output')
    judgment.evidence.forEach(verifyQuote)
    check(judgment.evidence.some(quote => quote.sourceId.startsWith(judgment.label + ':')), 'Review must cite the actual output')
    check(judgment.evidence.some(quote => quote.sourceId === 'original'), 'Consistency comparison must cite the original')
    for (const contradiction of judgment.hardContradictions) {
      check(exact(contradiction, ['reason', 'evidence']) && text(contradiction.reason, 2000)
        && Array.isArray(contradiction.evidence) && contradiction.evidence.length >= 2 && contradiction.evidence.length <= 4,
      'Hard contradiction needs an explained conflict with quoted evidence')
      contradiction.evidence.forEach(verifyQuote)
      check(contradiction.evidence.some(quote => quote.sourceId.startsWith(judgment.label + ':')), 'Contradiction must cite the actual output')
    }
  }
  return result
}

/** Human scores require a genuine external receipt. This parser accepts only
 * that receipt's shape; it cannot manufacture participation or infer it from
 * a model judgment, an earlier meaning review, or an empty edit field. */
export function validateAuthorQualityHumanReview(review, packet) {
  blindPacketSources(packet)
  check(exact(review, ['schema', 'version', 'packetHash', 'reviewerId', 'completedAt', 'source', 'judgments'])
    && review.schema === 'storyforge.narrative-author-quality-human-review' && review.version === 1
    && review.packetHash === authorQualityHash(packet) && text(review.reviewerId, 160)
    && Number.isFinite(Date.parse(review.completedAt)) && review.source === 'explicit-human-reply', 'Invalid human review receipt')
  check(Array.isArray(packet.items) && packet.items.length === 2 && new Set(packet.items.map(item => item.label)).size === 2,
    'Expected two distinct blind packet labels')
  check(Array.isArray(review.judgments) && review.judgments.length === 2
    && new Set(review.judgments.map(item => item.label)).size === 2, 'Incomplete human review')
  for (const judgment of review.judgments) {
    const item = packet.items.find(item => item.label === judgment.label)
    check(item && exact(judgment, ['label', 'outputHash', 'consistency', 'consistencyChange', 'motivation', 'acceptance',
      'hardContradictions', 'reason', 'editRecord', 'elapsedSeconds']) && judgment.outputHash === item.outputHash
      && [judgment.consistency, judgment.motivation, judgment.acceptance].every(score) && consistencyChange(judgment.consistencyChange)
      && Array.isArray(judgment.hardContradictions) && judgment.hardContradictions.every(value => text(value, 2000))
      && text(judgment.reason, 4000), 'Human judgment is unbound, incomplete or out of range')
    check(judgment.elapsedSeconds === null || Number.isFinite(judgment.elapsedSeconds) && judgment.elapsedSeconds >= 0,
      'Invalid human elapsed time')
    check(judgment.editRecord === null || exact(judgment.editRecord, ['kind', 'text'])
      && (judgment.editRecord.kind === 'none' && judgment.editRecord.text === ''
        || judgment.editRecord.kind === 'actual-edits' && text(judgment.editRecord.text, 30000)), 'Unknown human edit record')
  }
  return review
}

export function authorQualityUsageWithinBudget(usage, protocol, completed = false) {
  return usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= (completed ? 1 : 0)
    && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= (completed ? 1 : 0)
    && usage.inputTokens <= protocol.budget.maxObservedInputTokens
    && usage.outputTokens <= protocol.budget.maxObservedOutputTokens
}
