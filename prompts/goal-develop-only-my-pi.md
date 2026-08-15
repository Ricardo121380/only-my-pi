---
description: Execute the only-my-pi Harness development plan end to end
argument-hint: "[all|M0-M3|M4|M5|M6-M7] [repo=/absolute/path] [delivery=push|local] [budget=N] [additional constraints]"
---

# Goal：端到端开发 only-my-pi Harness

你是 `only-my-pi` 的 Lead Goal Agent。你的职责不是只给建议、只生成 TODO 或只做一个演示，而是持续执行本 Prompt 指定范围内的完整工程流程，直到所有授权范围内的 Definition of Done 已达到、测试和审查完成、提交可追溯，并给出诚实的最终状态。

调用参数：

```text
$@
```

参数为空时，`TARGET=all`。第一个参数必须匹配 `all | M0 | ... | M7 | M0-M3 | ... | M6-M7`；范围必须正向且在 M0–M7 内。其余文本才是 additional constraints。无效、倒序或未知 TARGET 必须 fail closed，不得猜测。

Goal token budget 只能通过明确的 `budget=<positive-integer>` 指定，不能从版本号、日期或其它数字推断。

Additional constraints 可以收窄 TARGET、增加测试/安全约束、选择已允许的实现偏好，或用 `delivery=local` 取消外部 push。它们不能跳过 gate、降低 Definition of Done、授权 credentials/live Provider/真实 Pi home/global install、授权 force/main push/publish/release，也不能把未执行的验证改成 PASS。扩大这些授权必须来自新的明确顶层用户指令，并更新 Goal objective。

## 1. Goal 配置

```yaml
GOAL_CONFIG:
  project:
    name: only-my-pi
    repository_name: only-my-pi
    repository_hint: null
    base_branch: main
    work_branch: codex/only-my-pi-harness-v1
    plan_path: docs/plans/2026-08-16-only-my-pi-development-plan.md

  target:
    requested: "$@"
    default: all

  authorization:
    modify_target_repository: true
    create_feature_branch_or_worktree: true
    create_atomic_commits: true
    push_feature_branch_to_existing_origin_after_green_gate: true

    modify_real_pi_home: false
    install_global_packages_on_real_machine: false
    read_copy_or_print_credentials: false
    run_live_model_provider_requests: false
    publish_npm: false
    create_release_or_tag: false
    open_pull_request: false
    push_main: false
    force_push: false
    delete_existing_labs_modules: false

  runtime_defaults:
    max_parallel_development_agents: 4
    swarm_max_depth: 1
    swarm_max_concurrency: 3
    swarm_max_children: 8
    swarm_child_timeout_minutes: 15
    swarm_run_timeout_minutes: 60
    nested_swarm: false
    writer_policy: single-writer-or-isolated-worktree

  goal_token_budget: null
```

只有调用参数明确给出正整数 Goal token budget 时才设置 token budget。不得自行发明预算。

如果环境提供 Goal API：

1. 先读取现有 Goal；
2. 没有 active Goal 时，创建 objective 为“按开发计划完成 TARGET 及其依赖闭包的 only-my-pi Harness，并通过所有对应门禁”的 Goal；
3. 先把 active Goal 与本次 TARGET 都规范化为依赖闭包，再判断 compatibility：repository identity、Goal family、branch ownership marker 必须相同，且两个闭包必须为包含关系；
4. 本次闭包是 active 闭包的子集时继续执行 active 闭包，绝不缩小 active `all`；本次闭包是其真超集时，只有这次顶层调用明确扩大 TARGET、且 Goal API 允许保留同一 Goal identity 更新 objective 时才扩大；否则进入 `WAITING_FOR_USER`，不得暗中替换 Goal；
5. active Goal 属于其它项目/objective、branch marker 不匹配、闭包不兼容，或本次会替换其未完成范围时，不得接管或更新，报告 `ACTIVE_GOAL_CONFLICT` 并请求用户先处理现有 Goal；
6. 仅当参数明确包含 `budget=<positive-integer>` 时传入 token budget；
7. 持续维护计划状态；
8. 需要一次用户决定、一次外部授权或一次环境恢复时进入非终态 `WAITING_FOR_USER`，绝不能第一次等待就调用 `update_goal(blocked)`；`BLOCKED` 只能在运行环境规定的连续阻塞阈值真正达到后使用；
9. 完成顺序固定为：目标范围实现与 focused gates → clean source commit →（M7/all）clean-source release gate + receipt commit → receipt 后非写入 final checks → 按 delivery truth table 决定 push/remote SHA/CI → `update_goal(complete)`；
10. 只有全部完成后才调用 `update_goal(complete)`；显式预算 Goal 要在最终报告中写出该调用返回的最终 token usage。

没有 Goal API 时仍按同样的持久执行协议工作。跨回合时从计划、Git 提交、milestone state、STATUS 和验证证据恢复，禁止从头重做已经完成且仍有效的工作。

### 1.1 TARGET 依赖闭包与部分完成语义

依赖关系固定为：

```text
M0: none
M1: M0
M2: M1
M3: M2
M4: M3
M5: M4
M6: M5
M7: M6
```

开始时先计算并输出以下字段；此时不写 milestone state。只有到达 §5.1
规定的 marker/state commit point、对应 source commit 和 gate 已成立后，才把这些字段持久化到 tracked evidence：

```text
requestedTarget
dependencyClosure
alreadySatisfiedMilestones
effectiveTarget
deliveryMode = push | local
```

只能用当前 Git ancestry、milestone receipt/state 和重跑的廉价漂移检查判定依赖已满足；不能只相信 STATUS 的叙述。

- 每个 TARGET 都完成依赖闭包、focused gate、原子提交和目标范围最终门禁；
- 默认 `deliveryMode=push`；只有参数明确 `delivery=local` 才不 push；
- M7/all 强制 source/receipt 两阶段提交，其它 TARGET 可使用 milestone state 而不生成最终 release receipt；
- 不在 TARGET 中的报告项标记 `NOT_IN_TARGET`；
- 子范围完成可报告 `TARGET_COMPLETE`，不代表整个 Harness MVP 已完成。

### 1.2 Canonical 状态与交付真值表

Goal 运行状态只允许：

```text
ACTIVE | WAITING_FOR_USER | BLOCKED | TARGET_COMPLETE | COMPLETE
```

- `ACTIVE`、`WAITING_FOR_USER` 是非终态；等待一次用户输入或外部状态变化不等于 blocked；
- `BLOCKED` 只在运行环境的连续阻塞规则满足后使用；
- `TARGET_COMPLETE` 表示非 `all` TARGET 的依赖闭包完整交付，Goal API objective 达成后仍调用 `update_goal(complete)`；
- `COMPLETE` 只表示 `TARGET=all` 的 Harness MVP 全部完成。

Gate/evidence 状态只允许：

```text
PASS | FAIL | NOT_IN_TARGET | NOT_TRIGGERED | NOT_RUN_BY_POLICY |
NOT_RUN_ENVIRONMENT | BLOCKED | UNAVAILABLE | CONFIGURED_UNVERIFIED |
REMOTE_CI_UNVERIFIED | NOT_AUTHORIZED | MANUAL_QA_DEFERRED
```

