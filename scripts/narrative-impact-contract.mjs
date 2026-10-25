import { sha256, estimateReaderTokens } from './narrative-reader-contract.mjs'

export const IMPACT_ENTRY_ID = 'eval.narrative-world.edit-impact'
const DISPOSITIONS = ['review', 'uncertain', 'no-specific-impact']
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',')

export const IMPACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['recommendations'], properties: {
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['sourceId', 'disposition', 'reason', 'evidence'], properties: {
        sourceId: { type: 'string' }, disposition: { type: 'string', enum: DISPOSITIONS }, reason: { type: 'string' },
        evidence: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['sourceId', 'quote'], properties: { sourceId: { type: 'string' }, quote: { type: 'string' } } } },
      } } },
  },
}

export function validateImpactProtocol(protocol) {
  const limits = ['maxInputBytes', 'maxEstimatedInputTokens', 'maxObservedInputTokens', 'maxObservedOutputTokens',
    'maxReasonCharacters', 'maxEvidencePerRecommendation', 'maxQuoteCharacters', 'timeoutMs']
  const knownVersion = protocol.version === 1 ? protocol.failurePolicy === 'stop-no-retry'
    : protocol.version === 2 && protocol.failurePolicy === 'stop-transport-budget-unknown;continue-complete-invalid-no-retry'
      && protocol.quotableSources === 'original-text-and-after-text-only'
  if (protocol.schema !== 'storyforge.narrative-impact-model-protocol' || !knownVersion
    || protocol.entryId !== IMPACT_ENTRY_ID || protocol.provider !== 'local-codex-subscription'
    || protocol.model !== 'gpt-6.1-sol' || protocol.reasoningEffort !== 'medium'
    || protocol.retries !== 0 || protocol.concurrency !== 2 || protocol.pilotActualCalls !== 8
    || protocol.caseCount !== 48 || protocol.familyCount !== 12 || protocol.holdoutFamilyCount !== 4
    || typeof protocol.systemPrompt !== 'string' || !protocol.systemPrompt.trim()
    || limits.some(key => !Number.isSafeInteger(protocol.budget?.[key]) || protocol.budget[key] < 1)
    || protocol.budget.timeoutMs > 300000 || protocol.budget.serverEnforcedOutputTokenLimit !== null
    || protocol.accepted !== false || protocol.independentHumanReviews !== 0
    || protocol.costUsd !== null) {
    throw Error('Unknown or unbounded impact evaluation protocol')
  }
  return protocol
}

/** Sources and the proposed textual edit only. Gold, edit kinds and split
 * labels are deliberately not read while building model-visible material. */
export function impactRequest(family, edit, protocol) {
  validateImpactProtocol(protocol)
  const sources = family.sources.filter(source => source.branch === 'canon' && source.kind !== 'hypothesis')
  if (!sources.length || new Set(sources.map(source => source.id)).size !== sources.length
    || sources.some(source => typeof source.text !== 'string' || typeof source.title !== 'string')) throw Error('Invalid original source set')
  const changed = sources.find(source => source.id === edit.sourceId)
  if (!changed || changed.kind !== 'chapter' || typeof edit.before !== 'string' || !edit.before
    || typeof edit.after !== 'string' || edit.before === edit.after
    || changed.text.split(edit.before).length !== 2) throw Error('Edit must replace exactly one original chapter span')
  const documents = sources.map((source, index) => ({ sourceId: `S${index + 1}`, kind: source.kind,
    title: source.title, narrativeOrder: source.kind === 'chapter' ? source.order : null, text: source.text }))
  const sourceMap = Object.fromEntries(documents.map((document, index) => [document.sourceId, sources[index].id]))
  const changedSourceId = documents[sources.indexOf(changed)].sourceId
  const targetSourceIds = documents.filter(document => document.kind === 'chapter' && document.sourceId !== changedSourceId).map(document => document.sourceId)
  if (targetSourceIds.length !== 3) throw Error('Expected the original four-chapter family')
  // This is the pre-existing fixture author's locked knowledge record, not
  // the edit's scoring label and not an inferred universal world rule.
  const holder = sources.find(source => source.id === `${family.id}:character-b`)
  const lockSource = sources.find(source => source.id === `${family.id}:chapter-1`)
  const lockedQuote = family.seed?.lockedQuote
  if (!holder || typeof lockedQuote !== 'string' || !lockedQuote || !lockSource?.text.includes(lockedQuote)) {
    throw Error('Existing locked fixture statement has no original source')
  }
  const afterText = changed.text.replace(edit.before, edit.after)
  const payload = {
    task: '逐项判断这次草稿修改后，其余章节是否值得作者复核。输出只作为建议，不更改任何内容或锁定记录。',
    scope: { owner: 'isolated-synthetic-evaluation', perspective: 'author', branch: 'canon' },
    storyBefore: documents,
    proposedEdit: { sourceId: changedSourceId, before: edit.before, after: edit.after,
      fullTextAfter: { sourceId: 'AFTER', text: afterText } },
    protectedFact: { sourceId: 'LOCK', holderSourceId: documents[sources.indexOf(holder)].sourceId,
      predicate: 'knows', value: lockedQuote, locked: true,
      declaration: '测试作者已确认并锁定这条人物知识记录；草稿改写不自动更改它。',
      originalSourceId: documents[sources.indexOf(lockSource)].sourceId },
    targetSourceIds,
  }
  if (protocol.version === 2) {
    // The protected knowledge record is an author constraint, not another
    // prose source. Its evidence remains in the original chapter text.
    const { sourceId: _sourceId, declaration, ...record } = payload.protectedFact
    payload.protectedFact = record
    payload.nonEvidenceNotes = { protectedKnowledge: declaration }
  }
  const messages = [{ role: 'system', content: protocol.systemPrompt }, { role: 'user', content: JSON.stringify(payload) }]
  const encoded = JSON.stringify(messages), inputBytes = Buffer.byteLength(encoded), estimatedInputTokens = estimateReaderTokens(encoded)
  if (inputBytes > protocol.budget.maxInputBytes || estimatedInputTokens > protocol.budget.maxEstimatedInputTokens) {
    throw Error('Impact input exceeds fixed budget; source text must not be truncated')
  }
  return { messages, promptHash: sha256(messages), inputBytes, estimatedInputTokens, sourceMap, targetSourceIds, changedSourceId,
    referenceTexts: { ...Object.fromEntries(documents.map(document => [document.sourceId, document.text])), AFTER: afterText,
      ...(protocol.version === 1 ? { LOCK: lockedQuote } : {}) } }
}

