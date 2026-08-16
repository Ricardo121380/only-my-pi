# Codex Goal Execution Spec：端到端开发 only-my-pi Harness

> 本文件是给 **Codex 开发代理** 使用的持久 Goal 执行契约。它要求 Codex 直接修改、测试和交付 `only-my-pi` 仓库；它不是 Pi Slash Prompt，不使用 Pi prompt frontmatter、参数占位符或 Pi 的 prompt loader，也不得安装到 Pi 的 prompts/skills/themes/resources 中。

## 0. 直接启动

### 0.1 可复制到 Codex 的 `/goal` launcher

从 `only-my-pi` 仓库打开 Codex 后，直接发送：

```text
/goal 直接开发 only-my-pi Harness。读取并严格执行仓库内 codex/goals/develop-only-my-pi.md；TARGET=all；REPO=当前已验证的 only-my-pi Git 根目录；DELIVERY=push。将本命令由 Codex host 创建的 active Goal 作为唯一 Goal，不要递归创建第二个 Goal；完成 M0-M7 及依赖闭包、测试、独立审查、原子提交、里程碑证据和授权范围内的远端验证；没有我新的明确授权时，不读取凭据、不调用真实模型 Provider、不修改真实 ~/.pi、不全局安装、不推 main、不 force push、不 publish/tag/release/PR。
```

如果 Codex 不是从仓库内启动，使用绝对路径：

```text
/goal 直接开发 only-my-pi Harness。读取并严格执行 /absolute/path/to/only-my-pi/codex/goals/develop-only-my-pi.md；TARGET=all；REPO=/absolute/path/to/only-my-pi；DELIVERY=push。将本命令由 Codex host 创建的 active Goal 作为唯一 Goal，不要递归创建第二个 Goal；持续执行至本契约的完成条件成立；缺少新授权时遵守本契约的 fail-closed 边界。
```

若只希望保留本地提交而不接触远端：

```text
/goal 直接开发 only-my-pi Harness。读取并严格执行仓库内 codex/goals/develop-only-my-pi.md；TARGET=M0-M3；REPO=当前已验证的 only-my-pi Git 根目录；DELIVERY=local。将本命令由 Codex host 创建的 active Goal 作为唯一 Goal，不要递归创建第二个 Goal。
```

当前 `/goal <objective>` launcher 不提供可由本契约补写的 token-budget 参数，因此
**不要**在上述 `/goal` 文本中加入 `BUDGET` 并假设它会生效。若确实需要硬性
token budget，请改用 §0.2 的普通自然语言创建路径，明确写出
`BUDGET=<positive-integer>`，让 Codex 在确认没有 active Goal 后把它作为
`create_goal(token_budget=...)` 的参数。Codex 不得自行设置或猜测预算。

### 0.2 自然语言调用

也可以直接告诉 Codex：

> 请创建一个持久 Goal，直接开发 `/absolute/path/to/only-my-pi`。以 `codex/goals/develop-only-my-pi.md` 为完整执行契约，目标为 `TARGET=all`、`DELIVERY=push`；持续完成 M0–M7，不要只给计划。按照契约使用 Codex 开发子代理、测试、审查、提交、恢复状态和验证，但不要把这份文件注册成 Pi resource。若需要硬性 token budget，请在本请求末尾明确加入 `BUDGET=<positive-integer>`。

这是一条对 Codex 的明确 Goal 创建请求。通过 `/goal` launcher 调用时，Codex host 已经创建 active Goal，执行代理只能读取、校验和最终更新它，绝不能再调用 `create_goal`。只有采用本节自然语言调用、确认当前没有 active Goal 且环境提供 Goal API 时，才创建等价 objective。若当前环境没有持久 Goal API，仍按同一协议直接开发，并用 Git、tracked milestone state、计划和 `docs/STATUS.md` 跨回合恢复。

## 1. 参数契约

启动请求有三个通用顶层参数，以及一个只适用于“普通自然语言创建新 Goal”路径的
可选预算参数；参数名大小写不敏感，持久状态统一写成大写字段：

```yaml
TARGET: all
REPO: current-validated-git-root
DELIVERY: push
BUDGET: null
```

### `TARGET`

- 允许：`all`、单个 `M0`…`M7`、正向连续范围 `M0-M3`…`M6-M7`；
- 默认：`all`；
- 单里程碑或范围自动包含尚未满足的依赖闭包；
- 倒序、越界、未知或不连续范围必须 fail closed，不得猜测；
- additional constraints 可以收窄 TARGET 或增加安全/测试约束，但不能跳过 gate、降低 Definition of Done 或伪造 PASS。

### `REPO`

- 推荐传目标仓库的绝对路径；
- 值为“当前已验证的 only-my-pi Git 根目录”时，Codex 必须从 cwd 向上解析 Git root，并验证 basename、`package.json.name` 和 origin identity；
- 不得用本文件所在的安装目录、Codex 配置目录、Pi 配置目录或缓存目录替代仓库身份；
- 零个、多个或冲突的候选必须进入 `WAITING_FOR_USER`，请求绝对路径；不得创建第二个仓库。

### `DELIVERY`

- `push`：默认；本地绿色后，向已经存在且身份匹配的 origin 非强制推送 feature branch；
- `local`：只保留本地绿色提交，不 fetch/push 或检查远端 CI；相关状态为 `NOT_IN_TARGET`；
- 它不授权创建/更换 remote、push main、force push、PR、tag、release 或 publish。

### `BUDGET`

- 可选，只接受正整数，且只适用于 §0.2 普通自然语言创建路径；
- 只有用户明确包含、当前没有 active Goal、且环境提供 `create_goal` 时，才作为
  `token_budget` 创建参数传入；
- `/goal` launcher 路径不得把 objective 文本中的 `BUDGET` 当成已生效预算；如果
  用户在该路径要求预算，而读取到的 host-created Goal 没有完全相同的预算，则进入
  `WAITING_FOR_USER`，不得静默无预算继续；
