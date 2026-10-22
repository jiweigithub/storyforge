/** Author-owned pending-release intent, independent of runtime continuation authority. */
import type { TtrpgOpenAuthoringV1, TtrpgCampaignContentV2, TtrpgSituationTemplateV1, TtrpgPredicateV1 } from './open-contract'
import { parseTtrpgOpenAuthoringV1 } from './open-content-authoring'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
import type { ProductProductionBriefV3 } from '../types'

export const TTRPG_COMPATIBLE_OPENING_AUTHORED_TASKS_V1 = ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'] as const

export interface TtrpgCompatibleOpeningRevisionV1 {
  schema: 'storyforge.ttrpg-compatible-opening-revision'; version: 1
  baseReleaseHash: string; baseRuntimeSourceHash: string; baseContentHash: string
  appendedTemplateKeys: string[]
}
/** Closed author-only content plus the existing empty-media task has no text-provider task. */
export function isTtrpgCompatibleOpeningTextFreeProfileV1(brief: Partial<Pick<ProductProductionBriefV3, 'ttrpgOpen' | 'media'>>): boolean {
  const marker = brief.ttrpgOpen?.compatibleOpeningRevision, media = brief.media
  if (!marker || !media) return false
  try { parseTtrpgCompatibleOpeningRevisionV1(marker) } catch { return false }
  return media.imageCount === 0 && media.musicTrackCount === 0 && media.sfxCount === 0 && media.voiceLineCount === 0 && media.requiredMediaKinds.length === 0
}
export function parseTtrpgCompatibleOpeningRevisionV1(value: unknown): TtrpgCompatibleOpeningRevisionV1 {
  const r = p.record(value, ['schema', 'version', 'baseReleaseHash', 'baseRuntimeSourceHash', 'baseContentHash', 'appendedTemplateKeys'], 'compatible opening revision')
  const keys = p.keys(r.appendedTemplateKeys, 'new opening templates', 1000, 1); p.unique(keys, 'new opening templates')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-compatible-opening-revision', 'opening revision schema'),
    version: p.literal(r.version, 1, 'opening revision version'), baseReleaseHash: p.hash(r.baseReleaseHash, 'opening base release'),
    baseRuntimeSourceHash: p.hash(r.baseRuntimeSourceHash, 'opening base source'), baseContentHash: p.hash(r.baseContentHash, 'opening base content'), appendedTemplateKeys: keys }
}
/** Use the published definitions rather than assuming the old S2 proposal equals its adopted output. */
export function ttrpgCompatibleOpeningAuthoringBaseV1(campaign: TtrpgCampaignContentV2,
  factPolicy: TtrpgOpenAuthoringV1['factPolicy']): TtrpgOpenAuthoringV1 {
  return parseTtrpgOpenAuthoringV1({ factPolicy, situationTemplates: campaign.situationTemplates,
    openingSituationKeys: campaign.openingSituationKeys, effectPlanTemplates: campaign.effectPlanTemplates,
    pressure: { clocks: campaign.clocks, fronts: campaign.fronts }, companionPolicy: campaign.companionPolicy,
    stageClosurePolicy: campaign.stageClosurePolicy, dynamicEntityTemplates: campaign.dynamicEntityTemplates,
    runtimePolicy: campaign.runtimePolicy, ...(Object.prototype.hasOwnProperty.call(campaign, 'contextPolicy') ? { contextPolicy: campaign.contextPolicy } : {}) })
}
export function assertTtrpgCompatibleOpeningAuthoringV1(base: TtrpgOpenAuthoringV1, next: TtrpgOpenAuthoringV1): string[] {
  p.unique(next.situationTemplates.flatMap(t => t.evidence.map(e => e.clueRef)), 'new opening evidence')
  const byKey = new Map(next.situationTemplates.map(t => [t.templateKey, t]))
  if (base.situationTemplates.some(t => stable(t) !== stable(byKey.get(t.templateKey)))) p.fail('兼容开局必须保留已发布的全部原局势定义')
  const previous = new Set(base.situationTemplates.map(t => t.templateKey))
  const added = next.situationTemplates.filter(t => !previous.has(t.templateKey)).map(t => t.templateKey)
  if (!added.length || !next.openingSituationKeys.some(k => added.includes(k))) p.fail('请新增至少一个局势，并明确选为新版本开局')
  if (!base.stageClosurePolicy || !next.stageClosurePolicy
    || next.stageClosurePolicy.maximumWorldTurns > base.stageClosurePolicy.maximumWorldTurns) p.fail('兼容开局不得提高单局世界轮次上限')
  const allowed = new Set(['situationTemplates', 'openingSituationKeys', 'stageClosurePolicy'])
  const rest = (v: TtrpgOpenAuthoringV1) => Object.fromEntries(Object.entries(v).filter(([k]) => !allowed.has(k)))
  if (stable(rest(base)) !== stable(rest(next))) p.fail('兼容开局只允许追加局势、选择开局和修订阶段安排；原规则、压力、事实及运行边界须保留')
  return added
}

/** New local identities preserve the copied graph without colliding with published evidence. */
export function cloneTtrpgCompatibleOpeningTemplateV1(original: TtrpgSituationTemplateV1, templateKey: string, title: string): TtrpgSituationTemplateV1 {
  p.key(templateKey, 'new opening template'); p.text(title, 'new opening title', 300)
  if (templateKey === original.templateKey) p.fail('复制的新开局必须有独立身份')
  const obstacles = new Map(original.obstacles.map((o, i) => [o.obstacleKey, p.key(`${templateKey}.obstacle.${i + 1}`, 'new obstacle')]))
  const points = new Map(original.interventionPoints.map((o, i) => [o.pointKey, p.key(`${templateKey}.point.${i + 1}`, 'new point')]))
  const clues = new Map(original.evidence.map((o, i) => [o.clueRef, p.key(`${templateKey}.evidence.${i + 1}`, 'new evidence')]))
  const predicate = (value: TtrpgPredicateV1): TtrpgPredicateV1 => value.op === 'all' || value.op === 'any' ? { ...value, of: value.of.map(predicate) }
    : value.op === 'not' ? { ...value, of: predicate(value.of) }
      : value.op === 'evidence-known-by' ? { ...value, clueRef: clues.get(value.clueRef) ?? value.clueRef } : structuredClone(value)
  const next = structuredClone(original)
  return { ...next, templateKey, title, preconditions: next.preconditions.map(predicate),
    obstacles: next.obstacles.map(o => ({ ...o, obstacleKey: obstacles.get(o.obstacleKey)!, predicate: predicate(o.predicate), dependsOn: o.dependsOn.map(k => obstacles.get(k)!) })),
    interventionPoints: next.interventionPoints.map(o => ({ ...o, pointKey: points.get(o.pointKey)!, targetsObstacleKeys: o.targetsObstacleKeys.map(k => obstacles.get(k)!),
      requiresPredicate: o.requiresPredicate === null ? null : predicate(o.requiresPredicate) })),
    evidence: next.evidence.map(e => ({ ...e, clueRef: clues.get(e.clueRef)!, coversObstacleKeys: e.coversObstacleKeys.map(k => obstacles.get(k)!),
      discoveryPolicy: { ...e.discoveryPolicy, preconditions: e.discoveryPolicy.preconditions.map(predicate), paths: e.discoveryPolicy.paths.map(path => ({ ...path, interventionPointKey: points.get(path.interventionPointKey)! })) } })) }
}
