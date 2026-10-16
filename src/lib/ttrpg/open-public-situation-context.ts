/** Read-only common source basis. Not a model-call or an adoption authorization. */
import type { WorkspaceScope } from '../types'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { loadTtrpgOpenCommonProjectionV1 } from './open-player-context'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { createTtrpgOpenRuntimeResourceProviderV1, type TtrpgOpenResourceRowV1 } from './open-runtime-resource-provider'
import { TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1 } from './open-public-situation-request'
import { describeTtrpgOpenPublicPredicateScopeV1 } from './open-public-situation-predicates'
import { TTRPG_OPEN_SITUATION_OUTPUT_SCHEMA_V1 } from './open-generated-situation-output-schema'

export const TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1 = 'ttrpgOpenPublicSituationInput'

export async function loadTtrpgOpenPublicSituationContextV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }) {
  return (await loadPublicSituationReadModel(input)).context
}
async function loadPublicSituationReadModel(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }) {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-public-situation] 共同局势来源需要明确的共同视图')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const common = await loadTtrpgOpenCommonProjectionV1(input)
  const { content, state, stateHash, runtime, source, authorization } = loaded, run = runtime.openRun!
  if (common.readEvidence.sequence !== state.lastSequence || common.readEvidence.stateHash !== stateHash
    || common.readEvidence.runtimeSourceHash !== source.runtimeSourceHash
    || canonicalStringify(common.recipientActorKeys) !== canonicalStringify([...authorization.selectedActorKeys].sort())) {
    throw new TtrpgOpenReadConflictV1('共同局势资料读取期间来源或接收者已变化')
  }
  const recipients = common.recipientActorKeys, view = common.view
  const observations = new Set(view.initialObservations.map(canonicalStringify))
  const initial = content.campaign.frozenWorldPredicateIndex.entries.filter(fact => fact.audience === 'public' || fact.audience === 'party'
    || (fact.audience === 'private' && recipients.every(actor => fact.knownByActorKeys.includes(actor))))
    .filter(fact => observations.has(canonicalStringify({ subjectRef: fact.subjectRef, predicateKey: fact.predicateKey,
      objectRef: fact.objectRef, canonicalValue: fact.canonicalValue, authority: fact.authority, asOf: 'release' })))
    .map(fact => ({ factRef: fact.factKey, subjectRef: fact.subjectRef, predicateKey: fact.predicateKey,
      objectRef: fact.objectRef, canonicalValue: fact.canonicalValue, authority: fact.authority, asOf: 'release' as const,
      sourceResourceRefs: [...fact.sourceResourceRefs] }))
  const entries = [
    ...initial.map(value => ({ kind: 'release-observation' as const, reliability: 'release-time' as const, value })),
    ...view.knowledge.map(value => ({ kind: 'known-evidence' as const, reliability: value.reliability, value })),
    ...view.sessionFacts.map(value => ({ kind: 'confirmed-session-fact' as const, reliability: 'confirmed' as const, value })),
    ...view.pressureSignals.map(value => ({ kind: 'published-telegraph' as const, reliability: 'observed' as const, value })),
  ]
  const attributed = await Promise.all(entries.map(async entry => ({ sourceKey: `common.${await hashCanonicalValue(entry)}`, ...entry })))
  const clocks = run.clocks.filter(clock => clock.visibility === 'party' || clock.visibility === 'public').map(clock => ({
    clockKey: clock.clockKey, title: clock.title, value: clock.value, maximum: clock.maximum, completed: clock.completed,
  }))
  const frame = { schema: 'storyforge.ttrpg-open-public-situation-frame', version: 1,
    recipientActorKeys: recipients, stage: { ...run.stage }, worldTurn: run.worldTime.worldTurn, actors: view.actorsHere, clocks }
  // Explicitly separate currently supportable predicates from prose that merely records an old observation.
  // No mutable owner is sampled here: release-time positions, HP, inventory and relationships stay historical.
  const predicateScope = describeTtrpgOpenPublicPredicateScopeV1({
    worldTurn: run.worldTime.worldTurn, recipientActorKeys: recipients,
    invariantFacts: initial.filter(fact => fact.authority === 'invariant'),
    sessionFacts: view.sessionFacts,
    clocks,
    observedEvidenceRefs: [...new Set(view.knowledge.filter(entry => entry.reliability === 'observed').map(entry => entry.evidenceRef))] })
  const contract = { schema: 'storyforge.ttrpg-open-public-situation-source-contract', version: 1,
    sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1, consumer: 'public-situation-generator',
    noMechanicalMutation: true, noWorldWrite: true, noPlayerDecision: true, noImplicitSharing: true,
    outputJsonSchema: TTRPG_OPEN_SITUATION_OUTPUT_SCHEMA_V1,
    releaseObservationsAreNotCurrentState: true, hearsayAndBeliefAreNotObjectiveEvidence: true,
    ruleDefinitionsConferNoActorGrantOrAvailability: true, citationsOnlyFromDeliveredBodies: true,
    predicateScopeIsAnAllowlistNotTheWholeRuntime: true, sourceReadConfersNoAdoptionAuthorization: true }
  const requestPolicy = TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1
  const resources = [
    { suffix: 'public-situation-contract', title: '共同局势的来源与权威边界', mandatory: true, value: { ...contract, requestPolicy } },
    { suffix: 'public-situation-frame', title: '当前共同接收者与可见局面', mandatory: true, value: frame },
    { suffix: 'public-situation-predicates', title: '本次共同证据支持的条件', mandatory: true, value: predicateScope },
    { suffix: 'public-situation-rules', title: '共同可读规则定义（不授予角色行动权限）', mandatory: true,
      value: { schema: 'storyforge.ttrpg-open-public-situation-rules', version: 1, ...view.rules } },
    ...attributed.map(entry => ({ suffix: `public-situation-entry.${entry.sourceKey}`, title: `共同局势来源 · ${entry.kind}`, mandatory: false,
      value: { schema: 'storyforge.ttrpg-open-public-situation-entry', version: 1, entry } })),
  ]
  await loaded.assertCurrent()
  return { loaded, context: { resources, entries: attributed, frame, predicateScope, rules: view.rules,
    visibilityHash: await hashCanonicalValue(resources), authorizationRevision: common.authorizationRevision, readEvidence: common.readEvidence } }
}

