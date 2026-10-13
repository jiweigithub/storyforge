export const IS_ADVENTURE_WEB_PLAYER = import.meta.env.MODE === 'adventure-player'
export const ADVENTURE_WEB_PLAYER_NOTICE = '这是独立游戏播放器，只运行作品内的剧情和规则，不连接 AI 服务。'

export function adventureWebPlayerStorageName(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('游戏包身份无效，请重新导出。')
  return `storyforge-adventure-player-v1-${hash}`
}

export function adventureWebPlayerIdentity(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="storyforge-game"]')?.content ?? ''
}

/** Relative deployment below any directory; no remote media, API or traversal. */
export function isAdventureWebPlayerAssetRequest(input: string, method: string, page: string): boolean {
  try {
    const base = new URL('.', page)
    const url = new URL(input, base)
    if (!['GET', 'HEAD'].includes(method) || url.origin !== base.origin || url.username || url.password) return false
    const path = url.pathname.slice(base.pathname.length)
    return url.pathname.startsWith(base.pathname) && /^(?:game\.json|media\/[a-f0-9]{64}-\d+\.bin|assets\/[\w.-]+\.(?:js|css|woff2?|png|jpe?g|webp|svg|gif|ico))$/.test(path)
  } catch { return false }
}