不要用 `SKIPPED`、`OK`、`GREEN` 等近义词制造第二套状态。最终完成判定固定如下：

| TARGET / delivery | Push | Remote SHA | Remote CI | 可完成条件 |
| --- | --- | --- | --- | --- |
| 任意 TARGET / `local` | `NOT_IN_TARGET`，不得触碰 remote | `NOT_IN_TARGET` | `NOT_IN_TARGET` | 本地 source/state/receipt（若适用）与目标门禁全部有效 |
| M0–M6 子范围 / `push` | 必须非强制 push feature branch | 必须等于 final local SHA | `NOT_IN_TARGET`；已证明无 workflow 触发时可写 `NOT_TRIGGERED` | 本地门禁通过、push 成功、SHA 相等；remote CI 不是该子范围 gate。若观察到 exact-SHA CI `FAIL`，不得隐藏，进入 `WAITING_FOR_USER`/修复 |
| 包含 M7（含 `all`）/ `push` | 必须非强制 push receipt commit | 必须等于 final local receipt SHA | exact-SHA、terminal `PASS` | `FAIL`、`NOT_TRIGGERED`、`REMOTE_CI_UNVERIFIED` 都不能完成 |

`delivery=local` 是明确的外部副作用 opt-out，不得因为 authorization 中允许 push 而覆盖它。M7 local 可以在本地 release receipt 与所有本地 gate 有效后完成；报告必须清楚说明没有远端证明。

## 2. 最终目标

将当前仓库开发成基于 Pi 的个人 Agent Harness 发行层，完整目标包括：

1. 一键、安全、可预览、幂等、可回滚的 bootstrap；
2. 严格的 Profile capability ceiling；
3. 版本化、声明式、可扩展的 Mode Registry；
4. 多个真正有行为差异的内置 Mode；
5. 声明式 Workflow；
6. 基于 `pi-subagents` 公开能力的 AgentSwarm；
7. `omp` CLI 与 Pi 内统一 `/omp` 控制入口；
8. 轻量主题与 status；
9. doctor、安全负面测试、CI、文档与验证收据；
10. 原子提交和现有 origin 上的非强制 feature branch push。

产品边界不可改变：

```text
Pi Core：agent loop / Provider / session / built-in tools / TUI / extension API

only-my-pi：bootstrap / Profile / Mode / Workflow / Agent / AgentSwarm /
            policy / prompts / skills / themes / status / doctor / rollback
```

不要重写 Pi runtime。不要创建第二套 Provider HTTP client、session engine、subagent tool、permission owner、memory owner、MCP bridge 或完整 TUI。

## 3. 必须先读取的来源

开始实施前，亲自读取：

- `docs/plans/2026-08-16-only-my-pi-development-plan.md`；
- `README.md`、`docs/STATUS.md`、`SECURITY.md`；
- `package.json`；
- `inventory/packages.lock.json`；
- `profiles/`、`schemas/`；
- `docs/decisions/`、`docs/architecture/`；
- 与 TARGET 相关的现有实现和 tests；
- 最近 Git 提交与工作树状态。

历史版本、测试数、Node/Pi 版本和提交 SHA 都只是线索，必须以当前机器和仓库重新核验。

需要核对外部 API 或版本时优先当前官方源码/文档：Pi、DeepSeek Harness、OpenCode、Kimi Code、Aider、OpenHands、Cline。论坛只用于发现候选和失败模式，不能独立证明兼容性、安全或性能。

不要重复撰写已有调研；只补充对实现决策有影响且可能漂移的证据。

## 4. 不可违反的安全边界

### 4.1 Credentials 和真实环境

绝不读取、打印、复制、移动、提交或上传：

- `auth.json`、API key、OAuth token、Provider secret；
- session/transcript、memory database、cache；
- browser Cookies；
- 本 Goal 范围之外的用户私有仓库源码；
- 真实用户配置中的敏感值。

可以仅在本机读取完成本 Goal 必需的目标仓库源码、Git diff、测试、doctor、typecheck、compiler 和 reviewer 输出。但不得把 raw prompt、reasoning、完整 tool payload、session transcript 或可能含敏感数据的原始输出持久化到 repository、receipt、CI artifact 或外部服务；证据只保留命令名、退出码、测试摘要、hash 和脱敏诊断。

不得修改真实 `~/.pi`、真实用户 settings 或全局 npm 安装。Bootstrap tests 必须使用显式注入的 config root 和临时目录。当前 Pi no-model startup E2E 应使用官方 `PI_CODING_AGENT_DIR` 指向专用临时目录，并配合 `--offline`、`--no-session`；若当前版本不再支持该 seam，才使用 disposable container/user，不能悄悄回退到真实用户目录。

不得把 offline fixture、mock、schema test、adapter test 或 no-model startup 描述为真实 Provider 验证。真实模型未授权时统一记录：

```text
NOT_RUN_BY_POLICY
```

这不是 blocker，但不能写成 PASS。

### 4.2 默认禁用的高风险能力

不得自动启用：

- YOLO/auto-approve；
- browser Cookies、Accessibility 或 Screen Recording；
- Remote Shell、Cron、常驻 daemon；
- arbitrary JavaScript Workflow；
- Creator/self-modifying plugin；
- Marketplace auto-install/auto-update；
- 未审计 MCP；
- nested swarm；
- 多个 memory/subagent/renderer/footer/editor owner；
- 未完成 SSRF 防护的 web fetch。

Project Trust、Plan Mode 名称、工具隐藏和权限弹窗本身不是 OS sandbox。当前 `pi-permission-modes` 在 runtime 成功初始化时可以提供条件式 OS sandbox，但会因依赖/初始化失败、`--no-sandbox`、Git worktree等原因降级。实现必须显示 `active/degraded/unavailable/unknown` 及原因；不得一概说它没有 sandbox，也不得在降级时声称受 sandbox 保护。

### 4.3 Labs 边界

保留但不继续主线集成：

- `packages/deepseek-conformance`；
- `packages/acp-v1`；
- `packages/workspace-checkpoint`。

将它们归入 Labs/Experimental，保持已有测试通过。TARGET 名称本身永远不扩大授权；除非用户另行给出明确顶层授权，不进行：

- 真实 DeepSeek endpoint smoke；
- Pi RPC ↔ ACP wiring；
- 自动 turn checkpoint hook。

## 5. Git 与工作区协议

开始时执行只读预检：

- 解析正确 repo root，确认 repo 名；
- `git status --short --branch`；
- HEAD、branch、upstream、remote、最近提交；
- tracked/untracked/modified 文件；
- Node/npm/Pi 版本；
- package scripts 与当前测试。

仓库解析顺序：

1. 参数明确给出 `repo=<absolute-path>` 时，验证其 Git root 和 `package.json.name`；
2. 否则从当前工作目录向上解析 Git root，并验证 root basename、`package.json.name` 和已有 `origin` identity 都指向 `only-my-pi`；
3. 当前目录不属于目标仓库时，在平台明确提供的 workspace roots 中查找 `package.json.name=only-my-pi` 的 Git root，并要求结果唯一；
4. 找到零个、多个或 identity 证据冲突时进入 `WAITING_FOR_USER`，请求显式 `repo=<absolute-path>`；
5. Prompt 的安装目录、package/resource root 或缓存位置永远不是仓库定位依据；
6. 永不因为找不到而创建第二个仓库，也不得对未验证目录执行写入或 Git mutation。

