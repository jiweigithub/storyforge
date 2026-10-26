# NW · 磁盘恢复与旧验证副本归档准备

当前代码、共享依赖以及正在排队的 r11 性能诊断和 r13 完整验证保留。以下十个旧验证副本已经结束，未发现以其为工作目录的活动进程；暂存区均为空。应用归档会保留可恢复 Git 快照，不手动删除检出目录。

| 旧副本 | 当前占用 MiB |
|---|---:|
| nw1b-verification | 775.8 |
| nw2e-verification | 433.8 |
| nw2e-verification-r4 | 468.5 |
| nw2e-verification-r5 | 469.2 |
| nw2e-verification-r6 | 477.5 |
| nw2e-verification-r7 | 854.4 |
| nw2e-verification-r8 | 888.3 |
| nw2e-verification-r9 | 600.6 |
| nw2e-verification-r10 | 623.1 |
| nw2e-verification-r12 | 627.8 |

合计约 6.1 GiB；实际可回收量须在归档后复核。三份历史浏览器测试证据压缩包已逐字节核对 hash。忽略文件仅为可重建的构建输出、TypeScript 缓存及指向保留目录的依赖链接。

应用曾拒绝归档并返回 `This worktree is protected by a pinned task or workspace.`；当前本任务确实置顶第一。因此需要作者明确授权临时取消本任务置顶，使用应用归档上述副本后，再恢复原置顶位置。尚未修改置顶、未执行归档。

浏览器启动门槛保持至少 5 GiB 可用空间。新主线整合副本预计约 630 MiB；最新主线较公共基线新增 12 个提交，五处重叠中的三个代码文件可三方合并，两处生成文档须在整合后重新生成。现有冻结验证和旧评分不改写。

[结构化计划与证据](./verification-archive-plan-20261016-v1.json)
