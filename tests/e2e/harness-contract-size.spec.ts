import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

test('a large accepted contract survives real IndexedDB persistence, revision and a page reload', async ({ page }) => {
  await createLongform(page, '运行合同快照大小回归')
  const saved = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { resolveScope } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const { createAgentRunV1, reviseAgentRunContractV1 } = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const { createAgentRunCheckpointV1 } = await importer('/storyforge/src/lib/agent/run/checkpoint.ts')
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    const acceptance = Array.from({ length: 1500 }, (_, index) => ({
      id: `outline.criterion.${index}`, kind: 'output-present', required: true,
    }))
    const contract = {
      version: 1, objective: '只读合同大小回归，不执行模型', workflowKind: 'read-only-audit',
      scope: { projectId: scope.projectId, worldGroupId: null },
      runtimeBindingHash: 'a'.repeat(64),
      permissions: { contextSourceKeys: ['worldview'], writeTargets: [] },
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1, maxOutputTokens: 1, maxAttemptsPerStep: 1 },
      acceptance,
      verificationPlan: [{ id: 'outline.complete', kind: 'terminal', verifier: 'terminal-v1', criterionIds: acceptance.map(row => row.id) }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    }
    const created = await createAgentRunV1({ scope, contract })
    const checkpoint = await createAgentRunCheckpointV1({ scope, runId: created.run.id })
    const revised = await reviseAgentRunContractV1({
      scope, runId: created.run.id, contract: { ...contract, objective: '修订后的只读合同' },
      expectedLastSequence: checkpoint.snapshot.projection.lastSequence,
    })
    return { scope, runId: revised.run.id, contractHash: revised.run.contractHash, length: revised.run.contractJson.length }
  })
  expect(saved.length).toBeGreaterThan(100_000)
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  const restored = await page.evaluate(async saved => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { readAgentRunV1 } = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const snapshot = await readAgentRunV1(saved.scope, saved.runId)
    return {
      generation: snapshot.run.generation, contractHash: snapshot.run.contractHash,
      criteria: snapshot.contract.acceptance.length,
      snapshots: snapshot.events.filter((event: any) => ['contract.accepted', 'contract.revised'].includes(event.type)).length,
      requestedModel: snapshot.events.some((event: any) => event.type === 'model.requested'),
    }
  }, saved)
  expect(restored).toEqual({ generation: 2, contractHash: saved.contractHash, criteria: 1500, snapshots: 2, requestedModel: false })
})