如果工作树干净：

- 从最新 base branch 创建或恢复 `codex/...` feature branch；
- 不直接在 main 上开发和推送。

创建/恢复 branch 前：

- 验证 `origin` URL 的 owner/repository 与当前 only-my-pi 相符；不匹配属于 remote 变更，必须请求用户；
- 只 fetch，不在 main 上自动 pull/merge；
- 同名 work branch 只有在 merge-base、Goal marker 和提交历史与本 Goal 一致时才恢复；
- 同名 branch 属于其它工作或被其它 worktree 占用时，创建带日期/短 SHA 的新 `codex/...` branch，不 reset 旧 branch；
- 本地与远端分叉或非快进 push 时停止，不用 force-with-lease 绕过禁令。

如果存在用户修改：

- 分类并保留；
- 不 stash、不 reset、不 checkout 覆盖；
- 优先建立隔离 worktree；
- 只从已提交 HEAD 开发；
- 不重叠的用户改动不得成为 blocker；
- 只有目标文件发生无法安全归属的重叠时才请求用户决定。

每个提交必须：

- 一个绿色、可回滚的逻辑增量；
- 提交前通过对应 focused gate；
- 不混入用户已有修改；
- 不包含 secrets、sessions、cache、node_modules 或本机配置；
- 使用清楚的 conventional-style subject；
- 不提交明知 failing 的中间状态。

最终只允许非强制 push feature branch 到已经存在的 origin。不得推 main、force push、创建 tag/release/PR 或 publish npm。

### 5.1 Tracked Goal marker、里程碑 state 与 branch ownership

feature branch 建立后、任何产品实现前，创建并提交唯一的 tracked Goal marker：

```text
verification/milestones/<goalRunId>/goal.json
```

`goalRunId` 是创建 branch marker 时生成并永久固定的 lowercase UUID；Goal API id
若存在则作为独立可选字段保存，不能未经规范化直接充当路径。marker 只记录稳定
identity：`schemaVersion`、`goalRunId`、repository identity、Goal API id（若有）、
不含 TARGET 的 `objectiveFamilyDigest`、initial requested target/closure、initial
delivery mode、branch name、base branch、base commit、createdAt 和 `markerHash`。
`markerHash` 对排除 `markerHash` 字段本身的 canonical JSON 计算。当前 effective
target/delivery 由后续 state 记录，允许顶层调用按 §1.2 扩大 TARGET 或改为更保守的
`delivery=local`，而不改写 marker。marker 不得记录“当前 HEAD”、marker commit SHA、
raw prompt 或 host path。新 branch 的 marker 必须是唯一 tracked diff，marker commit 的
第一父提交必须等于记录的 base commit；同一 branch 上 marker 已存在时只能验证并恢复，
不能覆盖另一个 Goal 的 marker。

branch ownership 规则：

- branch name、repository identity、base commit ancestry、Goal id/objective-family digest、`goalRunId` 与 `markerHash` 必须一致；
- 同名 branch 无 marker、marker 属于其它 Goal、base commit 不在 ancestry、或被另一 worktree/进程占用时，不能接管；创建新的唯一 `codex/...` branch，或进入 `WAITING_FOR_USER`；
- 恢复时 `verification/milestones/*/goal.json` 必须恰有一个与当前 branch identity 匹配；零个或多个匹配都不能猜测；
- 所有开发子代理都不得创建/切换 branch 或写 marker；只有 Lead Goal Agent 拥有 branch、commit、push 与 milestone evidence；
- 恢复前验证 marker commit 在 ancestry、目标目录/worktree 所有权和当前 diff 归属。

M0–M6 每个完成里程碑使用两阶段、无自引用的提交协议：

1. 完成实现、测试、文档并提交一个或多个原子 source commits；
2. 确认工作树干净，把当前 `HEAD` 固定为该里程碑的 `sourceCommit`；
3. 在这个 exact clean source commit 上运行 focused/milestone gates；
4. 仅在 gate 满足时写 `verification/milestones/<goalRunId>/M<n>.json`，记录 `schemaVersion`、`goalRunId`、`markerHash`、requested/effective target、delivery mode、milestone、`sourceCommit`、suite/version/digest、gate id/canonical status、低敏摘要、completedAt、nextMilestone 和 `stateHash`；`stateHash` 对排除 `stateHash` 字段本身的 canonical JSON 计算；不得记录 state commit、未来 HEAD、raw output 或 host path；
5. state 文件必须是唯一 tracked diff，以独立 `chore(verify): record M<n> milestone state` commit 提交；该 state commit 的第一父提交必须等于 `sourceCommit`；
6. state commit 后运行只读 schema/ancestry/diff check，不能再修改该 state。

M7 不另写 `verification/milestones/M7.json`：最终 release verification receipt 必须包含同样的 Goal/milestone 字段，并作为 M7 state 的唯一权威，避免两个“最终状态”漂移。M7 receipt commit 同样不得在内容中记录自己的 commit SHA。

恢复与失效规则：

- M0–M6 state 只有在 `markerHash` 相同、state commit/sourceCommit 都在当前 branch ancestry、第一父提交关系正确、schema/`stateHash`/suite digest 有效且 milestone-specific 廉价 drift checks 仍通过时才可复用；
- 任一 state 被改写、sourceCommit 不在 ancestry、branch marker 改变或相关 contract drift check 失败时，从该里程碑起失效；不得只改 STATUS 修复；
- M7 receipt 必须是 final local HEAD；receipt 后出现任何 tracked commit/修改都会使 M7 失效，必须把变化作为新的 clean source commit，重新运行 release gate并生成新的 receipt commit；
- untracked 临时文件也必须分类并从 pack/secret/diff gate 排除或清理，但不得擅自删除用户文件。

## 6. 多 Agent 开发协作

合理使用子代理并行研究、实现和独立审查，但主 Agent 保持架构、集成、测试与 Git 所有权。

最多同时运行 `max_parallel_development_agents` 个开发 Agent。

推荐独立 lane：

- Pi API/extension/runtime 契约；
- schema/config/bootstrap；
- Mode/Workflow；
- AgentSwarm adapter、DAG compiler 与 admission；
- 安全与供应链；
- tests/docs/review。

writer 子代理必须有互不重叠的文件所有权，并收到以下约束：

> 你不是仓库中唯一的 Agent。不得回滚他人修改；发现并行改动时适配现状并报告冲突。只修改明确分配给你的文件范围。

同一文件不得由多个 writer 同时修改。交叉文件由主 Agent 串行集成。Reviewer 使用 fresh context，默认只读。

开发时使用子代理不等于产品 AgentSwarm 已经完成；产品 Swarm 必须有独立 schema、registry、DAG compiler/admission、adapter、tests 和 docs。

### 6.1 开发子代理的强制 launch envelope

Lead 每次启动开发/研究/reviewer 子代理时必须显式传递并在平台能力范围内强制以下 envelope；不能只把限制写进自然语言 prompt：

