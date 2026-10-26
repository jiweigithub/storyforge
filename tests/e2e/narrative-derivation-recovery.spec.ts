import { expect, test, type Page } from '@playwright/test'

async function sourceFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./long')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByRole('textbox', { name: '新长篇名称' }).fill('派生中断的原作')
  await page.getByRole('button', { name: '创建并进入工作台' }).click()
  await expect(page.getByRole('navigation', { name: '长篇工作台二级导航' })).toBeVisible()
  const scope = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord, resolveScopeLike } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-capture.ts')
    const { confirmNarrativeDomainAnnotationsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-authoring.ts')
    const project = (await db.projects.toArray())[0], scope = await resolveScopeLike(project.id)
    const work = await db.works.get(scope.workId), owner = { kind: 'work', workCode: work.code }, now = Date.now()
    const id = await db.characters.add(stampNewRecord(scope, 'characters', { name: '阿澈', shortDescription: '铜铃仍在他手中。',
      roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '',
      createdAt: now, updatedAt: now }, { owner: 'world' }))
    const capture = await captureNarrativeDomainV1({ scope, owner })
    const row = capture.rows.get('characters').find((row: { id: number }) => row.id === id)
    await confirmNarrativeDomainAnnotationsV1({ scope, owner, table: 'characters', recordId: id,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', row), annotations: {
        narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'native-crash-v1' },
      } })
    return scope as { projectId: number; worldId: number; workId: number }
  })
  await page.getByRole('navigation', { name: '长篇一级导航' }).getByRole('button', { name: '派生世界', exact: true }).click()
  const url = new URL(page.url()); url.searchParams.set('narrative-preview', '1'); await page.goto(url.toString())
  await expect(page.getByText('实验：保留叙事索引与来源对照', { exact: true })).toBeVisible()
  return { scope, url: page.url(), original: await readState(page, scope.projectId) }
}

