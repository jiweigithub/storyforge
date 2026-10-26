# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: text-open-world-save-settings.spec.ts >> 正式开放世界存档中心保留分支与旧Release，并持久化本机阅读设置
- Location: tests/e2e/text-open-world-save-settings.spec.ts:32:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('text-open-world-runtime-source')
Expected substring: "PRODUCT RELEASE v2 · 已固定"
Received string:    "TEXT-OPEN-WORLD vNEXT · PRODUCT RELEASE v1 · 已固定 · 包 047f19c94ba7"
Timeout: 20000ms

Call log:
  - Expect "toContainText" with timeout 20000ms
  - waiting for getByTestId('text-open-world-runtime-source')
    43 × locator resolved to <small data-testid="text-open-world-runtime-source">TEXT-OPEN-WORLD vNEXT · PRODUCT RELEASE v1 · 已固定 …</small>
       - unexpected value "TEXT-OPEN-WORLD vNEXT · PRODUCT RELEASE v1 · 已固定 · 包 047f19c94ba7"

```

```yaml
- text: TEXT-OPEN-WORLD vNEXT · PRODUCT RELEASE v1 · 已固定 · 包 047f19c94ba7
```

# Test source

```ts
  56  |       name: '浏览器开放世界存档验收',
  57  |       textOpenWorldVNext: createTextOpenWorldVNextFixture(),
  58  |       runtimeShape: 'vnext-only',
  59  |       title: '盐脊旧版旅程',
  60  |       seed: 'browser-open-world-save-settings',
  61  |     })
  62  |     const nextManifest = await createFixtureProductReleaseManifestV1({
  63  |       runtimePackage: created.runtimePackage,
  64  |       productionKey: created.release.productionKey,
  65  |       releaseVersion: 2,
  66  |       parentRelease: {
  67  |         releaseUid: created.manifest.lineage.releaseUid,
  68  |         releaseHash: created.manifest.releaseIdentityHash,
  69  |       },
  70  |     })
  71  |     const nextReleaseId = await db.productReleases.add({
  72  |       ...created.scope,
  73  |       productionKey: created.release.productionKey,
  74  |       productType: 'text-open-world',
  75  |       worldReleaseId: null,
  76  |       version: 2,
  77  |       label: '盐脊修订版 v2',
  78  |       manifestJson: JSON.stringify(nextManifest),
  79  |       contentHash: await hashProductProductionValueV2(nextManifest),
  80  |       createdAt: created.release.createdAt + 1_000,
  81  |     })
  82  |     return {
  83  |       projectId: created.scope.projectId,
  84  |       parentSessionId: created.session.id as number,
  85  |       parentTitle: created.session.title,
  86  |       pinnedReleaseLabel: created.release.label,
  87  |       nextReleaseId: nextReleaseId as number,
  88  |     }
  89  |   })
  90  | 
  91  |   await page.reload()
  92  |   await openFormalSession(page, seeded.projectId, seeded.parentTitle)
  93  |   await expect(page.getByTestId('text-open-world-runtime-source'))
  94  |     .toContainText('PRODUCT RELEASE v1 · 已固定')
  95  | 
  96  |   let panel = await openSaveSettings(page)
  97  |   const tabs = panel.getByRole('navigation', { name: '存档与设置分类' })
  98  |   await expect(tabs.getByRole('button')).toHaveText(['存档0', '分支1', '版本', '设置'])
  99  | 
  100 |   await panel.getByLabel('为当前进度命名').fill('进入盐渠前')
  101 |   await panel.getByRole('button', { name: '保存当前进度', exact: true }).click()
  102 |   const manualSave = panel.locator('article').filter({ hasText: '进入盐渠前' })
  103 |   await expect(manualSave).toBeVisible()
  104 |   await expect(panel.locator('[data-save-purpose="manual"]')).toContainText('手动存档')
  105 |   await expect(panel).toContainText('1/20 个手动档')
  106 | 
  107 |   await manualSave.getByRole('button', { name: '从此处继续', exact: true }).click()
  108 |   // The confirmation is an application-level modal and is intentionally
  109 |   // portalled outside the scrollable save/settings panel.
  110 |   const confirmation = page.getByRole('alertdialog')
  111 |   await expect(confirmation).toContainText('当前时间线和之后发生的事件都会保留')
  112 |   await confirmation.getByRole('button', { name: '建立分支并继续', exact: true }).click()
  113 | 
  114 |   const childTitle = `${seeded.parentTitle} · 进入盐渠前`
  115 |   await expect(page.getByTestId('text-open-world-shell')).toBeVisible()
  116 |   await expect(page.getByTestId('text-open-world-runtime-source'))
  117 |     .toContainText('PRODUCT RELEASE v1 · 已固定')
  118 |   await expect(page.getByTestId('text-open-world-main-view'))
  119 |     .toHaveAttribute('data-open-world-view', 'scene', { timeout: 20_000 })
  120 |   panel = await openSaveSettings(page)
  121 |   await panel.getByRole('navigation', { name: '存档与设置分类' })
  122 |     .getByRole('button', { name: /^分支/ })
  123 |     .click()
  124 |   const branches = panel.getByTestId('text-open-world-branch-list')
  125 |   await expect(branches).toContainText('2 条时间线')
  126 |   const parentBranch = branches.locator('article').filter({ hasText: seeded.parentTitle }).filter({
  127 |     hasNotText: childTitle,
  128 |   })
  129 |   const childBranch = branches.locator('article').filter({ hasText: childTitle })
  130 |   await expect(parentBranch).toBeVisible()
  131 |   await expect(parentBranch).toContainText('1/20 个手动档')
  132 |   await expect(childBranch).toBeVisible()
  133 |   await expect(childBranch).toContainText('当前时间线')
  134 | 
  135 |   await panel.getByRole('navigation', { name: '存档与设置分类' })
  136 |     .getByRole('button', { name: '版本', exact: true })
  137 |     .click()
  138 |   const versions = panel.getByTestId('text-open-world-version-list')
  139 |   await expect(versions).toContainText(`${seeded.pinnedReleaseLabel} · v1`)
  140 |   await expect(versions).toContainText('盐脊修订版 v2 · v2')
  141 |   await expect(versions).toContainText('旧存档会继续使用自己的不可变 Release')
  142 |   await expect(versions).toContainText('直接兼容子版本 · 可预演迁移')
  143 |   await versions.getByRole('button', { name: '预演迁移', exact: true }).click()
  144 |   const migrationPreview = panel.getByTestId('text-open-world-version-migration-preview')
  145 |   await expect(migrationPreview).toContainText('迁移预演已通过')
  146 |   await expect(migrationPreview).toContainText('v1 → v2')
  147 |   await expect(migrationPreview).toContainText('不会覆盖原存档')
  148 |   await migrationPreview.getByLabel(/我确认创建新版本子时间线/).check()
  149 |   await migrationPreview.getByRole('button', { name: '创建迁移分支并切换', exact: true }).click()
  150 | 
  151 |   const migrationTitle = `${childTitle} · v2迁移分支`
  152 |   await expect(page.getByTestId('text-open-world-shell')).toBeVisible()
  153 |   // The persistent shell can still show v1 while migration and replay run.
  154 |   // Await the new release with the same completion budget as its scene below.
  155 |   await expect(page.getByTestId('text-open-world-runtime-source'))
