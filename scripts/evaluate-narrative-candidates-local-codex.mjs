import { createRequire } from 'node:module';
import { readFile, writeFile, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateNarrativeStoryCorpus, narrativeStoryModelInput } from './narrative-candidate-story-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  output: { type: 'string' }, corpus: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  url: { type: 'string', default: 'http://127.0.0.1:4298/storyforge/' },
} });
if (!values.output) throw Error('Provide --output <new report path>; historical reports are never replaced');
const base = new URL(values.url);
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) throw Error('This evaluator only accepts a local development server');
if (base.pathname !== '/storyforge/' || base.search || base.hash) throw Error('Expected the local /storyforge/ application base path');
const require = createRequire(root + '/package.json');
const { chromium } = require('playwright');
const sha = text => createHash('sha256').update(text).digest('hex');
let corpus = null;
let sourceText = null;
let corpusHash = null;
if (values.corpus) {
  const path = resolve(root, values.corpus), bytes = await readFile(path);
  corpusHash = sha(bytes); corpus = JSON.parse(bytes);
  const source = await readFile(resolve(dirname(path), corpus.sourceFile));
  sourceText = validateNarrativeStoryCorpus(corpus, source);
}
const output = resolve(root, values.output);
await (await open(output, 'wx')).close();
const evalUrl = new URL('nw-evaluation.html', base).href;
async function fingerprint() {
  const files = [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'src', 'scripts/local-codex', 'scripts/evaluate-narrative-candidates-local-codex.mjs', 'scripts/narrative-candidate-story-contract.mjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n'))].sort();
  const hashes = {};
  for (const file of files) hashes[file] = sha(await readFile(resolve(root, file)));
  return { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), treeHash: sha(JSON.stringify(hashes)), fileCount: files.length,
    keyFiles: Object.fromEntries(Object.entries(hashes).filter(([p]) => /narrative|agent\/run\/(event-store|checkpoint)|ai\/client|local-codex/.test(p))) };
}
const code = await fingerprint();
const report = { schema: corpus ? 'narrative-local-codex-story-eval-v' + corpus.version : 'narrative-local-codex-candidate-eval-v1', startedAt: new Date().toISOString(), code,
  evidenceBoundary: 'Actual local Codex subscription through the registered durable annotation Harness. Isolated pre-created domain records, not discovery of all records from raw prose. No human acceptance, author adoption, product or publication acceptance. Synthetic explanatory cases are protocol evidence only.',
  humanReview: { status: 'not-requested' }, dryRun: values['dry-run'], corpus, corpusHash, sourceText, cases: [] };
