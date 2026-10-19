# 2026-10-19 仓库核对与本地整理

本记录的检查基线为 `codex/webui-phase1` 上的 `7303c673177eed648438e51832b90406382da177`。以下数字描述本次整理前的快照；后续维护提交不回写原快照。此次处理仓库布局、恢复能力和同步边界，不重新验收产品功能。

## 本地与 GitHub

| 对象 | 已核实状态 |
| --- | --- |
| GitHub | [Ricardo121380/only-my-pi](https://github.com/Ricardo121380/only-my-pi)，PUBLIC |
| 最后远程推送 | 2026-09-14 22:16:47，Asia/Shanghai |
| 远程 main | `e6e3c6aa5a3dcffcc8aef6a87f160416ac96ef50` |
| 当前开发分支 | 远程不存在 `codex/webui-phase1`，本地未配置 upstream |
| 图上的提交差距 | 当前开发分支独有 126；远程 main 独有 1 |
| 差距解释 | 远程独有 merge commit 与共同基线 `573ea9e1b844c27e19bbb4561ca902523a54bd23` 的 tree 都是 `b13cb69a58bc914c3493added74a261ee2023972`，无额外文件变化 |
| 未提交工作 | 34 个 tracked 修改、124 个 untracked 文件；暂存区为空 |
| Open PR | 0 |
| 最近远程 CI | [run 34854582028](https://github.com/Ricardo121380/only-my-pi/actions/runs/34854582028)，2026-09-14，FAILURE；Node 22 lane success、Node 24 lane 的 Subagents v2 Preview step failure |
| 基线 HEAD 的远程 CI | 没有运行记录；未用旧 CI 或历史本地 PASS 代替 |

## 本地已执行操作

- 建立全部 Git refs 的 bundle，另存未提交文件、binary diff、index、refs、worktree 列表以及 1,778 个文件的内容/权限清单。在独立 clone 用 bundle 和未提交文件副本恢复，1,778 项核对一致。
- 将 19 个已被远程 main 和当前 HEAD 吸收的本地分支，保存在 `refs/archive/2026-10-19/heads/` 后移出日常分支列表；原 branch reflog 另有本地副本。
- 将本地 main 从 `44e69f599cffe02ce39147cbdcb568c4ea13561a` 沿已核实祖先链推进到远程 main；原 tip 同样归档。
- 保留 `codex/webui-phase1`、`main` 和 `codex/preview-0.3-protected-evidence`。后者包含独有提交 `c4af7fd0dbe748b9b5cbab0db222935116dcc12d`，未归入已合并分支。
- 备份并移除唯一指向不存在临时目录的 worktree 登记 `omp-m2-candidate-ed319a0`；其提交 `ed319a0e8e3a076f956f721a133a692f56ad6cd0` 保存在归档 ref 和已验证 bundle 中。其余主仓库及 30 个 linked worktree 保留，原 linked worktree 的双向指针均有效。
- 三份根目录 `OMP-*.md` 分析报告移入外层 `reports/`，原文、权限和同目录引用保留；增加工作区、报告、artifacts 和私有归档入口。
- 将 158 个已有改动分为下列九组，逐文件清单保存在本地整理回执内。本次不将这些历史实现批量认定为已验收内容。

| 保留组 | tracked 修改 | untracked | 合计 |
| --- | ---: | ---: | ---: |
| Parser / native G2 材料与工具 | 0 | 76 | 76 |
| U0/U1 历史探针 | 0 | 24 | 24 |
| G2 工单草稿 | 0 | 7 | 7 |
| WebUI conversation / draft / input / progress | 8 | 11 | 19 |
| Shell / workspace policy | 2 | 2 | 4 |
| Public Web / runtime patch consistency | 4 | 3 | 7 |
| Host / ownership / lifecycle 测试 | 13 | 1 | 14 |
| Packaging inventory / closure | 3 | 0 | 3 |
| CI / TypeScript dependency | 4 | 0 | 4 |
| **合计** | **34** | **124** | **158** |

工作树的 `workspace.mjs` 新引用 untracked `shell-policy.mjs`；工作树的 `App.tsx` 新引用五个 untracked UI 模块。它们形成提交完整性约束，不能只提交已跟踪文件。对基线 HEAD 的静态检索未发现指向这 124 个目标的直接可执行 import / manifest 路径；这不覆盖动态路径或实际构建。

## 公开同步的未完成条件

当前尚未推送。新增可达历史有 126 commits、795 trees、1,304 blobs；最大 blob 为 422,210 bytes，没有新增大于等于 1 MiB 的 blob。文件名与已知密钥模式扫描未发现真实密钥的明确证据，但历史中有本机 home/temp 路径和 Bearer 模式命中；部分 Bearer 命中来自受控测试夹具。轻量正则检查不等于完整敏感信息审查。

主代理另对当前 HEAD 的 1,654 个 tracked 文件执行同类只读模式检查：只有 `docs/compatibility/2026-10-18-pi-1.3.0-private-candidate-acceptance.json` 中 72 处本机 home 路径命中；当前版本没有上述 Bearer 模式命中。历史与当前文件的检查范围不同，不能用后者覆盖旧提交中的发现。扫描回执仅保存文件、行号与规则，不输出匹配值。

当前已提交 workflow 对普通开发分支 push 不触发 CI 或发布。面向 main 的 PR 触发相应检查；发布流程另有手动入口。未修改 workflow、未启动 Actions、未建立 PR、未合并 main、未变更远程分支或 Issue。

后续需要确定公开同步方式：保留原历史的分支会上传历史中的全部可达内容；另建脱敏同步分支需要保留原本地历史和源码身份映射。单在最新提交删除本机信息不会删除旧提交里的内容。提交 158 个已有改动也需要按上述依赖组审阅与验证，不能借整理一次性混入。

## 容量与验证边界

整理前主 repo 约 0.45 GiB、artifacts 约 129.74 GiB、archives 约 1.19 GiB。前三级 artifacts 占用分别是 webui-optimization 37.34 GiB、#21 GIR 23.42 GiB、#77 候选 21.49 GiB。本次未删除这些材料，也不把 `du` 统计当作实际可回收空间。

此次验证聚焦恢复、文件保全、引用、Git 引用关系及最终 diff。产品代码和已有测试未改动，不为目录整理重复运行完整产品验收；历史失败与各项 NOT_RUN / PARTIAL 范围保留。恢复点仍在本机同一磁盘，异地副本与 GitHub 同步尚未完成。

`node --test tests/docs-links.test.mjs`：2/2 PASS。新增工作区入口、维护文档及其入口文件合计检查 95 个本地链接，未发现缺失目标；`git diff --check` 通过。除明确新增/修改的维护文档外，原有文件的内容与权限核对一致。
