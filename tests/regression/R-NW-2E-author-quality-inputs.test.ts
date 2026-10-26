import { afterEach, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { prepareNarrativeCandidateV1 } from '../../src/lib/world-engine/narrative-domain-candidate'
import { generateNarrativeAnnotationCandidateV1, adoptNarrativeAnnotationCandidateV1 } from '../../src/lib/agent/run/narrative-annotation-durable'
import { deriveNarrativeNovelToWorldV4 } from '../../src/lib/world-engine/narrative-derivation'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { authorWorldQueryV1, openAuthorWorldQueryAccessV1, queryWorldReleaseV1, closeWorldQueryAccessV1 } from '../../src/lib/context-gateway/world-query-client'

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const folder = 'tests/acceptance/narrative-world/'
const sourcePath = folder + 'local-codex-story-eval-20261014-v1.json'
const reviewPath = folder + 'author-review-status-20261016-v2.json'
const originalPath = folder + 'story-bell-20261014-v1.txt'
const sourceBytes = readFileSync(sourcePath), reviewBytes = readFileSync(reviewPath)
const history = JSON.parse(sourceBytes.toString()), review = JSON.parse(reviewBytes.toString())
const currentSourcePaths = [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'src'], { encoding: 'utf8' })
  .trim().split('\n'))].sort()
currentSourcePaths.push('tests/regression/R-NW-2E-author-quality-inputs.test.ts', 'scripts/narrative-author-quality-contract.mjs',
  originalPath, 'package.json', 'package-lock.json', 'vitest.config.ts', 'tests/setup.ts')
const checkpoint = { sourceHashes: Object.fromEntries(currentSourcePaths.map(path => [path, sha(readFileSync(path))])) }
const outputDirectory = process.env.NW_AUTHOR_QUALITY_INPUT_DIR
const relativeOutput = outputDirectory ? relative(process.cwd(), resolve(outputDirectory))
  : folder + 'raw/author-quality-inputs-unpersisted-test'
if (!/^tests\/acceptance\/narrative-world\/raw\/author-quality-inputs-[A-Za-z0-9_-]+$/.test(relativeOutput)) throw Error('Use a fresh named quality-input evidence directory')
let inputDocuments: Record<string, Array<{ id: string; text: string; hash: string }>> | null = null
let releaseContentHash: string | null = null
const revisionRequest = '将交接时红线的去向改为系在阿澈左手腕上；检查这项修改对原故事其余场景的影响，保留未受影响的情节与叙事风格。完成修订后接续两章，每章600至1000字。'

const report: Record<string, any> = { schema: 'storyforge.narrative-author-quality-source-preparation', version: 1,
  boundary: 'Offline replay of all five author-reviewed historical candidates, including the original bounded repair. Isolated fake IndexedDB and simulated adoption; no new model call, native run, user-data write or complete quality acceptance.',
  source: { path: sourcePath, sha256: sha(sourceBytes) }, authorReview: { path: reviewPath, sha256: sha(reviewBytes) },
  sourceHashes: checkpoint.sourceHashes, actualNewModelCalls: 0, fixtureReplayDeliveries: 0,
  supportingFactIdentity: 'Original supporting fact text and declared author constraint reconstructed; its historical UID was not captured, so the isolated fixture allocates a new UID. All model-visible source UIDs are preserved.',
  completedStages: [], originalSource: { path: originalPath, sha256: sha(readFileSync(originalPath)) },
  selections: {}, realModelCalls: 0, sourcePreparationComplete: false, inputContractVerified: false,
  completed: false, accepted: false }
const stage = (name: string, data: unknown) => report.completedStages.push({ name, data })
const verifySources = () => {
  for (const [path, hash] of Object.entries(checkpoint.sourceHashes)) expect(sha(readFileSync(path)), path).toBe(hash)
  expect(sha(readFileSync(sourcePath))).toBe(sha(sourceBytes)); expect(sha(readFileSync(reviewPath))).toBe(sha(reviewBytes))
}
afterEach(() => db.close())

