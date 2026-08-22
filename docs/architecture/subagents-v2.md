# Unified Subagents v2 runtime foundation

`packages/subagents/index.mjs` is the single first-party orchestration facade
for the S0–S3 Preview source implementation. It deliberately separates logical
orchestration from physical child execution:

- only-my-pi owns typed Agent/Assignment contracts, immutable WorkflowPlan
  compilation, logical ready-node admission, the append-only event journal,
  parent budget reservations, approval binding, and recovery;
- `pi-subagents@0.45.2` remains the sole physical child/session runtime;
- the adapters use only two reviewed public surfaces from the same pinned
  package: structured delegation v1 for foreground read-only Agent/Batch
  execution and extension-RPC v1 for async workflow/background/resume/control;
  both accept domain-correlated `AgentRunHandle + ResolvedAgentSpec +
  TaskAssignment` objects. Neither accepts caller-supplied `workflowScript`.

## Public entry point

```js
import {
  createSubagentsFacade,
  createAgentTemplate,
  createResolvedAgentSpec,
  createTaskAssignment,
  createAgentRunHandle,
  createPiSubagentsRpcV1Backend,
  createPiSubagentsDelegationV1Backend,
  createBatchSwarmNodeExecutor,
  createBatchSwarmRegistry,
  createPiSubagentsBatchItemExecutor,
  compileWorkflowDefinition,
  createEventJournal,
  createPlanStore,
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
spawn and owns async workflow/background/resume/control. The structured
delegation adapter owns read-only foreground Agent and BatchSwarm execution;
its terminal response is accepted as observed process proof only when the exact
request/owner/node identity, an integer child exit code, finite usage, and a
terminal status all agree. Cancellation waits for a child run update before it
emits the correlated delegation cancel event. Stable local handles retain
explicit backend bindings. Completed, failed, cancelled, timeout, and budget
terminal outcomes require a matching completion and observed process proof;
missing proof produces no authoritative receipt.

The current upstream seam has explicit degraded or unavailable entries for
dynamic concurrency, rate-limit signals, model/tool overlays, usage metering,
structured per-item results, and worktree proof. Higher layers must consume
that matrix and fail closed; they may not implement a second physical
scheduler to compensate.

`npm run doctor:subagents-topology` is the static ownership gate. It reads the
pinned package/wire contract plus the owner, command, and resource catalogs
and requires exactly one physical owner (`pi-subagents`) for both audited
protocols plus a separate
first-party logical owner. It also validates the checked-in low-sensitivity
no-model receipt and now reports `liveRuntime: LIVE_NO_MODEL_CAPABILITY_PASS`.
The doctor itself remains offline; fresh evidence requires the explicit
disposable-root `npm run probe:subagents-live -- ...` command.

That probe has been run once against Pi `0.84.1` and the source-hash-verified
`pi-subagents@0.45.2` artifact. It observed the public `ready`/correlated
`ping` contract, the four upstream-owned active tools, and the first-party
`omp` command registrations in an isolated no-session root. It submitted no
prompt, called no Provider, dispatched no child, and did not read the real Pi
home. The checked-in receipt is
`contracts/subagents/pi-subagents-live-no-model-evidence.json`; it is bounded
compatibility evidence, not a child-execution or sandbox claim.

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

## Homogeneous BatchSwarm

S3 adds a Kimi-inspired, Pi-native BatchSwarm without importing or connecting
the Kimi runtime. A BatchSwarm is deliberately narrower than a Workflow: one
exact ResolvedAgentSpec, effective-policy hash, output-schema hash, and prompt
template are mapped over a bounded array of homogeneous items. Per-item Agent,
model, tool, policy, workspace, or output overrides are rejected. A
heterogeneous graph remains a WorkflowPlan.

The versioned registry binds each definition under `swarm/batches/` to its
reviewed prompt under `swarm/templates/`, its runtime-ready resolved AgentSpec
under `swarm/agent-specs/`, and the canonical Agent Registry source. Any source,
prompt, spec, policy, or output-contract drift fails before item dispatch. The
checked-in `review-items` definition permits at most 300 items and uses the
read-only reviewer role.

`BatchSwarmNodeExecutor` owns only logical item expansion and projection:

- stable item IDs/digests and stable input-order result slots;
- progressive static ramp under exact `initial`/`max` ceilings;
- optional adaptive capacity only when the backend proves both rate-limit
  signals and dynamic-concurrency support; otherwise adaptive admission returns
  `ADAPTIVE_CAPACITY_UNAVAILABLE` before spawn;
- finite item retries, explicit all-required/continue/fail-fast/quorum policies,
  bounded prompt and result projection, and no hidden model reducer;
- one retry owner: a batch Workflow node has exactly one root attempt, while
  item retry stays inside the batch controller. `maxItems × maxAttempts` is
  capped at 1000 physical assignments even though logical item count may reach
  300;
- journal-first admission: `BatchItemQueued` must be durable before the
  physical assignment begins;
- durable resume by item identity. An authoritative successful item is never
  replayed, while an item with `BatchItemStarted` but no authoritative terminal
  makes recovery fail closed. A retryable but non-authoritative terminal is
  likewise never relaunched;
- cancellation is bounded even when an injected item executor ignores its
  `AbortSignal`; such an item is recorded non-authoritatively and cannot open a
  retry or new-admission path.

Batch events share the RunCoordinator event chain and parent BudgetLedger. The
batch controller is not counted as a physical child assignment; individual
item starts are. If the coordinator crashes after proven item terminals, the
next attempt reuses the existing parent reservation and dispatches only the
remaining slots. If any started physical child lacks terminal proof, recovery
charges the original worst-case reservation and interrupts the run instead of
guessing that the child stopped.

`PiSubagentsBatchItemExecutor` is the sole physical bridge. It converts each
slot into a correlated TaskAssignment and AgentRunHandle, then delegates to the
exact `pi-subagents@0.45.2` RPC backend. It accepts no raw workflow script; the
backend's reviewed statement-body compiler remains the only code-generation
path. Cancellation asks that same backend to interrupt the recorded handle and
requires its correlated terminal proof.

The bounded offline control surface is:

```sh
omp swarm batch list
omp swarm batch show review-items
omp swarm batch validate review-items
omp swarm batch plan review-items --input-file /absolute/path/input.json --json
```

The input document is canonical JSON shaped as
`{"artifacts":{"items":[...]}}`, opened once with `O_NOFOLLOW`, and hashed into
the execution envelope. `run/status/cancel/resume` require an explicitly
injected trusted RunCoordinator/Pi session. The current source tests do not
dispatch a real child or call a Provider; live read-only BatchSwarm evidence is
`NOT_RUN_BY_POLICY` until separately authorized.

### Durable plan binding and restart control

`createPlanStore({ rootDir, filesystem, clock })` is now the durable resolver
for the immutable `runId -> WorkflowPlan` binding. It publishes a strict,
content-addressed `plan.json` beside that run's event journal using an
exclusive first-writer-wins create. The record contains the full validated
plan, source/input/envelope digests, and the execution target, but never the
raw input, prompt, transcript, credential, or tool output. A fresh coordinator
can therefore call `inspect(runId)` without an in-memory plan map and project
status from the journal after validating both the plan record and event chain.

`resume(runId, { input })` loads that immutable record and requires the caller
to provide the original canonical input again (the CLI and `/omp` surfaces may
provide a bounded, absolute, O_NOFOLLOW JSON input file); a digest mismatch is
rejected before any admission. `cancel(runId)` works across process boundaries by
publishing a bounded, symlink-safe `cancel-request.json`. The active
coordinator observes the request during its lease heartbeat, aborts/asks the
backend to stop, and records `RunStopping` before settling only a
non-authoritative `orphaned` result when terminal process proof is absent.
The request file is an intent, not a second event ledger; the hash-chained
journal remains the sole state authority. Corrupt or escaped plan/control
files fail closed.

The legacy module exports remain packaged for direct-import compatibility tests,
and the compatibility services retain their in-memory map only as a fallback
for pre-v2 injected fakes. Production v2 status/resume paths use the Plan Store
resolver and never infer a plan from a digest.

## Evidence and limits

Run the contract slice with:

```sh
npm run test:subagents
npm run eval:subagents
npm run doctor:subagents-topology
npm run doctor:batches
```

The evaluation corpus is deterministic, offline, and explicitly labelled
`CONTRACT_PREVIEW_OFFLINE_SIMULATOR`. A separate disposable Pi `0.84.1`
no-model probe now proves the exact `pi-subagents@0.45.2` ready/ping contract,
active tool ownership, and first-party command registration. It did not submit
a prompt, dispatch a live child, call a Provider, read credentials, mutate the
real Pi home, isolate extension network/filesystem access, or prove managed
worktree execution. It is not an Alpha/Beta/Stable receipt.
The first CLI and `/omp` compatibility routes now pass through the unified
control facade. Durable plan lookup/status/cancel/resume is covered by the
Plan Store slice; both cancel and resume are classified as mutations by the
control grammar, and an unresponsive backend stop call is bounded without
blocking writer-lease renewal. Pause/restart-node beyond the bounded resume path,
dynamic SwarmGoal planning, UltraRun workflow libraries, guarded writer
integration, and promotion-specific live/fault evidence remain in S4–S5.
Homogeneous BatchSwarm is implemented and offline/fault tested; its protected
live child proof remains `NOT_RUN_BY_POLICY`.
