# Codex Goal：开发 only-my-pi Subagents Orchestration v2 与 UltraRun

> Host：Codex `/goal`；不是 Pi prompt、skill、Mode、Workflow 或 slash command
> Canonical plan：`docs/plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md`
> Historical baseline：M0–M7 已完成；不得重写旧 Goal marker、milestone state、receipt 或历史定义

## 1. 调用方式

推荐：

```text
/goal Read codex/goals/develop-only-my-pi-subagents-ultrarun.md and execute it with TARGET=all, REPO=/absolute/path/to/only-my-pi, DELIVERY=local, PROMOTION=preview. Continue until the stopping condition is satisfied.
```

可选范围：

```text
TARGET=S0
TARGET=S0-S2
TARGET=S3
TARGET=S3-S4
TARGET=S5
TARGET=all

DELIVERY=local | push
PROMOTION=preview | alpha | beta | stable
```

默认：

```text
TARGET=all
DELIVERY=local
PROMOTION=preview
```

`TARGET` grammar 只允许单个 `S0`…`S5`、升序连续范围 `Sa-Sb` 或 `all`。范围表示请求的交付区间；effective dependency closure 永远从 S0 延伸到其最高 milestone。例如 `S3-S4` 的 closure 是 S0–S4，只重做缺失或 drift 的部分。降序、跳跃、未知或重复表达式在任何写入前拒绝。`PROMOTION=alpha|beta|stable` 只允许 TARGET closure 包含 S5；否则启动即报参数不一致，不静默扩大 TARGET。

如果 Codex host 已创建 active Goal，不得递归调用 `create_goal`。只有用户以普通自然语言启动、当前没有 active Goal，且系统提供 Goal API 时，才创建一次本 objective。`/goal` 已创建的 token budget 不能由本文件事后修改；接近预算时保存可恢复证据，不得伪造完成。

## 2. Target closure

```text
historical M0–M7: prerequisite evidence only; never reimplemented
S0: historical baseline + S0
S1: S0
S2: S1
S3: S2
S4: S3
S5: S4
all: S0–S5
```

请求单个 milestone 或范围时自动包含其 predecessor dependency closure，但不重新实现 M0–M7。若当前仓库已有部分 S milestone，先验证 evidence 和 drift，只做缺失部分。

Promotion gate：

| PROMOTION | 最低 live evidence |
| --- | --- |
| preview | 无 secret CI；真实 Provider 可为 `NOT_RUN_BY_POLICY` |
| alpha | 一个 read-only Agent terminal + cancel proof，以及一个至少 2 items 的 read-only BatchSwarm terminal；缺任一则不达 Alpha |
| beta | Alpha + background/resume + guarded worktree writer/integration |
| stable | Beta + 声明的 Pi/Node/pi-subagents compatibility matrix、soak、migration/rollback |

不得因 `PROMOTION=preview` 未跑 live Provider 而假称 Alpha/Beta/Stable。

## 3. Objective

在现有 Harness v1 之上，交付一个纯 Pi 原生、单 runtime owner、可审计、可恢复的统一多代理编排层：

```text
@only-my-pi/subagents
├── Agent
├── BatchSwarm
├── WorkflowDefinition / WorkflowPlan / WorkflowRun
├── SwarmGoal
├── UltraRun
├── RunCoordinator + Event/Artifact Store
├── Budget / Approval / Workspace / Provenance
└── PiSubagentsAdapter
      └── pi-subagents (唯一 physical child runtime)
```

必须实现 canonical plan 的 TARGET closure、测试、文档、迁移和证据。不得接入 Kimi runtime；Kimi/Claude/DeepSeek 等只作为固定源码、论文和公开合同参考。

## 4. 开始前强制核验

Lead 必须亲自读取：

