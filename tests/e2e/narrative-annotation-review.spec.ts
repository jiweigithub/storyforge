import { expect, test } from '@playwright/test'

test('narrative target state remains distinct from original story and editable candidate after refresh', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW === '1', 'experimental author UI is hidden in production builds')
  await page.goto('./world/worlds')
  const projectId = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { createWorkspace } = await imp('/storyforge/src/lib/workspace/create-workspace.ts')
    const { stampNewRecord } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { generateNarrativeAnnotationCandidateV1 } = await imp('/storyforge/src/lib/agent/run/narrative-annotation-durable.ts')
    const { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-capture.ts')
    const { confirmNarrativeDomainAnnotationsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-authoring.ts')
    const created = await createWorkspace({ name: '旧注释与故事分开展示', genres: [], description: '', status: 'drafting', targetWordCount: 1000, enableMultiWorld: false }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const { scope } = created, owner = { kind: 'work', workCode: created.work.code }, now = Date.now()
    const id = await db.foreshadows.add(stampNewRecord(scope, 'foreshadows', { name: '渡口的两件事', type: 'dialogue', status: 'planned',
      description: '她把信收进衣袋，沿着河堤往前走。', notes: '', plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null,
      createdAt: now, updatedAt: now }, { owner: 'work' }))
    const row = await db.foreshadows.get(id)
    const children = ['测试用旧注释甲', '测试用旧注释乙'].map((statement, at) => ({
      semanticSubKey: 'sub:v1:00000000-0000-4000-8000-00000000000' + (at + 1), statement, developmentType: 'foreshadow',
      owners: [], members: [], state: 'open', transitions: [], resolutionEvidenceKeys: [], narrativeModalityV1: 'intent',
      narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'browser-fixture-v1' },
    }))
    const capture = await captureNarrativeDomainV1({ scope, owner })
    await confirmNarrativeDomainAnnotationsV1({ scope, table: 'foreshadows', recordId: id,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'foreshadows', capture.rows.get('foreshadows').find((item: { id: number }) => item.id === id)),
      annotations: { narrativeDevelopmentsV1: children } })
    await generateNarrativeAnnotationCandidateV1({ scope, instruction: '对照已有计划保留各自身份。',
      selection: { table: 'foreshadows', sourceUid: row.ragDocumentId, owner, entryKeys: [row.ragDocumentId + '::description'] },
      runAI: async (messages: Array<{ content: string }>) => {
        const target = JSON.parse(messages[1].content.split('\n登记原文与修改前状态：\n')[1]).targetState
        return { output: JSON.stringify({ annotations: target.annotations, clearFields: [] }), durationMs: 1 }
      } })
    return scope.projectId
  })
  await page.goto('./workspace/' + projectId + '?module=fact-library&narrative-preview=1')
  for (const refresh of [false, true]) {
    if (refresh) await page.reload()
    await page.getByRole('button', { name: '叙事注释（实验）', exact: true }).click()
    await page.getByText('核对本次使用的原文', { exact: true }).click()
    const originals = page.locator('details').filter({ has: page.getByText('核对本次使用的原文', { exact: true }) })
    await expect(originals).toContainText('她把信收进衣袋，沿着河堤往前走。')
    await expect(originals).not.toContainText('测试用旧注释甲')
    await page.getByText('核对修改前已有的注释', { exact: true }).click()
    const prior = page.locator('details').filter({ has: page.getByText('核对修改前已有的注释', { exact: true }) })
    await expect(prior).toContainText('测试用旧注释甲')
    await expect(prior).toContainText('测试用旧注释乙')
    await expect(prior).toContainText('不作为新增的故事原文证据')
    await expect(prior.getByRole('textbox')).toHaveCount(0)
    await expect(prior.getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '承诺或发展内容', exact: true })).toHaveCount(2)
  }
})