- 已有 active Goal 的预算只能读取和核对，不能通过本契约补设或修改；
- 没有可设置预算的 Goal API 时，显式预算请求必须报告 `BUDGET_UNAVAILABLE` 并等待，
  不能用提示词计数冒充硬限制；
- 不得从版本号、日期、测试数、TARGET 或其它数字推断；
- 有显式预算时，最终报告必须包含 Goal API 返回的最终 token usage。

## 2. Codex Goal 生命周期

Codex Lead Agent 是本契约的执行者。职责不是只写 TODO、只生成计划、只做演示或把开发工作交给未来的 Pi Agent，而是直接在目标仓库持续实现本契约，直到 TARGET 的 Definition of Done、测试、独立审查、证据和授权范围内的 Git 结果全部成立。

### 2.1 Goal API

若环境提供 Goal API：

1. 先读取当前 Goal；
2. 如果本契约由 `/goal` launcher 启动，当前 Goal 就是 host 已创建的唯一 active Goal：验证 objective/REPO/TARGET/DELIVERY 后继续，禁止 nested/recursive `create_goal`；该路径出现显式 `BUDGET` 时还必须核对 active Goal 已有完全相同的 token budget，否则进入 `WAITING_FOR_USER`；
3. 只有本契约由普通自然语言顶层请求启动、用户明确要求创建 Goal 且确认没有 active Goal 时，才创建 objective：`在已验证的 only-my-pi 仓库中按 codex/goals/develop-only-my-pi.md 完成 TARGET 及其依赖闭包，并通过所有对应门禁`；只有这个创建调用可以在用户显式给出 `BUDGET` 时设置 `token_budget`；
4. 不得通过 `update_goal`、第二次 `create_goal` 或仅在 objective 中写一段预算文字来补设预算；
5. active Goal 与本请求的 repository identity、objective family、branch ownership marker 和依赖闭包必须兼容；
6. 本次闭包是 active 闭包子集时继续 active 闭包，不能把 `all` 缩小；本次是其真超集时，只有用户明确扩大 TARGET 且 API 支持保持同一 Goal identity 时才更新，否则进入 `WAITING_FOR_USER`；
7. active Goal 属于其它项目、目标族或 branch marker 时，报告 `ACTIVE_GOAL_CONFLICT`，不得接管、替换或暗中完成另一个 Goal；
8. 持续维护结构化执行计划，最多一个 step 为 `in_progress`；
9. 一次用户决定、一次授权或一次环境恢复需求只进入 `WAITING_FOR_USER`；只有达到运行环境规定的连续阻塞阈值且确实无法继续时才 `update_goal(blocked)`；
10. 完成顺序固定为：实现与 focused gates → clean source commit → milestone state；包含 M7 时再执行 clean-source release gate → receipt-only commit → 非写 final checks → delivery/remote gate；
11. 只有 objective 全部达成且无必需工作残留时才 `update_goal(complete)`。

没有 Goal API 时，Codex 仍直接开发，不得把“没有 API”当作只输出建议的理由。跨回合从计划、Git ancestry、Goal marker、milestone state、receipt 和 STATUS 恢复，不重复已经完成且仍有效的工作。

### 2.2 依赖闭包

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

开始时计算并报告，但在满足证据提交点前不得持久化为“已完成”：

```text
requestedTarget
dependencyClosure
alreadySatisfiedMilestones
effectiveTarget
deliveryMode = push | local
```

只能用 Git ancestry、有效 marker/state/receipt 和重跑的廉价 drift checks 认定既有里程碑，不能只相信文档叙述。非 `all` 范围完成可报告 `TARGET_COMPLETE`，不代表 Harness 全部完成。

### 2.3 Canonical 状态与交付真值表

Goal 运行状态只允许：

```text
ACTIVE | WAITING_FOR_USER | BLOCKED | TARGET_COMPLETE | COMPLETE
```

Gate/evidence 状态只允许：

```text
PASS | FAIL | NOT_IN_TARGET | NOT_TRIGGERED | NOT_RUN_BY_POLICY |
NOT_RUN_ENVIRONMENT | BLOCKED | UNAVAILABLE | CONFIGURED_UNVERIFIED |
REMOTE_CI_UNVERIFIED | NOT_AUTHORIZED | MANUAL_QA_DEFERRED
```

| TARGET / DELIVERY | Push | Remote SHA | Remote CI | 完成条件 |
| --- | --- | --- | --- | --- |
| 任意 / `local` | `NOT_IN_TARGET`，不得触碰 remote | `NOT_IN_TARGET` | `NOT_IN_TARGET` | 本地 source/state/receipt（若适用）和目标门禁有效 |
| M0–M6 / `push` | 必须非强制 push feature branch | 必须等于 final local SHA | `NOT_IN_TARGET`；已证明没有触发器时可写 `NOT_TRIGGERED` | 本地 gate、push、SHA 对账通过；若观察到 exact-SHA CI `FAIL` 则不能隐藏 |
| 包含 M7 / `push` | 必须非强制 push receipt commit | 必须等于 local receipt SHA | exact-SHA terminal `PASS` | `FAIL`、`NOT_TRIGGERED`、`REMOTE_CI_UNVERIFIED` 均不能完成 |

## 3. 最终产品目标与边界

将仓库开发成基于 Pi 的个人 Agent Harness 发行层：

1. 一键、安全、可预览、幂等、可回滚的 bootstrap；
2. 严格的 Profile capability ceiling；
3. 版本化、声明式、可扩展的 Mode Registry；
4. 多个有真实行为差异的内置 Mode；
5. 声明式 Workflow、单 Agent runner 和确定性 Gate Runner；
6. 基于 `pi-subagents` 公开能力的 AgentSwarm；
7. `omp` CLI 与 Pi 内唯一 `/omp` 控制入口；
8. 轻量主题和 status；
9. doctor、安全负面测试、CI、文档和验证收据；
10. 原子提交及现有 origin 上的非强制 feature branch push。

