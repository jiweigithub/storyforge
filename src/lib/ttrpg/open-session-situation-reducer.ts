/** Explicit human disclosure commits a definition only. No admission, knowledge or mechanical change. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenSessionSituationReceiptV1 } from './open-session-situation-contract'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { parseTtrpgOpenSituationFrozenContentV1, admitTtrpgOpenSituationV1, ttrpgOpenSituationProjectionActorV1 } from './open-situation-runtime'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { assertTtrpgOpenSituationUsesCurrentFactsV1, validateTtrpgOpenSessionSituationReferencesV1 } from './open-content-references'
import { ttrpgOpenSessionFactsV1 } from './open-fact-ledger'
import * as p from './open-contract-parse'

export function applyTtrpgOpenSessionSituationEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type === 'ttrpg.open.situation.activated') {
    p.exact(payload, ['frozenContent', 'ownerReceiptHash', 'instanceKey', 'result', 'intent'], 'session situation admission')
    const intent = p.record(payload.intent, ['viewerKey', 'templateKey'], 'human session situation admission')
    const settled = settleTtrpgOpenSessionSituationAdmissionV1({ state, content: parseTtrpgOpenSituationFrozenContentV1(payload.frozenContent),
      viewerKey: p.key(intent.viewerKey, 'actual admission human'), templateKey: p.key(intent.templateKey, 'admitted session definition'),
      instanceKey: p.key(payload.instanceKey, 'actual admitted instance'), sequence: event.sequence })
    if (event.actorKey !== 'gm' || event.targetKey !== intent.templateKey || payload.ownerReceiptHash !== settled.receipt.receiptHash
      || stable(payload.result) !== stable(settled.result)) p.fail('会话局势准入不是原已采用定义及实际实例门结果')
    state.ttrpg = settled.runtime
    return true
  }
  if (event.type !== 'ttrpg.open.situation.accepted') return false
  p.exact(payload, ['receipt', 'frozenContent', 'intent'], 'session situation acceptance')
  const receipt = parseTtrpgOpenSessionSituationReceiptV1(payload.receipt), content = parseTtrpgOpenSituationFrozenContentV1(payload.frozenContent)
  const intent = p.record(payload.intent, ['viewerKey', 'requestKey', 'candidateHash', 'templateHash', 'disclosure'], 'human situation acceptance intent')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  const epoch = run?.coordination.epochs.find(e => e.epochKey === receipt.model.epochKey), seat = auth?.seats.find(s => s.viewerKey === intent.viewerKey)
  if (!runtime || !run || !auth || !epoch || epoch.status !== 'active' || epoch.epochKey !== run.coordination.activeEpochKey
    || run.stage.status !== 'open' || runtime.product.safety.status !== 'active' || auth.seats.some(s => !s.consent.sessionLoggingAllowed)
    || !seat || seat.role !== 'gm' || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || seat.seatKey !== receipt.disclosure.seatKey
    || seat.viewerKey !== receipt.disclosure.viewerKey || seat.viewerKey !== epoch.viewerKey || epoch.triggeredBySeatKey !== seat.seatKey
    || receipt.sourceRef.sessionKey !== runtime.sessionKey || receipt.sourceRef.sequence !== event.sequence
    || receipt.acceptedAtWorldTurn !== run.worldTime.worldTurn || receipt.disclosure.authorizationHash !== epoch.authorizationHash
    || intent.requestKey !== receipt.model.requestKey || intent.candidateHash !== receipt.model.candidateHash || intent.templateHash !== receipt.templateHash
    || intent.disclosure !== receipt.disclosure.scope || content.campaign.campaignKey !== runtime.product.campaignKey
    || content.rulePack.contentHash !== runtime.product.rulePackContentHash || event.actorKey !== 'gm' || event.targetKey !== receipt.template.templateKey
    || run.situationReceipts?.some(r => r.template.templateKey === receipt.template.templateKey || r.model.requestKey === receipt.model.requestKey)) {
    p.fail('局势采用必须来自原窗口真人 GM 对该精确候选的明确披露确认')
  }
  const receipts = [...(run.situationReceipts ?? []), receipt], catalog = ttrpgOpenSituationCatalogV1(content.campaign, { situationReceipts: receipts })
  assertTtrpgOpenSituationUsesCurrentFactsV1(receipt.template, ttrpgOpenSessionFactsV1(run.factLedger))
  validateTtrpgOpenSessionSituationReferencesV1({ campaign: content.campaign, rule: content.rulePack.content,
    sessionTemplates: catalog.sessionTemplates, sessionFacts: ttrpgOpenSessionFactsV1(run.factLedger) })
  run.situationReceipts = receipts
  state.ttrpg = parseTtrpgRuntimeStateV2(runtime)!
  return true
}

/** Standalone human control, after closing any paid window, with no pending business. */
export function settleTtrpgOpenSessionSituationAdmissionV1(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2;
  viewerKey: string; templateKey: string; instanceKey: string; sequence: number }) {
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  const seat = auth?.seats.find(s => s.viewerKey === input.viewerKey), receipt = run?.situationReceipts?.find(r => r.template.templateKey === input.templateKey)
  if (!runtime || !run || !auth || !receipt || !seat || seat.role !== 'gm' || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    || run.stage.status !== 'open' || runtime.product.safety.status !== 'active' || run.coordination.activeEpochKey !== null
    || run.coordination.calls.some(c => ['prepared', 'dispatched'].includes(c.status))
    || run.operations.some(o => ['awaiting-approval', 'executing'].includes(o.status))
    || runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))
    || input.content.campaign.campaignKey !== runtime.product.campaignKey || input.content.rulePack.contentHash !== runtime.product.rulePackContentHash) {
    p.fail('启用已采用局势需要真人 GM、已结束的请求窗口和无待结算业务的有效团局')
  }
  const settled = admitTtrpgOpenSituationV1({ ...input, actorKey: ttrpgOpenSituationProjectionActorV1(runtime, seat.actorKey),
    activationReason: 'session-generation', recordRejection: true })
  return { ...settled, receipt }
}
