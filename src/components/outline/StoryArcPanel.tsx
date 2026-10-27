/**
 * 故事线面板 — Phase B2
 * 展示/编辑全局故事线（主线+支线），支持 AI 生成
 */
import { useState, useEffect } from 'react'
import { ArrowUpDown, Check, Plus, Sparkles, Loader2, Trash2, GripVertical, X, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { useStoryArcStore } from '../../stores/story-arc'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import { CInput } from '../shared/CompositionInput'
import { CTextarea } from '../shared/CompositionInput'
import { useDialog } from '../shared/Dialog'
import type { Project, StoryArc, StoryArcType } from '../../lib/types'
import { inspectStages, type StoryStage } from '../../lib/types/story-arc'
import { nanoid } from 'nanoid'
import StorylineProgressPanel from './StorylineProgressPanel'
import CreativeArtifactSummary from '../agent/CreativeArtifactSummary'
import { creativeArtifactCanAdoptV1 } from '../../lib/agent/creative-reliability'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'
import type { StoryArcOperationV1, StoryArcCopilotSnapshot } from '../../lib/agent/story-arc-copilot'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

export interface StoryArcInitialRecordTarget {
  table: 'storyArcs' | 'storylineProgress' | 'storylineCrossings'
  recordId: number
}

interface Props {
  project: Project
  worldGroupId: number | null
  initialRecordTarget?: StoryArcInitialRecordTarget | null
}

export default function StoryArcPanel({ project, worldGroupId, initialRecordTarget }: Props) {
  const dialog = useDialog()
  const {
    arcs,
    activeArcId,
    intentAlignmentByArcId,
    loadAll,
    setActiveArc,
    addArc,
    updateArc,
    deleteArc,
    updateStages,
  } = useStoryArcStore()
  const copilot = useMasterCopilot({ project, worldGroupId })
  const [genType, setGenType] = useState<StoryArcType>('main')

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  const activeArc = arcs.find(a => a.id === activeArcId)
  const activeIntentAlignment = activeArc?.id == null
    ? undefined
    : intentAlignmentByArcId[activeArc.id]
  const activeStageInspection = activeArc ? inspectStages(activeArc.stages) : null
  const activeStages = activeStageInspection?.valid ? activeStageInspection.stages : []
  const hasInvalidStages = arcs.some(arc => !inspectStages(arc.stages).valid)
  const initialArcId = initialRecordTarget?.table === 'storyArcs'
    ? initialRecordTarget.recordId
    : null

  useEffect(() => {
    if (initialArcId != null && arcs.some(arc => arc.id === initialArcId)) setActiveArc(initialArcId)
  }, [arcs, initialArcId, setActiveArc])
  useInitialRecordTarget(initialArcId, activeArc?.id === initialArcId)

  // 新建空故事线
  const handleAddArc = async (type: StoryArcType) => {
    const name = type === 'main' ? '主线' : `支线${arcs.filter(a => a.type === 'sub').length + 1}`
    const id = await addArc({
      projectId: project.id!,
      name,
      type,
      stages: '[]',
      description: '',
    })
    setActiveArc(id)
  }

  const pendingStoryArcCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'outline.story-arcs'
  ))
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.skillId !== 'outline.story-arcs'
  ))

  // 生成请求统一进入主 Agent 的 outline.story-arcs Skill。
  const handleGenerate = async () => {
    const typeLabel = genType === 'main' ? '主线' : '支线'
    await copilot.submitRequest(`依据当前作品已确认的世界、故事核心、角色和既有规划，生成一条${typeLabel}故事线。`)
  }

  const handleTransform = async (operation: Exclude<StoryArcOperationV1, 'create'>) => {
    if (activeArc?.id == null) return
    const operationLabel = operation === 'expand'
      ? '扩写'
      : operation === 'rewrite'
        ? '重写'
        : operation === 'polish'
          ? '润色'
          : '重规划'
    const instruction = `${operationLabel}现有${activeArc.type === 'main' ? '主线' : '支线'}“${activeArc.name}”，保持目标身份并依据当前已确认 Canon 生成可编辑候选。`
    await copilot.submitTargetedRequest(instruction, {
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction,
      storyArcMutationRequest: { operation, targetArcId: activeArc.id },
    })
  }

  // PR #60 的阶段事件按钮保留，但执行统一进入已治理的故事线 Skill：
  // 返回候选并由作者采纳，不在组件中直连模型或直接覆盖故事线。
  const generateKeyEvents = async (
    stage: StoryStage,
    allStages: StoryStage[],
    currentKeyEvents: string[]
  ): Promise<void> => {
    if (activeArc?.id == null) return
    const neighborSummary = allStages
      .filter(item => item.id !== stage.id)
      .map(item => item.title)
      .join('、')
    const instruction = [
      `只扩写故事线“${activeArc.name}”中的阶段“${stage.title}”关键事件。`,
      `阶段描述：${stage.description || '未填写'}。`,
      currentKeyEvents.length > 0 ? `必须保留现有事件：${currentKeyEvents.join('、')}。` : '当前还没有关键事件。',
      neighborSummary ? `相邻阶段：${neighborSummary}；不得改写其他阶段。` : '',
      '新增 3—5 个具有因果递进的关键事件，并返回完整故事线候选供作者审查。',
    ].filter(Boolean).join('\n')
    await copilot.submitTargetedRequest(instruction, {
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction,
      storyArcMutationRequest: { operation: 'expand', targetArcId: activeArc.id },
    })
  }

  const sortKeyEvents = async (
    stage: StoryStage,
    _allStages: StoryStage[],
    currentKeyEvents: string[]
  ): Promise<void> => {
    if (activeArc?.id == null || currentKeyEvents.length < 2) return
    const instruction = [
      `只重排故事线“${activeArc.name}”阶段“${stage.title}”的关键事件。`,
      `现有事件：${currentKeyEvents.map((event, index) => `${index + 1}. ${event}`).join('；')}`,
      '按时间和因果顺序排列，不得新增、删除、改写事件，也不得改变其他阶段；返回完整故事线候选供作者审查。',
    ].join('\n')
    await copilot.submitTargetedRequest(instruction, {
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction,
      storyArcMutationRequest: { operation: 'replan', targetArcId: activeArc.id },
    })
  }

  // 删除故事线
  const handleDeleteArc = async (id: number) => {
    const arc = arcs.find(a => a.id === id)
    if (!arc) return
    const ok = await dialog.confirm({
      title: `删除故事线「${arc.name}」？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await deleteArc(id)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">🧵 全局故事线</h2>

      {/* 故事线 Tab 切换 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {arcs.map(arc => (
          <button
            key={arc.id}
            onClick={() => setActiveArc(arc.id!)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              activeArcId === arc.id
                ? 'bg-accent text-white'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${arc.type === 'main' ? 'bg-amber-400' : 'bg-blue-400'}`} />
            {arc.name}
            {arc.id != null && intentAlignmentByArcId[arc.id] === 'stale' && (
              <span title="故事核心意图的冻结 hash 已变化，当前故事线不会被自动覆盖">意图已变</span>
            )}
            {arc.id != null && intentAlignmentByArcId[arc.id] === 'source-missing' && (
              <span title="故事线记录的故事核心来源已经缺失或不属于当前 Work">来源缺失</span>
            )}
          </button>
        ))}

        {/* 新增 / AI 生成 */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => handleAddArc('main')}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-text-muted hover:text-accent transition-colors"
            title="新增主线"
          >
            <Plus className="w-3.5 h-3.5" /> 主线
          </button>
          <button
            onClick={() => handleAddArc('sub')}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-text-muted hover:text-accent transition-colors"
            title="新增支线"
          >
            <Plus className="w-3.5 h-3.5" /> 支线
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <select
            value={genType}
            onChange={e => setGenType(e.target.value as StoryArcType)}
            className="px-1 py-1 bg-bg-elevated border border-border rounded text-xs text-text-secondary"
          >
            <option value="main">生成主线</option>
            <option value="sub">生成支线</option>
          </select>
          <button
            onClick={handleGenerate}
            disabled={
              copilot.loading
              || copilot.busy
              || copilot.pendingCandidates.length > 0
              || hasInvalidStages
              || (project.enableMultiWorld === true && worldGroupId == null)
            }
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {copilot.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI 生成
          </button>
          {(['expand', 'rewrite', 'polish', 'replan'] as const).map(operation => (
            <button
              key={operation}
              type="button"
              onClick={() => { void handleTransform(operation) }}
              disabled={
                activeArc?.id == null
                || !activeStageInspection?.valid
                || copilot.loading
                || copilot.busy
                || copilot.pendingCandidates.length > 0
                || (project.enableMultiWorld === true && worldGroupId == null)
              }
              className="px-2 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-accent rounded disabled:opacity-40"
            >
              {operation === 'expand' ? '扩写' : operation === 'rewrite' ? '重写' : operation === 'polish' ? '润色' : '重规划'}
            </button>
          ))}
        </div>
      </div>

      {copilot.error && (
        <p className="mb-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {copilot.error}
        </p>
      )}

      {hasInvalidStages && (
        <p className="mb-4 rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          有故事线的阶段数据格式异常，原始数据已保留。请切换到对应故事线检查并修复后，再使用 AI 生成。
        </p>
      )}

      {(activeIntentAlignment === 'stale' || activeIntentAlignment === 'source-missing') && activeArc && (
        <div className="mb-4 rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          <p>
            {activeIntentAlignment === 'stale'
              ? '过期原因：故事核心意图的冻结 hash 已在这条故事线生成后变化。'
              : '过期原因：这条故事线记录的故事核心来源已经缺失或不属于当前 Work。'}
            系统不会静默选择或覆盖任何一边；请检查 provenance 后另行生成并确认重规划候选。
          </p>
          <p className="mt-1 font-mono text-[10px] text-text-muted">
            provenance：storyCore #{activeArc.sourceStoryCoreId ?? '未记录'}
            {' · '}revision {activeArc.sourceStoryCoreRevision ?? '未记录'}
            {' · '}run #{activeArc.producerRunId ?? '未记录'}
            {' · '}candidate {activeArc.producerCandidateHash?.slice(0, 12) ?? '未记录'}
          </p>
        </div>
      )}

      {hasOtherPendingCandidates && (
        <p className="mb-4 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
        </p>
      )}

      {pendingStoryArcCandidates.map(candidate => (
        <section
          key={candidate.event.id}
          className="mb-4 border border-accent/30 bg-bg-surface p-4 rounded-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-text-primary">待确认 · {candidate.payload.label}</h3>
            <span className="text-[11px] text-text-muted">
              {candidate.payload.contextEvidence
                ? `约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens`
                : `${candidate.payload.contextSources.length} 个输入来源`}
            </span>
          </div>
          <div className={candidate.payload.storyArcMutationRequest?.operation === 'expand'
            || candidate.payload.storyArcMutationRequest?.operation === 'polish'
            ? 'grid gap-3 md:grid-cols-2'
            : ''}>
            {(candidate.payload.storyArcMutationRequest?.operation === 'expand'
              || candidate.payload.storyArcMutationRequest?.operation === 'polish') && (() => {
              const snapshot = candidate.payload.baseSnapshot as StoryArcCopilotSnapshot
              const original = snapshot.arcs?.find(arc => (
                arc.id === candidate.payload.storyArcMutationRequest?.targetArcId
              ))
              const inspection = original ? inspectStages(original.stages) : null
              return (
                <label className="grid gap-1 text-[11px] text-text-muted">
                  原版（冻结）
                  <CTextarea
                    aria-label={`${candidate.payload.label}原版内容`}
                    value={original ? JSON.stringify({
                      name: original.name,
                      type: original.type,
                      description: original.description,
                      stages: inspection?.valid ? inspection.stages : {
                        error: inspection?.error,
                        originalJson: original.stages,
                      },
                    }, null, 2) : '目标原版不可用，请拒绝并重新生成。'}
                    readOnly
                    className="min-h-72 w-full resize-y font-mono text-xs leading-5"
                  />
                </label>
              )
            })()}
            <label className="grid gap-1 text-[11px] text-text-muted">
              {candidate.payload.storyArcMutationRequest?.operation === 'expand'
                || candidate.payload.storyArcMutationRequest?.operation === 'polish'
                ? '新版（可编辑）'
                : ''}
              <CTextarea
                aria-label={`${candidate.payload.label}候选内容`}
                value={candidate.event.content}
                disabled={copilot.busy}
                onChange={event => {
                  void copilot.updateCandidate(candidate.event.id!, event.target.value)
                }}
                className="min-h-72 w-full resize-y font-mono text-xs leading-5"
              />
            </label>
          </div>
          {candidate.payload.creativeArtifact && (
            <CreativeArtifactSummary
              artifact={candidate.payload.creativeArtifact}
              narrativeBrief={candidate.payload.narrativeBrief}
            />
          )}
          <HarnessEvidencePanel
            contextEvidence={candidate.payload.contextEvidence}
            lifecycle={candidate.lifecycle}
            promptExecutionEvidence={candidate.payload.promptExecutionEvidence}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={copilot.busy}
              onClick={() => { void copilot.rejectCandidate(candidate) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary rounded disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              拒绝
            </button>
            <button
              type="button"
              disabled={
                copilot.busy
                || (candidate.payload.creativeArtifact != null
                  && !creativeArtifactCanAdoptV1(candidate.payload.creativeArtifact))
              }
              onClick={() => { void copilot.adoptCandidate(candidate) }}
              className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
            >
              {copilot.busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              {candidate.payload.creativeArtifact?.status === 'usable-with-warnings'
                ? '接受提示并采纳'
                : '采纳'}
            </button>
          </div>
        </section>
      ))}

      {/* 故事线编辑 */}
      {activeArc ? (
        <>
          {activeStageInspection && !activeStageInspection.valid ? (
            <StoryStageRecovery
              key={activeArc.id}
              arc={activeArc}
              error={activeStageInspection.error}
              onSave={(stages, original) => updateStages(activeArc.id!, stages, original)}
            />
          ) : <StoryArcEditor
            arc={activeArc}
            stages={activeStages}
            targeted={activeArc.id === initialArcId}
            onUpdateArc={(data) => updateArc(activeArc.id!, data)}
            onUpdateStages={(stages) => updateStages(activeArc.id!, stages)}
            onDelete={() => handleDeleteArc(activeArc.id!)}
            onGenerateKeyEvents={generateKeyEvents}
            onSortEvents={sortKeyEvents}
            isGeneratingEvents={copilot.busy}
            isSortingEvents={copilot.busy}
          />}
          <StorylineProgressPanel
            projectId={project.id!}
            arcs={arcs}
            copilot={copilot}
            onArcsChanged={() => loadAll(project.id!)}
            initialRecordTarget={initialRecordTarget?.table === 'storylineProgress'
              || initialRecordTarget?.table === 'storylineCrossings'
              ? initialRecordTarget
              : null}
          />
        </>
      ) : (
        <div className="text-center py-16 text-text-muted">
          <p className="text-sm mb-3">还没有故事线。</p>
          <p className="text-xs">点击上方「AI 生成」或「+ 主线/支线」创建。</p>
        </div>
      )}
    </div>
  )
}

/** Keep malformed author data visible and unchanged until an explicit, validated repair. */
function StoryStageRecovery({ arc, error, onSave }: {
  arc: StoryArc
  error: string
  onSave: (stages: StoryStage[], original: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [original, setOriginal] = useState(arc.stages)
  const [draft, setDraft] = useState(arc.stages)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    const result = inspectStages(draft)
    if (!result.valid) {
      setSaveError(result.error)
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await onSave(result.stages, original)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '保存失败，修复尚未保存。')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="rounded-xl border border-warning/40 bg-bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">{arc.name}：阶段数据格式异常</h3>
      <p role="alert" className="text-xs text-text-secondary">{error} 原始数据已保留，尚未修改。</p>
      <p className="text-xs text-text-muted">
        请先导出项目备份。可在下方检查原始阶段数据并修复格式；保留阶段 ID 和已有内容，没有关键事件时填写 []。
        保存会沿用阶段更新流程，删除阶段会解除对应进度引用。
      </p>
      <button type="button" onClick={() => setEditing(!editing)} className="text-xs text-accent">
        {editing ? '收起阶段数据' : '检查并修复阶段数据'}
      </button>
      {editing && <>
        <CTextarea
          aria-label="修复故事线阶段数据"
          value={draft}
          disabled={saving}
          onChange={event => setDraft(event.target.value)}
          className="w-full min-h-64 p-2 bg-bg-base border border-border rounded font-mono text-xs text-text-primary"
        />
        {saveError && <p role="alert" className="text-xs text-error">{saveError}</p>}
        <div className="flex gap-3">
          <button type="button" disabled={saving} onClick={() => { void save() }} className="text-xs text-accent disabled:opacity-40">
            {saving ? '保存中…' : '确认保存阶段修复'}
          </button>
          <button type="button" disabled={saving} onClick={() => {
            setOriginal(arc.stages)
            setDraft(arc.stages)
            setSaveError('')
          }} className="text-xs text-text-muted">放弃编辑稿</button>
        </div>
      </>}
    </section>
  )
}

// ── 故事线编辑器 ──

function StoryArcEditor({ arc, stages, targeted, onUpdateArc, onUpdateStages, onDelete, onGenerateKeyEvents, onSortEvents, isGeneratingEvents, isSortingEvents }: {
  arc: NonNullable<ReturnType<typeof useStoryArcStore.getState>['arcs'][0]>
  stages: StoryStage[]
  targeted: boolean
  onUpdateArc: (data: Partial<Pick<StoryArc, 'name' | 'description' | 'type'>>) => void
  onUpdateStages: (stages: StoryStage[]) => void
  onDelete: () => void
  onGenerateKeyEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  onSortEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  isGeneratingEvents: boolean
  isSortingEvents: boolean
}) {
  const [editName, setEditName] = useState(arc.name)
  const [editDesc, setEditDesc] = useState(arc.description || '')

  // 同步外部数据
  useEffect(() => {
    setEditName(arc.name)
    setEditDesc(arc.description || '')
  }, [arc.id, arc.name, arc.description])

  const handleAddStage = () => {
    const newStage: StoryStage = {
      id: nanoid(8),
      title: `阶段 ${stages.length + 1}`,
      description: '',
      keyEvents: [],
    }
    onUpdateStages([...stages, newStage])
  }

  const handleUpdateStage = (idx: number, data: Partial<StoryStage>) => {
    const updated = stages.map((s, i) => i === idx ? { ...s, ...data } : s)
    onUpdateStages(updated)
  }

  const handleDeleteStage = (idx: number) => {
    onUpdateStages(stages.filter((_, i) => i !== idx))
  }

  return (
    <div
      {...initialRecordTargetAttributes(targeted, arc.id)}
      className={`space-y-4 rounded-xl ${targeted ? INITIAL_RECORD_TARGET_CLASS : ''}`}
    >
      {/* 故事线基本信息 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className={`w-3 h-3 rounded-full ${arc.type === 'main' ? 'bg-amber-400' : 'bg-blue-400'}`} />
          <CInput
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={() => onUpdateArc({ name: editName })}
            className="flex-1 text-lg font-bold bg-transparent text-text-primary border-none focus:outline-none"
          />
          <span className="text-xs px-2 py-0.5 bg-bg-elevated text-text-muted rounded">
            {arc.type === 'main' ? '主线' : '支线'}
          </span>
          <button onClick={onDelete} className="p-1 text-text-muted hover:text-error transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <CTextarea
          value={editDesc}
          onChange={e => setEditDesc(e.target.value)}
          onBlur={() => onUpdateArc({ description: editDesc })}
          placeholder="故事线整体描述..."
          className="w-full h-16 p-2 bg-bg-base border border-border rounded text-sm text-text-secondary resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 时间线可视化 + 阶段列表 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-secondary">阶段列表（{stages.length}）</h3>
          <button
            onClick={handleAddStage}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 添加阶段
          </button>
        </div>

        {/* 进度条可视化 */}
        {stages.length > 0 && (
          <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-bg-elevated">
            {stages.map((s, i) => (
              <div
                key={s.id}
                className="flex-1 rounded-full"
                style={{
                  backgroundColor: `hsl(${30 + i * (300 / stages.length)}, 60%, 50%)`,
                }}
                title={s.title}
              />
            ))}
          </div>
        )}

        {/* 阶段编辑卡片 */}
        {stages.map((stage, idx) => (
          <StageCard
            key={stage.id}
            stage={stage}
            index={idx}
            total={stages.length}
            onUpdate={(data) => handleUpdateStage(idx, data)}
            onDelete={() => handleDeleteStage(idx)}
            onGenerateKeyEvents={onGenerateKeyEvents}
            onSortEvents={onSortEvents}
            isGeneratingEvents={isGeneratingEvents}
            isSortingEvents={isSortingEvents}
            allStages={stages}
          />
        ))}

        {stages.length === 0 && (
          <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-lg">
            暂无阶段，点击「添加阶段」或用 AI 生成
          </div>
        )}
      </div>
    </div>
  )
}

// ── 单个阶段卡片 ──

function StageCard({ stage, index, total, onUpdate, onDelete, onGenerateKeyEvents, onSortEvents, isGeneratingEvents, isSortingEvents, allStages }: {
  stage: StoryStage
  index: number
  total: number
  onUpdate: (data: Partial<StoryStage>) => void
  onDelete: () => void
  onGenerateKeyEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  onSortEvents: (stage: StoryStage, allStages: StoryStage[], currentKeyEvents: string[]) => Promise<void>
  isGeneratingEvents: boolean
  isSortingEvents: boolean
  allStages: StoryStage[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [newEvent, setNewEvent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSorting, setIsSorting] = useState(false)

  const addEvent = () => {
    if (!newEvent.trim()) return
    onUpdate({ keyEvents: [...stage.keyEvents, newEvent.trim()] })
    setNewEvent('')
  }

  const removeEvent = (i: number) => {
    onUpdate({ keyEvents: stage.keyEvents.filter((_, idx) => idx !== i) })
  }

  const handleGenerateEvents = async () => {
    setIsGenerating(true)
    try {
      await onGenerateKeyEvents(stage, allStages, stage.keyEvents)
    } catch (error) {
      console.error('[StageCard] 生成关键事件失败:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const moveEventUp = (i: number) => {
    if (i === 0) return
    const newEvents = [...stage.keyEvents]
    ;[newEvents[i - 1], newEvents[i]] = [newEvents[i], newEvents[i - 1]]
    onUpdate({ keyEvents: newEvents })
  }

  const moveEventDown = (i: number) => {
    if (i === stage.keyEvents.length - 1) return
    const newEvents = [...stage.keyEvents]
    ;[newEvents[i], newEvents[i + 1]] = [newEvents[i + 1], newEvents[i]]
    onUpdate({ keyEvents: newEvents })
  }

  const handleSortEvents = async () => {
    if (stage.keyEvents.length < 2) return
    setIsSorting(true)
    try {
      await onSortEvents(stage, allStages, stage.keyEvents)
    } catch (error) {
      console.error('[StageCard] 排序关键事件失败:', error)
    } finally {
      setIsSorting(false)
    }
  }

  const stageColor = `hsl(${30 + index * (300 / total)}, 60%, 50%)`

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
      {/* 头部 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-bg-hover transition-colors"
      >
        <div className="flex items-center gap-2 shrink-0">
          <GripVertical className="w-3.5 h-3.5 text-text-muted/40" />
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: stageColor }}>
            {index + 1}
          </div>
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{stage.title}</p>
          {!expanded && stage.description && (
            <p className="text-xs text-text-muted truncate">{stage.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stage.turningPoint && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded">转折</span>
          )}
          {stage.keyEvents.length > 0 && (
            <span className="text-[10px] text-text-muted">{stage.keyEvents.length} 事件</span>
          )}
          {expanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
        </div>
      </button>

      {/* 展开编辑 */}
      {expanded && (
        <div className="p-3 pt-0 space-y-3 border-t border-border">
          {/* 标题 */}
          <CInput
            value={stage.title}
            onChange={e => onUpdate({ title: e.target.value })}
            placeholder="阶段标题"
            className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
          />

          {/* 描述 */}
          <CTextarea
            value={stage.description}
            onChange={e => onUpdate({ description: e.target.value })}
            placeholder="这个阶段发生什么..."
            className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-secondary resize-y focus:outline-none focus:border-accent"
          />

          {/* 转折点 */}
          <div>
            <label className="text-xs text-text-muted mb-1 block">转折点（可选）</label>
            <CInput
              value={stage.turningPoint || ''}
              onChange={e => onUpdate({ turningPoint: e.target.value || undefined })}
              placeholder="这个阶段的关键转折..."
              className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-secondary focus:outline-none focus:border-accent"
            />
          </div>

          {/* 关键事件 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-muted block">关键事件（{stage.keyEvents.length}）</label>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSortEvents}
                  disabled={isSorting || isSortingEvents || stage.keyEvents.length < 2}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-accent bg-accent/10 hover:bg-accent/20 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={stage.keyEvents.length < 2 ? '至少需要2个事件才能排序' : 'AI智能排序'}
                >
                  {isSorting || isSortingEvents ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3" />
                  )}
                  {isSorting || isSortingEvents ? '排序中...' : 'AI排序'}
                </button>
                <button
                  onClick={handleGenerateEvents}
                  disabled={isGenerating || isGeneratingEvents || !stage.description?.trim()}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-accent bg-accent/10 hover:bg-accent/20 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={!stage.description?.trim() ? '请先填写阶段描述' : 'AI生成关键事件'}
                >
                  {isGenerating || isGeneratingEvents ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {isGenerating || isGeneratingEvents ? '生成中...' : 'AI生成'}
                </button>
              </div>
            </div>
            {!stage.description?.trim() && (
              <p className="text-[10px] text-warning mb-1">提示：AI生成需要先填写阶段描述</p>
            )}
            <div className="space-y-1">
              {stage.keyEvents.map((ev, i) => (
                <div key={i} className="flex items-center gap-1.5 group">
                  <span className="text-[10px] text-text-muted w-4 text-center">{i + 1}</span>
                  <span className="text-xs text-text-secondary flex-1">{ev}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => moveEventUp(i)}
                      disabled={i === 0}
                      className="p-0.5 text-text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-text-muted"
                      title="上移"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => moveEventDown(i)}
                      disabled={i === stage.keyEvents.length - 1}
                      className="p-0.5 text-text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-text-muted"
                      title="下移"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => removeEvent(i)}
                      className="p-0.5 text-text-muted hover:text-error"
                      title="删除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex gap-1.5">
                <CInput
                  value={newEvent}
                  onChange={e => setNewEvent(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addEvent()}
                  placeholder="手动添加关键事件..."
                  className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                />
                <button onClick={addEvent} disabled={!newEvent.trim()}
                  className="px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded disabled:opacity-40">
                  添加
                </button>
              </div>
            </div>
          </div>

          {/* 删除按钮 */}
          <div className="flex justify-end pt-1">
            <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 text-xs text-error/60 hover:text-error transition-colors">
              <Trash2 className="w-3 h-3" /> 删除此阶段
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
