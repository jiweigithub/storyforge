import {db} from '../db/schema'
import type {CharacterInteractionRuntimeState, WorkspaceScope} from '../types'
import {assertInstanceBinding} from '../product/runtime-instances'
import {readProductRuntimeState, readProductRuntimeStateVersion} from '../product/runtime-api'
import {verifyProductRuntimeSessionSourceV1} from '../product-production/preview-source'
import {hashCanonicalValue} from '../agent/run/hash'
import {interactionVisibilityView} from './runtime'
import {parseChatVisualDesignV1, type ChatVisualDesignV1} from './visual-design'

export interface ChatRuntimeVisualRequestV1 {
  key: string
  kind: 'background' | 'character-expression' | 'cg'
  frameKey: string
  participantKey: string | null
  sourceSequence: number
  prompt: string
  alt: string
}
export interface ChatRuntimeVisualContextV1 {
  schema: 'storyforge.chat-runtime-visual-context'; version: 1
  releaseHash: string; stateHash: string; sequence: number
  frameKey: string; maximumImages: number; requests: ChatRuntimeVisualRequestV1[]
}

/** Presentation is downstream of committed facts. A line of dialogue can
 * inform expression, but its claims never become an illustrated event. */
export async function planChatRuntimeVisualsV1(design: ChatVisualDesignV1, state: CharacterInteractionRuntimeState) {
  parseChatVisualDesignV1(design)
  const view = interactionVisibilityView(state, 'player'), scene = view.activeScene, story = view.chatNarrative
  if (!scene || scene.status !== 'active' || !story || !design.runtime.enabled) return {frameKey: '', requests: []}
  // A reviewed situation can settle the result of an actor's observation or
  // introduce the current scene. Heard claims and uncommitted plans are excluded.
  const observedFacts = new Map(state.chatNarrative?.factEvidence?.records.filter(record => record.kind === 'observation'
    && (record.source === 'action' || record.source === 'situation')).map(record => [record.factKey, record]) ?? [])
  const sceneChanges = story.facts.filter(fact => fact.sourceEventSequence >= scene.startedAtSequence && observedFacts.has(fact.factKey))
  const frameKey = await hashCanonicalValue({sceneKey: scene.sceneKey, location: scene.location, timeLabel: scene.timeLabel, situationKey: story.situationKey,
    confirmedChanges: sceneChanges.map(fact => ({key: fact.factKey, text: fact.text}))})
  const requests: ChatRuntimeVisualRequestV1[] = []
  const add = async (request: Omit<ChatRuntimeVisualRequestV1, 'key'>) => {
    if (request.prompt.length > 8000) throw new Error('当前画面所需资料超过图片输入预算；可继续聊天，未调用图片服务')
    requests.push({...request, key: await hashCanonicalValue(request.kind === 'background' ? {kind: request.kind, frameKey} : request)})
  }
  const samePlace = scene.sceneKey === design.scene.sceneKey && scene.location === design.scene.location
  const references = story.facts.filter(fact => fact.origin === 'reviewed-world' || samePlace && fact.sourceEventSequence === 0)
  const environment = `地点：${scene.location}\n时间：${scene.timeLabel}\n画风：${design.style}\n${samePlace ? `同一地点的布局与视觉锚点（天气与时间以当前事实为准）：${design.scene.depiction}` : ''}\n已确认的初始背景资料（新状态以本次事实为准）：${references.map(fact => fact.text).join('\n')}\n当前场景中已提交的可见观察（按发生顺序，较新状态优先）：${sceneChanges.map(fact => fact.text).join('\n')}`
  if (!samePlace || scene.timeLabel !== design.scene.timeLabel || sceneChanges.length) {
    await add({kind: 'background', frameKey, participantKey: null, sourceSequence: state.chatNarrative!.lastEventSequence,
      prompt: `${environment}\n只表现当前环境、天气、光线与物件；不画人物、不加文字，不预演未来。`,
      alt: `${scene.location} · ${scene.timeLabel}`})
  }
  const message = view.messages.filter(message => message.role === 'character' && message.eventSequence >= scene.startedAtSequence
    && scene.activeParticipantKeys.includes(message.speakerKey)).slice(-1)[0]
  const character = message && design.characters.find(character => character.participantKey === message.speakerKey)
  if (message && character) {
    await add({kind: 'character-expression', frameKey, participantKey: character.participantKey, sourceSequence: message.eventSequence,
      prompt: `这是单人表情立绘，不是剧情插图。正面中性站姿，只调整面部表情，双手自然空置。\n画风：${design.style}\n同一人物：${character.name}\n外貌锚点：${character.appearance}\n服装锚点：${character.costume}\n情绪参考（含对白与旁白，仅取情绪，不绘制其中动作、物件或场所）：${JSON.stringify(message.text)}\n最终画面只保留同一人物的完整衣着立绘。不重演上述剧情，不增加道具、场景或其他人物，不改发色和服装。独立人物图片卡片，背景简洁自然，保留完整构图；无需透明背景、品红底、棋盘格或舞台抠图。`,
      alt: `${character.name} · 当前表情`})
  }
  const evidence = observedFacts
  const observations = story.facts.filter(fact => (fact.origin === 'runtime-consequence' || fact.origin === 'runtime-situation')
    && fact.sourceEventSequence >= scene.startedAtSequence && evidence.has(fact.factKey))
  // Branch restoration rebases committed ancestor events to zero/negative
  // sequences; those observations still describe the branch's current scene.
  const latest = observations.length ? Math.max(...observations.map(fact => fact.sourceEventSequence)) : null
  const current = observations.filter(fact => fact.sourceEventSequence === latest)
  if (latest !== null && current.length) {
    const actors = new Set(current.map(fact => evidence.get(fact.factKey)!.actorKey))
    const cast = design.characters.filter(character => actors.has(character.participantKey))
    await add({kind: 'cg', frameKey, participantKey: null, sourceSequence: latest,
      prompt: `${environment}\n已确认的角色造型：${cast.map(character => `${character.name}：${character.appearance}；${character.costume}`).join('\n')}\n只描绘本次已审查并提交的可见结果：${current.map(fact => fact.text).join('\n')}\n不扩写后果、不替玩家安排动作、不添加秘密或未来事件、不加文字。`,
      alt: `剧情画面：${current.map(fact => fact.text).join('；')}`})
  }
  return {frameKey, requests}
}

