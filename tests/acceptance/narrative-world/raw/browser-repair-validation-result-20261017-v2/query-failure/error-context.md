# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: narrative-query.spec.ts >> author can read shared original evidence while fulfilled and pending developments stay in their own views after refresh
- Location: tests/e2e/narrative-query.spec.ts:58:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByLabel('叙事查询原文证据')
Expected substring: "午后青篙听到传言，以为铜钥匙仍在茶摊；桥匠已经知道钥匙在自己的工具箱里。桥匠依照交接记录检查工具箱，发现铜钥匙；他没有把消息告诉青篙。"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for getByLabel('叙事查询原文证据')

```

```yaml
- banner:
  - button "返回首页":
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
  - heading "世界引擎" [level=1]
  - button "南汀渡口":
    - img
    - text: 南汀渡口
  - navigation "世界页面导航":
    - button "我的世界"
    - button "世界设定"
    - button "版本与封存"
    - button "数据出口"
    - button "分享与导入"
    - button "社区与发行"
    - button "通用设置"
- heading "数据出口" [level=2]
- heading "版本资源与来源证据" [level=3]
- paragraph: 这里展示已封存版本。修改内容请回到世界草稿，再封存新版本；各产品需要读取什么，在各自制作页确定。
- text: 查看世界版本
- combobox "出口世界版本":
  - option "选择版本"
  - option "v2 · 共用原文证据的隔离查询" [selected]
  - option "v1 · ferry-names:baseline"
