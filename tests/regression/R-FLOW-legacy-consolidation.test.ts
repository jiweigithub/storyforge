import { beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { previewLegacyWorkflowMigrationV1, migrateLegacyWorkflowV1 } from '../../src/lib/node-authoring/legacy-workflow-migration'
import type { PromptWorkflow } from '../../src/lib/types/workflow'
import { serializeWorkflows, parseImportedWorkflows } from '../../src/lib/workflow/import-export'
import { authoringDomainActionBindingV1 } from '../../src/lib/node-authoring/domain-action-registry'
import { AUTHORING_NODE_BY_ID } from '../../src/lib/node-authoring/catalog'
beforeEach(async () => { await db.delete(); await db.open() })
function workflow(): PromptWorkflow {
  return { name: '旧世界设定', description: '保留原稿', scope: 'user', createdAt: 1, updatedAt: 1,
    steps: [ { stepId: 'a', label: '起源', promptModuleKey: 'worldview.dimension', saveTarget: { type: 'worldview-field', field: 'worldOrigin' }, userHint: '铜制天空' }, { stepId: 'b', label: '力量', promptModuleKey: 'worldview.dimension', saveTarget: { type: 'worldview-field', field: 'powerHierarchy' } } ],
    graph: { version: 1, nodes: [{ stepId: 'a', x: 0, y: 0 }, { stepId: 'b', x: 300, y: 0 }], edges: [{ edgeId: 'ab', sourceStepId: 'a', targetStepId: 'b', targetVariable: 'worldContext' }] } }
}
it('兼容流程保持布局、依赖和作者要求，转换只复制，不写任何作品字段', async () => {
  const { scope } = await seedCurrentWorkspace('迁移')
  const original = workflow(); original.id = await db.promptWorkflows.add(original)
  const preview = previewLegacyWorkflowMigrationV1(original)
  expect(preview.issues).toEqual([])
  expect(preview.graph.nodes[0].config.request).toBe('铜制天空')
  for (const node of preview.graph.nodes) expect(authoringDomainActionBindingV1(AUTHORING_NODE_BY_ID.get(node.templateId)!)?.mode).toBe('formal-domain-action')
  const id = await migrateLegacyWorkflowV1(original, scope.projectId, null)
  expect((await db.nodeFlows.get(id))?.graphJson).toBe(JSON.stringify(preview.graph))
  expect(await db.promptWorkflows.get(original.id!)).toEqual(original)
  expect(await db.worldviews.count()).toBe(0); expect(await db.nodeRuns.count()).toBe(0)
  expect(parseImportedWorkflows(JSON.parse(serializeWorkflows([original])), 3)[0].steps).toEqual(original.steps)
})
it('未知参数、固定模板、未知连线和不支持目标逐项报告，禁止部分静默转换', async () => {
  const { scope } = await seedCurrentWorkspace('迁移')
  const old = workflow(); old.steps[0].templateId = 12; old.steps[0].parameterValues = { temperature: 1 }; old.graph.edges[0].targetVariable = 'chapterSummary'; old.steps[1].saveTarget = { type: 'creativeRules-field', field: 'writingRules' }
  old.id = await db.promptWorkflows.add(old)
  expect(previewLegacyWorkflowMigrationV1(old).issues.join('\n')).toMatch(/固定模板/)
  expect(previewLegacyWorkflowMigrationV1(old).issues.join('\n')).toMatch(/变量/)
  await expect(migrateLegacyWorkflowV1(old, scope.projectId, null)).rejects.toThrow()
  expect(await db.nodeFlows.count()).toBe(0)
  expect(await db.promptWorkflows.get(old.id)).toEqual(old)
})
it('原流程在预览后被编辑时阻止转换', async () => {
  const { scope } = await seedCurrentWorkspace('迁移')
  const old = workflow(); old.id = await db.promptWorkflows.add(old)
  await db.promptWorkflows.update(old.id, { description: '新编辑' })
  await expect(migrateLegacyWorkflowV1(old, scope.projectId, null)).rejects.toThrow('已变化')
  expect(await db.nodeFlows.count()).toBe(0)
})
