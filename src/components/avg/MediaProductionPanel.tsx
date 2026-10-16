import { useEffect, useMemo, useState } from 'react'
import type { FrozenRuntimeMediaAssetV2, ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import { avgMediaProductionEnabledV2 } from '../../lib/avg/assembly-contract'
import { avgMediaChoiceArtifactKeyV1, avgRawMediaArtifactKeyV1, parseAvgVisualProductionRequirementV1,
  type AvgVisualProductionRequirementV1 } from '../../lib/avg/media-production-contract'
import { parseAvgMediaReferencesV1, type AvgMediaReferenceV1 } from '../../lib/avg/media-reference-contract'
import { importAvgMediaForAssemblyV1 } from '../../lib/avg/editor-service'
import { configureAvgChosenMediaDraftV2, confirmAvgWorkspaceInputV1, stageAvgMediaChoiceV2, type readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import MediaAssetPreview from './MediaAssetPreview'
import { inspectConfiguredAgnesImageCapabilityV1 } from '../../lib/product-production/media-transport'

type View = Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Kind = 'background' | 'character-pose' | 'character-expression' | 'cg' | 'icon' | 'detail' | 'reference'
const KINDS: Array<[Kind, string]> = [['background', '场景背景'], ['character-pose', '角色立绘'], ['character-expression', '角色表情'],
  ['cg', '场景 CG'], ['icon', '物品图标'], ['detail', '物件详情图'], ['reference', '主体参考图']]
const PURPOSES: Array<[AvgMediaReferenceV1['purpose'], string]> = [['identity', '身份'], ['pose', '姿态'], ['composition', '构图'], ['style', '风格'], ['detail', '细节']]
const SIZES = [{ label: '横图 16:9', width: 576, height: 324 }, { label: '竖图 3:4', width: 576, height: 768 },
  { label: '方图 1:1', width: 512, height: 512 }, { label: '横图 4:3', width: 640, height: 480 }]
const hashOf = (row?: ProductBuildArtifactRecordV1) => { try { return String(JSON.parse(row?.metadataJson ?? '{}').candidateHash ?? '') } catch { return '' } }

function RawChoiceCard({ scope, productionId, requirement, raw, pending, selected, disabled, canAdopt, declaration, expanded, onExpand, onAction, onReload }: {
  scope: WorkspaceScope; productionId: number; requirement: AvgVisualProductionRequirementV1; raw?: ProductBuildArtifactRecordV1;
  pending?: ProductBuildArtifactRecordV1; selected?: ProductBuildArtifactRecordV1; disabled: boolean; canAdopt: boolean; declaration: string;
  expanded: boolean; onExpand: () => void;
  onAction: (task: () => Promise<void>) => Promise<void>; onReload: () => Promise<void>
}) {
  const [observed, setObserved] = useState(''), [reviewed, setReviewed] = useState('')
  useEffect(() => { setObserved('') }, [expanded, raw?.contentHash])
  const asset = useMemo(() => { try { return raw ? JSON.parse(raw.metadataJson) as FrozenRuntimeMediaAssetV2 : null } catch { return null } }, [raw])
  const candidateHash = hashOf(pending)
  let cost: unknown = null
  try { cost = raw ? JSON.parse(raw.payloadJson).provider.costUsd : null } catch { /* Reader reports damaged evidence before preview/selection. */ }
  const reviewedKey = `${raw?.contentHash ?? ''}:${candidateHash}`
  return <article className="avg-assembly-candidate" aria-label={`图片候选：${requirement.name}`}><h5>{requirement.name}</h5>
    <p>{selected ? '已确认选用' : raw ? '原图已接收，等待作者选择' : '等待生成'}{pending ? ` · 选图候选 v${pending.version}` : ''}</p>
    {raw && asset && <button className="lf-action" onClick={onExpand}>{expanded ? '隐藏原图' : '查看原图'}：{requirement.name}</button>}
    {raw && asset && expanded && <><MediaAssetPreview scope={scope} asset={asset} productionId={productionId}
      raw={{ requirementKey: requirement.requirementKey, version: raw.version, contentHash: raw.contentHash }} onObserved={() => setObserved(raw.contentHash)} />
      <p>{typeof cost === 'number' ? `已记录费用：$${cost}` : '费用未知，请核对供应商账单。'} 使用前须核对本账号输出条款及参考授权。</p>
      <button className="lf-action" disabled={disabled || !canAdopt || !!selected || observed !== raw.contentHash} onClick={() => void onAction(async () => {
        await stageAvgMediaChoiceV2({ scope, productionId, requirementKey: requirement.requirementKey, rawVersion: raw.version, rawContentHash: raw.contentHash, declaration })
        await onReload()
      })}>保存选图候选：{requirement.name}</button>
      {pending && <><details><summary>查看选图版本、用途与声明</summary><pre>{pending.payloadJson}</pre></details>
        <label><input type="checkbox" disabled={disabled || !canAdopt || observed !== raw.contentHash} checked={reviewed === reviewedKey}
          onChange={event => setReviewed(event.target.checked ? reviewedKey : '')} />我已查看这张图片并核对用途、来源与使用权</label>
        <button className="lf-action" disabled={disabled || !canAdopt || !candidateHash || observed !== raw.contentHash || reviewed !== reviewedKey} onClick={() => void onAction(async () => {
          await confirmAvgWorkspaceInputV1({ scope, productionId, artifactKey: pending.artifactKey, candidateVersion: pending.version, candidateHash })
          await onReload()
        })}>确认选用：{requirement.name}</button></>}
    </>}
    {raw && !asset && <p role="alert">原图记录无法读取，请保留制作记录后检查备份。</p>}
  </article>
}

/** An author-facing shell over existing draft, Harness and adoption services.
 * Editing requirements never dispatches, adopts or silently replaces pixels. */
export default function MediaProductionPanel({ scope, view, workspace, disabled, canEdit, canAdopt, sourcesReady, declaration, generating, visible,
  onPending, onAction, onSave, onClear, onReload, onNotice, onGenerate, onCancel }: {
  scope: WorkspaceScope; view: View; workspace: AvgAuthorWorkspaceV1; disabled: boolean; canEdit: boolean; canAdopt: boolean; sourcesReady: boolean;
  declaration: string; generating: boolean; visible: boolean; onPending: (pending: boolean) => void; onAction: (task: () => Promise<void>) => Promise<void>;
  onSave: (requirements: AvgVisualProductionRequirementV1[]) => Promise<void>; onClear: () => Promise<void>; onReload: () => Promise<void>; onNotice: (notice: string) => void;
  onGenerate: () => Promise<void>; onCancel: () => void
}) {
  const batchJson = JSON.stringify(workspace.mediaBatch ?? null)
  const [requirements, setRequirements] = useState(workspace.mediaBatch?.requirements ?? [])
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const [kind, setKind] = useState<Kind>('background'), [sceneKey, setSceneKey] = useState(''), [subject, setSubject] = useState(''), [variant, setVariant] = useState('')
  const [lineKey, setLineKey] = useState(''), [name, setName] = useState(''), [prompt, setPrompt] = useState(''), [negative, setNegative] = useState('')
  const [invariants, setInvariants] = useState(''), [forbidden, setForbidden] = useState(''), [size, setSize] = useState(0), [tier, setTier] = useState<'1K' | '2K'>('1K')
  const [alpha, setAlpha] = useState(false), [references, setReferences] = useState<AvgMediaReferenceV1[]>([])
  const [referenceKey, setReferenceKey] = useState(''), [purpose, setPurpose] = useState<AvgMediaReferenceV1['purpose']>('style'), [allowedChange, setAllowedChange] = useState('')
  const [externalAllowed, setExternalAllowed] = useState(false), [derivativeAllowed, setDerivativeAllowed] = useState(false)
  const [referenceFile, setReferenceFile] = useState<File | null>(null), [referenceLicense, setReferenceLicense] = useState('')
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(!workspace.mediaBatch?.requirements.length)
  useEffect(() => { const saved = JSON.parse(batchJson) as AvgAuthorWorkspaceV1['mediaBatch'] | null; setRequirements(saved?.requirements ?? []); setPending(false); setFormOpen(!saved?.requirements.length) }, [batchJson])
  useEffect(() => { onPending(pending) }, [pending, onPending])
  const changed = () => setPending(true)
  const scene = workspace.systemPlan.scenes.find(scene => scene.key === sceneKey) ?? workspace.systemPlan.scenes[0]
  const script = workspace.scripts.find(script => script.sceneKey === scene?.key)
  const trigger = script?.lines.find(line => line.lineKey === lineKey) ?? script?.lines[0]
  const items = workspace.systemPlan.version === 2 ? workspace.systemPlan.inventory.items : []
  const actor = kind.startsWith('character-'), itemKind = kind === 'icon' || kind === 'detail'
  const subjects = actor ? workspace.systemPlan.characters.map(c => ({ key: c.key, label: c.displayName, kind: 'character' }))
    : itemKind ? items.map(item => ({ key: item.key, label: item.name, kind: 'item' }))
      : kind === 'reference' ? [...workspace.systemPlan.characters.map(c => ({ key: c.key, label: c.displayName, kind: 'character' })),
        ...workspace.systemPlan.scenes.map(s => ({ key: s.key, label: s.title, kind: 'scene' })), ...items.map(i => ({ key: i.key, label: i.name, kind: 'item' }))]
        : scene ? [{ key: scene.key, label: scene.title, kind: 'scene' }] : []
  const target = subjects.find(s => s.key === subject) ?? subjects[0]
  const targetItem = items.find(i => i.key === target?.key)
  const importImages = view.media.items.map(row => row.asset).filter(asset => asset.mimeType.startsWith('image/'))
  const build = view.details?.build, productionId = view.details?.production.id
  const assembly = view.details?.executionBrief?.avgAssembly
  const currentBatch = assembly?.version === 2 ? assembly.mediaBatch : null
  const accepted = (key: string) => view.artifacts.find(row => row.artifactKey === key && row.status === 'accepted')
  const allChoices = !!currentBatch && currentBatch.requirements.every(r => accepted(avgMediaChoiceArtifactKeyV1(r.requirementKey)))
  const outstanding = currentBatch?.requirements.filter(r => !accepted(avgRawMediaArtifactKeyV1(r.requirementKey))).length ?? 0
  const expandedKey = previewKey ?? currentBatch?.requirements.find(r => accepted(avgRawMediaArtifactKeyV1(r.requirementKey)))?.requirementKey
  const enabled = avgMediaProductionEnabledV2()
  const readiness = inspectConfiguredAgnesImageCapabilityV1({ projectId: scope.projectId })
  const resetReferenceConsent = () => { setExternalAllowed(false); setDerivativeAllowed(false) }
  const addRequirement = () => {
    try {
      if (!target) throw new Error('请先在系统规则中声明图片主体')
      if (requirements.length >= 8) throw new Error('每批最多 8 项，请分批制作')
      const id = crypto.randomUUID(), isReference = kind === 'reference', stage = !itemKind && !isReference
      const r = parseAvgVisualProductionRequirementV1({ requirementKey: `image.${id}`, revision: 1, assetKey: `avg.generated.${id}`, name, altText: name,
        family: { subjectKey: target.key, familyKey: `avg.family.${target.kind}.${target.key}`, variantKey: `variant.${id}`, revision: 1 },
        consumer: { consumerKey: `image.${id}`, domain: isReference ? 'reference' : itemKind ? kind === 'icon' ? 'inventory' : 'evidence' : 'stage',
          slot: isReference ? target.kind === 'character' ? 'identity' : 'style' : kind === 'icon' ? 'icon' : kind === 'detail' ? 'detail' : actor ? 'actor' : kind === 'cg' ? 'cg' : 'background',
          subjectKey: target.key, sceneKey: stage ? scene?.key : null, lineKey: null, required: !isReference, fallback: isReference ? 'omit' : 'none' },
        triggerBeatKey: stage ? trigger?.lineKey ?? null : null, itemVariantKey: itemKind ? variant || null : null,
        mediaKind: isReference ? target.kind === 'character' ? 'character-pose' : target.kind === 'scene' ? 'background' : 'cg' : kind === 'icon' ? 'ui' : kind === 'detail' ? 'cg' : kind,
        prompt, negativePrompt: negative, invariants: invariants.split('\n').map(s => s.trim()).filter(Boolean), forbiddenDepictions: forbidden.split('\n').map(s => s.trim()).filter(Boolean),
        width: SIZES[size].width, height: SIZES[size].height, resolutionTier: tier, alpha: alpha ? 'required' : 'not-required', references })
      setRequirements([...requirements, r]); setName(''); setPrompt(''); setReferences([]); resetReferenceConsent(); setPending(true); setFormOpen(false); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const addReference = () => {
    try {
      const asset = importImages.find(asset => asset.assetKey === referenceKey)
      if (!asset) throw new Error('请选择当前作品已导入的参考图')
      const next = parseAvgMediaReferencesV1([...references, { assetKey: asset.assetKey, assetVersion: asset.version, contentHash: asset.contentHash,
        mimeType: asset.mimeType, byteSize: asset.byteSize, purpose, allowedChange, dataClass: 'avg-authorized-reference', license: asset.license,
        providerInputAllowed: externalAllowed, derivativeUseAllowed: derivativeAllowed, crop: null, mask: null }])
      setReferences(next); setExternalAllowed(false); setDerivativeAllowed(false); setAllowedChange(''); changed(); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <section className="lf-paper avg-image-production" aria-label="图片生产（实验）"><h4>图片生产 <small>实验</small></h4>
    <p>先保存规则和对白，再声明图片用途与合法参考。每批最多 8 项、每项一次图片请求；供应商费用可能未知，原图返回后仍须查看和确认选用。</p>
    {!enabled && <p>当前仅可查看已有需求和候选，新增图片调用未开放。</p>}
    {enabled && <p>{readiness.ready ? '本机 Agnes 图片配置已就绪，账户可用性与费用以实际回执为准。' : `${readiness.issue ?? '图片配置尚未就绪'} 请在通用设置中核对 Agnes 配置。`}</p>}
    {error && <p role="alert">{error}</p>}
    {enabled && canEdit && <><details><summary>导入仅供生成使用的参考图</summary><fieldset className="avg-form" disabled={disabled || !canEdit || !enabled}>
      <label>参考图文件<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setReferenceFile(event.target.files?.[0] ?? null)} /></label>
      <label>参考图来源与授权<input value={referenceLicense} onChange={event => setReferenceLicense(event.target.value)} /></label>
      <button className="lf-action" disabled={!referenceFile || !referenceLicense.trim()} onClick={() => void onAction(async () => {
        if (!referenceFile || referenceFile.size > 8 * 1024 * 1024) throw new Error('单份参考图最多 8 MiB')
        const type = referenceFile.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[referenceFile.name.split('.').pop()?.toLowerCase() ?? '']
        await importAvgMediaForAssemblyV1({ scope, data: await referenceFile.arrayBuffer(), mimeType: type, kind: 'background', name: referenceFile.name,
          license: referenceLicense, altText: referenceFile.name, characterTag: '' })
        await onReload(); setReferenceFile(null); onNotice('参考图已解码并保留在当前作品，尚未加入演出。请逐项授权本次外发与衍生使用。')
      })}>导入为参考，不加入演出</button>
    </fieldset></details>
    <details open={formOpen} onToggle={event => setFormOpen(event.currentTarget.open)}><summary>新增图片需求</summary><fieldset className="avg-form" disabled={disabled || !canEdit || !enabled}>
      <legend>新增图片需求</legend>
      <label>图片用途<select value={kind} onChange={e => { setKind(e.target.value as Kind); setSubject(''); setVariant(''); changed() }}>{KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {!itemKind && kind !== 'reference' && <label>图片出现的场景<select value={scene?.key ?? ''} onChange={e => { setSceneKey(e.target.value); setSubject(''); setLineKey(''); changed() }}>{workspace.systemPlan.scenes.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label>}
      {(actor || itemKind || kind === 'reference') && <label>图片主体<select value={target?.key ?? ''} onChange={e => { setSubject(e.target.value); setVariant(''); changed() }}>{subjects.map((s, i) => <option key={`${s.kind}:${s.key}:${i}`} value={s.key}>{s.label}</option>)}</select></label>}
      {itemKind && <label>物件显示状态<select value={variant} onChange={e => { setVariant(e.target.value); changed() }}><option value="">默认显示</option>{targetItem?.variants.map(v => <option key={v.key} value={v.key}>{v.name}</option>)}</select></label>}
      {!itemKind && kind !== 'reference' && <label>图片出现的对白<select value={trigger?.lineKey ?? ''} onChange={e => { setLineKey(e.target.value); changed() }}>{script?.lines.map(line => <option key={line.lineKey} value={line.lineKey}>{line.text}</option>)}</select></label>}
      <label>需求名称<input value={name} maxLength={200} onChange={e => { setName(e.target.value); changed() }} /></label>
      <label>画面要求<textarea value={prompt} maxLength={12000} onChange={e => { setPrompt(e.target.value); changed() }} /></label>
      <label>必须保持（每行一项）<textarea value={invariants} onChange={e => { setInvariants(e.target.value); changed() }} /></label>
      <label>排除的画面<input value={negative} maxLength={4000} onChange={e => { setNegative(e.target.value); changed() }} /></label>
      <label>不得表现的信息（每行一项）<textarea value={forbidden} onChange={e => { setForbidden(e.target.value); changed() }} /></label>
      <label>画幅与最小尺寸<select value={size} onChange={e => { setSize(Number(e.target.value)); changed() }}>{SIZES.map((s, i) => <option key={s.label} value={i}>{s.label} · 至少 {s.width} × {s.height}</option>)}</select></label>
      <label>生成档位<select value={tier} onChange={e => { setTier(e.target.value as '1K' | '2K'); changed() }}><option>1K</option><option>2K</option></select></label>
      <label><input type="checkbox" checked={alpha} onChange={e => { setAlpha(e.target.checked); changed() }} />必须有透明像素（不满足时保留原图待加工）</label>
      <details><summary>为此需求添加合法参考（最多 4 张）</summary>
        <label>已导入参考图<select value={referenceKey} onChange={e => { setReferenceKey(e.target.value); resetReferenceConsent(); changed() }}><option value="">请选择</option>{importImages.map(a => <option key={a.assetKey} value={a.assetKey}>{a.name}</option>)}</select></label>
        <label>参考用途<select value={purpose} onChange={e => { setPurpose(e.target.value as AvgMediaReferenceV1['purpose']); resetReferenceConsent(); changed() }}>{PURPOSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>允许改变什么<textarea value={allowedChange} maxLength={2000} onChange={e => { setAllowedChange(e.target.value); resetReferenceConsent(); changed() }} /></label>
        <label><input type="checkbox" checked={externalAllowed} onChange={e => { setExternalAllowed(e.target.checked); changed() }} />我有权将该参考图发送给本次图片供应商</label>
        <label><input type="checkbox" checked={derivativeAllowed} onChange={e => { setDerivativeAllowed(e.target.checked); changed() }} />我有权以该参考图进行本次衍生创作</label>
        <button className="lf-action" onClick={addReference}>添加这张授权参考</button>
        <ol>{references.map((r, i) => <li key={r.assetKey}>{i + 1}. {importImages.find(a => a.assetKey === r.assetKey)?.name ?? r.assetKey} · {PURPOSES.find(([key]) => key === r.purpose)?.[1]}<button className="lf-action" onClick={() => { setReferences(references.filter((_, j) => j !== i)); changed() }}>移除参考</button></li>)}</ol>
      </details>
      <button className="lf-action" disabled={!name.trim() || !prompt.trim()} onClick={addRequirement}>加入本批需求</button>
    </fieldset></details></>}
    <h5>需求清单（{requirements.length}/8）</h5>
    <ol>{requirements.map((r, i) => <li key={r.requirementKey}><strong>{r.name}</strong> · {KINDS.find(([key]) => key === (r.consumer.domain === 'reference' ? 'reference' : r.consumer.slot === 'icon' ? 'icon' : r.consumer.slot === 'detail' ? 'detail' : r.mediaKind))?.[1]} · {r.references.length} 张参考
      <details><summary>查看画面要求、用途与参考授权</summary><p>{r.prompt}</p><p>必须保持：{r.invariants.join('；') || '未另设'}</p><p>排除：{[r.negativePrompt, ...r.forbiddenDepictions].filter(Boolean).join('；') || '未另设'}</p><p>{r.width} × {r.height} · {r.resolutionTier} · {r.alpha === 'required' ? '要求透明像素' : '未要求透明'}</p><ul>{r.references.map(ref => <li key={ref.assetKey}>{ref.purpose} · {ref.allowedChange} · {ref.license}</li>)}</ul></details>
      <button className="lf-action" disabled={disabled || !canEdit || !enabled} onClick={() => { setRequirements(requirements.filter((_, j) => j !== i)); changed() }}>移除此需求</button></li>)}</ol>
    <div className="avg-actions"><button className="lf-action" disabled={disabled || !canEdit || !enabled || !pending || !requirements.length} onClick={() => {
      if (name.trim() || prompt.trim() || references.length) { setError('请先将正在填写的图片加入需求清单，再保存整批需求'); return }
      void onAction(() => onSave(requirements))
    }}>保存并冻结图片需求</button>
      <button className="lf-action" disabled={disabled || !pending} onClick={() => { setRequirements(workspace.mediaBatch?.requirements ?? []); setPending(false); setName(''); setPrompt(''); setReferences([]); setReferenceKey(''); setAllowedChange(''); resetReferenceConsent(); setError('') }}>撤销未保存的图片需求</button>
      {workspace.mediaBatch && <button className="lf-action" disabled={disabled || !canEdit || !enabled || pending} onClick={() => void onAction(onClear)}>移除尚未使用的生成批次</button>}
      <span>{pending ? '图片需求尚未保存，请保存或撤销后切换分区。' : workspace.mediaBatch ? '图片需求已保存，尚需在制作页确认方案并开始。' : '保存图片需求不会开始调用。'}</span></div>
    {currentBatch && productionId && build && <section aria-label="本次图片生成与选用"><h5>本次图片生成与选用 · Build #{build.buildNumber}</h5>
      <p>本批 {currentBatch.requirements.length} 项，尚待接收 {outstanding} 项。原图接收后逐项确认，再配置并确认演出。</p>
      {!sourcesReady && <p>请先在制作页确认系统规则和全部场景脚本。</p>}
      <button className="lf-action lf-action-primary" disabled={disabled || pending || !enabled || !readiness.ready || !canAdopt || !sourcesReady || !outstanding} onClick={() => void onGenerate()}>生成本批图片（最多 {outstanding} 次）</button>
      {generating && <button className="lf-action" onClick={onCancel}>停止等待并保留调用记录</button>}
      {currentBatch.requirements.map(r => <RawChoiceCard key={`${build.id}:${r.requirementKey}`} scope={scope} productionId={productionId} requirement={r}
        expanded={visible && expandedKey === r.requirementKey} onExpand={() => setPreviewKey(expandedKey === r.requirementKey ? '' : r.requirementKey)}
        raw={accepted(avgRawMediaArtifactKeyV1(r.requirementKey))} selected={accepted(avgMediaChoiceArtifactKeyV1(r.requirementKey))}
        pending={view.artifacts.find(row => row.artifactKey === avgMediaChoiceArtifactKeyV1(r.requirementKey) && row.status === 'pending')}
        disabled={disabled || pending} canAdopt={canAdopt} declaration={declaration} onAction={onAction} onReload={onReload} />)}
      <button className="lf-action" disabled={disabled || pending || !canAdopt || !allChoices} onClick={() => void onAction(async () => {
        await configureAvgChosenMediaDraftV2({ scope, productionId, expectedDraftRevision: view.draft.revision }); await onReload(); onNotice('已选图片已配置到演出草稿，请到制作页查看并确认演出候选。')
      })}>将已选图片配置到演出草稿</button>
      {['recovery-required', 'failed', 'cancelled'].includes(build.status) && <p>本次调用已停止。请先核对原始记录与未知费用，当前不会自动重发。</p>}
    </section>}
  </section>
}
