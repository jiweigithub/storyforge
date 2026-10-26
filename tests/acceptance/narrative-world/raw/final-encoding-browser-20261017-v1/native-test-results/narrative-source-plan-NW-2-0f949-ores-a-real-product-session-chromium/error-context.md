# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: narrative-source-plan.spec.ts >> NW-2C avg selects v4 sources, authorizes production, publishes and restores a real product session
- Location: tests/e2e/narrative-source-plan.spec.ts:5:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('status').filter({ hasText: '已原子发布' })
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByRole('status').filter({ hasText: '已原子发布' })

```

```yaml
- banner:
  - link "返回首页":
    - /url: /storyforge/
    - strong: StoryForge
    - text: 故事熔炉
  - navigation "产品导航":
    - link "首页":
      - /url: /storyforge/
    - link "世界引擎":
      - /url: /storyforge/world
    - link "长篇":
      - /url: /storyforge/long
    - link "短篇":
      - /url: /storyforge/short
    - link "剧本":
      - /url: /storyforge/script
    - link "漫画":
      - /url: /storyforge/comic
    - link "漫剧素材":
      - /url: /storyforge/motion
    - link "跑团":
      - /url: /storyforge/ttrpg
    - link "角色聊天":
      - /url: /storyforge/chat
    - link "AI 小镇":
      - /url: /storyforge/town
    - link "AVG":
      - /url: /storyforge/avg
    - link "文字冒险":
      - /url: /storyforge/adventure
    - link "文字开放世界":
      - /url: /storyforge/openworld
- complementary:
  - heading "AVG" [level=1]
  - button "NW-2C avg 新版世界":
    - img
    - text: NW-2C avg 新版世界
  - navigation "AVG 页面导航":
    - button "作品库"
    - button "世界引擎"
    - button "制作台"
    - button "发布与版本"
    - button "游玩"
    - button "通用设置"
- heading "游玩" [level=2]
- complementary:
  - navigation "AVG 内容导航":
    - heading "游玩与记录" [level=3]
    - button "玩家舞台"
    - button "存档与路线"
- main:
  - main:
    - text: STORYFORGE VISUAL NOVEL
    - heading "AVG 游戏库" [level=2]
    - paragraph: 先选择作品，再进入独立标题页开始或继续；舞台、立绘和对白不会提前挤进游戏目录。
    - text: 全部游戏 1 部可游玩作品
    - region "AVG 游戏列表":
      - article:
        - button "查看游戏：NW-2C avg 新版世界":
          - img
          - text: AVG / 视觉小说
          - strong: NW-2C avg 新版世界
          - paragraph: 渡口的约定 · 有后果的选择；基于冻结世界事实的叙事
          - text: 3 场景 · 3 对白 · 0 美术 · 0 演出 查看详情
          - img
