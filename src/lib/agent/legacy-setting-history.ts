import { db } from '../db/schema'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { canonicalStringify, hashCanonicalValue } from './run/hash'
import { appendAgentEvent, getOrCreateAgentConversation, readAgentEvents } from './conversations'
import type { WorkspaceScope } from '../types/world-ownership'

export const LEGACY_SETTING_HISTORY_KEY = 'storyforge-setting-qa-messages'
export interface LegacySettingMessage { role: 'user' | 'assistant'; content: string }
export function parseLegacySettingHistory(raw: string): LegacySettingMessage[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.some(item => !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string')) {
    throw new Error('旧历史格式无法识别；请导出原文件保留，不会覆盖原数据。')
  }
  return value.map(item => ({ role: item.role, content: item.content }))
}

/** Only an explicit author claim can attach unscoped history to a Work. Original storage is untouched. */
export async function claimLegacySettingHistoryV1(projectId: number, worldGroupId: number | null, raw: string, expectedScope: WorkspaceScope) {
  const messages = parseLegacySettingHistory(raw)
  const hash = await hashCanonicalValue(messages)
  const scope = await resolveScope({ projectId })
  if (canonicalStringify(scope) !== canonicalStringify(expectedScope)) throw new Error('作品已切换，请重新确认历史归属。')
  const conversation = await getOrCreateAgentConversation({ projectId, worldGroupId, scope, purpose: 'master-authoring' })
  return db.transaction('rw', scopeTransactionTables(db.agentConversations, db.agentEvents), async () => {
    const currentScope = await resolveScope({ projectId })
    if (canonicalStringify(scope) !== canonicalStringify(currentScope)) throw new Error('作品已切换，请重新确认历史归属。')
    const events = await readAgentEvents(conversation.id!, scope)
    if (events.some(event => { try { return JSON.parse(event.payload).legacyHistoryHash === hash } catch { return false } })) return { imported: 0, conversationId: conversation.id! }
    for (const message of messages) await appendAgentEvent({ projectId, scope, conversationId: conversation.id!, kind: 'message', role: message.role, content: message.content, payload: { type: 'legacy-setting-history-v1', legacyHistoryHash: hash, authorClaimed: true } })
    return { imported: messages.length, conversationId: conversation.id! }
  })
}