产品边界：

```text
Pi Core：agent loop / Provider / session / built-in tools / TUI / extension API

only-my-pi：bootstrap / Profile / Mode / Workflow / Agent / AgentSwarm /
            policy / prompts / skills / themes / status / doctor / rollback
```

不要重写 Pi runtime，不创建第二套 Provider HTTP client、session engine、subagent tool/runtime、permission owner、memory owner、MCP bridge 或完整 TUI。

本文件自身只属于 Codex 开发控制面：

- 不放入 `prompts/`；
- 不添加 Pi prompt frontmatter；
- 不注册到 `package.json#pi` 或 first-party Pi resource inventory；
- 不复制到 `PI_CODING_AGENT_DIR`；
- 不产生 Pi slash command；
- pack/resource tests 必须证明它不会被当作 Pi prompt、skill、theme、extension 或 context 加载。

## 4. 开始前必须读取和核验

Codex Lead 必须亲自读取：

- `docs/plans/2026-08-16-only-my-pi-development-plan.md`；
- `README.md`、`docs/STATUS.md`、`SECURITY.md`；
- `package.json`、lockfile 和 package scripts；
- `inventory/packages.lock.json`；
- `profiles/`、`schemas/`；
- `docs/decisions/`、`docs/architecture/`；
- 与 TARGET 相关的实现和 tests；
- 最近 Git 提交、分支、remote 和完整工作树状态。

历史版本、测试数、Node/Pi 版本、package 版本和 SHA 只是线索，必须以当前机器和仓库重新核验。需要补充外部证据时使用当前官方源码/文档；论坛只能发现候选和失败模式，不能独立证明兼容性、安全或性能。不要重复已有调研，只补充影响实现且可能漂移的证据。

## 5. 授权与安全边界

### 5.1 已授权

```yaml
modify_target_repository: true
create_feature_branch_or_isolated_worktree: true
create_atomic_commits: true
run_local_tests_and_no-model_product_smokes: true
push_feature_branch_to_existing_matching_origin_when_DELIVERY_is_push: true
```

这些授权仅属于 Codex 在目标仓库中的开发流程，不代表 only-my-pi 产品运行时获得相同权限。

### 5.2 未授权

```yaml
modify_real_pi_home: false
install_global_packages_on_real_machine: false
read_copy_print_or_upload_credentials: false
run_live_model_provider_requests: false
publish_npm: false
create_release_or_tag: false
open_pull_request: false
push_main: false
force_push: false
create_or_replace_remote: false
delete_existing_labs_modules: false
```

不得读取、打印、复制、移动、提交或上传 API key、OAuth token、Provider secret、`auth.json`、session/transcript、memory database、cache、browser Cookies、其它私有仓库源码或原始模型/tool payload。证据只保存命令名、退出码、测试摘要、hash 和脱敏诊断。

不得修改真实 `~/.pi`、真实 settings 或全局 npm。Bootstrap 测试使用显式 config root 和临时目录；Pi no-model startup 优先使用临时 `PI_CODING_AGENT_DIR`、offline、no-session。mock、fixture、schema、adapter、no-model startup 不能描述成真实 Provider 验证；未经授权的真实模型验证统一为 `NOT_RUN_BY_POLICY`，不是 blocker 但也不是 PASS。

默认禁用 YOLO/auto-approve、Cookies/Accessibility/Screen Recording、remote shell、Cron/daemon、任意 JavaScript Workflow、self-modifying creator、marketplace auto-update、未审计 MCP、nested swarm、多 owner 和未完成 SSRF 防护的 Web fetch。

Project Trust、Plan Mode 名称、工具隐藏和权限弹窗不等于 OS sandbox。`pi-permission-modes` 的 sandbox 必须报告 actual `active/degraded/unavailable/unknown` 和原因；不能从 Bash 子进程隔离推导文件、Web、MCP、Provider 或 extension 全部隔离。

### 5.3 Labs

保留但不继续主线集成：

- `packages/deepseek-conformance`；
- `packages/acp-v1`；
- `packages/workspace-checkpoint`。

保持已有测试通过并下沉 Labs/Experimental。除非用户另行明确授权，不执行真实 DeepSeek endpoint smoke、Pi RPC ↔ ACP wiring 或自动 turn checkpoint hook。

## 6. Git、工作区和证据协议

### 6.1 仓库解析与预检

在任何写入前：

- 解析并验证 `REPO` 的 Git root、repo 名、`package.json.name` 和 origin identity；
- 读取 `git status --short --branch`、HEAD、branch、upstream、remote、worktree list 和最近提交；
- 分类 tracked/untracked/modified 文件；
- 核验 Node/npm/Pi 和 package scripts；
- 运行与当前状态相称的 baseline gates。

若工作树干净，从最新本地 base 创建或恢复唯一 `codex/...` feature branch。只允许 fetch，不在 main 自动 pull/merge。若已有同名分支，只有 marker、merge-base、Goal family 和 ancestry 全部匹配才恢复；冲突时创建唯一新分支或等待用户，不 reset、覆盖或接管。

若存在用户修改：保留并分类，不 stash、不 reset、不 checkout 覆盖。优先从已提交 HEAD 建立隔离 worktree；不重叠的用户改动不是 blocker；只有目标文件无法安全区分所有权时才请求用户。

每个 commit 必须是一个绿色、可回滚的逻辑增量；提交前通过 focused gate，不混入用户改动，不包含 secrets/sessions/cache/node_modules/本机配置，不提交明知 failing 的中间状态。只有 Lead Codex Agent 拥有 branch、commit、push 和 milestone evidence。

### 6.2 Tracked Goal marker

feature branch 建立后、产品实现前，Lead 创建并提交唯一 marker：

```text
verification/milestones/<goalRunId>/goal.json
```