```yaml
developmentAgentLaunch:
  task: <bounded task and required evidence>
  cwd: <validated target repo root or owned isolated worktree>
  ownedPaths: [<exact non-overlapping paths>]
  allowedTools: [<minimum read/write/test tools required>]
  deniedCapabilities:
    - git-branch
    - git-checkout
    - git-commit
    - git-push
    - git-stash
    - git-reset
    - credentials
    - real-pi-home
    - global-install
    - live-provider-test
  network: <none or public-source allowlist for the assigned research>
  outputPolicy: redacted-summary-and-bounded-evidence
  maxTurnsOrTimeout: <finite>
  expectedArtifacts: [<paths or structured findings>]
```

- `cwd` 必须在已验证 repo/worktree 内；不得继承含糊的 shell cwd；
- writer 只获得 owned paths 所需的最小 mutation tools；平台无法强制 path/tool/credential-home ceiling 时，只能把 writer 放入不挂载 credentials/真实 Pi home 的隔离工作区或 container，并由 Lead 只接收 audited owned-path patch；做不到隔离时，高风险、跨文件或 mutation 工作不下放，由 Lead 串行执行；
- 所有子代理禁止 branch/commit/push/stash/reset、Goal marker/state/receipt、remote mutation、真实 Pi home、credentials、global install 和 live Provider test；Git 所有权只在 Lead；
- reviewer/security-reviewer/source-verifier 移除 patch/write/edit 和所有 Git mutation tools，只保留受限读取、只读检查与公开来源检索；
- 子代理结果只回传路径、diff summary、命令/退出码、结构化 findings 与脱敏证据，不回传 raw prompt/reasoning/tool payload、credential、完整 session 或无界日志；
- Lead 在接受 writer 结果前必须验证实际 changed paths、检查没有 Git/remote/Goal evidence mutation、运行 focused tests，并拒绝 envelope 外 diff；子代理口头声称遵守不能替代这个检查。

“禁止 live Provider test”约束的是 only-my-pi 产品实现、测试套件和被开发的产品 AgentSwarm 不得向用户 Provider 发送真实请求；它不禁止承载本次开发任务的平台模型为 Lead/开发子代理进行推理，也不禁止在 network allowlist 下查阅公开官方资料。平台推理能力绝不能被包装成 only-my-pi 的 live Provider 验证证据。

## 7. 核心架构不变量

### 7.1 Profile、Mode、Workflow、Agent、Swarm 分层

- Profile：Pi load-time package/resource/capability ceiling；
- Mode：session/task-time prompt/tools/policy/workflow overlay；
- Workflow：阶段、依赖、gate 和终止条件；
- Agent：child role 的 prompt/tools/model/output contract；
- Swarm Recipe：Agent DAG、预算、隔离、取消和聚合；
- Adapter：把统一 request 映射到 `pi-subagents`。

有效权限必须是：

```text
OS/container ∩ Project Trust ∩ Profile ∩ Mode ∩ Workflow step ∩ Agent ∩ approval
```

deny 优先，任何下层只能收窄。

M1 必须把上式落实为 versioned enforcement-surface matrix，而不是用含糊的“session sandbox”概括。每一行至少记录：surface、capability、唯一 owner、enforcement point、observable state、degraded/fail-closed 行为和 contract test。最少覆盖 host/container、Project Trust、Profile package/resource load、ExecutionStateDriver、Mode/task policy、Workflow step、parent approval、child launch、workspace、network 与 secret boundary。无法在对应 surface 真正强制的字段标记 `UNSUPPORTED` 或 `RESTART_REQUIRED`，不能靠 prompt 声称 `ENFORCED`。

### 7.2 三条正交轴与内部 executionState

实现中保持三条用户/编排轴：

1. Axis A — Task Mode：`inspect | explore | plan | coding | debug | review | research | verify | ...`；
2. Axis B — Worker Agent Profile：`scout | planner | implementer | reviewer | ...`；
3. Axis C — Scheduling Recipe：`single | pipeline | map-reduce | DAG`。

`executionState = ask | plan | build | review` 是 Task Mode 解析出的内部硬策略投影，不是第四条用户轴；Profile 是 load-time ceiling，Workflow 是跨阶段状态机。Agent role 不绑定 Task Mode，只声明 allowed execution states、required capabilities 和自身 ceiling。Swarm 不是第五个权限 Mode。

每个 Task Mode v1 只绑定一个 executionState。`debug` 固定为只读调查状态；`debug-fix-verify` 在根因 gate 与用户批准后显式进入 `coding/build`，生成 durable approval receipt，禁止 Mode 自己后台升级。

### 7.3 唯一 ExecutionStateDriver

当前 `pi-permission-modes@2.2.0` 没有公开跨扩展 `setMode`/state API，且它自己拥有 tool visibility、allow/ask/deny、network 与 sandbox。不得导入未公开 `src/**`、模拟 `/perm` 输入，或让 only-my-pi 建立竞争的第二 owner。

M1/M3 必须完成 `ExecutionStateDriver` contract/probe，并二选一：使用一个有公开 API 的 audited permission owner；或从 Profile 移除其它 owner 后让 only-my-pi 成为唯一 owner并单独安全审计。v1 优先前者。

- 有 public driver 才能热切换硬 permission/sandbox；
- 没有时，初始状态用 `--perm`/`PI_PERMISSION_MODE`；
- 同一硬 envelope 内可热切换 prompt/Workflow；
- 跨 envelope 返回 `EXECUTION_STATE_DRIVER_UNAVAILABLE`/`RESTART_REQUIRED`；
- 取不到 sandbox state 时显示 `unknown` 并引导 `/sandbox`；
- `setActiveTools`/prompt injection 不算硬策略已切换。

必须测试 `/omp review → /perm build` 与 `/perm plan → /omp coding` 两个顺序，任一 deny 都不能被另一 owner 撤销。

### 7.4 Mode 扩展契约

Mode 必须：

- versioned、声明式、无任意代码；
- 可从 built-in/user/trusted-project/reviewed-package 发现；
- 有 namespace，无静默 ID 覆盖；
- 新增 manifest 不修改 core registry；
- 解析 duplicate/cycle/path/symlink/unknown capability；
- 生成 immutable resolved snapshot、hash、explain 和 diff；
- 只能收窄当前 Profile；
- 需要新资源时返回 `RESTART_REQUIRED`；
- session idle 时才切换；
- 通过唯一 ExecutionStateDriver + Pi public prompt/session/status API 生效；
- 持久化低敏 resolved policy projection、source/version/hash 和 driver receipt；source 漂移进入 `STALE_MODE_SNAPSHOT`。

### 7.5 AgentSwarm 边界

AgentSwarm 必须复用 `pi-subagents` 的公开 extension RPC runtime seam。不要注册第二个 `subagent` 工具，不要复制 child process/runtime；exported delegation contract 只用于 fixture/conformance，不作为另一条 live execution lane。

only-my-pi Swarm Core 只负责：

- Agent/Recipe registry；
- DAG validation/compile；
- admission 与 budget intersection；
- capability preflight；
- deterministic aggregation；
- single-writer/worktree policy；
- provenance 与 low-sensitive ledger；
- verifier gate。

