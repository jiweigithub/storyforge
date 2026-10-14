/** Persisted request lifecycle. Only a dispatched call may have an unknown external result. */
import type { TtrpgOpenEpochV1, TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
export interface TtrpgOpenModelCallV1 {
  requestKey: string; authorizationEpochKey: string
  actorKey: string; admissionStateHash: string; visibilityHash: string; runtimeSourceHash: string
  skillId: string; runContractHash: string; inputManifestHash: string; requestHash: string
  stepId: string; attempt: number
  createdRef: TtrpgOpenSourceRefV1; dispatchRef: TtrpgOpenSourceRefV1 | null; terminalRef: TtrpgOpenSourceRefV1 | null
  status: 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'unknown'
  reservedInputTokens: number; reservedOutputTokens: number; reservedCostUsd: number
  providerRequestId: string | null; responseArtifactHash: string | null
  usage: { source: 'provider' | 'estimated' | 'unknown'; inputTokens: number | null; outputTokens: number | null; actualCostUsd: number | null } | null
  terminalReason: string | null
}
export function parseTtrpgOpenModelCallV1(value: unknown): TtrpgOpenModelCallV1 {
  const r = p.record(value, ['requestKey','authorizationEpochKey','actorKey','admissionStateHash','visibilityHash','runtimeSourceHash',
    'skillId','runContractHash','inputManifestHash','requestHash','stepId','attempt',
    'createdRef','dispatchRef','terminalRef','status','reservedInputTokens','reservedOutputTokens','reservedCostUsd',
    'providerRequestId','responseArtifactHash','usage','terminalReason'], 'model call')
  const createdRef = parseTtrpgOpenSourceRefV1(r.createdRef)
  const dispatchRef = r.dispatchRef === null ? null : parseTtrpgOpenSourceRefV1(r.dispatchRef)
  const terminalRef = r.terminalRef === null ? null : parseTtrpgOpenSourceRefV1(r.terminalRef)
  const status = p.oneOf(r.status, ['prepared','dispatched','succeeded','failed','unknown'], 'call status')
  const terminal = ['succeeded','failed','unknown'].includes(status)
  const responseArtifactHash = p.nullable(r.responseArtifactHash, p.hash, 'raw response artifact')
  const terminalReason = p.nullable(r.terminalReason, (v,l) => p.text(v,l,2000), 'terminal reason')
  const usage = r.usage === null ? null : (() => {
    const u = p.record(r.usage, ['source','inputTokens','outputTokens','actualCostUsd'], 'call usage')
    return { source: p.oneOf(u.source, ['provider','estimated','unknown'], 'usage source'),
      inputTokens: p.nullable(u.inputTokens, (v,l) => p.integer(v,l,0,Number.MAX_SAFE_INTEGER), 'input usage'),
      outputTokens: p.nullable(u.outputTokens, (v,l) => p.integer(v,l,0,Number.MAX_SAFE_INTEGER), 'output usage'),
      actualCostUsd: p.nullable(u.actualCostUsd, (v,l) => p.number(v,l,0,1_000_000), 'actual cost') }
  })()
  if (terminal !== (terminalRef !== null) || terminal !== (usage !== null) || terminal !== (terminalReason !== null)
    || (status === 'prepared' && dispatchRef !== null) || (['dispatched','succeeded','unknown'].includes(status) && dispatchRef === null)
    || (status === 'succeeded' && responseArtifactHash === null)
    || (!terminal && responseArtifactHash !== null)
    || (status === 'prepared' && r.providerRequestId !== null)
    || (status === 'failed' && dispatchRef === null && (terminalReason !== 'cancelled-before-dispatch'
      || usage?.inputTokens !== 0 || usage.outputTokens !== 0 || usage.actualCostUsd !== 0 || responseArtifactHash !== null))
    || [dispatchRef,terminalRef].some(ref => ref !== null && (ref.sessionKey !== createdRef.sessionKey || ref.sequence <= createdRef.sequence))
    || (dispatchRef && terminalRef && terminalRef.sequence <= dispatchRef.sequence)
    || (status === 'unknown' && (responseArtifactHash !== null || usage?.source !== 'unknown' || usage.inputTokens !== null || usage.outputTokens !== null || usage.actualCostUsd !== null))
    || (usage && usage.source !== 'unknown' && (usage.inputTokens === null || usage.outputTokens === null))) p.fail('模型调用的派发/终态/原始响应/用量证据不一致')
  return { requestKey: p.key(r.requestKey, 'requestKey'), authorizationEpochKey: p.key(r.authorizationEpochKey, 'call epoch'),
    actorKey: p.key(r.actorKey, 'call actor'), admissionStateHash: p.hash(r.admissionStateHash, 'call admission'),
    visibilityHash: p.hash(r.visibilityHash, 'call visibility'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'call source'),
    skillId: p.key(r.skillId, 'call Skill'), runContractHash: p.hash(r.runContractHash, 'run contract'), inputManifestHash: p.hash(r.inputManifestHash, 'input manifest'),
    requestHash: p.hash(r.requestHash, 'request hash'), stepId: p.key(r.stepId, 'step'), attempt: p.integer(r.attempt, 'attempt',1,4),
    createdRef, dispatchRef, terminalRef, status, reservedInputTokens: p.integer(r.reservedInputTokens, 'reserved input',0,1_000_000),
    reservedOutputTokens: p.integer(r.reservedOutputTokens, 'reserved output',1,100_000), reservedCostUsd: p.number(r.reservedCostUsd, 'reserved cost',0,1000),
    providerRequestId: p.nullable(r.providerRequestId, (v,l) => p.text(v,l,500), 'provider request ID'), responseArtifactHash, usage, terminalReason }
}

/** Ledger summaries are derived from actual call receipts, never accepted from a model. */
export function updateTtrpgOpenEpochCallTotalsV1(epoch: TtrpgOpenEpochV1, calls: readonly TtrpgOpenModelCallV1[]): void {
  const owned = calls.filter(call => call.authorizationEpochKey === epoch.epochKey)
  epoch.reservedCalls = owned.filter(call => call.status === 'prepared' || call.status === 'dispatched').length
  epoch.consumedTokens = owned.reduce((total, call) => total + (call.usage?.inputTokens ?? 0) + (call.usage?.outputTokens ?? 0), 0)
  epoch.actualCostUsd = owned.some(call => ['dispatched', 'succeeded', 'failed', 'unknown'].includes(call.status)
    && call.usage?.actualCostUsd == null) ? null : owned.reduce((total, call) => total + (call.usage?.actualCostUsd ?? 0), 0)
}
export function ttrpgOpenCallBudgetV1(epoch: TtrpgOpenEpochV1, calls: readonly TtrpgOpenModelCallV1[]) {
  const owned = calls.filter(call => call.authorizationEpochKey === epoch.epochKey)
  let tokens = 0, costUsd = 0
  for (const call of owned) {
    const uncertain = call.status === 'prepared' || call.status === 'dispatched' || call.status === 'unknown'
      || call.usage?.inputTokens === null || call.usage?.outputTokens === null
    tokens += uncertain ? call.reservedInputTokens + call.reservedOutputTokens : call.usage!.inputTokens! + call.usage!.outputTokens!
    costUsd += call.usage?.actualCostUsd ?? call.reservedCostUsd
  }
  return { countedRequests: owned.length, committedOrReservedTokens: tokens, committedOrReservedCostUsd: costUsd,
    blockedByUnknown: owned.some(call => call.status === 'unknown'), pending: owned.some(call => call.status === 'prepared' || call.status === 'dispatched') }
}
export function assertTtrpgOpenCallReservationV1(input: {
  epoch: TtrpgOpenEpochV1; calls: readonly TtrpgOpenModelCallV1[]; requestKey: string
  inputTokens: number; outputTokens: number; maximumCostUsd: number
}): void {
  const tokens = p.integer(input.inputTokens,'input tokens',0,1_000_000) + p.integer(input.outputTokens,'output tokens',1,100_000)
  const cost = p.number(input.maximumCostUsd,'maximum request cost',0,1000)
  const budget = ttrpgOpenCallBudgetV1(input.epoch,input.calls)
  if (input.epoch.status !== 'active' || input.calls.some(call => call.requestKey === input.requestKey)
    || budget.blockedByUnknown || budget.pending || budget.countedRequests >= input.epoch.budget.maximumCalls
    || budget.committedOrReservedTokens + tokens > input.epoch.budget.maximumTokens
    || budget.committedOrReservedCostUsd + cost > input.epoch.budget.maximumCostUsd) p.fail('模型请求缺少新授权/确定回执或剩余硬预算')
}
