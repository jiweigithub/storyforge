import { canonicalStringify } from '../agent/run/hash'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import type { ChatAuthoringSettingsV3 } from './authoring-contract'
import { parseChatAuthoringSettings } from './authoring-contract'
import { parseFrozenChatNarrativeV1 } from './narrative-contract'
import { parseFrozenChatSourceV1 } from './runtime'
import type { ChatSituationV1, FrozenChatNarrativeV1 } from '../types/chat-narrative'
import type { FrozenChatSourceProjectionV1 } from '../types/character-interaction'
import type { ProductRuntimePackageV1 } from '../types'

export interface ChatNarrativeProductionSourceV1 {
  schema: 'storyforge.chat-narrative-production-source'
  version: 1
  settings: ChatAuthoringSettingsV3
  source: FrozenChatSourceProjectionV1
  participants: Array<{participantKey: string; characterKey: string; name: string; voiceRules: string}>
}

export interface ChatSituationOptionV1 {
  optionKey: string
  title: string
  pitch: string
  /** The seed and author-confirmed provenance are added only at the selection boundary. */
  situation: Omit<ChatSituationV1, 'seed'>
}
export interface ChatSituationCandidatesV1 {
  schema: 'storyforge.chat-situation-candidates'
  version: 1
  options: ChatSituationOptionV1[]
}
export interface ChatSituationSelectionV1 {
  schema: 'storyforge.chat-situation-selection'
  version: 1
  candidatesHash: string
  sourceHash: string
  selectedOptionKey: string
  authorCommandId: string
}