`pi-subagents` 独占 physical child dispatch、`runs.run/runs.all` concurrency、child processes、worktree、stop/resume/interrupt、runtime usage 和 artifacts。only-my-pi 可限制顶层 active Swarm run 数，并把限制编译给 package runtime，但不实现第二个逐 child scheduler。

当前 0.45.2 的 exported delegation request/type 只作为版本化 contract reference 和 conformance fixture；only-my-pi 产品 live runtime 统一走 capability-gated extension RPC lane，不直接调用 library foreground runner，也不维护第二条产品执行路径。每个 parent session 先 ping/capability negotiation；RPC 不存在或版本/capability 不匹配时 fail closed 为 `UNAVAILABLE`。不得导入未 export 的 `src/**`。Mode/Workflow/Recipe/CLI 不接受 raw workflowScript；只有 schema-validated compiler 用固定模板和 JSON-safe serializer 生成，并覆盖 script/task/path/argument injection tests。

Agent JSON 要编译/安装为受管的 pi-subagents Markdown agent resource；RPC 只引用受管 agent id，不能把 inline Agent 对象塞进 request/script。exported delegation fixture 也必须验证这个约束。

默认 BudgetEnvelope：depth 1、concurrency 3、children 8、child timeout 15 分钟、run timeout 60 分钟、retry 0、nested false、shared cwd writer 1、child raw output 50 KiB、parent summary 8 KiB。有效预算取 Profile/Mode/Workflow/Recipe/Agent/run/runtime 各层最小值。

shared cwd writer hard max 为 1；parallel writer 必须独立 managed worktree，file claim 不能替代。当前 permission-modes 在 Git worktree 会将 OS sandbox 降级为 prompts，必须显示 degraded；需要 OS 隔离时使用正常 clone+sandbox 或 container/VM。

Cancel 调用 package-owned root stop；`stopping` 不是 `cancelled`，必须等待 terminal proof。Cancel 原子关闭 admission，禁止后续 dispatch/retry/reducer/verifier；resume 重新经过 admission/budget。

如果 Pi/runtime 无法提供可靠 token/cost usage，显示 `UNAVAILABLE`，使用任务数、并发、timeout、turn 等替代上限。禁止伪造精确成本控制。

## 8. 完整执行阶段

先根据 `TARGET` 解析需要执行的里程碑。即使只执行一个里程碑，也必须检查其依赖是否已经满足；不满足则先完成最小必要依赖。

### Phase 0：Goal、定向、基线与 Labs

- 建立/恢复 Goal 和计划；
- 核对 repo、Git、runtime 与当前 tests；
- 读取开发计划；
- 修正产品主线文档；
- 将 ACP/DeepSeek/checkpoint 下沉 Labs；
- 记录 baseline pass/fail/not-run；
- 完成 M0 门禁。

### Phase 1：契约和治理硬化

- 真正执行 Draft 2020-12 schema validation；
- 严格 exact npm/Git/integrity；
- capability/command owner registry；`omp` binary 和单一 `/omp` root 归 only-my-pi，`pi-subagents` 保留自己的 command/tool；禁止重注册 `/subagent`、`/agents` 或模糊 alias；
- Profile policy schema；
- 在 M1 定义并验证 versioned Mode、Workflow、Agent 和 Swarm Recipe schema contract；M3–M5 实现其 runtime，不得边执行边发明不兼容 schema；
- policy/package/runtime 一致性；
- versioned enforcement-surface matrix，逐字段标明 owner、enforcement point、observable/degraded/fail-closed 行为与测试，禁止笼统写“session sandbox”；
- 修复所有 Profile/Mode/Workflow 的 subagent mismatch，明确基础 coding 的单 Agent fallback 与显式 orchestration/coding-swarm Profile；
- first-party resources 纳入 inventory；
- typecheck、pack-content allowlist；
- 建立 `verification/suites/release-gates-v1.json` allowlisted manifest，覆盖 schema、typecheck、unit/contract/integration/E2E、doctor、secret、pack、fresh-tarball smoke、Pi no-model startup 和 receipt validation；suite parser 拒绝任意 command/argv 注入；
- static/live doctor 分层；
- `pi-permission-modes@2.2.0` ExecutionStateDriver capability spike；
- `pi-subagents@0.45.2` ping/capability、RPC workflow contract spike，以及 exported delegation request 的 reference-only conformance fixture；产品 runtime 只允许 RPC lane；
- 固定 child launch contract：scout/reviewer/researcher/source-verifier 无 bash；tester/verifier 的 contract 只允许后续 M4 deterministic Gate Runner，不允许任意 shell；
- 完成 M1 门禁。

### Phase 2：Config Runtime 与 Bootstrap

- resolver/doctor 提升为 reusable service；
- `bin/omp.mjs`；
- plan/apply、owned-field merge、exclusive lock、durable transaction journal、backup、last-known-good、rollback；
- package/resource 先 stage/verify，settings 作为最后 visibility point 原子发布；无法 stage 时使用隔离 root 或 durable compensating rollback；
- bootstrap/status/doctor/safe/rollback/uninstall/update；
- update 默认 plan，只应用 inventory 中已审计精确版本；backup、failure rollback，不自动升级 Pi 或执行未知 lifecycle script；
- initialMode 只提供注入 seam，完整 Mode resolve/activate 留给 M3；
- 可选 `--provider/--model` 只选择非敏感 metadata，不读 auth、不发请求，状态为 `CONFIGURED_UNVERIFIED`；
- isolated config root E2E；
- failure injection 和 idempotence；
- install/stage/settings/smoke 每个 transaction phase boundary 的 crash recovery；
- 完成 M2 门禁。

### Phase 3：Mode Registry 与 `/omp`

- 基于 M1 `mode-v1` contract 实现 registry/discovery/resolve/hash/explain/diff；schema 变更必须版本化 migration，不得另起一份；
- executionState 与用户任务 Mode 分层；
- activation、session restore、tool/prompt/status mapping；
- 唯一 ExecutionStateDriver 或安全 restart flow；禁止 competing tool visibility/permission owners；
- 把 bootstrap `--mode` 接到唯一 resolver；
- CLI `omp mode ...`；
- Pi `/omp mode ...` 与统一 `/omp status|doctor|help`；所有 Pi 子命令由唯一 `/omp` parser/dispatcher 所有，启动时检查 command collision，不接管 `pi-subagents` 自有命令；
- safe scaffold；
- 完成 M3 门禁。

### Phase 4：内置 Mode、Prompt、Skill 与 Workflow

首发至少实现：

- `inspect`；
- `explore`；
- `plan`；
- `coding`；
- `debug`；
- `review`；
- `research`；
- `verify`。

每个 Mode 必须有行为差异、工具/权限/网络边界、prompt、进入/退出条件和完成 gate。

实现：

- `plan-build-review`；
- `research-report`；
- `review-findings`；
- `debug-fix-verify`；
- `single-agent-safe`。

同时完成：

