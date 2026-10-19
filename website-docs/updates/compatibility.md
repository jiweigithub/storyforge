# 版本、升级与数据兼容

## 当前文档描述哪个版本

本轮增量核对至 **2026-10-18，main 基线 9cc1f4cf**；从上次成功维护基线 `404ee3bf` 核对用户可见变化。产品状态以各自指南标记为准。

当前源码 package 版本为 **4.0.2**；[最新发行页](https://github.com/yuanbw2025/storyforge/releases/latest)列出实际可下载的固定附件。4.0.2 增加 Windows、Mac 和 Android 安装包、应用内更新及统一用户协议，见[安装说明](/getting-started/install)。v4.0.1 构建包含主动故障反馈，以及 [PR #119](https://github.com/yuanbw2025/storyforge/pull/119) 的文字冒险恢复、保图修订和独立网页导出；操作与捕获限制见[故障排查](/guides/troubleshooting#下载版的问题与故障反馈)。

v4.0.2 于 2026-10-16 正式发布，固定源码 `04de86d7`。发行页提供 Windows EXE、Mac Apple Silicon/Intel DMG、Android APK，以及 Windows/Mac/Linux 四平台便携 ZIP 和 `SHA256SUMS.txt`。应用内问题与建议提交到维护者私有收件箱；网页备用表单创建公开 Issue，详见[故障排查](/guides/troubleshooting#下载版的问题与故障反馈)。

历史 [v4.0.0 正式发布](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.0)于 2026-10-13，固定在 `78416965`，不包含上述后续改动。排查问题时一起提供版本、构建 commit、访问地址和日期。

在线站点可能有部署时差；[固定 Releases](https://github.com/yuanbw2025/storyforge/releases)不会自动包含后续 main 功能。

[PR #158](https://github.com/yuanbw2025/storyforge/pull/158) 的大纲候选采纳修复晚于 v4.0.1 固定源码 `e8ce0a0d`，已包含在 4.0.2 客户端源码中。正式可下载状态以发行页为准；其他待合并开发见[开发记录](/updates/development-status)。

## 升级前

1. 在原环境导出完整 JSON，并另存重要正文。
2. 保留原始文件；使用硬盘工作区时完成一次明确的差异检查与同步。
3. 阅读更新日志中的数据兼容说明。
4. 更新后核对作品、章节、素材与保存结果。

本地源码没有个人改动时，可以按 Git 提示更新源码，再运行 `npm ci` 与 `npm run dev`。有本地改动时先保留并处理冲突，不要用强制覆盖命令升级。

## 旧备份不是一律可导入

当前备份校验只接受支持的当前格式。数据库版本迁移与外部备份导入是两条不同路径；支持某些数据库迁移不意味着任意旧 JSON 都能导入。

旧文件被拒绝时：

- 保留原始备份和仍可打开它的原环境。
- 记录版本与错误文本。
- 若原环境能读取，另行导出正文，防止只剩一个格式。
- 提交[反馈](/feedback/bug)，等待有证据的兼容方案。

不要手改备份版本号、删除校验字段或清空原浏览器数据库来绕过错误。

## 回退

回退源码或打开旧 Release 不保证旧程序能读取新数据。更新前保留的原版备份和独立环境是恢复依据。

继续阅读：[备份与恢复](/guides/backup-restore) · [更新日志](/updates/changelog)。

分支中已有实现、进入远程主干、官网部署成功是三个状态。[待合并开发记录](/updates/development-status)单独说明尚未交付的内容；知识库维护日期不是产品发布日期。