export function prepareImpactCases(corpus, protocol) {
  validateImpactProtocol(protocol)
  if (!Array.isArray(corpus.families) || corpus.families.length !== protocol.familyCount
    || new Set(corpus.families.map(family => family.id)).size !== protocol.familyCount
    || corpus.families.filter(family => family.split === 'holdout').length !== protocol.holdoutFamilyCount
    || corpus.families.some(family => !['development', 'holdout'].includes(family.split))) throw Error('Incomplete original family partition')
  const cases = corpus.families.flatMap(family => family.edits.map(edit => ({ id: edit.id, familyId: family.id,
    split: family.split, kind: edit.kind, request: impactRequest(family, edit, protocol) })))
  if (cases.length !== protocol.caseCount || new Set(cases.map(item => item.id)).size !== cases.length
    || new Set(cases.map(item => item.request.promptHash)).size !== cases.length) throw Error('Duplicate or incomplete original edit matrix')
  const pilot = [], seen = new Set()
  for (const split of ['development', 'holdout']) for (const kind of ['semantic', 'cosmetic', 'locked-rule', 'knowledge-timing']) {
    const first = cases.filter(item => item.split === split && item.kind === kind)
      .sort((a, b) => a.request.promptHash.localeCompare(b.request.promptHash))[0]
    if (!first) throw Error('Missing edit kind in a fixed split')
    pilot.push(first); seen.add(first.id)
  }
  return [...pilot, ...cases.filter(item => !seen.has(item.id)).sort((a, b) => a.request.promptHash.localeCompare(b.request.promptHash))]
}

export function validateImpactAnswer(text, prepared, protocol) {
  const result = JSON.parse(text), limit = protocol.budget
  if (!exact(result, ['recommendations']) || !Array.isArray(result.recommendations)
    || result.recommendations.length !== prepared.targetSourceIds.length) throw Error('Incomplete impact recommendation set')
  const seen = new Set()
  for (const item of result.recommendations) {
    if (!exact(item, ['sourceId', 'disposition', 'reason', 'evidence'])
      || !prepared.targetSourceIds.includes(item.sourceId) || seen.has(item.sourceId)
      || !DISPOSITIONS.includes(item.disposition) || typeof item.reason !== 'string' || !item.reason.trim()
      || [...item.reason].length > limit.maxReasonCharacters || !Array.isArray(item.evidence)
      || item.evidence.length < 2 || item.evidence.length > limit.maxEvidencePerRecommendation) throw Error('Invalid impact recommendation')
    seen.add(item.sourceId)
    for (const evidence of item.evidence) {
      if (!exact(evidence, ['sourceId', 'quote']) || typeof evidence.sourceId !== 'string'
        || typeof evidence.quote !== 'string' || !evidence.quote.trim() || [...evidence.quote].length > limit.maxQuoteCharacters
        || !Object.hasOwn(prepared.referenceTexts, evidence.sourceId)
        || !prepared.referenceTexts[evidence.sourceId].includes(evidence.quote)) throw Error('Impact evidence does not match its named frozen source')
    }
    if (!item.evidence.some(evidence => evidence.sourceId === item.sourceId)
      || !item.evidence.some(evidence => evidence.sourceId === prepared.changedSourceId || evidence.sourceId === 'AFTER')) {
      throw Error('Impact explanation must cite both its target chapter and the edited chapter')
    }
  }
  return result
}

