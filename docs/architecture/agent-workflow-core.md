# Agent / Workflow Core（M4）

M4 把 only-my-pi 从“有 Mode 契约和控制入口”推进到可执行的单 Agent
Workflow 层。它仍然是 Pi 的发行层，不替换 Pi 的 agent loop、Provider、session
或 built-in tools；M5 已把物理 child dispatch 的唯一候选接到受治理的
`pi-subagents` extension-RPC 适配器，但本页的 parent-session runner 仍是
单 Agent fallback。

> Successor note（2026-08-18）：本页描述的 v1 runner/controller 现为直接导入
> 兼容层。`omp workflow`、`omp swarm` 与 `/omp` 公共入口已将 v1 资源翻译成
> WorkflowPlan，并且只把 live execution 交给 `packages/subagents/` 的统一
> RunCoordinator；plan 阶段分配稳定 run ID，并把输入快照和目标绑定到执行包络，
> run 阶段必须原样复用。缺少统一 runtime 或实时审批证据注入时 fail closed。v1
> 模块尚未删除，不能把这一阶段描述成完整的 restart-safe S2 promotion。

## 组成

### Agent Registry

`packages/agent-registry/index.mjs` 发现 `agents/*.json`，校验版本化 manifest，
加载同一仓库内的 prompt，拒绝绝对路径、`..`、符号链接和过大的 prompt，并按
Profile capability/policy ceiling 做二次收窄。每个解析结果带有 manifest/prompt
source hash；`createAgentReceipt()` 只输出 role、工具、policy 和 gate 摘要，不保留
原始 prompt、reasoning、凭据或主机绝对路径。

M4/M5 内置角色：

`scout`（M1 contract-only）、`explorer`、`planner`、`implementer`、`debugger`、
`reviewer`、`researcher`、`verifier`，以及 M5 的 `source-verifier`、
`synthesizer`、`tester`、`security-reviewer`、`test-analyst`。JSON 是
canonical source；
`scripts/generate-subagent-resources.mjs` 生成带 `omp-` namespace 的
Pi-subagents Markdown 资源，生成结果必须通过 hash 对账，bootstrap 不在用户目录
中改写它们。

### Workflow Registry

`packages/workflow-core/index.mjs` 只接受 v1 JSON Workflow。Registry 验证：

- step id 唯一、依赖存在且无环；
- action 只允许 `agent`、`gate`、`swarm`；
- terminal dependency chain 必须包含固定 Gate；
- fallback 必须指向已知 Workflow；
- `maxSteps`、output bound 和 cancellation/recovery 契约必须存在。

v1 不求值任意表达式，也不执行 manifest 中的脚本。Gate id 由
`verification/release-gates-v1.json` 固定解析，不能由任务文本提供 command/argv。

### SingleAgentWorkflowRunner

M4 的首个 backend 是 parent-session runner：

1. 解析 Workflow source hash，并把 run 写入注入的 `stateStore`；
2. `planned → admitted → running` 后按确定性拓扑顺序执行未结算 step；
3. `agent` step 使用注入的 `agentExecutor` 或显式 parent-session `runAgent` seam；
4. `gate` step 只调用 Gate Runner；
5. 结构化结果和低敏 receipt 驱动下一步，不能用自由文本冒充 gate 通过；
6. 所有阶段、状态迁移、source hash 和 terminal verdict 都可恢复/检查。

没有 parent executor 时返回 `AGENT_EXECUTOR_UNAVAILABLE` 和 `blocked` verdict，
绝不伪造模型执行。`swarm` step 在 M5 adapter 前同样返回 `SWARM_UNAVAILABLE`，
再按 manifest 的显式 fallback 走 `single-agent-safe`。

取消是两阶段语义：调用 `cancel(runId)` 先持久化 `stopping` 并 abort 当前 parent
controller；只有 in-flight executor/gate 返回后，runner 才写入 `cancelled` terminal
proof。队列中尚未开始的 step 不会被新调度；`dispose`/进程退出时的未结算状态保留
为可恢复证据。取消不会自动重试或运行 reducer/verifier。

### Deterministic Gate Runner

`packages/gate-runner/index.mjs` 只接受 release-gates v1 中的固定 command/argv，
并强制：

- `shell:false`、仓库内固定 cwd；
- timeout、输出字节上限和 AbortSignal；
- bounded digest-only receipt；
- 无 arbitrary Bash、无 task-provided argv、无凭据注入。

Gate Runner 的 `network: "deny-by-contract"` 是 runner 合同和 npm/CI 环境变量层面的
边界，不等价于操作系统网络隔离；若任务需要真正隔离，仍需容器、VM 或其他 OS
边界。

## 首发 Workflow

- `plan-build-review`：planner → schema gate → implementer → reviewer → full-tests；
- `research-report`：researcher → source-verifier → synthesis gate；研究 Mode 默认
  cookies=false，并把 web egress 交给独立 owner；
- `review-findings`：reviewer → diff gate，全程只读；
- `debug-fix-verify`：debugger/review/gates，任何修复都要求显式批准并使用
  guarded writer contract；
- `single-agent-safe`：缺少 child/runner capability 时的串行、无 Swarm fallback，
  其 M1 seed 仍保留 `contract-only` 生命周期。

所有 Workflow 都声明 entry conditions、mutation scope、budget、failure、cancel 和
resume 语义。M5 的 `swarm` action 由 `packages/swarm-core` 编译并交给
`packages/pi-subagents-adapter`；only-my-pi 不启动第二个调度器，也不导入
私有 delegation API。

## Skills 与 repo-map seam

`packages/skills-bridge` 读取受信的 `.agents/skills`，报告同名冲突并按
project > user > explicit precedence 选择；不受信项目和符号链接默认拒绝。它只
提供发现/读取 seam，不自动执行 SKILL.md 中的脚本。

`packages/repo-map` 是 Aider 风格的注入接口：indexer 负责提供符号和引用分数，
adapter 进行确定性排序、token/byte bound 和 digest。M4 不绑定 tree-sitter 或某个
索引器，避免把语言服务和 Pi runtime 耦合。

## 验证边界

M4 的 injected-runner 测试覆盖拓扑顺序、结构化 gate receipt、source drift、
unavailable fallback、取消和恢复；M5 另外覆盖 capability handshake、permission
projection、fake runtime、cancel/partial-failure 和 workflowScript injection。
Pi no-model smoke 只证明打包资源可发现、扩展命令可注册、控制面映射不重复；它
不调用 Provider、不读取 auth、不证明第三方扩展或整个 session 已被 sandbox。没有
注入 Pi RPC transport 时，Swarm `run` 明确返回
`LIVE_SWARM_REQUIRES_PI_SESSION`。真实 child dispatch 需要用户另行授权并提供
Pi session。
