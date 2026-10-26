import { expect, test } from '@playwright/test'

test('NW-2D author compares a draft, recovers the real Worker task and explicitly seals a new revision while the old release stays fixed', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./world/worlds')
  const fixture = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)')
    const seed = await (await load('/storyforge/tests/helpers/narrative-release-fixture.ts')).seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } = await load('/storyforge/src/lib/world-engine/narrative-domain-capture.ts')
    const { confirmNarrativeDomainAnnotationsV1 } = await load('/storyforge/src/lib/world-engine/narrative-domain-authoring.ts')
    await db.characters.update(seed.actorId, { shortDescription: '穿灰外衣，仍持铜铃', updatedAt: Date.now() })
    const capture = await captureNarrativeDomainV1({ scope: seed.scope, owner: { kind: 'world', worldCode: seed.world.code, sourceWorkCode: null } })
    const actor = capture.rows.get('characters').find((row: { id: number }) => row.id === seed.actorId)
    await confirmNarrativeDomainAnnotationsV1({ scope: seed.scope, table: 'characters', recordId: seed.actorId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', actor),
      annotations: { narrativeVisibilityV1: actor.narrativeVisibilityV1, narrativeEvidenceV1: actor.narrativeEvidenceV1 } })
    return { projectId: seed.scope.projectId, revisionId: seed.revision.id, revisionCount: await db.worldRevisions.count(), release: seed.release }
  })
  await page.goto(`./world/versions?project=${fixture.projectId}&narrative-preview=1`)
  await page.getByRole('combobox', { name: '修改影响的比较基准', exact: true }).selectOption(String(fixture.revisionId))
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const original = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async (...args: unknown[]) => {
      const value = await original(...args)
      if ((args[0] as { type: string }).type === 'verification.accepted') {
        db.agentRunEvents.add = original
        throw Error('native-impact-checkpoint-rollback')
      }
      return value
    }
  })
  await page.getByRole('button', { name: '捕获并编译所选内容', exact: true }).click()
  await expect(page.getByText('native-impact-checkpoint-rollback', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '继续编译', exact: true }).click()
  await expect(page.getByTestId('narrative-compilation-state')).toContainText('编译完成')
  await expect(page.getByTestId('narrative-compilation-state')).toContainText('2/3')
  const plan = page.getByRole('region', { name: '世界修改影响' })
  await expect(plan).toContainText('需作者复核')
  await plan.getByText('查看逐项依据', { exact: true }).click()
  await expect(plan).toContainText('原始设定')
  const read = () => page.evaluate(async fixture => {
    const load = new Function('path', 'return import(path)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { resolveScopeLike } = await load('/storyforge/src/lib/workspace/scope.ts')
    const { listNarrativeCompilationTasksV1, readNarrativeCompilationTaskV1 } = await load('/storyforge/src/lib/world-engine/narrative-compilation-task.ts')
    const scope = await resolveScopeLike(fixture.projectId), runs = await listNarrativeCompilationTasksV1(scope)
    const task = await readNarrativeCompilationTaskV1(scope, runs[0].id)
    return { update: task.checkpoint.result.update, receiptHash: task.checkpoint.receiptHash,
      revisionCount: await db.worldRevisions.count(), release: await db.worldReleases.get(fixture.release.id) }
  }, fixture)
  const compiled = await read()
  expect(compiled.revisionCount).toBe(fixture.revisionCount)
  expect(compiled.release).toEqual(fixture.release)
  expect(compiled.update.impact.algorithmVersion).toBe('world-impact-evidence-v2')
  expect(compiled.update.indexReuse.reusedSources.length).toBeGreaterThan(0)
  await page.reload()
  expect((await read()).receiptHash).toBe(compiled.receiptHash)
  await page.getByRole('button', { name: '将编译结果冻结为修订', exact: true }).click()
  await expect(page.getByText(/这份编译结果已冻结为修订/)).toBeVisible()
  const sealed = await read()
  expect(sealed.revisionCount).toBe(fixture.revisionCount + 1)
  expect(sealed.release).toEqual(fixture.release)
  expect(sealed.update).toEqual(compiled.update)
})