// The review UI is intentionally local-preview-only until NW-1C acceptance.
// Production builds must keep it hidden during this phase.
test('narrative annotation review edits a durable candidate and rolls back a native storage failure', async ({ page, browser }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW === '1', 'experimental author UI is hidden in production builds')
  test.setTimeout(120_000)
  await page.goto('./world/worlds')
  const seeded = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { createWorkspace } = await imp('/storyforge/src/lib/workspace/create-workspace.ts')
    const { stampNewRecord } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { generateNarrativeAnnotationCandidateV1 } = await imp('/storyforge/src/lib/agent/run/narrative-annotation-durable.ts')
    const { deriveExportProjectJSON } = await imp('/storyforge/src/lib/export/registry-export.ts')
    const created = await createWorkspace({ name: '叙事审核浏览器隔离验证', genres: [], description: '', status: 'drafting', targetWordCount: 1000, enableMultiWorld: false }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const { scope } = created, now = Date.now()
    const characterId = await db.characters.add(stampNewRecord(scope, 'characters', { name: '递信人', shortDescription: '渡口跑腿人', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
    const character = await db.characters.get(characterId)
    const generated = await generateNarrativeAnnotationCandidateV1({ scope, instruction: '只提出原文中已有的别名',
      selection: { table: 'characters', sourceUid: character.ragDocumentId, owner: { kind: 'work', workCode: created.work.code }, entryKeys: [character.ragDocumentId + '::shortDescription'] },
      runAI: async () => ({ output: JSON.stringify({ annotations: { narrativeAliasesV1: ['渡口跑腿人'] }, clearFields: [] }), durationMs: 1 }) })
    return { scope, characterId, sourceUid: character.ragDocumentId, runId: generated.snapshot.run.id,
      hash: generated.candidate.candidateHash, backup: await deriveExportProjectJSON(scope.projectId) }
  })
  await page.goto('./workspace/' + seeded.scope.projectId + '?module=fact-library')
  await expect(page.getByRole('button', { name: '叙事注释（实验）', exact: true })).toHaveCount(0)
  await page.goto('./workspace/' + seeded.scope.projectId + '?module=fact-library&narrative-preview=1')
  await page.getByRole('button', { name: '叙事注释（实验）', exact: true }).click()
  await expect(page.getByRole('region', { name: '叙事注释审核' })).toBeVisible()
  await expect(page.getByText('候选版本 1', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '别名', exact: true }).fill('')
  await page.getByRole('button', { name: '保存审核修改', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('非空')
  await expect(page.getByRole('textbox', { name: '别名', exact: true })).toHaveValue('')
  await expect(page.getByText('候选版本 1', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '别名', exact: true }).fill('渡口信使')
  await expect(page.getByRole('button', { name: '确认写入注释', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '保存审核修改', exact: true }).click()
  await expect(page.getByText('候选版本 2', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '叙事注释（实验）', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '别名', exact: true })).toHaveValue('渡口信使')
  await page.screenshot({ path: test.info().outputPath('narrative-review.png'), fullPage: true })
  for (const failedEvent of ['adoption.committed', 'memory.settlement.recorded']) {
    await page.evaluate(async failedEvent => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const original = db.agentRunEvents.add.bind(db.agentRunEvents)
      db.agentRunEvents.add = async (...args: unknown[]) => {
        if ((args[0] as { type: string }).type === failedEvent) { db.agentRunEvents.add = original; throw new Error('native-storage-failure-probe') }
        return original(...args)
      }
    }, failedEvent)
    await page.getByRole('button', { name: '确认写入注释', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'native-storage-failure-probe' })).toBeVisible()
    const rolledBack = await page.evaluate(async seeded => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const { readNarrativeAnnotationRunV1 } = await imp('/storyforge/src/lib/agent/run/narrative-annotation-durable.ts')
      const loaded = await readNarrativeAnnotationRunV1(seeded.scope, seeded.runId)
      return { row: await db.characters.get(seeded.characterId), state: loaded.snapshot.projection.state, intent: loaded.state.intent }
    }, seeded)
    expect(rolledBack.row.narrativeAuthorityV1).toBeUndefined()
    expect(rolledBack.row.narrativeAliasesV1).toBeUndefined()
    expect(rolledBack.state).toBe('awaiting_confirmation')
    expect(rolledBack.intent).toBeNull()
  }
  await page.getByRole('button', { name: '确认写入注释', exact: true }).click()
  await expect(page.getByText('本次注释已采纳。', { exact: true })).toBeVisible()
  const accepted = await page.evaluate(async seeded => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return db.characters.get(seeded.characterId)
  }, seeded)
  expect(accepted.narrativeAliasesV1).toEqual(['渡口信使'])
  expect(accepted.narrativeAuthorityV1.mode).toBe('candidate-adoption')

  const isolated = await browser.newContext()
  try {
    const other = await isolated.newPage()
    await other.goto(page.url())
    const restored = await other.evaluate(async seeded => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const { deriveImportProjectJSON } = await imp('/storyforge/src/lib/export/registry-import.ts')
      const { readNarrativeAnnotationRunV1, adoptNarrativeAnnotationCandidateV1 } = await imp('/storyforge/src/lib/agent/run/narrative-annotation-durable.ts')
      if (await db.projects.count()) throw new Error('restore must use an empty browser')
      const projectId = await deriveImportProjectJSON(seeded.backup).catch((error: Error) => { throw new Error('import: ' + error.name + ': ' + error.message + '\n' + error.stack) })
      const project = await db.projects.get(projectId)
      const scope = { projectId, worldId: project.activeWorldId, workId: project.activeWorkId }
      const run = await db.agentRuns.where('projectId').equals(projectId).first()
      const loaded = await readNarrativeAnnotationRunV1(scope, run.id).catch((error: Error) => { throw new Error('read: ' + error.name + ': ' + error.message + '\n' + error.stack) })
      await adoptNarrativeAnnotationCandidateV1({ scope, runId: run.id, candidateHash: loaded.candidate.candidateHash }).catch((error: Error) => { throw new Error('adopt: ' + error.name + ': ' + error.message) })
      return { candidateHash: loaded.candidate.candidateHash,
        aliases: (await db.characters.where('projectId').equals(projectId).first()).narrativeAliasesV1 }
    }, seeded)
    expect(restored.candidateHash).toBe(seeded.hash)
    expect(restored.aliases).toEqual(['渡口跑腿人'])
    const completedBackup = await page.evaluate(async projectId => {
      const imp = new Function('p', 'return import(p)')
      return (await imp('/storyforge/src/lib/export/registry-export.ts')).deriveExportProjectJSON(projectId)
    }, seeded.scope.projectId)
    const rebound = await other.evaluate(async backup => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const projectId = await (await imp('/storyforge/src/lib/export/registry-import.ts')).deriveImportProjectJSON(backup)
      const run = await db.agentRuns.where('projectId').equals(projectId).first()
      const character = await db.characters.where('projectId').equals(projectId).first()
      return { projectId, runId: run.id, character }
    }, completedBackup)
    await other.goto('./workspace/' + rebound.projectId + '?module=fact-library&narrative-preview=1')
    await other.getByRole('button', { name: '叙事注释（实验）', exact: true }).click()
    await other.getByRole('button', { name: '核验已采纳内容', exact: true }).click()
    await expect(other.getByText('本次注释已采纳。', { exact: true })).toBeVisible()
    const verified = await other.evaluate(async rebound => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      return { character: await db.characters.get(rebound.character.id),
        commits: (await db.agentRunEvents.where('runId').equals(rebound.runId).toArray()).filter((event: { type: string }) => event.type === 'adoption.committed').length }
    }, rebound)
    expect(verified.character).toEqual(rebound.character)
    expect(verified.commits).toBe(1)
  } finally { await isolated.close() }
})