- canonical successor plan；
- historical `docs/plans/2026-08-16-only-my-pi-development-plan.md` 与旧 Codex Goal；
- `README.md`、`docs/STATUS.md`、`SECURITY.md`、threat model；
- `package.json`、lockfile、release gate manifest；
- `packages/workflow-core`、`packages/swarm-core`、`packages/pi-subagents-adapter`、`packages/control-service`、`extensions/omp-control`；
- `agents/`、`workflows/`、`swarm/recipes/`、相关 schemas/contracts/tests；
- current branch/HEAD/remote/worktree、最近提交和 M7 receipt；
- 与 TARGET 相关的官方固定源码/版本。

先建立 current-state gap map：哪些已经存在、哪些只是 fake/injected、哪些 runtime unavailable、哪些已 drift。不得根据旧报告硬编码测试数、版本、SHA 或 capability。

## 5. 历史与 Git 边界

- M0–M7 是完成的 v1 历史，不修改其 marker/state/receipt 以伪装 v2；
- 新 Goal 使用独立 objective family、goalRunId、feature branch 和 evidence root；
- 默认 branch：`codex/subagents-ultrarun-v2`；若已有同 objective 且 marker/ancestry/evidence 匹配，可恢复；否则创建新的 `codex/...` branch；
- evidence root 固定为：`verification/successor/<goalRunId>/`；
- S0–S4 每个 milestone：先形成 clean source commit，再形成 state-only commit；S5 final receipt 使用 source commit + receipt-only commit；
- 不修改 main、不 force push、不改写历史；
- `DELIVERY=local` 不触碰 remote；`DELIVERY=push` 只非强制 push feature branch，并对账 remote SHA；
- publish/tag/release/PR 仍需用户新授权，PROMOTION 只定义证据要求，不等于授权发布；
- 用户已有修改必须保留；发生目标文件重叠且无法安全区分时暂停请求方向。

Tracked recovery evidence 固定为：

```text
verification/successor/<goalRunId>/goal.json
verification/successor/<goalRunId>/S0.json ... S4.json
verification/receipts/<date>-subagents-ultrarun-v2.json   # S5 receipt only
```

`goalRunId` 是 lowercase UUID。`goal.json` 是 marker-only 首提交，第一父提交必须等于记录的 base commit；字段至少含 `schemaVersion/objectiveFamilyDigest/goalContractDigest/planDigest/goalRunId/repositoryIdentity/branch/baseBranch/baseCommit/initialTarget/effectiveClosure/delivery/promotion/createdAt/markerHash`。Hash 使用 canonical JSON 并排除自身；不得写 raw prompt、reasoning、secret、host path、current HEAD 或自引用 commit。

恢复时必须找到且只找到一个 family/branch/repository/ancestry/hash 全匹配 marker；否则 fail closed。S0–S4 state 必须连续，记录 markerHash、requested/effective target、promotion、sourceCommit、suite/version/digest、gate statuses、completedAt、nextMilestone 和 stateHash；state-only commit 的第一父提交必须等于 sourceCommit。Goal/plan/schema/source pin 或 milestone gate drift 使对应 milestone 和 downstream 失效，但不得覆盖旧 state。S5 使用新的 source commit + receipt-only child commit；恢复逻辑不得修改历史 M7 evidence。

## 6. 授权边界

### 已授权

- 在目标仓库创建/修改源码、测试、schema、docs、fixtures、CI 和 package metadata；
- 添加最小、必要、锁定的开发依赖；
- 使用临时目录、隔离 config root、fake/injected backend、no-model Pi smoke；
- 调用 public official-source network 进行必要、当前版本核验；
- 使用 Codex 开发子代理并行研究、实现和独立审查；
- 创建 feature branch、原子提交；仅在 `DELIVERY=push` 时非强制 push。

### 未授权

- 读取、写入或提交真实 credentials、OAuth、sessions、memory DB、cache；
- 修改真实 `~/.pi`、全局 Pi/npm 包或用户模型配置；
- 发送真实 Provider 请求，除非用户在执行该 Goal 时另行明确授权；
- npm publish、Git tag/release、PR、main push、force push；
- 删除/覆盖用户数据；
- 安装/启用 Kimi/Claude/Codex/ACP runtime 作为产品 backend；
- 默认启用 Team、任意 JS Workflow、nested swarm、YOLO、浏览器 cookies、remote shell、Cron/self-mod；
- 把 VM/worker/worktree/Project Trust/prompt/tool visibility 冒充 OS sandbox。

