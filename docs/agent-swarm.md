# AgentSwarm

AgentSwarm is an optional orchestration layer, not a second Pi runtime. The
physical scheduler belongs to the reviewed `pi-subagents@0.45.2` extension-RPC
v1 lane. only-my-pi owns admission, policy projection, bounded workflow-script
compilation, cancellation, and result aggregation.

## Recipes

- `research-synthesis` — read-only scouts and synthesis;
- `coding-guarded` — one managed-worktree writer plus deterministic gates;
- `review-matrix` — independent read-only reviewers;
- `debug-hypotheses` — bounded hypotheses followed by a verifier gate.

Inspect and validate recipes offline:

```bash
node bin/omp.mjs swarm list
node bin/omp.mjs swarm validate research-synthesis
node bin/omp.mjs swarm plan research-synthesis --input-file /absolute/task.json
```

`swarm run` requires an injected Pi session and explicit approval. Without one,
it returns `LIVE_SWARM_REQUIRES_PI_SESSION`; that is an honest unavailable
state, not a fake live success. Research/review/debug children do not receive
`bash`, `edit`, or `write`. Test and verifier evidence comes from the fixed
Gate Runner, not an arbitrary child shell.

## Safety invariants

- depth, fanout, child count, wall time, token/cost, and retry budgets are
  intersected with the parent Profile and Mode ceilings;
- recursive Swarm and shared-cwd parallel writers are rejected;
- a writer requires a negotiated managed-worktree capability;
- cancellation closes admission before stop/abort and requires terminal proof;
- child results are ordered by recipe declaration, and verifier failure cannot
  become an overall success;
- Codex development subagents are not product AgentSwarm children.

The S2 no-model probe proves startup, the public RPC handshake, and single
physical tool ownership. Later source-bound Stable evidence proves the
protected live Agent and two-item BatchSwarm scenarios. Normal `/omp` daily
dispatch is now wired through the M8 session composer, per-run ceilings,
budgets, artifacts and approval UI; it does not reuse the older Stable fixture
as evidence. The Daily first-party BatchSwarm performs one attempt per item,
admits at most eight items, and Ultra reserves one of those eight child slots
for fresh verification. D13/D14 remain the protected evidence boundary before
the real installation is called complete. A real deployment must add
OS/container isolation for untrusted code; a worktree alone is not a sandbox.