> 156 |     .toContainText('PRODUCT RELEASE v2 · 已固定', { timeout: 20_000 })
      |      ^ Error: expect(locator).toContainText(expected) failed
  157 |   await expect(page.getByTestId('text-open-world-main-view'))
  158 |     .toHaveAttribute('data-open-world-view', 'scene', { timeout: 20_000 })
  159 |   panel = await openSaveSettings(page)
  160 |   await panel.getByRole('navigation', { name: '存档与设置分类' })
  161 |     .getByRole('button', { name: /^分支/ })
  162 |     .click()
  163 |   const migratedBranches = panel.getByTestId('text-open-world-branch-list')
  164 |   await expect(migratedBranches).toContainText(seeded.parentTitle)
  165 |   await expect(migratedBranches).toContainText(childTitle)
  166 |   const migratedBranch = migratedBranches.locator('article').filter({ hasText: migrationTitle })
  167 |   await expect(migratedBranch).toContainText('当前时间线')
  168 | 
  169 |   await panel.getByRole('navigation', { name: '存档与设置分类' })
  170 |     .getByRole('button', { name: '设置', exact: true })
  171 |     .click()
  172 |   const preferences = panel.getByTestId('text-open-world-player-preferences')
  173 |   await preferences.getByLabel('高对比度', { exact: true }).check()
  174 |   await preferences.locator('input[type="range"]').first().fill('24')
  175 |   const shell = page.getByTestId('text-open-world-shell')
  176 |   await expect(shell).toHaveAttribute('data-high-contrast', 'true')
  177 |   await expect.poll(() => shell.evaluate(element => (
  178 |     getComputedStyle(element).getPropertyValue('--open-world-reader-font-size').trim()
  179 |   ))).toBe('24px')
  180 |   await expectNoHorizontalOverflow(page, 1440)
  181 | 
  182 |   await page.setViewportSize({ width: 390, height: 844 })
  183 |   await panel.scrollIntoViewIfNeeded()
  184 |   await expect(panel).toBeVisible()
  185 |   await expectNoHorizontalOverflow(page, 390)
  186 | 
  187 |   await page.setViewportSize({ width: 1440, height: 1000 })
  188 |   await page.reload()
  189 |   await openFormalSession(page, seeded.projectId, migrationTitle)
  190 |   const restoredShell = page.getByTestId('text-open-world-shell')
  191 |   await expect(restoredShell).toHaveAttribute('data-high-contrast', 'true')
  192 |   await expect.poll(() => restoredShell.evaluate(element => (
  193 |     getComputedStyle(element).getPropertyValue('--open-world-reader-font-size').trim()
  194 |   ))).toBe('24px')
  195 |   await page.setViewportSize({ width: 390, height: 844 })
  196 |   panel = await openSaveSettings(page)
  197 |   await panel.getByRole('navigation', { name: '存档与设置分类' })
  198 |     .getByRole('button', { name: '设置', exact: true })
  199 |     .click()
  200 |   await expect(panel.getByLabel('高对比度', { exact: true })).toBeChecked()
  201 |   await expect(panel.locator('input[type="range"]').first()).toHaveValue('24')
  202 |   await expectNoHorizontalOverflow(page, 390)
  203 | 
  204 |   const durable = await page.evaluate(async ({ parentSessionId, childTitle, migrationTitle }) => {
  205 |     const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
  206 |     const { db } = await importer('/storyforge/src/lib/db/schema.ts')
  207 |     const sessions = await db.productRuntimeSessions.toArray()
  208 |     const parent = sessions.find((session: { id?: number }) => session.id === parentSessionId)
  209 |     const child = sessions.find((session: { title: string }) => session.title === childTitle)
  210 |     const migration = sessions.find((session: { title: string }) => session.title === migrationTitle)
  211 |     return {
  212 |       parentExists: Boolean(parent),
  213 |       childId: child?.id ?? null,
  214 |       childParentId: child?.parentSessionId ?? null,
  215 |       sameRelease: parent?.productReleaseId === child?.productReleaseId,
  216 |       migrationParentId: migration?.parentSessionId ?? null,
  217 |       migrationReleaseId: migration?.productReleaseId ?? null,
  218 |       migrationEventCount: migration?.id == null
  219 |         ? -1
  220 |         : await db.productRuntimeEvents.where('sessionId').equals(migration.id).count(),
  221 |       migrationPlanSchema: migration == null
  222 |         ? null
  223 |         : JSON.parse(migration.canonSnapshotJson).migration?.schema ?? null,
  224 |       oldReleaseStillExists: parent?.productReleaseId == null
  225 |         ? false
  226 |         : Boolean(await db.productReleases.get(parent.productReleaseId)),
  227 |       parentCheckpointNames: (await db.productRuntimeCheckpoints
  228 |         .where('sessionId').equals(parentSessionId).toArray())
  229 |         .map((checkpoint: { name: string }) => checkpoint.name),
  230 |     }
  231 |   }, {
  232 |     parentSessionId: seeded.parentSessionId,
  233 |     childTitle,
  234 |     migrationTitle,
  235 |   })
  236 |   expect(durable).toEqual({
  237 |     parentExists: true,
  238 |     childId: expect.any(Number),
  239 |     childParentId: seeded.parentSessionId,
  240 |     sameRelease: true,
  241 |     migrationParentId: expect.any(Number),
  242 |     migrationReleaseId: seeded.nextReleaseId,
  243 |     migrationEventCount: 0,
  244 |     migrationPlanSchema: 'storyforge.text-open-world-save-migration-plan',
  245 |     oldReleaseStillExists: true,
  246 |     parentCheckpointNames: ['进入盐渠前'],
  247 |   })
  248 |   expect(durable.migrationParentId).toBe(durable.childId)
  249 | })
  250 | 
```