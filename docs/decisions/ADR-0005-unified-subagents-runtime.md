# ADR-0005: Use one Pi-native subagent facade and one physical runtime

## Status

Accepted — 2026-08-18

## Context

The M0-M7 baseline delivered Agent manifests, single-agent Workflow, legacy
Swarm recipes, a `pi-subagents` adapter, CLI/control surfaces, and governance.
It did not deliver one durable orchestration model. Workflow and Swarm still
have separate graph, state, cancellation, and aggregation concepts, while the
legacy recipes are heterogeneous DAGs rather than homogeneous map swarms.

The next implementation must support single agents, homogeneous BatchSwarm,
predefined Workflow, dynamic SwarmGoal, and an UltraRun policy without
rewriting Pi or loading another child-session runtime. External harnesses offer
useful concepts, but do not change the product boundary established by
[ADR-0002](ADR-0002-product-boundary.md) and the unique-owner rule in
[ADR-0003](ADR-0003-package-topology.md).

Without a sharper decision, three failures are likely:

1. a first-party scheduler and `pi-subagents` both believe they own physical
   children, cancellation, concurrency, or worktrees;
2. Workflow, BatchSwarm, and SwarmGoal each grow an incompatible DAG/state
   engine;
3. model-generated plans or child results become an authority escalation path.

The audited evidence and product/source distinction are recorded in the
[source dossiers](../research/2026-08-18-subagents-source-dossiers.md).

## Decision

### 1. Product boundary

`@only-my-pi/subagents` is the single first-party facade and logical
orchestration owner. Exact `pi-subagents@0.45.2` is the single physical
child-session, process, and worktree runtime for the initial release.

The ownership split is normative:

| Layer | Sole owner | Owns | Must not own |
| --- | --- | --- | --- |
| Pi host | `@earendil-works/pi-coding-agent` host instance | Main agent loop, Provider/auth, primary session, built-in tools, extension host, TUI | only-my-pi plan state or a bundled second Pi host |
| Physical delegation backend | `pi-subagents@0.45.2` | Child/session/process lifecycle, physical spawn, upstream concurrency, worktree creation, backend interrupt/stop/resume, existing generic `subagent` tool | only-my-pi WorkflowPlan, approval, total budget, or logical revision policy |
| Logical orchestration | `@only-my-pi/subagents` | Facade, `RunCoordinator`, Definition-to-Plan compiler, logical ready-node admission, revision barriers, budget reservations, approval binding, journal/snapshot/artifacts, aggregation, recovery, operator control projection | A second child pool, second physical semaphore, private backend import, or independent worktree runtime |
| Permission mode | selected `pi-permission-modes` runtime | Its documented permission-mode enforcement surface | Whole-session sandbox claims or orchestration ownership |
| Other existing surfaces | their current catalog owner | Memory, MCP, Web, Provider, renderer, Profile, Mode, and Project Trust enforcement as already declared | Delegated authority by implication |

There is exactly one logical DAG owner (`RunCoordinator`) and exactly one
physical child owner (`pi-subagents`). A facade call may result in no dispatch,
one dispatch, or a bounded series of dispatches, but every physical dispatch
goes through the same versioned adapter.

### 2. Canonical terminology

These terms are part of the public domain model. Schemas, APIs, CLI output,
receipts, and documentation must use them consistently.