没有 Provider 授权时，live gates 写 `NOT_RUN_BY_POLICY`。Preview 可以完成，但不能 promotion 为需要 live evidence 的 channel。

## 7. 核心不变量

### 7.1 Owner

```text
physical child/session/worktree runtime owner count == 1
owner == pi-subagents

first-party orchestration facade/RunCoordinator owner count == 1
owner == @only-my-pi/subagents

WorkflowPlan/DAG/journal/resume owner count == 1
```

only-my-pi 可以管理 logical plan、ready-node admission、budget、approval、state 和 aggregation；不能 fork child process、实现第二 physical pool/semaphore、导入 upstream `src/**` 或注册重叠通用 `subagent` owner。

### 7.2 Taxonomy

- AgentTemplate：审核上界；
- ResolvedAgentSpec：某次 dispatch 的不可变、收窄快照；
- TaskAssignment：具体任务/依赖/ownership/budget；
- BatchSwarm：同一 AgentSpec + template × items；
- WorkflowPlan：唯一异构 DAG execution representation；
- SwarmGoal：动态生成 immutable plan revisions；
- UltraRun：多 Workflow 路由、阶段、总预算和 quality policy；
- Team：不在本 Goal scope。

任意异构 DAG 不得标为 BatchSwarm。模型 reducer/synthesizer/judge/verifier 都必须是显式 Agent node；deterministic aggregator 不得隐藏模型调用。

### 7.3 Permission

```text
effective = OS/container ∩ Project Trust ∩ Profile ∩ Mode ∩
            Ultra/Goal policy ∩ Plan node ∩ AgentSpec ∩ Assignment ∩ approval
```

deny 优先；dynamic AgentSpec、resume、replan、child result、tool output 不能扩权。无法投影的 hard requirement 必须 `UNSUPPORTED/RESTART_REQUIRED/UNAVAILABLE` 并 admission fail closed。

### 7.4 Plan and approval

- WorkflowPlan revision immutable；
- replan 产生 revision N+1 + parent hash + diff + reason；
- 同一 root run 只有一个 ACTIVE revision；N+1 通过关闭旧 admission、settle/stop active attempts、重新校验并 CAS 激活，不能双 revision dispatch；
- settled nodes 只有 cache key 完全匹配才复用；
- approval 绑定 plan/policy/workspace/baseCommit/paths/writer/budget/delivery digests；
- 每个包含 mutating node 的 revision 都按 exact digest 重新批准；
- 纯只读 revision 只有在原 approval 的 digest-bound bounded replan envelope 内才可免交互；任何 widening 都不在该 envelope 内；
- `--yes` 只能批准用户刚看到的 exact digest；child 和恢复逻辑不能代批。

### 7.5 State and cancel

- 单写者 lease/fencing + monotonic hash-chained events + atomic materialized snapshot + typed artifacts；
- local/backend IDs 显式映射；
- 每个 start 恰有一个 authoritative terminal；
- duplicate/late/out-of-order events 幂等；
- cancel 先关闭 admission，再停止 active child，等待 correlated terminal proof；
- 无 terminal proof 为 `interrupted/orphaned`，不是 `cancelled`；
- side-effect node 无 idempotency proof 不透明重放。

### 7.6 Writer

- shared cwd writer ≤ 1；
- parallel writers 必须 managed worktree；
- ownership/baseCommit/allowed paths/handoff digest；
- overlap fail closed；
- single integrator + integration checkout verifier；
- worktree 不等于 OS sandbox；
- parent fallback writer 也必须重新批准并保持唯一 writer。

## 8. Codex 研发子代理边界

Codex 开发子代理不是产品 child，也不通过 `pi-subagents`。Lead 最多并行使用平台允许的开发代理，并为每个任务声明：

```text
owned paths
read/write scope
forbidden Git/remote/Goal evidence mutations
no credentials / real Pi home / live Provider
finite timeout/turns
expected artifacts/tests
```

