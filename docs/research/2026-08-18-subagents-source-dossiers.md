# Subagent, Workflow, and Swarm source dossiers

> Snapshot date: 2026-08-18
> Status: S0 implementation baseline
> Scope: source-backed behavior contracts for `@only-my-pi/subagents`
> Normative architecture: [ADR-0005](../decisions/ADR-0005-unified-subagents-runtime.md) and [ADR-0006](../decisions/ADR-0006-workflow-ir-event-state.md)

## 1. Purpose and interpretation rules

This dossier separates facts that can be implemented and tested from product
claims that are useful only as design input. It is not an integration plan for
Kimi Code, Claude Code, DeepSeek Harness, or any other agent harness.

The first release has one non-negotiable runtime boundary:

> Exact `pi-subagents@0.45.2` is the only physical child-session, process, and
> worktree runtime. `@only-my-pi/subagents` is the logical orchestration facade
> and never creates a second physical worker pool.

Evidence is classified as follows:

| Tier | Evidence | Permitted use |
| --- | --- | --- |
| A | Official source at a full commit, signed/released package metadata, protocol schema, tests, or an official technical report | Implementation contract, fixture, and conformance gate |
| B | Mutable official product documentation for a runtime whose implementation is not published | Product semantics and UX inspiration; never proof of an internal scheduler or wire contract |
| C | Audited community source at a full commit under a compatible license | Failure-mode and algorithm reference; clean implementation required unless provenance is recorded |
| D | Forum post, copied prompt, benchmark anecdote, reverse engineering, or unreproducible marketing | Discovery lead only; excluded from an implementation or release claim |

Rules for consuming the table and dossiers below:

1. A pinned source describes only the cited revision. A later release requires a
   new audit rather than silent reinterpretation.
2. A behavior inspired by another harness is implemented against only-my-pi's
   own versioned JSON contracts. It does not imply API, file-format, resume, or
   permission compatibility.
3. Product limits are snapshots, not our defaults. only-my-pi derives limits
   from local capability, policy, metering, and explicit approval.
4. Source text, prompts, results, repository files, and child messages are
   untrusted data. None can widen tools, workspace, egress, budget, or fan-out.
5. Directly copied code requires a file-level provenance record, license
   preservation, and any required NOTICE. Behavioral reimplementation is the
   default.

## 2. Pin and provenance matrix

