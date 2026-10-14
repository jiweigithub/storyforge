import {CHAT_OPENING_CHECKS, type ChatOpeningReviewDraftV1} from '../../src/lib/character-interaction/situation-production-review'
import { seedCurrentProductWorld } from './current-product-world'
import { createChatDraftV3, selectChatWorldV1, saveChatDraftV1, loadChatSourceProjectionV1, confirmChatSourceReviewV1, readChatDraftV1 } from '../../src/lib/character-interaction/draft-service'
import {generateChatConsultationV2, adoptChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import { parseChatAuthoringSettings } from '../../src/lib/character-interaction/authoring-contract'
import { loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import { suggestProductStartingPoints, draftProductProductionBriefV3 } from '../../src/lib/product-production/consultation'
import { prepareChatNarrativeCompilerSourceV1 } from '../../src/lib/product-production/product-module-compilers'
import type { ChatNarrativeProductionSourceV1, ChatSituationCandidatesV1 } from '../../src/lib/character-interaction/narrative-production'
import {chatProjectionResourcesV1} from '../../src/lib/character-interaction/source-projection'
import {createChatPrivateCharacterV1} from '../../src/lib/character-interaction/private-character'

export async function seedChatNarrativeProductionFixture(options: {mappedPlayer?: boolean; factDiscovery?: boolean; worldDiscovery?: boolean; privateCast?: 'only' | 'mixed'; consultation?: boolean} = {}) {
  const world = await seedCurrentProductWorld('CHAT situation production', options.worldDiscovery ? {characterDetails: {
    background: '红铜钥匙藏在修钟台下的木匣里。', shortDescription: '修钟台下有一只获准由店主检查的木匣。',
  }} : {})
  const {scope} = await createChatDraftV3('修钟铺的一天')
  const linked = await selectChatWorldV1(scope, 0, world.release.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!})
  const sourceKey = index.selectionOptions.characters.find(c => c.label === '林舟')!.resourceKey
  const base = parseChatAuthoringSettings(JSON.parse(linked.settingsJson))
  if (base.version !== 3) throw new Error('fixture version')
  const playerCharacterKey = index.selectionOptions.characters.find(c => c.label === '守潮人')!.resourceKey
  const draft = await saveChatDraftV1(scope, linked.revision, {...base,
    ...(options.privateCast ? {mode: options.privateCast === 'mixed' ? 'multi' : 'single', privateCharacters: [{...createChatPrivateCharacterV1(), name: '苏禾', identity: '本体验的修钟铺店主', background: '希望修好旧钟，愿意自己检查工具。', personality: '温和而有主见。', voice: '仅作者掌握的私域结局'}]} : {}),
    ...(options.mappedPlayer || options.factDiscovery || options.worldDiscovery ? {narrative: {...base.narrative, ...(options.mappedPlayer ? {playerCharacterKey, personaName: '守潮人'} : {}), ...(options.factDiscovery || options.worldDiscovery ? {permissions: {...base.narrative.permissions, allowActorSituationExpansion: true, maxDiscoveriesPerSituation: 2}} : {})}} : {}),
    playerRole: options.mappedPlayer ? '来到修钟铺的守潮人，没有答应帮忙修理。' : '来店里借书的旅人沈禾，没有答应帮忙修理。', openingSituation: '雨天，修钟铺的一台旧钟停了。',
    characters: options.privateCast === 'only' ? [] : [{sourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0}]})
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  let confirmed = await confirmChatSourceReviewV1(scope, draft.revision, {
    projectionHash: projection.projectionHash,
    classifications: chatProjectionResourcesV1(projection).flatMap(c => c.fragments.map(f => options.worldDiscovery && c.resourceKey === sourceKey && f.pointer === '/background' ? ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey, purpose: 'knowledge', visibility: 'discoverable', audienceKeys: [],
      discovery: {actorKeys: [sourceKey], condition: '店主实际打开并查看修钟台下木匣的内部；仅查看外观不足以发现。', prerequisiteFragmentKeys: [c.fragments.find(item => item.pointer === '/shortDescription')!.fragmentKey]},
    }) : options.worldDiscovery && c.resourceKey === sourceKey && f.pointer === '/shortDescription' ? ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey, purpose: 'knowledge', visibility: 'public', audienceKeys: [],
    }) : c.resourceKey === projection.playerCharacter?.resourceKey ? ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey,
      purpose: ['/name', '/identity'].includes(f.pointer) ? 'identity' : 'knowledge',
      visibility: ['/name', '/identity'].includes(f.pointer) ? 'public' : f.pointer === '/background' ? 'participants' : 'author-only',
      audienceKeys: f.pointer === '/background' ? ['player'] : [],
    }) : ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey,
      purpose: f.pointer === '/background' ? 'motivation' : f.pointer === '/personality' ? 'voice' : 'identity',
      visibility: f.pointer === '/name' ? 'public' : ['/background','/personality'].includes(f.pointer) ? 'participants' : 'author-only',
      audienceKeys: ['/background','/personality'].includes(f.pointer) ? [c.resourceKey] : [],
    }))),
  })
  if (options.consultation) {
    const fragment = projection.characters.find(c => c.origin === 'product-private')!.fragments.find(f => f.pointer === '/background')!
    const view = await generateChatConsultationV2({scope, request: {draftRevision: confirmed.revision, question: '让角色自己尝试，不要求旅人参与。', priorRunId: null,
      source: {draftRevision: confirmed.revision, projectionHash: projection.projectionHash, fragmentKeys: [fragment.fragmentKey]}},
      runAI: async () => JSON.stringify({answer: '只给作者的会谈备注 S2AUTHOR-ONLY-LINEAGE-NOTE', changes: [{field: 'openingSituation', value: '雨天旧钟停了，苏禾可以先自己检查，旅人可继续看书。',
        basis: 'proposal', reason: '保留角色自己的愿望和玩家选择', evidence: [{fragmentKey: fragment.fragmentKey, quote: '希望修好旧钟，愿意自己检查工具。'}]}]}),
    })
    await adoptChatConsultationV2({scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, fields: ['openingSituation']})
    confirmed = await readChatDraftV1(scope)
  }
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  if (settings.version !== 3) throw new Error('fixture version')
  const starting = await suggestProductStartingPoints({scope, worldReleaseId: confirmed.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope, worldReleaseId: confirmed.worldReleaseId!,
    suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', characterChat: settings,
    playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: confirmed.worldReleaseId!, selection: brief.source.selection, chatPrivateCharacters: settings.privateCharacters})
  const projected = prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog})
  const {privateCharacters: _privateCharacters, ...reviewedSettings} = settings
  const source: ChatNarrativeProductionSourceV1 = {
    schema: 'storyforge.chat-narrative-production-source', version: 1, settings: reviewedSettings, source: projected.content,
    participants: projected.participantKeys.map((participantKey, i) => ({participantKey, characterKey: projected.characterKeys[i], name: projected.names[i], voiceRules: projected.voices[i] || '自然表达'})),
  }
  return {world, scope, confirmed, settings, brief, sourceCatalog, source, candidates: chatSituationCandidatesFixture(source)}
}

