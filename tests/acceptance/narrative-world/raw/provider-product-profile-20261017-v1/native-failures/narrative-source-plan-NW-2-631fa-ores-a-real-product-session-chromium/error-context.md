# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: narrative-source-plan.spec.ts >> NW-2C chat selects v4 sources, authorizes production, publishes and restores a real product session
- Location: tests/e2e/narrative-source-plan.spec.ts:5:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('status')
Expected substring: "已原子发布"
Error: strict mode violation: getByRole('status') resolved to 2 elements:
    1) <div role="status" aria-live="polite" data-testid="product-production-command-activity" class="mb-5 rounded border p-3 text-[10px] border-accent/30 bg-accent/5 text-accent">…</div> aka getByTestId('product-production-command-activity')
    2) <div role="status" aria-busy="true" aria-live="polite" class="mb-5 flex items-center gap-2 text-xs text-accent">…</div> aka getByText('正在执行受治理的制作步骤…')

Call log:
  - Expect "toContainText" with timeout 30000ms
  - waiting for getByRole('status')

```

# Page snapshot

```yaml
- generic [ref=f4e3]:
  - banner [ref=f4e4]:
    - link "StoryForge 故事熔炉" [ref=f4e5] [cursor=pointer]:
      - /url: /storyforge/
      - generic [ref=f4e8]:
        - strong [ref=f4e9]: StoryForge
        - generic [ref=f4e10]: 故事熔炉
    - navigation "产品导航" [ref=f4e11]:
      - link "首页" [ref=f4e12] [cursor=pointer]:
        - /url: /storyforge/
      - link "世界引擎" [ref=f4e13] [cursor=pointer]:
        - /url: /storyforge/world
      - link "长篇" [ref=f4e14] [cursor=pointer]:
        - /url: /storyforge/long
      - link "短篇" [ref=f4e15] [cursor=pointer]:
        - /url: /storyforge/short
      - link "剧本" [ref=f4e16] [cursor=pointer]:
        - /url: /storyforge/script
      - link "漫画" [ref=f4e17] [cursor=pointer]:
        - /url: /storyforge/comic
      - link "漫剧素材" [ref=f4e18] [cursor=pointer]:
        - /url: /storyforge/motion
      - link "跑团" [ref=f4e19] [cursor=pointer]:
        - /url: /storyforge/ttrpg
      - link "角色聊天" [ref=f4e20] [cursor=pointer]:
        - /url: /storyforge/chat
      - link "AI 小镇" [ref=f4e21] [cursor=pointer]:
        - /url: /storyforge/town
      - link "AVG" [ref=f4e22] [cursor=pointer]:
        - /url: /storyforge/avg
      - link "文字冒险" [ref=f4e23] [cursor=pointer]:
        - /url: /storyforge/adventure
      - link "文字开放世界" [ref=f4e24] [cursor=pointer]:
        - /url: /storyforge/openworld
  - complementary [ref=f4e25]:
    - heading "角色聊天" [level=1] [ref=f4e26]
    - button "NW-2C chat 新版世界" [ref=f4e27] [cursor=pointer]
    - navigation "角色聊天主导航" [ref=f4e30]:
      - button "作品库" [ref=f4e31] [cursor=pointer]
      - button "世界引擎" [ref=f4e32] [cursor=pointer]
      - button "制作台" [ref=f4e33] [cursor=pointer]
      - button "发布与版本" [ref=f4e34] [cursor=pointer]
      - button "游玩" [ref=f4e35] [cursor=pointer]
      - link "社区与发行" [ref=f4e36] [cursor=pointer]:
        - /url: /storyforge/community/releases
      - link "通用设置" [ref=f4e37] [cursor=pointer]:
        - /url: /storyforge/home/settings
  - main [ref=f4e38]:
    - generic [ref=f4e39]:
      - heading "制作台" [level=2] [ref=f4e40]
      - generic [ref=f4e41]:
        - button "S1 世界来源" [ref=f4e42] [cursor=pointer]
        - button "S2 产品定向" [ref=f4e43] [cursor=pointer]
        - button "S3 制作与运行" [ref=f4e44] [cursor=pointer]
    - generic [ref=f4e46]:
      - navigation "角色聊天页内目录" [ref=f4e47]:
        - generic [ref=f4e48]:
          - generic [ref=f4e49]: S2 · 产品定向
          - button "互动目标" [ref=f4e50] [cursor=pointer]
          - button "角色与场景" [ref=f4e51] [cursor=pointer]
          - button "记忆与边界" [ref=f4e52] [cursor=pointer]
          - button "方案会谈" [ref=f4e53] [cursor=pointer]
          - button "确认制作方案" [ref=f4e54] [cursor=pointer]
        - generic [ref=f4e55]:
          - generic [ref=f4e56]: S3 · 产品执行
          - button "制作流程" [ref=f4e57] [cursor=pointer]
          - button "人物快照" [ref=f4e58] [cursor=pointer]
          - button "场景与规则" [ref=f4e59] [cursor=pointer]
          - button "人物与场景素材" [ref=f4e60] [cursor=pointer]
          - button "检查与试玩" [ref=f4e61] [cursor=pointer]
      - generic [ref=f4e64]:
        - group [ref=f4e65]:
          - generic "制作记录与新版本" [ref=f4e66] [cursor=pointer]
        - main [ref=f4e67]:
          - status [ref=f4e68]:
            - strong [ref=f4e69]: 原子发布 · pending
            - generic [ref=f4e70]: 正在等待 durable receipt…
          - status [ref=f4e71]: 正在执行受治理的制作步骤…
          - generic [ref=f4e74]:
            - generic [ref=f4e75]:
              - text: productprod.mvbdgjq5.40332175
              - heading "NW-2C chat 新版世界" [level=1] [ref=f4e76]
              - paragraph [ref=f4e77]: Production 已发布 · revision 4 · epoch 0
            - generic [ref=f4e78]:
              - button "刷新当前 Production" [disabled] [ref=f4e79]
              - button "归档" [disabled] [ref=f4e85]
          - generic [ref=f4e89]:
            - article [ref=f4e90]:
              - text: BRIEF
              - strong [ref=f4e91]: r1 · 已授权
            - article [ref=f4e92]:
              - text: BUILD
              - strong [ref=f4e93]: "#1 · 已发布"
            - article [ref=f4e94]:
              - text: ARTIFACTS
              - strong [ref=f4e95]: 6 个版本
            - article [ref=f4e96]:
              - text: RELEASE
              - strong [ref=f4e97]: "#1"
          - generic [ref=f4e98]:
            - heading "下一步" [level=2] [ref=f4e99]
            - paragraph [ref=f4e100]: 一次作者授权会启动整套自动制作；正式文本任务直接复用“设置”里的全局 AI 配置，不另收 API Key。每一步都有 CAS、scope、epoch 和 hash 复验。
            - generic [ref=f4e101]:
              - button "试玩此 Build" [disabled] [ref=f4e102]
              - button "进入玩家模式" [disabled] [ref=f4e105]
          - generic [ref=f4e108]:
            - generic [ref=f4e109]:
              - heading "自动制作任务" [level=2] [ref=f4e110]
              - code [ref=f4e111]: "Build #1 · epoch 0"
            - generic [ref=f4e112]:
              - generic [ref=f4e113]:
                - strong [ref=f4e114]: 总任务进度 100%
                - generic [ref=f4e115]: 6/6 个 durable task 已签收
              - progressbar "文字冒险总任务进度" [ref=f4e116]: 100%
              - paragraph [ref=f4e117]: 全部计划任务已完成，等待后续人工发布门。
            - generic [ref=f4e118]:
              - article [ref=f4e119]:
                - generic [ref=f4e120]:
                  - strong [ref=f4e121]: content
                  - emphasis [ref=f4e122]: 3/3
                - progressbar "content 泳道进度" [ref=f4e123]: 100%
                - paragraph [ref=f4e124]: 运行 0 · 阻塞 0
              - article [ref=f4e125]:
                - generic [ref=f4e126]:
                  - strong [ref=f4e127]: planning
                  - emphasis [ref=f4e128]: 1/1
                - progressbar "planning 泳道进度" [ref=f4e129]: 100%
                - paragraph [ref=f4e130]: 运行 0 · 阻塞 0
              - article [ref=f4e131]:
                - generic [ref=f4e132]:
                  - strong [ref=f4e133]: integration
                  - emphasis [ref=f4e134]: 1/1
                - progressbar "integration 泳道进度" [ref=f4e135]: 100%
                - paragraph [ref=f4e136]: 运行 0 · 阻塞 0
              - article [ref=f4e137]:
                - generic [ref=f4e138]:
                  - strong [ref=f4e139]: qa
                  - emphasis [ref=f4e140]: 1/1
                - progressbar "qa 泳道进度" [ref=f4e141]: 100%
                - paragraph [ref=f4e142]: 运行 0 · 阻塞 0
            - generic [ref=f4e143]:
              - article [ref=f4e144]:
                - text: 本轮模型调用
                - strong [ref=f4e145]: 4 / 16
              - article [ref=f4e146]:
                - text: 本轮媒资调用
                - strong [ref=f4e147]: 0 / 1
              - article [ref=f4e148]:
                - text: 本轮成本
                - strong [ref=f4e149]: 供应商未回传 / 未设金额上限
              - article [ref=f4e150]:
                - text: 本轮新增媒资
                - strong [ref=f4e151]: 0 B / 190.7 MiB
            - generic [ref=f4e152]:
              - article [ref=f4e153]:
                - generic [ref=f4e154]:
                  - strong [ref=f4e155]: 产品设计与生产约束
                  - emphasis [ref=f4e156]: 已完成
                - paragraph [ref=f4e157]: 创意总监
                - code [ref=f4e158]: content.design
                - paragraph [ref=f4e159]: content · attempt 1
                - paragraph [ref=f4e160]: "边界：memory.settlement.recorded #22"
                - paragraph [ref=f4e161]: checkpoint：verified · task-candidate
                - button "查看冻结证据" [disabled] [ref=f4e162]
              - article [ref=f4e163]:
                - generic [ref=f4e164]:
                  - strong [ref=f4e165]: 装配后的主线与分支叙事
                  - emphasis [ref=f4e166]: 已完成
                - paragraph [ref=f4e167]: 叙事装配器
                - code [ref=f4e168]: content.narrative
                - paragraph [ref=f4e169]: content · attempt 1
                - paragraph [ref=f4e170]: "边界：memory.settlement.recorded #22"
                - paragraph [ref=f4e171]: checkpoint：verified · task-candidate
                - button "查看冻结证据" [disabled] [ref=f4e172]
              - article [ref=f4e173]:
                - generic [ref=f4e174]:
                  - strong [ref=f4e175]: 属性、资源与装备系统
                  - emphasis [ref=f4e176]: 已完成
                - paragraph [ref=f4e177]: 通用玩法设计师
                - code [ref=f4e178]: content.product-module
                - paragraph [ref=f4e179]: content · attempt 1
                - paragraph [ref=f4e180]: "边界：memory.settlement.recorded #22"
                - paragraph [ref=f4e181]: checkpoint：verified · task-candidate
                - button "查看冻结证据" [disabled] [ref=f4e182]
              - article [ref=f4e183]:
                - generic [ref=f4e184]:
                  - strong [ref=f4e185]: 美术需求清单
                  - emphasis [ref=f4e186]: 已完成
                - paragraph [ref=f4e187]: 美术总监
                - code [ref=f4e188]: media.requirements
                - paragraph [ref=f4e189]: planning · attempt 1
                - paragraph [ref=f4e190]: "边界：memory.settlement.recorded #22"
                - paragraph [ref=f4e191]: checkpoint：verified · task-candidate
                - button "查看冻结证据" [disabled] [ref=f4e192]
              - article [ref=f4e193]:
                - generic [ref=f4e194]:
                  - strong [ref=f4e195]: 确定性游戏装配
                  - emphasis [ref=f4e196]: 已完成
                - paragraph [ref=f4e197]: 运行包编译器
                - code [ref=f4e198]: integration.package
                - paragraph [ref=f4e199]: integration · attempt 1
                - paragraph [ref=f4e200]: "边界：memory.settlement.recorded #21"
                - paragraph [ref=f4e201]: checkpoint：verified · task-candidate
                - button "查看冻结证据" [disabled] [ref=f4e202]
              - article [ref=f4e203]:
                - generic [ref=f4e204]:
                  - strong [ref=f4e205]: 静态检查与发布质量门
                  - emphasis [ref=f4e206]: 已完成
                - paragraph [ref=f4e207]: 确定性质量系统
                - code [ref=f4e208]: qa.release
                - paragraph [ref=f4e209]: qa · attempt 1
                - paragraph [ref=f4e210]: "边界：memory.settlement.recorded #13"
                - paragraph [ref=f4e211]: checkpoint：verified · task-candidate
                - button "查看冻结证据" [disabled] [ref=f4e212]
          - generic [ref=f4e213]:
            - heading "继续演化下一版" [level=2] [ref=f4e219]
            - paragraph [ref=f4e220]: 描述希望增加、延续或改变的体验。旧 Build、Release 和存档不会被改写；提交后先生成新的可审查 Brief，不会直接调用模型。
            - textbox "例如：从当前结局继续，让配角成为新主角，增加一条调查旧港失踪案的支线，并保留已经发生的选择后果。" [ref=f4e221]
            - group "本轮影响范围（未勾选且依赖未变化的产物可复用）" [ref=f4e222]:
              - generic [ref=f4e224]:
                - checkbox "剧情内容" [checked] [ref=f4e225]
                - text: 剧情内容
              - generic [ref=f4e226]:
                - checkbox "玩法模块" [checked] [ref=f4e227]
                - text: 玩法模块
              - generic [ref=f4e228]:
                - checkbox "美术" [checked] [ref=f4e229]
                - text: 美术
              - generic [ref=f4e230]:
                - checkbox "音乐/音效" [checked] [ref=f4e231]
                - text: 音乐/音效
              - generic [ref=f4e232]:
                - checkbox "装配/运行时" [ref=f4e233]
                - text: 装配/运行时
            - button "生成下一轮 Brief" [disabled] [ref=f4e234]
          - generic [ref=f4e239]:
            - generic [ref=f4e240]:
              - heading "存档兼容报告" [level=2] [ref=f4e241]
              - strong [ref=f4e242]: 可兼容
            - paragraph [ref=f4e243]: 首个 Build，无旧存档需要迁移。
            - list [ref=f4e244]:
              - listitem [ref=f4e245]: · 首个 Build 没有需要迁移的旧存档。
          - generic [ref=f4e246]:
            - generic [ref=f4e247]:
              - heading "版本 lineage 与命令回执" [level=2] [ref=f4e248]
              - generic [ref=f4e249]: 刷新后仍来自 IndexedDB 权威投影
            - generic [ref=f4e250]:
              - generic [ref=f4e251]:
                - heading "Brief / Build / Release" [level=3] [ref=f4e252]
                - article [ref=f4e254]:
                  - generic [ref=f4e255]:
                    - strong [ref=f4e256]: "Build #1"
                    - emphasis [ref=f4e257]: 已发布
                  - paragraph [ref=f4e258]: "Brief r1 · parent — · Release #1"
                  - code [ref=f4e259]: 67c999ea4e…9b8728
              - generic [ref=f4e260]:
                - heading "最近命令 receipt" [level=3] [ref=f4e261]
                - generic [ref=f4e262]:
                  - article [ref=f4e263]:
                    - generic [ref=f4e264]:
                      - strong [ref=f4e265]: publish
                      - emphasis [ref=f4e266]: succeeded
                    - code [ref=f4e267]: publish.e843afcc-c94a-4a1b-a96c-559b0274aa0f
                  - article [ref=f4e268]:
                    - generic [ref=f4e269]:
                      - strong [ref=f4e270]: authorize-start
                      - emphasis [ref=f4e271]: succeeded
                    - code [ref=f4e272]: authorize.61f9e3ba-3fba-4618-864e-bdec0a0bb1b4
                  - article [ref=f4e273]:
                    - generic [ref=f4e274]:
                      - strong [ref=f4e275]: save-brief-revision
                      - emphasis [ref=f4e276]: succeeded
                    - code [ref=f4e277]: brief.c7eebe04-4c84-4539-a1f9-767085b077be
                  - article [ref=f4e278]:
                    - generic [ref=f4e279]:
                      - strong [ref=f4e280]: create-intent
                      - emphasis [ref=f4e281]: succeeded
                    - code [ref=f4e282]: intent.199a8a11-bc17-4c54-beb8-20387907c6ea
          - generic [ref=f4e283]:
            - generic [ref=f4e284]:
              - heading "冻结证据链" [level=2] [ref=f4e285]
              - generic [ref=f4e286]: Canonical JSON v2
            - paragraph [ref=f4e290]: 商业浏览器验收：缓存场景 p95 ≤ 250ms、选择输入 p95 ≤ 100ms、桌面峰值堆内存 ≤ 350MiB、30 分钟稳定增长 ≤ 10%。Smoke 不会被标成商业通过。
            - paragraph [ref=f4e291]: 当前 Build 尚无浏览器性能回执。
            - generic [ref=f4e292]:
              - generic [ref=f4e293]:
                - generic [ref=f4e294]: Brief
                - code [ref=f4e295]: 4e9d25e23e…a54d53
              - generic [ref=f4e296]:
                - generic [ref=f4e297]: Plan
                - code [ref=f4e298]: 2a4fc6a5a8…520477
              - generic [ref=f4e299]:
                - generic [ref=f4e300]: Package
                - code [ref=f4e301]: 67c999ea4e…9b8728
              - generic [ref=f4e302]:
                - generic [ref=f4e303]: Manifest
                - code [ref=f4e304]: 7b9890935c…d204be
              - generic [ref=f4e305]:
                - generic [ref=f4e306]: Preview
                - code [ref=f4e307]: 0346ea11e4…090447
              - generic [ref=f4e308]:
                - generic [ref=f4e309]: Quality
                - code [ref=f4e310]: 651a68e8bd…a1a14b
            - paragraph [ref=f4e311]:
              - text: 终端 receipt：
              - code [ref=f4e312]: c3be293a8d…0d631b
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
> 35 |   await expect(page.getByRole('status')).toContainText('已原子发布', { timeout: 30000 })
     |                                          ^ Error: expect(locator).toContainText(expected) failed
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