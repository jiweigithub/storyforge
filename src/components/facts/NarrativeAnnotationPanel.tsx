import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, RagLibraryEntry, WorkspaceScope } from '../../lib/types'
import { db } from '../../lib/db/schema'
import { resolveScopeLike } from '../../lib/workspace/scope'
import { buildRagLibrary } from '../../lib/retrieval/rag-library'
import { REGISTRY_BY_NAME } from '../../lib/registry/project-tables'
import { useAIConfigStore } from '../../stores/ai-config'
import { useWorldGroupStore } from '../../stores/world-group'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import { canonicalNarrativeJsonV1 } from '../../lib/world-engine/narrative-json'
import type { NarrativeAnnotationProposalV1 } from '../../lib/world-engine/narrative-domain-candidate'
import { creativeArtifactCanAdoptV1 } from '../../lib/agent/creative-reliability'
import { abandonNarrativeAnnotationRunV1, adoptNarrativeAnnotationCandidateV1, generateNarrativeAnnotationCandidateV1,
  listNarrativeAnnotationRunsV1, readNarrativeAnnotationRunV1, rejectNarrativeAnnotationCandidateV1,
  reviseNarrativeAnnotationCandidateV1 } from '../../lib/agent/run/narrative-annotation-durable'

type LoadedRun = Awaited<ReturnType<typeof readNarrativeAnnotationRunV1>>
const LABELS: Record<string, string> = {
  narrativeModalityV1: '内容性质', narrativeVisibilityV1: '可见范围', narrativeTimeV1: '时间', narrativeEvidenceV1: '原文证据',
  narrativeDependenciesV1: '依赖与因果', narrativeAliasesV1: '别名', narrativeEventV1: '事件', narrativeAssertionV1: '断言',
  narrativeRuleV1: '规则条件', narrativeRelationV1: '关系变化', narrativeEpistemicV1: '角色认知',
  narrativeDevelopmentsV1: '发展与承诺', narrativeDisclosuresV1: '揭示给读者', narrativeChronologyV1: '纪年',
  class: '可见范围', audienceKeys: '受众', eventType: '事件类型', participants: '参与者', entity: '角色或实体', role: '关系',
  locations: '地点', propositions: '涉及的事实', effects: '影响', communication: '消息传递', sender: '发送者', recipients: '接收者',
  channel: '传播方式', observer: '观察者', before: '先于其他事件', attitude: '认知态度', transition: '认知变化', assertedValue: '认知内容',
  value: '内容', values: '内容', sourceEvent: '来源事件', revises: '修订的旧认知', causeEvent: '导致变化的事件', target: '依赖来源',
  quote: '逐字引文', occurrence: '引文出现序号（从 0 开始）', supportRole: '证据作用', source: '证据来源', fieldPointer: '原文字段',
  occurred: '发生时间', valid: '有效时间', narratedAt: '叙述位置', disclosedAt: '揭示位置', acquiredAt: '获知时间',
  start: '起点', end: '终点', endMeaning: '终点是否明确', kind: '类型', label: '说明', timelineKey: '纪年标识', side: '相对位置',
  chapter: '章节', spanStart: '正文位置', statement: '承诺或发展内容', developmentType: '发展类型', owners: '相关角色', members: '涉及事件或事实',
  state: '进展', transitions: '推进事件', subjects: '揭示内容', polarity: '肯定或否定', preconditions: '前提',
}
const ENUMS: Record<string, Record<string, string>> = {
  narrativeModalityV1: { established: '已确立', belief: '角色信念（可能有误）', intent: '计划或意图（尚未发生）' },
  class: { unclassified: '尚未评审', 'author-only': '仅作者可见', public: '公开', restricted: '指定受众' },
  attitude: { know: '知道', believe: '相信', doubt: '怀疑', unaware: '尚不知情' },
  transition: { acquire: '获得认知', revise: '修订认知', forget: '遗忘', 'deny-awareness': '确认不知情' },
  eventType: { action: '行动', observation: '观察', communication: '消息传递' },
  supportRole: { supports: '支持', contradicts: '反驳', context: '背景' },
  endMeaning: { known: '终点已知', open: '持续有效', unknown: '终点未知' },
  polarity: { positive: '肯定', negative: '否定' },
  developmentType: { thread: '线索', goal: '目标', conflict: '冲突', commitment: '承诺', foreshadow: '伏笔' },
  state: { open: '未展开', advancing: '推进中', blocked: '受阻', resolved: '已解决', fulfilled: '已兑现', abandoned: '已放弃' },
}
const HIDDEN_KEYS = new Set(['semanticSubKey', 'policyVersion', 'evidenceKey', 'evidenceKeys', 'resolutionEvidenceKeys', 'subKey'])
const control = 'w-full rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary'
const button = 'rounded border border-border px-3 py-1.5 text-sm disabled:opacity-40'

