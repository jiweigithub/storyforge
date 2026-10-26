import { expect, test } from '@playwright/test'

test('experimental author browser queries frozen facts and plans, then changes to a bounded character perspective without truth leakage', async ({ page }) => {
  test.setTimeout(120_000)
  // Match the domain corpus clock without changing browser timers or source
  // timestamps; otherwise its 2027 creation dates follow confirmation.
  await page.clock.setFixedTime(1_900_000_000_000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./world/worlds')
  const fixture = await page.evaluate(async () => {
    const imp = new Function('path', 'return import(path)')
    // Explicit test-owned annotations, not story extraction or author review.
    const { seedConfirmedNarrativeDomainV1 } = await imp('/storyforge/tests/helpers/narrative-domain-fixture.ts')
    const { createWorldRevision, publishWorldRevision } = await imp('/storyforge/src/lib/world-engine/releases.ts')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const seeded = await seedConfirmedNarrativeDomainV1()
    const revision = await createWorldRevision({ scope: seeded.scope, formatVersion: 4, includeWorkSources: true, label: '叙事查询隔离夹具' })
    const release = await publishWorldRevision(revision.id)
    const manifest = JSON.parse(release.manifestJson)
    const belief = manifest.narrative.bundle.records.find((row: { kind: string }) => row.kind === 'epistemic-event')
    const truth = manifest.narrative.bundle.records.find((row: { semanticId: string }) => row.semanticId === belief.payload.propositionRef.semanticId)
    await db.temporalFacts.update(seeded.ids.fact, { value: '草稿中的新值不许替换旧封存' })
    return { projectId: seeded.scope.projectId, releaseId: release.id, releaseHash: release.contentHash,
      characterKey: belief.payload.holderRef.semanticId, belief: belief.payload.assertedValue.value, truth: truth.payload.value.value,
      plan: seeded.development.statement, worldId: seeded.scope.worldId }
  })
  await page.goto(`./world/outlet?project=${fixture.projectId}&narrative-preview=1`)
  await expect(page.getByRole('region', { name: '实验叙事查询' })).toBeVisible()
  await page.getByLabel('叙事查询关键词').fill(fixture.truth)
  await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  const results = page.getByLabel('叙事查询结果', { exact: true })
  await expect(results).toContainText(fixture.truth)
  await expect(results).not.toContainText('草稿中的新值不许替换旧封存')
  await results.getByRole('button', { name: '查看完整原文证据' }).first().click()
  await expect(page.getByLabel('叙事查询原文证据')).toContainText(fixture.truth)
  await page.getByRole('button', { name: '作者计划', exact: true }).click()
  await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  await expect(results).toContainText(fixture.plan)
  await page.getByRole('button', { name: '已发生内容', exact: true }).click()
  await page.getByLabel('叙事查询时间点').fill('2')
  await page.getByLabel('叙事查询预览角色').selectOption(fixture.characterKey)
  await page.getByRole('button', { name: '预览截至此时的角色认知', exact: true }).click()
  await expect(page.getByText('当前视角：角色认知', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  await expect(results).toContainText(fixture.belief)
  await expect(results).not.toContainText(fixture.truth)
  await expect(results).not.toContainText(fixture.plan)
  await expect(page.getByLabel('叙事查询原文证据')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: '实验叙事查询' })).toBeVisible()
  const preserved = await page.evaluate(async id => {
    const imp = new Function('path', 'return import(path)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return (await db.worldReleases.get(id)).contentHash
  }, fixture.releaseId)
  expect(preserved).toBe(fixture.releaseHash)
})

test('author can read shared original evidence while fulfilled and pending developments stay in their own views after refresh', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW === '1', 'experimental author UI is hidden in production builds')
  test.setTimeout(120_000)
  await page.clock.setFixedTime(1_900_000_000_000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./world/worlds')
  const fixture = await page.evaluate(async () => {
    const imp = new Function('path', 'return import(path)')
    const { seedConfirmedNarrativeDomainV1 } = await imp('/storyforge/tests/helpers/narrative-domain-fixture.ts')
    const { createWorldRevision, publishWorldRevision } = await imp('/storyforge/src/lib/world-engine/releases.ts')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const seeded = await seedConfirmedNarrativeDomainV1()
    const arc = (await db.storyArcs.where('projectId').equals(seeded.scope.projectId).toArray())[0]
    const proof = await seeded.selfEvidence('chapters', seeded.ids.chapter, 'content', 'shared-story')
    const pending = { ...seeded.development, owners: [], members: [], transitions: [], developmentType: 'commitment', state: 'blocked' }
    const fulfilled = { ...pending, semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000003',
      statement: '测试用已兑现承诺', state: 'fulfilled', narrativeModalityV1: 'established', resolutionEvidenceKeys: ['shared-story'] }
    // Both explicit test annotations cite exactly the same frozen chapter.
    // No model request or claim of new human semantic review is involved.
    await seeded.confirm('storyArcs', arc.id, { narrativeDevelopmentsV1: [pending, fulfilled],
      narrativeEvidenceV1: [{ ...proof, source: { chapterId: seeded.ids.chapter, sourceUid: seeded.chapter.ragDocumentId } }] })
    const revision = await createWorldRevision({ scope: seeded.scope, formatVersion: 4, includeWorkSources: true, label: '共用原文证据的隔离查询' })
    const release = await publishWorldRevision(revision.id)
    return { projectId: seeded.scope.projectId, releaseId: release.id, manifestJson: release.manifestJson, original: seeded.chapter.content }
  })
  await page.goto(`./world/outlet?project=${fixture.projectId}&narrative-preview=1`)
  const results = page.getByLabel('叙事查询结果', { exact: true })
  const fulfilled = results.locator('article').filter({ has: page.getByRole('heading', { name: '承诺 · 已兑现', exact: true }) })
  const blocked = results.locator('article').filter({ has: page.getByRole('heading', { name: '承诺 · 受阻', exact: true }) })
  for (const refresh of [false, true]) {
    if (refresh) await page.reload()
    await page.getByRole('button', { name: '发展与承诺', exact: true }).click()
    await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
    await expect(fulfilled).toBeVisible()
    await expect(blocked).toHaveCount(0)
    await fulfilled.getByRole('button', { name: '查看完整原文证据' }).click()
    await expect(page.getByLabel('叙事查询原文证据')).toContainText(fixture.original)
    await page.getByRole('button', { name: '作者计划', exact: true }).click()
    await expect(page.getByLabel('叙事查询原文证据')).toHaveCount(0)
    await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
    await expect(blocked).toBeVisible()
    await expect(fulfilled).toHaveCount(0)
    await blocked.getByRole('button', { name: '查看完整原文证据' }).click()
    await expect(page.getByLabel('叙事查询原文证据')).toContainText(fixture.original)
  }
  const preserved = await page.evaluate(async id => {
    const imp = new Function('path', 'return import(path)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return (await db.worldReleases.get(id)).manifestJson
  }, fixture.releaseId)
  expect(preserved).toBe(fixture.manifestJson)
})

test('legacy author outlet lists an empty search and does not turn directory counts into narrative capabilities', async ({ page }) => {
  await page.goto('./world/worlds')
  const id = await page.evaluate(async () => {
    const imp = new Function('path', 'return import(path)')
    const { seedNarrativeFamily } = await imp('/storyforge/tests/helpers/narrative-world-evaluation.ts')
    const { default: corpus } = await imp('/storyforge/tests/acceptance/narrative-world/corpus-v1.json')
    return (await seedNarrativeFamily(corpus.families[0])).scope.projectId
  })
  await page.goto(`./world/outlet?project=${id}`)
  await expect(page.getByRole('heading', { name: '资源目录', exact: true })).toBeVisible()
  await expect(page.locator('.we-resource-list button').first()).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '实验叙事查询' })).toHaveCount(0)
})