| Source | Tier | Audited identity | License / availability | Normative use in only-my-pi | Integration status |
| --- | --- | --- | --- | --- | --- |
| [`pi-subagents`](https://github.com/nicobailon/pi-subagents) | A | npm `pi-subagents@0.45.2`; package `gitHead` `7836c0f5ef642a00ae0572c910dec7a56216c74d`; SRI `sha512-VEvBF6vrpi+eLEjhgwqutSnaH/aw58+Um9vdJUc6Td1asH22bAKahrgD3AafaRNsROgiaukw4DRdmlRjEhBxQA==`; tarball SHA-256 `fb247e0d45f130d0f3f53efb63a95c56e417d8579af5ba2ba2f211b322701374` | MIT | Sole physical backend and public RPC v1 compatibility target | Required runtime dependency; adapter only |
| [Kimi Code](https://github.com/MoonshotAI/kimi-code/tree/13d86f8b7bb2443a3b8222e7d94deb0a66429f8e) | A | npm `@moonshot-ai/kimi-code@0.36.1`; tag commit `13d86f8b7bb2443a3b8222e7d94deb0a66429f8e`; SRI `sha512-dAYvA0qIZ/nPOtf+8X0axRP3Supa06oP9xK/JlY/DsrID5IVmDRc2fKTdASNBvSs1XPUbPFwD1cDNXMoEDQfEA==` | MIT | Homogeneous BatchSwarm schema, ordered aggregation, cancellation, rate-limit-aware queue behavior | Reference only; no Kimi runtime or package dependency |
| [Kimi hosted Agent Swarm](https://www.kimi.ai/help/agent/agent-swarm) | B | Mutable official help page, retrieved 2026-08-18 | Hosted product; production scheduler source not established as published | UX and goal-level dynamic swarm vocabulary only | Reference only |
| [Kimi K2.5 technical report v2](https://arxiv.org/abs/2602.02276) | A for the report's claims | arXiv `2602.02276`, version 2, retrieved 2026-08-18 | Paper and released model artifacts do not expose the hosted production scheduler | Dynamic heterogeneous decomposition, specialist assignment, context sharding, critical-path reasoning | Clean-room concept adoption only |
| [Claude Code Dynamic Workflows](https://code.claude.com/docs/en/workflows) | B | Mutable official page, retrieved 2026-08-18 | Proprietary product runtime; source not published by the cited page | UltraRun routing, workflow-scale taxonomy, quality patterns, operator UX, documented limits/failure semantics | Reference only; no claimed compatibility |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca) | A | commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`; root version `0.1.0-rc.7` | MIT; developer preview | Capability seam, one subsystem owner, fail-loud negotiation, typed lifecycle, durable-prefix/event observations | Reference only; no plugin host or backend dependency |
| [`pi-dynamic-workflows`](https://github.com/QuintinShaw/pi-dynamic-workflows/tree/f1e05aa766b729788e9c53892cfa0dd940aa36e1) | C | npm `@quintinshaw/pi-dynamic-workflows@3.6.0`; commit/gitHead `f1e05aa766b729788e9c53892cfa0dd940aa36e1`; SRI `sha512-jZhrwI9YabOv325T6rprLhx7f8D991XXxaFt77AzkGWCBaD42Dqg6B0BnCPW9j5mydxj+otXJQHy79aoJWUOdA==` | MIT | DSL/quality-helper and failure-mode research | Explicitly not loaded as a production scheduler |
| [OpenHands Software Agent SDK](https://github.com/OpenHands/software-agent-sdk/tree/98338ff37aea6627777b9978963ab727f51e4f40) | A | commit `98338ff37aea6627777b9978963ab727f51e4f40` | MIT | Event-store and isolated-workspace reference | Reference only |
| [Cline](https://github.com/cline/cline/tree/d4b415f8abc0ba242eaa4795b4c190d7a8dbc8d1) | A | commit `d4b415f8abc0ba242eaa4795b4c190d7a8dbc8d1` | Apache-2.0 | Subagent progress, checkpoint review, and worktree UX reference | Reference only |
| [OpenCode](https://github.com/anomalyco/opencode/tree/65c35977bd564e23c0e9cf124b3e3e3b9308e9e8) | A | commit `65c35977bd564e23c0e9cf124b3e3e3b9308e9e8` | MIT | Agent/profile, permission, and session-state reference | Reference only |
| [Codex](https://github.com/openai/codex/tree/ede5247893a50297a47c9aa5038e6ab28312ff50) | A | commit `ede5247893a50297a47c9aa5038e6ab28312ff50` | Apache-2.0 | Typed thread/turn handles, approval, interrupt, and usage-accounting reference | Reference only |
| [Goose](https://github.com/block/goose/tree/7c4ba2219166700becb68d6db35989ebcaa52f69) | A | commit `7c4ba2219166700becb68d6db35989ebcaa52f69` | Apache-2.0 | Recipe manifest, subagent task configuration, permission, and session UX reference | Reference only |

The exact `pi-subagents` byte and wire audit is recorded separately in
[`pi-subagents-0.45.2.md`](../compatibility/pi-subagents-0.45.2.md). That record,
not repository HEAD, is the release compatibility authority.

## 3. Kimi: two distinct meanings of "Agent Swarm"

### 3.1 Kimi Code `AgentSwarm` is a homogeneous batch primitive

The open Kimi Code CLI implementation at the pinned commit provides a concrete
and auditable BatchSwarm contract:

- [`agent-swarm.ts`](https://github.com/MoonshotAI/kimi-code/blob/13d86f8b7bb2443a3b8222e7d94deb0a66429f8e/packages/agent-core/src/tools/builtin/collaboration/agent-swarm.ts)
  accepts one `subagent_type`, an optional common model, one
  `prompt_template` containing `{{item}}`, and an item array;
- the same resolved worker kind is applied to every item; this is a map, not an
  arbitrary heterogeneous DAG;
- the pinned schema bounds a call to 128 items, requires at least two new items
  when not resuming, rejects duplicate resolved prompts, and supports mapping
  items to prior agent identifiers for resume;
- the tool is foreground aggregation: it waits for the batch and reports
  completed, failed, aborted, and not-started outcomes rather than hiding
  failures;
- [`subagent-batch.ts`](https://github.com/MoonshotAI/kimi-code/blob/13d86f8b7bb2443a3b8222e7d94deb0a66429f8e/packages/agent-core/src/session/subagent-batch.ts)
  preserves input-order results while separately managing dispatch order;
- the queue ramps initial work rather than starting all items at once,
  classifies Provider rate-limit failures, requeues with the same agent identity,
  backs capacity down and later recovers it, and distinguishes cancellation of
  started work from work that never started;
- the official [Kimi Code tool reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/tools.html)
  also documents the single-tool-call requirement, foreground progress,
  permissions, and resume behavior.

only-my-pi adopts the following observable contract, not the implementation:

```text
BatchSwarm = one immutable ResolvedAgentSpec
           + one bounded prompt template
           × ordered items
           → one explicit result slot per input item
```

Stable result order, explicit terminal classification, bounded fan-out, and
same-logical-agent retry are normative. Kimi's numeric limits, timing constants,
environment-variable names, session format, and Provider-specific classifier
are not.

### 3.2 Hosted Kimi Swarm and K2.5 describe a dynamic goal orchestrator

Kimi's hosted help page describes a Commander that creates and coordinates many
specialists. The K2.5 report describes self-directed parallel orchestration,
dynamic decomposition, specialist instantiation and assignment, independent
working memories, task-relevant result routing, and critical-step accounting.
The report explicitly presents `create_subagent` and `assign_task` as
orchestration actions.

Those facts justify only-my-pi's separate `SwarmGoal` concept:

- heterogeneous, immutable `ResolvedAgentSpec` values;
- bounded `TaskAssignment` creation;
- a versioned `WorkflowPlan` shared with predefined Workflow;
- context shards that return bounded typed artifacts rather than complete child
  transcripts;
- coverage/convergence policies plus an explicit verifier node;
- plan revision rather than in-place mutation.

They do **not** establish the hosted production scheduler's source, wire
protocol, persistence model, permission enforcement, recovery semantics, or
ability to run locally. only-my-pi does not call, embed, emulate, or claim
compatibility with that scheduler. Hosted concurrency/step-count marketing is
not a safe local default and must never bypass local admission.

### 3.3 Required terminology test

Every public resource and test must preserve this distinction:

| Term | Allowed meaning | Rejected meaning |
| --- | --- | --- |
| `BatchSwarm` | Homogeneous map over bounded items | A dynamic heterogeneous planner |
| `SwarmGoal` | Dynamic heterogeneous goal decomposition compiling to WorkflowPlan revisions | Direct spawning outside the RunCoordinator |
| `AgentSwarm` in a Kimi Code citation | The pinned homogeneous CLI tool | The hosted Kimi scheduler |
| `Kimi hosted Swarm` | Official product behavior claim | An open-source runtime integrated by only-my-pi |

## 4. Claude Code: Dynamic Workflows and `ultracode`

The official Dynamic Workflows page is a mutable product contract, not source.
At the snapshot date it states:

- a workflow is a JavaScript script written for the task and executed by a
  background runtime;
- the script, rather than the conversational model, holds branching,
  intermediate results, and repeatable quality patterns;
- subagents suit a few delegated tasks, teams suit a handful of long-lived
  peers, and workflows suit dozens to hundreds of tasks;
- `ultracode` combines `xhigh` reasoning effort with automatic workflow
  orchestration and may route one request through multiple workflows such as
  understanding, change, and verification;
- the documented runtime limit is 16 concurrent agents and 1,000 total agents
  per run at this snapshot;
- ordinary mid-run user input is not supported; sign-off stages should be split
  into separately approved workflows;
- resume is same-session and uses prefix replay: work after the first unfinished
  started agent may rerun;
- a workflow script cannot directly access filesystem or shell; agents perform
  those actions through normal tool checks;
- human-origin trigger handling, permission prompts, background controls,
  token visibility, and script review are product-specific behavior.

only-my-pi adopts the product idea of an upper policy that can choose and chain
multiple workflows. It names that policy `UltraRun` and deliberately changes
the implementation contract:

- `UltraRun` is not a model, reasoning-effort value, permission Mode, or
  scheduler;
- `UltraRun` routes to one or more approved `WorkflowDefinition` values, each
  compiled to the canonical JSON IR;
- a model may propose a definition or revision, but arbitrary JavaScript is not
  executable in S0-S5;
- restart recovery is event-ledger based and does not claim Claude's same-session
  prefix-replay behavior;
- Claude's documented permission widening for workflow children is not copied.
  only-my-pi always computes the deny-wins permission intersection and requires
  exact reapproval for mutations or scope expansion;
- numeric scale is policy input, never a compatibility promise.

The release documentation must use “inspired by Claude Code Dynamic Workflows”
and must not use “Claude-compatible workflow,” “Claude Ultra mode,” or any claim
that the unpublished runtime was reproduced.

## 5. DeepSeek Harness subsystem findings

The pinned DeepSeek Harness revision is a developer-preview implementation. Its
subagent and workflow documents are useful because they make ownership and
failure semantics explicit:

- [`subagent.md`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/subsystems/subagent.md)
  defines subagent as an optional context capability rather than the main agent
  loop; provider capabilities are checked before start and unsupported behavior
  fails loudly;
- a child has a durable identity but at most one live activation; continuation,
  inbox ordering, parent authority, interrupt, cancellation, and terminal state
  are distinct concepts;
- [`workflow.md`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/subsystems/workflow.md)
  assigns one workflow-engine implementation to a context, distinguishes
  ordinary child failure from fatal configuration/capability failure, and
  exposes observation snapshots without granting mutation authority;
- its worker-thread and `vm` boundary is not an OS security sandbox;
- durable event records are required to form a legal continuous prefix, and
  cancellation/disposal are bounded lifecycle operations.

Adopt:

- optional capability discovery with `SUPPORTED | DEGRADED | UNAVAILABLE`;
- fail-loud capability negotiation before admission;
- one subsystem owner and one live activation per physical handle;
- typed lifecycle states and ordinary-versus-fatal error classes;
- immutable observation events and continuous-prefix recovery.

Do not adopt:

- a DeepSeek plugin host or second backend;
- its context/provider interfaces as only-my-pi's public API;
- worker-thread or Node `vm` as a security boundary;
- preview implementation details without versioned local contracts.

## 6. Physical runtime dossier: `pi-subagents@0.45.2`

The exact package exposes extension RPC v1 methods `ping`, `status`, `spawn`,
`steer`, `interrupt`, `stop`, and `resume`, plus request/reply, async completion,
and process-terminal events. The adapter must use that public wire only.

Normative consequences:

1. The backend exclusively owns physical child dispatch, session/process
   lifecycle, physical concurrency, worktree creation, and backend control.
2. only-my-pi owns logical ready-node admission, approvals, reservations,
   revision state, aggregation, journal, and operator projection.
3. Logical IDs, backend agent IDs, request IDs, async IDs, process IDs, and
   terminal proofs are separate typed fields. A backend payload never becomes a
   trusted logical identifier by string coincidence.
4. A logical node is not `SUCCEEDED`, `CANCELLED`, or safely retryable until a
   correlated backend terminal proof has been reduced durably.
5. Private `src/**` imports, command-input simulation, exported type abuse, and
   any unowned/legacy delegation lane are prohibited. The exact exported
   structured-delegation event contract may serve read-only foreground Agent
   and Batch execution under the same physical owner; it is not a scheduler.
6. Capabilities absent from the public backend cannot be inferred from source
   internals or emulated by a hidden physical pool. They remain `UNAVAILABLE`,
   or `DEGRADED` only when the documented degraded behavior is safe.
7. The upstream statement-body `workflowScript` form is a compatibility fact,
   but the new product does not make that script a second Workflow IR. S1 must
   prove the exact public wire before any live promotion.

## 7. Community Pi workflow audit

The pinned `pi-dynamic-workflows` package is valuable C-tier evidence for Pi
authoring and failure modes. It includes a workflow extension, parser/AST
restrictions, journaled resume, worktree support, usage reporting, and quality
helpers such as verify, judge panels, repeated review, and completeness checks.

It is not a production dependency for three reasons:

1. loading it would add another workflow tool, manager, child-session path, and
   scheduler beside `@only-my-pi/subagents` and `pi-subagents`;
2. arbitrary JavaScript plus a Node `vm` is a determinism boundary at best, not
   a safe authority boundary;
3. its pinned [`worktree.ts`](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/f1e05aa766b729788e9c53892cfa0dd940aa36e1/src/worktree.ts)
   can degrade a failed worktree request to the base working directory. That is
   unacceptable for a writer: only-my-pi must return `WORKTREE_UNAVAILABLE`
   and dispatch nothing.

The permitted use is behavioral research and later, explicitly non-default
Labs experiments that still compile to the canonical JSON IR and dispatch only
through the same facade/backend. No production Profile may load both
schedulers.

## 8. Cross-harness findings

These projects are not implementation dependencies. Their exact commits are
held to make a future re-audit reproducible.

| Harness | Audited areas | Pattern retained | Boundary retained |
| --- | --- | --- | --- |
| OpenHands SDK | event store, conversation server, workspace abstraction, subagent package | Explicit event persistence and workspace capability | Its Docker/Kubernetes workspace and server are not only-my-pi backends |
| Cline | subagent tools, checkpoint controller, worktree controller, plan/act docs | Operator-visible child progress and reviewable recovery/checkpoint UX | A checkpoint is not authorization to silently restore or overwrite |
| OpenCode | agents, permissions, sessions | Orthogonal Agent/Profile/permission concepts and visible session state | No OpenCode agent loop or permission owner is embedded |
| Codex | app-server protocol v2, subagent source, turn control, usage | Typed durable handles, explicit approval/interrupt operations, usage accounting | No Codex protocol compatibility is claimed |
| Goose | subagent execution tool, task configuration, recipe validation, permission and session stores | Declarative recipe UX and explicit task/session configuration | Recipes compile to only-my-pi IR; Goose is not a scheduler dependency |

These references reinforce three design choices: separate logical and physical
identity, expose status as a projection over durable state, and isolate writer
workspaces without calling worktree isolation a sandbox.

## 9. Adoption and rejection matrix

| Capability | Primary evidence | only-my-pi decision | Required conformance |
| --- | --- | --- | --- |
| Homogeneous fan-out | Kimi Code source | Implement `BatchSwarm` as one spec × items | Stable input-order slots, bounded queue, explicit failure/cancel states |
| Dynamic heterogeneous goal | K2.5 report + hosted docs | Implement `SwarmGoal` that proposes immutable plan revisions | No direct spawn, bounded assignments, coverage/convergence, verifier |
| Automatic multi-workflow policy | Claude official docs | Implement `UltraRun` as routing and total-budget policy | Multiple approved runs, no second scheduler, no model/mode conflation |
| Executable JavaScript workflow | Claude docs + community Pi source | Reject for S0-S5 | Canonical declarative JSON IR only; unknown constructs fail closed |
| Capability seam | DeepSeek source | Implement versioned backend capability negotiation | Fail before reservation/dispatch when required capability is absent |
| Physical child/session lifecycle | `pi-subagents@0.45.2` | Reuse through exact RPC adapter | One runtime owner, correlation proof, no private imports |
| Durable orchestration state | DeepSeek/OpenHands/Codex references | Implement hash-chained event ledger and atomic snapshot | Single writer, fencing token, monotonic sequence, deterministic replay |
| Writer isolation | Pi backend + Cline/OpenHands/community references | Managed worktree required for parallel writers | No shared-cwd parallel writer; no silent fallback |
| Adaptive Provider retry | Kimi Code source | Implement only when public backend/usage signals support it | Otherwise advertise degraded/unavailable; never infer hidden telemetry |
| Long-lived peer team | Claude teams taxonomy | Defer beyond S5 | Do not simulate Team with a large short-task swarm |

## 10. License and reuse decision

All pinned source repositories in the matrix expose MIT or Apache-2.0 licenses
at the audited revision. That makes direct reuse legally plausible but not
architecturally desirable by default. S0 chooses behavior-level clean
implementation for every external reference.

Before any direct copy, a change must add:

- source repository, full commit, source path, copied line range, and local
  destination;
- license classification and preserved copyright header;
- Apache NOTICE handling where applicable;
- a reason the behavior cannot be implemented more simply against local
  contracts;
- a regression test that does not rely on the source runtime being installed.

Claude product documentation and hosted Kimi behavior are never copy sources.
They support prose-level design claims only.

## 11. S1/S2 gates derived from this audit

S1 cannot declare the facade runtime-ready until all of the following pass:

1. exact `pi-subagents@0.45.2` package identity and public RPC fixture match the
   compatibility record;
2. tool-visibility topology proves that only one public model-facing owner can
   trigger physical delegation;
3. backend capability negotiation is recorded as
   `SUPPORTED | DEGRADED | UNAVAILABLE`, with evidence and reason;
4. physical and logical identifier correlation survives duplicate, late,
   out-of-order, and spoofed fixture events;
5. writer worktree failure dispatches no child and never falls back to shared
   cwd;
6. stop/interrupt/resume require correlated terminal lifecycle evidence.

S2 cannot declare durable Workflow ready until:

1. canonical Definition-to-Plan compilation is deterministic;
2. event replay has exactly-once state effects under duplicate input;
3. lease/fencing, hash-chain, fsync, atomic snapshot, and stale-writer recovery
   tests pass;
4. budget is reserved with compare-and-swap before spawn and reconciled on
   terminal events or crash recovery;
5. plan-revision activation proves the old revision can no longer admit work;
6. approval receipts bind exact plan, policy, workspace, base commit, budget,
   and artifact digests;
7. migration is dual-read/new-write and never resumes a nonterminal legacy run.

## 12. Re-audit triggers

Re-run and version this dossier when any of these changes:

- `pi-subagents` version, integrity, exported RPC, event form, or tool topology;
- Kimi Code package/tag used for BatchSwarm semantics;
- Claude workflow documentation in a way that affects a cited claim;
- the K2.5 paper version or an official Kimi scheduler source release;
- DeepSeek Harness leaves preview or changes subsystem contracts;
- only-my-pi enables arbitrary JavaScript, an alternate backend, Team, adaptive
  Provider scheduling, cross-machine workers, or untrusted unattended writers;
- any external code is copied rather than behaviorally reimplemented.

Until a new audit lands, later upstream behavior is out of contract.