`goalRunId` 是 lowercase UUID；Goal API id 只能作为独立可选字段。marker 包含：schemaVersion、goalRunId、repository identity、Goal API id（若有）、不含 TARGET 的 objectiveFamilyDigest、initial requested target/closure、initial delivery mode、branch、base branch、base commit、createdAt、markerHash。`markerHash` 对排除自身字段的 canonical JSON 计算。

marker 不记录当前 HEAD、marker commit SHA、raw prompt、reasoning 或 host path。新分支上 marker 必须是唯一 tracked diff；marker commit 第一父提交必须等于 base commit。已有 marker 只能验证恢复，不能覆盖。branch name、repo identity、base ancestry、Goal family、goalRunId、markerHash 必须一致；零个或多个匹配均不得猜测。

### 6.3 M0–M6 milestone state

每个里程碑使用无自引用两阶段协议：

1. 完成实现、测试、文档并提交原子 source commits；
2. 工作树干净后固定 `sourceCommit=HEAD`；
3. 在 exact clean source commit 上运行 milestone gates；
4. 仅在 gates 满足时写 `verification/milestones/<goalRunId>/M<n>.json`；
5. state 记录 schemaVersion、goalRunId、markerHash、requested/effective TARGET、DELIVERY、milestone、sourceCommit、suite version/digest、gate id/canonical status、低敏摘要、completedAt、nextMilestone、stateHash；
6. stateHash 排除自身字段；不得记录 state commit、未来 HEAD、raw output 或 host path；
7. state 是唯一 tracked diff，以独立 `chore(verify): record M<n> milestone state` commit 提交，第一父提交必须等于 sourceCommit；
8. state commit 后只运行非写 schema/ancestry/diff checks。

恢复时要求 marker/state schema、hash、source ancestry、第一父关系、suite digest 和廉价 drift check 全部有效。任一 contract drift 从该里程碑起失效；不能只改 STATUS。uncommitted diff 必须重新分类，不能自动丢弃。

### 6.4 M7 release receipt

M7 不写单独的 `M7.json`。最终 release receipt 是 M7 唯一权威 state，必须遵循：

1. 所有 source/tests/docs/package metadata 已提交；
2. 工作树完全分类并干净，固定 `sourceCommit=HEAD`；
3. 在 exact source commit 运行 `npm run verify -- --run`；dry-run 不计；
4. runner 从 versioned `release-gates-v1` allowlist 读取 suite，并包括真实 packed-tarball fresh-root smoke；
5. receipt 是唯一 tracked diff，`receipt.sourceCommit == sourceCommit`，无 self hash、未来 SHA、raw output、host path 或 secret；
6. receipt-only commit 第一父提交等于 sourceCommit；
7. 在 receipt HEAD 运行非写 schema/ancestry/secret/pack-diff checks；
8. receipt 后任何 tracked commit/修改都会使其失效，必须重新生成。

`DELIVERY=push` 时非强制 push receipt commit，并等待 exact SHA 的远端 CI terminal PASS；`DELIVERY=local` 时不触碰 remote。

## 7. Codex 多代理研发协议

Codex 可以使用当前平台的开发子代理并行研究、实现和独立审查。**这些 Codex 子代理是研发团队成员，不是 only-my-pi 产品的 AgentSwarm，也不通过 `pi-subagents` 执行。** 反过来，M5 实现的 `pi-subagents` adapter 只是被开发和测试的产品代码，不能接管 Codex Goal 生命周期、Git、提交或开发调度。

研发调度与产品验收预算必须分开记录，禁止把两者混成同一组 runtime defaults：

```yaml
codexDevelopment:
  maxParallelAgentsIncludingLead: 4
  branchCommitPushOwner: codex-lead-only
  writerPolicy: non-overlapping-owned-paths-or-isolated-worktree

productAgentSwarmAcceptanceDefaults:
  maxDepth: 1
  maxConcurrency: 3
  maxChildren: 8
  childTimeoutMinutes: 15
  runTimeoutMinutes: 60
  retry: 0
  nestedSwarm: false
  sharedCwdWriters: 1
```

最多并行 4 个 Codex 开发代理（包括 Lead）；这不表示产品 Swarm concurrency 是 4。推荐 lane：Pi API/runtime contract、schema/config/bootstrap、Mode/Workflow、AgentSwarm adapter/DAG、安全供应链、tests/docs/review。

每个子代理必须是具体、有界、可独立完成的任务。writer 路径不重叠；同一文件不能由多个 writer 同时修改；交叉文件由 Lead 串行集成。Reviewer 使用 fresh context 且只读。

强制 launch envelope：

```yaml
codexDevelopmentAgentLaunch:
  task: <bounded task and required evidence>
  cwd: <validated repo root or owned isolated worktree>
  ownedPaths: [<exact non-overlapping paths>]
  allowedTools: [<minimum tools>]
  deniedCapabilities:
    - git-branch
    - git-checkout
    - git-commit
    - git-push
    - git-stash
    - git-reset
    - goal-marker-state-receipt
    - credentials
    - real-pi-home
    - global-install
    - live-provider-test
  network: <none or public official-source allowlist>
  outputPolicy: redacted-summary-and-bounded-evidence
  maxTurnsOrTimeout: <finite>
  expectedArtifacts: [<owned paths or structured findings>]
```

writer 必须收到：

> 你不是仓库中唯一的 Agent。不得回滚或覆盖他人修改；发现并行改动时适配现状并报告冲突。只修改明确分配的文件范围，不 commit/push/切换分支/写 Goal evidence。

平台不能强制 path/tool/secret ceiling 时，高风险 writer 只能在不挂载 credentials/真实 Pi home 的隔离 worktree/container 中工作；做不到则由 Lead 串行实现。Lead 接受结果前必须核查 changed paths、拒绝 envelope 外 diff、运行 focused tests，并确认没有 Git、remote 或 Goal evidence mutation。

平台模型用于 Codex Lead/子代理推理不等于 only-my-pi 向用户 Provider 发出了 live 请求，也不能成为产品 Provider 验证证据。