- button "编辑世界草稿"
- button "封存与发布"
- region "实验叙事查询":
  - heading "实验：叙事查询" [level=3]
  - paragraph: 查询这个已封存版本的已确认内容。未抽取的正文和未知时间会保留缺口，不表示世界中不存在。
  - paragraph: 当前视角：发展与承诺
  - button "已发生内容"
  - button "作者计划"
  - button "发展与承诺"
  - text: 时制
  - combobox "叙事查询时制":
    - option "未选择"
    - option "驿站历 · day" [selected]
  - text: 时间点
  - textbox "叙事查询时间点":
    - /placeholder: 例如 2
  - text: 预览角色
  - combobox "叙事查询预览角色":
    - option "选择角色" [selected]
  - button "预览截至此时的角色认知"
  - text: 关键词
  - textbox "叙事查询关键词":
    - /placeholder: 可留空，只按条件筛选
  - text: 实体
  - combobox "叙事查询实体":
    - option "不限实体" [selected]
  - text: 故事线
  - combobox "叙事查询故事线":
    - option "不限故事线" [selected]
  - text: 时间条件
  - combobox "叙事查询时间条件":
    - option "不限时间" [selected]
    - option "发生时点"
    - option "此时有效的状态"
    - option "获知时点"
  - checkbox "沿已确认因果展开一步"
  - text: 沿已确认因果展开一步
  - button "查询封存内容"
  - alert: "WorldQueryErrorV1: [world-query:access-unavailable] 资源依赖在当前授权下不完整"
  - article:
    - heading "承诺 · 已兑现" [level=4]
    - paragraph: 发展与承诺 · 已确认内容
    - paragraph: 索引摘要（非原文）：午后青篙听到传言，以为铜钥匙仍在茶摊；桥匠已经知道钥匙在自己的工具箱里。桥匠依照交接记录检查工具箱，发现铜钥匙；他没有把消息告诉青篙。
    - button "查看完整原文证据"
  - group: 本次查询的版本与校验信息
  - paragraph: 已投影 15 条作者标注；10 个来源尚不能完整投影。尚未标注的正文仍保留在封存中。
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | 
  3   | test('experimental author browser queries frozen facts and plans, then changes to a bounded character perspective without truth leakage', async ({ page }) => {
  4   |   test.setTimeout(120_000)
  5   |   // Match the domain corpus clock without changing browser timers or source
  6   |   // timestamps; otherwise its 2027 creation dates follow confirmation.
  7   |   await page.clock.setFixedTime(1_900_000_000_000)
  8   |   await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  9   |   await page.goto('./world/worlds')
  10  |   const fixture = await page.evaluate(async () => {
  11  |     const imp = new Function('path', 'return import(path)')
  12  |     // Explicit test-owned annotations, not story extraction or author review.
  13  |     const { seedConfirmedNarrativeDomainV1 } = await imp('/storyforge/tests/helpers/narrative-domain-fixture.ts')
  14  |     const { createWorldRevision, publishWorldRevision } = await imp('/storyforge/src/lib/world-engine/releases.ts')
  15  |     const { db } = await imp('/storyforge/src/lib/db/schema.ts')
  16  |     const seeded = await seedConfirmedNarrativeDomainV1()
  17  |     const revision = await createWorldRevision({ scope: seeded.scope, formatVersion: 4, includeWorkSources: true, label: '叙事查询隔离夹具' })
  18  |     const release = await publishWorldRevision(revision.id)
  19  |     const manifest = JSON.parse(release.manifestJson)
  20  |     const belief = manifest.narrative.bundle.records.find((row: { kind: string }) => row.kind === 'epistemic-event')
  21  |     const truth = manifest.narrative.bundle.records.find((row: { semanticId: string }) => row.semanticId === belief.payload.propositionRef.semanticId)
  22  |     await db.temporalFacts.update(seeded.ids.fact, { value: '草稿中的新值不许替换旧封存' })
  23  |     return { projectId: seeded.scope.projectId, releaseId: release.id, releaseHash: release.contentHash,
  24  |       characterKey: belief.payload.holderRef.semanticId, belief: belief.payload.assertedValue.value, truth: truth.payload.value.value,
  25  |       plan: seeded.development.statement, worldId: seeded.scope.worldId }
  26  |   })
  27  |   await page.goto(`./world/outlet?project=${fixture.projectId}&narrative-preview=1`)
  28  |   await expect(page.getByRole('region', { name: '实验叙事查询' })).toBeVisible()
  29  |   await page.getByLabel('叙事查询关键词').fill(fixture.truth)
  30  |   await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  31  |   const results = page.getByLabel('叙事查询结果', { exact: true })
  32  |   await expect(results).toContainText(fixture.truth)
  33  |   await expect(results).not.toContainText('草稿中的新值不许替换旧封存')
  34  |   await results.getByRole('button', { name: '查看完整原文证据' }).first().click()
  35  |   await expect(page.getByLabel('叙事查询原文证据')).toContainText(fixture.truth)
  36  |   await page.getByRole('button', { name: '作者计划', exact: true }).click()
  37  |   await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  38  |   await expect(results).toContainText(fixture.plan)
  39  |   await page.getByRole('button', { name: '已发生内容', exact: true }).click()
  40  |   await page.getByLabel('叙事查询时间点').fill('2')
  41  |   await page.getByLabel('叙事查询预览角色').selectOption(fixture.characterKey)
  42  |   await page.getByRole('button', { name: '预览截至此时的角色认知', exact: true }).click()
  43  |   await expect(page.getByText('当前视角：角色认知', { exact: true })).toBeVisible()
  44  |   await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  45  |   await expect(results).toContainText(fixture.belief)
  46  |   await expect(results).not.toContainText(fixture.truth)
  47  |   await expect(results).not.toContainText(fixture.plan)
  48  |   await expect(page.getByLabel('叙事查询原文证据')).toHaveCount(0)
  49  |   await page.reload()
  50  |   await expect(page.getByRole('region', { name: '实验叙事查询' })).toBeVisible()
  51  |   const preserved = await page.evaluate(async id => {
  52  |     const imp = new Function('path', 'return import(path)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
  53  |     return (await db.worldReleases.get(id)).contentHash
  54  |   }, fixture.releaseId)
  55  |   expect(preserved).toBe(fixture.releaseHash)
  56  | })
  57  | 
  58  | test('author can read shared original evidence while fulfilled and pending developments stay in their own views after refresh', async ({ page }) => {
  59  |   test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW === '1', 'experimental author UI is hidden in production builds')
  60  |   test.setTimeout(120_000)
  61  |   await page.clock.setFixedTime(1_900_000_000_000)
  62  |   await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  63  |   await page.goto('./world/worlds')
  64  |   const fixture = await page.evaluate(async () => {
  65  |     const imp = new Function('path', 'return import(path)')
  66  |     const { seedConfirmedNarrativeDomainV1 } = await imp('/storyforge/tests/helpers/narrative-domain-fixture.ts')
  67  |     const { createWorldRevision, publishWorldRevision } = await imp('/storyforge/src/lib/world-engine/releases.ts')
  68  |     const { db } = await imp('/storyforge/src/lib/db/schema.ts')
  69  |     const seeded = await seedConfirmedNarrativeDomainV1()
  70  |     const arc = (await db.storyArcs.where('projectId').equals(seeded.scope.projectId).toArray())[0]
  71  |     const proof = await seeded.selfEvidence('chapters', seeded.ids.chapter, 'content', 'shared-story')
  72  |     const pending = { ...seeded.development, owners: [], members: [], transitions: [], developmentType: 'commitment', state: 'blocked' }
  73  |     const fulfilled = { ...pending, semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000003',
  74  |       statement: '测试用已兑现承诺', state: 'fulfilled', narrativeModalityV1: 'established', resolutionEvidenceKeys: ['shared-story'] }
  75  |     // Both explicit test annotations cite exactly the same frozen chapter.
  76  |     // No model request or claim of new human semantic review is involved.
  77  |     await seeded.confirm('storyArcs', arc.id, { narrativeDevelopmentsV1: [pending, fulfilled],
  78  |       narrativeEvidenceV1: [{ ...proof, source: { chapterId: seeded.ids.chapter, sourceUid: seeded.chapter.ragDocumentId } }] })
  79  |     const revision = await createWorldRevision({ scope: seeded.scope, formatVersion: 4, includeWorkSources: true, label: '共用原文证据的隔离查询' })
  80  |     const release = await publishWorldRevision(revision.id)
  81  |     return { projectId: seeded.scope.projectId, releaseId: release.id, manifestJson: release.manifestJson, original: seeded.chapter.content }
  82  |   })
  83  |   await page.goto(`./world/outlet?project=${fixture.projectId}&narrative-preview=1`)
  84  |   const results = page.getByLabel('叙事查询结果', { exact: true })
  85  |   const fulfilled = results.locator('article').filter({ has: page.getByRole('heading', { name: '承诺 · 已兑现', exact: true }) })
  86  |   const blocked = results.locator('article').filter({ has: page.getByRole('heading', { name: '承诺 · 受阻', exact: true }) })
  87  |   for (const refresh of [false, true]) {
  88  |     if (refresh) await page.reload()
  89  |     await page.getByRole('button', { name: '发展与承诺', exact: true }).click()
  90  |     await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  91  |     await expect(fulfilled).toBeVisible()
  92  |     await expect(blocked).toHaveCount(0)
  93  |     await fulfilled.getByRole('button', { name: '查看完整原文证据' }).click()
> 94  |     await expect(page.getByLabel('叙事查询原文证据')).toContainText(fixture.original)
      |                                               ^ Error: expect(locator).toContainText(expected) failed
  95  |     await page.getByRole('button', { name: '作者计划', exact: true }).click()
  96  |     await expect(page.getByLabel('叙事查询原文证据')).toHaveCount(0)
  97  |     await page.getByRole('button', { name: '查询封存内容', exact: true }).click()
  98  |     await expect(blocked).toBeVisible()
  99  |     await expect(fulfilled).toHaveCount(0)
  100 |     await blocked.getByRole('button', { name: '查看完整原文证据' }).click()
  101 |     await expect(page.getByLabel('叙事查询原文证据')).toContainText(fixture.original)
  102 |   }
  103 |   const preserved = await page.evaluate(async id => {
  104 |     const imp = new Function('path', 'return import(path)'), { db } = await imp('/storyforge/src/lib/db/schema.ts')
  105 |     return (await db.worldReleases.get(id)).manifestJson
  106 |   }, fixture.releaseId)
  107 |   expect(preserved).toBe(fixture.manifestJson)
  108 | })
  109 | 
  110 | test('legacy author outlet lists an empty search and does not turn directory counts into narrative capabilities', async ({ page }) => {
  111 |   await page.goto('./world/worlds')
  112 |   const id = await page.evaluate(async () => {
  113 |     const imp = new Function('path', 'return import(path)')
  114 |     const { seedNarrativeFamily } = await imp('/storyforge/tests/helpers/narrative-world-evaluation.ts')
  115 |     const { default: corpus } = await imp('/storyforge/tests/acceptance/narrative-world/corpus-v1.json')
  116 |     return (await seedNarrativeFamily(corpus.families[0])).scope.projectId
  117 |   })
  118 |   await page.goto(`./world/outlet?project=${id}`)
  119 |   await expect(page.getByRole('heading', { name: '资源目录', exact: true })).toBeVisible()
  120 |   await expect(page.locator('.we-resource-list button').first()).toBeVisible()
  121 |   await expect(page.getByRole('alert')).toHaveCount(0)
  122 |   await expect(page.getByRole('region', { name: '实验叙事查询' })).toHaveCount(0)
  123 | })
  124 | 
```