# 仓库布局与同步

本目录记录源码仓库的维护方式。产品方向、功能范围和验收仍以[开发入口](../README.md)、具体 Issue 及其源代码绑定证据为准。最近的整理快照见 [2026-10-19 仓库核对](2026-10-19-repository-audit.md)。

积压开发的公开副本、历史验收适用范围和私有材料回放限制见 [2026-10-19 公开源码同步候选](2026-10-19-public-source-projection.md)。

## 找到需要的文件

| 位置 | 内容 |
| --- | --- |
| `bin/`、`packages/`、`extensions/` | 命令入口、实现模块和 Pi 扩展 |
| `webui/` | 本机 WebUI 源码与交互测试 |
| `tests/`、`scripts/`、`verification/` | 回归测试、构建/验证工具、门禁清单与适用回执 |
| `contracts/`、`schemas/`、`inventory/` | 版本合同、数据格式和资源登记 |
| `agents/`、`modes/`、`workflows/`、`workflows-v2/`、`swarm/`、`ultra/` | 声明式产品资源与执行合同 |
| `profiles/`、`policies/`、`presets/`、`bundles/` | 组合选择、策略与分发资源 |
| `overlays/`、`prompts/`、`themes/`、`skills/` | 扩展配置及产品资源 |
| `distribution/` | 安装分发输入与平台合同 |
| `docs/plans/` | 当前蓝图、规格、任务映射及按日期保留的计划/验收记录 |
| `docs/decisions/`、`docs/architecture/`、`CONTEXT.md` | 领域词汇、决策及架构 |
| `docs/compatibility/`、`docs/evidence/` | 版本验收和证据定位 |
| `docs/research/`、`docs/design/`、`docs/releases/` | 研究、设计材料及历史发行说明 |
| `docs/agents/` | 本仓库的任务与领域文档约定 |
| `codex/` | 开发工具使用的执行合同 |

当前根目录布局由现有包、合同和验证工具共同使用。整理导航不改变导入路径、npm package files、资源身份或候选回执。历史记录按日期、source 和候选读取；新结论写入新记录并链接前序证据。

## 工作区外层

本地工作区将主源码放在 `repo/`，外层 `reports/` 保存分析报告，`artifacts/` 保存候选与验证工作树，`archives/` 保存私有历史材料。外层的工作区 README 和 artifacts README 提供本地入口；这些材料不是 GitHub 仓库文件。

忽略目录也可能含必要证据。例如 `tmp/` 中可能保留基线或回执，而 `node_modules/` 是本机安装树。是否移除由实际内容、活动使用情况、可重建性和任务授权决定。

## 每个独立工作批次的收口

1. 开始时记录 HEAD、分支、暂存区和已有改动；需要移动或归档时先建立恢复点。
2. 按功能和依赖确定提交文件。实现引用的新模块、相应测试、manifest 与 lock 的配套修改应保持完整；历史草稿、材料候选和已验收运行能力分别记录。
3. 完成该批需要的检查，核对暂存 diff，只提交本批增量。共享文件中已有但不属于本批的修改继续保留。
4. 任务涉及 GitHub 同步时，核对当前远程分支和待上传的整个可达历史。检查源码、文档、fixtures 中的凭据与本机信息；只检查工作树最新版本不足以覆盖旧提交。
5. 授权覆盖目标远程与分支后，用明确 refspec 推送开发分支，并从远端独立回读 SHA。保留本地记录直到远端身份已确认。不要依赖 `--all`、`--mirror` 或强制推送来处理积压。
6. PR、远程 CI、合入 main 和产品发布分别记录。当前 workflow 只在 main push 或面向 main 的 PR 等事件触发相应检查；开发分支推送成功不等于 CI 通过。

本次检查发现的历史差距说明应在每个已完成且获准同步的批次收口时处理同步状态。没有同步时，明确记录未推提交数、原因和恢复点，避免只在本地长期累积。这是人工收口方式，不会创建后台自动推送或自动发布任务。

## 历史分支与恢复

仅在分支已被目标历史吸收、没有活动 worktree 使用、独有证据已核对且恢复点完整时整理本地分支。保留 `refs/archive/<date>/heads/<original-name>` 可在减少日常分支列表的同时保留原 tip。恢复一个分支可使用：

```sh
git branch <original-name> refs/archive/<date>/heads/<original-name>
```

2026-10-19 的归档前缀为 `refs/archive/2026-10-19/heads/`；`git for-each-ref refs/archive/2026-10-19/` 可列出实际引用。远程分支需要单独核对并按已授权范围处理。含独有提交的保护证据分支继续保留。

Git bundle 保存提交图，未提交文件副本和基线 manifest 保存工作树。两者应在独立目录实际恢复核对。仅在同一磁盘保存这些文件不能替代异地备份。
