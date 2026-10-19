import { lazy, Suspense, useEffect, useState } from 'react'
import { useWorldGroupStore } from '../../stores/world-group'
import { readOwnedRows, resolveScope } from '../../lib/workspace/scope'
import type { CodexEntry, Geography, ImportantLocation, Location, Project } from '../../lib/types'
const LocationPanel = lazy(() => import('./LocationPanel'))
const GeographyPanel = lazy(() => import('../geography/GeographyPanel'))
const WorldMapPanel = lazy(() => import('../geography/WorldMapPanel'))
const CodexPanel = lazy(() => import('../codex/CodexPanel'))
export type PlacesTab = 'locations' | 'geography' | 'world-map' | 'city' | 'links'
const TABS: [PlacesTab, string, string][] = [
  ['locations', '地点库', '保存地点实体及其父子关系；城池词条可以显式关联到这里的地点。'],
  ['geography', '地理设定', '保留地理总述与既有地点树。树节点和地点库有独立身份，同名不代表同一地点。'],
  ['world-map', '世界地图', '管理地图布局与世界节点。布局不会自动替换地点主档或地理层级。'],
  ['city', '城池词条', '保存城池人文属性；选择关联地点后，两种视图可指向同一地点实体。'],
  ['links', '资料关联预览', '检查已有明确关联和独立资料。本页只读，不自动合并同名地点。'],
]

function PlaceLinks({ project }: { project: Project }) {
  const group = useWorldGroupStore(state => state.activeGroupId)
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLines([]); setError('')
    void resolveScope({ projectId: project.id! }).then(async scope => {
      const [places, geographies, entries] = await Promise.all([
        readOwnedRows<ImportantLocation>(scope, 'importantLocations'), readOwnedRows<Geography>(scope, 'geographies'), readOwnedRows<CodexEntry>(scope, 'codexEntries'),
      ])
      const worldGroupId = project.enableMultiWorld ? group : null
      const byId = new Map(places.map(place => [place.id, place]))
      const descriptions = entries.filter(entry => entry.importantLocationId != null && (entry.worldGroupId ?? null) === worldGroupId).map(entry => {
        const place = byId.get(entry.importantLocationId!)
        return place ? `已关联：词条「${entry.name}」 → 地点「${place.name}」` : `关联待修复：词条「${entry.name}」引用的地点已不可用`
      })
      for (const geography of geographies.filter(item => (item.worldGroupId ?? null) === worldGroupId)) {
        const tree: unknown = JSON.parse(geography.locations || '[]')
        if (!Array.isArray(tree)) throw new Error('地理层级格式有误，原始资料仍保留。')
        for (const node of tree as Location[]) {
          const sameName = places.filter(place => place.name === node.name)
          descriptions.push(`地理树「${node.name}」${sameName.length ? `：地点库有 ${sameName.length} 个同名地点，尚未建立身份映射` : '：独立地理节点'}；上级 ${node.parentId ? (tree as Location[]).find(parent => parent.id === node.parentId)?.name ?? '待核对' : '无'}`)
        }
      }
      if (active) setLines(descriptions)
    }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [project.id, project.activeWorldId, project.enableMultiWorld, group])
  return <div className="space-y-2 p-4 text-sm">{error && <p role="alert">{error}</p>}{lines.map((line, index) => <p key={index} className="rounded border border-border p-2">{line}</p>)}{!error && !lines.length && <p>暂无已有的地点关联。可在“城池词条”选择地点；地理树和地图数据继续保留在原视图。</p>}</div>
}

export default function PlacesWorkspace({ project, tab, onTab }: { project: Project; tab: PlacesTab; onTab: (tab: PlacesTab) => void }) {
  return <section className="min-w-0" aria-label="地点与地图工作区">
    <header className="border-b border-border p-4"><h2 className="font-semibold">地点与地图</h2><nav className="my-3 flex flex-wrap gap-2" aria-label="地点与地图视图">{TABS.map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => onTab(key)} className={`rounded px-3 py-1.5 text-sm ${tab === key ? 'bg-accent/10 text-accent' : 'bg-bg-base text-text-muted'}`}>{label}</button>)}</nav><p className="text-xs text-text-muted">{TABS.find(([key]) => key === tab)?.[2]}</p></header>
    <Suspense fallback={<p role="status" className="p-4">正在读取地点资料…</p>}>
      {tab === 'locations' ? <LocationPanel project={project} /> : tab === 'geography' ? <GeographyPanel project={project} /> : tab === 'world-map' ? <WorldMapPanel project={project} /> : tab === 'city' ? <CodexPanel project={project} fixedCategoryKeys={['city']} embedded /> : <PlaceLinks project={project} />}
    </Suspense>
  </section>
}
