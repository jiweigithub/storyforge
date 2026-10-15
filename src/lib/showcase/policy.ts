import { ADVENTURE_WEB_PLAYER_NOTICE, IS_ADVENTURE_WEB_PLAYER } from '../adventure/web-player-policy'

/** A build profile, never a URL switch or a user preference. */
export const IS_SHOWCASE = import.meta.env.MODE === 'showcase'
export const IS_MODEL_DISABLED_BUILD = IS_SHOWCASE || IS_ADVENTURE_WEB_PLAYER
export const SHOWCASE_DATABASE = 'storyforge-website-experience-v1'
export const SHOWCASE_STORAGE_PREFIX = 'storyforge-website-experience-v1:'
export const SHOWCASE_NOTICE = '官网体验版不连接模型或外部服务。请下载 StoryForge，在本机配置后使用 AI 创作。'

export function assertGenerationAvailable(): void {
  if (IS_SHOWCASE) throw new Error(SHOWCASE_NOTICE)
  if (IS_ADVENTURE_WEB_PLAYER) throw new Error(ADVENTURE_WEB_PLAYER_NOTICE)
}

/** Only packaged, same-origin assets may be fetched by the public experience. */
export function isShowcaseAssetRequest(input: string, method: string, origin: string): boolean {
  try {
    const url = new URL(input, `${origin}/storyforge/`)
    return (method === 'GET' || method === 'HEAD') && url.origin === origin
      && !url.username && !url.password
      && /^\/storyforge\/(?:assets|demo-assets|prototypes|games|workshop|companion|brand)\//.test(url.pathname)
      && /\.(?:js|css|json|md|txt|svg|png|jpe?g|webp|gif|ico|woff2?|mp3|wav|ogg|mp4|webm|sfplugin)$/i.test(url.pathname)
  } catch { return false }
}

/** Full Storage interface; clearing the demo cannot clear the original app. */
export function scopedStorage(storage: Storage, prefix = SHOWCASE_STORAGE_PREFIX): Storage {
  const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null && key.startsWith(prefix))
  return {
    get length() { return keys().length },
    key(index: number) { return keys()[index]?.slice(prefix.length) ?? null },
    getItem(key: string) { return storage.getItem(prefix + key) },
    setItem(key: string, value: string) { storage.setItem(prefix + key, value) },
    removeItem(key: string) { storage.removeItem(prefix + key) },
    clear() { keys().forEach(key => storage.removeItem(key)) },
  }
}

export const MODEL_DISABLED_NOTICE = IS_ADVENTURE_WEB_PLAYER ? ADVENTURE_WEB_PLAYER_NOTICE : SHOWCASE_NOTICE
