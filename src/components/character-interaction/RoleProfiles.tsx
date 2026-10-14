import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import type {ChatAuthoringDraftV1, ChatAuthoringSettings} from '../../lib/character-interaction/authoring-contract'
import type {ChatSourceProjectionDraftV1} from '../../lib/character-interaction/source-projection'
import {readChatSourceReviewContextV1, type ChatSourceReviewContextV1} from '../../lib/character-interaction/source-review-context'
import {CHAT_ROLE_TRAIT_LABELS, parseChatRoleProfileSetV1, validateChatRoleProfilesForSourceV1, type ChatRoleProfileCandidateV1} from '../../lib/character-interaction/role-profile'
import {confirmChatRoleProfileV1, removeChatRoleProfileV1} from '../../lib/character-interaction/role-profile-store'

type Trait = ChatRoleProfileCandidateV1['traits'][number]
const blank = (): Trait => ({kind: 'value', text: '', evidence: [{fragmentKey: '', quote: ''}]})
export default function RoleProfiles(props: {
  scope: WorkspaceScope; draft: ChatAuthoringDraftV1; settings: ChatAuthoringSettings
  projection: ChatSourceProjectionDraftV1; selectedKeys: string[]; disabled: boolean; onConfirmed: () => void
}) {
  const [actorKey, setActorKey] = useState('')
  const [context, setContext] = useState<ChatSourceReviewContextV1 | null>(null)
  const [traits, setTraits] = useState<Trait[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const epoch = useRef({value: 0}).current
  useEffect(() => {epoch.value++; setContext(null); setTraits([]); setActorKey(''); setBusy(false); setError(''); return () => {epoch.value++}}, [epoch, props.scope.workId, props.draft.revision, props.projection.projectionHash])
  let saved: ReturnType<typeof parseChatRoleProfileSetV1> | undefined, invalid = ''
  try {saved = props.draft.roleProfilesJson === undefined ? undefined : parseChatRoleProfileSetV1(JSON.parse(props.draft.roleProfilesJson))}
  catch (cause) {invalid = cause instanceof Error ? cause.message : String(cause)}
  const act = async (action: (ticket: number) => Promise<void>) => {
    const ticket = ++epoch.value; setBusy(true); setError('')
    try {await action(ticket)} catch (cause) {if (ticket === epoch.value) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (ticket === epoch.value) setBusy(false)}
  }
  const prepare = (key: string, fragmentKeys: string[], candidate?: ChatRoleProfileCandidateV1) => act(async ticket => {
    const next = await readChatSourceReviewContextV1(props.scope, {actorKey: key, fragmentKeys, draftRevision: props.draft.revision, projectionHash: props.projection.projectionHash})
    if (ticket === epoch.value) {setActorKey(key); setContext(next); setTraits(candidate ? structuredClone(candidate.traits) : [blank()])}
  })
  const change = (index: number, patch: Partial<Trait>) => setTraits(rows => rows.map((row, i) => i === index ? {...row, ...patch} : row))
  const disabled = busy || props.disabled
  return <section aria-label="人物特征整理" className="space-y-3 rounded border border-border p-3">
    <h5>人物特征整理</h5>
    <p>把已确认的原文整理成角色的价值观、期望、顾虑、底线和说话习惯，每项保留引用。保存后用于新制作的情境与角色演绎，已有发布和存档保持原样。</p>
    <p>在这里填写自己的理解，并引用依据。上方建议供你参考，保存前请逐项核对。</p>
    {invalid && <p role="alert" className="text-danger">{invalid}</p>}
    {saved?.profiles.map(profile => {
      const label = props.projection.characters.find(row => row.resourceKey === profile.actorKey)?.label ?? '历史人物'
      let issue = ''
      try {
        if (props.settings.version === 1 || !props.settings.sourceReview) throw new Error('须重新确认资料知情范围')
        validateChatRoleProfilesForSourceV1({...saved!, profiles: [profile]}, props.projection, props.settings.sourceReview)
      } catch (cause) {issue = cause instanceof Error ? cause.message : String(cause)}
      return <article key={profile.actorKey} data-testid="chat-role-profile" className="space-y-2 rounded bg-bg-base p-3">
        <strong>{label} · 已保存人物整理</strong>
        {issue && <p role="status" className="text-danger">{issue}；新制作暂不能使用这份整理。</p>}
        {profile.candidate.traits.map((trait, index) => <div key={index}><p>{CHAT_ROLE_TRAIT_LABELS[trait.kind]}：{trait.text}</p>{trait.evidence.map((evidence, i) => <blockquote className="border-l-2 border-border pl-3 text-xs" key={i}>{evidence.quote}</blockquote>)}</div>)}
        <button type="button" className="lf-action" disabled={disabled} onClick={() => void prepare(profile.actorKey, profile.sourceFragments.map(row => row.fragmentKey), profile.candidate)}>编辑并重新确认{label}的整理</button>
        <button type="button" className="lf-action" disabled={disabled} onClick={() => void act(async () => {await removeChatRoleProfileV1(props.scope, props.draft.revision, profile.actorKey); props.onConfirmed()})}>移除{label}的整理</button>
      </article>
    })}
    <label>整理人物<select aria-label="整理人物" disabled={disabled} value={actorKey} onChange={event => {setActorKey(event.target.value); setContext(null); setTraits([])}}>
      <option value="">请选择角色</option>{props.projection.characters.map(row => <option key={row.resourceKey} value={row.resourceKey}>{row.label}</option>)}
    </select></label>
    <p>使用下方勾选的 {props.selectedKeys.length} 项原文；所有原文都须在该角色已保存的知情范围内。</p>
    <button type="button" className="lf-action" disabled={disabled || !actorKey || !props.selectedKeys.length || props.selectedKeys.length > 12}
      onClick={() => void prepare(actorKey, [...props.selectedKeys])}>手工整理所选原文</button>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {context && <div className="space-y-3">
      <p>本次人物：{props.projection.characters.find(row => row.resourceKey === context.perspective?.actorKey)?.label}。整理不是原文事实，目标也不代表行动已经完成；保存前请核对主体、否定、条件和时态。</p>
      {traits.map((trait, index) => <fieldset key={index} className="space-y-2 rounded border border-border p-3" data-testid="chat-role-trait-editor">
        <legend>特征 {index + 1}</legend>
        <label>类别<select aria-label={`特征 ${index + 1} 类别`} disabled={disabled} value={trait.kind} onChange={event => change(index, {kind: event.target.value as Trait['kind']})}>{Object.entries(CHAT_ROLE_TRAIT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block">整理内容<textarea className="w-full" aria-label={`特征 ${index + 1} 内容`} maxLength={600} disabled={disabled} value={trait.text} onChange={event => change(index, {text: event.target.value})}/></label>
        {trait.evidence.map((evidence, evidenceIndex) => {
          const source = context.fragments.find(row => row.fragmentKey === evidence.fragmentKey)
          const quoteValue: unknown = source ? JSON.parse(source.valueJson) : null
          const update = (patch: Partial<Trait['evidence'][number]>) => change(index, {evidence: trait.evidence.map((row, i) => i === evidenceIndex ? {...row, ...patch} : row)})
          return <div key={evidenceIndex} className="space-y-2">
            <label>原文依据<select aria-label={`特征 ${index + 1} 依据 ${evidenceIndex + 1} 来源`} disabled={disabled} value={evidence.fragmentKey} onChange={event => update({fragmentKey: event.target.value, quote: ''})}>
              <option value="">请选择原文</option>{context.fragments.map((row, i) => <option key={row.fragmentKey} value={row.fragmentKey}>资料 {i + 1} · {row.resourceKey === context.perspective!.actorKey ? '本人' : '背景或他人'} · {row.pointer}</option>)}
            </select></label>
            {source && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{typeof quoteValue === 'string' ? quoteValue : source.valueJson}</pre>}
            <label className="block">连续原文引用<textarea aria-label={`特征 ${index + 1} 依据 ${evidenceIndex + 1} 引用`} className="w-full" disabled={disabled} maxLength={800} value={evidence.quote} onChange={event => update({quote: event.target.value})}/></label>
            {trait.evidence.length > 1 && <button type="button" className="lf-action" disabled={disabled} onClick={() => change(index, {evidence: trait.evidence.filter((_, i) => i !== evidenceIndex)})}>移除依据 {evidenceIndex + 1}</button>}
          </div>
        })}
        <button type="button" className="lf-action" disabled={disabled || trait.evidence.length >= 4} onClick={() => change(index, {evidence: [...trait.evidence, {fragmentKey: '', quote: ''}]})}>增加依据</button>
        <button type="button" className="lf-action" disabled={disabled} onClick={() => setTraits(rows => rows.filter((_, i) => i !== index))}>移除特征 {index + 1}</button>
      </fieldset>)}
      <p>整理正文共 {traits.reduce((sum, row) => sum + row.text.length, 0)} / 3000 字符。</p>
      <button type="button" className="lf-action" disabled={disabled || traits.length >= 12} onClick={() => setTraits(rows => [...rows, blank()])}>增加人物特征</button>
      <button type="button" className="lf-action lf-action-primary" disabled={disabled || !traits.length} onClick={() => void act(async () => {
        await confirmChatRoleProfileV1(props.scope, {draftRevision: context.draftRevision, projectionHash: context.projectionHash, actorKey: context.perspective!.actorKey, fragmentKeys: context.fragments.map(row => row.fragmentKey)}, {traits})
        props.onConfirmed()
      })}>确认人物整理并用于新制作</button>
    </div>}
  </section>
}
