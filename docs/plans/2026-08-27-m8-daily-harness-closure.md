# M8 Daily Harness Closure

Status: **PROTECTED ACCEPTANCE PENDING** on `codex/m8-daily-harness`.

M8.0-M8.6 and deterministic D1-D12/D15 are complete. The artifact is
scripts-disabled, offline-installable, and cache-independent through an exact
bundled runtime dependency allowlist. Remaining work is deliberately limited
to D13 (source-bound DeepSeek V4 Flash live matrix) and D14 (real Pi-root
apply/rollback/reapply), followed by the evidence/receipt commits and merge.

M8 turns the source-bound Stable orchestration kernel into a read-only-first
Harness usable from a normal Pi TUI session. The standalone `omp` CLI remains
the installation, configuration, diagnosis and offline-management surface;
real Agent execution belongs exclusively to `/omp` inside Pi.

## Ordered delivery

1. Correct stale Stable documentation and freeze the M8 authority decisions.
2. Introduce `external` versus `managed` package bindings and prove uninstall
   cannot remove a package that predated only-my-pi.
3. Add the first-party Agent resource bundle plus Base, Overlay, Preset,
   preferences, role-model and budget resolvers.
4. Inject one session-scoped runtime composer into `omp-control`; publish child
   results as bounded ArtifactRefs and pass them to dependent nodes.
5. Expose read-only Agent, BatchSwarm, Workflow, SwarmGoal and UltraRun through
   one composer and one `pi-subagents` physical owner.
6. Add public-Web preflight/confirmation, a trusted project Gate Manifest and
   session-bound grants.
7. Add `/omp run`, run inspection/cancel/resume/GC, then execute D1-D15.
8. Only after shadow verification, apply a commit-pinned tarball to the real Pi
   root, smoke it, roll it back, prove the nine borrowed packages remain, and
   reapply it.

The first-party `review-items` BatchSwarm uses one physical attempt per item in
M8. This makes the eight-child ceiling literal: a standalone batch may admit
eight items, while Ultra admits at most seven batch items and reserves the
eighth child slot for its required fresh verifier. Retrying a failed item is an
explicit new run/replan decision, not hidden amplification inside the Daily
preset.

## Completion boundary

The historical S5 receipt is immutable evidence for its pinned source. M8 has
its own D1-D15 gate set. No M8 feature may be described as complete merely
because an S5 protected fixture passed. General project writers, daemons, Kimi
runtime integration, ACP clients, automatic restore, default MCP and public
package publication remain out of scope.

The decision records in ADR-0007 through ADR-0010 and the versioned gate map in
`verification/daily-harness-gates-v1.json` are normative for implementation.
