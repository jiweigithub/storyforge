import { expect, test } from '@playwright/test'

test('experimental novel derivation keeps source ownership and freezes reviewed cross-owner references with lineage', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./long')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByRole('textbox', { name: '新长篇名称' }).fill('风里的铜铃 · 派生隔离验收')
  await page.getByRole('button', { name: '创建并进入工作台' }).click()
  await expect(page.getByRole('navigation', { name: '长篇工作台二级导航' })).toBeVisible()
  const source = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord, resolveScopeLike } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-capture.ts')
    const { confirmNarrativeDomainAnnotationsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-authoring.ts')
    const project = (await db.projects.toArray())[0], scope = await resolveScopeLike(project.id), work = await db.works.get(scope.workId)
    const owner = { kind: 'work', workCode: work.code }, now = Date.now()
    const id = await db.characters.add(stampNewRecord(scope, 'characters', { name: '阿澈', shortDescription: '雨中的掌铃人',
      roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
    let capture = await captureNarrativeDomainV1({ scope, owner })
    const actor = capture.rows.get('characters').find((r: { id: number }) => r.id === id)
    const visibility = { class: 'public', audienceKeys: [], policyVersion: 'native-derivation-v1' }
    await confirmNarrativeDomainAnnotationsV1({ scope, owner, table: 'characters', recordId: id,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', actor), annotations: { narrativeVisibilityV1: visibility } })
    const eventId = await db.storyTimelineEvents.add(stampNewRecord(scope, 'storyTimelineEvents', {
      title: '举起铜铃', description: '阿澈举起铜铃，查看铃沿。', importance: 1, order: 0, createdAt: now, updatedAt: now }, { owner: 'work' }))
    capture = await captureNarrativeDomainV1({ scope, owner })
    const event = capture.rows.get('storyTimelineEvents').find((r: { id: number }) => r.id === eventId)
    await confirmNarrativeDomainAnnotationsV1({ scope, owner, table: 'storyTimelineEvents', recordId: eventId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'storyTimelineEvents', event), annotations: {
        narrativeModalityV1: 'established', narrativeVisibilityV1: visibility, narrativeEventV1: { eventType: 'action',
          participants: [{ entity: { characterId: id, sourceUid: actor.ragDocumentId }, role: 'actor' }], locations: [],
          propositions: [], effects: [], communication: null, observer: null, before: [] } } })
    return { projectId: project.id, worldId: scope.worldId, workId: work.id, workCode: work.code, actorId: id,
      originalAuthority: (await db.characters.get(id)).narrativeAuthorityV1 }
  })
  await page.getByRole('navigation', { name: '长篇一级导航' }).getByRole('button', { name: '派生世界', exact: true }).click()
  const url = new URL(page.url()); url.searchParams.set('narrative-preview', '1'); await page.goto(url.toString())
  await expect(page.getByText('实验：保留叙事索引与来源对照', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '派生并封存 v1', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '派生并封存', exact: true }).click()
  await expect.poll(() => page.evaluate(async projectId => {
    const imp = new Function('p', 'return import(p)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return (await db.worldDerivations.toArray()).filter((r: { projectId: number; targetReleaseId: number | null }) => r.projectId !== projectId && r.targetReleaseId !== null).length
  }, source.projectId), { timeout: 30_000 }).toBe(1)
  await page.reload()
  const result = await page.evaluate(async source => {
    const imp = new Function('p', 'return import(p)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { verifyWorldReleaseRecordV1 } = await imp('/storyforge/src/lib/world-engine/release-codec.ts')
    const row = (await db.worldDerivations.toArray())[0], release = await db.worldReleases.get(row.targetReleaseId)
    const verified = await verifyWorldReleaseRecordV1(release)
    return { purpose: (await db.projects.get(source.projectId)).workspacePurpose, workCode: (await db.works.get(source.workId)).code,
      actorWorldId: (await db.characters.get(source.actorId)).worldId, authority: (await db.characters.get(source.actorId)).narrativeAuthorityV1,
      version: verified.version, aliases: verified.manifest.narrative.bundle.aliases.length,
      kinds: verified.manifest.narrative.bundle.records.map((r: { kind: string }) => r.kind).sort() }
  }, source)
  expect(result).toEqual({ purpose: 'independent-work', workCode: source.workCode, actorWorldId: source.worldId,
    authority: source.originalAuthority, version: 4, aliases: 2, kinds: ['entity', 'event'] })
})

test('experimental compilation UI recovers after native checkpoint rollback and seals only by author action', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./world/worlds')
  await page.getByRole('button', { name: '新建世界', exact: true }).click()
  await page.getByLabel('新世界名称').fill('可恢复的叙事世界')
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await expect(page).toHaveURL(/world\/basics\?project=/)
  const projectId = Number(new URL(page.url()).searchParams.get('project'))
  await page.goto(`./world/versions?project=${projectId}`)
  await expect(page.getByRole('button', { name: '捕获并编译所选内容', exact: true })).toHaveCount(0)
  await page.goto(`./world/versions?project=${projectId}&narrative-preview=1`)
  await expect(page.getByRole('button', { name: '捕获并编译所选内容', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const original = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async (...args: unknown[]) => {
      const result = await original(...args)
      if ((args[0] as { type: string }).type === 'verification.accepted') {
        db.agentRunEvents.add = original
        throw Error('native-compilation-checkpoint-rollback')
      }
      return result
    }
  })
  await page.getByRole('button', { name: '捕获并编译所选内容', exact: true }).click()
  await expect(page.getByText('native-compilation-checkpoint-rollback', { exact: true })).toBeVisible()
  const interrupted = await page.evaluate(async projectId => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { resolveScopeLike } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { readNarrativeCompilationTaskV1 } = await imp('/storyforge/src/lib/world-engine/narrative-compilation-task.ts')
    const scope = await resolveScopeLike(projectId), run = await db.agentRuns.where('projectId').equals(projectId).first()
    const loaded = await readNarrativeCompilationTaskV1(scope, run.id)
    return { state: loaded.snapshot.projection.state, result: loaded.checkpoint.result ?? null,
      revisions: await db.worldRevisions.count(), releases: await db.worldReleases.count() }
  }, projectId)
  expect(interrupted).toEqual({ state: 'paused', result: null, revisions: 0, releases: 0 })
  await page.reload()
  await expect(page.getByTestId('narrative-compilation-state')).toContainText('等待继续')
  await page.getByRole('button', { name: '继续编译', exact: true }).click()
  await expect(page.getByTestId('narrative-compilation-state')).toContainText('编译完成')
  await expect(page.getByTestId('narrative-compilation-state')).toContainText('2/3')
  await page.reload()
  await expect(page.getByTestId('narrative-compilation-state')).toContainText('编译完成')
  await expect(page.getByRole('button', { name: '发布版本', exact: true })).toBeDisabled()
  await page.getByLabel('修订名称').fill('确认冻结的可恢复版本')
  await page.getByRole('button', { name: '将编译结果冻结为修订', exact: true }).click()
  await expect(page.getByRole('button', { name: '将编译结果冻结为修订', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '发布版本', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '发布版本', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '发布世界版本', exact: true }).click()
  const completed = await page.evaluate(async projectId => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const release = await db.worldReleases.where('projectId').equals(projectId).first()
    const events = await db.agentRunEvents.where('projectId').equals(projectId).toArray()
    return { version: JSON.parse(release.manifestJson).version, models: events.filter((e: { type: string }) => e.type === 'model.requested').length,
      revisions: await db.worldRevisions.count(), releases: await db.worldReleases.count() }
  }, projectId)
  expect(completed).toEqual({ version: 4, models: 0, revisions: 1, releases: 1 })
})

// Native IndexedDB/API coverage. The formal v4 author UI remains gated.
test('v4 seal and package survive native storage failure, isolated import and reload', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await page.goto('./world/worlds')
  const sealed = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { createWorkspace } = await imp('/storyforge/src/lib/workspace/create-workspace.ts')
    const { stampNewRecord } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-capture.ts')
    const { confirmNarrativeDomainAnnotationsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-authoring.ts')
    const { createWorldRevision, publishWorldRevision } = await imp('/storyforge/src/lib/world-engine/releases.ts')
    const { createWorldPackage } = await imp('/storyforge/src/lib/world-engine/world-package.ts')
    const { captureWorldReleaseInputV4 } = await imp('/storyforge/src/lib/world-engine/narrative-release-capture.ts')
    const { compileNarrativeReleaseInWorkerV1 } = await imp('/storyforge/src/lib/world-engine/narrative-release-worker.ts')
    const created = await createWorkspace({ name: 'v4 隔离往返', genres: [], description: '', status: 'drafting', targetWordCount: 1000, enableMultiWorld: false }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const { scope } = created, now = Date.now()
    const id = await db.characters.add(stampNewRecord(scope, 'characters', { name: '老顾', shortDescription: '风雨中的守渡人',
      roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
    const capture = await captureNarrativeDomainV1({ scope, owner: { kind: 'world', worldCode: created.world.code, sourceWorkCode: null } })
    const row = capture.rows.get('characters').find((r: { id: number }) => r.id === id)
    await confirmNarrativeDomainAnnotationsV1({ scope, table: 'characters', recordId: id,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', row),
      annotations: { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'browser-test-v1' } } })
    const input = { scope, label: '原生 v4 封存', formatVersion: 4, selectedTables: ['characters'] }
    const captured = await captureWorldReleaseInputV4(input), controller = new AbortController()
    let workerPhase = '', cancelled = ''
    try {
      await compileNarrativeReleaseInWorkerV1(captured.input, { signal: controller.signal,
        onProgress: (phase: string) => { workerPhase = phase; controller.abort() } })
    } catch (error) { cancelled = (error as Error).name }
    if (workerPhase !== 'worker-started' || cancelled !== 'AbortError' || await db.worldRevisions.count() !== 0) throw Error('Native worker cancellation did not preserve empty revision state')
    const revision = await createWorldRevision(input), release = await publishWorldRevision(revision.id)
    const originalAdd = db.worldRevisions.add.bind(db.worldRevisions)
    db.worldRevisions.add = async (...args: unknown[]) => {
      await originalAdd(...args)
      throw Error('native-revision-rollback')
    }
    let failure = ''
    try { await createWorldRevision({ ...input, label: '故障中的封存' }) }
    catch (error) { failure = String(error) }
    finally { db.worldRevisions.add = originalAdd }
    if (!failure.includes('native-revision-rollback') || await db.worldRevisions.count() !== 1) throw Error('Revision transaction failed to roll back: ' + failure)
    if ((await createWorldRevision(input)).id !== revision.id) throw Error('Idempotent revision drifted')
    if ((await db.worldReleases.get(release.id)).manifestJson !== release.manifestJson) throw Error('Old release changed')
    const pkg = await createWorldPackage(release.id, { authorName: '隔离测试', license: 'CC-BY-4.0', allowedUses: {
      'world-remix': true, ttrpg: true, 'character-interaction': true, 'ai-town': false, 'text-adventure': false, avg: false, 'text-open-world': false,
    } })
    return { pkg, manifestJson: release.manifestJson, contentHash: release.contentHash, failure }
  })
  expect(sealed.pkg.packageVersion).toBe(4)
  expect(sealed.failure).toContain('native-revision-rollback')
  const isolated = await browser.newContext()
  try {
    const restored = await isolated.newPage()
    await restored.goto(page.url())
    const imported = await restored.evaluate(async pkg => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const { importWorldPackage } = await imp('/storyforge/src/lib/world-engine/world-package.ts')
      const { verifyWorldReleaseRecordV1 } = await imp('/storyforge/src/lib/world-engine/release-codec.ts')
      if (await db.projects.count()) throw Error('Import browser is not empty')
      const add = db.worldReleases.add.bind(db.worldReleases)
      db.worldReleases.add = async (...args: unknown[]) => { await add(...args); throw Error('native-import-final-write') }
      let failed = ''
      try { await importWorldPackage(pkg) } catch (error) { failed = String(error) }
      finally { db.worldReleases.add = add }
      const leftovers = await Promise.all([db.projects.count(), db.worlds.count(), db.works.count(), db.characters.count(),
        db.worldDerivations.count(), db.worldRevisions.count(), db.worldReleases.count()])
      if (!failed.includes('native-import-final-write') || leftovers.some(Boolean)) throw Error('Native package import did not roll back every row: ' + failed + JSON.stringify(leftovers))
      const projectId = await importWorldPackage(pkg)
      const release = await db.worldReleases.where('projectId').equals(projectId).first()
      const verified = await verifyWorldReleaseRecordV1(release)
      return { projectId, releaseId: release.id, manifestJson: release.manifestJson, indexHash: verified.index.indexHash }
    }, sealed.pkg)
    expect(imported.manifestJson).toBe(sealed.manifestJson)
    expect(imported.indexHash).toBe(sealed.pkg.release.index.indexHash)
    await restored.reload()
    const reread = await restored.evaluate(async releaseId => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const { verifyWorldReleaseRecordV1 } = await imp('/storyforge/src/lib/world-engine/release-codec.ts')
      const release = await db.worldReleases.get(releaseId), verified = await verifyWorldReleaseRecordV1(release)
      return { contentHash: release.contentHash, indexHash: verified.index.indexHash, readiness: verified.readiness }
    }, imported.releaseId)
    expect(reread).toEqual({ contentHash: sealed.contentHash, indexHash: imported.indexHash, readiness: 'rebuilt' })
  } finally { await isolated.close() }
})