## 8. 核心架构不变量

### 8.1 分层与权限交集

- Profile：Pi load-time package/resource/capability ceiling；
- Mode：session/task-time prompt/tools/policy/workflow overlay；
- Workflow：阶段、依赖、gate、fallback 和终止条件；
- Agent Role：child prompt/tools/model/output contract；
- Swarm Recipe：Agent DAG、预算、隔离、取消和聚合；
- Adapter：把统一 request 映射到 `pi-subagents` 的公开 RPC。

```text
effective permission = OS/container ∩ Project Trust ∩ Profile ∩ Mode ∩
                       Workflow step ∩ Agent Role ∩ parent approval
```

deny 优先，下层只能收窄。M1 必须实现 versioned enforcement-surface matrix，逐 surface 记录唯一 owner、enforcement point、observable state、degraded/fail-closed 行为和 contract tests；不能靠 prompt 把 `UNSUPPORTED` 或 `RESTART_REQUIRED` 宣称为 `ENFORCED`。

### 8.2 三条用户轴

1. Task Mode：`inspect | explore | plan | coding | debug | review | research | verify | ...`；
2. Worker Agent Role：`scout | planner | implementer | reviewer | ...`；
3. Scheduling Recipe：`single | pipeline | map-reduce | DAG`。

`executionState = ask | plan | build | review` 是内部策略投影，不是第四个用户轴。Profile 是 load-time ceiling，Workflow 是状态机，Swarm 也不是权限 Mode。每个 Mode v1 绑定一个 executionState；`debug` 固定只读，只有 root-cause gate 和父 session 明确批准后才能显式转入 coding/build，并生成 durable transition receipt。

### 8.3 唯一 ExecutionStateDriver

不得导入 `pi-permission-modes` 未公开 `src/**`、模拟 `/perm` 输入或建立第二 permission owner。

- 有 audited public driver 才能热切换硬 permission/sandbox；
- 没有时，初始状态由公开启动 seam 提供；
- 同一硬 envelope 内可热切换 prompt/Workflow；
- 跨 envelope 返回 `EXECUTION_STATE_DRIVER_UNAVAILABLE` 或 `RESTART_REQUIRED`；
- sandbox 不可观测时显示 `unknown`；
- tool visibility/prompt injection 不能冒充硬策略切换；
- 必须测试两种 owner 操作顺序，任一 deny 都不能被另一 owner 撤销。

### 8.4 可扩展 Mode

Mode 必须 versioned、声明式、无任意代码；支持 built-in/user/trusted-project/reviewed-package 发现；有 namespace 且无静默覆盖；新增 manifest 不修改 core registry；拒绝 duplicate/cycle/path traversal/symlink escape/unknown capability；生成 immutable resolved snapshot/hash/explain/diff；只能收窄 Profile；新增资源返回 `RESTART_REQUIRED`；仅 idle activation；使用 public Pi API；source drift 进入 `STALE_MODE_SNAPSHOT`。

### 8.5 AgentSwarm 产品边界

only-my-pi Swarm Core 只负责 Agent/Recipe registry、DAG validation/compile、admission、budget intersection、capability preflight、stable aggregation、single-writer/worktree policy、provenance/low-sensitive ledger 和 verifier gate。

`pi-subagents` 独占 physical child dispatch、package concurrency、child processes、worktree、stop/resume/interrupt、runtime usage 和 artifacts。only-my-pi 不实现第二 scheduler、不注册第二个 `subagent` tool、不导入未 export `src/**`。live lane 只走 capability-gated extension RPC；exported delegation types 只作 version-locked conformance fixture。

Agent JSON 编译为受管 Markdown resource，RPC 只引用受管 agent id。Mode/Workflow/Recipe/CLI 不接受 raw workflowScript；仅 schema-validated compiler 用固定模板和 JSON-safe serializer 生成，覆盖 task/path/argv/script injection tests。

默认 BudgetEnvelope：depth 1、concurrency 3、children 8、child timeout 15 分钟、run timeout 60 分钟、retry 0、nested false、shared cwd writer 1、child raw output 50 KiB、parent summary 8 KiB。shared cwd writer hard max 1；parallel writer 必须隔离 managed worktree。Cancel 必须关闭 admission 并等待 terminal proof；resume 重跑 admission/budget。真实 token/cost 不可观测时显示 `UNAVAILABLE`，不能伪造精确成本。

## 9. M0–M7 执行计划

Codex 必须先读取 canonical 开发计划，再按下列 milestone contract 实施；下面是执行摘要，不取代计划中的详细验收。

### M0：定向、基线与 Labs

- 创建/恢复 Codex Goal、执行计划、feature branch 和 marker；
- 核对 repo、runtime、依赖、Git 和 current tests；
- 固化 only-my-pi 是 Pi Harness 发行层而非第二 runtime；
- 将 ACP/DeepSeek/checkpoint 留在 Labs/Experimental，默认不加载；
- 修正文档 overclaim，记录真实 baseline；
- 通过 M0 focused gate、source commit 和 milestone state。

### M1：Schema、治理与能力面

- 实现真正的 Draft 2020-12 schema validation 和 positive/negative fixtures；
- exact npm/Git/integrity、package topology、inventory 和 pack allowlist；
- versioned Profile、Capability/Owner、Mode、Workflow、Agent、Swarm Recipe contracts；
- command owner registry：`omp` 和唯一 `/omp` 属于 only-my-pi，不重注册 `pi-subagents` 命令；
- versioned enforcement-surface matrix；
- first-party resources inventory；
- `release-gates-v1` allowlisted manifest 及 parser injection negatives；
- static/live doctor 分层；
- `ExecutionStateDriver` capability spike；
- `pi-subagents` RPC ping/capability spike，exported delegation 仅 reference fixture；
- child launch contract：read roles 无 bash，tester/verifier 只允许后续 Gate Runner；
- 通过 M1 gates 和 state。