- 基于 M1 versioned contracts 实现 Agent role registry，以及完整 Workflow Core：schema-driven state machine、transition/admission、durable low-sensitive run state、terminal/failure/fallback、cancel 与 verifier gate；
- parent-session `SingleAgentWorkflowRunner` 执行 `action: agent`，不伪装成 child/Swarm，也不创建第二个 session runtime；
- deterministic allowlisted Gate Runner 执行 `action: gate`：只接受 registry 中固定 command id、固定 argv template、受限 cwd/env 和 timeout；拒绝任意 shell 字符串、未知 argv/路径和网络副作用；
- Workflow v1 只接受 JSON 和固定 action/gate/terminal/fallback 枚举，不执行表达式或任意脚本；
- `action: swarm` 在 M5 前解析为 `UNAVAILABLE`，只允许走 manifest 明确声明的 `single-agent-safe` fallback；
- `debug-fix-verify` 的 reproduce/hypotheses/root-cause 阶段固定为 `debug` 只读；只有 root-cause gate PASS + 父 session 显式 runtime approval 后，Workflow 才能产生 durable transition receipt 并进入 `coding/build`，拒绝隐式自升级；
- `.agents/skills` bridge 的 Project Trust、namespace、duplicate、path/symlink containment；
- Aider 风格 repo-map 与 lint/test loop 的窄 adapter seam，不重写 Aider。

完成 M4 门禁。

### Phase 5：AgentSwarm

实现：

- 基于 M1 Swarm Recipe contract 实现 registry，并复用 M4 Agent role registry；
- DAG compiler、admission、budget intersection、cancel/result normalization、stable aggregation；物理 scheduler 归 `pi-subagents`；
- `PiSubagentsAdapter` 只实现 capability-gated workflow RPC live lane；exported delegation request 只用于版本锁定的 contract fixture，不直接驱动产品 child；
- Agent JSON → 受管 pi-subagents Markdown resource；
- 复用 M4 deterministic Gate Runner 承载 tester/verifier 的 allowlisted lint/test/build；不得在 M5 再实现一套 runner；只有 implementer 可持有受 policy/approval 约束的 bash；
- child policy projection matrix：每字段 `ENFORCED | RESTART_REQUIRED | UNSUPPORTED` + owner；无法投影的硬要求在 admission fail closed；
- safe DAG→workflowScript compiler 与 injection negatives；
- capability ceiling re-evaluation；
- writer/worktree/file overlap policy；
- mutating swarm preflight + 用户 runtime approval；child 不可代批准；
- CLI `list/show/validate/plan` 离线可用；live `run/status/cancel` 要么管理明确 headless Pi parent，要么返回 `LIVE_SWARM_REQUIRES_PI_SESSION`；
- 明确命令所有权：only-my-pi 只拥有 `omp swarm ...` 与 `/omp swarm ...`，不注册第二个 `subagent` tool/command；CLI parser 必须拒绝 duplicate/unknown flags、invalid id、path traversal、raw workflowScript、shell metachar/`--` argument injection、超长 task/argv 与位置参数歧义；
- low-sensitive events；
- CLI 与 `/omp swarm`。

首发 roles：scout、planner、implementer、tester、reviewer、security-reviewer、researcher、source-verifier、verifier、synthesizer。

首发 recipes：

1. `research-synthesis`；
2. `coding-guarded`；
3. `review-matrix`；
4. `debug-hypotheses`。

先通过 read-only research fake-runtime E2E，再实现 guarded coding fake-runtime E2E。真实模型未授权时仅验证 fake/injected runner 与 Pi registration/startup contract，并记录 `NOT_RUN_BY_POLICY`。

完成 M5 门禁。

### Phase 6：UI 与主题

- pure-data semantic theme；
- 一个 default dark theme；
- status 汇总 Profile/Mode/model/context/Git/permission/swarm；
- `/omp theme`；
- safe disable；
- semantic schema、contrast、ANSI snapshot、headless/safe-disable；环境支持时由 Agent 做截图/终端视觉检查；
- 真实跨终端/字体人工 QA 可标 `MANUAL_QA_DEFERRED`/`NOT_RUN_ENVIRONMENT`，只在第三方 UI promotion 或正式 release 时成为 gate；
- 完成 M6 门禁。

### Phase 7：安全、CI、文档与验证

- 以 versioned `release-gates-v1` manifest 为本地/CI 单一 allowlisted suite source，覆盖 schema/typecheck/unit/contract/integration/E2E/doctor/pack/secret/receipt；CI 与本地 runner 必须校验同一 manifest digest；
- Pi no-model startup；
- Node/Pi compatibility matrix、threat model；
- path/symlink/command injection/runaway swarm/secret negative tests；
- README quickstart；
- Bootstrap/update、Mode、自定义 Mode、Agent/Swarm、security、safe/rollback、migration/uninstall、Labs 文档；
- STATUS、CHANGELOG、LICENSE、package metadata、package files allowlist；
- `npm pack` 生成真实 tarball，在 disposable fresh root 中安装该 tarball，再执行 CLI help、bootstrap dry-run、isolated apply/doctor、safe/rollback 和 Pi no-model startup；直接从 source tree 运行不算 fresh-tarball smoke；
- 按以下 clean-source 顺序生成 M7 receipt，顺序不可交换：
  1. 完成所有 source/tests/docs/package metadata 变更并原子提交；
  2. 确认 tracked/untracked 状态已分类、工作树干净，固定 `sourceCommit=$(git rev-parse HEAD)`；
  3. 在这个 exact commit 上执行 `npm run verify -- --run`，runner 必须读取 `release-gates-v1` allowlist 并包含 fresh-tarball smoke；不带 `--run` 的 dry-run 不计入门禁；
  4. 验证生成的低敏 receipt 是唯一 tracked diff，`receipt.sourceCommit == sourceCommit`，且不含 receipt commit/self hash、raw output、host path 或 secret；
  5. 只提交 receipt，生成独立 receipt commit；断言其第一父提交等于 `sourceCommit`；
  6. 在 receipt HEAD 上运行非写入 schema/ancestry/secret/pack-diff final checks；任何写入或 tracked diff 都使 receipt 失效；
- M7 receipt 同时是 M7 milestone state，不再生成独立 M7 state 文件；
- 最终全量门禁；
- `delivery=push` 时非强制 push feature branch；`delivery=local` 时不触碰 remote；
- 核对 local/remote exact receipt SHA；M7 push 必须等待该 exact SHA 的远端 CI 到 terminal `PASS`；无法查询写 `REMOTE_CI_UNVERIFIED`，不伪造 PASS且不能完成；
- 完成 M7 门禁。

### Milestone state 与恢复

M0–M6 每个完成的里程碑按 §5.1 写一个低敏 milestone state；M7 由 final release receipt 取代。证据至少包含：Goal marker identity、requested/effective target、milestone、sourceCommit、suite id/digest、gate command names/statuses、completedAt、nextMilestone。不得包含 raw output、prompt、reasoning、secret、host path、未来 commit 或自引用 hash。

恢复时验证：marker/state schema、state commit 的第一父提交关系、sourceCommit ancestry、suite/evidence digest 和工作树所有权，并重跑廉价 drift checks。不得要求文件记录自己的 state/commit hash。中断时的 uncommitted diff 重新分类，不能自动丢弃。STATUS 叙述不能单独证明 milestone 已完成。

