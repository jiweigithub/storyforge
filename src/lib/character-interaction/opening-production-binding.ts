import {readAgentRunV1} from '../agent/run/event-store'
import type {ProductProductionTaskExecutionInputV1} from '../product-production/scheduler'
import {CHAT_OPENING_AGENCY_GATE_V2} from './opening-agency'

/** Select prompt/output semantics from this durable attempt, never the live registry. */
export async function readChatOpeningProductionVersionV1(input: ProductProductionTaskExecutionInputV1): Promise<{groundedAgency: boolean}> {
  if (input.taskRunId == null) throw new Error('开场制作缺少冻结任务运行，不能选择提示版本')
  const snapshot = await readAgentRunV1(input.scope, input.taskRunId)
  const binding = snapshot.contract.executionBindings?.find(b => b.stepId === input.task.taskKey && b.skillId === input.task.skillId)
  const scope = snapshot.contract.scope.productProduction
  if (!scope || scope.productBuildId !== input.buildId || scope.buildNumber !== input.buildNumber || scope.controlEpoch !== input.controlEpoch || scope.planHash !== input.planHash || scope.taskKey !== input.task.taskKey || !binding) throw new Error('开场制作提示绑定不属于本次任务')
  if (!['character.chat-situation-production', 'character.chat-opening-review'].includes(input.task.skillId ?? '')) throw new Error('不是开场制作或审查任务')
  const production = input.task.skillId === 'character.chat-situation-production'
  // Only pre-change versions with independently verified prompt bytes are executable.
  const allowed = production ? ['chat-situation-production-v5', 'chat-situation-production-v6'] : ['chat-opening-review-v1', 'chat-opening-review-v2']
  if (!allowed.includes(binding.promptVersion)) throw new Error('无法执行未支持的冻结开场提示版本')
  const groundedAgency = binding.promptVersion === (production ? 'chat-situation-production-v6' : 'chat-opening-review-v2')
  if (input.task.acceptanceGateIds.includes(CHAT_OPENING_AGENCY_GATE_V2) && !groundedAgency) throw new Error('冻结开场合同不支持当前行动机会验收，不能自动换约')
  return {groundedAgency}
}
