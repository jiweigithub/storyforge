import type { ReactNode } from 'react'
import { Link } from 'react-router'
import BrandIcon from '../shared/BrandIcon'
import { PRODUCT_NAVIGATION } from '../navigation/product-navigation'
import type { Project } from '../../lib/types'

export default function AdventureProductFrame(props: {
  projects: Project[]
  projectId?: number
  libraryPath: string
  productionPath: string
  producing: boolean
  page: string
  navigation: readonly { label: string; path: string; active?: boolean }[]
  onChooseProject(id: string): void
  children: ReactNode
}) {
  return <div className="adventure-product-page">
    <header className="adventure-product-header">
      <Link className="adventure-brand" to="/" aria-label="返回 StoryForge 首页"><BrandIcon size={36} /><span>STORYFORGE<small>文字冒险</small></span></Link>
      <nav aria-label="文字冒险导航">
        <Link to={props.libraryPath} aria-current={!props.producing ? 'page' : undefined}>作品与试玩</Link>
        <Link to={props.productionPath} aria-current={props.producing ? 'page' : undefined}>创作工作台</Link>
      </nav>
      <label className="adventure-workspace-select">工作区
        <select aria-label="创作工作区" value={props.projectId ?? ''} onChange={event => props.onChooseProject(event.target.value)}>
          <option value="">选择工作区</option>
          {props.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
    </header>
    <nav className="adventure-crossproduct-nav" aria-label="产品导航">{PRODUCT_NAVIGATION.map(item => <Link key={item.id} to={item.id === 'adventure' ? props.libraryPath : item.path} aria-current={item.id === 'adventure' ? 'page' : undefined}>{item.label}</Link>)}</nav>
    {props.producing ? <div className="adventure-studio-shell">
      <nav className="adventure-studio-navigation" aria-label="文字冒险制作导航">{props.navigation.map(item => <Link key={item.path} to={item.path} aria-current={item.active ? 'page' : undefined}>{item.label}</Link>)}</nav>
      <h1>{props.page}</h1>
      {props.children}
    </div> : props.children}
  </div>
}