// Expectations remain outside the browser/model input. Only source data and target requests cross this boundary.
const story = corpus ? narrativeStoryModelInput(corpus, sourceText) : null;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.route(evalUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>NW isolated evaluation</title>' }));
  await page.goto(evalUrl);
  const prepared = await page.evaluate(async story => {
    const imp = p => import('/storyforge/src/' + p);
    const { db } = await imp('lib/db/schema.ts');
    if (await db.projects.count()) throw Error('Expected isolated empty browser');
    const { createWorkspace } = await imp('lib/workspace/create-workspace.ts');
    const { stampNewRecord } = await imp('lib/workspace/scope.ts');
    const { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } = await imp('lib/world-engine/narrative-domain-capture.ts');
    const { confirmNarrativeDomainAnnotationsV1 } = await imp('lib/world-engine/narrative-domain-authoring.ts');
    const { projectNarrativeDomainsV1 } = await imp('lib/world-engine/narrative-domain-projection.ts');
    const { prepareNarrativeCandidateV1 } = await imp('lib/world-engine/narrative-domain-candidate.ts');
    const { codexRequest } = await imp('lib/ai/codex-transport.ts');
    const status = await codexRequest('/status');
    if (status.state !== 'ready') throw Error('Local Codex not ready');
    const model = (await codexRequest('/models')).models.find(item => item.isDefault)?.id;
    if (!model) throw Error('No live default model');
    const created = await createWorkspace({ name: story ? 'NW-1C 完整故事注释评测' : 'NW-1C 合成协议评测', genres: [], description: '隔离评测数据', status: 'drafting', targetWordCount: 2000, enableMultiWorld: false }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' });
    const { scope } = created, owner = { kind: 'work', workCode: created.work.code }, now = Date.now();
    const confirm = async (table, id, annotations) => {
      const capture = await captureNarrativeDomainV1({ scope, owner });
      const row = capture.rows.get(table).find(row => row.id === id);
      await confirmNarrativeDomainAnnotationsV1({ scope, table, recordId: id, expectedSourceHash: await hashNarrativeDomainSourceV1(capture, table, row), annotations });
      return row;
    };
    const metadata = { narrativeVisibilityV1: { class: 'unclassified', audienceKeys: [], policyVersion: 'evaluation-source-v1' } };
    const actors = [];
    for (const name of story?.actors ?? ['小桥', '阿澈']) {
      const id = await db.characters.add(stampNewRecord(scope, 'characters', { name, shortDescription: '', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }));
      actors.push(await confirm('characters', id, metadata));
    }
    const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', { domain: 'humanity', parentId: null, name: '评测物品', fieldSchema: '[]', order: 0, createdAt: now, updatedAt: now }, { owner: 'world' }));
    const bellId = await db.codexEntries.add(stampNewRecord(scope, 'codexEntries', { categoryId, name: story?.objectName ?? '铜铃', description: '', fields: '{}', refs: '{}', origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '', producerRunId: null, producerCandidateHash: null, order: 0, createdAt: now, updatedAt: now }, { owner: 'world' }));
    const bell = await confirm('codexEntries', bellId, metadata);
    const common = actors.map(row => row.ragDocumentId + '::name');
    if (story) {
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { parentId: null, type: 'chapter', title: story.title, summary: '', order: 0, createdAt: now, updatedAt: now }, { owner: 'work' }));
      const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { outlineNodeId, title: story.title, content: story.sourceText, summary: '', wordCount: [...story.sourceText].length, notes: '', status: 'draft', order: 0, createdAt: now, updatedAt: now }, { owner: 'work' }));
      const chapter = await db.chapters.get(chapterId);
      common.push(chapter.ragDocumentId + '::content', bell.ragDocumentId + '::name');
    }
    const eventCases = story ? story.cases.filter(c => c.table === 'storyTimelineEvents') : [
      { id: 'observed-action', title: '铜铃交接', text: '小桥在暮色中把铜铃交给阿澈。这是已经发生的交接。\r\n原文没有说明日期，也没有说明交接的原因。' },
      { id: 'unfulfilled-plan', title: '尚未出发的计划', text: '阿澈打算日后把铜铃送回驿站。这只是他私下的计划；故事写到这里，他还没有动身，也没有把计划告诉小桥。' },
      { id: 'sequence-not-causation', title: '举起铜铃', text: '小桥敲了一下桌子。片刻后，阿澈举起铜铃。原文没有解释两个动作是否有关；本记录描述阿澈举铃这一动作。' },
    ];
    const cases = [];
    for (const item of eventCases) {
      const recordId = await db.storyTimelineEvents.add(stampNewRecord(scope, 'storyTimelineEvents', { title: item.title, description: item.text, importance: 1, order: cases.length, createdAt: now, updatedAt: now }, { owner: 'work' }));
      const row = await db.storyTimelineEvents.get(recordId);
      cases.push({ ...item, recordId, table: 'storyTimelineEvents', selection: { table: 'storyTimelineEvents', sourceUid: row.ragDocumentId, owner, entryKeys: [...common, row.ragDocumentId + '::description'] }, instruction: item.instruction ?? '根据选定原文，为这条记录补充内容性质、事件参与者和逐字引文证据。只表达原文支持的时间、因果和认知；不猜测，不更改业务字段。可见范围按是否已评审和内容性质处理。' });
    }
    for (const item of story?.cases.filter(c => c.table === 'foreshadows') ?? []) {
      const recordId = await db.foreshadows.add(stampNewRecord(scope, 'foreshadows', { name: item.title, type: 'dialogue', status: item.initialBusinessStatus ?? 'planned',
        description: item.text, notes: '', plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null, createdAt: now, updatedAt: now }, { owner: 'work' }));
      const row = await db.foreshadows.get(recordId);
      const childIdentities = item.initialDevelopments.map(child => ({ id: child.id, semanticSubKey: 'sub:v1:' + crypto.randomUUID() }));
      const children = item.initialDevelopments.map((child, at) => ({ semanticSubKey: childIdentities[at].semanticSubKey,
        statement: child.statement, developmentType: child.developmentType, state: child.state, owners: [], members: [], transitions: [], resolutionEvidenceKeys: [],
        narrativeModalityV1: child.modality, narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'evaluation-prior-target-v1' } }));
      await confirm('foreshadows', recordId, { narrativeDevelopmentsV1: children });
      cases.push({ ...item, recordId, childIdentities, selection: { table: 'foreshadows', sourceUid: row.ragDocumentId, owner,
        entryKeys: [...common, row.ragDocumentId + '::description'] } });
    }
    if (!story || story.cases.some(c => c.table === 'knowledgeLedger')) {
    const truth = story?.supportingFact ?? { subject: '阿澈', value: '铜铃在阿澈手中' };
    const factId = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', { characterId: actors.find(a => a.name === truth.subject).id, subjectName: truth.subject, predicate: 'owns', factKind: 'state', objectCodexEntryId: bellId, value: truth.value, sourceType: 'manual', status: 'confirmed', locked: false, createdAt: now, updatedAt: now }, { owner: 'work' }));
    const fact = await confirm('temporalFacts', factId, { ...metadata, narrativeAssertionV1: { polarity: 'positive' } });
    const sourceProjection = await projectNarrativeDomainsV1({ scope, owner, branchKey: 'canon' });
    for (const row of [...actors, bell, fact]) if (!sourceProjection.coverage.projectedSourceKeys.some(key => key.endsWith(':' + row.ragDocumentId))) throw Error('Evaluation fixture has an invalid dependency: ' + row.ragDocumentId);
    const seed = story?.knowledgeSeed ?? { character: '小桥', statement: '铜铃在阿澈手中', action: 'mislearn', belief: '铜铃在小桥房里的抽屉中' };
    const knowledgeCase = story?.cases.find(c => c.table === 'knowledgeLedger') ?? { id: 'false-belief', title: '铜铃归属的误认', text: '铜铃实际已经交给阿澈保管，小桥并不知道交接已经完成，仍然相信铜铃在自己房里的抽屉中。这是小桥的错误判断。', instruction: '从选定原文为这条角色认知记录补充叙事注释和逐字引文。准确区分角色相信的内容与客观事实，不猜测获知日期或来源事件。' };
    const knowledgeId = await db.knowledgeLedger.add(stampNewRecord(scope, 'knowledgeLedger', { characterId: actors.find(a => a.name === seed.character).id, characterName: seed.character, knowledgeKey: 'bell-custody', statement: seed.statement, factId, action: seed.action, belief: seed.belief, sourceType: 'manual', sourceQuote: knowledgeCase.text, status: 'confirmed', createdAt: now, updatedAt: now }, { owner: 'work' }));
    const knowledge = await db.knowledgeLedger.get(knowledgeId);
    const knowledgeFields = story ? ['sourceQuote'] : ['statement', 'belief', 'sourceQuote'];
    cases.push({ ...knowledgeCase, recordId: knowledgeId, table: 'knowledgeLedger', selection: { table: 'knowledgeLedger', sourceUid: knowledge.ragDocumentId, owner,
      entryKeys: [...common, ...(story ? [] : [bell.ragDocumentId + '::name', fact.ragDocumentId + '::value']), ...knowledgeFields.map(field => knowledge.ragDocumentId + '::' + field)] } });
    }
    const preflight = [];
    for (const item of cases) {
      const prepared = await prepareNarrativeCandidateV1({ scope, selection: item.selection });
      if (story && !prepared.baseline.originalFields.some(field => field.table === 'chapters' && field.text === story.sourceText)) throw Error('Complete story absent from model sources');
      if (story && prepared.baseline.originalFields.some(field => ['belief', 'statement', 'action', 'value'].some(name => field.key.endsWith('::' + name)))) throw Error('Pre-seeded interpretation leaked into selected original fields');
      const target = await db.table(item.table).get(item.recordId);
      if (item.initialBusinessStatus && target.status !== item.initialBusinessStatus) throw Error('Prepared business status differs from frozen admission');
      preflight.push({ id: item.id, originalFields: prepared.baseline.originalFields, targetState: prepared.baseline.targetState,
        childIdentities: item.childIdentities, businessStatus: item.initialBusinessStatus ? target.status : undefined });
    }
    return { scope, cases, preflight, identities: actors.map(a => ({ name: a.name, sourceUid: a.ragDocumentId })), provider: 'codex', model, cliVersion: status.version,
      config: { provider: 'codex', model, apiKey: '', baseUrl: '/storyforge/local-codex/v1', temperature: 0.2, maxTokens: 6000, contextWindow: 32768 } };
  }, story);
  report.provider = { channel: 'local-codex-subscription', provider: prepared.provider, model: prepared.model, cliVersion: prepared.cliVersion };
  report.preflight = prepared.preflight;
  report.identities = prepared.identities;
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  for (const item of values['dry-run'] ? [] : prepared.cases) {
    console.log(JSON.stringify({ phase: 'requesting', case: item.id, model: prepared.model }));
    const entry = { id: item.id, title: item.title, sourceText: item.text, instruction: item.instruction, startedAt: new Date().toISOString() };
    try {
      const result = await page.evaluate(async ({ prepared, item }) => {
        const { db } = await import('/storyforge/src/lib/db/schema.ts');
        const { generateNarrativeAnnotationCandidateV1, readNarrativeAnnotationRunV1 } = await import('/storyforge/src/lib/agent/run/narrative-annotation-durable.ts');
        const before = await db.table(item.table).get(item.recordId);
        const generated = await generateNarrativeAnnotationCandidateV1({ scope: prepared.scope, selection: item.selection, instruction: item.instruction, aiConfig: prepared.config });
        const loaded = await readNarrativeAnnotationRunV1(prepared.scope, generated.snapshot.run.id);
        const after = await db.table(item.table).get(item.recordId);
        return { runId: generated.snapshot.run.id, candidate: generated.candidate, context: loaded.state.context, baseline: loaded.state.baseline, calls: loaded.state.calls, state: loaded.snapshot.projection.state, staleReason: loaded.staleReason, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after) };
      }, { prepared, item });
      await page.reload();
      const recovered = await page.evaluate(async ({ scope, runId }) => {
        const { readNarrativeAnnotationRunV1 } = await import('/storyforge/src/lib/agent/run/narrative-annotation-durable.ts');
        const r = await readNarrativeAnnotationRunV1(scope, runId);
        return { candidateHash: r.candidate?.candidateHash, state: r.snapshot.projection.state, callCount: r.state.calls.length };
      }, { scope: prepared.scope, runId: result.runId });
      const a = result.candidate.proposal?.annotations ?? {};
      const checks = { candidateReady: result.candidate.artifact.status === 'ready', sourceUnchanged: result.sourceUnchanged,
        refreshRestoresSameCandidate: recovered.candidateHash === result.candidate.candidateHash, atMostOneRepair: result.calls.length <= 2,
        noNumericLocalReferences: !JSON.stringify(result.candidate.portableAnnotations).match(/"(?:characterId|storyEventId|factId|knowledgeId)":\d/),
        hasQuotedEvidence: [a, ...(a.narrativeDevelopmentsV1 ?? [])].some(value => Array.isArray(value.narrativeEvidenceV1) && value.narrativeEvidenceV1.length > 0) };
      if (corpus) {
        const expected = corpus.cases.find(c => c.id === item.id).expected;
        const actorUid = name => prepared.identities.find(a => a.name === name)?.sourceUid;
        checks.completeStoryInActualInput = result.baseline.originalFields.some(field => field.table === 'chapters' && field.text === sourceText);
        if (expected.modality) checks.expectedModality = (a.narrativeModalityV1 ?? 'established') === expected.modality;
        if (expected.eventType) checks.expectedEventType = a.narrativeEventV1?.eventType === expected.eventType;
        if (expected.participants) checks.requiredParticipants = expected.participants.every(name => a.narrativeEventV1?.participants.some(p => p.entity.sourceUid === actorUid(name)));
        if (expected.sender) checks.speaker = a.narrativeEventV1?.communication?.sender.sourceUid === actorUid(expected.sender);
        if (expected.recipient) checks.recipient = a.narrativeEventV1?.communication?.recipients.some(p => p.sourceUid === actorUid(expected.recipient)) === true;
        if (expected.noCauses) checks.noInferredCause = !(a.narrativeDependenciesV1 ?? []).some(d => d.role === 'causes');
        if (expected.attitude) checks.expectedAttitude = a.narrativeEpistemicV1?.attitude === expected.attitude;
        if (expected.assertedValue) checks.preservesBeliefText = a.narrativeEpistemicV1?.assertedValue?.value === expected.assertedValue;
        if (expected.developments) {
          const children = a.narrativeDevelopmentsV1 ?? [], prior = result.baseline.targetState?.annotations.narrativeDevelopmentsV1 ?? [];
          checks.priorChildIdentitiesInActualInput = prior.length === item.childIdentities.length
            && item.childIdentities.every(identity => prior.some(child => child.semanticSubKey === identity.semanticSubKey));
          checks.preservesEveryChildIdentity = children.length === prior.length && prior.every(child => children.some(next => next.semanticSubKey === child.semanticSubKey));
          for (const [id, expectation] of Object.entries(expected.developments)) {
            const identity = item.childIdentities.find(child => child.id === id);
            const child = children.find(child => child.semanticSubKey === identity?.semanticSubKey);
            checks[id + ':state'] = expectation.states.includes(child?.state);
            checks[id + ':modality'] = (child?.narrativeModalityV1 ?? 'established') === expectation.modality;
            if (expectation.resolutionEvidence) checks[id + ':resolutionEvidence'] = child?.resolutionEvidenceKeys?.length > 0;
          }
        }
        entry.expected = expected;
      } else {
        if (item.id === 'unfulfilled-plan') { checks.intentNotFact = a.narrativeModalityV1 === 'intent'; checks.privateIntent = a.narrativeVisibilityV1?.class === 'author-only'; }
        if (item.id === 'observed-action') { checks.establishedAction = (a.narrativeModalityV1 ?? 'established') === 'established' && a.narrativeEventV1?.eventType === 'action'; checks.noInventedDate = !JSON.stringify(a.narrativeTimeV1 ?? {}).includes('"kind":"tick"'); }
        if (item.id === 'sequence-not-causation') checks.noInferredCause = !(a.narrativeDependenciesV1 ?? []).some(d => d.role === 'causes');
        if (item.id === 'false-belief') { checks.beliefNotTruth = a.narrativeModalityV1 === 'belief' && a.narrativeEpistemicV1?.attitude === 'believe'; checks.preservesWrongBelief = a.narrativeEpistemicV1?.assertedValue?.value?.includes('抽屉') === true; }
      }
      Object.assign(entry, { finishedAt: new Date().toISOString(), result, recovered, checks, automatedChecksPassed: Object.values(checks).every(Boolean) });
      console.log(JSON.stringify({ phase: 'saved', case: item.id, status: result.candidate.artifact.status, calls: result.calls.length, checks }));
    } catch (error) {
      entry.error = String(error.stack ?? error); entry.finishedAt = new Date().toISOString();
      try {
        entry.persistedFailureEvidence = await page.evaluate(async scope => {
          const { listNarrativeAnnotationRunsV1, readNarrativeAnnotationRunV1 } = await import('/storyforge/src/lib/agent/run/narrative-annotation-durable.ts');
          const runs = await listNarrativeAnnotationRunsV1(scope);
          return Promise.all(runs.map(async run => {
            const loaded = await readNarrativeAnnotationRunV1(scope, run.id);
            return { runId: run.id, state: loaded.state, projection: loaded.snapshot.projection, staleReason: loaded.staleReason };
          }));
        }, prepared.scope);
      } catch (captureError) { entry.failureEvidenceCaptureError = String(captureError); }
      report.cases.push(entry);
      await writeFile(output, JSON.stringify(report, null, 2) + '\n'); throw error;
    }
    report.cases.push(entry);
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  report.finishedAt = new Date().toISOString();
  const after = await fingerprint();
  report.sourceUnchangedDuringEvaluation = after.treeHash === code.treeHash;
  report.automatedChecksPassed = !values['dry-run'] && report.sourceUnchangedDuringEvaluation && report.cases.length === prepared.cases.length && report.cases.every(c => c.automatedChecksPassed);
  if (!values['dry-run'] && !report.automatedChecksPassed) process.exitCode = 1;
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'complete', dryRun: values['dry-run'], passed: report.automatedChecksPassed, cases: report.cases.length, output }));
} catch (error) {
  report.error = String(error.stack ?? error); report.finishedAt = new Date().toISOString();
  report.sourceUnchangedDuringEvaluation = (await fingerprint()).treeHash === code.treeHash;
  await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.error(error.message); process.exitCode = 1;
} finally { await context.close(); await browser.close(); }
