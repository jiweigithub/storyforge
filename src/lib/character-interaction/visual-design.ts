import {canonicalProductProductionJsonV2, hashProductProductionValueV2} from '../product-production/hash'
import type {FrozenInteractionRuntimeV2} from '../types'
import type {ChatVisualIntentV2} from './visual-intent'

/** Content -> presentation handoff. Only player-visible, confirmed content
 * crosses this boundary. Private goals and possible future events never do. */
export interface ChatVisualContextV1 {
  schema: 'storyforge.chat-visual-context'; version: 1
  worldReleaseHash: string
  style: string
  characters: Array<{characterKey: string; participantKey: string; name: string; preference: string}>
  scene: {sceneKey: string; location: string; timeLabel: string; preference: string}
  facts: Array<{key: string; text: string}>
}
export interface ChatVisualDesignV1 {
  schema: 'storyforge.chat-visual-design'; version: 1
  contextHash: string
  style: string
  characters: Array<{characterKey: string; participantKey: string; name: string; appearance: string; costume: string; evidenceKeys: string[]}>
  scene: {sceneKey: string; location: string; timeLabel: string; depiction: string; evidenceKeys: string[]}
  runtime: {enabled: boolean; maximumImages: number}
}
export interface ChatVisualDesignDraftV1 {
  style: string
  characters: Array<{characterKey: string; appearance: string; costume: string; evidenceKeys: string[]}>
  scene: {depiction: string; evidenceKeys: string[]}
}
export const CHAT_DESIGNED_CHARACTER_CONSTRAINTS_V1 = ['单人完整衣着，中性站姿，不持道具，不加文字；独立人物图片卡片，简洁自然背景，无需透明或品红底']
function fail(message: string): never {throw new Error(`[chat-visual-design] ${message}`)}
function exact(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) fail('设计字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('设计文本为空或过长')
  return value
}
function evidence(value: unknown, keys?: Set<string>): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(key => typeof key !== 'string' || (keys && !keys.has(key))) || new Set(value).size !== value.length) fail('设计引用了未交付的资料')
  return value as string[]
}
export function createChatVisualContextV1(content: Pick<FrozenInteractionRuntimeV2, 'chatNarrative' | 'chatSource'> & {
  profiles: Array<{characterKey: string; participantKey: string; name: string}>
}, intent: ChatVisualIntentV2): ChatVisualContextV1 {
  const initial = content.chatNarrative?.initialSituation
  if (!initial || !content.chatSource) fail('缺少已确认世界、角色和选定情境')
  if (intent.characters.some(item => !content.profiles.some(profile => profile.characterKey === item.characterKey))) fail('外观补充对应的角色已变化')
  return {
    schema: 'storyforge.chat-visual-context', version: 1, worldReleaseHash: content.chatSource.worldReleaseHash,
    style: intent.style,
    characters: content.profiles.map(profile => ({characterKey: profile.characterKey, participantKey: profile.participantKey,
      name: profile.name, preference: intent.characters.find(item => item.characterKey === profile.characterKey)?.description ?? ''})),
    scene: {sceneKey: initial.sceneKey, location: initial.location, timeLabel: initial.timeLabel, preference: intent.openingBackground},
    facts: [...initial.facts.filter(fact => fact.audienceKeys.includes('player')).map(fact => ({key: fact.factKey, text: fact.text})),
      ...content.chatSource.knowledge.filter(item => item.audienceKeys.includes('player')).map(item => ({key: `source.${item.key}`, text: item.content}))],
  }
}
export function createDesignedChatVisualRequirementsV1(design: ChatVisualDesignV1, context: ChatVisualContextV1, openingBeatKey: string) {
  parseChatVisualDesignV1(design)
  const base = {sceneTag: design.scene.sceneKey, beatKey: openingBeatKey, palette: ['#112233', '#445566', '#ddeeff'] as [string, string, string]}
  const facts = (keys: string[]) => keys.map(key => context.facts.find(fact => fact.key === key)?.text ?? fail('图片设计依据缺失')).join('\n')
  const visual = design.characters.map((character, index) => ({...base,
    artifactKey: `media.visual.${String(index + 1).padStart(3, '0')}`, mediaKind: 'character-pose' as 'character-pose' | 'background',
    prompt: [`统一画风：${design.style}`, `人物：${character.name}`, `稳定外貌：${character.appearance}`, `服装：${character.costume}`,
      `已确认依据（保持明确外貌、时代和职业；不演出事件）：${facts(character.evidenceKeys)}`,
      `作者补充：${context.characters.find(item => item.characterKey === character.characterKey)?.preference ?? ''}`].join('\n'),
    altText: `${character.name}的角色立绘`, width: 768, height: 1024,
    characterAnchorRefs: [character.characterKey], hardConstraints: [...CHAT_DESIGNED_CHARACTER_CONSTRAINTS_V1],
  }))
  visual.push({...base, artifactKey: `media.visual.${String(visual.length + 1).padStart(3, '0')}`, mediaKind: 'background',
    prompt: [`统一画风：${design.style}`, `准确地点：${design.scene.location}`, `准确时间：${design.scene.timeLabel}`,
      design.scene.depiction, '只画环境，不画人物；保持当前天气、时间与时代，不预演未来事件', `已确认环境依据：${facts(design.scene.evidenceKeys)}`, `作者补充：${context.scene.preference}`].join('\n'),
    altText: `${design.scene.location} · ${design.scene.timeLabel}`, width: 1536, height: 1024, characterAnchorRefs: [],
    hardConstraints: [],
  })
  if (visual.some(item => item.prompt.length > 8000)) fail('画面设计超过单图输入预算，请精简设计后重新制作')
  return {schema: 'storyforge.product-media-requirements-artifact' as const, version: 2 as const, visual, audio: []}
}
export async function compileChatVisualDesignV1(value: unknown, context: ChatVisualContextV1, runtimeImages: boolean): Promise<ChatVisualDesignV1> {
  const row = exact(value, 'style,characters,scene'), keys = new Set(context.facts.map(fact => fact.key))
  if (!Array.isArray(row.characters) || row.characters.length !== context.characters.length) fail('须覆盖已确认的每位角色')
  const characters = row.characters.map(value => {
    const item = exact(value, 'characterKey,appearance,costume,evidenceKeys')
    const subject = context.characters.find(character => character.characterKey === item.characterKey)
    if (!subject) fail('不得新增或更换角色身份')
    return {characterKey: subject.characterKey, participantKey: subject.participantKey, name: subject.name,
      appearance: text(item.appearance), costume: text(item.costume), evidenceKeys: evidence(item.evidenceKeys, keys)}
  })
  if (new Set(characters.map(character => character.characterKey)).size !== characters.length) fail('角色设计重复')
  const scene = exact(row.scene, 'depiction,evidenceKeys')
  return {schema: 'storyforge.chat-visual-design', version: 1, contextHash: await hashProductProductionValueV2(context),
    style: text(row.style, 2000), characters,
    scene: {sceneKey: context.scene.sceneKey, location: context.scene.location, timeLabel: context.scene.timeLabel,
      depiction: text(scene.depiction), evidenceKeys: evidence(scene.evidenceKeys, keys)},
    runtime: {enabled: runtimeImages, maximumImages: 60}}
}
export function parseChatVisualDesignV1(value: unknown): ChatVisualDesignV1 {
  const row = exact(value, 'schema,version,contextHash,style,characters,scene,runtime')
  if (row.schema !== 'storyforge.chat-visual-design' || row.version !== 1 || typeof row.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.contextHash)) fail('设计版本或来源无效')
  text(row.style, 2000)
  if (!Array.isArray(row.characters) || !row.characters.length || row.characters.length > 8) fail('设计角色数量无效')
  for (const value of row.characters) {
    const item = exact(value, 'characterKey,participantKey,name,appearance,costume,evidenceKeys')
    for (const key of ['characterKey', 'participantKey', 'name', 'appearance', 'costume']) text(item[key])
    evidence(item.evidenceKeys)
  }
  if (new Set(row.characters.map(item => item.characterKey)).size !== row.characters.length || new Set(row.characters.map(item => item.participantKey)).size !== row.characters.length) fail('设计角色重复')
  const scene = exact(row.scene, 'sceneKey,location,timeLabel,depiction,evidenceKeys')
  for (const key of ['sceneKey', 'location', 'depiction']) text(scene[key])
  if (typeof scene.timeLabel !== 'string' || scene.timeLabel.length > 4000) fail('场景时间无效')
  evidence(scene.evidenceKeys)
  const runtime = exact(row.runtime, 'enabled,maximumImages')
  if (typeof runtime.enabled !== 'boolean' || runtime.maximumImages !== 60) fail('运行图片额度无效')
  return structuredClone(value) as ChatVisualDesignV1
}
export async function assertChatVisualDesignContextV1(design: ChatVisualDesignV1, context: ChatVisualContextV1, runtimeImages: boolean) {
  const expected = await compileChatVisualDesignV1({style: design.style,
    characters: design.characters.map(({characterKey, appearance, costume, evidenceKeys}) => ({characterKey, appearance, costume, evidenceKeys})),
    scene: {depiction: design.scene.depiction, evidenceKeys: design.scene.evidenceKeys}}, context, runtimeImages)
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(design)) fail('设计与当前内容、人物或运行权限不一致')
}
export const CHAT_VISUAL_DESIGN_PROMPT_V1 = `你是角色聊天作品的美术设计师。根据给定的冻结世界、已确认角色和已选情境设计同一作品的角色与场景。先理解公开身份、时代、职业和故事背景，再设计外貌、服装、配色和场景布局；不能让作者从零填写每张图的提示词。
事实是内容线已确定的依据，不能改动。角色身份、年龄等明确设定、地点、天气、时间、已发生事件必须保持；未指定的外貌与服装可作合理美术设计，但不添加人物身世、秘密、隐藏动机或未来事件，不替玩家安排动作。不要将人物说过的话当作已经发生的行动。
同一角色建立可重复使用的外貌和服装锚点；所有角色与场景使用统一风格。衣着须完整且符合职业和时代。角色采用中性站姿、无道具、无背景；背景只绘制环境，不加入人物。作者的 preference 是补充约束。evidenceKeys 仅引用提供的 facts 中实际支持设计的 key；没有相关事实可以为空，不编造引用。
只输出 JSON：{"style":"统一画风、配色与光线原则","characters":[{"characterKey":"原样人物键","appearance":"明确稳定的脸部、发型、体型和可见特征","costume":"完整服装、材质与色彩","evidenceKeys":[]}],"scene":{"depiction":"依据公开情境的地点、时代、天气、时间、空间和主要物件，不画人物","evidenceKeys":[]}}。须覆盖所有人物。` 
