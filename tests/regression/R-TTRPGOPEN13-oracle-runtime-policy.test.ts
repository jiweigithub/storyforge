import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { readTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { consultTtrpgOracleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createTtrpgOpenOracleRuntimeReferencePolicyV1, assertTtrpgOpenOracleRuntimeReferenceJournalV1,
  parseTtrpgOpenOracleRuntimeReferencePolicyV1, verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1, createTtrpgOpenRuntimeEntityReferencesV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
import { hashProductProductionValueV2 as hash } from '../../src/lib/product-production/hash'

async function setup(audience: 'public' | 'party' | 'gm-only', pending = false) {
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content, npc = c.characterTemplates.find(row => row.characterKey === 'keeper')!, item = rule.items[0]
    c.gmMode = 'human'; rule.oracles[0].audience = 'public'
    rule.oracles.push({ ...structuredClone(rule.oracles[0]), oracleKey: 'oracle.reference.scope', audience })
    c.dynamicEntityTemplates[0].audience = audience === 'public' ? 'public' : 'party'
    c.dynamicEntityTemplates[1].audience = 'private'; c.dynamicEntityTemplates[1].knownByActorKeys = ['hero']
    npc.gmProfile!.secret = 'ORACLE-POLICY-PRIVATE-PROFILE'; npc.itemKeys = [item.key]
    npc.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: rule })
    c.entityBindings.find(row => row.bindingKey === 'keeper')!.initialInventoryRefs = ['keeper.initial.gear']
    c.entityBindings.push({ bindingKey: 'keeper.initial.gear', templateKey: item.key, kind: 'item', initialLocationRef: null,
      initialInventoryRefs: [], sourceResourceRef: null, sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
  }, 'viewer.gm')
  const desk = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
  const create = async (oracleSourceRef = s.input.oracleSourceRef, again = false) => {
    await proposeTtrpgOpenEntityDeskV1({ ...desk, submissionKey: again ? 'oracle.policy.second' : 'oracle.policy.first', oracleSourceRef,
      proposals: again ? [{ ...s.proposals[0], name: '稍后才出现的角色' }] : s.proposals.slice(0, 2) })
    if (pending) return
    const plan = (await readTtrpgOpenEntityDeskV1(desk))!.pending!
    for (const row of plan.approvals) await confirmTtrpgOpenEntityDeskV1({ ...desk, operationKey: plan.operationKey, planHash: plan.planHash,
      actorKey: row.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await materializeTtrpgOpenEntityDeskV1({ ...desk, operationKey: plan.operationKey, planHash: plan.planHash, decision: 'create-this-confirmed-plan' })
  }
  await create()
  if (!pending) await consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.policy.original.consultation'), viewerKey: 'viewer.gm', askedBy: 'gm',
    oracleKey: 'oracle.reference.scope', question: '依据现有对象解释本次关系，但不改变规则状态。' })
  const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
  const input = { content: s.input.content, operations: run.entityOperations ?? [], runtimeSourceHash: s.f.session.runtimeSourceHash,
    oracle: run.oracleReceipts!.at(-1)!, recipientActorKeys: state.ttrpg!.authorization!.selectedActorKeys,
    consumerRef: { sessionKey: state.ttrpg!.sessionKey, sequence: state.lastSequence + 1 } }
  return { ...s, state, create, input, assertion: { ...input, rulePackContentHash: s.input.content.rulePack.contentHash } }
}
describe('R-TTRPGOPEN13 versioned Oracle runtime scope foundation, not a model execution grant', () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it.each(['public', 'party', 'gm-only'] as const)('freezes only real %s Oracle identities without model calls, private prose or mutable mechanics', async audience => {
    const s = await setup(audience), before = await db.productRuntimeEvents.count()
    const policy = await createTtrpgOpenOracleRuntimeReferencePolicyV1(s.input)
    expect(policy.references.references).toHaveLength(audience === 'gm-only' ? 3 : 1)
    expect(policy.oracleSourceRef).toEqual(s.input.oracle.sourceRef)
    expect(policy.recipientActorKeys).toEqual(s.input.recipientActorKeys)
    expect(policy.references.references.every(row => row.sourceRef.sequence < s.input.consumerRef.sequence)).toBe(true)
    if (audience !== 'gm-only') {
      expect(policy.references.references.every(row => row.kind === 'actor')).toBe(true)
      const widened = { ...policy, references: await createTtrpgOpenRuntimeEntityReferencesV1(s.input) }
      expect(widened.references.references).toHaveLength(3)
      await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(widened)
      expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy: widened })).toThrow(/全部接收者权限/)
    }
    for (const forbidden of ['ORACLE-POLICY-PRIVATE-PROFILE', 'gmProfile', 'attributes', 'quantity', '新守灯人', '新候选地点']) expect(JSON.stringify(policy)).not.toContain(forbidden)
    await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(policy)
    expect(parseTtrpgOpenOracleRuntimeReferencePolicyV1(JSON.parse(JSON.stringify(policy)))).toEqual(policy)
    expect(assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy })).toEqual(policy)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(s.state); expect(await db.productRuntimeEvents.count()).toBe(before)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('requires the actual full recipient intersection and refuses pending or empty identity scopes', async () => {
    const s = await setup('party')
    await expect(createTtrpgOpenOracleRuntimeReferencePolicyV1({ ...s.input, recipientActorKeys: [...s.input.recipientActorKeys, 'late.unreceived.actor'] })).rejects.toThrow(/全部接收者权限/)
    const policy = await createTtrpgOpenOracleRuntimeReferencePolicyV1(s.input)
    expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy, recipientActorKeys: [] })).toThrow(/全部接收者权限/)
    await db.delete(); await db.open()
    const awaiting = await setup('public', true)
    await expect(createTtrpgOpenOracleRuntimeReferencePolicyV1(awaiting.input)).rejects.toThrow(/全部接收者权限/)
    expect(await readProductRuntimeState(awaiting.f.sessionId)).toEqual(awaiting.state)
  })
  it('rejects rehashed private widening, fabricated origins, different Oracle/purpose/version and future cuts', async () => {
    const s = await setup('gm-only'), original = await createTtrpgOpenOracleRuntimeReferencePolicyV1(s.input)
    const changed = structuredClone(original)
    changed.references.references[0].planHash = '0'.repeat(64)
    const { snapshotHash: _hash, ...body } = changed.references; changed.references.snapshotHash = await hash(body)
    await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(changed)
    expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy: changed })).toThrow(/全部接收者权限/)
    expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy: original, oracle: { ...s.input.oracle, audience: 'public' } })).toThrow(/全部接收者权限/)
    expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy: original, oracle: { ...s.input.oracle, sourceRef: { ...s.input.oracle.sourceRef, sequence: 1 } } })).toThrow(/全部接收者权限/)
    expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy: original, consumerRef: s.input.oracle.sourceRef })).toThrow(/全部接收者权限/)
    expect(() => parseTtrpgOpenOracleRuntimeReferencePolicyV1({ ...original, version: 2 })).toThrow()
    expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, policy: { ...original, recipientActorKeys: ['hero'] } })).toThrow(/全部接收者权限/)
    expect(() => parseTtrpgOpenOracleRuntimeReferencePolicyV1({ ...original, consumer: 'common-party' })).toThrow()
    expect(() => parseTtrpgOpenOracleRuntimeReferencePolicyV1({ ...original, schema: 'storyforge.ttrpg-open-situation-runtime-reference-policy' })).toThrow()
  })
  it('preserves the exact historical cut after a later real F13 without letting those later objects enter the old policy', async () => {
    const s = await setup('gm-only'), original = await createTtrpgOpenOracleRuntimeReferencePolicyV1(s.input)
    await s.create(s.input.oracle.sourceRef, true)
    const later = await readProductRuntimeState(s.f.sessionId), operations = later.ttrpg!.openRun!.entityOperations!
    expect(operations).toHaveLength(2)
    expect(assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, operations, policy: original })).toEqual(original)
    const newest = await createTtrpgOpenOracleRuntimeReferencePolicyV1({ ...s.input, operations, consumerRef: { ...s.input.consumerRef, sequence: later.lastSequence + 1 } })
    expect(newest.references.references).toHaveLength(5)
    expect(() => assertTtrpgOpenOracleRuntimeReferenceJournalV1({ ...s.assertion, operations, policy: newest })).toThrow(/全部接收者权限/)
  })
})