| Term | Definition |
| --- | --- |
| `AgentTemplate` | Packaged and reviewed base role, prompt, capability ceiling, and output contract |
| `ResolvedAgentSpec` | Immutable per-run resolution of template, specialization, model role, effective tools/capabilities, workspace, output schema, and digest |
| `TaskAssignment` | Concrete input, dependencies, budget, ownership, artifact references, and idempotency contract for one resolved spec |
| `Agent` | One logical assignment/attempt executed through the physical backend |
| `BatchSwarm` | One `ResolvedAgentSpec` and prompt template mapped over bounded ordered items, with one explicit result slot per item |
| `WorkflowDefinition` | Reusable author-time declarative topology and policies |
| `WorkflowPlan` | Canonical, immutable, hashed DAG revision produced for one execution context |
| `WorkflowRun` | Event-sourced execution of one active plan revision under one root run |
| `SwarmGoal` | Dynamic heterogeneous planner that proposes specs, assignments, and bounded plan revisions, then observes coverage/convergence |
| `UltraRun` | Policy overlay that selects and chains multiple WorkflowRuns under a total budget and quality policy |
| `Team` | A future handful of long-lived peers with mailbox/task-board semantics; explicitly outside S0-S5 |

`pipeline`, `parallel`, `map`, `reduce`, DAG, and bounded loop are Workflow
topology combinators. They are not permission Modes. `ultra` is not a model,
reasoning-effort setting, permission Mode, or scheduler. Logical assignments
may number in the hundreds while physical concurrency remains small and
capability/policy bounded.

### 3. Facade topology

All callers use one application service, regardless of presentation:

```text
Pi model tool / Pi command / omp CLI / TUI
                |
                v
      @only-my-pi/subagents facade
                |
      policy + plan + RunCoordinator
                |
      PiSubagentsRpcV1Adapter
                |
        pi-subagents@0.45.2
```

The intended namespaced model-tool surface is:

- `omp_agent`;
- `omp_swarm_batch`;
- `omp_swarm_goal`;
- `omp_workflow`;
- `omp_run_control`.

These names are targets, not evidence that the tools are already live. S1 must
prove how the upstream generic `subagent` tool is exposed. If it cannot be
hidden from the model while retaining the public RPC backend, only-my-pi must
not create a second competing model-facing delegation tool. The CLI/TUI may
still call the facade, but status must remain `CONFIGURED_UNVERIFIED` or
`UNAVAILABLE` until single public ownership is proven.

No caller may instantiate a workflow runner, scheduler, child manager, or
backend adapter independently. CLI, extension, and tests receive the same
service interface by dependency injection.

Protected live scope status is a signed promotion overlay, not part of the
stable compatibility baseline digest. The matrix digest normalizes those five
scope values and removes protected evidence paths; the importer separately
requires exact source commit, signer, evidence digest, row and scope. This
breaks the otherwise circular requirement that evidence sign the matrix value
which is changed by importing that same evidence.

### 4. Backend adapter and capability contract

The adapters may use only two exact public event protocols documented for the
same `pi-subagents@0.45.2` physical runtime: extension RPC (`ping`, `status`,
`spawn`, `steer`, `interrupt`, `stop`, `resume`) for async workflow/background/
resume/control, and exported structured delegation request/started/update/
response/cancel for read-only foreground Agent/Batch execution. Both protocols
share the same owner and never create another scheduler or model-facing tool.

It must not:

- import `pi-subagents/src/**` or any unexported path;
- parse or simulate another extension's command input;
- use any unversioned or legacy direct-delegation shape as a hidden runtime
  channel; the structured event vocabulary must match the pinned contract;
- spawn Pi, Node, shell, worktree, or child processes on its own;
- create a second physical concurrency semaphore that claims backend state;
- infer support from private source when the public wire cannot demonstrate it.

Every live session publishes a `BackendCapabilityV2` snapshot. Each capability
has `SUPPORTED`, `DEGRADED`, or `UNAVAILABLE` status, evidence provenance, a
reason, and any safe limit. `DEGRADED` names the exact reduced behavior; it is
not a generic escape hatch.

At minimum the snapshot distinguishes:

- spawn and correlated terminal lifecycle;
- steer, interrupt, stop, and resume;
- backend status/active counts;
- managed worktree support;
- usage/token/cost metering;
- retry/rate-limit classification;
- safe physical concurrency control;
- model/tool visibility topology.