```

# Test source

```ts
  1  | import { expect, type Page } from '@playwright/test'
  2  | import { narrativeProductionProtocolFixtureV4 } from '../../helpers/narrative-production-protocol-fixture'
  3  | 
  4  | /** In-browser protocol fixture only. Every provider response is intercepted;
  5  |  * the production scheduler, Gateway, adoption and IndexedDB remain real.
  6  |  * This supplies no model, literary-quality or human acceptance evidence. */
  7  | export async function installNarrativeProductionFixtureV4(page: Page, product: 'chat' | 'avg') {
  8  |   const calls: string[] = []
  9  |   await page.addInitScript(() => {
  10 |     localStorage.setItem('storyforge-ai-config', JSON.stringify({
  11 |       provider: 'openai', baseUrl: 'https://nw-v4-test.invalid/v1', model: 'nw-v4-protocol-fixture',
  12 |       temperature: 0, maxTokens: 8000,
  13 |     }))
  14 |     sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-nw-v4-fixture-key')
  15 |   })
  16 |   await page.route('https://nw-v4-test.invalid/**', async route => {
  17 |     const request = route.request().postDataJSON() as { messages?: Array<{ role: string; content: string }> }
  18 |     const system = request.messages?.find(message => message.role === 'system')?.content ?? ''
  19 |     const { task, output } = narrativeProductionProtocolFixtureV4(system, product)
  20 |     calls.push(task)
  21 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  22 |       id: `nw-v4-fixture-${calls.length}`, object: 'chat.completion', created: 0, model: 'nw-v4-protocol-fixture',
  23 |       choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
  24 |       usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
  25 |     }) })
  26 |   })
  27 |   return calls
  28 | }
  29 | 
  30 | export async function publishAndOpenNarrativeProductV4(page: Page, product: 'chat' | 'avg', planHash: string) {
  31 |   await page.getByRole('button', { name: '作者授权并开始自动制作', exact: true }).click()
  32 |   const publish = page.getByRole('button', { name: '复验并原子发布', exact: true })
  33 |   await expect(publish).toBeVisible({ timeout: 90000 })
  34 |   await publish.click()
> 35 |   await expect(page.getByRole('status').filter({ hasText: '已原子发布' })).toBeVisible({ timeout: 30000 })
     |                                                                       ^ Error: expect(locator).toBeVisible() failed
  36 |   const released = await page.evaluate(async () => {
  37 |     const load = new Function('path', 'return import(path)')
  38 |     const db = (await load('/storyforge/src/lib/db/schema.ts')).db
  39 |     const productionId = Number(new URLSearchParams(location.search).get('production'))
  40 |     const production = await db.productProductions.get(productionId)
  41 |     const row = await db.productReleases.get(production.currentProductReleaseId)
  42 |     const verified = await (await load('/storyforge/src/lib/product-production/runtime-package.ts')).verifyProductReleaseManifestV1(row.manifestJson)
  43 |     const build = await db.productBuilds.where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber]).first()
  44 |     const session = await (await load('/storyforge/src/lib/product/runtime-instances.ts')).createProductRuntimeInstanceFromSource({
  45 |       scope: { projectId: production.projectId, workId: production.workId },
  46 |       source: { kind: 'release', productReleaseId: row.id }, title: 'NW v4 正式发布接缝',
  47 |     })
  48 |     return { projectId: production.projectId, workId: production.workId, sessionId: session.id, releaseId: row.id,
  49 |       productType: verified.productType, sourceContracts: verified.sourceContracts, packageHash: verified.packageHash,
  50 |       buildPackageHash: build.packageHash, buildStatus: build.status, snapshot: JSON.parse(session.canonSnapshotJson) }
  51 |   })
  52 |   expect(released.buildStatus).toBe('released')
  53 |   expect(released.productType).toBe(product === 'chat' ? 'character-interaction' : 'avg')
  54 |   expect(released.packageHash).toBe(released.buildPackageHash)
  55 |   expect(released.sourceContracts.sourcePlan.planHash).toBe(planHash)
  56 |   expect(released.sourceContracts.sourceManifest.version).toBe(2)
  57 |   expect(released.sourceContracts.sourceManifest.runContextManifests.length).toBeGreaterThan(0)
  58 |   expect(released.sourceContracts.sourceManifest.resources.map((item: { resourceKey: string }) => item.resourceKey).sort())
  59 |     .toEqual(released.sourceContracts.sourcePlan.exact.requiredResourceKeys)
  60 |   expect(released.snapshot.sourceManifest).toMatchObject({ sourcePlanHash: planHash,
  61 |     inheritedSourceManifestHash: released.sourceContracts.sourceManifest.manifestHash,
  62 |     sourceKind: 'release', directWorldReads: [], readMode: 'frozen-product-package' })
  63 |   await page.goto(`./${product}/play?project=${released.projectId}&work=${released.workId}&session=${released.sessionId}`)
  64 |   if (product === 'chat') {
  65 |     await page.getByPlaceholder('对当前场景中的角色说话…').fill('我们先商议修桥的安排。')
  66 |     await page.getByRole('button', { name: '仅保存消息', exact: true }).click()
  67 |     await expect(page.getByRole('paragraph').filter({ hasText: /^我们先商议修桥的安排。$/ })).toBeVisible()
  68 |   } else {
  69 |     const choice = page.getByRole('button', { name: /回到渡口/ })
  70 |     for (let step = 0; step < 8 && !await choice.isVisible(); step++) {
  71 |       const next = page.getByRole('button', { name: /^(推进|补全|继续)/ }).first()
  72 |       await expect.poll(async () => await choice.isVisible() || await next.isVisible()).toBe(true)
  73 |       if (!await choice.isVisible()) await next.click()
  74 |     }
  75 |     await expect(choice).toBeVisible()
  76 |     await choice.click()
  77 |     await expect(page.getByText('你回到渡口整理工具。', { exact: true })).toBeVisible()
  78 |   }
  79 |   await page.reload()
  80 |   const restored = await page.evaluate(async sessionId => {
  81 |     const load = new Function('path', 'return import(path)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
  82 |     const session = await db.productRuntimeSessions.get(sessionId)
  83 |     const version = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeStateVersion(sessionId)
  84 |     return { releaseId: session.productReleaseId, snapshot: JSON.parse(session.canonSnapshotJson), sequence: version.sequence }
  85 |   }, released.sessionId)
  86 |   expect(restored.releaseId).toBe(released.releaseId)
  87 |   expect(restored.snapshot).toEqual(released.snapshot)
  88 |   expect(restored.sequence).toBeGreaterThan(0)
  89 |   return released
  90 | }
  91 | 
```