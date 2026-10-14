import {CHAT_OPENING_REVIEW_KEY, assertChatOpeningReviewedV1} from '../character-interaction/situation-production-review'
import type { ProductProductionBriefV3, ProductProductionRecordV1 } from '../types'
import type { ProductProductionTaskExecutionInputV1, ProductProductionTaskExecutionResultV1 } from './scheduler'
import { loadProductProductionWorldSourceCatalogV2 } from './world-source'
import { prepareChatNarrativeCompilerSourceV1 } from './product-module-compilers'
import {composeChatRoleVoiceRulesV1} from '../character-interaction/role-profile'
import { canonicalProductProductionJsonV2 } from './hash'
import {
  chatNarrativeShellV1, selectChatNarrativeCandidateV1, validateChatNarrativeProductionSourceV1, parseChatSituationCandidatesV1,
  type ChatNarrativeProductionSourceV1, type ChatSituationSelectionV1,
} from '../character-interaction/narrative-production'

function fail(message: string): never {throw new Error(`[chat-production] ${message}`)}
export function chatProductionArtifactPayloadV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts'>, key: string): unknown {
  const rows = input.inputArtifacts.filter(row => row.artifactKey === key)
  if (rows.length !== 1) fail(`缺少唯一情境生产依赖:${key}`)
  return JSON.parse(rows[0].payloadJson)
}
export function chatProductionSourceV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts'>): ChatNarrativeProductionSourceV1 {
  const source = chatProductionArtifactPayloadV1(input, 'design.game') as ChatNarrativeProductionSourceV1
  validateChatNarrativeProductionSourceV1(source)
  return source
}
async function reviewedSelection(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts' | 'task'>, selection: ChatSituationSelectionV1) {
  const source = chatProductionSourceV1(input), candidates = chatProductionArtifactPayloadV1(input, 'content.chat-candidates')
  if (input.task.inputArtifactKeys.includes(CHAT_OPENING_REVIEW_KEY)) await assertChatOpeningReviewedV1(
    chatProductionArtifactPayloadV1(input, CHAT_OPENING_REVIEW_KEY), source, parseChatSituationCandidatesV1(candidates, source), selection.selectedOptionKey)
  return selectChatNarrativeCandidateV1({source, candidates, selection})
}
export async function selectedChatProductionNarrativeV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts' | 'task'>) {
  return reviewedSelection(input, chatProductionArtifactPayloadV1(input, 'content.chat-selection') as ChatSituationSelectionV1)
}
/* Author-gated selections from old frozen plans remain readable. New plans
 * require the review dependency at selection, assembly and publication. */

export async function executeChatSituationDeterministicTaskV1(input: ProductProductionTaskExecutionInputV1, options: {
  production: ProductProductionRecordV1; brief: ProductProductionBriefV3
}): Promise<ProductProductionTaskExecutionResultV1> {
  const startedAt = performance.now()
  const settings = options.brief.characterChat
  if (options.brief.intent.productType !== 'character-interaction' || settings?.version !== 3) fail('情境制作需要聊天 v3 Brief')
  const artifacts: ProductProductionTaskExecutionResultV1['artifacts'] = []
  if (input.task.taskKey === 'content.design') {
    const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope: input.scope,
      worldReleaseId: options.brief.source.worldReleaseId, selection: options.brief.source.selection})
    const projected = prepareChatNarrativeCompilerSourceV1({brief: options.brief, sourceCatalog})
    const source: ChatNarrativeProductionSourceV1 = {
      schema: 'storyforge.chat-narrative-production-source', version: 1, settings,
      source: projected.content,
      participants: projected.participantKeys.map((participantKey, index) => ({
        participantKey, characterKey: projected.characterKeys[index], name: projected.names[index],
        voiceRules: projected.roleProfiles[index] ? composeChatRoleVoiceRulesV1(projected.voices[index], settings.characters.find(c => c.sourceKey === projected.characterKeys[index])?.voiceRules ?? '', projected.roleProfiles[index])
          : [projected.voices[index], settings.characters.find(c => c.sourceKey === projected.characterKeys[index])?.voiceRules].filter(Boolean).join('\n') || '按已确认的人物性格自然表达',
      })),
    }
    validateChatNarrativeProductionSourceV1(source)
    artifacts.push({artifactKey: 'design.game', kind: 'product-design', payload: source, quality: {reviewedSourceOnly: true}, rights: {}})
  } else if (input.task.taskKey === 'content.chat-author-gate') {
    const decision = input.authorResolution
    if (decision?.blockerKey !== input.task.taskKey || decision.resolution.action !== 'confirm-chat-situation' || !decision.resolution.chatSituation) fail('请比较初始情境并选择一个开场后继续')
    const selection: ChatSituationSelectionV1 = {
      schema: 'storyforge.chat-situation-selection', version: 1,
      ...decision.resolution.chatSituation, authorCommandId: decision.commandId,
    }
    await reviewedSelection(input, selection)
    artifacts.push(
      {artifactKey: 'content.chat-selection', kind: 'product-design', payload: selection, quality: {authorSelected: true}, rights: {}},
      {artifactKey: 'content.product-module', kind: 'product-module', payload: {
        schema: 'storyforge.product-module-artifact', version: 1, productType: 'character-interaction',
        interfaceStyle: settings.experience || '角色聊天', interactionNotes: ['角色按情境和自身目标行动，玩家可以拒绝、改道和休息'],
        presentationPolicy: {pacing: 'balanced', transitionMs: 0, backgroundStrategy: 'none'},
      }, quality: {authorSelected: true}, rights: {}},
    )
  } else if (input.task.taskKey === 'content.narrative') {
    artifacts.push({artifactKey: 'content.narrative', kind: 'narrative', payload: chatNarrativeShellV1(await selectedChatProductionNarrativeV1(input)), quality: {openSituation: true}, rights: {}})
  } else fail('未登记的情境制作任务')
  return {artifacts, passedGateIds: [...input.task.acceptanceGateIds], usage: {
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    storageBytes: 0,
  }}
}

export async function verifyChatNarrativeShellV1(input: Pick<ProductProductionTaskExecutionInputV1, 'inputArtifacts' | 'task'>) {
  const content = await selectedChatProductionNarrativeV1(input)
  const shell = chatNarrativeShellV1(content)
  if (canonicalProductProductionJsonV2(chatProductionArtifactPayloadV1(input, 'content.narrative')) !== canonicalProductProductionJsonV2(shell)) fail('情境导航与作者选定开场不一致')
  return {content, shell}
}
