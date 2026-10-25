import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateNarrativeStoryCorpus, narrativeStoryModelInput } from './narrative-candidate-story-contract.mjs';
const base = new URL('../tests/acceptance/narrative-world/', import.meta.url);
const fresh = () => JSON.parse(readFileSync(new URL('target-state-independent-story-corpus-20261015-v1.json', base)));
const source = readFileSync(new URL(fresh().sourceFile, base));

test('new complete-story corpus admits mixed outcomes only with explicit compatible business state', () => {
  const corpus = fresh();
  assert.equal(validateNarrativeStoryCorpus(corpus, source), source.toString('utf8'));
  corpus.cases[0].initialBusinessStatus = 'planned';
  assert.throws(() => validateNarrativeStoryCorpus(corpus, source), /cannot admit/);
  delete corpus.cases[0].initialBusinessStatus;
  assert.throws(() => validateNarrativeStoryCorpus(corpus, source), /business status/);
});
test('model transport strips expected answers, including unexpected fields on prior children', () => {
  const corpus = fresh(); corpus.cases[0].expected.privateGold = 'gold-do-not-send';
  corpus.cases[0].initialDevelopments[0].expected = 'gold-do-not-send';
  const input = narrativeStoryModelInput(corpus, source.toString('utf8'));
  assert.equal(input.cases[0].initialBusinessStatus, 'planted');
  assert.equal(input.cases[0].initialDevelopments.length, 2);
  assert.equal(input.sourceText, source.toString('utf8'));
  assert.ok(!JSON.stringify(input).includes('gold-do-not-send'));
  assert.ok(!Object.hasOwn(input.cases[0], 'expected'));
});
test('source mutation, nonverbatim excerpt, duplicate identity and leaked completed initial state fail before dispatch', () => {
  assert.throws(() => validateNarrativeStoryCorpus(fresh(), Buffer.concat([source, Buffer.from('\n')])), /hash mismatch/);
  const excerpt = fresh(); excerpt.cases[0].text = '这是分析而不是故事原文';
  assert.throws(() => validateNarrativeStoryCorpus(excerpt, source), /not verbatim/);
  const duplicate = fresh(); duplicate.cases[0].initialDevelopments[1].id = duplicate.cases[0].initialDevelopments[0].id;
  assert.throws(() => validateNarrativeStoryCorpus(duplicate, source), /distinct prior children/);
  const leaked = fresh(); leaked.cases[0].initialDevelopments[1].state = 'fulfilled';
  assert.throws(() => validateNarrativeStoryCorpus(leaked, source), /unfulfilled prior intentions/);
});
test('historical v2 rejected case retains its original contract and planted is not silently injected', () => {
  const corpus = JSON.parse(readFileSync(new URL('target-state-story-corpus-20261015-v1.json', base)));
  const oldSource = readFileSync(new URL(corpus.sourceFile, base));
  validateNarrativeStoryCorpus(corpus, oldSource);
  corpus.cases[0].initialBusinessStatus = 'planted';
  assert.equal(narrativeStoryModelInput(corpus, oldSource.toString('utf8')).cases[0].initialBusinessStatus, undefined);
});
