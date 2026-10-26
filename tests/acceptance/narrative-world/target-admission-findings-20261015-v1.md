# NW-1C · 业务状态与注释更新的准入核对

2026-10-15。生产仍为工程 v28 / 基线 v36；本次不修改生产实现、不增加模型调用，也不把历史失败改记为成功。

上轮真实模型案例将伏笔业务状态设成“计划中”，却要求其中一条发展成为已兑现。当前领域合同明确禁止这种组合。原始模型响应已经给出正确的两条稳定身份和原文引文；拒绝来自业务准入，与身份交接失败是不同问题。

## 现有作者流程

作者在既有伏笔页中确认正文确已埋入内容后，显式把对应记录改为“已埋设”。这不是把所有发展都宣布为完成：同一记录里的不同发展仍可分别保留“未展开的意图”和“有证据的已兑现目标”。状态变动使旧注释候选过期；需要按新的来源状态准备、审核并采纳新候选。模型的注释候选无权修改伏笔业务状态。

| 入口或边界 | 当前实现证据 | 本次实际验证 |
|---|---|---|
| 作者推进伏笔状态 | `ForeshadowPanel/ForeshadowKanban → useForeshadowStore.updateStatus` | 在隔离数据中调用现有作者 store，planned → planted |
| planned 不能冒充已发生 | `narrative-domain-projection` 的 development 状态/模态门 | 两份未改动的原始响应均被拒绝 |
| 旧候选失效 | `assertNarrativeCandidateBaselineV1` | 作者改状态后原基线被拒绝 |
| 新候选只写登记注释 | `prepare/compileNarrativeAnnotationProposalV1` 与正式 durable Harness | 两份原始响应均可生成可审核候选；注入业务 status 写入仍被拒绝 |
| 显式采纳 | `adoptNarrativeAnnotationCandidateV1` | 两份均在模拟确认后写入对应子记录；parent status 保持 planted |

## 证据边界

离线复演保留旧响应的原字节、6 个原文字段及稳定身份，仅在独立 fake IndexedDB 夹具中显式改变业务状态。候选生成使用清楚标为 fixture 的回放函数，真实新增模型调用为 0。它证明现有状态操作、stale 和注释采纳能连通；不是新的真实模型正例、原生浏览器验收或作者认可。

[原始失败](./target-state-story-eval-20261015-v1.json)继续保留为失败，[逐响应诊断](./target-state-story-diagnostic-20261015-v1.json)保持不变。[本次回执](./target-admission-diagnostic-20261015-v1.json)及[完整离线输出](./raw/nw1c-target-admission-20261015-v1/replay-v1.json)单独保存。后续新评测应在调用前检查夹具业务状态和目标是否相容，不能通过改写旧材料或重复调用来填补旧案例。
