import {afterEach, beforeEach, expect, it} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import {chatOpeningPerspectiveProductionPromptV1, chatOpeningPerspectiveReviewSchemaV1, parseChatOpeningPerspectiveReviewV1} from '../../src/lib/character-interaction/opening-perspectives'
import {chatOpeningBackgroundProductionPromptV2} from '../../src/lib/character-interaction/opening-continuation'
import {chatOpeningRelationalReviewSchemaV1} from '../../src/lib/character-interaction/opening-review-relations'
import {createChatOpeningReviewV1, assertChatOpeningReviewedV1} from '../../src/lib/character-interaction/situation-production-review'
import {chatOpeningDevelopmentReviewFixture, chatOpeningPerspectiveReviewFixture, chatOpeningProofReviewFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it.each(['direct', 'conversation', 'wait', 'self-reflection'] as const)('retains %s without a player/self-name blacklist or new narrative facts', async mode => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'mixed'})
  const option = f.candidates.options[0], actor = f.source.participants[0].participantKey
  if (mode === 'self-reflection') option.situation.possibilities[0].text = '角色回顾自己的顾虑，向在场的同伴说明自己的取舍。'
  const draft = chatOpeningDevelopmentReviewFixture(f.candidates)
  draft.options[0].development!.mode = mode === 'self-reflection' ? 'conversation' : mode
  if (mode === 'wait') draft.options[0].agency!.mode = 'wait'
  const wire = chatOpeningPerspectiveReviewFixture(f.source, f.candidates, draft)
  wire.perspectives[option.optionKey]['0'].addresseeKey = mode === 'self-reflection' ? actor : 'player'
  const before = structuredClone({source: f.source, candidates: f.candidates, wire})
  expect(new Ajv().compile(chatOpeningPerspectiveReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(parseChatOpeningPerspectiveReviewV1(wire, f.source, f.candidates)).toEqual(draft)
  expect({source: f.source, candidates: f.candidates, wire}).toEqual(before)
})

it.each(['player', 'unclear', 'other-actor'] as const)('rejects a proof whose explicit initiator is %s, without changing its verdict', async initiator => {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'mixed'})
  const wire = chatOpeningPerspectiveReviewFixture(f.source, f.candidates)
  Object.values(wire.perspectives)[0]['0'].initiatorKey = initiator === 'other-actor' ? f.source.participants[1].participantKey : initiator
  const before = structuredClone(wire)
  // Schema permits an honest mismatching interpretation; local report consistency must reject the positive proof.
  expect(new Ajv().compile(chatOpeningPerspectiveReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(() => parseChatOpeningPerspectiveReviewV1(wire, f.source, f.candidates)).toThrow('行动归属')
  expect(wire).toEqual(before)
})

it('keeps an explicit negative report, its exact evidence and the adoption rejection', async () => {
  const f = await seedChatNarrativeProductionFixture(), option = f.candidates.options[0]
  option.situation.possibilities[0].text = '玩家说明自己的参与意愿，帮助角色消除猜测。'
  const draft = chatOpeningDevelopmentReviewFixture(f.candidates, option.optionKey), reviewed = draft.options[0]
  reviewed.agency = null; reviewed.development = null
  for (const check of reviewed.checks) if (['role-motivation', 'viable-agency', 'open-development'].includes(check.check)) {
    check.passed = false; check.reason = '原文发起者是玩家，不能补写为角色邀请。'
    check.evidence = [{target: 'option', pointer: '/situation/possibilities/0/text', quote: option.situation.possibilities[0].text}]
  }
  const wire = chatOpeningPerspectiveReviewFixture(f.source, f.candidates, draft)
  wire.perspectives[option.optionKey]['0'].initiatorKey = 'player'
  expect(new Ajv().compile(chatOpeningPerspectiveReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  const parsed = parseChatOpeningPerspectiveReviewV1(wire, f.source, f.candidates)
  expect(parsed).toEqual(draft)
  const report = await createChatOpeningReviewV1(parsed, f.source, f.candidates, 3)
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, option.optionKey, 3)).rejects.toThrow('未通过')
  for (const change of ['pass', 'wrong-citation'] as const) {
    const bad = structuredClone(wire), check = bad.options[option.optionKey].checks['role-motivation']
    if (change === 'pass') check.passed = true
    else check.evidence = bad.options[option.optionKey].checks['seed-purpose'].evidence
    expect(() => parseChatOpeningPerspectiveReviewV1(bad, f.source, f.candidates)).toThrow('行动归属')
  }
})

it.each(['missing-option', 'missing-direction', 'extra-direction', 'unknown-actor', 'unknown-addressee', 'non-string-actor', 'empty-reason', 'long-reason', 'extra-field'] as const)('rejects %s even when the provider ignores its output schema', async kind => {
  const f = await seedChatNarrativeProductionFixture(), wire = chatOpeningPerspectiveReviewFixture(f.source, f.candidates)
  const key = f.candidates.options[0].optionKey, reading = wire.perspectives[key]['0']
  if (kind === 'missing-option') delete wire.perspectives[key]
  if (kind === 'missing-direction') delete wire.perspectives[key]['0']
  if (kind === 'extra-direction') wire.perspectives[key]['999'] = reading
  if (kind === 'unknown-actor') reading.initiatorKey = 'not-in-source'
  if (kind === 'unknown-addressee') reading.addresseeKey = 'not-in-source'
  if (kind === 'non-string-actor') Object.assign(reading, {initiatorKey: ['player']})
  if (kind === 'empty-reason') reading.reason = ''
  if (kind === 'long-reason') reading.reason = '甲'.repeat(301)
  if (kind === 'extra-field') Object.assign(reading, {automaticRepair: true})
  expect(() => parseChatOpeningPerspectiveReviewV1(wire, f.source, f.candidates)).toThrow('行动归属')
})

it('requires new readings only on the new wire and preserves the historical v14 contract', async () => {
  const f = await seedChatNarrativeProductionFixture(), old = chatOpeningProofReviewFixture(f.source, f.candidates)
  const prior = JSON.stringify(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates))
  expect(new Ajv().compile(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates).schema)(old)).toBe(true)
  expect(new Ajv().compile(chatOpeningPerspectiveReviewSchemaV1(f.source, f.candidates).schema)(old)).toBe(false)
  expect(() => parseChatOpeningPerspectiveReviewV1(old, f.source, f.candidates)).toThrow('行动归属')
  expect(JSON.stringify(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates))).toBe(prior)
  expect(chatOpeningPerspectiveProductionPromptV1().endsWith(chatOpeningBackgroundProductionPromptV2())).toBe(true)
})
