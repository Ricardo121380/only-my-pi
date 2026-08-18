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
contiguous hash-chained event sequence under one renewable writer
lease/fencing token. Heartbeat renewal and critical-write renewal both fail
closed if fencing is lost. Snapshots bind an exact event sequence/digest and
publish atomically.

Every attempt obtains a durable worst-case budget reservation before child
admission. Terminal settlement records consumed/refunded capacity, and restart
rebuilds the ledger from events. Hard token or cost limits become
`METERING_UNAVAILABLE` when the backend cannot measure them. Unfinished
content-addressed read-only work is first settled with explicit recovery
evidence, refunded only when execution provably never began, and then requeued
with a fresh attempt. An attempt that may have run consumes its worst-case
reservation; unfinished mutating work is interrupted/orphan-safe and never
transparently replayed.

Each node also has a real coordinator deadline. Reported elapsed time, raw
output bytes, tokens, and cost are compared with the reservation rather than
clamped to it. Any overrun consumes the worst-case reservation and cannot be
reported as completed. Child results are walked with explicit depth, node, and
byte limits before any full clone or serialization, so cyclic, deeply nested,
or oversized output fails closed. A coordinator deadline proves only that the
local timer fired: unless the backend later supplies correlated completion and
runner-process terminal proof, the child terminal remains
`authoritative:false` and the run is `orphaned`, not authoritatively timed out.

Legacy `workflow-v1` and `swarm-recipe-v1` resources are dual-read inputs only.
The migration compiler translates their heterogeneous DAGs into WorkflowPlan;
it does not relabel them as homogeneous BatchSwarm.

The public `WorkflowControlService` and `SwarmControlService` now follow that
same rule. Their offline list/show/validate/plan commands keep the legacy
readers for one compatibility release, but live execution accepts only an
explicitly injected unified RunCoordinator. Neither service imports or creates
`SingleAgentWorkflowRunner` or `SwarmRunController`. Both require an exact
plan confirmation before dispatch. The execution call must repeat the
previously presented `planDigest`; a missing or changed digest fails before
the coordinator. Missing parent Pi transport returns `LIVE_RUNTIME_UNAVAILABLE`.

Planning assigns one stable `runId` and returns the canonical input snapshot
used to compute the run-input digest. A confirmed dispatch must repeat that
same run ID, plan digest, execution-envelope digest, input snapshot, target,
and conditions. Workflow and Swarm services do not generate a second ID after
confirmation, and an input file is opened once with no-follow semantics before
its deep-frozen value enters the plan.

Run input is canonical plain JSON, bounded to 256 KiB, and represented in the
append-only `RunPlanned` event only by its digest. Resume requires the caller
to provide the same input again; the coordinator never reconstructs raw input
from a hash. Mutating plans additionally require an ApprovalReceipt bound to
the exact run ID and execution envelope, plan, revision ancestry, full
root-plus-node effective policy, capability envelope, budget, repository base
commit, allowed paths, writer claims, and delivery scope. Runtime validation
and the schema catalog share the same shape, timestamp, semantic, and receipt
self-digest rules. A CLI `--yes` confirms the displayed plan boundary but
cannot fabricate the live repository/capability evidence required by that
receipt. The coordinator requires an injected evidence provider, rechecks it
on resume even when `RunApproved` exists in the journal, and rechecks it before
every mutating-node admission. Static receipt validation alone is never an
authorization source.

For a mutating node, the executor must additionally advertise
`pathEnforcement: "ENFORCED"` and receives one immutable authorization envelope
containing the approved repository identity, base commit, allowed paths, writer
claims, receipt ID, and execution-envelope digest. The reviewed
`pi-subagents@0.45.2` v1 wire has a worktree flag but no per-path enforcement
field, so a worktree is not treated as proof of this capability. Until an
audited bridge verifies the produced diff against the approved base/path claims
and prevents automatic integration, live writer dispatch remains unavailable.

This is a control-facade convergence, not full S2 completion. The legacy module
exports remain packaged for direct-import compatibility tests, and the current
service instance keeps the run-id to WorkflowPlan correlation in memory. A
restart therefore cannot inspect a run until a durable plan store/resolver is
wired; status fails closed instead of guessing a plan from a digest.

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
The first CLI and `/omp` compatibility routes now pass through the unified
control facade. Durable restart/status control, pause/resume/restart-node,
BatchSwarm execution, dynamic SwarmGoal planning, UltraRun workflow libraries,
and promotion-specific live evidence remain in S2–S5.