async function readState(page: Page, projectId: number) {
  return page.evaluate(async projectId => {
    const imp = new Function('p', 'return import(p)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const project = await db.projects.get(projectId)
    return { counts: { projects: await db.projects.count(), worlds: await db.worlds.count(), works: await db.works.count(),
      actors: await db.characters.count(), derivations: await db.worldDerivations.count(),
      revisions: await db.worldRevisions.count(), releases: await db.worldReleases.count() },
    // Raw IndexedDB roots may have explicit undefined optional fields. Preserve
    // them in this test snapshot; they are not a strict Narrative JSON payload.
    source: JSON.stringify({ project, work: await db.works.get(project.activeWorkId),
      world: await db.worlds.get(project.activeWorldId), actors: await db.characters.where('projectId').equals(projectId).toArray() },
    (_key, value) => value === undefined ? { testUndefined: true } : value) }
  }, projectId)
}

for (const { phase, termination } of [
  { phase: 'worker-result', termination: 'close' },
  { phase: 'revision-write', termination: 'close' },
  { phase: 'revision-write', termination: 'crash' },
] as const) {
  test(`native renderer ${termination} at ${phase} leaves only the source; explicit retry commits once`, async ({ page, context }) => {
    test.setTimeout(120_000)
    const source = await sourceFixture(page)
    await page.evaluate(async ({ phase, scope }) => {
      const imp = new Function('p', 'return import(p)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const { deriveNovelToWorld } = await imp('/storyforge/src/lib/world-engine/derivation.ts')
      const Dexie = db.constructor
      const state = { stage: '', workerCompleted: false, error: '', inTransactionProjects: 0 }
      Object.assign(window, { nwDerivationCrash: state })
      // Use a real native Worker; pause only delivery of its completed result.
      const NativeWorker = window.Worker
      window.Worker = class extends NativeWorker {
        set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
          super.onmessage = event => {
            if (event.data?.status === 'complete') {
              state.workerCompleted = true
              if (phase === 'worker-result') { state.stage = phase; return }
            }
            handler?.call(this, event)
          }
        }
      }
      if (phase === 'revision-write') {
        const original = db.worldRevisions.add.bind(db.worldRevisions)
        db.worldRevisions.add = async (...args: unknown[]) => {
          const id = await original(...args)
          state.inTransactionProjects = await db.projects.count()
          state.stage = phase
          // Keep the actual IndexedDB transaction open until the page dies.
          await Dexie.waitFor(new Promise(() => {}), 60_000)
          return id
        }
      }
      void deriveNovelToWorld({ sourceScope: scope, formatVersion: 4, selectedTables: ['characters'], publish: true })
        .catch((error: Error) => { state.error = error.message })
    }, { phase, scope: source.scope })
    await expect.poll(() => page.evaluate(() => (window as unknown as { nwDerivationCrash: { stage: string; error: string } })
      .nwDerivationCrash), { timeout: 30_000 }).toMatchObject({ stage: phase, workerCompleted: true, error: '' })
    if (phase === 'revision-write') expect(await page.evaluate(() =>
      (window as unknown as { nwDerivationCrash: { inTransactionProjects: number } }).nwDerivationCrash.inTransactionProjects)).toBe(2)
    if (termination === 'crash') {
      const session = await context.newCDPSession(page)
      const crashed = page.waitForEvent('crash', { timeout: 10_000 })
      // Crash the isolated renderer while its real IDB transaction is active;
      // this must recover without JS catch/finally or unload cleanup running.
      void session.send('Page.crash').catch(() => {})
      await crashed
    }
    await page.close()
    const reopened = await context.newPage()
    await reopened.goto(source.url)
    expect(await readState(reopened, source.scope.projectId)).toEqual(source.original)
    await expect(reopened.getByText('这部作品还没有派生世界。完成派生后，可以在这里查看来源并制作世界分享包。', { exact: true })).toBeVisible()
    await reopened.getByRole('button', { name: '派生并封存 v1', exact: true }).click()
    await reopened.getByRole('dialog').getByRole('button', { name: '派生并封存', exact: true }).click()
    await expect(reopened.getByRole('button', { name: '打开世界', exact: true })).toBeVisible()
    const retried = await readState(reopened, source.scope.projectId)
    expect(retried.source).toBe(source.original.source)
    expect(retried.counts).toEqual({ projects: 2, worlds: 2, works: 2, actors: 2, derivations: 1, revisions: 1, releases: 1 })
    await reopened.close()
  })
}

test('a committed derivation survives a lost acknowledgement and reopens through the existing source list without another copy', async ({ page, context }) => {
  test.setTimeout(120_000)
  const source = await sourceFixture(page)
  await page.evaluate(async scope => {
    const imp = new Function('p', 'return import(p)')
    const { deriveNovelToWorld } = await imp('/storyforge/src/lib/world-engine/derivation.ts')
    const state = { targetProjectId: 0, error: '' }; Object.assign(window, { nwLostAcknowledgement: state })
    void (async () => {
      const result = await deriveNovelToWorld({ sourceScope: scope, formatVersion: 4, selectedTables: ['characters'], publish: true })
      state.targetProjectId = result.targetProjectId
      // Storage has committed. No UI completion callback gets this result.
      await new Promise(() => {})
    })().catch((error: Error) => { state.error = error.message })
  }, source.scope)
  await expect.poll(() => page.evaluate(() => (window as unknown as { nwLostAcknowledgement: { targetProjectId: number } })
    .nwLostAcknowledgement.targetProjectId), { timeout: 30_000 }).toBeGreaterThan(0)
  const targetProjectId = await page.evaluate(() => (window as unknown as { nwLostAcknowledgement: { targetProjectId: number } })
    .nwLostAcknowledgement.targetProjectId)
  await page.close()
  const reopened = await context.newPage(); await reopened.goto(source.url)
  await expect(reopened.getByRole('button', { name: '打开世界', exact: true })).toBeVisible()
  await expect(reopened.getByLabel('选择世界').locator('option')).toHaveCount(1)
  await reopened.getByRole('button', { name: '打开世界', exact: true }).click()
  await expect.poll(() => new URL(reopened.url()).searchParams.get('project')).toBe(String(targetProjectId))
  const saved = await readState(reopened, source.scope.projectId)
  expect(saved.source).toBe(source.original.source)
  expect(saved.counts).toEqual({ projects: 2, worlds: 2, works: 2, actors: 2, derivations: 1, revisions: 1, releases: 1 })
  const verified = await reopened.evaluate(async targetProjectId => {
    const imp = new Function('p', 'return import(p)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { verifyWorldReleaseRecordV1 } = await imp('/storyforge/src/lib/world-engine/release-codec.ts')
    const release = await db.worldReleases.where('projectId').equals(targetProjectId).first()
    const checked = await verifyWorldReleaseRecordV1(release)
    return { version: checked.version, aliases: checked.manifest.narrative.bundle.aliases.length }
  }, targetProjectId)
  expect(verified).toEqual({ version: 4, aliases: 1 })
  await reopened.close()
})
