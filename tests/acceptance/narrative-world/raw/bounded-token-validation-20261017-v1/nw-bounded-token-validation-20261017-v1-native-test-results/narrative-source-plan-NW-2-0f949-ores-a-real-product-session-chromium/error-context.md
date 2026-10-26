# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: narrative-source-plan.spec.ts >> NW-2C avg selects v4 sources, authorizes production, publishes and restores a real product session
- Location: tests/e2e/narrative-source-plan.spec.ts:5:3

# Error details

```
Error: page.evaluate: Error: [scope] WorkspaceScope 必须包含有效的 projectId/worldId/workId
    at fail (http://127.0.0.1:65137/storyforge/src/lib/workspace/scope.ts:19:9)
    at resolveScope (http://127.0.0.1:65137/storyforge/src/lib/workspace/scope.ts:25:7)
    at verifyProductRuntimeSource (http://127.0.0.1:65137/storyforge/src/lib/product-production/preview-source.ts:45:23)
    at Module.createProductRuntimeInstanceFromSource (http://127.0.0.1:65137/storyforge/src/lib/product/runtime-instances.ts:401:26)
    at eval (eval at evaluate (:311:30), <anonymous>:8:92)
    at async <anonymous>:337:30
```

# Page snapshot

```yaml
- generic [ref=f4e3]:
  - banner [ref=f4e4]:
    - link "返回首页" [ref=f4e5] [cursor=pointer]:
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
    - heading "AVG" [level=1] [ref=f4e26]
    - button "NW-2C avg 新版世界" [ref=f4e27] [cursor=pointer]
    - navigation "AVG 页面导航" [ref=f4e30]:
      - button "作品库" [ref=f4e31] [cursor=pointer]
      - button "世界引擎" [ref=f4e32] [cursor=pointer]
      - button "制作台" [ref=f4e33] [cursor=pointer]
      - button "发布与版本" [ref=f4e34] [cursor=pointer]
      - button "游玩" [ref=f4e35] [cursor=pointer]
      - button "通用设置" [ref=f4e36] [cursor=pointer]
  - generic [ref=f4e37]:
    - heading "游玩" [level=2] [ref=f4e39]
    - generic [ref=f4e40]:
      - complementary [ref=f4e41]:
        - navigation "AVG 内容导航" [ref=f4e42]:
          - generic [ref=f4e43]:
            - heading "游玩与记录" [level=3] [ref=f4e44]
            - button "玩家舞台" [ref=f4e45] [cursor=pointer]
            - button "存档与路线" [ref=f4e46] [cursor=pointer]
      - main [ref=f4e47]:
        - main [ref=f4e49]:
          - text: STORYFORGE VISUAL NOVEL
          - heading "AVG 游戏库" [level=2] [ref=f4e50]
          - paragraph [ref=f4e51]: 先选择作品，再进入独立标题页开始或继续；舞台、立绘和对白不会提前挤进游戏目录。
          - generic [ref=f4e52]:
            - generic [ref=f4e53]: 全部游戏
            - generic [ref=f4e54]: 1 部可游玩作品
          - region "AVG 游戏列表" [ref=f4e55]:
            - article [ref=f4e56]:
              - button "查看游戏：NW-2C avg 新版世界" [ref=f4e57] [cursor=pointer]:
                - generic [ref=f4e61]:
                  - generic [ref=f4e62]: AVG / 视觉小说
                  - strong [ref=f4e63]: NW-2C avg 新版世界
                  - paragraph [ref=f4e64]: 渡口的约定 · 有后果的选择；基于冻结世界事实的叙事
                  - generic [ref=f4e65]: 3 场景 · 3 对白 · 0 美术 · 0 演出
                - generic [ref=f4e66]: 查看详情
```