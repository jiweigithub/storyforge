# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: narrative-source-plan.spec.ts >> NW-2C chat selects v4 sources, authorizes production, publishes and restores a real product session
- Location: tests/e2e/narrative-source-plan.spec.ts:5:3

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.fill: Test timeout of 180000ms exceeded.
Call log:
  - waiting for getByPlaceholder('对当前场景中的角色说话…')
    - locator resolved to <textarea disabled rows="3" placeholder="对当前场景中的角色说话…" class="w-full resize-y rounded border border-border bg-bg-base px-3 py-2 text-sm disabled:opacity-50"></textarea>
    - fill("我们先商议修桥的安排。")
  - attempting fill action
    2 × waiting for element to be visible, enabled and editable
      - element is not enabled
    - retrying fill action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and editable
      - element is not enabled
    - retrying fill action
      - waiting 100ms
    325 × waiting for element to be visible, enabled and editable
        - element is not enabled
      - retrying fill action
        - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=f5e3]:
  - banner [ref=f5e4]:
    - link "StoryForge 故事熔炉" [ref=f5e5] [cursor=pointer]:
      - /url: /storyforge/
      - generic [ref=f5e8]:
        - strong [ref=f5e9]: StoryForge
        - generic [ref=f5e10]: 故事熔炉
    - navigation "产品导航" [ref=f5e11]:
      - link "首页" [ref=f5e12] [cursor=pointer]:
        - /url: /storyforge/
      - link "世界引擎" [ref=f5e13] [cursor=pointer]:
        - /url: /storyforge/world
      - link "长篇" [ref=f5e14] [cursor=pointer]:
        - /url: /storyforge/long
      - link "短篇" [ref=f5e15] [cursor=pointer]:
        - /url: /storyforge/short
      - link "剧本" [ref=f5e16] [cursor=pointer]:
        - /url: /storyforge/script
      - link "漫画" [ref=f5e17] [cursor=pointer]:
        - /url: /storyforge/comic
      - link "漫剧素材" [ref=f5e18] [cursor=pointer]:
        - /url: /storyforge/motion
      - link "跑团" [ref=f5e19] [cursor=pointer]:
        - /url: /storyforge/ttrpg
      - link "角色聊天" [ref=f5e20] [cursor=pointer]:
        - /url: /storyforge/chat
      - link "AI 小镇" [ref=f5e21] [cursor=pointer]:
        - /url: /storyforge/town
      - link "AVG" [ref=f5e22] [cursor=pointer]:
        - /url: /storyforge/avg
      - link "文字冒险" [ref=f5e23] [cursor=pointer]:
        - /url: /storyforge/adventure
      - link "文字开放世界" [ref=f5e24] [cursor=pointer]:
        - /url: /storyforge/openworld
  - complementary [ref=f5e25]:
    - heading "角色聊天" [level=1] [ref=f5e26]
    - button "NW-2C chat 新版世界" [ref=f5e27] [cursor=pointer]
    - navigation "角色聊天主导航" [ref=f5e30]:
      - button "作品库" [ref=f5e31] [cursor=pointer]
      - button "世界引擎" [ref=f5e32] [cursor=pointer]
      - button "制作台" [ref=f5e33] [cursor=pointer]
      - button "发布与版本" [ref=f5e34] [cursor=pointer]
      - button "游玩" [ref=f5e35] [cursor=pointer]
      - link "社区与发行" [ref=f5e36] [cursor=pointer]:
        - /url: /storyforge/community/releases
      - link "通用设置" [ref=f5e37] [cursor=pointer]:
        - /url: /storyforge/home/settings
  - main [ref=f5e38]:
    - heading "游玩" [level=2] [ref=f5e40]
    - generic [ref=f5e42]:
      - navigation "角色聊天页内目录" [ref=f5e43]:
        - generic [ref=f5e44]:
          - generic [ref=f5e45]: 游玩
          - button "开始对话" [ref=f5e46] [cursor=pointer]
          - button "关系与记忆" [ref=f5e47] [cursor=pointer]
          - button "会话与分支" [ref=f5e48] [cursor=pointer]
      - generic [ref=f5e50]:
        - complementary [ref=f5e51]:
          - strong [ref=f5e55]: 角色互动发布
          - paragraph [ref=f5e56]: 新会话只从统一生产 Harness 发布的当前不可变 ProductRelease 启动。
          - article [ref=f5e58]:
            - strong [ref=f5e59]: NW-2C chat 新版世界
            - generic [ref=f5e60]: Product Release v1 · 1 角色 · 1 场景
            - button "新建会话" [ref=f5e61] [cursor=pointer]
          - generic [ref=f5e63]: 互动存档
          - generic [ref=f5e65]:
            - button [ref=f5e66] [cursor=pointer]:
              - strong [ref=f5e67]: NW v4 正式发布接缝
              - text: 事件 2
            - button "删除存档" [ref=f5e68] [cursor=pointer]
        - main [ref=f5e72]:
          - generic [ref=f5e73]:
            - generic [ref=f5e75]:
              - text: 角色聊天 · 正式版本
              - heading "NW v4 正式发布接缝" [level=1] [ref=f5e76]
              - paragraph [ref=f5e77]: 当前场景已结束 · 事件 2
            - generic [ref=f5e78]:
              - heading "选择下一场景" [level=2] [ref=f5e79]
              - button "桥边" [ref=f5e81] [cursor=pointer]
            - generic [ref=f5e82]:
              - generic [ref=f5e83]:
                - generic [ref=f5e84]:
                  - text: 对话记录
                  - generic [ref=f5e88]: ·
                - generic [ref=f5e89]: 剩余回复预算 0 · 玩家回合 0/—
              - paragraph [ref=f5e91]: 使用固定行动可离线推进；自由输入的角色回复经统一 Harness。
              - generic [ref=f5e92]:
                - textbox "对当前场景中的角色说话…" [disabled] [ref=f5e93]
                - generic [ref=f5e94]:
                  - generic [ref=f5e95]: 未配置 AI：玩家消息可保存，固定行动可继续，自由回复明确暂停
                  - button "仅保存消息" [disabled] [ref=f5e97]
            - generic [ref=f5e101]:
              - heading "Narrative Choice 连接" [level=2] [ref=f5e102]
              - generic [ref=f5e103]:
                - button "回到渡口" [ref=f5e104] [cursor=pointer]
                - button "留在桥边" [ref=f5e105] [cursor=pointer]