writer 必须知道自己不是唯一 Agent，不得回滚他人修改。子代理不 commit/push/切换 branch/写 marker/receipt。Lead 集成前检查 changed paths、拒绝 envelope 外 diff、运行 focused tests 和独立 review。

不得把 Codex 开发子代理的成功冒充产品 Agent/Batch/Workflow live E2E。

## 9. S0–S5 execution summary

### S0 — Evidence/ADR/Threat/Eval

- source pins/dossiers、license/reuse decision；
- taxonomy/single-owner/typed-IR/event-idempotency/writer/migration ADR；
- v2 schemas + semantic fixtures；
- successor threat model；
- deterministic simulator + eval corpus；
- Preview/Alpha/Beta/Stable claim matrix。

### S1 — Facade/Adapter/Agent

- `@only-my-pi/subagents` facade；
- exact 0.45.2 statement-body RPC conformance；
- BackendCapabilityV2 matrix；缺 rate-limit/dynamic-concurrency/worktree 等 public evidence 时明确 DEGRADED/UNAVAILABLE；
- Agent lifecycle、backend ID map、terminal receipt、journal；
- status/steer/interrupt/stop/resume/dispose；
- policy re-evaluation、structured output；
- control-service dependency inversion；
- single public/physical owner topology test。

### S2 — WorkflowPlan v2/RunCoordinator/Migration

- Definition→Plan compiler、primitive nodes、single RunCoordinator；
- event/artifact store、pause/resume/cache/restart-node；
- writer lease/fencing、event seq/digest、atomic snapshot、stale-writer recovery；
- parent budget reservation/consumption/refund ledger；hard token/cost 不可计量时 METERING_UNAVAILABLE；
- Gate/checkpoint/approval/bounded loop；
- v1 workflow/recipe translator 和四个 recipe migration；
- old controllers/imports 退为 facade；
- deterministic/fault/recovery/migration tests。

### S3 — BatchSwarm

- template×items、stable ledger、ramp、429 adaptive capacity；
- backend 不支持 rate-limit/dynamic concurrency 时 static degradation 或 ADAPTIVE_CAPACITY_UNAVAILABLE，不创建第二 scheduler；
- finite retry、failure policies、resume item/Agent IDs；
- Workflow batch node、context sharding、usage/provenance；
- batch CLI/TUI；
- 1/8/20/64/300 logical simulation、cancel/fault tests。

### S4 — SwarmGoal/UltraRun/Writer/Quality

- dynamic constrained AgentSpec/Assignment；
- bounded immutable plan revisions、coverage/convergence、critical path；
- U0–U6 Ultra workflows；
- quality policies、finding verification；
- exact revision approval，并消费 S2 parent budget ledger；
- worktree writer/integrator/final verifier；
- goal/ultra CLI/TUI；
- human-origin high-risk trigger enforcement。

### S5 — Security/Live/Fault/Compat/Release readiness

- property/fault/security/quality-cost eval；
- compatibility matrix、protected live gates、soak/leak/orphan tests；
- migration/rollback/fresh tarball；
- release-gates-v2；
- README/STATUS/SECURITY/API/migration/changelog；
- new source/receipt evidence and promotion-specific verdict。

详细任务和退出门禁以 canonical plan 为准；摘要不得降低其 DoD。

## 10. 强制开发流程

每个增量：

```text
Orient current code/evidence
→ state invariants and owner boundary
→ negative tests first
→ smallest implementation
→ focused tests
→ related regression
→ independent review
→ full milestone gates
→ atomic source commit
→ milestone evidence state
```

Deviation：

- 当前实现与计划冲突时，以安全、单 owner、公开 contract 和实际代码证据为准，记录 ADR；
- 外部版本/API 漂移先更新 source pin/fixture，不基于 HEAD 猜测；
- 发现 P0/P1 安全/一致性问题必须修复后再推进；
- 未授权 live/provider/remote 操作不得用 mock 冒充；
- 不能为了测试绿色降低 invariant 或删除负面 fixture。

