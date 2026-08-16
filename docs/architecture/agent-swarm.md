# AgentSwarm runtime boundary

`only-my-pi` owns the declarative side of Swarm: recipe discovery, DAG and
budget validation, capability admission, policy/provenance receipts, safe
`workflowScript` compilation, and stable result aggregation. It does not own a
second child scheduler or a second `subagent` tool.

The only live backend in v1 is the audited `pi-subagents@0.45.2`
extension-RPC v1 lane. A session must first complete the exact `ping`
capability handshake. A spawn request can contain only compiler-produced
`workflowScript` and `async: true`; task text, paths, role IDs, and user input
are encoded as data in the compiler payload, never concatenated into source.
The exported `pi-subagents/delegation` surface remains a reference fixture and
is not imported or used at runtime.

## Safety defaults

- `research-synthesis`, `review-matrix`, and `debug-hypotheses` are read-only.
- Read-only roles do not receive `bash`, `edit`, or `write`; tester/verifier
  evidence comes from the fixed Gate Runner.
- A writer must use a managed worktree and a negotiated runtime worktree
  capability. Shared-cwd writer concurrency is one.
- Effective budgets are the minimum of profile, mode, recipe, role, run, and
  runtime limits. Nested Swarm is rejected in v1.
- Cancellation closes admission first, sends `stop`, and records `cancelled`
  only after terminal proof. It does not retry or run a reducer/verifier after
  cancellation.
- If no injected Pi RPC transport is present, `list`, `show`, `validate`, and
  `plan` remain offline; `run` returns
  `LIVE_SWARM_REQUIRES_PI_SESSION` rather than pretending to have executed.

## Recipes

The initial recipes are `research-synthesis`, `coding-guarded`, `review-matrix`,
and `debug-hypotheses`. `coding-guarded` has one writer followed by parallel
tester/reviewer nodes and a verifier. The other recipes never grant mutation;
fixes require a separate approved coding workflow.

The authoritative contract is
[`contracts/swarm-runtime-v1.json`](../../contracts/swarm-runtime-v1.json),
and the audited upstream wire is
[`contracts/pi-subagents-wire-v1.json`](../../contracts/pi-subagents-wire-v1.json).
