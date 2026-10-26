import { sha256 } from './narrative-reader-contract.mjs'

const ABLATIONS = ['ir-no-time', 'ir-no-knowledge', 'ir-no-evidence']
const key = item => JSON.stringify([item.familyId, item.question.id])
const questionIdentity = question => JSON.stringify({ question: question.question, operation: question.operation,
  view: question.view, branch: question.branch, search: question.search, entityId: question.entityId,
  arcId: question.arcId, throughId: question.throughId, holderId: question.holderId, sourceTitle: question.sourceTitle })
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])])) : value

/** The material is exactly what survived the shared prompt budget. Ignore
 * handles and ordering so renumbering documents cannot fake an ablation.
 * Source provenance, expected answers and scoring gold are never inspected. */
function materialHash(request) {
  const body = JSON.parse(request.messages.find(message => message.role === 'user').content)
  return sha256(body.documents.map(({ documentId: _id, ...document }) => sha256(canonical(document))).sort())
}

export function inspectReaderPreflight(prepared, protocol) {
  const failures = [], pairs = new Map(), ids = new Set(), conditions = protocol.conditions
  if (!Array.isArray(conditions) || new Set(conditions).size !== conditions.length || !conditions.includes('ir-lexical')) {
    throw Error('Reader preflight requires unique conditions including ir-lexical')
  }
  const policy = protocol.preflight
  const splitAware = protocol.version === 3
  if (![2, 3].includes(protocol.version) || policy?.version !== (splitAware ? 2 : 1) || policy.baseline !== 'ir-lexical'
    || JSON.stringify(policy.requiredMaterialContrasts) !== JSON.stringify(ABLATIONS)
    || policy.minimumChangedQuestionsPerAblation !== 1 || ABLATIONS.some(condition => !conditions.includes(condition))
    || (splitAware && JSON.stringify(canonical(policy.minimumChangedQuestionsPerSplit)) !== JSON.stringify({ development: 1, holdout: 1 }))) {
    throw Error('Reader dispatch requires an explicit version 2/3 preflight policy; historical version 1 evidence remains read-only')
  }
  const familySplits = new Map()
  for (const entry of prepared) {
    const { item, request } = entry
    if (typeof item.familyId !== 'string' || !item.familyId || typeof item.question?.id !== 'string'
      || !item.question.id || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !conditions.includes(item.condition)) {
      failures.push({ code: 'invalid-case-identity', caseId: item.id ?? null }); continue
    }
    if (splitAware) {
      if (!['development', 'holdout'].includes(item.split)
        || (familySplits.has(item.familyId) && familySplits.get(item.familyId) !== item.split)) {
        failures.push({ code: 'invalid-family-split', caseId: item.id })
      } else familySplits.set(item.familyId, item.split)
    }
    ids.add(item.id)
    const id = key(item), pair = pairs.get(id) ?? new Map()
    if (pair.has(item.condition)) failures.push({ code: 'duplicate-question-condition', caseId: item.id })
    else pair.set(item.condition, { ...entry, materialHash: materialHash(request) })
    pairs.set(id, pair)
  }
  if (pairs.size !== protocol.questionCount || prepared.length !== protocol.questionCount * conditions.length) {
    failures.push({ code: 'incomplete-matrix', questions: pairs.size, cases: prepared.length })
  }
  if (splitAware && (familySplits.size !== protocol.sceneFamilies
    || [...familySplits.values()].filter(split => split === 'holdout').length !== protocol.holdoutFamilies)) {
    failures.push({ code: 'incomplete-family-splits', sceneFamilies: familySplits.size,
      holdoutFamilies: [...familySplits.values()].filter(split => split === 'holdout').length })
  }
  for (const [id, pair] of pairs) {
    if (conditions.some(condition => !pair.has(condition))) failures.push({ code: 'missing-question-condition', questionKey: id })
    if (new Set([...pair.values()].map(({ item }) => questionIdentity(item.question))).size !== 1) {
      failures.push({ code: 'question-changed-between-conditions', questionKey: id })
    }
  }
  const comparisons = ABLATIONS.map(condition => {
    const rows = [...pairs].flatMap(([id, pair]) => {
      const base = pair.get(policy.baseline), other = pair.get(condition)
      return base && other ? [{ questionKey: id, familyId: base.item.familyId, questionId: base.item.question.id,
        ...(splitAware ? { split: base.item.split } : {}),
        operation: base.item.question.operation, samePrompt: base.request.promptHash === other.request.promptHash,
        sameMaterial: base.materialHash === other.materialHash,
        baselineDocuments: base.request.documents.length, ablatedDocuments: other.request.documents.length,
        budgetOmissionsChanged: JSON.stringify(base.request.omittedDocumentIds) !== JSON.stringify(other.request.omittedDocumentIds) }] : []
    })
    const changedMaterialQuestions = rows.filter(row => !row.sameMaterial).length
    if (changedMaterialQuestions < policy.minimumChangedQuestionsPerAblation) {
      failures.push({ code: 'degenerate-ablation', condition, changedMaterialQuestions })
    }
    const bySplit = splitAware ? Object.fromEntries(['development', 'holdout'].map(split => {
      const selected = rows.filter(row => row.split === split), changed = selected.filter(row => !row.sameMaterial).length
      if (changed < policy.minimumChangedQuestionsPerSplit[split]) failures.push({ code: 'degenerate-split-ablation', condition, split, changedMaterialQuestions: changed })
      return [split, { pairedQuestions: selected.length, changedMaterialQuestions: changed }]
    })) : null
    return { baseline: policy.baseline, condition, pairedQuestions: rows.length,
      identicalPrompts: rows.filter(row => row.samePrompt).length, changedMaterialQuestions,
      metadataOnlyPromptChanges: rows.filter(row => !row.samePrompt && row.sameMaterial).length, ...(splitAware ? { bySplit } : {}), rows }
  })
  return { schema: 'storyforge.narrative-reader-preflight', version: splitAware ? 2 : 1, dispatchAllowed: failures.length === 0,
    cases: prepared.length, pairedQuestions: pairs.size, comparisons, failures, modelCalls: 0, accepted: false,
    evidenceBoundary: splitAware
      ? 'Pre-dispatch matrix, split integrity and material contrasts in both existing splits only. Not a fresh unseen holdout, statistical power, causal isolation, semantic correctness or author acceptance.'
      : 'Pre-dispatch matrix and model-visible material checks only. One changed pair prevents a wholly degenerate ablation; it does not establish statistical power, causal isolation, semantic correctness or author acceptance.' }
}

export function assertReaderPreflight(report) {
  if (!report.dispatchAllowed) throw Error(`Reader preflight blocked model dispatch: ${report.failures.map(item => item.condition ? `${item.code}:${item.condition}` : item.code).join(', ')}`)
}
