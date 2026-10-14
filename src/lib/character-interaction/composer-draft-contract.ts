import {z} from 'zod'
import type {ChatComposerDraftV1} from '../types/character-interaction'

export const CHAT_COMPOSER_MAX_CHARACTERS = 12_000
const schema = z.object({version: z.literal(1), text: z.string().max(CHAT_COMPOSER_MAX_CHARACTERS),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
export function parseChatComposerDraftV1(value: unknown): ChatComposerDraftV1 {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error('未发送消息草稿的格式或长度无效。')
  return parsed.data
}
export class ChatComposerConflictError extends Error {
  constructor(readonly current: ChatComposerDraftV1 | null) {
    super('另一页面已经修改这份草稿；你的文字仍保留，请选择要使用的版本。')
    this.name = 'ChatComposerConflictError'
  }
}
