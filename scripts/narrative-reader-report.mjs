import { scoreReader, summarizeReader } from './narrative-reader-contract.mjs'

function stringLeaves(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  return value && typeof value === 'object' ? Object.values(value).flatMap(stringLeaves) : []
}

/** Versioned correction to the pilot scorer, not a new reader prompt.
 * A metadata title or direct atomic value was supplied to the reader too;
 * quoting it is grounded, although it is not original story-body evidence.
 * Keep those two measures distinct, and keep the original v1 scores intact. */
export function scoreGroundedReaderV2(item, prepared, answer, family) {
  const original = scoreReader(item, prepared, answer, family)
  const originalTexts = family.sources.map(source => source.text)
  const questions = family.queries.find(question => question.id === item.question.id)
  const sourceSupports = (document, sourceId, quote) => !!document && (
    document.sourceId === sourceId && [document.text, ...document.evidence.map(span => span.text)].some(text => text?.includes(quote))
    || document.evidence.some(span => span.sourceId === sourceId && span.text.includes(quote)))
  const citations = answer.citations.map(citation => {
    const document = prepared.documents.find(document => document.documentId === citation.documentId)?.original
    const supplied = document ? stringLeaves({ title: document.title, kind: document.kind,
      text: document.text, atom: document.atom, evidence: document.evidence.map(span => span.text) }) : []
    const groundedInSuppliedMaterial = supplied.some(text => text.includes(citation.quote))
    return { ...citation, groundedInSuppliedMaterial,
      exactOriginalBody: groundedInSuppliedMaterial && originalTexts.some(text => text.includes(citation.quote)) }
  })
  return { ...original, scoringVersion: 2, citations,
    groundedCitations: citations.filter(citation => citation.groundedInSuppliedMaterial).length,
    unsupportedCitations: citations.filter(citation => !citation.groundedInSuppliedMaterial).length,
    originalBodyCitations: citations.filter(citation => citation.exactOriginalBody).length,
    retrievedGoldSpanHits: questions.evidence.filter(span => prepared.documents.some(document => sourceSupports(document.original, span.sourceId, span.quote))).length,
    citedGoldSpanHits: questions.evidence.filter(span => citations.some(citation => citation.exactOriginalBody && citation.quote.includes(span.quote)
      && sourceSupports(prepared.documents.find(document => document.documentId === citation.documentId)?.original, span.sourceId, citation.quote))).length,
    goldSpanScope: item.question.view === 'character' ? 'Author-audit gold span may contain another character truth; not an authorization to expose the whole span.' : 'Original corpus source/field audit evidence.',
    caveat: 'Grounded quotations may cite titles or structured values; original-body and gold-span evidence are separate. Exact answer strings do not grade semantic correctness.' }
}

export function summarizeGroundedReaderV2(rows) {
  // Reuse unchanged answer/recall/bootstrap calculations, while correcting the
  // old ambiguously named invalidQuoteCount to mean unsupported quotation.
  const proxyRows = rows.map(row => ({ ...row, score: { ...row.score, validOriginalCitations: row.score.groundedCitations } }))
  const summary = summarizeReader(proxyRows)
  for (const [condition, metric] of Object.entries(summary.byCondition)) {
    const selected = rows.filter(row => row.condition === condition)
    metric.groundedCitationCount = selected.reduce((sum, row) => sum + row.score.groundedCitations, 0)
    metric.originalBodyCitationCount = selected.reduce((sum, row) => sum + row.score.originalBodyCitations, 0)
  }
  return { ...summary,
    quoteMetricDefinition: 'invalidQuoteCount counts citations not supported by any supplied title, text, direct atom or evidence text; originalBodyCitationCount is stricter and reported separately.' }
}
