import { expect, test } from '@playwright/test'

test('AVG private contracts preserve frozen module bytes and reject unready adoption in isolated browser storage', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const seeded = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ seedBuild }, { avgCarrierWithModule, AVG_SCRIPT }, hashes, { db }, settings, { DEFAULT_AVG_SETTINGS }] = await Promise.all([
      load('/storyforge/tests/helpers/avg-carrier-fixture.ts'), load('/storyforge/tests/helpers/avg-private-contract-fixture.ts'),
      load('/storyforge/src/lib/product-production/hash.ts'), load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/avg/settings-v2.ts'), load('/storyforge/src/lib/avg/authoring-contract.ts'),
    ])
    const s = await seedBuild()
    const { preview, release } = await avgCarrierWithModule()
    const previewJson = JSON.stringify(preview)
    await db.productBuilds.update(s.buildId, { previewManifestJson: previewJson, previewHash: preview.previewHash, packageHash: preview.packageHash })
    await db.productReleases.update(s.id, { manifestJson: JSON.stringify(release), contentHash: await hashes.hashProductProductionValueV2(release) })
    const proposal = await settings.deriveAvgAuthoringSettingsV2(DEFAULT_AVG_SETTINGS)
    let settingsError = ''
    try { settings.parseAvgSettingsForLegacyProduction(proposal) } catch (error) { settingsError = String(error) }
    return { scope: s.scope, buildId: s.buildId, previewHash: preview.previewHash, previewJson, script: AVG_SCRIPT,
      settingsError, voice: proposal.presentation.voice, calls: proposal.investment.batch.modelCalls }
  })
  await page.reload()
  const result = await page.evaluate(async s => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, sources, backups, artifacts, { deleteWork }] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/product-production/preview-source.ts'),
      load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/product-production/artifact-store.ts'),
      load('/storyforge/src/lib/workspace/lifecycle.ts'),
    ])
    const source = { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.previewHash }
    const verified = await sources.verifyProductRuntimeSourceEnvelope({ scope: s.scope, source })
    let adoptionError = ''
    try { await artifacts.acceptProductBuildArtifact({ scope: s.scope, buildId: s.buildId, controlEpoch: 1,
      artifactKey: 'avg.content.scene-script.archive', kind: 'narrative', payload: s.script, inputHash: 'a'.repeat(64) }) }
    catch (error) { adoptionError = String(error) }
    const snapshot = await backups.exportProjectJSON(s.scope.projectId)
    const importedId = await backups.importProjectJSON(snapshot)
    const imported = await db.productBuilds.where('projectId').equals(importedId).first()
    const readback = await sources.verifyProductRuntimeSourceEnvelope({ scope: imported, source: { ...source, productBuildId: imported.id } })
    await deleteWork(imported.workId)
    return { modules: verified.runtimePackage.modules.length, importedModules: readback.runtimePackage.modules.length,
      bytesPreserved: imported.previewManifestJson === s.previewJson, originalKept: !!await db.productBuilds.get(s.buildId),
      importedDeleted: !await db.productBuilds.get(imported.id), adoptionError, artifacts: await db.productBuildArtifacts.count(),
      sessions: await db.productRuntimeSessions.count(), blobs: await db.mediaBlobObjects.count() }
  }, seeded)
  expect(seeded).toMatchObject({ voice: 'off', calls: 0 })
  expect(seeded.settingsError).toContain('不得降级')
  expect(result).toMatchObject({ modules: 1, importedModules: 1, bytesPreserved: true, originalKept: true, importedDeleted: true, artifacts: 0, sessions: 0, blobs: 0 })
  expect(result.adoptionError).toContain('采用尚未就绪')
})
