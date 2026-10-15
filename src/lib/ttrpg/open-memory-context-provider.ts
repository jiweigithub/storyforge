/** Model-only projections. The party narrator never inherits the human host's private authority. */
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { createTtrpgOpenRuntimeResourceProviderV1, type TtrpgOpenResourceRowV1 } from './open-runtime-resource-provider'
import { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import { loadTtrpgOpenKpContextV1 } from './open-kp-context'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'

export const TTRPG_OPEN_MEMORY_SOURCE_KEYS_V1 = { actor: 'ttrpgOpenMemory', 'party-narrator': 'ttrpgOpenPartyMemory' } as const
export type TtrpgOpenMemoryConsumerV1 = keyof typeof TTRPG_OPEN_MEMORY_SOURCE_KEYS_V1

export function createTtrpgOpenMemoryContextProviderV1(consumer: TtrpgOpenMemoryConsumerV1) {
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey: TTRPG_OPEN_MEMORY_SOURCE_KEYS_V1[consumer],
    providerVersion: 'ttrpg-open-memory-provider-v1', normalizationVersion: 'ttrpg-open-memory-json-v1',
    kinds: ['fact', 'reference'], catalog: scope => catalog(scope, consumer) })
}

async function catalog(scope: FrozenResourceScopeV1, consumer: TtrpgOpenMemoryConsumerV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || !scope.runtimeActorKey
    || consumer === 'actor' && scope.runtimeActorKey === 'gm' || consumer === 'party-narrator' && scope.runtimeActorKey !== 'gm') throw new Error('[ttrpg-memory] 记忆来源需要准确的活动角色与消费场景')
  const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ scope: workspace, sessionId: scope.productRuntimeSessionId,
    reader: consumer === 'actor' ? { kind: 'actor', actorKey: scope.runtimeActorKey } : { kind: 'party' } })
  const { runtime, state, stateHash, source, authorization, immutable } = loaded
  // Existing actor/KP sources share a read stamp. Retain it when recalling alongside those sources.
  // Stage recall is also valid outside a KP narration operation and has its own party-only stamp.
  const contextInput = { scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: scope.runtimeActorKey }
  const context = consumer === 'actor' ? await loadTtrpgOpenPlayerContextV1(contextInput)
    : runtime.openRun!.operations.some(o => o.status === 'executing' && nextTtrpgOpenOperationStepV1(o)?.kind === 'narration')
      ? await loadTtrpgOpenKpContextV1(contextInput) : undefined
  if (context && (context.readEvidence.sequence !== state.lastSequence || context.readEvidence.stateHash !== stateHash
    || context.readEvidence.runtimeSourceHash !== source.runtimeSourceHash)) throw new TtrpgOpenReadConflictV1('读取记忆与角色视图期间进度已变化')
  const fingerprint = context ? await hashCanonicalValue({ scope, runtimeSourceHash: source.runtimeSourceHash, stateHash, visibilityHash: context.visibilityHash })
    : await hashCanonicalValue({ scope, runtimeSourceHash: source.runtimeSourceHash, stateHash, consumer })
  const recipients = consumer === 'actor' ? [scope.runtimeActorKey] : authorization.selectedActorKeys
  // Filter before titles, search text, counts, hashes or cursors can expose hidden notes.
  const visible = loaded.entries.filter(({ receipt }) => receipt.draft.audience === 'public'
    || receipt.draft.audience !== 'gm-only' && recipients.every(key => receipt.recipientActorKeys.includes(key)))
  const sourceKey = TTRPG_OPEN_MEMORY_SOURCE_KEYS_V1[consumer]
  const values: Array<{ suffix: string; title: string; summary: string; searchText?: string; value: unknown;
    mandatory: boolean; refs: ContextResourceDescriptorV1['sourceRefs'] }> = [{ suffix: `memory-contract.${consumer}`,
    title: '记忆召回的视角与可靠性边界', summary: '保留原观察者和可靠性；记忆不授予知识或规则权威', mandatory: true, refs: [],
    value: { schema: 'storyforge.ttrpg-open-memory-context-contract', version: 1, consumer,
      preserveObserverAndReliability: true, noMechanicalAuthority: true, noKnowledgeGrant: true,
      onlyDeliveredMemoryMayBeUsed: true, partyRequiresAllCurrentRecipients: true } }]
  for (const { row, receipt } of visible) {
    values.push({ suffix: `memory.${await hashCanonicalValue({ revisionKey: row.revisionKey, sourceRef: receipt.sourceRef })}`,
      title: `冒险记忆 · ${row.reliability} · ${receipt.recordedAtWorldTurn}`,
      summary: row.summary.slice(0, 240), searchText: row.summary, mandatory: false,
      refs: [{ table: 'ttrpgNarrativeMemories', recordId: row.id!, field: 'summary', revision: row.derivedFromHash, contentHash: await sha256Text(row.summary) }],
      value: { schema: 'storyforge.ttrpg-open-memory-context', version: 1, revisionKey: row.revisionKey,
        summary: row.summary, observerKey: row.observerKey, reliability: row.reliability, audience: row.audience,
        knownBy: receipt.recipientActorKeys, sourceRef: receipt.sourceRef,
        fromEventSequence: row.fromEventSequence, toEventSequence: row.toEventSequence,
        recordedAtWorldTurn: receipt.recordedAtWorldTurn, historical: receipt.sourceRef.sessionKey !== runtime.sessionKey,
        origin: receipt.origin, noMechanicalAuthority: true, noKnowledgeGrant: true } })
  }
  const policyHash = await hashCanonicalValue({ sourceKey, consumer, fullIsAtomic: true, originalRead: false, version: 1 })
  const commonRefs: ContextResourceDescriptorV1['sourceRefs'] = [
    { table: immutable.table, recordId: immutable.recordId, field: immutable.field, revision: source.packageHash, contentHash: await sha256Text(immutable.raw!) },
    { table: 'productRuntimeSessions', recordId: scope.productRuntimeSessionId, field: 'runtimeHeadStateJson', revision: state.lastSequence, contentHash: stateHash }]
  const resources: TtrpgOpenResourceRowV1[] = await Promise.all(values.map(async item => {
    const text = canonicalStringify(item.value), contentHash = await sha256Text(text), tokenCount = estimateTokens(text)
    return { content: text, tokenCount, ...(item.searchText ? { searchText: item.searchText } : {}), descriptor: {
      version: 1, resourceKey: `fact:ttrpg-open:${runtime.sessionKey}:${scope.runtimeActorKey}:${item.suffix}`, sourceKey,
      kind: item.mandatory ? 'fact' : 'reference', title: item.title, shortSummary: item.summary,
      authority: item.mandatory ? 'confirmed-evidence' : 'derived-summary', contentRevision: state.lastSequence, contentHash,
      policyRevision: 1, policyHash, scope: { projectId: workspace.projectId, worldId: workspace.worldId, workId: workspace.workId,
        productRuntimeSessionId: scope.productRuntimeSessionId, runtimeActorKey: scope.runtimeActorKey }, relations: [],
      sourceRefs: [...commonRefs, ...item.refs], tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: item.mandatory ? 'must-read' : 'normal' } }
  }))
  await loaded.assertCurrent()
  return { fingerprint, resources }
}