### M2：Config Runtime 与一键 Bootstrap

- reusable resolver/doctor service 和 `bin/omp.mjs`；
- `bootstrap plan/apply`、owned-field merge、exclusive lock、durable journal、backup、last-known-good、rollback；
- package/resource 先 stage/verify，settings 最后原子发布；
- status/doctor/safe/rollback/uninstall/update；update 默认只 plan，只应用 inventory 审计精确版本；
- `--provider/--model` 只保存非敏感 metadata，不读 auth、不发请求，状态 `CONFIGURED_UNVERIFIED`；
- isolated config-root E2E、idempotence、failure/crash injection 和恢复；
- 通过 M2 gates 和 state。

### M3：Mode Registry 与统一 `/omp`

- 基于 M1 contract 实现 registry/discovery/resolve/hash/explain/diff；
- executionState 与 Task Mode 分层；
- activation、restore、tool/prompt/status mapping；
- 唯一 driver 或明确 restart flow；
- bootstrap `--mode`、`omp mode ...`；
- Pi 内唯一 `/omp status|doctor|mode|help` parser/dispatcher 和 collision checks；
- safe Mode scaffold；
- 通过 M3 gates 和 state。

### M4：内置 Mode、Agent Role 与 Workflow

至少实现 8 个行为不同的 Core Mode：`inspect`、`explore`、`plan`、`coding`、`debug`、`review`、`research`、`verify`。

实现首发 Workflow：`plan-build-review`、`research-report`、`review-findings`、`debug-fix-verify`、`single-agent-safe`，以及：

- Agent role registry；
- schema-driven Workflow state machine、admission、durable low-sensitive state、cancel、fallback 和 verifier gate；
- parent-session `SingleAgentWorkflowRunner`，不伪装成 child/Swarm；
- deterministic Gate Runner，只接受 registry 固定 command id/argv/cwd/env/timeout，拒绝 arbitrary shell/path/network；
- JSON-only Workflow、固定 action/gate/terminal/fallback enum；
- M5 前 `action: swarm` 为 `UNAVAILABLE`，只能走显式 single-agent fallback；
- `debug-fix-verify` 先只读 root-cause，gate PASS + parent approval 才显式 coding/build；
- `.agents/skills` bridge 的 Project Trust、namespace 和 path/symlink containment；
- Aider 风格 repo-map 和 lint/test loop 的窄 adapter seam；
- 通过 M4 gates 和 state。

### M5：AgentSwarm

- 复用 M1 Recipe contract 和 M4 Agent registry/Gate Runner；
- DAG compiler、admission、budget intersection、cancel/result normalization、stable aggregation；
- `PiSubagentsAdapter` 只走 capability-gated RPC live lane；
- Agent JSON → 受管 pi-subagents Markdown；
- child policy projection matrix：`ENFORCED | RESTART_REQUIRED | UNSUPPORTED` + owner；
- safe DAG→workflowScript compiler 及 injection negatives；
- writer/worktree/file-overlap policy；
- mutating swarm preflight 和父级 runtime approval，child 不能代批准；
- offline CLI `list/show/validate/plan`；live `run/status/cancel` 需要明确 Pi parent，否则 `LIVE_SWARM_REQUIRES_PI_SESSION`；
- `omp swarm` parser 拒绝 unknown/duplicate flags、invalid id、path traversal、raw script、shell/`--` injection、超长输入和位置歧义；
- low-sensitive events 和 `/omp swarm`；
- roles：scout、planner、implementer、tester、reviewer、security-reviewer、researcher、source-verifier、verifier、synthesizer；
- recipes：research-synthesis、coding-guarded、review-matrix、debug-hypotheses；
- read-only research fake-runtime E2E，再完成 guarded coding fake-runtime E2E；live Provider 未授权为 `NOT_RUN_BY_POLICY`；
- 通过 M5 gates 和 state。

### M6：UI 与主题

- pure-data semantic theme 和 default dark theme；
- status 汇总 Profile/Mode/model/context/Git/permission/swarm；
- `/omp theme` 和 safe disable；
- theme schema、contrast、ANSI snapshot、headless/safe-disable；
- 环境支持时自动视觉检查；真实跨终端/字体人工 QA 可为 `MANUAL_QA_DEFERRED` 或 `NOT_RUN_ENVIRONMENT`，只有 promotion/release 明确要求时才升级为 blocker；
- 通过 M6 gates 和 state。

### M7：安全、CI、文档与 Release Readiness

- local/CI 共同读取 `release-gates-v1` manifest digest；
- Pi no-model startup 和 Node/Pi compatibility matrix；
- threat model、path/symlink/command injection/runaway swarm/secret negatives；
- README quickstart，Bootstrap/Mode/AgentSwarm/security/rollback/migration/uninstall/Labs 文档；
- STATUS、CHANGELOG、LICENSE、package metadata 和 files allowlist；
- 生成真实 npm tarball，在 disposable fresh root 安装 tarball，执行 CLI help、bootstrap dry-run、isolated apply/doctor、safe/rollback 和 Pi no-model startup；source-tree run 不算；
- 按 §6.4 生成 receipt-only commit 和非写 final checks；
- 全量 gates；
- 按 DELIVERY 执行 local 或 feature-branch push；包含 M7 且 push 时等待 exact receipt SHA CI terminal PASS；
- 完成 M7。

## 10. 每个增量的强制闭环

```text
Orient
→ Baseline
→ Contract / invariants
→ Negative tests
→ Minimal implementation
→ Focused tests
→ Fresh independent review
→ Fix root causes
→ Related regression
→ Docs / STATUS
→ Atomic source commit
→ Milestone gate
→ Milestone state or M7 receipt
```

不得先写大量实现再补安全契约，不得删除/跳过失败测试制造绿色，不得捕获异常后无条件退出 0，不得把未执行写成 PASS。Codex 每 60 秒内给出简短进度更新；更新说明当前 milestone、已通过 gate、正在验证的风险、是否需要新授权和下一步，不用流水账冒充交付。

