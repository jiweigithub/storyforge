/** Author-created cast belongs to one chat Work, never to the referenced world.
 * The portable key survives edits, package transfer and runtime branches. */
export interface ChatPrivateCharacterV1 {
  characterKey: string
  name: string
  identity: string
  background: string
  personality: string
  voice: string
}

export function isChatPrivateCharacterKeyV1(value: unknown): value is string {
  return typeof value === 'string' && /^chat-private:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

export function parseChatPrivateCharactersV1(value: unknown): ChatPrivateCharacterV1[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('体验新角色最多 8 人')
  const seen = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).sort().join(',') !== 'background,characterKey,identity,name,personality,voice'
      || !isChatPrivateCharacterKeyV1(row.characterKey) || seen.has(row.characterKey)) throw new Error('体验新角色身份无效或重复，不能使用世界人物标识')
    seen.add(row.characterKey)
    for (const [key, limit] of [['name', 200], ['identity', 2000], ['background', 16000], ['personality', 8000], ['voice', 8000]] as const) {
      if (typeof row[key] !== 'string' || row[key].length > limit || (key === 'name' || key === 'identity') && !row[key].trim()) throw new Error(`体验新角色的 ${key} 无效或超过 ${limit} 字符`)
    }
  }
  return structuredClone(value) as ChatPrivateCharacterV1[]
}

export function createChatPrivateCharacterV1(): ChatPrivateCharacterV1 {
  return {characterKey: `chat-private:${crypto.randomUUID()}`, name: '', identity: '', background: '', personality: '', voice: ''}
}

export function chatPrivateCharacterKeysV1(settings: {version: number; privateCharacters?: ChatPrivateCharacterV1[]} | undefined): string[] {
  return settings?.version === 3 ? (settings.privateCharacters ?? []).map(c => c.characterKey).sort() : []
}
