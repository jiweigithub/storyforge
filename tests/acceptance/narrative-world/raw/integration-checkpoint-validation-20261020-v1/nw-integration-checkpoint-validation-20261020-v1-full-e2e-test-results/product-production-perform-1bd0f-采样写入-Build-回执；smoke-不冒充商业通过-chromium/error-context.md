# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: product-production-performance.spec.ts >> 真实浏览器采样写入 Build 回执；smoke 不冒充商业通过
- Location: tests/e2e/product-production-performance.spec.ts:261:1

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.click: Test timeout of 120000ms exceeded.
Call log:
  - waiting for getByRole('navigation', { name: 'AVG 内容导航' }).getByRole('button', { name: '确认制作方案', exact: true })

```

# Page snapshot

```yaml
- generic [ref=f3e3]:
  - banner [ref=f3e4]:
    - link "返回首页" [ref=f3e5] [cursor=pointer]:
      - /url: /storyforge/
      - generic [ref=f3e8]:
        - strong [ref=f3e9]: StoryForge
        - generic [ref=f3e10]: 故事熔炉
    - navigation "产品导航" [ref=f3e11]:
      - link "首页" [ref=f3e12] [cursor=pointer]:
        - /url: /storyforge/
      - link "世界引擎" [ref=f3e13] [cursor=pointer]:
        - /url: /storyforge/world
      - link "长篇" [ref=f3e14] [cursor=pointer]:
        - /url: /storyforge/long
      - link "短篇" [ref=f3e15] [cursor=pointer]:
        - /url: /storyforge/short
      - link "剧本" [ref=f3e16] [cursor=pointer]:
        - /url: /storyforge/script
      - link "漫画" [ref=f3e17] [cursor=pointer]:
        - /url: /storyforge/comic
      - link "漫剧素材" [ref=f3e18] [cursor=pointer]:
        - /url: /storyforge/motion
      - link "跑团" [ref=f3e19] [cursor=pointer]:
        - /url: /storyforge/ttrpg
      - link "角色聊天" [ref=f3e20] [cursor=pointer]:
        - /url: /storyforge/chat
      - link "AI 小镇" [ref=f3e21] [cursor=pointer]:
        - /url: /storyforge/town
      - link "AVG" [ref=f3e22] [cursor=pointer]:
        - /url: /storyforge/avg
      - link "文字冒险" [ref=f3e23] [cursor=pointer]:
        - /url: /storyforge/adventure
      - link "文字开放世界" [ref=f3e24] [cursor=pointer]:
        - /url: /storyforge/openworld
  - complementary [ref=f3e25]:
    - heading "AVG" [level=1] [ref=f3e26]
    - button "浏览器性能验收 Build" [ref=f3e27] [cursor=pointer]
    - navigation "AVG 页面导航" [ref=f3e30]:
      - button "作品库" [ref=f3e31] [cursor=pointer]
      - button "世界引擎" [ref=f3e32] [cursor=pointer]
      - button "制作台" [active] [ref=f3e33] [cursor=pointer]
      - button "发布与版本" [ref=f3e34] [cursor=pointer]
      - button "游玩" [ref=f3e35] [cursor=pointer]
      - button "通用设置" [ref=f3e36] [cursor=pointer]
  - generic [ref=f3e37]:
    - generic [ref=f3e38]:
      - heading "世界引擎" [level=2] [ref=f3e39]
      - navigation "制作阶段" [ref=f3e40]:
        - button "S1 · 世界封存" [ref=f3e41] [cursor=pointer]
        - button "S2 · 产品定向" [ref=f3e42] [cursor=pointer]
        - button "S3 · 产品执行" [ref=f3e43] [cursor=pointer]
    - main [ref=f3e45]:
      - status [ref=f3e46]: 世界版本已引用，可以查看出口并确认制作。
      - generic [ref=f3e47]:
        - heading "引用一个已封存世界" [level=3] [ref=f3e48]
        - paragraph [ref=f3e49]: 选择后保留不可变的来源版本与数据出口；制作内容不会回写世界。没有世界也可继续规划方案。
        - generic [ref=f3e50]:
          - link "创建或封存世界" [ref=f3e51] [cursor=pointer]:
            - /url: /storyforge/world/worlds
          - button "返回制作方案" [ref=f3e52] [cursor=pointer]
        - article [ref=f3e53]:
          - generic [ref=f3e54]:
            - heading "性能验收来源" [level=4] [ref=f3e55]
            - paragraph [ref=f3e56]: W-IPGEW-ZHM3 · v1
          - button "选择此版本" [ref=f3e57] [cursor=pointer]
      - generic [ref=f3e58]:
        - heading "版本资源与来源证据" [level=3] [ref=f3e59]
        - paragraph [ref=f3e60]: 这里展示已封存版本。修改内容请回到世界草稿，再封存新版本；各产品需要读取什么，在各自制作页确定。
        - generic [ref=f3e61]:
          - generic [ref=f3e62]:
            - text: 查看世界版本
            - combobox "出口世界版本" [ref=f3e63]:
              - option "选择版本"
              - option "v1 · 性能验收来源" [selected]
          - button "封存与发布" [ref=f3e64] [cursor=pointer]
        - paragraph [ref=f3e65]: W-IPGEW-ZHM3 · v1 · 浏览器性能隔离世界
        - group [ref=f3e66]:
          - generic "版本与来源校验信息" [ref=f3e67]
        - group [ref=f3e68]:
          - generic "版本能力与封存范围" [ref=f3e69]
          - table [ref=f3e71]:
            - rowgroup [ref=f3e72]:
              - row [ref=f3e73]:
                - columnheader "内容域" [ref=f3e74]
                - columnheader "范围" [ref=f3e75]
                - columnheader "可用状态" [ref=f3e76]
                - columnheader "已确认" [ref=f3e77]
                - columnheader "候选" [ref=f3e78]
                - columnheader "冲突" [ref=f3e79]
                - columnheader "未收录" [ref=f3e80]
                - columnheader "证据与索引" [ref=f3e81]
            - rowgroup [ref=f3e82]:
              - row [ref=f3e83]:
                - cell "角色" [ref=f3e84]
                - cell "已选" [ref=f3e85]
                - cell "缺少内容" [ref=f3e86]
                - cell "0" [ref=f3e87]
                - cell "0" [ref=f3e88]
                - cell "0" [ref=f3e89]
                - cell "0" [ref=f3e90]
                - cell "无原文 · 无目录索引" [ref=f3e91]
              - row [ref=f3e92]:
                - cell "细纲" [ref=f3e93]
                - cell "已选" [ref=f3e94]
                - cell "缺少内容" [ref=f3e95]
                - cell "0" [ref=f3e96]
                - cell "0" [ref=f3e97]
                - cell "0" [ref=f3e98]
                - cell "0" [ref=f3e99]
                - cell "无原文 · 无目录索引" [ref=f3e100]
              - row [ref=f3e101]:
                - cell "实体与地点" [ref=f3e102]
                - cell "已选" [ref=f3e103]
                - cell "缺少内容" [ref=f3e104]
                - cell "0" [ref=f3e105]
                - cell "0" [ref=f3e106]
                - cell "0" [ref=f3e107]
                - cell "0" [ref=f3e108]
                - cell "无原文 · 无目录索引" [ref=f3e109]
              - row [ref=f3e110]:
                - cell "世界基础" [ref=f3e111]
                - cell "已选" [ref=f3e112]
                - cell "部分可用" [ref=f3e113]
                - cell "1" [ref=f3e114]
                - cell "0" [ref=f3e115]
                - cell "0" [ref=f3e116]
                - cell "0" [ref=f3e117]
                - cell "有原文 · 目录检索" [ref=f3e118]
              - row [ref=f3e119]:
                - cell "正文" [ref=f3e120]
                - cell "已选" [ref=f3e121]
                - cell "缺少内容" [ref=f3e122]
                - cell "0" [ref=f3e123]
                - cell "0" [ref=f3e124]
                - cell "0" [ref=f3e125]
                - cell "0" [ref=f3e126]
                - cell "无原文 · 无目录索引" [ref=f3e127]
              - row [ref=f3e128]:
                - cell "多世界" [ref=f3e129]
                - cell "已选" [ref=f3e130]
                - cell "缺少内容" [ref=f3e131]
                - cell "0" [ref=f3e132]
                - cell "0" [ref=f3e133]
                - cell "0" [ref=f3e134]
                - cell "0" [ref=f3e135]
                - cell "无原文 · 无目录索引" [ref=f3e136]
              - row [ref=f3e137]:
                - cell "大纲" [ref=f3e138]
                - cell "已选" [ref=f3e139]
                - cell "缺少内容" [ref=f3e140]
                - cell "0" [ref=f3e141]
                - cell "0" [ref=f3e142]
                - cell "0" [ref=f3e143]
                - cell "0" [ref=f3e144]
                - cell "无原文 · 无目录索引" [ref=f3e145]
              - row [ref=f3e146]:
                - cell "关系与认知" [ref=f3e147]
                - cell "已选" [ref=f3e148]
                - cell "缺少内容" [ref=f3e149]
                - cell "0" [ref=f3e150]
                - cell "0" [ref=f3e151]
                - cell "0" [ref=f3e152]
                - cell "0" [ref=f3e153]
                - cell "无原文 · 无目录索引" [ref=f3e154]
              - row [ref=f3e155]:
                - cell "故事语义" [ref=f3e156]
                - cell "已选" [ref=f3e157]
                - cell "缺少内容" [ref=f3e158]
                - cell "0" [ref=f3e159]
                - cell "0" [ref=f3e160]
                - cell "0" [ref=f3e161]
                - cell "0" [ref=f3e162]
                - cell "无原文 · 无目录索引" [ref=f3e163]
              - row [ref=f3e164]:
                - cell "主支线" [ref=f3e165]
                - cell "已选" [ref=f3e166]
                - cell "部分可用" [ref=f3e167]
                - cell "1" [ref=f3e168]
                - cell "0" [ref=f3e169]
                - cell "0" [ref=f3e170]
                - cell "0" [ref=f3e171]
                - cell "有原文 · 目录检索" [ref=f3e172]
          - paragraph [ref=f3e173]: 未被本次封存收录的资源，不等于世界中不存在；候选与冲突不会冒充已确认内容。
      - generic [ref=f3e174]:
        - generic [ref=f3e175]:
          - heading "资源目录" [level=3] [ref=f3e176]
          - generic [ref=f3e177]:
            - generic [ref=f3e178]:
              - text: 搜索资源
              - textbox "搜索世界资源" [ref=f3e179]
            - generic [ref=f3e180]:
              - text: 资源类型
              - combobox "资源类型" [ref=f3e181]:
                - option "全部类型" [selected]
                - option "世界集合"
                - option "世界设定"
                - option "故事核心"
                - option "角色"
                - option "人物关系"
                - option "故事线"
                - option "故事线进度"
                - option "大纲"
                - option "细纲"
                - option "正文"
                - option "伏笔"
                - option "地点"
                - option "实体词条"
                - option "世界通道"
                - option "事实"
            - button "搜索" [ref=f3e182] [cursor=pointer]
          - generic [ref=f3e183]:
            - button "世界设定 1世界设定 ·" [ref=f3e184] [cursor=pointer]:
              - text: 世界设定 1
              - generic [ref=f3e185]: 世界设定 ·
            - button "主线故事线 ·" [ref=f3e186] [cursor=pointer]:
              - text: 主线
              - generic [ref=f3e187]: 故事线 ·
        - generic [ref=f3e188]:
          - heading "资源详情" [level=3] [ref=f3e189]
          - paragraph [ref=f3e190]: 选择左侧资源，查看内容及其固定版本来源。