## 11. 必须覆盖的验证

### Bootstrap

- empty/malformed/existing-unknown-field config；
- dry-run zero write、first apply、second apply no-op；
- backup/rollback/uninstall/update；
- permission/install failure、interrupted atomic write；
- 每个 transaction phase crash/journal recovery；
- settings 不引用未 staged+verified package；
- concurrent bootstrap、stale lock、apply-vs-rollback exclusion；
- Provider metadata 始终 `CONFIGURED_UNVERIFIED`；
- no credentials/session/cache access。

### Mode、Workflow、Agent

- schema/version/duplicate/cycle/namespace collision；
- path traversal/symlink escape/unknown capability；
- inheritance monotonicity/Profile escalation rejection；
- stable hash/explain/diff、idle activation、restore/stale snapshot；
- driver absent/degraded/restart-required、两个 owner 操作顺序的 deny preservation；
- untrusted project discovery、CLI/Pi resolver equivalence；
- command owner collision 和 safe scaffold；
- Workflow duplicate/cycle/invalid transition、JSON-only/enum rejection；
- SingleAgentWorkflowRunner lifecycle/cancel/resume/fallback；
- Gate Runner allowlist 和 arbitrary shell/path/network rejection；
- debug root-cause gate 前只读，缺 parent approval 不进入 coding/build；
- Agent I/O、allowedExecutionStates/capabilities、skills bridge trust/path tests。

### AgentSwarm

- normal DAG/pipeline/map、unknown dependency/cycle；
- concurrency/depth/fanout/child count/timeout；
- cancel 后无新 dispatch/retry/reducer/verifier；
- failure/partial/skipped dependency、stable aggregation/retry classification；
- recursive swarm rejection、single writer、isolated worktree；
- child 不超过 parent，read roles 无 bash，tester/verifier 只用 Gate Runner；
- RPC version/capability mismatch 和 reference fixture drift；
- workflowScript/task/path/argv injection；
- CLI duplicate/unknown flags、invalid id、`--`/shell metachar、raw script、oversize/positional ambiguity；
- mutating approval、worktree sandbox degraded、verifier gate、ledger redaction、event pairing；
- fake adapter startup/abort/dispose。

### Security、Packaging、Release

- exact pin/integrity/lifecycle scripts；
- secrets/raw payload exclusion；
- package tarball allowlist；
- 本 Codex spec 不被识别或安装为 Pi resource；
- release manifest schema/digest/coverage/arbitrary-command rejection；
- packed tarball disposable fresh-root smoke；
- UI owner conflict、Labs disabled、no real Pi home changes；
- README fresh-clone smoke；
- receipt source/parent/invalid-after-change；
- remote CI 与 local gate 分开报告。

测试命令必须从当前 `package.json` 和 release manifest 发现，不得凭旧报告硬编码。先跑最窄 focused tests，再跑相关 regression，milestone/release point 才跑全量 suite。失败必须修根因并重跑，不能修改期望值掩盖真实 contract 破坏。

## 12. Definition of Done

只有 TARGET 依赖闭包的全部 milestone exit gates 通过，才可完成 Goal。`TARGET=all` 还必须满足：

### Repository / Git

- 正确 repo、Goal marker 和 `codex/...` feature branch；
- 用户改动未覆盖或混入；
- 逻辑增量原子提交，工作树按证据协议干净；
- 无 secret/session/cache/node_modules；
- 无 main/force push；
- DELIVERY=push 时 feature branch push 和 SHA 对账满足真值表；local 时 remote 全部 `NOT_IN_TARGET`。

### Bootstrap

- 一键 plan/apply、isolated config root、幂等、锁、journal、backup、atomic merge、rollback、uninstall、update；
- resource 先就绪、settings 最后发布，所有 phase crash 可恢复；
- 保留未知字段，失败安全，不触碰真实 Pi home/credentials；
- Provider metadata 不冒充 live-ready。

### Mode / Workflow

- versioned schema/registry/resolver/activation/scaffold；
- 8 个 Mode 均通过行为矩阵；
- 5 个 Workflow、single-agent fallback、Workflow Core、SingleAgentWorkflowRunner、Gate Runner 生效；
- debug 只读起步，root-cause gate + parent approval 才转 coding/build；
- 新 Mode 不改 core registry，Mode 不扩大 Profile；
- 唯一 driver，无 public driver 时 restart/unavailable；
- CLI/Pi 共用 service，负面 contract tests 全通过。

### AgentSwarm

- 不只是文档、TODO 或纯 mock；
- schema、registry、DAG/admission、RPC-only adapter、budget/cancel/aggregation/verifier 生效；
- physical scheduler 归 pi-subagents，only-my-pi 无第二 runtime；
- single-writer/worktree 和 parent approval 生效；
- 4 个 recipes 通过 contract/fake-runtime，research/coding 两条 E2E 通过；
- RPC negotiation、reference conformance、compiler/CLI injection、no-bash contract 通过；
- live Provider 未授权如实 `NOT_RUN_BY_POLICY`。

### Control / UI / Docs / Evidence

- `omp` 和唯一 `/omp` 提供 status/doctor/mode/swarm/safe/help；
- status 不伪造未知 runtime 字段；default theme、唯一 UI owner、safe disable；
- tests/schema/doctor/typecheck/secret/pack/diff 全部通过；
- local/CI suite manifest digest 一致；
- packed tarball fresh-root smoke 通过；
- README 可复现，Mode/Swarm/security/rollback/Labs 文档完整；
- STATUS 与事实一致，CHANGELOG/LICENSE/metadata/threat model 完整；
- receipt 指向真实 source commit、parent 匹配、无 raw output/host path/secret；
- M7 push 的 exact-SHA remote CI terminal PASS；local 为 `NOT_IN_TARGET`；
- 未授权 publish/tag/release/PR 保持 `NOT_AUTHORIZED`。

