import { parseTtrpgOpenModelCallV1, updateTtrpgOpenEpochCallTotalsV1, type TtrpgOpenModelCallV1 } from './open-model-calls'
/** Durable authority windows are independent of game time and event ordering. */
import type { TtrpgCampaignContentV2 } from './open-contract'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { hash, integer, key, list, number, record, text } from './open-contract-parse'

export interface TtrpgOpenSourceRefV1 { sessionKey: string; sequence: number }
export interface TtrpgOpenEpochBudgetV1 {
  maximumCalls: number
  maximumTokens: number
  maximumCostUsd: number
  maximumAiActions: number
}
export interface TtrpgOpenEpochV1 {
  epochKey: string
  startedRef: TtrpgOpenSourceRefV1
  closedRef: TtrpgOpenSourceRefV1 | null
  status: 'active' | 'closed'
  triggeredBySeatKey: string
  viewerKey: string
  triggerKind: 'submit-action' | 'continue-host'
  inputRevision: string
  sessionZeroRevision: number
  authorizationHash: string
  budget: TtrpgOpenEpochBudgetV1
  successfulActorKeys: string[]
  reservedCalls: number
  consumedTokens: number
  actualCostUsd: number | null
  stopReason: string | null
}
export interface TtrpgOpenCoordinationV1 {
  activeEpochKey: string | null
  epochs: TtrpgOpenEpochV1[]
  calls: TtrpgOpenModelCallV1[]
}