export function createTtrpgOpenPublicSituationContextProviderV1() {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1,
    providerVersion: 'ttrpg-open-public-situation-provider-v1', normalizationVersion: 'ttrpg-open-public-situation-json-v1',
    kinds: ['fact', 'reference'], catalog: publicCatalog,
    assertAccess: async (scope, pinnedFingerprint) => {
      if ((await publicCatalog(scope)).fingerprint !== pinnedFingerprint) throw new TtrpgOpenReadConflictV1('共同资料的接收者、权限、来源或进度已变化')
    } })
}
async function publicCatalog(scope: FrozenResourceScopeV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || scope.runtimeActorKey !== 'gm') throw new Error('[ttrpg-public-situation] 共同来源需要准确团局作用域与共同视图')
  try {
    const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
    const { context, loaded } = await loadPublicSituationReadModel({ scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: 'gm' })
    const { immutable, source, runtime, state, stateHash } = loaded
    const fingerprint = await hashCanonicalValue({ scope, readEvidence: context.readEvidence,
      authorizationRevision: context.authorizationRevision, visibilityHash: context.visibilityHash })
    const policyHash = await hashCanonicalValue({ sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1,
      consumer: 'public-situation-generator', fullIsAtomic: true, originalRead: false, exactWholePartyIntersection: true })
    const refs: ContextResourceDescriptorV1['sourceRefs'] = [
      { table: immutable.table, recordId: immutable.recordId, field: immutable.field, revision: source.packageHash, contentHash: await sha256Text(immutable.raw!) },
      { table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId, field: 'runtimeHeadStateJson', revision: state.lastSequence, contentHash: stateHash }]
    const resources: TtrpgOpenResourceRowV1[] = await Promise.all(context.resources.map(async item => {
      const content = canonicalStringify(item.value), tokenCount = estimateTokens(content)
      const reliability = 'entry' in item.value ? item.value.entry.reliability : undefined
      const authority: ContextResourceDescriptorV1['authority'] = reliability === 'release-time' ? 'author-canon'
        : reliability === 'hearsay' || reliability === 'belief' ? 'derived-summary' : 'confirmed-evidence'
      const searchText = 'entry' in item.value ? canonicalStringify(item.value.entry.value) : item.title
      return { content, tokenCount, searchText, descriptor: { version: 1, resourceKey: `fact:ttrpg-open:${runtime.sessionKey}:gm:${item.suffix}`,
        sourceKey: TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1, kind: item.mandatory ? 'fact' : 'reference', title: item.title,
        shortSummary: searchText.slice(0, 240), authority, contentRevision: state.lastSequence, contentHash: await sha256Text(content),
        policyRevision: 1, policyHash, scope: { projectId: workspace.projectId, worldId: workspace.worldId, workId: workspace.workId,
          productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: 'gm' }, relations: [], sourceRefs: refs,
        tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: item.mandatory ? 'must-read' : 'normal' } }
    }))
    await loaded.assertCurrent()
    return { fingerprint, resources }
  } catch (error) {
    // Original proof failures can mention private definitions. None enter public provider errors.
    if (error instanceof TtrpgOpenReadConflictV1) throw new TtrpgOpenReadConflictV1('共同资料读取期间身份、来源或进度已变化')
    throw new Error('[ttrpg-public-situation] 当前共同资料不可读取，请检查本桌授权与来源')
  }
}
