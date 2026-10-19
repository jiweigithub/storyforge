import { useState, useEffect, useMemo, useRef } from 'react'
import { Play, Square } from 'lucide-react'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldviewStore } from '../../../stores/worldview'
import { useCreativeRulesStore } from '../../../stores/project-singletons'
import { useCharacterStore } from '../../../stores/character'
import { useOutlineStore } from '../../../stores/outline'
import { useForeshadowStore } from '../../../stores/foreshadow'
import { useWorldGroupStore } from '../../../stores/world-group'
import { useAIStream } from '../../../hooks/useAIStream'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import { assembleBoundPrompt } from '../../../lib/ai/prompt-variable-bindings'
import { assembleContext } from '../../../lib/registry/assemble-context'
import CodexPanel from '../../codex/CodexPanel'
import type { PromptWorkflow, PromptWorkflowStep } from '../../../lib/types/workflow'
import type { Project } from '../../../lib/types'
import { useActiveWork } from '../../../hooks/useActiveWork'
import { assembleWorkflowStepVars } from './workflow-helpers'
import {
  prepareGenerationNode,
  runGenerationNode,
} from '../../../lib/generation/generation-node'
import { createWorkflowGenerationNode } from '../../../lib/generation/workflow-generation-node'
import WorkflowStepCard from './WorkflowStepCard'
import type { StepResult } from './WorkflowStepCard'
import WorkflowExecutionGraph from './WorkflowExecutionGraph'
import {
  collectWorkflowUpstreamInputs,
  compileWorkflowGraph,
  formatWorkflowUpstreamContext,
  groupWorkflowInputsByVariable,
} from '../../../lib/workflow/graph'

export { WorkflowStepCard as StepCard } from './WorkflowStepCard'
export type { StepResult } from './WorkflowStepCard'

interface RunnerProps {
  workflow: PromptWorkflow
  project?: Project
  onClose: () => void
}

/**
 * 工作流执行器：按顺序运行一个 PromptWorkflow 的所有步骤，
 * 每步可暂停让用户审核、重试或跳过；输出只作草稿，不直接写入 SaveTarget。
 * 从 PromptWorkflowsPanel.tsx 抽出。
 */
