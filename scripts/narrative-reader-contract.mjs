import { createHash } from 'node:crypto'

export const READER_ENTRY_ID = 'eval.narrative-world.fixed-reader'
export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
export const estimateReaderTokens = text => {
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length
  return Math.round(cjk * 1.5 + (text.length - cjk) * 0.25)
}
export const READER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status', 'answer', 'citations'], properties: {
    status: { type: 'string', enum: ['answered', 'insufficient', 'unsupported'] }, answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['documentId', 'quote'],
      properties: { documentId: { type: 'string' }, quote: { type: 'string' } } } },
  },
}
export function readerMessages(item, protocol) {
  const { question, context } = item
  const selected = [], omitted = []
  const request = { question: question.question, operation: question.operation, view: question.view, branch: question.branch,
    retrievalStatus: context.status, diagnostics: context.diagnostics, documents: selected }
  const messages = () => [{ role: 'system', content: protocol.systemPrompt }, { role: 'user', content: JSON.stringify(request) }]
  const within = () => Buffer.byteLength(JSON.stringify(messages())) <= protocol.budget.maxInputBytes
    && estimateReaderTokens(JSON.stringify(messages())) <= protocol.budget.maxEstimatedInputTokens
  if (!within()) throw Error('Question envelope exceeds the frozen input budget')
  for (const [index, document] of context.documents.entries()) {
    // Hide condition labels, gold, random release/receipt IDs and provenance.
    // The model sees only a stable document handle and the actual retrieved data.
    const candidate = { documentId: `D${index + 1}`, title: document.title, kind: document.kind,
      text: document.text, atom: document.atom, evidence: document.evidence.map(span => span.text) }
    selected.push(candidate)
    if (!within()) { selected.pop(); omitted.push(document.id) }
  }
  if (omitted.length) {
    request.retrievalStatus = 'insufficient'
    request.diagnostics = [...context.diagnostics, 'whole-documents-omitted-by-fixed-reader-budget']
    // Reserve the diagnostic itself; never truncate a quote or atom to fit.
    while (!within() && selected.length) omitted.push(context.documents[Number(selected.pop().documentId.slice(1)) - 1].id)
    if (!within()) throw Error('Budget diagnostic exceeds the frozen input budget')
  }
  const final = messages()
  return { messages: final, promptHash: sha256(final), estimatedInputTokens: estimateReaderTokens(JSON.stringify(final)),
    inputBytes: Buffer.byteLength(JSON.stringify(final)), omittedDocumentIds: omitted,
    documents: selected.map(doc => ({ documentId: doc.documentId, original: context.documents[Number(doc.documentId.slice(1)) - 1] })) }
}
export function validateReaderAnswer(text, protocol) {
  const answer = JSON.parse(text)
  if (!answer || Array.isArray(answer) || Object.keys(answer).sort().join(',') !== 'answer,citations,status'
    || !['answered', 'insufficient', 'unsupported'].includes(answer.status) || typeof answer.answer !== 'string'
    || [...answer.answer].length > protocol.budget.maxAnswerCharacters || !Array.isArray(answer.citations)
    || answer.citations.length > protocol.budget.maxCitations
    || answer.citations.some(citation => !citation || Object.keys(citation).sort().join(',') !== 'documentId,quote'
      || typeof citation.documentId !== 'string' || !/^D\d+$/.test(citation.documentId) || typeof citation.quote !== 'string'
      || !citation.quote.length || [...citation.quote].length > protocol.budget.maxQuoteCharacters)) throw Error('Reader output violates the frozen output contract')
  return answer
}
export function readerUsageWithinBudget(usage, protocol) {
  return !!usage && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens)
    && usage.inputTokens <= protocol.budget.maxObservedInputTokens && usage.outputTokens <= protocol.budget.maxObservedOutputTokens
}
export function scoreReader(item, prepared, answer, family) {
  // This is the first place where scoring gold is read. It never changes a
  // request, source annotation, query, budget, model or retry decision.
  const gold = family.queries.find(query => query.id === item.question.id)
  if (!gold) throw Error('Unmapped scoring question')
  const originalTexts = family.sources.map(source => source.text)
  const actual = prepared.documents
  const quotes = answer.citations.map(citation => {
    const document = actual.find(document => document.documentId === citation.documentId)?.original
    const retrieved = !!document && [document.text, ...document.evidence.map(span => span.text)].some(text => text?.includes(citation.quote))
    return { ...citation, supportedByRetrievedText: retrieved,
      exactOriginal: retrieved && originalTexts.some(text => text.includes(citation.quote)) }
  })
  const retrievedText = actual.flatMap(document => [document.original.text ?? '', ...document.original.evidence.map(span => span.text)])
  const atomHits = gold.answerAtoms.map(atom => answer.answer.includes(atom))
  const evidenceHits = gold.evidence.map(span => quotes.some(quote => quote.exactOriginal && quote.quote.includes(span.quote)))
  return { answerStatus: answer.status, answerAtoms: gold.answerAtoms.length, exactAnswerAtomHits: atomHits.filter(Boolean).length,
    exactAllAnswerAtoms: answer.status === 'answered' && atomHits.every(Boolean),
    goldEvidenceSpans: gold.evidence.length, retrievedGoldSpanHits: gold.evidence.filter(span => retrievedText.some(text => text.includes(span.quote))).length,
    citedGoldSpanHits: evidenceHits.filter(Boolean).length,
    citations: quotes, citationCount: quotes.length, validOriginalCitations: quotes.filter(quote => quote.exactOriginal).length,
    literalForbiddenAtomInAnswer: gold.forbiddenAtom ? JSON.stringify(answer).includes(gold.forbiddenAtom) : false,
    literalForbiddenAtomInContext: gold.forbiddenAtom ? retrievedText.some(text => text.includes(gold.forbiddenAtom)) : false,
    semanticCorrectness: 'not-independently-scored',
    caveat: 'Exact strings are automatic proxies. Paraphrases, negation, unsupported additions and semantic leaks require independent review; a proxy hit is not a semantic pass.' }
}

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
export function summarizeReader(rows) {
  const conditions = [...new Set(rows.map(row => row.condition))]
  const metrics = group => ({ cases: group.length, answered: group.filter(row => row.score.answerStatus === 'answered').length,
    exactAllAnswerAtomsRate: mean(group.map(row => Number(row.score.exactAllAnswerAtoms))),
    retrievedGoldSpanRecall: mean(group.map(row => row.score.goldEvidenceSpans ? row.score.retrievedGoldSpanHits / row.score.goldEvidenceSpans : 0)),
    citedGoldSpanRecall: mean(group.map(row => row.score.goldEvidenceSpans ? row.score.citedGoldSpanHits / row.score.goldEvidenceSpans : 0)),
    invalidQuoteCount: group.reduce((sum, row) => sum + row.score.citationCount - row.score.validOriginalCitations, 0),
    literalForbiddenAnswerCount: group.filter(row => row.score.literalForbiddenAtomInAnswer).length })
  const byCondition = Object.fromEntries(conditions.map(condition => [condition, metrics(rows.filter(row => row.condition === condition))]))
  const bySplit = Object.fromEntries([...new Set(rows.map(row => row.split))].map(split => [split,
    Object.fromEntries(conditions.map(condition => [condition, metrics(rows.filter(row => row.condition === condition && row.split === split))]))]))
  const byOperation = Object.fromEntries([...new Set(rows.map(row => row.operation))].map(operation => [operation,
    Object.fromEntries(conditions.map(condition => [condition, metrics(rows.filter(row => row.condition === condition && row.operation === operation))]))]))
  // Paired scene-family bootstrap, keeping related queries together. This
  // estimates only the exact-string proxy difference on these synthetic cases.
  const paired = []
  for (const condition of conditions.filter(condition => condition !== 'ir-lexical')) {
    const families = [...new Set(rows.map(row => row.familyId))]
    const diffs = families.flatMap(familyId => {
      const group = rows.filter(row => row.familyId === familyId)
      const base = group.filter(row => row.condition === 'ir-lexical')
      const other = group.filter(row => row.condition === condition)
      const matched = base.filter(row => other.some(candidate => candidate.questionId === row.questionId))
      return matched.length ? [mean(matched.map(row => Number(row.score.exactAllAnswerAtoms)
        - Number(other.find(candidate => candidate.questionId === row.questionId).score.exactAllAnswerAtoms)))] : []
    })
    let seed = 20261015
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296 }
    const samples = diffs.length > 1 ? Array.from({ length: 2000 }, () => mean(diffs.map(() => diffs[Math.floor(random() * diffs.length)]))).sort((a, b) => a - b) : []
    paired.push({ comparison: `ir-lexical minus ${condition}`, sceneFamilies: diffs.length, meanDifference: mean(diffs),
      familyBootstrap95: samples.length ? [samples[49], samples[1949]] : null,
      caveat: 'Descriptive exact-string proxy only; incomplete families, paraphrases and correlated scenario construction limit inference.' })
  }
  return { byCondition, bySplit, byOperation, pairedExactStringProxy: paired }
}