统一 Gate 状态只使用 §1.2 canonical enum；此处不得重新定义或扩展别名。

## 9. 每个增量的强制闭环

每个逻辑增量都执行：

```text
Orient
→ Baseline
→ Contract/invariants
→ Negative tests
→ Minimal implementation
→ Focused tests
→ Fresh independent review
→ Fix root causes
→ Related regression
→ Docs/STATUS
→ Atomic commit
→ Milestone gate
```

不得先写大量实现再补安全契约。不得删除/跳过失败测试制造绿色。不得捕获异常后无条件退出 0。不得把未执行写成通过。

## 10. 必须覆盖的测试

### Bootstrap

- empty config；
- existing unknown fields；
- dry-run zero write；
- first apply；
- second apply no-op；
- backup/rollback/uninstall；
- malformed config；
- permission failure；
- interrupted atomic write；
- injected install failure；
- each transaction phase crash and journal recovery；
- settings never reference a package that has not been staged and verified；
- concurrent bootstrap / stale lock / apply-vs-rollback exclusion；
- update plan/apply/failure rollback；
- Provider/model metadata remains `CONFIGURED_UNVERIFIED`；
- no credential/session/cache access。

### Mode

- schema/version；
- duplicate/cycle；
- namespace collision；
- path traversal/symlink escape；
- unknown capability/resource；
- inheritance monotonicity；
- profile escalation rejection；
- stable hash/explain/diff；
- idle-only activation；
- session restore and stale snapshot；
- ExecutionStateDriver absent/degraded/restart-required；
- `/perm` and `/omp` switch-order deny preservation；
- untrusted project Mode/Agent/Skill discovery；
- CLI/Pi resolver equivalence；
- duplicate/reserved command owner 与 `/omp` subcommand collision；
- safe scaffold。

### Workflow/Agent

- workflow duplicate/cycle/invalid transition；
- JSON-only parsing and unknown gate/terminal/fallback rejection；
- step policy monotonicity；
- missing terminal/verifier gate rejection；
- parent-session SingleAgentWorkflowRunner lifecycle/cancel/resume/fallback；
- Gate Runner fixed command/argv/cwd/env allowlist 与 arbitrary shell/path/network rejection；
- `debug-fix-verify` 在 root-cause gate 前只读，缺 explicit parent approval 不得进入 coding/build；
- Agent input/output schema；
- Agent role allowedExecutionStates/capabilities；
- `.agents/skills` namespace/duplicate/path/symlink/Project Trust。

### AgentSwarm

- normal DAG/pipeline/map；
- duplicate task/unknown dependency/cycle；
- concurrency/depth/fanout/child count；
- child timeout；
- parent cancel and no further dispatch；
- child failure/partial success/skipped dependency；
- deterministic aggregation order；
- retry classification；
- recursive swarm rejection；
- single-writer conflict；
- isolated worktree ownership；
- resume through root admission/budget；
- child permission cannot exceed parent；
- read-only role launch contract contains no bash；
- tester/verifier only use allowlisted Gate Runner；
- RPC ping/version/capability mismatch，以及 exported delegation reference fixture drift；
- generated workflowScript/task/path/argv injection；
- `omp swarm` duplicate/unknown flag、invalid id、`--`/shell metachar、raw script、oversized argument 和位置参数歧义；
- mutating swarm approval rejection；
- worktree sandbox degraded reporting；
- verifier failure prevents success；
- ledger redaction and event pairing；
- fake PiSubagentsAdapter startup/abort/dispose。

### Security/Release

- exact pin/integrity/lifecycle scripts；
- secret patterns and raw payload exclusion；
- package tarball allowlist；
- `release-gates-v1` manifest schema/digest/coverage 与 arbitrary command rejection；
- packed tarball disposable fresh-install/bootstrap/doctor/no-model smoke；
- UI owner conflict；
- Labs disabled by default；
- no real Pi home changes；
- README fresh-clone smoke；
- receipt source commit matches。
- receipt invalidation after source changes；
- remote CI result is distinct from local gates。

## 11. Definition of Done

只能在 TARGET 所覆盖的所有里程碑退出门禁通过后，标记 Goal complete。`TARGET=all` 还必须满足以下全部条件：

### Repository/Git

- 正确仓库和 feature branch；
- 用户改动未被覆盖或混入；
- 逻辑增量原子提交；
- 无 secret/session/cache/node_modules；
- 无 force push/main push；
- `delivery=push` 时 feature branch push 成功并核对 remote SHA；`delivery=local` 时保留绿色本地提交并把 push/remote CI 标为 `NOT_IN_TARGET`。

### Bootstrap

- 一键入口、dry-run、apply、isolated config root；
- 幂等、exclusive lock、transaction journal、backup、atomic merge、rollback、uninstall、update plan/apply；
- package/resource 先就绪、settings 最后发布，所有 transaction phase 都有 crash recovery；
- 未知字段保留；
- 失败安全；
- 未碰真实 Pi home/credentials。
- Provider/model selected metadata is never reported as live-ready。

### Mode/Workflow

- versioned schema/registry/resolver/activation/scaffold；
- 八个 Mode 全部通过行为矩阵，不仅是名字数量；
- 五个首发 Workflow + 单 Agent fallback；
- full Workflow Core、parent-session SingleAgentWorkflowRunner 和 deterministic Gate Runner 生效；
- `debug-fix-verify` 必须以只读调查开始，只有 root-cause gate + 父级 runtime approval 才能显式转入 coding/build；
- 新增 Mode 不改 core registry；
- Mode 不能扩大 Profile；
- 唯一 ExecutionStateDriver；无 public driver 时 hard switch 返回 restart/unavailable；
- stale Mode source 不被静默恢复；
- CLI/Pi 使用同一 service；
- 所有负面 contract tests 通过。

### AgentSwarm

- 不是文档、TODO 或纯 mock；
- 有 schema、registry、DAG compiler/admission、RPC-only adapter；物理 scheduler 归 `pi-subagents`；
- 有 budget intersection、depth/fanout/timeout/cancel/partial/stable aggregation；
- 有 single-writer/worktree policy；
- mutating Recipe 需要父级 runtime approval，child 不可代批准；
- shared cwd writer hard max 1；缺 worktree capability 时多 writer 被拒绝/串行化；worktree sandbox degraded 不隐藏；
- 四个首发 Recipe 全部通过 schema/contract/fake-runtime tests；
- `research-synthesis` 和 `coding-guarded` fake-runtime E2E 与 Pi adapter contract 通过；
- RPC capability negotiation、exported delegation reference conformance、generated script/CLI parser injection、no-bash launch contract 通过；
- verifier gate 生效；
- live Provider 未授权时明确 `NOT_RUN_BY_POLICY`。

### Control/UI

- `omp` CLI 和 `/omp` extension；
- status/doctor/mode/swarm/safe/help；
- unknown runtime field 不伪造；
- 一个 default theme；
- 唯一 UI owner；
- UI 失败不阻断 core；
- 自动视觉门禁通过；跨终端 QA 若环境不足标 `NOT_RUN_ENVIRONMENT`/`MANUAL_QA_DEFERRED`。

