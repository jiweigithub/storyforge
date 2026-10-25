# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: narrative-source-plan.spec.ts >> NW-2C chat selects v4 sources, authorizes production, publishes and restores a real product session
- Location: tests/e2e/narrative-source-plan.spec.ts:5:3

# Error details

```
Error: page.evaluate: Error: [scope] WorkspaceScope 必须包含有效的 projectId/worldId/workId
    at fail (http://127.0.0.1:54579/storyforge/src/lib/workspace/scope.ts:19:9)
    at resolveScope (http://127.0.0.1:54579/storyforge/src/lib/workspace/scope.ts:25:7)
    at verifyProductRuntimeSource (http://127.0.0.1:54579/storyforge/src/lib/product-production/preview-source.ts:45:23)
    at Module.createProductRuntimeInstanceFromSource (http://127.0.0.1:54579/storyforge/src/lib/product/runtime-instances.ts:401:26)
    at eval (eval at evaluate (:311:30), <anonymous>:8:92)
    at async <anonymous>:337:30
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
    - heading "游玩" [level=2] [ref=f4e40]
    - generic [ref=f4e42]:
      - navigation "角色聊天页内目录" [ref=f4e43]:
        - generic [ref=f4e44]:
          - generic [ref=f4e45]: 游玩
          - button "开始对话" [ref=f4e46] [cursor=pointer]
          - button "关系与记忆" [ref=f4e47] [cursor=pointer]
          - button "会话与分支" [ref=f4e48] [cursor=pointer]
      - generic [ref=f4e50]:
        - complementary [ref=f4e51]:
          - strong [ref=f4e55]: 角色互动发布
          - paragraph [ref=f4e56]: 新会话只从统一生产 Harness 发布的当前不可变 ProductRelease 启动。
          - article [ref=f4e58]:
            - strong [ref=f4e59]: NW-2C chat 新版世界
            - generic [ref=f4e60]: Product Release v1 · 1 角色 · 1 场景
            - button "新建会话" [ref=f4e61] [cursor=pointer]
          - generic [ref=f4e63]: 互动存档
        - main [ref=f4e64]:
          - generic [ref=f4e66]:
            - heading "选择正式发布开始" [level=2] [ref=f4e69]
            - paragraph [ref=f4e70]: 消息、知识、记忆、关系变化与 Harness 回执都属于同一角色互动实例，可刷新、检查点、分支和重放。
```