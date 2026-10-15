import ReactDOM from 'react-dom/client'
import { useState } from 'react'
import AdventureGamePlayer from './components/text-game/AdventureGamePlayer'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { DialogProvider } from './components/shared/Dialog'
import { openCurrentSchema } from './lib/db/ensure-schema'
import { validateRegistry } from './lib/registry/validate'
import { adventureWebPlayerIdentity } from './lib/adventure/web-player-policy'
import { MAXIMUM_ADVENTURE_WEB_METADATA_BYTES_V1, readAdventureWebFileV1, readAdventureWebPackageV1 } from './lib/adventure/web-package'
import { installAdventureWebPackageV1 } from './lib/adventure/web-player-install'
import { applyStoryForgeTheme, resolveStoryForgeTheme } from './lib/theme-bootstrap'
import './index.css'

function WebPlayer({ game }: { game: Awaited<ReturnType<typeof installAdventureWebPackageV1>> }) {
  const [sessionId, setSessionId] = useState<number | null>(() => {
    const value = Number(localStorage.getItem('last-session'))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  })
  return <div className="min-h-screen bg-bg-base text-text-primary">
    <p className="px-4 py-2 text-center text-xs text-text-muted">进度自动保存在此浏览器 · 无需账号或 AI 配置</p>
    <AdventureGamePlayer project={game.project} scope={game.scope} worldGroupId={null} initialSessionId={sessionId}
      onOpenSession={id => { localStorage.setItem('last-session', String(id)); setSessionId(id) }}
      onOpenLibrary={() => { localStorage.removeItem('last-session'); setSessionId(null) }} />
  </div>
}

export async function mountAdventureWebPlayer() {
  applyStoryForgeTheme(resolveStoryForgeTheme(null))
  const root = document.getElementById('root')!
  root.textContent = '正在读取剧情与图片，首次打开需要稍候…'
  const bytes = await readAdventureWebFileV1('game.json', MAXIMUM_ADVENTURE_WEB_METADATA_BYTES_V1)
  const candidate = await readAdventureWebPackageV1(JSON.parse(new TextDecoder().decode(bytes)), adventureWebPlayerIdentity(), readAdventureWebFileV1)
  validateRegistry()
  await openCurrentSchema()
  const install = () => installAdventureWebPackageV1(candidate)
  // Two newly opened tabs must not install duplicate workspaces at the same time.
  const game = navigator.locks
    ? await navigator.locks.request(`adventure-install:${candidate.candidatePackageHash}`, install)
    : await install()
  document.title = game.title
  ReactDOM.createRoot(root).render(<DialogProvider><ErrorBoundary>
    <WebPlayer game={game} />
  </ErrorBoundary></DialogProvider>)
}
