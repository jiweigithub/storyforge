/** Actor-only read model. Raw responses, GM plans and other characters' private fields stay outside it. */
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { readProductRuntimeState, readProductRuntimeStateVersion, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationRowsCurrentV1 } from './open-authorization'
import { projectTtrpgOpenKnowledgeForViewerV1, hashTtrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { ttrpgOpenMechanicalStateHashV1, ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'

export async function loadTtrpgOpenPlayerContextV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  if (session.kind !== 'ttrpg') throw new Error('[ttrpg-open-context] Instance 不是跑团')
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  if (source.runtimeSourceHash !== session.runtimeSourceHash) throw new Error('[ttrpg-open-context] Instance 来源身份不一致')
  const content = source.runtimePackage.ttrpg
  if (!content || !isTtrpgRuntimeContentV2(content)) throw new Error('[ttrpg-open-context] 新角色读取器仅用于 open')
  const state = await readProductRuntimeState(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun || runtime.product.rulePackContentHash !== content.rulePack.contentHash
    || runtime.product.campaignKey !== content.campaign.campaignKey) throw new Error('[ttrpg-open-context] 团局没有有效冻结来源与授权')
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId)
  const authorization = assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: runtime.authorization, participants })
  const seat = authorization.seats.find(seat => seat.role === 'player' && seat.actorKey === input.actorKey)
  const actor = state.entities[input.actorKey]
  const template = content.campaign.characterTemplates.find(template => template.characterKey === input.actorKey)
  if (!seat || !actor || !template || !authorization.selectedActorKeys.includes(input.actorKey)) throw new Error('[ttrpg-open-context] 角色不是已确认活动玩家')
  if (!seat.consent.aiAdviceAllowed) throw new Error('[ttrpg-open-context] 该角色未授权 AI 读取与建议')
  const visible = (audience: string, knownBy: readonly string[]) => audience === 'public' || audience === 'party'
    || (audience === 'private' && knownBy.includes(input.actorKey))
  const visibleRef = (ref: string | null) => {
    if (ref === null || ref === input.actorKey) return true
    const binding = content.campaign.entityBindings.find(binding => binding.bindingKey === ref)
    return binding === undefined || visible(binding.audience, binding.knownByActorKeys)
  }
  const knowledge = projectTtrpgOpenKnowledgeForViewerV1({ entries: runtime.openRun.knowledge, authorization,
    viewerKey: seat.viewerKey, campaign: content.campaign })
  const fieldHashes = new Map<string, string>()
  for (const entry of runtime.openRun.knowledge.filter(entry => entry.audience !== 'gm-only'
    && (entry.audience === 'public' || entry.recipientActorKeys.includes(input.actorKey)))) {
    let hash = fieldHashes.get(entry.evidenceRef)
    if (!hash) { hash = await hashTtrpgOpenEvidenceFieldsV1(content.campaign, entry.evidenceRef); fieldHashes.set(entry.evidenceRef, hash) }
    if (hash !== entry.publicFieldsHash) throw new Error('[ttrpg-open-context] 已知字段与冻结知识回执 hash 不一致')
  }
  const mechanicalRules = projectTtrpgRulePackMechanicalCoreV1(content.rulePack.content)
  const ownedItems = Object.values(runtime.product.inventory.items).filter(item => item.ownerRef === input.actorKey && item.quantity > 0)
  const grantedActions = new Set([...template.actionKeys, ...ownedItems.filter(item => !item.stateTags.includes('broken'))
    .flatMap(item => mechanicalRules.items.find(definition => definition.key === item.definitionRef)?.grantedActionKeys ?? [])])
  const availableActions = new Set(ttrpgOpenPredicateContextV1(state, content).actors![input.actorKey].abilityKeys)
  const actionDefinitions = mechanicalRules.actions.filter(action => grantedActions.has(action.key))
  const genericChecks = content.rulePack.content.genericChecks.filter(check => ['public', 'party', `actor:${input.actorKey}`].includes(check.audience))
  const view = {
    schema: 'storyforge.ttrpg-open-player-context', version: 1,
    source: { campaignKey: content.campaign.campaignKey, rulePackContentHash: content.rulePack.contentHash,
      worldReleaseHash: content.campaign.sourceWorld.contentHash },
    authority: { actorKey: input.actorKey, controller: seat.controller, authorizationRevision: authorization.revision,
      safetyStatus: runtime.product.safety.status, stageStatus: runtime.openRun.stage.status, worldTurn: runtime.openRun.worldTime.worldTurn },
    self: { name: actor.name, locationKey: actor.locationKey,
      attributes: Object.fromEntries(Object.entries(actor.attributes).filter(([, value]) => typeof value === 'number')),
      conditions: structuredClone(runtime.product.conditions[input.actorKey] ?? []),
      playerProfile: structuredClone(template.playerProfile),
      characterSheet: structuredClone(runtime.product.characterCustomizations.find(row => row.characterKey === input.actorKey)?.characterSheet ?? template.characterSheet),
      abilityStates: Object.values(runtime.product.abilityStates).filter(ability => ability.actorInstanceId === input.actorKey).map(ability => structuredClone(ability)),
      inventory: Object.values(runtime.product.inventory.items).filter(item => item.ownerRef === input.actorKey).map(item => ({
        itemInstanceId: item.itemInstanceId, definitionRef: item.definitionRef, quantity: item.quantity, charges: item.charges,
        durability: item.durability, identification: item.identification, stateTags: [...item.stateTags] })) },
    // Initial observations remain labeled as release-time knowledge; do not replace them with hidden live NPC state.
    initialObservations: content.campaign.frozenWorldPredicateIndex.entries.filter(fact => visible(fact.audience, fact.knownByActorKeys)
      && visibleRef(fact.subjectRef) && visibleRef(fact.objectRef)
      && (!['located-at', 'owns'].includes(fact.predicateKey) || typeof fact.canonicalValue !== 'string' || visibleRef(fact.canonicalValue))).map(fact => ({
      subjectRef: fact.subjectRef, predicateKey: fact.predicateKey, objectRef: fact.objectRef, canonicalValue: fact.canonicalValue,
      authority: fact.authority, asOf: 'release' })),
    actorsHere: content.campaign.entityBindings.filter(binding => binding.kind === 'actor'
      && (binding.bindingKey === input.actorKey || visible(binding.audience, binding.knownByActorKeys))
      && state.entities[binding.bindingKey]?.locationKey === actor.locationKey).map(binding => ({
        actorKey: binding.bindingKey, name: state.entities[binding.bindingKey].name, role: state.entities[binding.bindingKey].kind })),
    knowledge,
    rules: {
      // Only the acting player's grants and explicitly visible checks. No GM outcome templates or hidden predicates.
      core: { rulePackContentHash: content.rulePack.contentHash, attributes: mechanicalRules.attributes,
        resources: mechanicalRules.resources, diceModels: mechanicalRules.diceModels,
        actionCatalog: actionDefinitions.map(action => ({ actionKey: action.key, name: action.name, target: action.target,
          available: availableActions.has(action.key) })),
        genericCheckCatalog: genericChecks.map(check => ({ checkKey: check.checkKey, title: check.title, targetKinds: check.targetKinds })) },
      actions: actionDefinitions.map(action => ({ actionKey: action.key, name: action.name, description: action.description,
        target: action.target, costResourceKey: action.costResourceKey, costAmount: action.costAmount, usage: action.usage,
        timeCostWorldTurns: content.rulePack.content.timePolicy.actionOverrides.find(override => override.actionKey === action.key)?.timeCostWorldTurns
          ?? content.rulePack.content.timePolicy.existingAction })),
      genericChecks: genericChecks.map(check => ({ checkKey: check.checkKey, title: check.title, targetKinds: check.targetKinds,
        actorAttributeKey: check.actorAttributeKey, diceModelKey: check.diceModelKey, difficulty: check.difficulty,
        resourceCosts: check.resourceCosts, timeCostWorldTurns: check.timeCostWorldTurns })),
    },
  }
  const visibilityHash = await hashProductProductionValueV2(view)
  const admissionStateHash = await ttrpgOpenMechanicalStateHashV1(state)
  const stateHash = await hashProductRuntimeStateV1(state)
  const after = await readProductRuntimeStateVersion(input.sessionId)
  if (after.sequence !== state.lastSequence || after.stateHash !== stateHash) throw new Error('[ttrpg-open-context] 读取期间运行状态已变化')
  assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization, participants: await readTtrpgSessionParticipantsV2(input.sessionId) })
  return { view, visibilityHash, admissionStateHash, readEvidence: { sequence: state.lastSequence, stateHash,
    runtimeSourceHash: session.runtimeSourceHash, sessionKey: runtime.sessionKey } }
}