function ProposalValue({ value, name, path, names, disabled, readOnly = false, change }: {
  value: unknown; name: string; path: string; names: Map<string, string>; disabled: boolean; readOnly?: boolean; change: (next: unknown) => void
}) {
  const label = LABELS[name] ?? '属性'
  if (value === null) return <p className="text-xs text-text-muted">{label}：未指定</p>
  if (Array.isArray(value)) return <fieldset className="space-y-2 border-l border-border pl-3"><legend className="text-sm">{label}</legend>
    {value.length === 0 && <p className="text-xs text-text-muted">无</p>}
    {value.map((item, index) => <div key={index} className="space-y-1"><ProposalValue value={item} name={name} path={path + '.' + index} names={names} disabled={disabled} readOnly={readOnly}
      change={next => change(value.map((current, at) => at === index ? next : current))}/>
      {!readOnly && <button type="button" className="text-xs text-rose-400" disabled={disabled} onClick={() => change(value.filter((_, at) => at !== index))}>移除此项</button>}</div>)}
  </fieldset>
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>
    if (typeof row.sourceUid === 'string') return <p className="text-sm">{label}：{names.get(row.sourceUid) ?? '选定来源'}</p>
    if (row.self === true) return <p className="text-sm">{label}：当前记录</p>
    return <fieldset className="space-y-2 rounded border border-border p-3"><legend className="px-1 text-sm">{label}</legend>
      {Object.entries(row).filter(([key]) => !HIDDEN_KEYS.has(key)).map(([key, child]) => <ProposalValue key={key} value={child} name={key} path={path + '.' + key}
        names={names} disabled={disabled} readOnly={readOnly} change={next => change({ ...row, [key]: next })}/>)}
      {!readOnly && ['causeEvent', 'sourceEvent'].includes(name) && <button type="button" className="text-xs text-rose-400" disabled={disabled} onClick={() => change(null)}>不认定此关联</button>}
    </fieldset>
  }
  if (name === 'fieldPointer') return <p className="text-xs text-text-muted">{label}：{String(value).replace(/^\//, '')}</p>
  const options = name === 'role' && path.includes('narrativeDependenciesV1')
    ? { supports: '支持', contradicts: '反驳', 'derived-from': '推导自', causes: '导致', requires: '需要' } : ENUMS[name]
  if (readOnly) return <p className="whitespace-pre-wrap text-sm">{label}：{options?.[String(value)] ?? (typeof value === 'boolean' ? value ? '是' : '否' : String(value))}</p>
  return <label className="block space-y-1 text-sm"><span>{label}</span>
    {options ? <select aria-label={label} className={control} value={String(value)} disabled={disabled} onChange={event => change(event.target.value)}>
      {Object.entries(options).map(([key, text]) => <option value={key} key={key}>{text}</option>)}
    </select> : typeof value === 'boolean' ? <input type="checkbox" aria-label={label} checked={value} disabled={disabled} onChange={event => change(event.target.checked)}/>
      : typeof value === 'number' ? <input type="number" aria-label={label} className={control} min={0} step={1} value={value} disabled={disabled} onChange={event => change(Number(event.target.value))}/>
        : <textarea aria-label={label} className={control} rows={name === 'quote' || name === 'statement' ? 3 : 1} value={String(value)} disabled={disabled} onChange={event => change(event.target.value)}/>}
  </label>
}

export default function NarrativeAnnotationPanel({ project, onBack }: { project: Project; onBack: () => void }) {
  const config = useAIConfigStore(state => state.config)
  const groupId = useWorldGroupStore(state => state.activeGroupId)
  const [scope, setScope] = useState<WorkspaceScope | null>(null)
  const [entries, setEntries] = useState<RagLibraryEntry[]>([])
  const [target, setTarget] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [instruction, setInstruction] = useState('区分事实、角色认知和计划；只补充有原文证据的注释，不推测日期或因果。')
  const [run, setRun] = useState<LoadedRun | null>(null)
  const [draft, setDraft] = useState<NarrativeAnnotationProposalV1 | null>(null)
  const [runs, setRuns] = useState<Array<{ id: number; status: string }>>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const names = useMemo(() => new Map(entries.map(entry => [entry.documentId, entry.title])), [entries])
  const targets = useMemo(() => [...new Map(entries.filter(entry => REGISTRY_BY_NAME.get(entry.tableName)?.worldSemantic?.projector)
    .map(entry => [entry.tableName + ':' + entry.documentId, entry])).entries()], [entries])
  const targetEntry = targets.find(([key]) => key === target)?.[1]
  const dirty = !!run?.candidate?.proposal && canonicalNarrativeJsonV1(draft) !== canonicalNarrativeJsonV1(run.candidate.proposal)
  const reviewable = run?.snapshot.projection.state === 'awaiting_confirmation' && !run.staleReason
  const edit = useCallback((loaded: LoadedRun | null) => { setRun(loaded); setDraft(loaded?.candidate?.proposal ? structuredClone(loaded.candidate.proposal) : null) }, [])
  const refresh = useCallback(async (current: WorkspaceScope, runId?: number,
    preserveDraft?: { runId: number; candidateHash: string | undefined }) => {
    const list = await listNarrativeAnnotationRunsV1(current)
    setRuns(list)
    const id = runId ?? list.find(row => ['running', 'paused', 'awaiting_confirmation'].includes(row.status))?.id
    const loaded = id ? await readNarrativeAnnotationRunV1(current, id) : null
    if (loaded && preserveDraft?.runId === loaded.snapshot.run.id
      && preserveDraft.candidateHash === loaded.candidate?.candidateHash) setRun(loaded)
    else edit(loaded)
  }, [edit])
  useEffect(() => {
    let active = true
    setRun(null); setDraft(null); setEntries([]); setSelected([]); setTarget(''); setScope(null)
    void (async () => {
      const current = await resolveScopeLike(project.id!)
      const library = await buildRagLibrary({ projectId: current.projectId, scope: current, worldGroupId: groupId })
      const available = library.filter(entry => entry.enabled && REGISTRY_BY_NAME.get(entry.tableName)?.worldSemantic)
      if (!active) return
      setScope(current); setEntries(available)
      await refresh(current)
    })().catch(error => { if (active) setMessage(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [project.id, project.activeWorkId, project.activeWorldId, groupId, refresh])
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action() }
    catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      // A failed validation must keep the author's unsaved correction. A failed
      // generation must still reveal its persisted unknown-call run.
      if (scope) await refresh(scope, run?.snapshot.run.id, run ? {
        runId: run.snapshot.run.id, candidateHash: run.candidate?.candidateHash,
      } : undefined).catch(() => {})
    }
    finally { setBusy(false) }
  }
  const generate = () => act(async () => {
    if (!scope || !targetEntry) return
    if (!isAIConfigReady(config)) throw new Error(getAIConfigRequiredMessage(config))
    const work = await db.works.get(scope.workId)
    if (!work) throw new Error('当前作品不存在')
    const generated = await generateNarrativeAnnotationCandidateV1({ scope, aiConfig: config, instruction,
      selection: { table: targetEntry.tableName, sourceUid: targetEntry.documentId,
        owner: { kind: 'work', workCode: work.code }, entryKeys: selected } })
    await refresh(scope, generated.snapshot.run.id)
    setMessage('候选已保存。核对原文和修改内容后，再确认写入。')
  })
  return <section className="mx-auto max-w-4xl space-y-5 p-6" aria-label="叙事注释审核">
    <div className="flex items-center justify-between gap-3"><h1 className="text-lg font-semibold">叙事注释（实验）</h1><button className={button} onClick={onBack} disabled={busy}>返回事实库</button></div>
    <p className="text-sm text-text-muted">选择已有记录和原文，生成注释候选。事实、误信、计划和因果会分别保留；每次确认前都会重新核对来源。</p>
    {message && <p role="status" className="rounded border border-border p-3 text-sm whitespace-pre-wrap">{message}</p>}
    {runs.length > 0 && <label className="block text-sm">已保存的审核记录<select className={control} value={run?.snapshot.run.id ?? ''} disabled={busy}
      onChange={event => void act(async () => { if (scope) await refresh(scope, Number(event.target.value)) })}>
      <option value="" disabled>选择审核记录</option>{runs.map(item => <option value={item.id} key={item.id}>审核 {item.id} · {({ completed: '已采纳', cancelled: '已放弃', awaiting_confirmation: '待审核', paused: '需要处理', running: '未完成' } as Record<string, string>)[item.status] ?? '未完成'}</option>)}
    </select></label>}
    {run && <article className="space-y-4 rounded border border-border p-4">
      <h2 className="font-medium">{run.candidate ? '候选版本 ' + run.candidate.revision : '未完成的生成'}</h2>
      <p className="text-sm text-text-muted">{run.staleReason ? '来源已变化，这份候选或完成回执已过期。请保留原始记录并重新审核。'
        : reviewable ? '等待作者审核；来源尚未写入。' : run.needsReverification ? '这是从备份恢复的已采纳记录，需要核验当前内容。'
        : run.snapshot.projection.state === 'completed' ? '本次注释已采纳。' : '此运行不能直接采纳。可检查保存的响应并放弃；系统不会自动重发模型请求。'}</p>
      <details><summary className="cursor-pointer text-sm">核对本次使用的原文</summary><div className="space-y-3 py-3">
        {run.state.baseline.originalFields.map(field => <blockquote key={field.key} className="whitespace-pre-wrap border-l border-border pl-3 text-sm"><strong>{names.get(field.sourceUid) ?? '来源'}</strong><p>{field.text}</p></blockquote>)}
      </div></details>
      {run.state.baseline.targetState && <details><summary className="cursor-pointer text-sm">核对修改前已有的注释</summary>
        <p className="py-2 text-xs text-text-muted">这些是本次修改前保存的内容，供比较和保留记录身份；不作为新增的故事原文证据。</p>
        <div className="space-y-3 py-3">{Object.entries(run.state.baseline.targetState.annotations).map(([field, value]) =>
          <ProposalValue key={field} value={value} name={field} path={field} names={names} disabled readOnly change={() => {}}/>)}
          {!Object.keys(run.state.baseline.targetState.annotations).length && <p className="text-sm text-text-muted">没有既有的发展或揭示注释。</p>}
        </div>
      </details>}
      {draft && <div className="space-y-3">{Object.entries(draft.annotations).map(([field, value]) => <div key={field} className="space-y-2">
        <ProposalValue value={value} name={field} path={field} names={names} disabled={busy || !reviewable}
          change={next => setDraft({ ...draft, annotations: { ...draft.annotations, [field]: next } })}/>
        <button className="text-xs text-rose-400" disabled={busy || !reviewable} onClick={() => { const annotations = { ...draft.annotations }; delete annotations[field]; setDraft({ ...draft, annotations }) }}>不采纳这一项修改</button>
      </div>)}
      {draft.clearFields.length > 0 && <p className="text-sm text-amber-300">将清除：{draft.clearFields.map(field => LABELS[field] ?? '注释').join('、')}</p>}
      </div>}
      {run.candidate?.artifact.issues.map((issue, index) => <p key={index} className="text-sm text-amber-300">{issue.message}</p>)}
      <details><summary className="cursor-pointer text-sm">查看模型原始响应与调用情况</summary><p className="py-2 text-xs text-text-muted">{run.state.model.model} · 已调用 {run.state.calls.length} 次 · 原文目录重读 {run.state.context.catalogReadRestarts ?? 0} 次</p>
        {run.state.calls.map(call => <pre key={call.index} className="whitespace-pre-wrap break-words rounded bg-bg-base p-3 text-xs">{call.output ?? '请求结果未知；没有可确认的响应。'}</pre>)}
      </details>
      <div className="flex flex-wrap gap-2">
        {run.needsReverification && !run.staleReason && <button className={button} disabled={busy} onClick={() => void act(async () => {
          await adoptNarrativeAnnotationCandidateV1({ scope: scope!, runId: run.snapshot.run.id, candidateHash: run.candidate!.candidateHash })
          await refresh(scope!, run.snapshot.run.id); setMessage('已核验恢复后的内容，原采纳内容没有重写。')
        })}>核验已采纳内容</button>}
        {reviewable && <><button className={button} disabled={busy || !dirty || !draft} onClick={() => void act(async () => {
          await reviseNarrativeAnnotationCandidateV1({ scope: scope!, runId: run.snapshot.run.id, expectedCandidateHash: run.candidate!.candidateHash, draft: canonicalNarrativeJsonV1(draft) })
          await refresh(scope!, run.snapshot.run.id); setMessage('修改已保存并通过校验，请确认这一版本。')
        })}>保存审核修改</button>
        <button className={button + ' bg-emerald-600/20'} disabled={busy || dirty || !run.candidate || !creativeArtifactCanAdoptV1(run.candidate.artifact)} onClick={() => void act(async () => {
          await adoptNarrativeAnnotationCandidateV1({ scope: scope!, runId: run.snapshot.run.id, candidateHash: run.candidate!.candidateHash })
          await refresh(scope!, run.snapshot.run.id); setMessage('已确认并写入原领域记录，节点和分步骤将读取同一份注释。')
        })}>确认写入注释</button>
        <button className={button} disabled={busy} onClick={() => void act(async () => {
          await rejectNarrativeAnnotationCandidateV1({ scope: scope!, runId: run.snapshot.run.id, candidateHash: run.candidate!.candidateHash }); await refresh(scope!); setMessage('已拒绝，原记录未改变。')
        })}>拒绝候选</button></>}
        {(['running', 'paused'].includes(run.snapshot.projection.state) || (run.staleReason && run.snapshot.projection.state === 'awaiting_confirmation')) && <button className={button} disabled={busy} onClick={() => void act(async () => {
          await abandonNarrativeAnnotationRunV1({ scope: scope!, runId: run.snapshot.run.id }); await refresh(scope!); setMessage('已放弃此次运行。原始响应和来源记录仍可查看。')
        })}>放弃此次运行</button>}
        {!['running', 'paused', 'awaiting_confirmation'].includes(run.snapshot.projection.state) && <button className={button} disabled={busy} onClick={() => edit(null)}>开始新的审核</button>}
      </div>
    </article>}
    {!run && <div className="space-y-4 rounded border border-border p-4">
      <label className="block text-sm">要整理的记录<select className={control} value={target} disabled={busy} onChange={event => {
        const key = event.target.value, entry = targets.find(([value]) => value === key)?.[1]; setTarget(key)
        setSelected(entry ? entries.filter(item => item.documentId === entry.documentId).map(item => item.key) : [])
      }}><option value="">请选择已有记录</option>{targets.map(([key, entry]) => <option value={key} key={key}>{entry.sourceLabel} · {entry.title}</option>)}</select></label>
      <fieldset className="max-h-64 overflow-auto space-y-2"><legend className="mb-2 text-sm">本次允许读取的字段（可补充相关角色、事件或章节）</legend>
        {entries.map(entry => <label key={entry.key} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.includes(entry.key)} disabled={busy}
          onChange={event => setSelected(event.target.checked ? [...selected, entry.key] : selected.filter(key => key !== entry.key))}/><span>{entry.title} · {entry.fieldLabel}</span></label>)}
        {!entries.length && <p className="text-sm text-text-muted">当前范围没有可读取的已有记录。请先填写来源内容并准备稳定身份。</p>}
      </fieldset>
      <p className="text-xs text-text-muted">所选目标已有的发展与揭示注释会一并提供，供模型保留记录身份；它们会与原文分开展示。</p>
      <label className="block text-sm">这次需要整理什么<textarea className={control} rows={3} maxLength={4000} value={instruction} disabled={busy} onChange={event => setInstruction(event.target.value)}/></label>
      <button className={button} disabled={busy || !scope || !targetEntry || !selected.length || !instruction.trim()} onClick={() => void generate()}>{busy ? '正在生成并保存…' : '生成注释候选'}</button>
    </div>}
  </section>
}