A required `UNAVAILABLE` capability fails before budget reservation and
dispatch. A missing usage meter makes a hard token/cost-capped run
`METERING_UNAVAILABLE`; only a policy that does not claim that hard cap may
proceed. Adaptive 429 scheduling or dynamic physical concurrency is enabled
only when the public backend exposes sufficient signals and controls.

### 5. Logical-to-physical identity boundary

The following identifiers are never aliases merely because their strings
match:

- root run ID;
- plan revision and plan digest;
- logical node ID and assignment ID;
- attempt ID;
- backend agent/session ID;
- RPC request ID;
- async/run ID;
- process ID;
- terminal event/proof ID.

The adapter records a typed correlation tuple at spawn acknowledgement. Later
events are accepted only when they match the active tuple, fencing token, and
expected lifecycle transition. Unknown, duplicate, late, or prior-attempt
events are journaled as rejected observations or ignored deterministically;
they cannot settle another node.

An RPC acknowledgement proves request acceptance, not child completion. A
logical terminal state requires a correlated terminal proof durably reduced by
the `RunCoordinator`.

### 6. Effective authority and admission

The effective capability for every attempt is the deny-wins intersection:

```text
OS/container capability
  ∩ Pi Project Trust
  ∩ Profile ceiling
  ∩ active Mode
  ∩ UltraRun/SwarmGoal policy, if present
  ∩ active WorkflowPlan revision and node policy
  ∩ ResolvedAgentSpec
  ∩ TaskAssignment
  ∩ exact explicit approval
```

Every admission recomputes that intersection. Child output, repository text,
tool output, prior approval prose, cache content, and model-generated plans are
untrusted data and cannot widen it.

An approval receipt binds the exact plan digest, policy digest, workspace
identity, base commit, mutation/path set, tool/egress set, budget envelope, and
input artifact digests. Any mutating plan revision requires exact reapproval.
A purely read-only revision may reuse approval only within a preapproved,
digest-bound replan envelope that limits topology, paths, capabilities,
assignments, and budget. Deny always wins.

### 7. Logical scheduling versus physical scheduling

The `RunCoordinator` decides only which logical nodes are eligible to request
admission. It enforces dependency readiness, active revision, approval,
reservations, global policy, fairness, and logical caps. The backend remains
the authority for physical child/session/process availability.

This means:

- a node can be logically ready yet wait for backend capacity;
- only-my-pi may cap requests below a backend limit but cannot advertise an
  ability to raise or dynamically tune the backend limit without a public
  control;
- `BatchSwarm` owns item expansion and stable result projection, not a separate
  worker pool;
- `SwarmGoal` proposes new immutable plan revisions; it never calls spawn;
- `UltraRun` selects WorkflowDefinitions and allocates total budget; it never
  calls spawn;
- nested workflows compile into one namespaced plan rather than launching a
  nested coordinator.

### 8. Writer and workspace policy

Logical mutation policy is owned by only-my-pi; physical worktree creation and
child cwd lifecycle remain backend responsibilities.

Rules:

1. shared cwd permits at most one active writer across the root run;
2. parallel writers require backend-proven managed worktrees;
3. each writer admission binds `baseCommit`, allowed paths, file claims,
   workspace ID, and handoff contract;
4. overlapping claims fail closed before dispatch;
5. worktree creation failure returns `WORKTREE_UNAVAILABLE`; it never degrades
   to a writer in the base checkout;
6. one integrator owns merge/application, followed by verification in a fresh
   state;
7. a worktree is conflict isolation, not an OS sandbox or network boundary.

### 9. State, aggregation, and control ownership

The `RunCoordinator` is the only writer of canonical run state. It uses the
typed IR, event ledger, snapshot, artifact, cancellation, and recovery rules in
[ADR-0006](ADR-0006-workflow-ir-event-state.md).

