import { useEffect, useRef, useState } from 'react'
import { authorWorldQueryV1, bindWorldQueryResourcesV1, closeWorldQueryAccessV1, openAuthorWorldQueryAccessV1, queryWorldReleaseV1 } from '../../lib/context-gateway/world-query-client'
import type { ContextResourceDescriptorV1 } from '../../lib/registry/types'
import type { WorldQueryAccessV1, WorldQueryItemV1, WorldQueryResultV1, WorldQueryV1 } from '../../lib/types/world-query'

const kindLabels = { entity: '实体', event: '事件', assertion: '事实', relation: '关系', rule: '规则', 'epistemic-event': '认知', development: '发展与承诺', disclosure: '揭示' }
const diagnosticLabels: Record<string, string> = { 'unknown-time': '部分内容未记录这个时间，未当作命中。', 'incomparable-time': '部分时间不能与当前时制比较。',
  insufficient: '完整内容或证据超出当前权限或预算，请缩小条件后重试。', conflict: '这个时点存在互相冲突的已确认状态，需要作者裁决。',
  budget: '已达到本次展开上限。', missing: '当前已编译且获授权的范围内没有命中。', unsupported: '这个版本尚不支持所选能力。' }

export default function NarrativeResourceBrowser({ access: authorAccess }: { access: WorldQueryAccessV1 }) {
  const [access, setAccess] = useState(authorAccess), [catalog, setCatalog] = useState<ContextResourceDescriptorV1[]>([])
  const [text, setText] = useState(''), [entity, setEntity] = useState(''), [thread, setThread] = useState('')
  const [axis, setAxis] = useState(''), [timeline, setTimeline] = useState(authorAccess.capabilities.timeChoices?.timelines[0]?.key ?? '')
  const [day, setDay] = useState(''), [character, setCharacter] = useState(''), [causal, setCausal] = useState(false)
  const [result, setResult] = useState<WorldQueryResultV1 | null>(null), [original, setOriginal] = useState<string[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const ticket = useRef(0), additionalAccess = useRef<WorldQueryAccessV1 | null>(null), lastQuery = useRef<WorldQueryV1 | null>(null)
  useEffect(() => () => { ticket.current++; if (additionalAccess.current) void closeWorldQueryAccessV1(additionalAccess.current) }, [])
  useEffect(() => {
    let active = true
    setCatalog([])
    void (async () => {
      const provider = await bindWorldQueryResourcesV1(access), rows: ContextResourceDescriptorV1[] = []
      let cursor: string | undefined
      do { const page = await provider.listMetadata({ scope: access.scope, kinds: ['character', 'location', 'codex-entry', 'world', 'story-arc'], limit: 100, cursor })
        rows.push(...page.items); cursor = page.nextCursor ?? undefined
      } while (cursor && active)
      if (active) setCatalog(rows)
    })().catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [access])

  const run = async (next = false) => {
    const current = ++ticket.current
    setBusy(true); setError(''); setOriginal([])
    try {
      const query = next && lastQuery.current ? { ...lastQuery.current, cursor: result?.nextCursor ?? null } : authorWorldQueryV1(access)
      if (!next) {
        query.text = text.trim() || null
        query.entityKeys = entity ? [entity] : []; query.storyArcKeys = thread ? [thread] : []
        if (axis) {
          if (!timeline || !/^(0|-?[1-9][0-9]*)$/.test(day)) throw Error('请选择时制并填写整数时点。')
          query.time = { axis: axis as 'occurred' | 'valid' | 'acquired', mode: 'at', point: { kind: 'tick', timelineKey: timeline, value: day } }
          if (axis === 'valid') query.mode = 'state-at'
        }
        query.causalDepth = causal ? 1 : 0
        query.budget.maxRecords = 20
      }
      const found = await queryWorldReleaseV1(access, query)
      if (ticket.current === current) { lastQuery.current = query; setResult(found) }
    } catch (reason) { if (ticket.current === current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (ticket.current === current) setBusy(false) }
  }
  const changePerspective = async (view: 'canon' | 'author-plan' | 'development' | 'character') => {
    const current = ++ticket.current
    setBusy(true); setResult(null); setOriginal([]); setCatalog([]); setError(''); setText(''); setEntity(''); setThread(''); setAxis('')
    try {
      if (view === 'character' && !character) throw Error('请先选择要预览的角色。')
      if (view === 'character' && (!timeline || !/^(0|-?[1-9][0-9]*)$/.test(day))) throw Error('预览角色认知需要选择时制和获知截止时点。')
      const opened = await openAuthorWorldQueryAccessV1({ scope: { ...authorAccess.scope, worldId: authorAccess.scope.worldId! },
        localReleaseRecordId: authorAccess.reference.localReleaseRecordId, view,
        perspective: view === 'character' ? { kind: 'character', characterKey: character } : { kind: 'author' },
        knowledgeThrough: view === 'character' ? { kind: 'tick', timelineKey: timeline, value: day } : null, disclosedThrough: null })
      if (ticket.current !== current) { await closeWorldQueryAccessV1(opened); return }
      if (additionalAccess.current) await closeWorldQueryAccessV1(additionalAccess.current)
      additionalAccess.current = opened; setAccess(opened)
    } catch (reason) { if (ticket.current === current) setError(String(reason)) }
    finally { if (ticket.current === current) setBusy(false) }
  }
  const readOriginal = async (item: WorldQueryItemV1) => {
    const current = ++ticket.current
    setBusy(true); setOriginal([]); setError('')
    try {
      const provider = await bindWorldQueryResourcesV1(access)
      // The registered catalog supplies the portable resource identity. The UI
      // never decodes a release or computes a parallel source mapping.
      let cursor: string | undefined, found: ContextResourceDescriptorV1 | undefined
      do { const page = await provider.listMetadata({ scope: access.scope, limit: 100, cursor })
        found = page.items.find(row => row.worldSemantic?.resourceCoordinate === item.semanticId); cursor = page.nextCursor ?? undefined
      } while (!found && cursor)
      if (!found) throw Error('此内容已不在当前视角的可读取范围。')
      const texts: string[] = []
      for (const sourceRef of found.sourceRefs) {
        const read = await provider.readOriginal({ scope: access.scope, resourceKey: found.resourceKey, sourceRef, maxTokens: 100000 })
        if (!texts.includes(read.content)) texts.push(read.content)
      }
      if (ticket.current === current) setOriginal(texts)
    } catch (reason) { if (ticket.current === current) setError(String(reason)) }
    finally { if (ticket.current === current) setBusy(false) }
  }

  return <section className="lf-paper" aria-label="实验叙事查询">
    <h3>实验：叙事查询</h3>
    <p>查询这个已封存版本的已确认内容。未抽取的正文和未知时间会保留缺口，不表示世界中不存在。</p>
    <p>当前视角：{access.perspective.kind === 'character' ? '角色认知' : access.view === 'author-plan' ? '作者计划' : access.view === 'development' ? '发展与承诺' : '作者 · 已发生内容'}</p>
    {access.perspective.kind === 'author' ? <>
      <div className="we-actions"><button disabled={busy} onClick={() => void changePerspective('canon')}>已发生内容</button><button disabled={busy} onClick={() => void changePerspective('author-plan')}>作者计划</button><button disabled={busy} onClick={() => void changePerspective('development')}>发展与承诺</button></div>
      <label>时制<select aria-label="叙事查询时制" value={timeline} onChange={event => setTimeline(event.target.value)}><option value="">未选择</option>{access.capabilities.timeChoices?.timelines.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label>时间点<input aria-label="叙事查询时间点" value={day} onChange={event => setDay(event.target.value)} placeholder="例如 2"/></label>
      <label>预览角色<select aria-label="叙事查询预览角色" value={character} onChange={event => setCharacter(event.target.value)}><option value="">选择角色</option>{catalog.filter(item => item.kind === 'character').map(item => <option key={item.resourceKey} value={item.worldSemantic!.resourceCoordinate}>{item.title}</option>)}</select></label>
      <button disabled={busy} onClick={() => void changePerspective('character')}>预览截至此时的角色认知</button>
    </> : <button disabled={busy} onClick={() => void changePerspective('canon')}>返回作者视角</button>}
    <form onSubmit={event => { event.preventDefault(); void run() }}>
      <label>关键词<input aria-label="叙事查询关键词" value={text} onChange={event => setText(event.target.value)} placeholder="可留空，只按条件筛选"/></label>
      <label>实体<select aria-label="叙事查询实体" value={entity} onChange={event => setEntity(event.target.value)}><option value="">不限实体</option>{catalog.filter(item => item.kind !== 'story-arc').map(item => <option key={item.resourceKey} value={item.worldSemantic!.resourceCoordinate}>{item.title}</option>)}</select></label>
      <label>故事线<select aria-label="叙事查询故事线" value={thread} onChange={event => setThread(event.target.value)}><option value="">不限故事线</option>{catalog.filter(item => item.kind === 'story-arc').map(item => <option key={item.resourceKey} value={item.worldSemantic!.resourceCoordinate}>{item.title}</option>)}</select></label>
      {access.perspective.kind === 'author' && <label>时间条件<select aria-label="叙事查询时间条件" value={axis} onChange={event => setAxis(event.target.value)}><option value="">不限时间</option><option value="occurred">发生时点</option><option value="valid">此时有效的状态</option><option value="acquired">获知时点</option></select></label>}
      <label><input type="checkbox" checked={causal} onChange={event => setCausal(event.target.checked)}/>沿已确认因果展开一步</label>
      <button className="lf-action" disabled={busy}>查询封存内容</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <div aria-label="叙事查询结果">{result.diagnostics.map((diagnostic, index) => <p key={index}>{diagnosticLabels[diagnostic.code] ?? '部分内容无法确认。'}</p>)}
      {result.items.map(item => <article key={item.semanticId}><h4>{item.title}</h4><p>{kindLabels[item.kind]} · {item.modality === 'intent' ? '作者计划' : item.modality === 'belief' ? '角色认知' : '已确认内容'}</p><p>索引摘要（非原文）：{item.summary}</p><button disabled={busy || !item.originalAvailable} onClick={() => void readOriginal(item)}>查看完整原文证据</button></article>)}
      {result.nextCursor && <button disabled={busy} onClick={() => void run(true)}>下一页</button>}
      <details><summary>本次查询的版本与校验信息</summary><pre>{JSON.stringify({ release: result.releaseRef, query: result.queryHash, receipt: result.receiptRef, budget: result.budgetUsed }, null, 2)}</pre></details>
    </div>}
    {original.length > 0 && <section aria-label="叙事查询原文证据"><h4>冻结版本中的原文</h4>{original.map((text, index) => <pre key={index} className="we-evidence">{text}</pre>)}</section>}
    {access.capabilities.coverage && <p>已投影 {access.capabilities.coverage.projectedAtoms} 条作者标注；{access.capabilities.coverage.unsupportedSources} 个来源尚不能完整投影。尚未标注的正文仍保留在封存中。</p>}
  </section>
}
