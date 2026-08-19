# S4 SwarmGoal、UltraRun 与 Writer Handoff

状态：**Preview source implementation** · 2026-08-19

S4 把 Kimi AgentSwarm 和 Claude Dynamic Workflows 的可复用理念落成
Pi-native contracts；它没有把 Pi 接入 Kimi Code，也没有复制一个新的物理
child scheduler。

## 设计边界

`@only-my-pi/subagents` 只有一个物理执行 owner：受版本锁定的
`pi-subagents@0.45.2` extension RPC。S4 新增的三层是逻辑控制面：

| 层 | 职责 | 不负责 |
| --- | --- | --- |
| `BatchSwarm` | 一个 AgentSpec 对同构 items 的 bounded map | 异构 DAG、动态角色、最终 verifier |
| `SwarmGoal` | 动态生成 AgentSpec/TaskAssignment，提交不可变 WorkflowPlan revision，观察覆盖率并收敛 | 直接 spawn、第二 scheduler、权限扩大 |
| `UltraRun` | 按任务规模与质量策略选择 Agent、BatchSwarm、Workflow 或 SwarmGoal | 直接执行 child、拥有预算/权限、替代 WorkflowPlan |

Kimi Code CLI 的 `AgentSwarm` 是同构 `prompt_template × items` 批处理；托管
Kimi/K2.5 的产品宣传展示了动态异构分解，但完整生产 scheduler 并非本仓库
可以当作开源 API 的事实。only-my-pi 因此吸收“动态角色、分解、重规划、
独立验证”的理念，以自己的 JSON IR 和审计合同实现。

Claude 的 Ultra/Dynamic Workflows 只贡献“高阶路由 + 多阶段质量流程”这个
产品概念。具体执行仍回到同一个 `RunCoordinator` 和同一个 append-only
event journal；不会引入任意 JS workflow。任何未来的脚本 DSL 必须先编译为
同一 WorkflowPlan IR。

## SwarmGoal 生命周期

```text
human-origin authorization
        │ goal/objective/input digest
        ▼
GoalAdmitted ──► Planner proposal (bounded JSON)
                       │ registered AgentTemplates only
                       ▼
             ResolvedAgentSpec × N (>=3, heterogeneous)
                       │
                       ▼
              immutable WorkflowPlan revision
                       │ journal proposal before execution
                       ▼
       RunCoordinator / pi-subagents physical backend
                       │
             fresh synthesizer → fresh verifier
                       │
       coverage / no-progress / critical-path evidence
              ┌────────┴────────┐
           complete          replan
```

每个 revision 有稳定的 child run ID（`<goalRunId>:r<revision>`）、独立的父级
BudgetLedger reservation、plan digest 和 verifier receipt。已经 settled、只读、
content-addressed 且带结果 digest 的节点可以在后续 revision 复用；复用节点
必须从新计划中删除，不能以“缓存”名义再次 dispatch。

Planner 输出严格限制为 JSON、256 KiB、注册的 AgentTemplate、明确的
`workflowDefinition`、覆盖率指标和 `replan|complete|blocked` 决策。动态目标
必须有 human-origin authorization；自动化触发没有该授权时直接
`SWARM_GOAL_HUMAN_AUTHORIZATION_REQUIRED`。

恢复时从同一 goal journal 重建 proposal、revision、reservation 和 child ID：

- proposal 已写入但 child 未开始：继续同一 child ID，不重新规划；
- revision 已 settled 但 root completion 尚未写入：根据 durable verifier/decision
  补写 terminal event，不重复执行；
- usage 超过 reservation：按 worst-case settle，写失败事件，不能截断成“成功”；
- journal lease 失效或 evidence 漂移：停止并 fail closed。

## UltraRun 路由

UltraRun 的 U0–U6 是质量/阶段证据库，不是七套 agent runtime：

- U0 intake/understand；
- U1 plan/design；
- U2 execute；
- U3 review；
- U4 verify；
- U5 integrate/handoff；
- U6 final receipt。

当前路由规则是可解释且有界的：小任务走 `agent`，同构大批走
`batch-swarm`，结构化多阶段走 `workflow`，显式 dynamic goal 才走
`swarm-goal`。`quick|standard|deep|critical` 质量策略会显式给出规模、成本
与 fresh-verifier 要求；缺少 scale、verifier、route capability 或 human
authorization 时返回 `UNAVAILABLE`/awaiting approval，而不是静默升级。

## Writer handoff

S4 只定义安全交接，不自动合并：

1. writer 必须是 `managed-worktree`、有完整 base commit、非空且不重叠的
   `allowedPaths/fileClaims`；
2. parent 必须提供 `parent-diff-verification` 的 ENFORCED receipt；
3. terminal 必须是 authoritative，并通过固定 test/integration gate；
4. handoff 状态固定为 `HANDOFF_ONLY`，由父会话审查 diff 后决定是否集成。

当前 Pi v1 backend 没有 per-path allowlist 的可证明 wire capability，因此
writer live dispatch 仍是 `UNAVAILABLE`。worktree 本身不是 path sandbox，也
不是 OS sandbox。

## 控制面与安全默认

离线命令：

```bash
node bin/omp.mjs swarm goal list
node bin/omp.mjs swarm goal plan research-release-goal --input-file /abs/input.json --json
node bin/omp.mjs ultra list
node bin/omp.mjs ultra plan ultra-deep --input-file /abs/input.json --json
```

`plan` 只读并返回 plan/authorization digest；`run` 必须带 `--yes` 和完全匹配
的 digest。没有注入受信 Pi session 的生产 CLI 明确返回
`LIVE_SWARM_GOAL_REQUIRES_PI_SESSION` 或
`LIVE_ULTRA_RUN_REQUIRES_PI_SESSION`，本阶段不伪造 live success。

目标、策略、输入文件都做 bounded JSON + `O_NOFOLLOW` 读取；事件、artifact、
approval、budget 和 writer handoff 只存 digest/低敏元数据。真实 Provider、
几百个并行 Pi session、远程 Kimi runtime、Team、任意 JS/self-modifying
workflow、自动 writer integration 均不在 S4 的默认能力内。

## 验证边界

S4 的 source gates 覆盖 schema/reference negatives、异构三 AgentSpec、replan
复用、root-settlement crash recovery、budget overrun、fresh verifier、Ultra
route、artifact immutability、writer claim conflict 及 offline control grammar。
它们使用注入 planner/executor、临时目录和固定 fixtures；不等价于真实模型
质量或真实 child terminal/cancel。真实 Pi/Provider/live writer 证据必须在 S5
单独授权后产生，未执行时只能写 `NOT_RUN_BY_POLICY`。