/** Registered source, scoped to this save and its exact frozen release. */
export async function readChatRuntimeVisualContextV1(scope: WorkspaceScope, sessionId: number): Promise<ChatRuntimeVisualContextV1> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'character-interaction' || session.status !== 'active') throw new Error('只有当前活动聊天存档可以更新画面')
  const frozen = await verifyProductRuntimeSessionSourceV1({scope, session})
  const design = frozen.runtimePackage.interaction?.chatVisualDesign
  if (!design?.runtime.enabled) throw new Error('此聊天版本没有启用随剧情配图')
  const version = await readProductRuntimeStateVersion(sessionId), state = await readProductRuntimeState(sessionId)
  if (!state.interaction || state.interaction.chatNarrative?.pendingEdit || state.interaction.chatNarrative?.pendingSituation) throw new Error('请先完成当前情境或历史修改')
  const frame = await planChatRuntimeVisualsV1(design, state.interaction)
  const current = await db.productRuntimeSessions.get(sessionId), after = await readProductRuntimeStateVersion(sessionId)
  if (!current || current.status !== 'active' || current.runtimeSourceHash !== frozen.runtimeSourceHash || after.stateHash !== version.stateHash) throw new Error('聊天情境已变化，本次未发起图片请求')
  return {schema: 'storyforge.chat-runtime-visual-context', version: 1, releaseHash: frozen.runtimeSourceHash,
    stateHash: version.stateHash, sequence: version.sequence, ...frame, maximumImages: design.runtime.maximumImages}
}
