import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { Search, X, BookOpen, Users, Scroll, Hash } from 'lucide-react'
import type { CodexEntry, CodexCategory } from '../../lib/types/codex'
import type { Character, WorldRulesProfile, Project } from '../../lib/types'
import { characterAxesLabel } from '../../lib/character/character-axes'
import { WORLD_RULE_TREE, type WorldRuleNodeDef } from '../../lib/types/world-rules'
import { parseFieldSchema, parseEntryFields } from '../../lib/types/codex'
import { scoreCodexEntry } from '../../lib/codex/search'
import { readOwnedRows, resolveScope } from '../../lib/workspace/scope'
import CodexPanel from '../codex/CodexPanel'
import LegacySettingHistory from '../agent/LegacySettingHistory'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

interface SearchResult {
  type: 'codex' | 'character' | 'worldRule'; id: number | string; name: string; summary: string; category?: string; icon?: string; score: number
  data: CodexEntry | Character | { node: WorldRuleNodeDef; entry?: { historicalAnchors: string; fictionalAdaptations: string; priority: string } }
}
export default function SettingLookupPanel({ project, worldGroupId = null, onClose }: {
  project: Project; worldGroupId?: number | null; onClose: () => void
}) {
  const projectId = project.id!
  const [showCodex, setShowCodex] = useState(false)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'codex' | 'character' | 'worldRule'>('all')
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [codexEntries, setEntries] = useState<CodexEntry[]>([])
  const [codexCategories, setCategories] = useState<CodexCategory[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [worldRulesProfile, setRules] = useState<WorldRulesProfile | null>(null)
  const [error, setError] = useState('')
  const activeView = useRef(0)
  useEffect(() => { const version = ++activeView.current; return () => { activeView.current = version + 1 } }, [projectId, project.activeWorkId, worldGroupId])
  useEffect(() => {
    let active = true
    setEntries([]); setCategories([]); setCharacters([]); setRules(null); setSelectedResult(null); setError('')
    void resolveScope({ projectId }).then(async scope => {
      const [entries, categories, chars, rules] = await Promise.all([
        readOwnedRows<CodexEntry>(scope, 'codexEntries'), readOwnedRows<CodexCategory>(scope, 'codexCategories'),
        readOwnedRows<Character>(scope, 'characters'), readOwnedRows<WorldRulesProfile>(scope, 'worldRulesProfiles'),
      ])
      if (!active) return
      setEntries(entries.filter(entry => (entry.worldGroupId ?? null) === worldGroupId)); setCategories(categories)
      setCharacters(chars.filter(char => worldGroupId == null || char.homeWorldGroupId == null || char.homeWorldGroupId === worldGroupId))
      setRules(rules.find(rule => (rule.worldGroupId ?? null) === worldGroupId) ?? null)
    }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [projectId, project.activeWorldId, project.activeWorkId, worldGroupId])
  const openDiscussion = async () => {
    const version = activeView.current
    try {
      await flushPendingEditsV1()
      if (activeView.current !== version) return
      onClose(); navigate(`/workspace/${projectId}?module=info&mode=agent&discussion=free`)
    } catch (reason) { if (activeView.current === version) setError(`尚未离开：${String(reason)}`) }
  }
  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return []

    const q = query.trim()
    const allResults: SearchResult[] = []

    if (activeTab === 'all' || activeTab === 'codex') {
      for (const entry of codexEntries) {
        const category = codexCategories.find(c => c.id === entry.categoryId)
        const fields = parseEntryFields(entry.fields)
        const fieldsText = Object.values(fields).join(' ')
        const score = scoreCodexEntry(entry.name, entry.summary, fieldsText, q)
        if (score > 0) {
          allResults.push({
            type: 'codex',
            id: entry.id!,
            name: entry.name,
            summary: entry.summary,
            category: category?.name,
            icon: category?.icon,
            score,
            data: entry,
          })
        }
      }
    }

    if (activeTab === 'all' || activeTab === 'character') {
      for (const char of characters) {
        const score = scoreCodexEntry(
          char.name,
          char.shortDescription || '',
          `${characterAxesLabel(char)} ${char.personality || ''} ${char.background || ''}`,
          q,
        )
        if (score > 0) {
          allResults.push({
            type: 'character',
            id: char.id!,
            name: char.name,
            summary: char.shortDescription || '暂无简介',
            category: characterAxesLabel(char),
            icon: '👤',
            score,
            data: char,
          })
        }
      }
    }

    if (activeTab === 'all' || activeTab === 'worldRule') {
      const traverseTree = (nodes: WorldRuleNodeDef[], parentLabel?: string) => {
        for (const node of nodes) {
          const entry = worldRulesProfile?.entries[node.id]
          const content = entry
            ? `${entry.historicalAnchors} ${entry.fictionalAdaptations}`
            : node.label + (node.hints?.join(' ') || '')
          const score = scoreCodexEntry(node.label, content, '', q)
          if (score > 0) {
            allResults.push({
              type: 'worldRule',
              id: node.id,
              name: node.label,
              summary: entry
                ? (entry.historicalAnchors || entry.fictionalAdaptations).slice(0, 100) +
                  ((entry.historicalAnchors || entry.fictionalAdaptations).length > 100 ? '...' : '')
                : '暂无设定',
              category: parentLabel || '世界规则',
              icon: node.icon || '📜',
              score,
              data: {
                node,
                entry: entry
                  ? {
                      historicalAnchors: entry.historicalAnchors,
                      fictionalAdaptations: entry.fictionalAdaptations,
                      priority: entry.priority,
                    }
                  : undefined,
              },
            })
          }
          if (node.children) {
            traverseTree(node.children, node.label)
          }
        }
      }
      traverseTree(WORLD_RULE_TREE)
    }

    return allResults.sort((a, b) => b.score - a.score).slice(0, 20)
  }, [query, activeTab, codexEntries, codexCategories, characters, worldRulesProfile])

  const renderDetail = () => {
    if (!selectedResult) return null

    if (selectedResult.type === 'codex') {
      const entry = selectedResult.data as CodexEntry
      const category = codexCategories.find(c => c.id === entry.categoryId)
      const fields = parseEntryFields(entry.fields)
      const fieldDefs = parseFieldSchema(category?.fieldSchema || '')

      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{category?.icon}</span>
            <div>
              <h3 className="font-semibold text-text-primary">{entry.name}</h3>
              <span className="text-xs text-text-muted">{category?.name}</span>
            </div>
          </div>
          {entry.summary && (
            <p className="text-sm text-text-secondary">{entry.summary}</p>
          )}
          {entry.description && (
            <div className="p-3 bg-bg-base rounded-lg text-sm text-text-secondary whitespace-pre-wrap">
              {entry.description}
            </div>
          )}
          {Object.keys(fields).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-muted">详细信息</p>
              {fieldDefs.map(def => {
                const value = fields[def.key]
                if (!value) return null
                return (
                  <div key={def.key} className="flex items-start gap-2">
                    <span className="text-xs text-text-muted w-20 shrink-0">{def.label}</span>
                    <span className="text-xs text-text-secondary break-all">{value}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    if (selectedResult.type === 'character') {
      const char = selectedResult.data as Character
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">👤</span>
            <div>
              <h3 className="font-semibold text-text-primary">{char.name}</h3>
              {char.identity && <span className="text-xs text-text-muted">身份：{char.identity}</span>}
            </div>
          </div>
          {char.shortDescription && (
            <p className="text-sm text-text-secondary">{char.shortDescription}</p>
          )}
          {char.personality && (
            <div className="p-3 bg-bg-base rounded-lg">
              <p className="text-xs text-text-muted mb-1">性格</p>
              <p className="text-sm text-text-secondary">{char.personality}</p>
            </div>
          )}
          {char.background && (
            <div className="p-3 bg-bg-base rounded-lg">
              <p className="text-xs text-text-muted mb-1">背景</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{char.background}</p>
            </div>
          )}
          {char.abilities && (
            <div className="p-3 bg-bg-base rounded-lg">
              <p className="text-xs text-text-muted mb-1">能力</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{char.abilities}</p>
            </div>
          )}
        </div>
      )
    }

    if (selectedResult.type === 'worldRule') {
      const data = selectedResult.data as { node: WorldRuleNodeDef; entry?: { historicalAnchors: string; fictionalAdaptations: string; priority: string } }
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{data.node.icon || '📜'}</span>
            <div>
              <h3 className="font-semibold text-text-primary">{data.node.label}</h3>
              <span className="text-xs text-text-muted">{selectedResult.category}</span>
            </div>
          </div>
          {data.node.hints && data.node.hints.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.node.hints.map((hint, idx) => (
                <span key={idx} className="px-2 py-0.5 text-[10px] bg-bg-base rounded text-text-muted">
                  {hint}
                </span>
              ))}
            </div>
          )}
          {data.entry && (
            <>
              {data.entry.historicalAnchors && (
                <div className="p-3 bg-bg-base rounded-lg">
                  <p className="text-xs text-text-muted mb-1">📜 取自真实</p>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{data.entry.historicalAnchors}</p>
                </div>
              )}
              {data.entry.fictionalAdaptations && (
                <div className="p-3 bg-bg-base rounded-lg">
                  <p className="text-xs text-text-muted mb-1">✨ 架空改造</p>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{data.entry.fictionalAdaptations}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">⚖️ 冲突时优先：</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  data.entry.priority === 'historical' ? 'bg-blue-500/10 text-blue-400' :
                  data.entry.priority === 'fictional' ? 'bg-purple-500/10 text-purple-400' :
                  'bg-gray-500/10 text-gray-400'
                }`}>
                  {data.entry.priority === 'historical' ? '史实优先' :
                   data.entry.priority === 'fictional' ? '架空优先' : '均衡'}
                </span>
              </div>
            </>
          )}
          {!data.entry && (
            <p className="text-xs text-text-muted">暂无设定</p>
          )}
        </div>
      )
    }

    return null
  }

  return <section className="rounded-xl border border-border bg-bg-elevated" aria-label="设定查询">
    <div className="flex items-center justify-between border-b border-border p-3"><h2>设定查询</h2><button onClick={onClose} aria-label="关闭设定查询"><X size={16} /></button></div>
    <div className="space-y-3 p-3"><p className="text-xs text-text-muted">检索当前作品已保存的资料。创意讨论与试写统一在炉娘中进行；设定提取进入词条库的候选确认流程。</p>
      <div className="flex gap-3 text-xs"><button onClick={openDiscussion} className="text-accent">打开炉娘自由讨论</button><button onClick={() => setShowCodex(value => !value)} className="text-accent">打开词条库提取设定</button></div>
      <LegacySettingHistory key={`${projectId}:${worldGroupId}`} projectId={projectId} worldGroupId={worldGroupId} onClaimed={openDiscussion} />
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="搜索武功招式、角色、地点、物品、规则..."
                  className="w-full pl-9 pr-4 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex gap-1 mt-3">
                {[
                  { key: 'all', label: '全部', icon: Hash },
                  { key: 'codex', label: '词条', icon: BookOpen },
                  { key: 'character', label: '角色', icon: Users },
                  { key: 'worldRule', label: '规则', icon: Scroll },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key as typeof activeTab)
                      setSelectedResult(null)
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      activeTab === tab.key
                        ? 'bg-accent text-white'
                        : 'bg-bg-base text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    <tab.icon className="w-3 h-3" />
                    {tab.label}
                  </button>
                ))}
              </div>
</div>
    {showCodex && <CodexPanel project={project} embedded compact />}
    {error && <p role="alert">{error}</p>}
          <div className="flex h-80">
            <div className="w-1/2 border-r border-border overflow-y-auto">
              {results.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <Search className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">输入关键词搜索设定</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {results.map(result => (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => setSelectedResult(result)}
                      className={`w-full text-left p-2 rounded-lg transition-colors ${
                        selectedResult?.id === result.id && selectedResult?.type === result.type
                          ? 'bg-accent/10'
                          : 'hover:bg-bg-hover'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-lg">{result.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary truncate">{result.name}</p>
                          {result.category && (
                            <p className="text-[10px] text-text-muted">{result.category}</p>
                          )}
                          <p className="text-xs text-text-secondary truncate mt-0.5">
                            {result.summary}
                          </p>
                        </div>
                        <span className="text-[10px] text-text-muted/50">
                          {result.type === 'codex' ? '词条' : result.type === 'character' ? '角色' : '规则'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-1/2 overflow-y-auto p-4">
              {selectedResult ? (
                renderDetail()
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <BookOpen className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">选择一个结果查看详情</p>
                </div>
              )}
            </div>
          </div>
  </section>
}