it('prepares paired quality inputs from one current frozen release and actual authorized query results', async () => {
  let inputValidationError: unknown
  try {
    verifySources()
    expect(history.sourceText).toBe(readFileSync(originalPath, 'utf8'))
    expect(review.referenceHashes[sourcePath]).toBe(sha(sourceBytes))
    expect(review.assessments.find((item: any) => item.story === '风里的铜铃').items.every((item: any) => item.authorAccepted)).toBe(true)
    await db.delete(); await db.open()
    const created = await createWorkspace({ name: '铜铃已抽检候选贯穿诊断', genres: [], description: '隔离评测数据', status: 'drafting', targetWordCount: 2000, enableMultiWorld: false },
      { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const { scope } = created, owner = { kind: 'work' as const, workCode: created.work.code }, now = Date.now()
    const add = async (table: string, fields: Record<string, unknown>, ownership: 'world' | 'work') =>
      Number(await db.table(table).add(stampNewRecord(scope, table, { ...fields, createdAt: now, updatedAt: now }, { owner: ownership })))
    const confirm = async (table: string, recordId: number, annotations: any) => {
      const capture = await captureNarrativeDomainV1({ scope, owner }), row = capture.rows.get(table)!.find(item => item.id === recordId)!
      await confirmNarrativeDomainAnnotationsV1({ scope, table, recordId,
        expectedSourceHash: await hashNarrativeDomainSourceV1(capture, table, row), annotations })
    }
    const metadata = { narrativeVisibilityV1: { class: 'unclassified', audienceKeys: [], policyVersion: 'evaluation-source-v1' } }
    const actors = new Map<string, number>()
    for (const actor of history.identities) {
      const id = await add('characters', { ragDocumentId: actor.sourceUid, name: actor.name, shortDescription: '', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '' }, 'world')
      actors.set(actor.name, id); await confirm('characters', id, metadata)
    }
    const originalFields = history.cases[0].result.baseline.originalFields
    const bell = originalFields.find((field: any) => field.table === 'codexEntries')
    const categoryId = await add('codexCategories', { domain: 'humanity', parentId: null, name: '评测物品', fieldSchema: '[]', order: 0 }, 'world')
    const bellId = await add('codexEntries', { ragDocumentId: bell.sourceUid, categoryId, name: bell.text, description: '', fields: '{}', refs: '{}', origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '', producerRunId: null, producerCandidateHash: null, order: 0 }, 'world')
    await confirm('codexEntries', bellId, metadata)
    const chapter = originalFields.find((field: any) => field.table === 'chapters')
    const outlineNodeId = await add('outlineNodes', { parentId: null, type: 'chapter', title: history.corpus.title, summary: '', order: 0 }, 'work')
    const chapterId = await add('chapters', { ragDocumentId: chapter.sourceUid, outlineNodeId, title: history.corpus.title, content: chapter.text, summary: '', wordCount: [...chapter.text].length, notes: '', status: 'draft', order: 0 }, 'work')
    const truth = history.corpus.supportingFact
    const factId = await add('temporalFacts', { characterId: actors.get(truth.subject), subjectName: truth.subject, predicate: 'owns', factKind: 'state', objectCodexEntryId: bellId, value: truth.value, sourceType: 'manual', status: 'confirmed', locked: false }, 'work')
    await confirm('temporalFacts', factId, { ...metadata, narrativeAssertionV1: { polarity: 'positive' } })
    const targets = []
    for (const [order, item] of history.cases.entries()) {
      const table = history.corpus.cases.find((entry: any) => entry.id === item.id).table
      const field = item.result.baseline.originalFields.find((entry: any) => entry.table === table)
      let recordId: number
      if (table === 'storyTimelineEvents') recordId = await add(table, { ragDocumentId: field.sourceUid, title: item.title, description: field.text, importance: 1, order }, 'work')
      else if (table === 'knowledgeLedger') {
        const seed = history.corpus.knowledgeSeed
        recordId = await add(table, { ragDocumentId: field.sourceUid, characterId: actors.get(seed.character), characterName: seed.character,
          knowledgeKey: 'bell-custody', statement: seed.statement, factId, action: seed.action, belief: seed.belief,
          sourceType: 'manual', sourceQuote: field.text, status: 'confirmed' }, 'work')
      } else throw Error('Unexpected table: ' + table)
      targets.push({ item, table, recordId, sourceUid: field.sourceUid })
    }
    const sourceWork = await db.works.get(scope.workId), sourceChapter = await db.chapters.get(chapterId)
    const prior = await deriveNarrativeNovelToWorldV4({ sourceScope: scope, targetName: '铜铃采纳前隔离版本', publish: true })
    stage('prior-release', { hash: prior.release!.contentHash })
    for (const target of targets) {
      const actual = target.item.result, selection = { table: target.table, sourceUid: target.sourceUid, owner,
        entryKeys: actual.baseline.originalFields.map((field: any) => field.key) }
      const prepared = await prepareNarrativeCandidateV1({ scope, selection })
      const selected = (fields: any[]) => fields.map(({ key, text, contentHash }) => ({ key, text, contentHash }))
      expect(selected(prepared.baseline.originalFields)).toEqual(selected(actual.baseline.originalFields))
      const before = await db.table(target.table).get(target.recordId)
      let deliveries = 0
      const generated = await generateNarrativeAnnotationCandidateV1({ scope, selection,
        instruction: '离线复核作者认可的完整故事候选，使用既有原始响应。',
        modelIdentity: { provider: 'fixture', model: 'author-reviewed-bell-original-response-replay' },
        runAI: async () => {
          if (!actual.calls[deliveries]) throw Error('Unexpected additional replay call')
          report.fixtureReplayDeliveries++; return { output: actual.calls[deliveries++].output, durationMs: 0 }
        } })
      expect(generated.candidate.artifact.status).toBe('ready')
      expect(deliveries).toBe(actual.calls.length)
      expect(await db.table(target.table).get(target.recordId)).toEqual(before)
      await adoptNarrativeAnnotationCandidateV1({ scope, runId: generated.snapshot.run.id, candidateHash: generated.candidate.candidateHash })
      const adopted = await db.table(target.table).get(target.recordId)
      const expected = JSON.parse(actual.calls.at(-1).output).annotations
      expect(adopted.narrativeModalityV1).toBe(expected.narrativeModalityV1)
      expect(adopted[target.table === 'knowledgeLedger' ? 'sourceQuote' : 'description']).toBe(before[target.table === 'knowledgeLedger' ? 'sourceQuote' : 'description'])
      stage('adopt-' + target.item.id, { sourceUid: target.sourceUid, deliveries, rawResponseHashes: actual.calls.map((call: any) => sha(call.output)),
        candidateHash: generated.candidate.candidateHash, modality: adopted.narrativeModalityV1 })
    }
    expect(report.fixtureReplayDeliveries).toBe(6)
    const derived = await deriveNarrativeNovelToWorldV4({ sourceScope: scope, targetName: '铜铃全部采纳后的隔离版本', publish: true })
    expect(await db.works.get(scope.workId)).toEqual(sourceWork); expect(await db.chapters.get(chapterId)).toEqual(sourceChapter)
    expect((await db.worldReleases.get(prior.release!.id!))!.manifestJson).toBe(prior.release!.manifestJson)
    const release = derived.release!, verified = await verifyWorldReleaseRecordV1(release)
    if (verified.version !== 4) throw Error('Expected v4')
    const records = verified.manifest.narrative.bundle.records
    for (const target of targets) {
      const record = records.find(record => record.provenance.sourceResourceKey.endsWith(':' + target.sourceUid))!
      const expected = JSON.parse(target.item.result.calls.at(-1).output).annotations
      expect(record.modality).toBe(expected.narrativeModalityV1)
      if (record.kind === 'epistemic-event') {
        expect(record.payload.assertedValue).toEqual(expected.narrativeEpistemicV1.assertedValue)
        expect(record.time.acquiredAt).toBeNull()
      } else { expect(record.kind).toBe('event'); expect(record.payload.eventType).toBe(expected.narrativeEventV1.eventType) }
    }
    expect(records.flatMap(record => record.dependencies).some(edge => ['causes', 'enables'].includes(edge.role))).toBe(false)
    stage('explicit-work-to-world-derivation', { contentHash: release.contentHash, oldReleasePreserved: true, sourceOwnerAndTextPreserved: true,
      records, characterKnowledgeBoundary: 'Acquisition time remains unknown; this does not claim a dated character knowledge query or invent a timestamp.' })
    for (const [view, modality, count] of [['canon', 'established', 3], ['author-plan', 'intent', 1]] as const) {
      const access = await openAuthorWorldQueryAccessV1({ scope: derived.targetScope, localReleaseRecordId: release.id!, view,
        perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
      try {
        const result = await queryWorldReleaseV1(access, { ...authorWorldQueryV1(access), kinds: ['event'], evidenceDepth: 'original' })
        report['query-' + view] = result
        expect(result.items).toHaveLength(count)
        expect(result.items.every(item => item.modality === modality && item.originalAvailable)).toBe(true)
        expect(result.items.every(item => item.evidence.length > 0 && item.evidence.every(span => history.sourceText.includes(span.text)))).toBe(true)
        stage('query-' + view, { count, modality, evidenceSpans: result.items.reduce((sum, item) => sum + item.evidence.length, 0) })
      } finally { await closeWorldQueryAccessV1(access) }
    }
    const frozenChapters = (verified.manifest.records.chapters ?? []).filter(row => row.content === history.sourceText)
    expect(frozenChapters).toHaveLength(1)
    const original = frozenChapters[0].content as string
    releaseContentHash = release.contentHash
    const lexicalTerms = ['铜铃', '红线']
    const lexical = original.split(/\n\s*\n/).filter(paragraph => lexicalTerms.some(term => paragraph.includes(term)))
    expect(lexical.length).toBeGreaterThan(0)
    const document = (text: string, index: number) => ({ id: `D${index + 1}`, text, hash: sha(text) })
    const typed = (['canon', 'author-plan'] as const).flatMap(view => report['query-' + view].items.map((item: any) => {
      expect(item.originalAvailable).toBe(true)
      expect(item.evidence.length).toBeGreaterThan(0)
      expect(item.evidence.every((span: any) => typeof span.text === 'string' && original.includes(span.text))).toBe(true)
      // Preserve exactly what the registered author query returned. Do not
      // fill an unavailable belief, acquisition time or dependency from gold.
      return JSON.stringify({ view, kind: item.kind, title: item.title, modality: item.modality,
        atom: item.atom, supportingAtoms: item.supportingAtoms, evidence: item.evidence.map((span: any) => span.text) })
    }))
    inputDocuments = { 'original-lexical': lexical.map(document), 'original-ir': typed.map(document) }
    report.releaseManifestJson = release.manifestJson
    report.releaseContentHash = release.contentHash
    report.selections = {
      'original-lexical': { schema: 'storyforge.author-quality-source-selection', version: 1,
        releaseContentHash: release.contentHash, method: 'literal paragraph selection over the exact frozen original',
        terms: lexicalTerms, originalHash: sha(original), documents: inputDocuments['original-lexical'].map(({ id, hash }) => ({ id, hash })) },
      'original-ir': { schema: 'storyforge.author-quality-source-selection', version: 1,
        releaseContentHash: release.contentHash, method: 'current registered author canon/plan query results',
        views: ['canon', 'author-plan'], kinds: ['event'], queryReceipts: ['canon', 'author-plan'].map(view => report['query-' + view].receiptRef),
        documents: inputDocuments['original-ir'].map(({ id, hash }) => ({ id, hash })),
        limitation: 'These author views do not return the belief as a hit; the unknown acquisition time is not invented to open a character query. Full original prose is common to both conditions.' },
    }
    report.qualityBoundary = 'Actual current query results after isolated replay/adoption of earlier author-reviewed candidates. This source preparation is not new model inference, real author adoption, human literary review or completed quality acceptance.'
    verifySources(); report.sourcePreparationComplete = true
  } catch (error) {
    report.error = error instanceof Error ? { name: error.name, message: error.message } : String(error)
    throw error
  } finally {
    report.sourceFilesUnchanged = Object.entries(checkpoint.sourceHashes).every(([path, hash]) => sha(readFileSync(path)) === hash)
    let input: Record<string, any> | null = null
    if (report.sourcePreparationComplete && report.sourceFilesUnchanged && inputDocuments && releaseContentHash) {
      input = { schema: 'storyforge.narrative-author-quality-input', version: 1,
        original: history.sourceText, originalHash: sha(history.sourceText), revisionRequest, revisionRequestHash: sha(revisionRequest),
        releaseContentHash, sourceReceipts: [{ path: relativeOutput + '/source-receipt.json', sha256: sha(JSON.stringify(report, null, 2) + '\n') },
          { path: sourcePath, sha256: sha(sourceBytes) }, { path: reviewPath, sha256: sha(reviewBytes) },
          { path: originalPath, sha256: sha(readFileSync(originalPath)) }],
        conditions: Object.fromEntries(Object.entries(inputDocuments).map(([condition, documents]) => [condition, {
          documents, releaseContentHash, selectionReceiptHash: sha(JSON.stringify(report.selections[condition])),
        }])), accepted: false }
      try {
        execFileSync(process.execPath, ['--input-type=module', '-e',
          "import { validateAuthorQualityInputs } from './scripts/narrative-author-quality-contract.mjs'; let text=''; for await (const part of process.stdin) text+=part; validateAuthorQualityInputs(JSON.parse(text));"],
        { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000 })
        report.inputContractVerified = true
        report.completed = true
      } catch (error) {
        inputValidationError = error
        input = null
        report.error = error instanceof Error ? { name: error.name, message: error.message } : String(error)
      }
    }
    const reportText = JSON.stringify(report, null, 2) + '\n'
    // The receipt is finalized after validation. Rebind its byte hash without
    // changing any validated source document, selection or release identity.
    if (input) input.sourceReceipts[0].sha256 = sha(reportText)
    if (outputDirectory) {
      mkdirSync(resolve(relativeOutput))
      writeFileSync(resolve(relativeOutput, 'source-receipt.json'), reportText, { flag: 'wx' })
      if (input) writeFileSync(resolve(relativeOutput, 'input.json'), JSON.stringify(input, null, 2) + '\n', { flag: 'wx' })
    }
  }
  if (inputValidationError) throw inputValidationError
  if (report.sourcePreparationComplete) expect(report.sourceFilesUnchanged, 'Evaluation sources changed before persistence').toBe(true)
}, 30000)
