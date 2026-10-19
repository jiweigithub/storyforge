import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { StepCard, type StepResult } from '../../src/components/settings/prompt/WorkflowRunner'
import type { PromptWorkflowStep } from '../../src/lib/types/workflow'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const step: PromptWorkflowStep = {
  stepId: 'step-1',
  label: '一句话故事',
  promptModuleKey: 'story.generate',
  saveTarget: { type: 'storyCore-field', field: 'logline' },
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

async function mount(result: StepResult, overrides: { saveTarget?: PromptWorkflowStep['saveTarget']; hasProject?: boolean; actionsDisabled?: boolean } = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onExtract = vi.fn()
  const onUserInputChange = vi.fn()
  const onOutputChange = vi.fn()

  await act(async () => {
    root.render(createElement(StepCard, {
      step: 'saveTarget' in overrides ? { ...step, saveTarget: overrides.saveTarget } : step,
      index: 0,
      result,
      isCurrent: result.status === 'pending',
      onSkip: vi.fn(),
      onRetry: vi.fn(),
      onExtract,
      onUserInputChange,
      onOutputChange,
      hasProject: overrides.hasProject ?? true,
      actionsDisabled: overrides.actionsDisabled,
    }))
  })

  return { host, root, onExtract, onUserInputChange, onOutputChange }
}

describe('HEALTH-4 · 工作流步骤卡用户路径', () => {
  it('生成前输入会传给工作流运行器', async () => {
    const mounted = await mount({ stepId: step.stepId, output: '', status: 'pending' })
    const textarea = mounted.host.querySelector('textarea')!

    await act(async () => setTextareaValue(textarea, '用户自己的故事种子'))

    expect(mounted.onUserInputChange).toHaveBeenLastCalledWith('用户自己的故事种子')
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })

  it('编辑 AI 草稿后提取候选使用编辑值，不再提供直接写回入口', async () => {
    const mounted = await mount({ stepId: step.stepId, output: 'AI 原始结果', status: 'done' })
    const textareas = mounted.host.querySelectorAll('textarea')
    expect(textareas).toHaveLength(2)

    await act(async () => setTextareaValue(textareas[1], '用户修改后的结果'))
    expect(mounted.onOutputChange).toHaveBeenLastCalledWith('用户修改后的结果')
    const extractButton = Array.from(mounted.host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('提取为设定候选'))!
    await act(async () => extractButton.click())

    expect(mounted.onExtract).toHaveBeenCalledWith('用户修改后的结果')
    expect(mounted.host.textContent).not.toContain('保存到')
    expect(mounted.host.textContent).not.toContain('已存到')
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })

  it('未指定旧写入目标的草稿也能进入同一个候选流程', async () => {
    const mounted = await mount({ stepId: step.stepId, output: '自由实验草稿', status: 'done' }, { saveTarget: undefined })
    const button = Array.from(mounted.host.querySelectorAll('button'))
      .find(item => item.textContent?.includes('提取为设定候选'))!
    await act(async () => button.click())
    expect(mounted.onExtract).toHaveBeenCalledWith('自由实验草稿')
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })

  it.each([
    { output: '', hasProject: true, actionsDisabled: false },
    { output: '草稿', hasProject: false, actionsDisabled: false },
    { output: '草稿', hasProject: true, actionsDisabled: true },
  ])('空草稿、无作品或正在运行时不能提取：%o', async options => {
    const mounted = await mount({ stepId: step.stepId, output: options.output, status: 'done' }, options)
    const button = Array.from(mounted.host.querySelectorAll('button'))
      .find(item => item.textContent?.includes('提取为设定候选'))!
    expect(button.disabled).toBe(true)
    await act(async () => button.click())
    expect(mounted.onExtract).not.toHaveBeenCalled()
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })
})
