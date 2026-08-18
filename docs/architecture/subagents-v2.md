# Unified Subagents v2 runtime foundation

`packages/subagents/index.mjs` is the single first-party orchestration facade
for the S0–S2 Contract Preview. It deliberately separates logical
orchestration from physical child execution:

- only-my-pi owns typed Agent/Assignment contracts, immutable WorkflowPlan
  compilation, logical ready-node admission, the append-only event journal,
  parent budget reservations, approval binding, and recovery;
- `pi-subagents@0.45.2` remains the sole physical child/session runtime;
- the adapter uses only the reviewed extension-RPC v1 surface and accepts
  domain-correlated `AgentRunHandle + ResolvedAgentSpec + TaskAssignment`
  objects. It does not accept a caller-supplied `workflowScript`.

## Public entry point

```js
import {
  createSubagentsFacade,
  createAgentTemplate,
  createResolvedAgentSpec,
  createTaskAssignment,
  createAgentRunHandle,
  createPiSubagentsRpcV1Backend,
  compileWorkflowDefinition,
  createEventJournal,
  createBudgetLedger,
} from "only-my-pi/packages/subagents/index.mjs";
```

The facade is dependency-injected. Creating it without a backend is safe and
read-only: the capability matrix reports every live feature as `UNAVAILABLE`,
and launch returns `SUBAGENTS_BACKEND_UNAVAILABLE`. Workflow execution also
requires an injected journal, budget ledger, and typed node executor; it never
falls back to a hidden child process.

## Agent lifecycle

The public RPC adapter negotiates the exact pinned capability/event map before
spawn. Foreground is normalized to asynchronous upstream spawn plus correlated
terminal waiting. Stable local handles retain explicit backend bindings across
resume. Status, steer, interrupt, stop, and resume address only a recorded
backend ID. Completed, failed, cancelled, timeout, and budget terminal outcomes
require both a matching completion event and observed runner-process proof;
missing proof produces a non-authoritative orphan/interrupted receipt.

The current upstream seam has explicit degraded or unavailable entries for
dynamic concurrency, rate-limit signals, model/tool overlays, usage metering,
structured per-item results, and worktree proof. Higher layers must consume
that matrix and fail closed; they may not implement a second physical
scheduler to compensate.

## Workflow and recovery

WorkflowDefinition v2 compiles to a primitive-only immutable WorkflowPlan v1.
Nested workflows are flattened; arbitrary expressions and JavaScript are not
accepted. RunCoordinator is the only new logical scheduler and emits a
contiguous hash-chained event sequence under one writer lease/fencing token.
Snapshots bind an exact event sequence/digest and publish atomically.

Every attempt obtains a durable worst-case budget reservation before child
admission. Terminal settlement records consumed/refunded capacity, and restart
rebuilds the ledger from events. Hard token or cost limits become
`METERING_UNAVAILABLE` when the backend cannot measure them. Unfinished
read-only/idempotent work may retry with a fresh attempt; unfinished mutating
work is interrupted and never transparently replayed.

Legacy `workflow-v1` and `swarm-recipe-v1` resources are dual-read inputs only.
The migration compiler translates their heterogeneous DAGs into WorkflowPlan;
it does not relabel them as homogeneous BatchSwarm.

## Evidence and limits

Run the contract slice with:

```sh
npm run test:subagents
npm run eval:subagents
```

The evaluation corpus is deterministic, offline, and explicitly labelled
`CONTRACT_PREVIEW_OFFLINE_SIMULATOR`. This implementation has not dispatched a
live child, called a Provider, read credentials, mutated the real Pi home, or
proved managed-worktree execution. It is not an Alpha/Beta/Stable receipt.
BatchSwarm execution, dynamic SwarmGoal planning, UltraRun workflow libraries,
CLI/TUI control migration, and promotion-specific live evidence remain in
S3–S5.
