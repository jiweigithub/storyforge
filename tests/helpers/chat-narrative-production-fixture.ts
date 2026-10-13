import { seedCurrentProductWorld } from './current-product-world'
import { createChatDraftV3, selectChatWorldV1, saveChatDraftV1, loadChatSourceProjectionV1, confirmChatSourceReviewV1 } from '../../src/lib/character-interaction/draft-service'
import { parseChatAuthoringSettings } from '../../src/lib/character-interaction/authoring-contract'
import { loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import { suggestProductStartingPoints, draftProductProductionBriefV3 } from '../../src/lib/product-production/consultation'
import { prepareChatNarrativeCompilerSourceV1 } from '../../src/lib/product-production/product-module-compilers'
import type { ChatNarrativeProductionSourceV1, ChatSituationCandidatesV1 } from '../../src/lib/character-interaction/narrative-production'

export async function seedChatNarrativeProductionFixture() {
  const world = await seedCurrentProductWorld('CHAT situation production')
  const {scope} = await createChatDraftV3('修钟铺的一天')
  const linked = await selectChatWorldV1(scope, 0, world.release.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!})
  const sourceKey = index.selectionOptions.characters.find(c => c.label === '林舟')!.resourceKey
  const draft = await saveChatDraftV1(scope, linked.revision, {...parseChatAuthoringSettings(JSON.parse(linked.settingsJson)),
    playerRole: '来店里借书的旅人沈禾，没有答应帮忙修理。', openingSituation: '雨天，修钟铺的一台旧钟停了。',
    characters: [{sourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0}]})
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  const confirmed = await confirmChatSourceReviewV1(scope, draft.revision, {
    projectionHash: projection.projectionHash,
    classifications: projection.characters.flatMap(c => c.fragments.map(f => ({
      projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey,
      purpose: f.pointer === '/background' ? 'motivation' : f.pointer === '/personality' ? 'voice' : 'identity',
      visibility: f.pointer === '/name' ? 'public' : ['/background','/personality'].includes(f.pointer) ? 'participants' : 'author-only',
      audienceKeys: ['/background','/personality'].includes(f.pointer) ? [c.resourceKey] : [],
    }))),
  })
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  if (settings.version !== 3) throw new Error('fixture version')
  const starting = await suggestProductStartingPoints({scope, worldReleaseId: confirmed.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope, worldReleaseId: confirmed.worldReleaseId!,
    suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', characterChat: settings,
    playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: confirmed.worldReleaseId!, selection: brief.source.selection})
  const projected = prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog})
  const source: ChatNarrativeProductionSourceV1 = {
    schema: 'storyforge.chat-narrative-production-source', version: 1, settings, source: projected.content,
    participants: projected.participantKeys.map((participantKey, i) => ({participantKey, characterKey: projected.characterKeys[i], name: projected.names[i], voiceRules: projected.voices[i] || '自然表达'})),
  }
  return {world, scope, confirmed, settings, brief, sourceCatalog, source, candidates: chatSituationCandidatesFixture(source)}
}

export function chatSituationCandidatesFixture(source: ChatNarrativeProductionSourceV1): ChatSituationCandidatesV1 {
  const actor = source.participants[0].participantKey
  const audienceKeys = ['player', actor]
  return {schema: 'storyforge.chat-situation-candidates', version: 1, options: ['缺失零件', '旧账本', '停摆的纪念钟'].map((title, i) => ({
    optionKey: `option-${i + 1}`, title, pitch: `从${title}展开，可以先喝茶也可以一起查看。`,
    situation: {situationKey: `situation-${i + 1}`, sceneKey: `scene-${i + 1}`, title, location: '修钟铺', timeLabel: '雨天下午',
      facts: [{factKey: 'clock', text: `${title}放在工作台上。`, audienceKeys, origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0}],
      goals: [{goalKey: 'repair', actorKey: actor, desire: `了解${title}`, concern: '不想打扰旅人', boundary: '不强求帮忙', evidenceFactKeys: ['clock'], status: 'active', updatedSequence: 0}],
      beliefs: [],
      threads: [{threadKey: 'repair-clock', title, question: `${title}应如何处理？`, audienceKeys, participantKeys: [actor], evidenceFactKeys: ['clock'], closureSignals: ['解决问题或决定暂缓'], status: 'open', updatedSequence: 0}],
      possibilities: [{actorKey: actor, text: '可以自己检查，也可以先停下来喝茶。', evidenceFactKeys: ['clock']}],
    },
  }))}
}