## 11. Verification

先从 `package.json` 和 release manifest 发现命令。至少覆盖：

- schema/typecheck/lint/doctor/profile/mode/pack/secret/diff；
- owner/import/public API topology；
- Workflow IR/property/state machine；
- journal crash/recovery、terminal proof、late event；
- Batch ordering/429/cancel/large logical queue；
- approval/policy/budget/workspace drift；
- security red team、writer conflict/escape、output bomb；
- v1→v2 migration/rollback；
- versioned non-vacuous offline orchestration eval：fixture digest、seed、repetitions、baseline 和 thresholds；
- disposable tarball fresh install；
- promotion-required protected live gates。

真实 Provider 测试使用临时、受保护的 secret source；永不写入仓库/CI log。没有授权时不调用。

## 12. Stopping conditions

只允许以下终态：

- `TARGET_COMPLETE`：请求 TARGET、effective dependency closure、请求的 PROMOTION 门禁和 DELIVERY 全部满足；
- `COMPLETE`：TARGET=all、S0–S5、PROMOTION 对应门禁和 DELIVERY 全部满足；
- `WAITING_FOR_USER`：需要新增 authority 或会改变架构方向的用户决定；
- `BLOCKED`：同一阻塞按 Goal API 规则重复达到阈值且无法继续；
- `FAILED`：安全或一致性门禁无法修复且有明确证据。

不得以“写了计划/大部分代码/测试很多/预算将尽/只剩 live 未授权”冒充完成。Preview 的 live gate可以 `NOT_RUN_BY_POLICY`，但 final report 必须把 promotion 固定为 Preview。

## 13. Final report template

````markdown
# only-my-pi Subagents v2 Goal Report

## Goal
- Goal run / objective family：
- TARGET / dependency closure：
- PROMOTION requested / achieved：
- DELIVERY：
- Historical M0–M7 preserved：是/否

## Delivery
- Evidence/ADRs/schemas：
- @only-my-pi/subagents facade：
- Agent/PiSubagentsAdapter：
- WorkflowPlan/RunCoordinator/journal：
- BatchSwarm：
- SwarmGoal：
- UltraRun/quality policies：
- Writer/integration：
- Migration/compatibility：
- CLI/TUI/status：

## Owner invariants
- Physical child owner：
- First-party RunCoordinator owner：
- DAG/journal/resume owner：
- Public model tool topology：

## Verification
| Gate | Result | Evidence/command | Count |
| --- | --- | --- | ---: |
| Full tests | PASS/FAIL | ... | ... |
| Schemas/semantics | PASS/FAIL | ... | ... |
| Owner/public API | PASS/FAIL | ... | ... |
| Fault/recovery | PASS/FAIL | ... | ... |
| Security red team | PASS/FAIL | ... | ... |
| Offline eval | PASS/FAIL | ... | ... |
| Migration/rollback | PASS/FAIL | ... | ... |
| Fresh tarball | PASS/FAIL | ... | ... |
| Live read-only | PASS/FAIL/NOT_RUN_BY_POLICY | ... | ... |
| Live writer | PASS/FAIL/NOT_RUN_BY_POLICY | ... | ... |
| Compatibility/soak | PASS/FAIL/NOT_IN_TARGET | ... | ... |

## Git/evidence
- Branch：
- Source commits：
- State commits：
- Receipt commit：
- Final local/remote SHA：
- Remote CI：

## Safety
- Real Pi home unchanged：
- Credentials untouched：
- No Kimi/second runtime：
- Worktree/sandbox claims accurate：
- User changes preserved：
- No unauthorized publish/tag/release/main/force push：

## Deferred Labs
- Team：
- JavaScript Workflow：
- Other backends：
- 1000-task live scale：

## Reproduction
```bash
<commands discovered from current manifest>
```

## Remaining risks / blockers
- ...
````

完成后，如果这是 active Goal 且 objective 已真实满足，才调用 Goal API `update_goal(complete)`；有显式 host token budget 时报告最终 usage。