function fail(message: string): never {throw new Error(`[chat-production] ${message}`)}
function record(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('情境生产字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('情境生产文本无效')
}
function key(value: unknown): asserts value is string {
  text(value, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail('情境候选标识无效')
}

export function validateChatNarrativeProductionSourceV1(value: ChatNarrativeProductionSourceV1): void {
  record(value, 'schema,version,settings,source,participants')
  if (value.schema !== 'storyforge.chat-narrative-production-source' || value.version !== 1) fail('情境来源类型无效')
  const settings = parseChatAuthoringSettings(value.settings)
  if (settings.version !== 3 || !settings.sourceReview || !settings.playerRole.trim() || !settings.openingSituation.trim()) fail('情境制作需要已确认资料、玩家虚构背景和开场种子')
  if (settings.sourceReview.projectionHash !== value.source.projectionHash) fail('情境来源确认已过期')
  if (!Array.isArray(value.participants) || !value.participants.length || value.participants.length > 8 || settings.mode === 'single' && value.participants.length !== 1) fail('情境参与角色与模式不符')
  const resourceKeys = value.participants.map(p => p.characterKey)
  if (new Set(resourceKeys).size !== resourceKeys.length
    || canonicalStringify([...resourceKeys].sort()) !== canonicalStringify(settings.characters.map(c => c.sourceKey).sort())) fail('情境参与者与作者选择不符')
  const participantKeys = value.participants.map(p => p.participantKey)
  if (participantKeys.includes('player') || new Set(participantKeys).size !== participantKeys.length) fail('情境角色身份重复')
  for (const p of value.participants) {record(p, 'participantKey,characterKey,name,voiceRules'); key(p.participantKey); text(p.name, 240); text(p.voiceRules, 8000)}
  parseFrozenChatSourceV1(value.source, participantKeys, resourceKeys)
}

function frozen(option: ChatSituationOptionV1, input: ChatNarrativeProductionSourceV1): FrozenChatNarrativeV1 {
  return {
    schema: 'storyforge.chat-narrative-content', version: 1, worldReleaseHash: input.source.worldReleaseHash,
    persona: {playerKey: 'player', name: input.settings.narrative.personaName, description: input.settings.playerRole, origin: 'product-private'},
    permissions: structuredClone(input.settings.narrative.permissions),
    initialSituation: {...structuredClone(option.situation), seed: {text: input.settings.openingSituation, origin: 'author-confirmed', sourceEventSequence: 0, sourceThreadKey: null}},
  }
}

/** Validates model drafts against the exact reviewed source, not an author-workspace summary. */
export function parseChatSituationCandidatesV1(value: unknown, input: ChatNarrativeProductionSourceV1): ChatSituationCandidatesV1 {
  validateChatNarrativeProductionSourceV1(input)
  const row = record(value, 'schema,version,options')
  if (row.schema !== 'storyforge.chat-situation-candidates' || row.version !== 1) fail('情境候选版本无效')
  if (!Array.isArray(row.options) || row.options.length !== input.settings.narrative.openingCount) fail('情境候选数量与作者设置不符')
  const seen = new Set<string>(), bodies = new Set<string>()
  for (const raw of row.options) {
    const item = record(raw, 'optionKey,title,pitch,situation')
    key(item.optionKey); text(item.title, 1000); text(item.pitch, 2000)
    if (seen.has(item.optionKey)) fail('情境候选身份重复')
    seen.add(item.optionKey)
    const situation = record(item.situation, 'situationKey,sceneKey,title,location,timeLabel,facts,goals,beliefs,threads,possibilities')
    const setup = input.settings.narrative
    if (setup.location && situation.location !== setup.location || setup.timeLabel && situation.timeLabel !== setup.timeLabel) fail('情境候选改写了指定时间或地点')
    const content = frozen(raw as ChatSituationOptionV1, input)
    parseFrozenChatNarrativeV1(content, {source: input.source, participantKeys: input.participants.map(p => p.participantKey),
      characterKeys: input.participants.map(p => p.characterKey), sceneKeys: [content.initialSituation.sceneKey]})
    if (input.participants.some(p => !content.initialSituation.goals.some(g => g.actorKey === p.participantKey))) fail('每位参与角色都需要自身目标')
    if (setup.permissions.mode === 'story' && !content.initialSituation.threads.length) fail('剧情模式需要可以推进或收束的未完成事项')
    const body = canonicalStringify({...situation, situationKey: '', sceneKey: '', title: ''})
    if (bodies.has(body)) fail('不同开场不能只替换标题和标识')
    bodies.add(body)
  }
  return structuredClone(value) as ChatSituationCandidatesV1
}

export async function selectChatNarrativeCandidateV1(input: {
  candidates: unknown; source: ChatNarrativeProductionSourceV1; selection: ChatSituationSelectionV1
}): Promise<FrozenChatNarrativeV1> {
  const candidates = parseChatSituationCandidatesV1(input.candidates, input.source)
  const row = record(input.selection, 'schema,version,candidatesHash,sourceHash,selectedOptionKey,authorCommandId')
  if (row.schema !== 'storyforge.chat-situation-selection' || row.version !== 1) fail('情境选择版本无效')
  key(row.selectedOptionKey); text(row.authorCommandId, 200)
  if (row.candidatesHash !== await hashProductProductionValueV2(candidates) || row.sourceHash !== await hashProductProductionValueV2(input.source)) fail('作者选择的情境或来源已变化，需要重新确认')
  const selected = candidates.options.find(option => option.optionKey === row.selectedOptionKey)
  if (!selected) fail('作者选定的情境不存在')
  return frozen(selected, input.source)
}

/** Public package navigation only. Hidden setup and future possibilities stay
 * in the interaction module and never become authored future dialogue. */
export function chatNarrativeShellV1(content: FrozenChatNarrativeV1): ProductRuntimePackageV1['narrative'] & {
  schema: 'storyforge.product-narrative-artifact'; version: 1
} {
  const situation = content.initialSituation
  const text = [situation.location, situation.timeLabel].filter(Boolean).join(' · ')
  return {
    schema: 'storyforge.product-narrative-artifact', version: 1,
    moduleKind: 'main', moduleTitle: situation.title, entryNodeKey: situation.sceneKey,
    nodes: [{key: situation.sceneKey, kind: 'entry', title: situation.title, summary: text,
      conditionJson: '{}', effectsJson: '[]', successorKeys: []}],
    beats: [{beatKey: 'chat.setting', nodeKey: situation.sceneKey, kind: 'narration', speakerKey: null, text, order: 0}],
    choices: [],
  }
}

export function isChatNarrativeShellV1(narrative: ProductRuntimePackageV1['narrative'], content: FrozenChatNarrativeV1): boolean {
  const {schema: _schema, version: _version, ...expected} = chatNarrativeShellV1(content)
  return canonicalProductProductionJsonV2(narrative) === canonicalProductProductionJsonV2(expected)
}

export function chatSituationProductionPromptV1(): string {
  return `你是角色聊天的初始情境编辑。只使用输入中经过作者确认的聊天来源。输出严格 JSON，不加 Markdown。
生成 settings.narrative.openingCount 个不同且符合 openingSituation 的初始局面；不是完整故事，不写未来分支、结局或玩家承诺。
每个局面包含：已发生的背景事实、每位角色自身的欲望/顾虑/边界、角色当前所信、未完成事项及可收束信号、若干可能方向。可能方向不是事实或必须发生的剧情。
尊重 settings.narrative.permissions 的模式、强度和事项数量；陪伴模式可以没有冲突，允许休息、拒绝和改道。玩家虚构身份来自 playerRole，不推断现实用户信息，不替玩家设定目标、心理、行动或台词。
使用 participants 中精确的 participantKey。player 是玩家。所有事实与事项必须明确 audienceKeys；未知或秘密不得扩大传播。每个 goal、belief、possibility 只属于该角色，证据必须是该角色可见的事实。
reviewed-world 事实只能逐字引用 source.knowledge 中 purpose 为 identity 或 knowledge 的内容，sourceKnowledgeKey 必须对应，不能扩大其 audienceKeys。motivation 与 voice 是性格/意图，不是假定发生的事实。新增初始背景用 author-private，sourceKnowledgeKey=null，等待作者选择后才生效。
所有 sourceEventSequence/updatedSequence=0；目标 status=active，事项 status=open。事实最多100条，事项不超过 maxActiveThreads。故事模式至少1个未完成事项，每位角色至少1个自身目标。不要输出 seed、Persona、权限或作者确认字段。
精确结构：{"schema":"storyforge.chat-situation-candidates","version":1,"options":[{"optionKey":"opening-1","title":"开场标题","pitch":"供作者比较的差异和体验方向","situation":{"situationKey":"situation-1","sceneKey":"scene-1","title":"场景标题","location":"地点","timeLabel":"时间","facts":[{"factKey":"fact-1","text":"已经成立的初始背景","audienceKeys":["player","participant.001"],"origin":"author-private","sourceKnowledgeKey":null,"sourceEventSequence":0}],"goals":[{"goalKey":"goal-1","actorKey":"participant.001","desire":"自身期望","concern":"顾虑","boundary":"不会做什么","evidenceFactKeys":["fact-1"],"status":"active","updatedSequence":0}],"beliefs":[{"beliefKey":"belief-1","actorKey":"participant.001","text":"当前看法，可以出错但不能当全知事实","evidenceFactKeys":["fact-1"],"updatedSequence":0}],"threads":[{"threadKey":"thread-1","title":"未完成事项","question":"可以被推进或放下的问题","audienceKeys":["player","participant.001"],"participantKeys":["participant.001"],"evidenceFactKeys":["fact-1"],"closureSignals":["可观察的收束信号"],"status":"open","updatedSequence":0}],"possibilities":[{"actorKey":"participant.001","text":"可能尝试的方向，可被拒绝","evidenceFactKeys":["fact-1"]}]}}]}。实际候选数量必须匹配设置，不能只换标题；地点和时间若有指定必须精确保留。`
}
