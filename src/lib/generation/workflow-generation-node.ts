import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import type { ChatMessage } from '../types'
import type { GenerationNode } from './generation-node'

/**
 * PromptWorkflow 步骤到统一 GenerationNode 的实验适配器。
 * category 仍来自已登记的 promptModuleKey；输出仅作实验草稿；正式写入必须转换到领域节点或另行提取 durable 候选。
 */
export function createWorkflowGenerationNode(input: {
  workflowId: number | string
  stepId: string
  category: string
  projectId?: number
  ai: Pick<UseAIStreamReturn, 'start'>
}): GenerationNode<ChatMessage[], string> {
  const { workflowId, stepId, category, projectId, ai } = input
  return {
    id: `workflow.${workflowId}.${stepId}`,
    kind: category,
    editableInput: true,
    assembleInput: messages => messages.map(message => ({ ...message })),
    run: messages => ai.start(messages, undefined, {
      formalEntryId: 'prompt.workflow.step',
      category: category,
      projectId,
    }),
  }
}