```

# Test source

```ts
  22  | const commercialQuality = mode === 'commercial' || process.env.PRODUCTPROD_PERF_QUALITY === 'commercial'
  23  | const commercialDurationMs = 30 * 60 * 1000
  24  | const smokeDurationMs = 5_000
  25  | const configuredWarmupTransitions = Number(process.env.PRODUCTPROD_PERF_WARMUP_TRANSITIONS ?? 20)
  26  | const warmupTransitions = Number.isInteger(configuredWarmupTransitions)
  27  |   && configuredWarmupTransitions >= 20 && configuredWarmupTransitions <= 2_000
  28  |   ? configuredWarmupTransitions : 20
  29  | 
  30  | function productionOutputs(system: string) {
  31  |   const worldHash = system.match(/world:[a-f0-9]{64}/)?.[0] ?? `world:${'a'.repeat(64)}`
  32  |   if (system.includes('任务=content.design。')) return {
  33  |     schema: 'storyforge.product-design-artifact', version: 1, title: '性能验收循环',
  34  |     logline: '玩家在同一缓存场景中持续调查，并可随时作出结局选择。',
  35  |     playerGoal: '调查潮门信号并观察选择响应。', coreLoop: ['阅读场景', '作出选择', '观察后果'],
  36  |     sourceAnchors: [worldHash], invariants: ['不改写冻结世界事实'], tone: ['清晰', '克制'],
  37  |     targetPlayMinutes: 20, targetEndingCount: 2,
  38  |   }
  39  |   if (system.includes('任务=content.narrative。')) return {
  40  |     schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '潮门性能路线',
  41  |     entryNodeKey: 'opening',
  42  |     nodes: [
  43  |       { key: 'opening', kind: 'entry', title: '潮门之前', summary: '首次进入调查路线。', condition: {}, effects: [] },
  44  |       { key: 'cached-loop', kind: 'scene', title: '信号回廊', summary: '可重复进入的缓存场景。', condition: {}, effects: [] },
  45  |       { key: 'truth-ending', kind: 'ending', title: '公开记录', summary: '记录被公开。', condition: {}, effects: [] },
  46  |       { key: 'shelter-ending', kind: 'ending', title: '封存记录', summary: '记录被封存。', condition: {}, effects: [] },
  47  |     ],
  48  |     beats: [
  49  |       { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮门信号第一次亮起。', order: 0 },
  50  |       { beatKey: 'beat.loop', nodeKey: 'cached-loop', kind: 'narration', speakerKey: null, text: '同一段回廊再次响应你的选择。', order: 0 },
  51  |       { beatKey: 'beat.truth', nodeKey: 'truth-ending', kind: 'narration', speakerKey: null, text: '全部记录被投向海面。', order: 0 },
  52  |       { beatKey: 'beat.shelter', nodeKey: 'shelter-ending', kind: 'narration', speakerKey: null, text: '记录留在潮门之后。', order: 0 },
  53  |     ],
  54  |     choices: [
  55  |       { choiceKey: 'choice.enter-loop', sourceNodeKey: 'opening', text: '进入信号回廊', description: '开始缓存场景测量', unavailableReason: '', targetNodeKey: 'cached-loop', displayCondition: {}, availableCondition: {}, effects: [], tags: ['performance'], order: 0 },
  56  |       { choiceKey: 'choice.repeat-loop', sourceNodeKey: 'cached-loop', text: '继续检查信号', description: '重复进入同一缓存场景', unavailableReason: '', targetNodeKey: 'cached-loop', displayCondition: {}, availableCondition: {}, effects: [], tags: ['performance'], order: 0 },
  57  |       { choiceKey: 'choice.truth', sourceNodeKey: 'cached-loop', text: '公开记录', description: '结束路线', unavailableReason: '', targetNodeKey: 'truth-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['ending'], order: 1 },
  58  |       { choiceKey: 'choice.shelter', sourceNodeKey: 'cached-loop', text: '封存记录', description: '结束路线', unavailableReason: '', targetNodeKey: 'shelter-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['ending'], order: 2 },
  59  |     ],
  60  |   }
  61  |   if (system.includes('任务=content.product-module。')) return {
  62  |     schema: 'storyforge.product-module-artifact', version: 1, productType: 'avg',
  63  |     interfaceStyle: '高对比文字舞台。', interactionNotes: ['选择后立即显示新场景。'],
  64  |     presentationPolicy: { pacing: 'fast', transitionMs: 0, backgroundStrategy: 'none' },
  65  |   }
  66  |   if (system.includes('任务=media.requirements。')) return {
  67  |     schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: [],
  68  |   }
  69  |   throw new Error(`未识别的生产任务:${system.slice(0, 120)}`)
  70  | }
  71  | 
  72  | async function createPerformanceBuild(page: Page) {
  73  |   await page.addInitScript(() => {
  74  |     localStorage.setItem('storyforge_guide_completed', 'performance-e2e')
  75  |     localStorage.setItem('storyforge-ai-api-key-remember', 'true')
  76  |     localStorage.setItem('storyforge-ai-config', JSON.stringify({
  77  |       provider: 'agnes', apiKey: 'e2e-existing-global-key', model: 'agnes-2.0-flash',
  78  |       baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0.7, maxTokens: 0,
  79  |     }))
  80  |   })
  81  |   await page.route('**/chat/completions', async route => {
  82  |     const request = route.request()
  83  |     const body = request.postDataJSON() as { messages?: Array<{ role?: string; content?: string }> }
  84  |     const system = body.messages?.find(message => message.role === 'system')?.content ?? ''
  85  |     const output = productionOutputs(system)
  86  |     await route.fulfill({
  87  |       status: 200,
  88  |       contentType: 'application/json',
  89  |       body: JSON.stringify({
  90  |         id: `perf-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
  91  |         model: 'agnes-2.0-flash', choices: [{ index: 0, finish_reason: 'stop', message: {
  92  |           role: 'assistant', content: JSON.stringify(output),
  93  |         } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
  94  |       }),
  95  |     })
  96  |   })
  97  | 
  98  |   await page.goto('./')
  99  |   await createWorld(page, '浏览器性能隔离世界', '')
  100 |   await openWorldSection(page,'story')
  101 |   await page.getByRole('navigation',{name:'世界内容导航'}).getByRole('button',{name:'主支线与进度',exact:true}).click()
  102 |   await page.getByTitle('新增主线').click()
  103 |   await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  104 |   await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  105 |   await publishCurrentWorldRelease(page, '性能验收来源')
  106 | 
  107 |   // Browser performance is a shared product-platform gate. Exercise it through
  108 |   // AVG's product-owned route instead of borrowing the text-adventure entry.
  109 |   await page.goto('./avg/vision')
  110 |   await page.getByLabel('AVG 作品名称').fill('浏览器性能验收 Build')
  111 |   await page.getByLabel('玩家身份／主角', { exact: true }).fill('潮门信号员')
  112 |   await page.getByLabel('开场与核心目标').fill('持续检查潮门信号，测量选择输入和缓存场景切换。')
  113 |   await page.getByLabel('视觉素材').selectOption('none')
  114 |   await page.getByLabel('音频目标').selectOption('none')
  115 |   if (commercialQuality) await page.getByLabel('制作质量').selectOption('commercial-candidate')
  116 |   await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  117 |   const avgNavigation = page.getByRole('navigation', { name: 'AVG 页面导航' })
  118 |   await avgNavigation.getByRole('button', { name: '世界引擎', exact: true }).click()
  119 |   await page.getByRole('button', { name: '选择此版本', exact: true }).first().click()
  120 |   await avgNavigation.getByRole('button', { name: '制作台', exact: true }).click()
  121 |   await page.getByRole('navigation', { name: 'AVG 内容导航' })
> 122 |     .getByRole('button', { name: '确认制作方案', exact: true }).click()
      |                                                           ^ Error: locator.click: Test timeout of 120000ms exceeded.
  123 | 
  124 |   const enableProduction = page.getByRole('button', { name: '启用并继续确认', exact: true })
  125 |   // This fresh world's production switch is off. Wait for the routed product
  126 |   // page before authorizing; an immediate visibility probe can skip this step.
  127 |   await enableProduction.click()
  128 | 
  129 |   await expect(page.getByRole('textbox', { name: '游戏标题', exact: true })).toBeVisible({ timeout: 15_000 })
  130 |   await expect(page.getByRole('combobox', { name: /产品形态/ })).toHaveValue('avg')
  131 |   await page.getByRole('textbox', { name: '游戏标题', exact: true }).fill('浏览器性能验收 Build')
  132 |   await page.getByRole('textbox', { name: '玩家身份 / 主角', exact: true }).fill('扮演潮门信号员')
  133 |   await page.getByRole('combobox', { name: '游戏规模', exact: true }).selectOption('scene')
  134 |   await page.getByRole('textbox', { name: /你想玩的第一幕与核心目标/ }).fill('持续检查潮门信号，测量选择输入和缓存场景切换。')
  135 |   await page.getByRole('button', { name: '分析可玩起点', exact: true }).click()
  136 |   await page.getByRole('button', { name: '生成严格 Brief', exact: true }).click()
  137 |   await page.getByRole('button', { name: '保存 Brief revision', exact: true }).click()
  138 |   await expect(page.getByText(/Production 待授权/)).toBeVisible()
  139 |   await page.getByRole('button', { name: '作者授权并开始自动制作', exact: true }).click()
  140 |   await expect(page.getByRole('button', { name: '试玩未发布 Build', exact: true }))
  141 |     .toBeVisible({ timeout: 30_000 })
  142 |   if (commercialQuality) {
  143 |     await expect(page.getByTestId('product-production-performance-blocker')).toContainText('尚无浏览器性能回执')
  144 |     await expect(page.getByTestId('product-production-playthrough-blocker')).toContainText('试玩未发布 Build')
  145 |     await expect(page.getByRole('button', { name: '复验并原子发布', exact: true })).toHaveCount(0)
  146 |   }
  147 |   await page.getByRole('button', { name: '试玩未发布 Build', exact: true }).click()
  148 |   await expect(page.getByTestId('avg-player')).toBeVisible({ timeout: 15_000 })
  149 |   await expect(page.getByTestId('avg-player')).toContainText('潮门信号第一次亮起。')
  150 | }
  151 | 
  152 | async function revealChoices(page: Page) {
  153 |   const choicesVisible = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.avg-choices'))
  154 |     .some(element => {
  155 |       const rect = element.getBoundingClientRect()
  156 |       const style = getComputedStyle(element)
  157 |       return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  158 |     }))
  159 |   for (let attempt = 0; attempt < 4 && !await choicesVisible(); attempt += 1) {
  160 |     const control = page.locator('button.avg-continue:not([disabled])').last()
  161 |     // A durable beat commit briefly disables the control and may replace it
  162 |     // directly with the choice panel. Wait for either valid next state instead
  163 |     // of treating that expected DOM replacement as a click failure.
  164 |     await expect.poll(async () => (
  165 |       await choicesVisible() || await control.isVisible().catch(() => false)
  166 |     ), { timeout: 15_000 }).toBe(true)
  167 |     if (await choicesVisible()) break
  168 |     try {
  169 |       await control.click({ timeout: 5_000 })
  170 |     } catch (cause) {
  171 |       if (!await choicesVisible()) throw cause
  172 |     }
  173 |   }
  174 |   await expect.poll(choicesVisible, { timeout: 15_000 }).toBe(true)
  175 | }
  176 | 
  177 | async function readBuildProbe(page: Page) {
  178 |   return page.evaluate(async () => {
  179 |     const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
  180 |     const { db } = await importer('/storyforge/src/lib/db/schema.ts')
  181 |     const { createProductFirstInteractiveResourcePlanV1 } = await importer('/storyforge/src/lib/product-production/first-interactive-resources.ts')
  182 |     const build = await db.productBuilds.orderBy('id').last()
  183 |     if (!build) throw new Error('性能验收 Build 不存在')
  184 |     const preview = JSON.parse(build.previewManifestJson)
  185 |     const firstInteractive = createProductFirstInteractiveResourcePlanV1({
  186 |       previewManifestJson: build.previewManifestJson,
  187 |       runtimePackage: preview.runtimePackage,
  188 |     })
  189 |     return {
  190 |       buildId: build.id as number,
  191 |       scope: { projectId: build.projectId, worldId: build.worldId, workId: build.workId },
  192 |       packageHash: build.packageHash as string,
  193 |       previewHash: build.previewHash as string,
  194 |       // The 12 MiB gate covers the verified Preview JSON plus only media used
  195 |       // by the first playable surface. The long-run phase still decodes and
  196 |       // exercises the complete catalog; bundle size has its own release gate.
  197 |       firstInteractiveBytes: firstInteractive.totalBytes,
  198 |       firstInteractiveAssetKeys: firstInteractive.assetKeys,
  199 |     }
  200 |   })
  201 | }
  202 | 
  203 | async function sampleHeap(page: Page): Promise<number> {
  204 |   const session = await page.context().newCDPSession(page)
  205 |   try {
  206 |     // Measure retained page memory, not arbitrary garbage that V8 has not yet
  207 |     // collected. A real leak remains reachable and therefore remains visible.
  208 |     await session.send('HeapProfiler.collectGarbage')
  209 |     await session.send('Performance.enable')
  210 |     const result = await session.send('Performance.getMetrics') as { metrics: Array<{ name: string; value: number }> }
  211 |     const used = result.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value
  212 |     if (!Number.isFinite(used) || Number(used) < 0) throw new Error('Chromium 未返回 JSHeapUsedSize')
  213 |     return Number(used)
  214 |   } finally {
  215 |     await session.detach()
  216 |   }
  217 | }
  218 | 
  219 | async function measureChoiceTransition(page: Page) {
  220 |   await revealChoices(page)
  221 |   const choice = page.locator('.avg-choices button:not(:disabled)').first()
  222 |   const sceneStartedAt = await page.evaluate(() => performance.now())
```