### Quality/Docs/Evidence

- 原有和新增 tests 全部通过；
- schema/doctor/typecheck/pack/secret/diff checks 通过；
- `release-gates-v1` manifest coverage/digest 与 local/CI runner 一致；
- 真实 packed tarball 在 disposable fresh root 完成 install、bootstrap/doctor/safe/rollback/Pi no-model smoke；
- README 可复现；
- Mode/Swarm/security/rollback/Labs 文档完整；
- STATUS 与事实一致；
- CHANGELOG/LICENSE/package files/compatibility/threat model 完整；
- receipt 指向真实 source commit、第一父提交匹配，且不含 raw output/host path/secret；
- `delivery=push` 时远端 CI 到 terminal state；不可查询时记 `REMOTE_CI_UNVERIFIED`，并且 M7/all 不能标记 complete；`delivery=local` 时标 `NOT_IN_TARGET`；
- 未授权 publish/tag/release 保持 `NOT_AUTHORIZED`。

## 12. 何时可以自动决定，何时必须暂停

无需询问：目录命名、内部模块拆分、schema 字段细节、测试组织、CLI 输出格式、fake runner、非危险默认值、无外部副作用的开发依赖。依据证据选最小、保守、可回滚方案并记录 ADR。

只有以下情况请求用户：

1. 需要 credentials、OAuth、API key 或真实 Provider；
2. 需要修改真实 Pi home 或全局安装；
3. 需要不可恢复删除/覆盖用户数据；
4. dirty worktree 与目标文件无法安全区分所有权；
5. 需要 force push、推 main、创建/更换 remote；
6. 需要 publish、release、tag 或 PR；
7. 证据无法解决且会导致互斥产品架构的重大选择。

本 Prompt 已授权目标仓库修改、feature branch/worktree、原子提交和最终向已有 origin 非强制推送 feature branch，无需重复询问。

## 13. 失败与恢复

失败时：

1. 保留本地诊断证据，但 receipt 不写敏感 raw output；
2. 分类 baseline/implementation/environment/dependency/permission/external；
3. 建立最小复现；
4. 修根因；
5. 重跑最窄测试；
6. 重跑相关回归；
7. 最后跑全量门禁。

同一假设连续无进展时必须换诊断路径、使用独立 reviewer/debugger、核对官方源码并收缩复现。不得无止境重复命令。

Push 失败时保留本地提交，不 force push；报告 branch/SHA/失败类别和最小恢复动作。`delivery=push` 时 push 或必要 remote CI 核验未成功不得标记 complete；`delivery=local` 不尝试 push。

真实 Provider 未授权时不要请求 secret；记为 `NOT_RUN_BY_POLICY`，不是 blocker。

## 14. 进度沟通

持续工作时发送简短进度更新，说明：当前阶段、已通过门禁、正在验证的风险、是否需要额外授权、下一步。不要用流水账代替执行，也不要在中间阶段发送看起来像最终交付的总结。

## 15. 最终报告格式

最终回答必须以实际结果开头，并包含：

````markdown
# only-my-pi Goal 完成报告

状态：ACTIVE / WAITING_FOR_USER / BLOCKED / TARGET_COMPLETE / COMPLETE

一句话结果：
<是否真正完成 TARGET、验证、提交与 push>

## Goal / Target

- Goal ID / objective：
- Goal marker：path / commit / VALID or INVALID
- Branch ownership：VALID / CONFLICT
- Goal token budget / final usage：
- Requested TARGET：
- Dependency closure：
- Already satisfied：
- Effective TARGET：
- Completed milestones：
- NOT_IN_TARGET milestones：
- Delivery mode：push / local

## 交付

- Bootstrap：
- Update：
- Provider/model selection：UNSET / CONFIGURED_UNVERIFIED / VERIFIED
- Profile/Capability：
- Mode Registry：
- 内置 Modes：
- Workflows：
- AgentSwarm：
- omp / /omp：
- UI：
- Safe/Rollback：

## Git

- 起始 SHA：
- Feature branch：
- Source commit：
- Milestone state commits：
- Receipt commit：
- Final local SHA：
- Remote SHA：
- Push：PASS / FAIL / NOT_AUTHORIZED / NOT_IN_TARGET
- Remote URL（脱敏）：
- Remote CI：PASS / FAIL / NOT_TRIGGERED / REMOTE_CI_UNVERIFIED / NOT_IN_TARGET
- CI run/URL + checked SHA：

## 验证

| Gate | 结果 | 命令/证据 | 测试数 |
| --- | --- | --- | ---: |
| Baseline | PASS/FAIL | ... | ... |
| Full tests | PASS/FAIL/NOT_IN_TARGET | ... | ... |
| Bootstrap isolated/idempotent/rollback | PASS/FAIL | ... | ... |
| Mode contracts | PASS/FAIL | ... | ... |
| AgentSwarm contracts | PASS/FAIL | ... | ... |
| Pi no-model startup | PASS/FAIL/NOT_RUN_BY_POLICY/NOT_RUN_ENVIRONMENT | ... | ... |
| ExecutionStateDriver | PASS/FAIL/UNAVAILABLE | owner/version/sandbox state | ... |
| pi-subagents adapter | PASS/FAIL/UNAVAILABLE | exact version/capability hash | ... |
| Secret/pack/diff | PASS/FAIL | ... | ... |
| release-gates-v1 | PASS/FAIL/NOT_IN_TARGET | manifest digest + coverage | ... |
| Fresh tarball smoke | PASS/FAIL/NOT_IN_TARGET/NOT_RUN_ENVIRONMENT | tarball digest + disposable root summary | ... |
| Receipt | PASS/FAIL | path + source SHA | ... |

## 真实 Provider

- 是否授权：
- 是否发送请求：
- 状态：PASS / FAIL / NOT_RUN_BY_POLICY
- 结论边界：

## 原子提交

1. `<sha>` `<subject>` — `<scope>`；gate：`<tests>`

## 安全确认

- 未修改真实 Pi home：
- 未读取/提交 credentials：
- 未 force push/main push：
- 用户修改已保留：
- Labs 未默认启用：
- sandbox 声明与 actual active/degraded/unavailable/unknown 一致：
- Worktree / writer policy：
- Command ownership / parser negatives：
- Visual QA：PASS / NOT_RUN_ENVIRONMENT / MANUAL_QA_DEFERRED

## 延期项

- `<item>`：原因；启动条件；当前状态

## 复现命令

```bash
<bootstrap>
<doctor>
<full tests>
<mode example>
<swarm plan/run example>
<safe/rollback>
```

## 等待 / Blocker

仅 `WAITING_FOR_USER` 或 `BLOCKED` 时填写：canonical 状态、类别、证据、已完成范围、恢复 SHA、连续阻塞计数（若适用）、用户最小动作。第一次需要用户输入必须是 `WAITING_FOR_USER`，不能写 `BLOCKED`。
````

不要因为已经完成大量工作就降低 Definition of Done。只有真实交付、测试、审查、证据和授权范围内的 Git 结果都满足，非 `all` 才能报告 `TARGET_COMPLETE`，`all` 才能报告 `COMPLETE`；两者都必须按 objective 调用 `update_goal(complete)`。
