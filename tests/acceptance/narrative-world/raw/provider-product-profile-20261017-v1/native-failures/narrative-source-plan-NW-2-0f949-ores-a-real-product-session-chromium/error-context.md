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

Locator: getByRole('button', { name: '复验并原子发布', exact: true })
Expected: visible
Timeout: 90000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 90000ms
  - waiting for getByRole('button', { name: '复验并原子发布', exact: true })

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
- heading "制作台" [level=2]
- navigation "制作阶段":
  - button "S1 · 世界封存"
  - button "S2 · 产品定向"
  - button "S3 · 产品执行"
- complementary:
  - navigation "AVG 内容导航":
    - heading "S2 · 产品定向" [level=3]
    - button "故事与体验"
    - button "路线与结局目标"
    - button "方案会谈"
    - button "确认制作方案"
    - heading "S3 · 产品执行" [level=3]
    - button "制作流程"
    - button "叙事图与对白"
    - button "变量与结局"
    - button "背景与立绘"
    - button "音频与演出"
    - button "素材管理"
    - button "检查与试玩"
- main:
  - heading "确认制作方案" [level=3]
  - complementary:
    - text: PRODUCT-PROD
    - heading "游戏制作" [level=2]
    - button "刷新制作列表":
      - img
    - button "新建 Production":
      - img
      - text: 新建 Production
    - button "NW-2C avg 新版世界 productprod.mvbdgt35.883dc648 制作中":
      - strong: NW-2C avg 新版世界
      - code: productprod.mvbdgt35.883dc648
      - emphasis: 制作中
  - main:
    - alert:
      - img
      - text: "media.requirements: [product-production-executor] visual artifact keys 与 Plan 不一致"
    - status:
      - strong: 执行 Build DAG · conflict / failed
      - text: "media.requirements: [product-production-executor] visual artifact keys 与 Plan 不一致"
    - text: productprod.mvbdgt35.883dc648
    - heading "NW-2C avg 新版世界" [level=1]
    - paragraph: Production 制作中 · revision 2 · epoch 0
    - button "刷新当前 Production":
      - img
    - button "暂停":
      - img
      - text: 暂停
    - button "停止":
      - img
      - text: 停止
    - article:
      - text: BRIEF
      - strong: r1 · 已授权
    - article:
      - text: BUILD
      - strong: "#1 · 需要处理"
    - article:
      - text: ARTIFACTS
      - strong: 2 个版本
    - article:
      - text: RELEASE
      - strong: 未发布
    - heading "下一步" [level=2]
    - paragraph: 一次作者授权会启动整套自动制作；正式文本任务直接复用“设置”里的全局 AI 配置，不另收 API Key。每一步都有 CAS、scope、epoch 和 hash 复验。
    - strong: 自动制作停在可恢复边界
    - text: media.requirements · [product-production-executor] visual artifact keys 与 Plan 不一致 本次修复要求（可选）
    - textbox "本次修复要求":
      - /placeholder: 指出需要修正的内容；仍需遵守已确认的世界、规则和安全边界。
    - group: 直接修订任务草稿（高级）
    - button "修正后继续制作":
      - img
      - text: 修正后继续制作
    - heading "自动制作任务" [level=2]
    - code: "Build #1 · epoch 0"
    - strong: 总任务进度 29%
    - text: 2/7 个 durable task 已签收
    - progressbar "文字冒险总任务进度": 29%
    - paragraph: 等待依赖或作者处理当前闸门。
    - article:
      - strong: content
      - emphasis: 2/3
      - progressbar "content 泳道进度": 67%
      - paragraph: 运行 0 · 阻塞 1
    - article:
      - strong: planning
      - emphasis: 0/1
      - progressbar "planning 泳道进度": 0%
      - paragraph: 运行 0 · 阻塞 1
    - article:
      - strong: visual
      - emphasis: 0/1
      - progressbar "visual 泳道进度": 0%
      - paragraph: 运行 0 · 阻塞 0
    - article:
      - strong: integration
      - emphasis: 0/1
      - progressbar "integration 泳道进度": 0%
      - paragraph: 运行 0 · 阻塞 0
    - article:
      - strong: qa
      - emphasis: 0/1
      - progressbar "qa 泳道进度": 0%
      - paragraph: 运行 0 · 阻塞 0
    - article:
      - text: 本轮模型调用
      - strong: 4 / 16
    - article:
      - text: 本轮媒资调用
      - strong: 0 / 2
    - article:
      - text: 本轮成本
      - strong: 供应商未回传 / 未设金额上限
    - article:
      - text: 本轮新增媒资
      - strong: 0 B / 190.7 MiB
    - article:
      - strong: 产品设计与生产约束
      - emphasis: 已完成
      - paragraph: 创意总监
      - code: content.design
      - paragraph: content · attempt 1
      - paragraph: "边界：memory.settlement.recorded #22"
      - paragraph: checkpoint：verified · task-candidate
      - button "查看冻结证据"
    - article:
      - strong: 装配后的主线与分支叙事
      - emphasis: 已完成
      - paragraph: 叙事装配器
      - code: content.narrative
      - paragraph: content · attempt 1
      - paragraph: "边界：memory.settlement.recorded #22"
      - paragraph: checkpoint：verified · task-candidate
      - button "查看冻结证据"
    - article:
      - strong: 属性、资源与装备系统
      - emphasis: 阻塞
      - paragraph: 通用玩法设计师
      - code: content.product-module
      - paragraph: content · attempt 1 · 阻塞：run-cancelled
      - paragraph: "边界：memory.settlement.recorded #18"
      - button "查看冻结证据"
    - article:
      - strong: 美术需求清单
      - emphasis: 阻塞
      - paragraph: 美术总监
      - code: media.requirements
      - paragraph: planning · attempt 2 · 阻塞：task-budget-exceeded
      - paragraph: "边界：memory.settlement.recorded #25"
      - button "查看冻结证据"
    - article:
      - strong: 受控图片生成与验收
      - emphasis: 等待依赖
      - paragraph: 媒资 Provider
      - code: media.visual
      - paragraph: visual · attempt —
    - article:
      - strong: 确定性游戏装配
      - emphasis: 等待依赖
      - paragraph: 运行包编译器
      - code: integration.package
      - paragraph: integration · attempt —
    - article:
      - strong: 静态检查与发布质量门
      - emphasis: 等待依赖
      - paragraph: 确定性质量系统
      - code: qa.release
      - paragraph: qa · attempt —
    - heading "版本 lineage 与命令回执" [level=2]
    - text: 刷新后仍来自 IndexedDB 权威投影
    - heading "Brief / Build / Release" [level=3]
    - article:
      - strong: "Build #1"
      - emphasis: 需要处理
      - paragraph: Brief r1 · parent — · Release —
      - code: —
    - heading "最近命令 receipt" [level=3]
    - article:
      - strong: authorize-start
      - emphasis: succeeded
      - code: authorize.c4a7a786-3796-441b-92b7-3658ee0b368b
    - article:
      - strong: save-brief-revision
      - emphasis: succeeded
      - code: brief.e5fbe2b0-4d10-4e04-9eb5-9766c5f79978
    - article:
      - strong: create-intent
      - emphasis: succeeded
      - code: intent.814f7b01-128b-4962-b481-37952f7835a1
    - heading "冻结证据链" [level=2]
    - img
    - text: Canonical JSON v2
    - paragraph: 商业浏览器验收：缓存场景 p95 ≤ 250ms、选择输入 p95 ≤ 100ms、桌面峰值堆内存 ≤ 350MiB、30 分钟稳定增长 ≤ 10%。Smoke 不会被标成商业通过。
    - paragraph: 当前 Build 尚无浏览器性能回执。
    - text: Brief
    - code: 5506036921…f7b3a5
    - text: Plan
    - code: 33904d2e08…e35988
    - text: Package
    - code: —
    - text: Manifest
    - code: 44136fa355…aaff8a
    - text: Preview
    - code: —
    - text: Quality
    - code: 44136fa355…aaff8a
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
> 33 |   await expect(publish).toBeVisible({ timeout: 90000 })
     |                         ^ Error: expect(locator).toBeVisible() failed
  34 |   await publish.click()
  35 |   await expect(page.getByRole('status')).toContainText('已原子发布', { timeout: 30000 })
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