export function chatSituationCandidatesFixture(source: ChatNarrativeProductionSourceV1): ChatSituationCandidatesV1 {
  const actor = source.participants[0].participantKey
  const audienceKeys = ['player', ...source.participants.map(p => p.participantKey)]
  const discoverySources = source.source.knowledge.filter(s => s.discovery || source.source.knowledge.some(t => t.discovery?.prerequisiteKnowledgeKeys.includes(s.key)))
  const factKeys = new Map(discoverySources.map((s, index) => [s.key, `world-discovery-${index}`]))
  return {schema: 'storyforge.chat-situation-candidates', version: 1, options: ['缺失零件', '旧账本', '停摆的纪念钟'].map((title, i) => ({
    optionKey: `option-${i + 1}`, title, pitch: `从${title}展开，可以先喝茶也可以一起查看。`,
    situation: {situationKey: `situation-${i + 1}`, sceneKey: `scene-${i + 1}`, title, location: '修钟铺', timeLabel: '雨天下午',
      facts: [{factKey: 'clock', text: `${title}放在工作台上。`, audienceKeys, origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0}, ...(source.settings.narrative.permissions.maxDiscoveriesPerSituation ? [
        {factKey: 'parcel', text: '工作台上的蓝色布包获准由店主自行打开查看。', audienceKeys, origin: 'author-private' as const, sourceKnowledgeKey: null, sourceEventSequence: 0},
        {factKey: 'hidden-note', text: '蓝色布包里存着一张未署名的清单。', audienceKeys: [], origin: 'author-private' as const, sourceKnowledgeKey: null, sourceEventSequence: 0,
          discovery: {sceneKey: `scene-${i + 1}`, actorKeys: [actor], condition: '店主实际打开并查看获准检查的蓝色布包内部；这不证明谁写了清单。', prerequisiteFactKeys: ['parcel']}},
      ] : []), ...discoverySources.map(s => ({factKey: factKeys.get(s.key)!, text: s.content, audienceKeys: s.audienceKeys,
        origin: 'reviewed-world' as const, sourceKnowledgeKey: s.key, sourceEventSequence: 0,
        ...(s.discovery ? {discovery: {sceneKey: `scene-${i + 1}`, actorKeys: [...s.discovery.actorKeys], condition: s.discovery.condition,
          prerequisiteFactKeys: s.discovery.prerequisiteKnowledgeKeys.map(key => factKeys.get(key)!)}} : {}),
      }))],
      goals: source.participants.map((p, index) => ({goalKey: index ? `repair-${index}` : 'repair', actorKey: p.participantKey, desire: `了解${title}`, concern: '不想打扰旅人', boundary: '不强求帮忙', evidenceFactKeys: ['clock'], status: 'active', updatedSequence: 0})),
      beliefs: [],
      threads: [{threadKey: 'repair-clock', title, question: `${title}应如何处理？`, audienceKeys, participantKeys: source.participants.map(p => p.participantKey), evidenceFactKeys: ['clock'], closureSignals: ['解决问题或决定暂缓'], status: 'open', updatedSequence: 0}],
      possibilities: [{actorKey: actor, text: '可以自己检查，也可以先停下来喝茶。', evidenceFactKeys: ['clock']}],
    },
  }))}
}

export function chatOpeningReviewFixture(candidates: ChatSituationCandidatesV1, rejectedOptionKey?: string): ChatOpeningReviewDraftV1 {
  return {options: candidates.options.map(option => ({optionKey: option.optionKey, checks: CHAT_OPENING_CHECKS.map(check => ({
    check, passed: option.optionKey !== rejectedOptionKey || check !== 'viable-agency', reason: '工程审查夹具，不是叙事质量验收。',
    evidence: [{target: 'option' as const, pointer: '/title', quote: option.title}],
  }))}))}
}