function fail(message: string): never { throw new Error(`[ttrpg-open-coordination] ${message}`) }
export function parseTtrpgOpenSourceRefV1(value: unknown): TtrpgOpenSourceRefV1 {
  const row = record(value, ['sessionKey', 'sequence'], 'sourceRef')
  return { sessionKey: key(row.sessionKey, 'sourceRef.sessionKey'),
    sequence: integer(row.sequence, 'sourceRef.sequence', 1, Number.MAX_SAFE_INTEGER) }
}
export function parseTtrpgOpenEpochBudgetV1(value: unknown): TtrpgOpenEpochBudgetV1 {
  const row = record(value, ['maximumCalls', 'maximumTokens', 'maximumCostUsd', 'maximumAiActions'], 'epoch budget')
  return {
    maximumCalls: integer(row.maximumCalls, 'maximumCalls', 0, 9),
    maximumTokens: integer(row.maximumTokens, 'maximumTokens', 0, 1_000_000),
    maximumCostUsd: number(row.maximumCostUsd, 'maximumCostUsd', 0, 1000),
    maximumAiActions: integer(row.maximumAiActions, 'maximumAiActions', 0, 5),
  }
}
export function frozenTtrpgOpenEpochBudgetV1(campaign: TtrpgCampaignContentV2): TtrpgOpenEpochBudgetV1 {
  const policy = campaign.runtimePolicy
  return parseTtrpgOpenEpochBudgetV1({ maximumCalls: policy.maximumCallsPerEpoch,
    maximumTokens: policy.maximumEpochTokens, maximumCostUsd: policy.maximumEpochCostUsd,
    maximumAiActions: policy.maxAiActions })
}
export function parseTtrpgOpenEpochV1(value: unknown): TtrpgOpenEpochV1 {
  const row = record(value, ['epochKey', 'startedRef', 'closedRef', 'status', 'triggeredBySeatKey',
    'viewerKey', 'triggerKind', 'inputRevision', 'sessionZeroRevision', 'authorizationHash', 'budget',
    'successfulActorKeys', 'reservedCalls', 'consumedTokens', 'actualCostUsd', 'stopReason'], 'epoch')
  if (row.status !== 'active' && row.status !== 'closed') fail('epoch.status 无效')
  if (row.triggerKind !== 'submit-action' && row.triggerKind !== 'continue-host') fail('epoch.triggerKind 无效')
  const startedRef = parseTtrpgOpenSourceRefV1(row.startedRef)
  const closedRef = row.closedRef === null ? null : parseTtrpgOpenSourceRefV1(row.closedRef)
  const stopReason = row.stopReason === null ? null : text(row.stopReason, 'stopReason', 2000)
  if ((row.status === 'active') !== (closedRef === null) || (row.status === 'active') !== (stopReason === null)) fail('epoch 终态回执不一致')
  if (closedRef && (closedRef.sessionKey !== startedRef.sessionKey || closedRef.sequence <= startedRef.sequence)) fail('epoch 关闭来源不属于当前 session 或不晚于开始')
  const budget = parseTtrpgOpenEpochBudgetV1(row.budget)
  const successfulActorKeys = list(row.successfulActorKeys, 'successfulActorKeys', v => key(v, 'successful actor'), 1000, 0)
  if (new Set(successfulActorKeys).size !== successfulActorKeys.length) fail('同 epoch 不能重复成功执行同一队友')
  const reservedCalls = integer(row.reservedCalls, 'reservedCalls', 0, budget.maximumCalls)
  const consumedTokens = integer(row.consumedTokens, 'consumedTokens', 0, Number.MAX_SAFE_INTEGER)
  const actualCostUsd = row.actualCostUsd === null ? null : number(row.actualCostUsd, 'actualCostUsd', 0, 1_000_000)
  return { epochKey: key(row.epochKey, 'epochKey'), startedRef, closedRef, status: row.status,
    triggeredBySeatKey: key(row.triggeredBySeatKey, 'triggeredBySeatKey'), viewerKey: key(row.viewerKey, 'viewerKey'),
    triggerKind: row.triggerKind, inputRevision: hash(row.inputRevision, 'inputRevision'),
    sessionZeroRevision: integer(row.sessionZeroRevision, 'sessionZeroRevision', 1, Number.MAX_SAFE_INTEGER),
    authorizationHash: hash(row.authorizationHash, 'authorizationHash'), budget, successfulActorKeys,
    reservedCalls, consumedTokens, actualCostUsd, stopReason }
}
export function parseTtrpgOpenCoordinationV1(value: unknown, sessionKey?: string): TtrpgOpenCoordinationV1 {
  const row = record(value, ['activeEpochKey', 'epochs', 'calls'], 'coordination')
  const activeEpochKey = row.activeEpochKey === null ? null : key(row.activeEpochKey, 'activeEpochKey')
  const epochs = list(row.epochs, 'epochs', parseTtrpgOpenEpochV1, 100_000, 0)
  const calls = list(row.calls, 'calls', parseTtrpgOpenModelCallV1, 100_000, 0)
  const epochsByKey = new Map(epochs.map(epoch => [epoch.epochKey, epoch]))
  const callsByEpoch = new Map<string, TtrpgOpenModelCallV1[]>()
  if (new Set(calls.map(call => call.requestKey)).size !== calls.length || calls.some(call => {
    const epoch = epochsByKey.get(call.authorizationEpochKey)
    const group = callsByEpoch.get(call.authorizationEpochKey) ?? []
    group.push(call); callsByEpoch.set(call.authorizationEpochKey, group)
    return !epoch || call.createdRef.sessionKey !== epoch.startedRef.sessionKey || call.createdRef.sequence <= epoch.startedRef.sequence
      || (epoch.status === 'closed' && (call.status === 'prepared' || call.status === 'dispatched'))
  })) fail('模型调用的 epoch/来源/终态不闭合')
  for (const epoch of epochs) {
    const totals = { ...epoch }
    const owned = callsByEpoch.get(epoch.epochKey) ?? []
    if (owned.length > epoch.budget.maximumCalls) fail('模型请求数超过冻结 epoch 上限')
    updateTtrpgOpenEpochCallTotalsV1(totals, owned)
    if (totals.reservedCalls !== epoch.reservedCalls || totals.consumedTokens !== epoch.consumedTokens || totals.actualCostUsd !== epoch.actualCostUsd) {
      fail('模型调用汇总必须由真实请求回执派生')
    }
  }
  const active = epochs.filter(epoch => epoch.status === 'active')
  if (new Set(epochs.map(epoch => epoch.epochKey)).size !== epochs.length
    || active.length > 1 || (active[0]?.epochKey ?? null) !== activeEpochKey
    || (sessionKey !== undefined && epochs.some(epoch => epoch.startedRef.sessionKey !== sessionKey))) fail('epoch 身份/活动指针/session 不一致')
  return { activeEpochKey, epochs, calls }
}

/** Keys are generated by the kernel; the hash path handles long portable keys. */
export async function ttrpgOpenScopedKeyV1(sessionKey: string, kind: string, parts: readonly string[]): Promise<string> {
  const session = key(sessionKey, 'sessionKey')
  const prefix = key(kind, 'kind')
  const candidate = [prefix, session, ...parts.map(part => key(part, 'key part'))].join('.')
  return candidate.length <= 200 ? candidate
    : `${prefix}.${await hashProductProductionValueV2({ sessionKey: session, kind: prefix, parts })}`
}

export function assertTtrpgOpenEpochAuthorityV1(input: {
  epoch: TtrpgOpenEpochV1
  authorization: TtrpgOpenAuthorizationV1
  authorizationHash: string
  viewerKey: string
}): void {
  if (input.epoch.status !== 'active' || input.epoch.viewerKey !== input.viewerKey
    || input.epoch.sessionZeroRevision !== input.authorization.revision
    || input.epoch.authorizationHash !== input.authorizationHash) fail('epoch 授权已变化或不属于当前 viewer')
}