```

# Test source

```ts
  1   | import { expect, type Page } from '@playwright/test'
  2   | import { narrativeProductionProtocolFixtureV4 } from '../../helpers/narrative-production-protocol-fixture'
  3   | 
  4   | /** In-browser protocol fixture only. Every provider response is intercepted;
  5   |  * the production scheduler, Gateway, adoption and IndexedDB remain real.
  6   |  * This supplies no model, literary-quality or human acceptance evidence. */
  7   | export async function installNarrativeProductionFixtureV4(page: Page, product: 'chat' | 'avg') {
  8   |   const calls: string[] = []
  9   |   await page.addInitScript(() => {
  10  |     localStorage.setItem('storyforge-ai-config', JSON.stringify({
  11  |       provider: 'openai', baseUrl: 'https://nw-v4-test.invalid/v1', model: 'nw-v4-protocol-fixture',
  12  |       temperature: 0, maxTokens: 8000,
  13  |     }))
  14  |     // The production protocol uses intercepted model responses. The player
  15  |     // path below exercises offline messages/choices and refresh recovery.
  16  |     if (/\/(?:chat|avg)\/play$/.test(location.pathname)) {
  17  |       sessionStorage.removeItem('storyforge-ai-api-key-session')
  18  |     } else sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-nw-v4-fixture-key')
  19  |   })
  20  |   await page.route('https://nw-v4-test.invalid/**', async route => {
  21  |     const request = route.request().postDataJSON() as { messages?: Array<{ role: string; content: string }> }
  22  |     const system = request.messages?.find(message => message.role === 'system')?.content ?? ''
  23  |     const { task, output } = narrativeProductionProtocolFixtureV4(system, product)
  24  |     calls.push(task)
  25  |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  26  |       id: `nw-v4-fixture-${calls.length}`, object: 'chat.completion', created: 0, model: 'nw-v4-protocol-fixture',
  27  |       choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
  28  |       usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
  29  |     }) })
  30  |   })
  31  |   return calls
  32  | }
  33  | 
  34  | export async function publishAndOpenNarrativeProductV4(page: Page, product: 'chat' | 'avg', planHash: string) {
  35  |   const productionId = Number(new URL(page.url()).searchParams.get('production'))
  36  |   expect(Number.isSafeInteger(productionId) && productionId > 0).toBe(true)
  37  |   await page.getByRole('button', { name: '作者授权并开始自动制作', exact: true }).click()
  38  |   const publish = page.getByRole('button', { name: '复验并原子发布', exact: true })
  39  |   await expect(publish).toBeVisible({ timeout: 90000 })
  40  |   await publish.click()
  41  |   // Both product pages navigate immediately after the committed publication.
  42  |   // The studio's transient status can disappear before an assertion sees it.
  43  |   // Keep the production identity from the authoring route and check the
  44  |   // stable player route plus the persisted release below.
  45  |   await expect(page).toHaveURL(url => url.pathname.endsWith(`/${product}/play`), { timeout: 30000 })
  46  |   const released = await page.evaluate(async productionId => {
  47  |     const load = new Function('path', 'return import(path)')
  48  |     const db = (await load('/storyforge/src/lib/db/schema.ts')).db
  49  |     const production = await db.productProductions.get(productionId)
  50  |     const row = await db.productReleases.get(production.currentProductReleaseId)
  51  |     const verified = await (await load('/storyforge/src/lib/product-production/runtime-package.ts')).verifyProductReleaseManifestV1(row.manifestJson)
  52  |     const build = await db.productBuilds.where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber]).first()
  53  |     const session = await (await load('/storyforge/src/lib/product/runtime-instances.ts')).createProductRuntimeInstanceFromSource({
  54  |       scope: { projectId: production.projectId, worldId: production.worldId, workId: production.workId },
  55  |       source: { kind: 'release', productReleaseId: row.id }, title: 'NW v4 正式发布接缝',
  56  |     })
  57  |     return { projectId: production.projectId, workId: production.workId, sessionId: session.id, releaseId: row.id,
  58  |       productType: verified.productType, sourceContracts: verified.sourceContracts, packageHash: verified.packageHash,
  59  |       buildPackageHash: build.packageHash, buildStatus: build.status, snapshot: JSON.parse(session.canonSnapshotJson) }
  60  |   }, productionId)
  61  |   expect(released.buildStatus).toBe('released')
  62  |   expect(released.productType).toBe(product === 'chat' ? 'character-interaction' : 'avg')
  63  |   expect(released.packageHash).toBe(released.buildPackageHash)
  64  |   expect(released.sourceContracts.sourcePlan.planHash).toBe(planHash)
  65  |   expect(released.sourceContracts.sourceManifest.version).toBe(2)
  66  |   expect(released.sourceContracts.sourceManifest.runContextManifests.length).toBeGreaterThan(0)
  67  |   expect(released.sourceContracts.sourceManifest.resources.map((item: { resourceKey: string }) => item.resourceKey).sort())
  68  |     .toEqual(released.sourceContracts.sourcePlan.exact.requiredResourceKeys)
  69  |   expect(released.snapshot.sourceManifest).toMatchObject({ sourcePlanHash: planHash,
  70  |     inheritedSourceManifestHash: released.sourceContracts.sourceManifest.manifestHash,
  71  |     sourceKind: 'release', directWorldReads: [], readMode: 'frozen-product-package' })
  72  |   await page.goto(`./${product}/play?project=${released.projectId}&work=${released.workId}&session=${released.sessionId}`)
  73  |   if (product === 'chat') {
> 74  |     await page.getByPlaceholder('对当前场景中的角色说话…').fill('我们先商议修桥的安排。')
      |                                                 ^ Error: locator.fill: Test timeout of 180000ms exceeded.
  75  |     await page.getByRole('button', { name: '仅保存消息', exact: true }).click()
  76  |     await expect(page.getByRole('paragraph').filter({ hasText: /^我们先商议修桥的安排。$/ })).toBeVisible()
  77  |   } else {
  78  |     const choice = page.getByRole('button', { name: /回到渡口/ })
  79  |     for (let step = 0; step < 8 && !await choice.isVisible(); step++) {
  80  |       const next = page.getByRole('button', { name: /^(推进|补全|继续)/ }).first()
  81  |       await expect.poll(async () => await choice.isVisible() || await next.isVisible()).toBe(true)
  82  |       if (!await choice.isVisible()) await next.click()
  83  |     }
  84  |     await expect(choice).toBeVisible()
  85  |     await choice.click()
  86  |     await expect(page.getByText('你回到渡口整理工具。', { exact: true })).toBeVisible()
  87  |   }
  88  |   await page.reload()
  89  |   const restored = await page.evaluate(async sessionId => {
  90  |     const load = new Function('path', 'return import(path)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
  91  |     const session = await db.productRuntimeSessions.get(sessionId)
  92  |     const version = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeStateVersion(sessionId)
  93  |     return { releaseId: session.productReleaseId, snapshot: JSON.parse(session.canonSnapshotJson), sequence: version.sequence }
  94  |   }, released.sessionId)
  95  |   expect(restored.releaseId).toBe(released.releaseId)
  96  |   expect(restored.snapshot).toEqual(released.snapshot)
  97  |   expect(restored.sequence).toBeGreaterThan(0)
  98  |   return released
  99  | }
  100 | 
```