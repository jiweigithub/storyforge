/** Pure external-request journal: replay never dispatches a provider or reads evidence storage. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenCallReservationV1, parseTtrpgOpenModelCallV1, updateTtrpgOpenEpochCallTotalsV1 } from './open-model-calls'
import * as p from './open-contract-parse'

export function applyTtrpgOpenModelCallEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.call.reserved', 'ttrpg.open.call.dispatched', 'ttrpg.open.call.finished'].includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun || !runtime.authorization) p.fail('模型调用事件需要已启动 open 团局')
  p.exact(p.object(payload, 'call event'), ['call', 'viewerKey', 'intent'], 'call event')
  const call = parseTtrpgOpenModelCallV1(payload.call)
  const coordination = runtime.openRun.coordination
  const epoch = coordination.epochs.find(epoch => epoch.epochKey === call.authorizationEpochKey)
  const seat = runtime.authorization.seats.find(seat => seat.viewerKey === payload.viewerKey)
  if (!epoch || epoch.status !== 'active' || coordination.activeEpochKey !== epoch.epochKey
    || call.createdRef.sessionKey !== runtime.sessionKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    || epoch.viewerKey !== seat.viewerKey || event.actorKey !== call.actorKey
    || !runtime.authorization.selectedActorKeys.includes(call.actorKey)) p.fail('模型调用不属于当前真人授权窗口')
  const ref = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  const previousIndex = coordination.calls.findIndex(previous => previous.requestKey === call.requestKey)
  if (event.type === 'ttrpg.open.call.reserved') {
    if (previousIndex !== -1 || call.status !== 'prepared' || stable(call.createdRef) !== stable(ref)) p.fail('请求预留身份或初始回执无效')
    assertTtrpgOpenCallReservationV1({ epoch, calls: coordination.calls, requestKey: call.requestKey,
      inputTokens: call.reservedInputTokens, outputTokens: call.reservedOutputTokens, maximumCostUsd: call.reservedCostUsd })
    coordination.calls.push(call)
  } else {
    const previous = coordination.calls[previousIndex]
    if (!previous) p.fail('派发/完成缺少真实请求预留')
    const { status: _s, dispatchRef: _d, terminalRef: _t, providerRequestId: _p,
      responseArtifactHash: _r, usage: _u, terminalReason: _reason, ...identity } = call
    const { status: _ps, dispatchRef: _pd, terminalRef: _pt, providerRequestId: _pp,
      responseArtifactHash: _pr, usage: _pu, terminalReason: _preason, ...previousIdentity } = previous
    if (stable(identity) !== stable(previousIdentity)) p.fail('请求生命周期不能更换契约、输入或预算')
    if (event.type === 'ttrpg.open.call.dispatched') {
      if (previous.status !== 'prepared' || call.status !== 'dispatched' || stable(call.dispatchRef) !== stable(ref)) p.fail('只能派发一次真实 prepared 请求')
    } else {
      if (!['prepared', 'dispatched'].includes(previous.status) || !['succeeded', 'failed', 'unknown'].includes(call.status)
        || stable(call.terminalRef) !== stable(ref) || stable(call.dispatchRef) !== stable(previous.dispatchRef)
        || (previous.providerRequestId !== null && previous.providerRequestId !== call.providerRequestId)) p.fail('终态必须闭合同一尚未完成的请求')
    }
    coordination.calls[previousIndex] = call
  }
  updateTtrpgOpenEpochCallTotalsV1(epoch, coordination.calls)
  state.ttrpg = runtime
  return true
}