export function impactUsageWithinBudget(usage, protocol) {
  return !!usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
    && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0
    && usage.inputTokens <= protocol.budget.maxObservedInputTokens && usage.outputTokens <= protocol.budget.maxObservedOutputTokens
}

/** Protocol v2 may retain a known completed invalid output without scoring or
 * repeating it. Transport, budget and unknown outcomes never qualify. */
export function isRetainedInvalidImpactCall(result, prepared, protocol) {
  if (protocol.version !== 2
    || protocol.failurePolicy !== 'stop-transport-budget-unknown;continue-complete-invalid-no-retry'
    || result?.status !== 'invalid-output' || result.failureStage !== 'output-contract'
    || result.promptHash !== prepared.promptHash || result.provider !== protocol.provider || result.model !== protocol.model
    || result.dispatched !== true || result.generationCompleted !== true || Object.hasOwn(result, 'answer')
    || typeof result.rawText !== 'string' || !impactUsageWithinBudget(result.usage, protocol)) return false
  try { validateImpactAnswer(result.rawText, prepared, protocol) } catch { return true }
  return false
}

/** Fully persisted successes, and v2 known-invalid receipts, can be retained.
 * Neither is resent. Unknown, transport and budget failures block resume. */
export function validatePriorImpactCall(prior, prepared, protocol) {
  const { started, request, result } = prior ?? {}
  if (!started || !request || !result || started.promptHash !== prepared.promptHash
    || started.model !== protocol.model || request.promptHash !== prepared.promptHash
    || request.model !== protocol.model || sha256(request.messages) !== prepared.promptHash
    || sha256(request.outputSchema) !== sha256(IMPACT_SCHEMA)
    || result.promptHash !== prepared.promptHash || result.provider !== protocol.provider || result.model !== protocol.model
    || result.dispatched !== true || result.generationCompleted !== true
    || !impactUsageWithinBudget(result.usage, protocol)) throw Error('Prior impact call is missing, failed, unknown or incompatible; no replay')
  if (isRetainedInvalidImpactCall(result, prepared, protocol)) return result
  if (result.status !== 'completed') throw Error('Prior impact call is not a retainable terminal receipt; no replay')
  const validated = validateImpactAnswer(result.rawText, prepared, protocol)
  if (sha256(validated) !== sha256(result.answer)) throw Error('Prior impact output changed; no replay')
  return result
}

/** A result filename alone is not a usable receipt: interrupted writes may
 * leave a partial file. Only results actually loaded or persisted count. */
export function impactMissingResultHashes(cases, files, results) {
  return cases.filter(item => files.has(`${item.request.promptHash}.started.json`)
    && !results.has(item.request.promptHash)).map(item => item.request.promptHash)
}

/** Gold is first inspected here, after an actual output has been validated.
 * Uncertain recommendations are counted as review, never hidden as skips. */
export function scoreImpactSuggestion(edit, prepared, answer) {
  const expected = [...edit.mustReview].sort(), forbidden = [...edit.mustNotReview].sort()
  const targetIds = prepared.targetSourceIds.map(id => prepared.sourceMap[id]), universe = new Set([...expected, ...forbidden])
  if (new Set(expected).size !== expected.length || new Set(forbidden).size !== forbidden.length
    || expected.some(id => forbidden.includes(id)) || [...universe].some(id => !targetIds.includes(id))) throw Error('Invalid separate edit gold')
  const predicted = answer.recommendations.filter(item => item.disposition !== 'no-specific-impact').map(item => prepared.sourceMap[item.sourceId]).sort()
  const scored = predicted.filter(id => universe.has(id))
  return { expected, mustNotReview: forbidden, predicted: scored, unscoredPredictions: predicted.filter(id => !universe.has(id)),
    truePositive: scored.filter(id => expected.includes(id)).length, falsePositive: scored.filter(id => forbidden.includes(id)).length,
    falseNegative: expected.filter(id => !scored.includes(id)).length,
    uncertainRecommendations: answer.recommendations.filter(item => item.disposition === 'uncertain').length }
}

export function summarizeImpactSuggestions(rows) {
  const metrics = selected => {
    const sum = field => selected.reduce((total, row) => total + row.score[field], 0)
    const truePositive = sum('truePositive'), falsePositive = sum('falsePositive'), falseNegative = sum('falseNegative')
    return { cases: selected.length, truePositive, falsePositive, falseNegative,
      precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
      recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null,
      uncertainRecommendations: sum('uncertainRecommendations'),
      unscoredPredictions: selected.reduce((total, row) => total + row.score.unscoredPredictions.length, 0) }
  }
  const by = field => Object.fromEntries([...new Set(rows.map(row => row[field]))].sort().map(key => [key, metrics(rows.filter(row => row[field] === key))]))
  return { overall: metrics(rows), byKind: by('kind'), bySplit: by('split'), byFamily: by('familyId'),
    boundary: 'Model suggestions on the original synthetic edit corpus. Exact quotes prove source presence, not entailment. No deterministic dependency, unaffected certificate, author decision, production replacement or acceptance is inferred.' }
}