export default function WorkflowRunner({ workflow, project, onClose }: RunnerProps) {
  const activeWork = useActiveWork(project)
  const ai = useAIStream()
  const { loadAll: loadWorldview } = useWorldviewStore()
  const { loadAll: loadCreativeRules } = useCreativeRulesStore()
  const { loadAll: loadCharacters } = useCharacterStore()
  const { loadAll: loadOutline } = useOutlineStore()
  const { loadAll: loadForeshadows } = useForeshadowStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const [extractSource, setExtractSource] = useState<string | null>(null)
  const graphCompilation = useMemo(() => {
    try {
      return { compiled: compileWorkflowGraph(workflow), error: null as string | null }
    } catch (error) {
      return {
        compiled: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [workflow])
  const executionSteps = graphCompilation.compiled?.orderedSteps ?? []

  /**
   * 步骤输出累加器(FB-1 修复 · 缺陷 A)。
   * 用 ref 存每一步的输出,而非读 React state `results`——递归推进下一步时
   * `results` 闭包是上一次渲染的旧值(setResults 异步),会导致 previousOutput 永远取空。
   * ref.current 始终是最新值,且能跨「暂停/继续/重试」存活。
   */
  const stepOutputsRef = useRef<Map<string, string>>(new Map())

  /**
   * FB-7(BUG-INPUT-WITH-GEN):每个步骤的「用户输入」。
   * 此前步骤卡完全没有输入框,用户连「一句话故事」都没法自己敲。现在每步可预先输入,
   * 点生成时并入 ctx(作为 userHint/seed)。用 ref 读取避免闭包陈旧(同 FB-1 教训)。
   */
  const userInputsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (project?.id) {
      loadWorldview(project.id)
      loadCreativeRules(project.id)
      loadCharacters(project.id)
      loadOutline(project.id)
      loadForeshadows(project.id)
    }
  }, [project?.id, loadWorldview, loadCreativeRules, loadCharacters, loadOutline, loadForeshadows])

  const [results, setResults] = useState<Map<string, StepResult>>(() => {
    const m = new Map<string, StepResult>()
    executionSteps.forEach(s => m.set(s.stepId, { stepId: s.stepId, output: '', status: 'pending' }))
    return m
  })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'aborted'>('idle')

  const updateResult = (stepId: string, patch: Partial<StepResult>) => {
    setResults(prev => {
      const next = new Map(prev)
      const old = next.get(stepId)
      if (old) next.set(stepId, { ...old, ...patch })
      return next
    })
  }

  /**
   * 重新生成或改写较早节点后，旧的后序候选已经基于过期输入，不能继续展示为可保存结果。
   * v1 仍按稳定拓扑顺序串行执行，因此保守地作废该位置之后的全部候选，避免为省调用
   * 错把独立分支与过期依赖结果混在同一次运行里。
   */
  const invalidateFromIndex = (startIndex: number) => {
    const invalidated = executionSteps.slice(startIndex)
    if (!invalidated.length) return
    const invalidatedIds = new Set(invalidated.map(step => step.stepId))
    invalidatedIds.forEach(stepId => stepOutputsRef.current.delete(stepId))
    setResults(current => {
      const next = new Map(current)
      invalidated.forEach(step => {
        next.set(step.stepId, {
          stepId: step.stepId,
          output: '',
          status: 'pending',
        })
      })
      return next
    })
    setCurrentIndex(startIndex)
  }

  /**
   * 为第 idx 步装配上下文(FB-1 修复 · 缺陷 B：走 assembleContext,不再裸 renderPrompt)。
   * - 项目元信息 projectName/genres + 维度 dimension + userHint(此前全空,AI 失去依据)
   * - 经注册表 assembleContext 拉取已存项目设定(故事核心/世界观/角色/力量/词条)+ 真实与幻想规则
   * - 上一步输出经 ref 累加器取得(缺陷 A),与已存设定一起注入「通用前序上下文」槽位 worldContext
   *   (worldContext 是所有工作流步骤模板都读取的通用槽位,因此 step2 世界起源也能拿到 step1 一句话故事)
   * - 同时保留步骤声明的 inputMapping(供 chapter.content 的 chapterSummary 等特定变量)
   */
  const buildStepContext = async (
    step: PromptWorkflowStep,
  ): Promise<Record<string, string | number | undefined>> => {
    // ① 所有工作流都只读取显式图中指向自己的入边。
    const upstreamInputs = graphCompilation.compiled
      ? collectWorkflowUpstreamInputs(graphCompilation.compiled, step.stepId, stepOutputsRef.current)
      : []

    // ② 走注册表拉取已存项目设定 + 真实与幻想规则(单一事实源,不在此手挑 buildXxxContext · 缺陷 B)
    let assembledText = ''
    let worldRulesText = ''
    if (project?.id) {
      const wg = project.enableMultiWorld ? activeGroupId : null
      try {
        assembledText = (await assembleContext({
          projectId: project.id,
          worldGroupId: wg,
          sourceKeys: ['canonAssertions', 'storyCore', 'worldview', 'powerSystem', 'cultivationProgress', 'characters', 'codex'],
        })).text
      } catch { /* 上下文装配失败不应阻断生成 */ }
      try {
        worldRulesText = (await assembleContext({
          projectId: project.id,
          worldGroupId: wg,
          sourceKeys: ['worldRules'],
        })).text
      } catch { /* ignore */ }
    }

    // ③ 纯逻辑整形(可单测,见 tests/regression/R-WF-*)
    const ctx = assembleWorkflowStepVars({
      step,
      projectName: activeWork?.title,
      genres: activeWork?.genres.join('、'),
      assembledContext: assembledText,
      worldRulesContext: worldRulesText,
      userInput: userInputsRef.current.get(step.stepId),
      upstreamInputs,
    })
    return ctx
  }

  /** 执行第 idx 步 */
  const runStep = async (idx: number) => {
    const step = executionSteps[idx]
    if (!step) return
    const promptState = usePromptStore.getState()
    const tpl = step.templateId != null
      ? promptState.templates.find(template => template.id === step.templateId)
        ?? promptState.getActive(step.promptModuleKey)
      : promptState.getActive(step.promptModuleKey)

    updateResult(step.stepId, { status: 'running', output: '', error: undefined })

    try {
      let messages
      if (tpl.variableBindings?.length) {
        const wg = project?.enableMultiWorld ? activeGroupId : null
        const upstreamInputs = graphCompilation.compiled
          ? collectWorkflowUpstreamInputs(graphCompilation.compiled, step.stepId, stepOutputsRef.current)
          : []
        const workflowContext = formatWorkflowUpstreamContext(upstreamInputs)
        const bound = await assembleBoundPrompt({
          template: tpl,
          project,
          work: activeWork,
          worldGroupId: wg,
          previousOutput: workflowContext,
          workflowValues: groupWorkflowInputsByVariable(upstreamInputs),
          userHint: [step.userHint?.trim(), userInputsRef.current.get(step.stepId)?.trim()].filter(Boolean).join('\n'),
          manualValues: step.inputValues,
          parameterValues: step.parameterValues,
        })
        if (bound.missingScopes.length) {
          throw new Error(`当前模板需要${bound.missingScopes.join('、')}范围，请先补齐对应项目/章节选择`)
        }
        if (bound.missingVariables.length) {
          throw new Error(`请填写必填字段：${bound.missingVariables.join('、')}`)
        }
        messages = bound.messages
      } else {
        const ctx = await buildStepContext(step)
        messages = renderPrompt(tpl, ctx, { parameterValues: step.parameterValues }).messages
      }
      const generationNode = createWorkflowGenerationNode({
        workflowId: workflow.id ?? workflow.name,
        stepId: step.stepId,
        category: step.promptModuleKey,
        projectId: project?.id,
        ai,
      })
      const output = (
        await runGenerationNode(
          generationNode,
          prepareGenerationNode(generationNode, messages),
        )
      ).output
      // FB-1 修复 · 缺陷 A：把本步输出存进 ref(而非只存 React state),供下一步取用
      stepOutputsRef.current.set(step.stepId, output)
      updateResult(step.stepId, { status: 'done', output, tokenUsage: ai.tokenUsage })
      setCurrentIndex(idx + 1)

      // 是否暂停等用户确认
      if (step.userConfirmRequired && idx < executionSteps.length - 1) {
        setGlobalStatus('paused')
      } else if (idx === executionSteps.length - 1) {
        setGlobalStatus('completed')
      } else {
        // 继续下一步
        await runStep(idx + 1)
      }
    } catch (e) {
      updateResult(step.stepId, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
      setGlobalStatus('paused')
    }
  }

  const handleStart = () => {
    if (!graphCompilation.compiled) return
    stepOutputsRef.current.clear() // 全新运行:清空上一轮的步骤输出累加器
    setGlobalStatus('running')
    runStep(currentIndex)
  }

  const handleContinue = () => {
    if (!graphCompilation.compiled) return
    setGlobalStatus('running')
    runStep(currentIndex)
  }

  const handleSkip = (stepId: string) => {
    updateResult(stepId, { status: 'skipped' })
    setCurrentIndex(prev => prev + 1)
  }

  const handleRetryStep = (idx: number) => {
    invalidateFromIndex(idx)
    setGlobalStatus('running')
    runStep(idx)
  }

  const handleAbort = () => {
    ai.stop()
    setGlobalStatus('aborted')
  }

  return (
    <div className="p-5 space-y-3">
      <p className="text-xs text-warning">提示词实验：输出仅保留为可编辑草稿，请及时复制或导出。正式保存请转换流程到长篇节点，或通过设定提取生成可确认候选。</p>
      {extractSource !== null && project && <section className="rounded border border-border p-3"><button onClick={() => setExtractSource(null)}>关闭设定提取</button><CodexPanel project={project} embedded compact extractionSourceText={extractSource} /></section>}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">▶ 运行：{workflow.name}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{workflow.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {globalStatus === 'idle' && (
            <button
              onClick={handleStart}
              disabled={!graphCompilation.compiled || executionSteps.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
            >
              <Play className="w-4 h-4" /> 开始
            </button>
          )}
          {globalStatus === 'running' && (
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-error/10 text-error text-sm rounded hover:bg-error/20"
            >
              <Square className="w-4 h-4" /> 中止
            </button>
          )}
          {globalStatus === 'paused' && (
            <button
              onClick={handleContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover"
            >
              <Play className="w-4 h-4" /> 继续
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-text-secondary text-sm rounded hover:bg-bg-hover"
          >
            返回列表
          </button>
        </div>
      </div>

      {graphCompilation.error && (
        <div role="alert" className="px-3 py-2 rounded bg-error/10 text-error text-xs whitespace-pre-wrap">
          工作流图无法执行：{graphCompilation.error}
        </div>
      )}

      {/* 全局状态 */}
      {globalStatus !== 'idle' && (
        <div className={`px-3 py-2 rounded text-xs ${
          globalStatus === 'completed' ? 'bg-success/10 text-success' :
          globalStatus === 'aborted' ? 'bg-error/10 text-error' :
          globalStatus === 'paused' ? 'bg-warning/10 text-warning' :
          'bg-info/10 text-info'
        }`}>
          {globalStatus === 'running' && `▶ 正在运行第 ${currentIndex + 1} / ${executionSteps.length} 步...`}
          {globalStatus === 'paused' && `⏸ 已暂停（第 ${currentIndex + 1} 步等待你审核）`}
          {globalStatus === 'completed' && `✓ 工作流完成`}
          {globalStatus === 'aborted' && `✗ 已中止`}
        </div>
      )}

      <WorkflowExecutionGraph workflow={workflow} results={results} />

      {/* 步骤列表 */}
      <div className="space-y-2">
        {executionSteps.map((step, idx) => (
          <WorkflowStepCard
            key={step.stepId}
            step={step}
            index={idx}
            result={results.get(step.stepId)!}
            isCurrent={idx === currentIndex && globalStatus === 'running'}
            onSkip={() => handleSkip(step.stepId)}
            onRetry={() => handleRetryStep(idx)}
            onExtract={output => setExtractSource(output)}
            onUserInputChange={(v) => userInputsRef.current.set(step.stepId, v)}
            onOutputChange={(output) => {
              stepOutputsRef.current.set(step.stepId, output)
              updateResult(step.stepId, { output })
              if (idx < executionSteps.length - 1) {
                invalidateFromIndex(idx + 1)
                setGlobalStatus('paused')
              }
            }}
            hasProject={!!project?.id}
            actionsDisabled={globalStatus === 'running'}
          />
        ))}
      </div>

      {globalStatus === 'completed' && (
        <div className="bg-bg-surface border border-success/30 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-success mb-2">✓ 全部完成</h3>
          <p className="text-xs text-text-secondary mb-3">
            每步输出都是可编辑草稿，可以复制、导出，或提取为设定候选。
            候选需由你确认采纳后才会写入作品。
          </p>
        </div>
      )}
    </div>
  )
}
