/** One read-only resolver. Its combined view is never a frozen Campaign/RuntimePackage. */
import type { TtrpgCampaignContentV2 } from './open-contract'
import type { TtrpgOpenSessionSituationReceiptV1 } from './open-session-situation-contract'
import { ttrpgOpenSessionFactsV1, type TtrpgOpenFactLedgerV1 } from './open-fact-ledger'
import * as p from './open-contract-parse'

export interface TtrpgOpenSessionSituationRefV1 { templateKey: string; receiptHash: string }
export function parseTtrpgOpenSessionSituationRefsV1(value: unknown) {
  const refs = p.list(value, 'cycle accepted situation refs', (value) => {
    const r = p.record(value, ['templateKey', 'receiptHash'], 'accepted situation ref')
    return { templateKey: p.key(r.templateKey, 'accepted template identity'), receiptHash: p.hash(r.receiptHash, 'original accepted receipt') }
  }, 1000, 1)
  p.unique(refs.map(r => r.templateKey), 'cycle accepted situation refs')
  return refs
}
/** Include actual active/queued owners and their next-definition dependencies, not the whole catalog. */
export function ttrpgOpenSituationCatalogSnapshotV1(campaign: TtrpgCampaignContentV2, run: {
  situationReceipts?: readonly TtrpgOpenSessionSituationReceiptV1[];
  situations: { active: readonly { templateKey: string }[]; queued: readonly { templateKey: string }[] };
}): { sessionSituationRefs?: TtrpgOpenSessionSituationRefV1[] } {
  const catalog = ttrpgOpenSituationCatalogV1(campaign, run), keys = new Set([...run.situations.active, ...run.situations.queued].map(i => i.templateKey))
  for (const key of [...keys]) for (const consequence of catalog.byKey.get(key)?.consequences ?? []) {
    if (consequence.nextSituationTemplateKey) keys.add(consequence.nextSituationTemplateKey)
  }
  const refs = (run.situationReceipts ?? []).filter(r => keys.has(r.template.templateKey)).map(r => ({ templateKey: r.template.templateKey, receiptHash: r.receiptHash }))
  return refs.length ? { sessionSituationRefs: refs } : {}
}

export function ttrpgOpenSituationCatalogV1(campaign: TtrpgCampaignContentV2, run?: { situationReceipts?: readonly TtrpgOpenSessionSituationReceiptV1[]; factLedger?: TtrpgOpenFactLedgerV1 } | null) {
  const sessionTemplates = (run?.situationReceipts ?? []).map(r => r.template)
  const templates = [...campaign.situationTemplates, ...sessionTemplates]
  p.unique(templates.map(t => t.templateKey), 'frozen/session situation identity')
  p.unique(templates.flatMap(t => t.evidence.map(e => e.clueRef)), 'frozen/session evidence identity')
  const byKey = new Map(templates.map(t => [t.templateKey, t]))
  const evidence = new Map(templates.flatMap(template => template.evidence.map(item => [item.clueRef, { template, evidence: item }] as const)))
  return { templates, sessionTemplates, byKey, evidence,
    /** Ephemeral validation view only; keep campaign/source hashes bound to the original campaign. */
    validationView: { ...campaign, situationTemplates: templates,
      ...(run?.factLedger ? { sessionFactKeys: ttrpgOpenSessionFactsV1(run.factLedger).map(f => f.factKey) } : {}) } }
}
