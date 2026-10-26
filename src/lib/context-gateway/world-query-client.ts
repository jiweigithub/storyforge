import { CONTEXT_SOURCES } from '../registry/context-sources'
import type { OpenAuthorWorldQueryInputV1, WorldQueryAccessV1, WorldQueryProviderProtocolV1, WorldQueryV1 } from '../types/world-query'
import { worldQueryFailV1 } from './world-query-contract'

function protocol() {
  return CONTEXT_SOURCES.find(source => source.key === 'worldRelease')?.resources?.worldQuery
    ?? worldQueryFailV1('unsupported', '当前注册来源不支持叙事查询')
}

/** World author UI only. Product controllers obtain a narrowed capability
 * from their frozen plan; model tools can never call this factory. */
export const openAuthorWorldQueryAccessV1 = (input: OpenAuthorWorldQueryInputV1) => protocol().openAuthor(input)
export const openProductPreparationWorldQueryV1 = (input: Parameters<WorldQueryProviderProtocolV1['openPreparation']>[0]) => protocol().openPreparation(input)
export const openProductPlanWorldQueryV1 = (input: Parameters<WorldQueryProviderProtocolV1['openProduction']>[0]) => protocol().openProduction(input)
export const describeWorldQueryAccessV1 = (access: WorldQueryAccessV1) => protocol().describe(access)
export const bindWorldQueryResourcesV1 = (access: WorldQueryAccessV1, narrowing?: Parameters<WorldQueryProviderProtocolV1['bind']>[1]) => protocol().bind(access, narrowing)
export const queryWorldReleaseV1 = (access: WorldQueryAccessV1, query: WorldQueryV1) => protocol().query(access, query)
export const closeWorldQueryAccessV1 = (access: WorldQueryAccessV1) => protocol().close(access)

export function authorWorldQueryV1(access: WorldQueryAccessV1): WorldQueryV1 {
  return { schema: 'storyforge.world-query', version: 1, worldReference: access.reference, sourcePlanHash: access.sourcePlanHash,
    view: access.view, perspective: access.perspective, branch: { kind: 'canon', key: access.branchKey },
    mode: 'search', text: null, kinds: [], entityKeys: [], storyArcKeys: [], time: null, evidenceDepth: 'metadata',
    relationExpansion: { kinds: [], maxHops: 0, maxNodes: 500 }, causalDepth: 0,
    budget: { maxTokens: 100000, maxRecords: 50, maxEvidenceBytes: 4 * 1024 * 1024 }, cursor: null }
}
