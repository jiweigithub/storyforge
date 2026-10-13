import { useEffect, useRef, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { ChatAuthoringDraftV1, ChatAuthoringSettings } from '../../lib/character-interaction/authoring-contract'
import { confirmChatSourceReviewV1, loadChatSourceProjectionV1 } from '../../lib/character-interaction/draft-service'
import { readPreparedChatSourceProjectionViewV1, type ChatSourceClassificationV1, type ChatSourceProjectionDraftV1 } from '../../lib/character-interaction/source-projection'
import { FIELD_BY_TARGET } from '../../lib/registry/field-registry'
import { MORAL_AXIS_LABELS, ORDER_AXIS_LABELS, ROLE_WEIGHT_LABELS } from '../../lib/character/character-axes'

const PURPOSES = {identity: '身份与价值观', motivation: '目标与顾虑', voice: '语言与举止', knowledge: '事实与经历'} as const
const VISIBILITY = {unclassified: '待分类，暂不使用', public: '所有参与者知道', participants: '仅指定参与者知道', 'author-only': '仅作者掌握'} as const
const FIELD_LABELS: Record<string, string> = {
  roleWeight: '人物地位', moralAxis: '道德立场', orderAxis: '秩序立场',
  ...Object.fromEntries((FIELD_BY_TARGET.get('characters') ?? []).filter(field => field.labels?.length).map(field => [field.field, field.labels![0]])),
}
const fieldName = (pointer: string) => pointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~')
const fieldLabel = (pointer: string) => FIELD_LABELS[fieldName(pointer)] ?? fieldName(pointer)
function readableValue(pointer: string, valueJson: string): string {
  const value: unknown = JSON.parse(valueJson)
  const enums: Record<string, Record<string, string>> = {moralAxis: MORAL_AXIS_LABELS, orderAxis: ORDER_AXIS_LABELS, roleWeight: ROLE_WEIGHT_LABELS}
  return typeof value === 'string' ? enums[fieldName(pointer)]?.[value] ?? value : JSON.stringify(value, null, 2)
}

export default function SourceReview(props: {
  scope: WorkspaceScope
  draft: ChatAuthoringDraftV1
  settings: ChatAuthoringSettings
  dirty: boolean
  onConfirmed: () => void
}) {
  const [projection, setProjection] = useState<ChatSourceProjectionDraftV1 | null>(null)
  const [decisions, setDecisions] = useState<ChatSourceClassificationV1[]>([])
  const [viewer, setViewer] = useState('player')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef({value: 0}).current
  useEffect(() => { generation.value++; setProjection(null); setDecisions([]); setError(''); setViewer('player'); setBusy(false)
    return () => { generation.value++ }
  }, [generation, props.scope.workId, props.draft.revision])
  const load = async () => {
    const ticket = ++generation.value
    setBusy(true); setError('')
    try {
      const next = await loadChatSourceProjectionV1(props.scope, props.draft.revision)
      const saved = props.settings.version !== 1 && props.settings.sourceReview?.projectionHash === next.projectionHash ? props.settings.sourceReview : null
      if (saved) readPreparedChatSourceProjectionViewV1({draft: next, review: saved, viewerKey: 'player'})
      const savedDecisions = new Map(saved?.classifications.map(row => [row.fragmentKey, row]))
      const nextDecisions = next.characters.flatMap(c => c.fragments.map(fragment => savedDecisions.get(fragment.fragmentKey) ?? ({
        projectionHash: next.projectionHash, fragmentKey: fragment.fragmentKey,
        purpose: 'knowledge' as const, visibility: 'unclassified' as const, audienceKeys: [],
      })))
      readPreparedChatSourceProjectionViewV1({draft: next, review: {projectionHash: next.projectionHash, classifications: nextDecisions}, viewerKey: 'player'})
      if (ticket !== generation.value) return
      setProjection(next); setDecisions(nextDecisions)
    } catch (reason) { if (ticket === generation.value) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (ticket === generation.value) setBusy(false) }
  }
  const change = (fragmentKey: string, patch: Partial<ChatSourceClassificationV1>) => {
    setDecisions(rows => rows.map(row => row.fragmentKey === fragmentKey ? {...row, ...patch} : row))
  }
  const saveReview = async () => {
    if (!projection) return
    const ticket = ++generation.value
    setBusy(true); setError('')
    try {
      await confirmChatSourceReviewV1(props.scope, props.draft.revision, {projectionHash: projection.projectionHash, classifications: decisions})
      if (ticket !== generation.value) return
      setProjection(null)
      props.onConfirmed()
    } catch (reason) { if (ticket === generation.value) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (ticket === generation.value) setBusy(false) }
  }
  const disabled = busy || props.dirty
  const audiences = [{key: 'player', name: '玩家'}, ...(projection?.characters.map(c => ({key: c.resourceKey, name: c.label})) ?? [])]
  const preview = projection ? readPreparedChatSourceProjectionViewV1({draft: projection, review: {projectionHash: projection.projectionHash, classifications: decisions}, viewerKey: viewer}) : []
  return <section className="mt-6 space-y-3 border-t border-border pt-4" aria-label="角色来源资料检查">
    <h4>角色来源资料与知识范围</h4>
    <p>逐项决定谁知道什么。角色自己未知的真相、未来结局可保留给作者；待分类资料不会进入聊天。目标与顾虑表示角色的意愿。</p>
    <p>{props.settings.version === 1 ? '当前方案使用旧版人物摘要。确认完整资料后，新制作将使用分角色的知识范围；已有发布与存档保持原样。'
      : props.settings.sourceReview ? '已保存资料确认。更换角色或世界后需要重新检查。' : '开始新制作前，请检查并确认角色资料的可见范围。'}</p>
    {props.dirty && <p>请先保存方案，再检查资料。</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <button type="button" className="lf-action" disabled={disabled} onClick={() => void load()}>{busy ? '正在处理…' : '读取并检查完整资料'}</button>
    {projection && <>
      <div className="space-y-3">{projection.characters.map(character => <details key={character.resourceKey} open>
        <summary>{character.label}</summary>
        {character.fragments.map(fragment => {
          const decision = decisions.find(row => row.fragmentKey === fragment.fragmentKey) ?? {purpose: 'knowledge', visibility: 'unclassified', audienceKeys: []}
          return <div key={fragment.fragmentKey} className="my-3 space-y-2 rounded border border-border p-3">
            <strong>{fieldLabel(fragment.pointer)}</strong>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{readableValue(fragment.pointer, fragment.valueJson)}</pre>
            <div className="flex flex-wrap gap-3">
              <label>资料用途<select disabled={disabled} aria-label={`${character.label} ${fieldLabel(fragment.pointer)} 用途`} value={decision.purpose} onChange={e => change(fragment.fragmentKey, {purpose: e.target.value as ChatSourceClassificationV1['purpose']})}>{Object.entries(PURPOSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>谁知道<select disabled={disabled} aria-label={`${character.label} ${fieldLabel(fragment.pointer)} 可见范围`} value={decision.visibility} onChange={e => change(fragment.fragmentKey, {visibility: e.target.value as ChatSourceClassificationV1['visibility'], audienceKeys: e.target.value === 'participants' ? [character.resourceKey] : []})}>{Object.entries(VISIBILITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            {decision.visibility === 'participants' && <div className="flex flex-wrap gap-3">{audiences.map(audience => <label key={audience.key}><input type="checkbox" disabled={disabled || decision.audienceKeys.length === 1 && decision.audienceKeys.includes(audience.key)} checked={decision.audienceKeys.includes(audience.key)} onChange={e => change(fragment.fragmentKey, {audienceKeys: e.target.checked ? [...decision.audienceKeys, audience.key] : decision.audienceKeys.filter(key => key !== audience.key)})}/>{audience.name}</label>)}</div>}
          </div>
        })}
      </details>)}</div>
      <details><summary>检查参与者实际获得的资料</summary><label>查看视角<select value={viewer} onChange={e => setViewer(e.target.value)}>{audiences.map(a => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
        {preview.length ? preview.map(fragment => <p className="whitespace-pre-wrap break-words text-xs" key={fragment.fragmentKey}>{PURPOSES[fragment.purpose]} · {fieldLabel(fragment.pointer)}：{readableValue(fragment.pointer, fragment.valueJson)}</p>) : <p>这个视角还没有获准读取的来源资料。</p>}
      </details>
      <button type="button" className="lf-action lf-action-primary" disabled={disabled} onClick={() => void saveReview()}>确认可见范围并用于新制作</button>
    </>}
  </section>
}
