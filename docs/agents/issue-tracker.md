# Issue tracker: GitHub

本项目选定的任务与规格平台是 [Ricardo121380/only-my-pi 的 GitHub Issues](https://github.com/Ricardo121380/only-my-pi/issues)。使用现有认证的 `gh` CLI，显式指定 `--repo Ricardo121380/only-my-pi`。

## 既有任务的过渡规则

配置完成时，既有 WebUI 任务尚未迁移为 GitHub Issues。处理既有任务前读取：

- [完整优化计划](../plans/2026-09-26-webui-optimization-plan.md)：范围、已确认决策及批次顺序。
- [Task 看板](../plans/2026-09-26-webui-optimization-tasks.md)：既有任务编号、状态、依赖和当前具体下一步。
- [验收矩阵](../plans/2026-09-26-webui-optimization-acceptance.md)：必需门禁和证据层次；再读取目标任务链接的实际进展与验收记录。

沿用 `S0-??`、`U?-??`、`G2-00-??` 等已有编号。开发计划、ADR 和验收证据继续保存在仓库；GitHub Issue 关联这些文件，而不是另造一套决策或证据。

迁移必须是明确请求的工作：逐项检查已有 Issue，建立 Task ID → Issue 的映射，保留既有依赖和验收状态。已迁移任务以对应 Issue 跟踪工作状态，看板保留映射及批次汇总；尚未迁移任务仍按原看板定位。已验收条目保留为历史证据，不重新生成未完成任务。记录冲突时核对相应源码、日期、范围和原始证据后再修正。

## Issue 内容与操作

新规格或任务应包含：问题与目标、范围、完成条件、前置依赖、验证要求，以及有关计划、ADR、Task ID 和证据的链接。创建前搜索已有条目。

- 创建：`gh issue create --repo Ricardo121380/only-my-pi --title "<title>" --body-file <body-file>`。
- 读取：`gh issue view <number> --repo Ricardo121380/only-my-pi --comments`；需要结构化数据时使用 `--json number,title,body,labels,assignees,comments,url,state`。
- 列表：`gh issue list --repo Ricardo121380/only-my-pi --state open --json number,title,labels,assignees,url`；按任务筛选并取得所需分页。
- 评论：`gh issue comment <number> --repo Ricardo121380/only-my-pi --body-file <body-file>`。
- 标签：`gh issue edit <number> --repo Ricardo121380/only-my-pi --add-label "<label>"` / `--remove-label "<label>"`；名称取自 [triage-labels.md](triage-labels.md)。
- 关闭：`gh issue close <number> --repo Ricardo121380/only-my-pi --comment "<reason and evidence>"`；先核对该条目的完成条件和必需门禁。

多行正文写入临时 UTF-8 文件后使用 `--body-file`。公开正文只包含本次获准发布的必要信息和脱敏证据。上述操作遵守当前任务授权；保存本配置不自动创建、评论、标记或关闭远程条目。

## When a skill says "publish to the issue tracker"

创建 GitHub Issue，使用上述内容约定；发布范围由调用该 Skill 的当前请求决定。

## When a skill says "fetch the relevant ticket"

读取对应 GitHub Issue 及相关评论、标签、依赖和仓库文档。GitHub Issues 与 PR 共用编号；裸 `#number` 先用 `gh pr view` 确认是否为 PR，再回退到 `gh issue view`。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

使用 `wayfinder` 时，map 是带 `wayfinder:map` 标签的单个 Issue；子任务使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task` 标签。

- 子任务优先用 GitHub sub-issues 关联 map；不可用时，在 map 中保存任务列表，子任务正文写 `Part of #<map>`。
- 阻断关系优先使用 GitHub 原生 issue dependencies；不可用时，子任务正文写 `Blocked by: #<number>, #<number>`。所有前置关闭后才解除阻断。
- Frontier：按 map 顺序查找尚未关闭、无未完成前置且尚未认领的子任务。
- Claim：在获准执行该工作时，用 `gh issue edit <number> --repo Ricardo121380/only-my-pi --add-assignee @me` 认领。
- Resolve：补充答案及证据，满足完成条件后关闭，并在 map 的 Decisions-so-far 中追加结论与链接。
