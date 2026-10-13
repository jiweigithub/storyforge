/** Pure operation journal: only frozen plans, authority decisions and real event references. */
import type { TtrpgMechanicalResultV1 } from './rule-action-mechanical'
import { parseTtrpgMechanicalResultV1 } from './rule-action-mechanical'
import { parseTtrpgOpenRulePlanV1, type TtrpgOpenRulePlanV1 } from './open-rule-plan'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_POST_OWNER_STEPS = ['pressure', 'situations', 'terminal', 'gates', 'narration', 'handoff'] as const
export type TtrpgOpenOperationStepKindV1 = 'rule' | 'mechanics' | 'effect' | 'time' | typeof TTRPG_OPEN_POST_OWNER_STEPS[number]
export interface TtrpgOpenOperationStepV1 { stepKey: string; kind: TtrpgOpenOperationStepKindV1; tickIndex: number | null }
export interface TtrpgOpenOperationApprovalV1 {
  actorKey: string; approverSeatKey: string; viewerKey: string; decision: 'approve' | 'reject'; sourceRef: TtrpgOpenSourceRefV1
}
export interface TtrpgOpenOperationReceiptV1 { stepKey: string; businessRef: TtrpgOpenSourceRefV1; completedRef: TtrpgOpenSourceRefV1 }
export interface TtrpgOpenOperationV1 {
  operationKey: string
  rootCommandId: string
  inputHash: string
  planHash: string
  riskHash: string
  authorizationEpochKey: string
  startedRef: TtrpgOpenSourceRefV1
  status: 'awaiting-approval' | 'executing' | 'rejected' | 'stale' | 'completed'
  plan: TtrpgOpenRulePlanV1
  plannedSteps: TtrpgOpenOperationStepV1[]
  approvals: TtrpgOpenOperationApprovalV1[]
  businessRefs: Array<{ stepKey: string; sourceRef: TtrpgOpenSourceRefV1 }>
  receipts: TtrpgOpenOperationReceiptV1[]
  completedRef: TtrpgOpenSourceRefV1 | null
  pendingChoice: { templateKey: string; selectedAlternativeKey: string | null; selectionRef: TtrpgOpenSourceRefV1 | null } | null
}
export interface TtrpgOpenRuleReceiptV1 {
  operationKey: string; sourceRef: TtrpgOpenSourceRefV1; frozenPlanHash: string; result: TtrpgMechanicalResultV1
}
export function ttrpgOpenOperationStepsV1(plan: TtrpgOpenRulePlanV1): TtrpgOpenOperationStepV1[] {
  return [
    { stepKey: 'rule', kind: 'rule', tickIndex: null },
    { stepKey: 'mechanics', kind: 'mechanics', tickIndex: null },
    ...(plan.effectTemplates.length ? [{ stepKey: 'effect', kind: 'effect' as const, tickIndex: null }] : []),
    ...Array.from({ length: plan.timeCostWorldTurns }, (_, index) => ({ stepKey: `time.${index + 1}`, kind: 'time' as const, tickIndex: index + 1 })),
    ...TTRPG_OPEN_POST_OWNER_STEPS.map(kind => ({ stepKey: kind, kind, tickIndex: null })),
  ]
}
export function parseTtrpgOpenOperationV1(value: unknown, sessionKey?: string): TtrpgOpenOperationV1 {
  const r = p.record(value, ['operationKey', 'rootCommandId', 'inputHash', 'planHash', 'riskHash', 'authorizationEpochKey',
    'startedRef', 'status', 'plan', 'plannedSteps', 'approvals', 'businessRefs', 'receipts', 'completedRef', 'pendingChoice'], 'operation')
  const plan = parseTtrpgOpenRulePlanV1(r.plan)
  const startedRef = parseTtrpgOpenSourceRefV1(r.startedRef)
  const status = p.oneOf(r.status, ['awaiting-approval', 'executing', 'rejected', 'stale', 'completed'], 'operation status')
  const completedRef = r.completedRef === null ? null : parseTtrpgOpenSourceRefV1(r.completedRef)
  const pendingChoice = r.pendingChoice === null ? null : (() => {
    const c = p.record(r.pendingChoice, ['templateKey', 'selectedAlternativeKey', 'selectionRef'], 'pending effect choice')
    const templateKey = p.key(c.templateKey, 'choice template')
    const template = plan.effectTemplates.find(template => template.planKey === templateKey)
    const selectedAlternativeKey = p.nullable(c.selectedAlternativeKey, p.key, 'selected alternative')
    const selectionRef = c.selectionRef === null ? null : parseTtrpgOpenSourceRefV1(c.selectionRef)
    if (!template?.alternatives.length || (selectedAlternativeKey === null) !== (selectionRef === null)
      || (selectedAlternativeKey !== null && !template.alternatives.some(alternative => alternative.alternativeKey === selectedAlternativeKey))) p.fail('待选后果不属于冻结选项')
    return { templateKey, selectedAlternativeKey, selectionRef }
  })()
  const plannedSteps = p.list(r.plannedSteps, 'plannedSteps', value => {
    const s = p.record(value, ['stepKey', 'kind', 'tickIndex'], 'planned step')
    return { stepKey: p.key(s.stepKey, 'stepKey'), kind: p.oneOf(s.kind, ['rule', 'mechanics', 'effect', 'time', ...TTRPG_OPEN_POST_OWNER_STEPS], 'step kind'),
      tickIndex: p.nullable(s.tickIndex, (v, l) => p.integer(v, l, 1, 10), 'tick index') }
  }, 4096, 1)
  if (JSON.stringify(plannedSteps) !== JSON.stringify(ttrpgOpenOperationStepsV1(plan))) p.fail('冻结操作步骤不一致')
  const approvals = p.list(r.approvals, 'approvals', value => {
    const a = p.record(value, ['actorKey', 'approverSeatKey', 'viewerKey', 'decision', 'sourceRef'], 'approval')
    return { actorKey: p.key(a.actorKey, 'approval actor'), approverSeatKey: p.key(a.approverSeatKey, 'approver seat'),
      viewerKey: p.key(a.viewerKey, 'viewerKey'), decision: p.oneOf(a.decision, ['approve', 'reject'], 'decision'), sourceRef: parseTtrpgOpenSourceRefV1(a.sourceRef) }
  }, 1000)
  const businessRefs = p.list(r.businessRefs, 'businessRefs', value => {
    const b = p.record(value, ['stepKey', 'sourceRef'], 'business ref')
    return { stepKey: p.key(b.stepKey, 'stepKey'), sourceRef: parseTtrpgOpenSourceRefV1(b.sourceRef) }
  }, 4096)
  const receipts = p.list(r.receipts, 'receipts', value => {
    const s = p.record(value, ['stepKey', 'businessRef', 'completedRef'], 'step receipt')
    return { stepKey: p.key(s.stepKey, 'stepKey'), businessRef: parseTtrpgOpenSourceRefV1(s.businessRef), completedRef: parseTtrpgOpenSourceRefV1(s.completedRef) }
  }, 4096)
  if (new Set(approvals.map(a => a.actorKey)).size !== approvals.length || new Set(businessRefs.map(b => b.stepKey)).size !== businessRefs.length
    || new Set(receipts.map(s => s.stepKey)).size !== receipts.length
    || (sessionKey !== undefined && startedRef.sessionKey !== sessionKey)
    || [...approvals.map(a => a.sourceRef), ...businessRefs.map(b => b.sourceRef), ...receipts.flatMap(s => [s.businessRef, s.completedRef]), ...(completedRef ? [completedRef] : []), ...(pendingChoice?.selectionRef ? [pendingChoice.selectionRef] : [])]
      .some(ref => ref.sessionKey !== startedRef.sessionKey || ref.sequence <= startedRef.sequence)
    || businessRefs.some(b => !plannedSteps.some(s => s.stepKey === b.stepKey))
    || receipts.some(s => !businessRefs.some(b => b.stepKey === s.stepKey && b.sourceRef.sequence === s.businessRef.sequence)
      || s.completedRef.sequence <= s.businessRef.sequence)
    || ((status === 'completed') !== (completedRef !== null))) p.fail('operation 回执/来源/终态不一致')
  if (receipts.some((receipt, index) => receipt.stepKey !== plannedSteps[index]?.stepKey)) p.fail('步骤回执必须按冻结顺序完成')
  if (businessRefs.some((business, index) => business.stepKey !== plannedSteps[index]?.stepKey
      || (index > 0 && business.sourceRef.sequence <= receipts[index - 1]?.completedRef.sequence))
    || businessRefs.length < receipts.length || businessRefs.length > receipts.length + 1
    || approvals.some(approval => !plan.requiredApprovals.some(required => required.actorKey === approval.actorKey && required.allowedSeatKeys.includes(approval.approverSeatKey)))
    || (['executing', 'completed'].includes(status) && !plan.requiredApprovals.every(required => approvals.some(approval => approval.actorKey === required.actorKey && approval.decision === 'approve')))
    || (status === 'rejected' && !approvals.some(approval => approval.decision === 'reject'))
    || (['awaiting-approval', 'rejected', 'stale'].includes(status) && (businessRefs.length > 0 || pendingChoice !== null))
    || (completedRef !== null && (receipts.length !== plannedSteps.length || completedRef.sequence <= receipts[receipts.length - 1]!.completedRef.sequence))) p.fail('操作状态与批准/有序业务证据不一致')
  return { operationKey: p.key(r.operationKey, 'operationKey'), rootCommandId: p.key(r.rootCommandId, 'rootCommandId'),
    inputHash: p.hash(r.inputHash, 'inputHash'), planHash: p.hash(r.planHash, 'planHash'), riskHash: p.hash(r.riskHash, 'riskHash'),
    authorizationEpochKey: p.key(r.authorizationEpochKey, 'epochKey'), startedRef, status, plan, plannedSteps,
    approvals, businessRefs, receipts, completedRef, pendingChoice }
}
export function parseTtrpgOpenRuleReceiptV1(value: unknown): TtrpgOpenRuleReceiptV1 {
  const r = p.record(value, ['operationKey', 'sourceRef', 'frozenPlanHash', 'result'], 'rule receipt')
  return { operationKey: p.key(r.operationKey, 'operationKey'), sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef),
    frozenPlanHash: p.hash(r.frozenPlanHash, 'frozenPlanHash'), result: parseTtrpgMechanicalResultV1(r.result) }
}
export function nextTtrpgOpenOperationStepV1(operation: TtrpgOpenOperationV1): TtrpgOpenOperationStepV1 | null {
  return operation.plannedSteps[operation.receipts.length] ?? null
}
