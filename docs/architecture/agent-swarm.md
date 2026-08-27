# AgentSwarm runtime boundary

This page records the legacy v1 AgentSwarm boundary. The four recipes remain
readable for one compatibility release, but new public execution no longer
runs their `SwarmRunController` or accepts its historical compiler output.
`only-my-pi` does not own a second child scheduler or a second `subagent` tool.

The compatibility control service translates each heterogeneous recipe into
an immutable WorkflowPlan and delegates live work only to the injected
`@only-my-pi/subagents` RunCoordinator. Heterogeneous legacy recipes continue
to compile through the audited `pi-subagents@0.45.2` extension-RPC workflow
lane. Homogeneous read-only BatchSwarm items may use the separately audited
structured-delegation transport from the same physical runtime. Caller-
supplied `workflowScript`, legacy direct delegation, and a second scheduler
remain forbidden.

## Safety defaults

- `research-synthesis`, `review-matrix`, and `debug-hypotheses` are read-only.
- Read-only roles do not receive `bash`, `edit`, or `write`; tester/verifier
  evidence comes from the fixed Gate Runner.
- A writer must use a managed worktree and a negotiated runtime worktree
  capability. Shared-cwd writer concurrency is one. Worktree presence alone
  does not prove path containment: the unified executor must separately
  advertise audited path enforcement or writer admission fails closed.
- Effective budgets are the minimum of profile, mode, recipe, role, run, and
  runtime limits. Nested Swarm is rejected in v1.
- Cancellation closes admission first, sends `stop`, and records `cancelled`
  only after terminal proof. It does not retry or run a reducer/verifier after
  cancellation.
- A local deadline, lease loss, or missing terminal proof cannot manufacture a
  child terminal. Unknown started work is charged at the reservation ceiling;
  a local timeout without correlated process proof leaves the run orphaned.
- If no injected unified coordinator/Pi RPC transport is present, `list`,
  `show`, `validate`, and `plan` remain offline; `run` returns
  `LIVE_RUNTIME_UNAVAILABLE` rather than pretending to have executed.
- `plan` assigns the stable run ID and freezes the canonical input snapshot;
  `run` must repeat that run ID, the displayed `planDigest`, and the derived
  execution-envelope digest. Missing or changed evidence fails before
  dispatch, and the same approval cannot authorize another run.
- Status is resolved from the versioned Plan Store sidecar after restart; the
  compatibility service's in-memory map is only a fallback for old injected
  fakes. Resume requires the caller to provide the original input again, and
  cross-process cancel publishes an intent that the coordinator records in the
  authoritative event journal.

## Recipes

The initial recipes are `research-synthesis`, `coding-guarded`, `review-matrix`,
and `debug-hypotheses`. `coding-guarded` has one writer followed by parallel
tester/reviewer nodes and a verifier. The other recipes never grant mutation;
fixes require a separate approved coding workflow.

The legacy compatibility contract is
[`contracts/swarm-runtime-v1.json`](../../contracts/swarm-runtime-v1.json),
and the audited upstream wire is
[`contracts/pi-subagents-wire-v1.json`](../../contracts/pi-subagents-wire-v1.json).
The active first-party orchestration contract is documented in
[`subagents-v2.md`](subagents-v2.md).

M8 Daily Harness Closure completed this migration in the normal Pi session:
BatchSwarm, static Workflow, dynamic SwarmGoal and Ultra share the single
session composer, budget ledger, journal and ArtifactStore over the pinned
`pi-subagents` physical runtime. The D13 protected live matrix and D14 real-root
rollback/reapply rehearsal both passed; Kimi AgentSwarm remains a reviewed
design/source reference only and is not a runtime dependency.
