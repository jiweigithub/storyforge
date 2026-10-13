import { installShowcaseBoundary } from './lib/showcase/bootstrap'
import { adventureWebPlayerIdentity, adventureWebPlayerStorageName, isAdventureWebPlayerAssetRequest, ADVENTURE_WEB_PLAYER_NOTICE } from './lib/adventure/web-player-policy'

async function start() {
  if (location.protocol === 'file:') throw new Error('请通过 HTTPS 网站或本地 HTTP 服务打开游戏。直接双击 HTML 无法保存进度。')
  const name = adventureWebPlayerStorageName(adventureWebPlayerIdentity())
  installShowcaseBoundary({
    storagePrefix: `${name}:`,
    notice: ADVENTURE_WEB_PLAYER_NOTICE,
    allowRequest: (url, method) => isAdventureWebPlayerAssetRequest(url, method, location.href),
  })
  const { mountAdventureWebPlayer } = await import('./adventure-web-player')
  await mountAdventureWebPlayer()
}

void start().catch((cause: unknown) => {
  const root = document.getElementById('root')!
  root.setAttribute('role', 'alert')
  root.textContent = `游戏暂时无法打开：${cause instanceof Error ? cause.message : String(cause)}。请刷新重试；已有存档不会被删除。`
})
