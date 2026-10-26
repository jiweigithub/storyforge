import { createHash } from 'node:crypto';

const statuses = ['planned', 'planted', 'echoed', 'resolved'];
const outcomes = ['open', 'advancing', 'blocked', 'resolved', 'fulfilled', 'abandoned'];

/** Evaluation admission only. Expectations never enter the application/model. */
export function validateNarrativeStoryCorpus(corpus, sourceBytes) {
  if (![1, 2, 3].includes(corpus.version) || corpus.schema !== 'narrative-story-evaluation-corpus-v' + corpus.version) throw Error('Unsupported story corpus');
  if (createHash('sha256').update(sourceBytes).digest('hex') !== corpus.sourceSha256) throw Error('Frozen story source hash mismatch');
  const sourceText = sourceBytes.toString('utf8');
  if (!Array.isArray(corpus.cases) || !corpus.cases.length || new Set(corpus.cases.map(c => c.id)).size !== corpus.cases.length) throw Error('Corpus case identity is invalid');
  for (const item of corpus.cases) if (!item.text || !sourceText.includes(item.text)) throw Error('Case excerpt is not verbatim: ' + item.id);
  if (corpus.version >= 2 && corpus.cases.some(item => item.table !== 'foreshadows' || !Array.isArray(item.initialDevelopments)
    || item.initialDevelopments.length < 2 || new Set(item.initialDevelopments.map(child => child.id)).size !== item.initialDevelopments.length)) throw Error('Target-state corpus must declare multiple distinct prior children');
  if (corpus.version === 3) {
    if (typeof corpus.objectName !== 'string' || !corpus.objectName.trim() || !sourceText.includes(corpus.objectName)) throw Error('Version 3 requires a story-grounded object name');
    for (const item of corpus.cases) {
      if (!statuses.includes(item.initialBusinessStatus)) throw Error('Declare a valid business status before model dispatch');
      const expected = item.expected?.developments;
      if (!expected || Object.keys(expected).length !== item.initialDevelopments.length) throw Error('Every prior child requires a separately frozen expectation');
      for (const child of item.initialDevelopments) {
        const target = expected[child.id];
        if (!target || !Array.isArray(target.states) || !target.states.length || target.states.some(state => !outcomes.includes(state))
          || !['intent', 'established'].includes(target.modality)) throw Error('Invalid development expectation');
        if (child.modality !== 'intent' || !['open', 'advancing', 'blocked'].includes(child.state)) throw Error('New version 3 cases must start from unfulfilled prior intentions');
        if (item.initialBusinessStatus === 'planned' && (target.modality !== 'intent' || target.states.some(state => ['resolved', 'fulfilled'].includes(state)))) throw Error('Planned business status cannot admit an established or fulfilled child; fix the fixture before dispatch');
      }
    }
  }
  return sourceText;
}

export function narrativeStoryModelInput(corpus, sourceText) {
  return { title: corpus.title, sourceText, actors: corpus.actors, objectName: corpus.objectName,
    supportingFact: corpus.supportingFact, knowledgeSeed: corpus.knowledgeSeed,
    cases: corpus.cases.map(({ id, title, table, text, instruction, initialBusinessStatus, initialDevelopments }) => ({ id, title, table, text, instruction,
      initialBusinessStatus: corpus.version === 3 ? initialBusinessStatus : undefined,
      initialDevelopments: initialDevelopments?.map(({ id, statement, developmentType, state, modality }) => ({ id, statement, developmentType, state, modality })) })) };
}