Deterministic aggregators may sort, deduplicate, project, and validate typed
results. Any reducer, synthesizer, judge, or verifier that invokes a model is an
explicit Agent node with its own authority, budget, input bounds, and output
schema. Hidden model calls in an aggregator are prohibited.

Control operations (`status`, `pause`, `resume`, `cancel`, `interrupt`,
`approve`, and review) are commands against the same root run. A presentation
surface does not mutate backend or files directly.

### 10. Migration and compatibility

Migration is dual-read and new-write:

- new runs write only the new WorkflowPlan/event/artifact contracts;
- `workflow-v1` compiles through a compatibility facade;
- heterogeneous `swarm-recipe-v1` resources compile to WorkflowDefinition v2,
  not BatchSwarm;
- `packages/workflow-core` and `packages/swarm-core` become facades or internal
  re-exports and cease owning independent schedulers/state;
- completed legacy runs and receipts remain readable under their original
  semantics;
- a nonterminal legacy run is never auto-imported, resumed, or mutated. The
  operator starts a new v2 run with an explicit provenance link;
- no old receipt is rewritten to claim v2 runtime evidence.

Removing legacy writers occurs only after parity fixtures, migration tests,
operator documentation, and a release receipt prove the new path. Rollback may
restore the old read-only viewer/facade, but cannot create new v1 mutations.

## Required invariants and release gates

The facade is not runtime-ready unless tests prove:

1. one physical runtime owner and one logical DAG/state owner;
2. no private imports, alternate subprocess lane, or duplicate public command;
3. exact package integrity and RPC v1 wire compatibility;
4. explicit capability negotiation and fail-closed degradation;
5. identifier correlation under duplicate, late, out-of-order, and spoofed
   events;
6. approval cannot be replayed after plan/policy/workspace/budget/artifact
   change;
7. BatchSwarm preserves item order and explicit partial failure;
8. shared-cwd writer and managed-worktree rules hold under concurrency/failure;
9. cancellation waits for terminal proof or reports `ORPHANED`/`INTERRUPTED`;
10. migration never mutates or resumes a nonterminal legacy run;
11. status and receipts distinguish contract, simulator, fake backend, live
    child dispatch, and live Provider evidence.

## Consequences

- only-my-pi gains one product API without becoming another agent harness.
- Workflow, BatchSwarm, SwarmGoal, and UltraRun share one plan/state/control
  model, reducing semantic drift.
- exact backend limits may constrain or degrade features until the public RPC
  exposes the required evidence/control.
- the first implementation may expose fewer model tools than the desired
  namespace if upstream tool visibility cannot be made unambiguous.
- logical scale is decoupled from physical concurrency and therefore remains
  recoverable and budgetable on a local machine.
- dynamic planning adds proposals and revisions, never ambient authority.
- future alternate backends require a new ADR, capability adapter, threat-model
  update, conformance corpus, and explicit selection; they cannot be silently
  loaded beside `pi-subagents`.

## Rejected alternatives

- Integrating the Kimi, Claude, DeepSeek, OpenHands, Codex, Cline, OpenCode, or
  Goose runtime.
- Loading `pi-dynamic-workflows` as a second production scheduler.
- Reimplementing child sessions/processes/worktrees inside only-my-pi.
- Keeping separate Workflow and Swarm DAG/state engines.
- Calling every heterogeneous DAG a BatchSwarm.
- Treating UltraRun as a model, reasoning setting, permission Mode, or direct
  dispatcher.
- Using a hidden private `pi-subagents` import or exported types as a second
  runtime lane.
- Advertising a namespaced delegation tool while an indistinguishable upstream
  tool remains simultaneously model-visible.
- Treating a worktree, Project Trust, prompt, Node worker, or JavaScript `vm` as
  an OS sandbox.
- Silently falling back from an unavailable writer worktree to shared cwd.
- Allowing child output or model-generated revisions to widen permissions,
  budget, egress, workspace, or fan-out.
- Auto-resuming nonterminal legacy runs under new semantics.
