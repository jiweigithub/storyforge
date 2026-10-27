import {beforeEach, afterEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatMediaConfirmationFixture, chatVisualDesignFixture} from '../helpers/chat-media-production-fixture'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import {DEFAULT_CHAT_VISUAL_INTENT_V2} from '../../src/lib/character-interaction/visual-intent'
import {createChatVisualContextV1, compileChatVisualDesignV1, createDesignedChatVisualRequirementsV1} from '../../src/lib/character-interaction/visual-design'
import {readProductProductionDetailsV1, confirmChatMediaDecisionV1, publishProductProductionV1} from '../../src/lib/product-production/service'
import {readCurrentChatMediaReviewV1} from '../../src/lib/product-production/chat-media-authority'
import {verifyDesignedChatRequirementsV1, verifyChatSystemConfigV1} from '../../src/lib/product-production/chat-media-tasks'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {db.close(); await db.delete()})

it('designs from public world and selected story while excluding hidden and future material', async () => {
  const content = chatNarrativeFixture()
  content.chatNarrative!.initialSituation.facts.push({factKey: 'rain', text: '雨夜的驿站窗外正在下雨。', audienceKeys: ['player'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  content.chatNarrative!.initialSituation.facts.push({factKey: 'secret', text: 'NEVER_REVEAL_HIDDEN_ROOM', audienceKeys: [], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  content.chatSource!.knowledge.push({key: 'era', content: '公开世界设定：没有电力的古代驿站。', audienceKeys: ['player'], source: {...content.chatSource!.knowledge[0].source}})
  const context = createChatVisualContextV1(content, DEFAULT_CHAT_VISUAL_INTENT_V2)
  expect(JSON.stringify(context)).toContain('雨夜')
  expect(JSON.stringify(context)).toContain('没有电力的古代驿站')
  expect(JSON.stringify(context)).not.toContain('NEVER_REVEAL_HIDDEN_ROOM')
  expect(context).not.toHaveProperty('goals'); expect(context).not.toHaveProperty('possibilities')
  const draft = chatVisualDesignFixture(context), design = await compileChatVisualDesignV1(draft, context, true)
  const requirements = createDesignedChatVisualRequirementsV1(design, context, 'chat.setting')
  expect(requirements.visual).toHaveLength(content.profiles.length + 1)
  expect(requirements.visual.at(-1)!.prompt).toContain('雨夜')
  await expect(compileChatVisualDesignV1({...draft, characters: draft.characters.slice(1)}, context, true)).rejects.toThrow('每位角色')
  await expect(compileChatVisualDesignV1({...draft, scene: {...draft.scene, evidenceKeys: ['secret']}}, context, true)).rejects.toThrow('未交付')
})

it('joins content, visual design, image confirmation and immutable release; restores design with its images', async () => {
  const f = await seedChatMediaConfirmationFixture(undefined, true)
  let details = await readProductProductionDetailsV1(f.scope, f.productionId)
  expect(f.injectedCalls).toBe(3)
  const designInput = f.textRequests.find(text => text.includes('美术设计师'))!
  expect(designInput).toContain('chat-visual-context')
  expect(designInput).not.toContain('仅作者掌握的私域结局')
  expect(designInput).not.toContain('CARD_CREATOR_METADATA_ONLY')
  const review = await readCurrentChatMediaReviewV1({scope: f.scope, build: details.build!})
  expect(review.source.interaction.chatVisualDesign?.characters).toHaveLength(1)
  const actor = review.source.interaction.profiles[0], scene = review.source.interaction.chatNarrative!.initialSituation
  const portrait = review.source.assets.find(asset => asset.kind === 'character-pose')!, background = review.source.assets.find(asset => asset.kind === 'background')!
  await confirmChatMediaDecisionV1({scope: f.scope, details, decision: {buildNumber: details.build!.buildNumber, controlEpoch: details.build!.controlEpoch, sourceHash: review.sourceHash,
    bindings: {schema: 'storyforge.chat-media', version: 1, participants: [{participantKey: actor.participantKey, avatarAssetKey: portrait.assetKey, portraitAssetKey: portrait.assetKey}],
      scenes: [{sceneKey: scene.sceneKey, location: scene.location, backgroundAssetKey: background.assetKey}]}}})
  await f.run()
  details = await readProductProductionDetailsV1(f.scope, f.productionId)
  expect(details.build!.status, details.build!.failureJson).toBe('release-ready')
  const rows = await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()
  const inputArtifacts = rows.filter(row => row.controlEpoch === details.build!.controlEpoch)
  const system = inputArtifacts.find(row => row.artifactKey === 'system.chat-config')!
  expect(JSON.parse(system.payloadJson).mediaSlots.characters).toHaveLength(1)
  expect(JSON.parse(system.payloadJson).mediaSlots).toMatchObject({characterPresentation: 'image-card', alphaRequired: false, preserveProviderPixels: true})
  const altered = JSON.parse(system.payloadJson); altered.permissions.maxActionsPerTrigger++
  await expect(verifyChatSystemConfigV1({inputArtifacts: inputArtifacts.map(row => row.id === system.id ? {...row, payloadJson: JSON.stringify(altered)} : row)}, review.source.interaction)).rejects.toThrow('系统配置')
  const requirements = inputArtifacts.find(row => row.artifactKey === 'media.requirements')!
  const changed = JSON.parse(requirements.payloadJson); changed.visual[0].prompt += 'UNAUTHORIZED_PROMPT'
  const brief = JSON.parse((await db.productProductionBriefs.where('productionId').equals(f.productionId).last())!.briefJson)
  await expect(verifyDesignedChatRequirementsV1({inputArtifacts: inputArtifacts.map(row => row.id === requirements.id ? {...row, payloadJson: JSON.stringify(changed)} : row)}, brief)).rejects.toThrow('不一致')
  const published = await publishProductProductionV1({scope: f.scope, productionId: f.productionId})
  const release = (await db.productReleases.get(published.receipt.productReleaseId))!
  const pkg = JSON.parse(release.manifestJson).runtimePackage
  expect(pkg.interaction.chatVisualDesign).toEqual(review.source.interaction.chatVisualDesign)
  expect(await db.worldReleases.bulkGet(JSON.parse(f.world).map((row: {id: number}) => row.id))).toEqual(JSON.parse(f.world))
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productReleases.where('projectId').equals(imported).first())!
  expect(restored.contentHash).toBe(release.contentHash)
  expect(JSON.parse(restored.manifestJson).runtimePackage.interaction.chatVisualDesign).toEqual(pkg.interaction.chatVisualDesign)
}, 60000)
