import { AUTHORING_NODE_CATALOG, defaultConfigForTemplate } from './catalog'
import { authoringDomainActionBindingV1 } from './domain-action-registry'
import { emptyAuthoringGraph, type AuthoringNodeGraph, type AuthoringNodeTemplate } from './contracts'
import { validateAuthoringGraph } from './graph'
import { compileWorkflowGraph } from '../workflow/graph'
import type { PromptWorkflow, SaveTarget } from '../types/workflow'
import { db } from '../db/schema'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { canonicalStringify } from '../agent/run/hash'

function sameTarget(template: AuthoringNodeTemplate, target: SaveTarget | undefined): boolean {
  if (!target) return true
  if (target.type === 'worldview-field' || target.type === 'storyCore-field' || target.type === 'creativeRules-field') {
    const table = { 'worldview-field': 'worldviews', 'storyCore-field': 'storyCores', 'creativeRules-field': 'creativeRules' }[target.type]
    return target.mode !== 'append' && template.writes?.target === table && !!template.writes.fields?.includes(target.field)
  }
  const table = { 'create-characters': 'characters', 'create-outline-nodes': 'outlineNodes', 'create-foreshadows': 'foreshadows' }[target.type]
  return template.writes?.target === table
}

export function previewLegacyWorkflowMigrationV1(workflow: PromptWorkflow): { graph: AuthoringNodeGraph; issues: string[]; mappings: string[] } {
  const graph = emptyAuthoringGraph(); const issues: string[] = []; const mappings: string[] = []
  try { compileWorkflowGraph(workflow) } catch (error) { issues.push(String(error)); return { graph, issues, mappings } }
  for (const step of workflow.steps) {
    const candidates = AUTHORING_NODE_CATALOG.filter(template => template.promptModuleKey === step.promptModuleKey
      && authoringDomainActionBindingV1(template)?.mode === 'formal-domain-action' && sameTarget(template, step.saveTarget))
    if (candidates.length !== 1) { issues.push(`${step.label}：${candidates.length ? '保存目标有多个匹配，请先明确字段' : '尚无等价正式节点'}（${step.promptModuleKey}）。`); continue }
    const template = candidates[0]
    if (step.templateId != null) issues.push(`${step.label}：固定模板版本 #${step.templateId} 不能自动转换，请在正式节点重新选择。`)
    if (Object.keys(step.parameterValues ?? {}).length || Object.keys(step.inputValues ?? {}).length) issues.push(`${step.label}：包含自定义参数或变量值，需在正式节点核对。`)
    for (const [source, variable] of Object.entries(step.inputMapping ?? {})) {
      if (source !== 'previousOutput' || variable !== 'worldContext') issues.push(`${step.label}：变量映射 ${source} → ${variable} 无法无损转换。`)
    }
    const position = workflow.graph.nodes.find(node => node.stepId === step.stepId)
    graph.nodes.push({ id: step.stepId, templateId: template.id, templateVersion: 1, title: step.label,
      x: position?.x ?? 0, y: position?.y ?? 0, config: { ...defaultConfigForTemplate(template), request: step.userHint ?? '' },
      inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs),
      note: '从提示词实验复制；正式执行产生候选，作者确认后才写入。' })
    mappings.push(`${step.label} → ${template.label}`)
  }
  for (const edge of workflow.graph.edges) {
    if (edge.targetVariable !== 'worldContext') { issues.push(`连线 ${edge.edgeId}：变量 ${edge.targetVariable} 没有等价正式输入。`); continue }
    graph.edges.push({ id: edge.edgeId, sourceNodeId: edge.sourceStepId, sourcePortId: 'candidate', targetNodeId: edge.targetStepId, targetPortId: 'context', mapping: { mode: 'full', missingPolicy: 'block', refreshPolicy: 'live' } })
  }
  if (workflow.graph.viewport) graph.viewport = { ...workflow.graph.viewport }
  issues.push(...validateAuthoringGraph(graph).map(issue => issue.message))
  if (!graph.nodes.length) issues.push('没有可转换的步骤。')
  return { graph, issues: [...new Set(issues)], mappings }
}

/** Copy only. Never remove or rewrite a legacy template, run output, or Canon record. */
export async function migrateLegacyWorkflowV1(workflow: PromptWorkflow, projectId: number, worldGroupId: number | null) {
  const preview = previewLegacyWorkflowMigrationV1(workflow)
  if (preview.issues.length) throw new Error(preview.issues.join('\n'))
  const scope = await resolveScope({ projectId })
  return db.transaction('rw', scopeTransactionTables(db.promptWorkflows, db.nodeFlows), async () => {
    if (workflow.id == null || canonicalStringify(await db.promptWorkflows.get(workflow.id)) !== canonicalStringify(workflow)) throw new Error('原工作流已变化，请重新预览转换。')
    if (canonicalStringify(await resolveScope({ projectId })) !== canonicalStringify(scope)) throw new Error('作品已切换，请重新预览。')
    const now = Date.now()
    return db.nodeFlows.add(stampNewRecord(scope, 'nodeFlows', { projectId, worldGroupId,
      name: `${workflow.name}（正式节点副本）`, description: `复制自提示词实验 #${workflow.id}；原始流程保留。${workflow.description}`,
      graphJson: JSON.stringify(preview.graph), createdAt: now, updatedAt: now }, { owner: 'work' }))
  })
}