## 13. 自动决定、暂停、失败与恢复

Codex 可自行决定目录命名、内部模块拆分、schema 字段细节、测试组织、CLI 输出格式、fake runner、非危险默认值和无外部副作用的开发依赖；选择最小、保守、可回滚方案，必要时记录 ADR。

只有以下情况暂停请求用户：

1. 需要 credentials/OAuth/API key/真实 Provider；
2. 需要修改真实 Pi home 或全局安装；
3. 需要不可恢复删除/覆盖用户数据；
4. dirty worktree 与目标文件无法区分所有权；
5. 需要 force/main push、创建或更换 remote；
6. 需要 publish/release/tag/PR；
7. 证据无法解决且导致互斥架构的重大选择。

失败时：保留低敏诊断 → 分类 baseline/implementation/environment/dependency/permission/external → 最小复现 → 修根因 → 最窄测试 → regression → milestone/full gate。同一假设反复无进展时换路径、用 fresh reviewer/debugger、查官方源码并收缩复现。Push 失败保留本地提交，不 force；按真值表决定 `WAITING_FOR_USER`。真实 Provider 未授权不请求 secret，记 `NOT_RUN_BY_POLICY`。

中断恢复时先验证 repo/branch/marker/state/receipt/ancestry/worktree ownership，再从第一个无效 milestone 继续。不得从头重做有效工作，不得丢弃未提交 diff，不得仅凭 STATUS 宣称完成。

## 14. 最终报告契约

最终回答必须以实际结果开头，并使用以下结构。没有完成时同样提供恢复所需的最小、脱敏证据。

````markdown
# only-my-pi Codex Goal 完成报告

状态：ACTIVE / WAITING_FOR_USER / BLOCKED / TARGET_COMPLETE / COMPLETE

一句话结果：
<是否真正完成 TARGET、验证、提交和 DELIVERY>

## Codex Goal / Target

- Goal API ID / objective：
- Goal execution spec：`codex/goals/develop-only-my-pi.md`
- Goal marker：path / commit / VALID or INVALID
- Branch ownership：VALID / CONFLICT
- Goal token budget / final usage：
- Requested TARGET：
- Dependency closure：
- Already satisfied：
- Effective TARGET：
- Completed milestones：
- NOT_IN_TARGET milestones：
- REPO：<只报告仓库标识，不泄露不必要 host 信息>
- DELIVERY：push / local

## 交付

- Bootstrap / Update：
- Provider/model：UNSET / CONFIGURED_UNVERIFIED / VERIFIED
- Profile / Capability：
- Mode Registry / built-in Modes：
- Workflows / Gate Runner：
- AgentSwarm：
- omp / /omp：
- UI / Safe / Rollback：

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

| Gate | 结果 | 命令/低敏证据 | 测试数 |
| --- | --- | --- | ---: |
| Baseline | PASS/FAIL | ... | ... |
| Full tests | PASS/FAIL/NOT_IN_TARGET | ... | ... |
| Bootstrap isolated/idempotent/rollback | PASS/FAIL | ... | ... |
| Mode contracts | PASS/FAIL | ... | ... |
| Workflow/Gate Runner | PASS/FAIL | ... | ... |
| AgentSwarm contracts | PASS/FAIL | ... | ... |
| Pi no-model startup | PASS/FAIL/NOT_RUN_BY_POLICY/NOT_RUN_ENVIRONMENT | ... | ... |
| ExecutionStateDriver | PASS/FAIL/UNAVAILABLE | owner/version/sandbox state | ... |
| pi-subagents adapter | PASS/FAIL/UNAVAILABLE | version/capability hash | ... |
| Secret/pack/diff | PASS/FAIL | ... | ... |
| release-gates-v1 | PASS/FAIL/NOT_IN_TARGET | manifest digest + coverage | ... |
| Fresh tarball smoke | PASS/FAIL/NOT_IN_TARGET/NOT_RUN_ENVIRONMENT | tarball digest + disposable-root summary | ... |
| Receipt | PASS/FAIL/NOT_IN_TARGET | path + source SHA | ... |

## Codex 研发子代理与产品 AgentSwarm 边界

- 使用的 Codex 子代理及 owned paths：
- Lead 集成/路径审计：
- 产品 pi-subagents live adapter/runtime E2E：PASS / FAIL / NOT_RUN_BY_POLICY
- 未把 Codex 子代理结果冒充产品 AgentSwarm E2E：是 / 否

## 真实 Provider

- 是否授权：
- 是否发送产品请求：
- 状态：PASS / FAIL / NOT_RUN_BY_POLICY
- 结论边界：

## 原子提交

1. `<sha>` `<subject>` — `<scope>`；gate：`<tests>`

## 安全确认

- 未把本 Codex spec 注册/打包为 Pi resource：
- 未修改真实 Pi home：
- 未读取/提交 credentials：
- 未 force/main push：
- 用户修改已保留：
- Labs 未默认启用：
- sandbox 声明与 actual state 一致：
- Worktree / writer policy：
- Command ownership / parser negatives：
- Visual QA：PASS / NOT_RUN_ENVIRONMENT / MANUAL_QA_DEFERRED

## 延期项

- `<item>`：原因；启动条件；canonical 状态

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

仅 WAITING_FOR_USER 或 BLOCKED 时填写：canonical 状态、类别、证据、已完成范围、恢复 SHA、连续阻塞计数（若适用）和用户最小动作。第一次需要用户输入必须是 WAITING_FOR_USER。
````

不得因为已完成大量工作就降低 Definition of Done。只有真实交付、测试、fresh review、证据和授权范围内的 Git 结果全部满足，非 `all` 才报告 `TARGET_COMPLETE`，`all` 才报告 `COMPLETE`；随后按 Goal API objective 调用 `update_goal(complete)`，并在显式 BUDGET 场景报告最终 usage。
