# Changelog

All notable changes to `only-my-pi` are recorded here. This project is in an
early, local-first harness phase; entries describe the governed repository
artifacts and their verification boundary, not a promise of a published npm
release.

## 0.1.0 — 2026-08-16

### Added

- strict package, Profile, capability, owner, command, enforcement, Mode,
  Agent, Workflow, Swarm, theme, and transactional bootstrap contracts;
- dry-run-first `omp` bootstrap/update/uninstall/rollback control plane;
- eight built-in Modes, five Workflows, bounded Gate Runner, and a single
  `pi-subagents` extension-RPC adapter;
- semantic dark theme, contrast receipts, safe theme reset, and redacted
  status projection;
- offline DeepSeek conformance, ACP v1, and workspace-checkpoint Labs;
- fixed `release-gates-v1`, fresh tarball smoke, metadata-only verification
  receipt, and CI contract.

### Security boundary

This version does not read credentials, call a live Provider, mutate the real
Pi home, publish to npm, create a release, or claim that Pi Project Trust,
Plan Mode, a worktree, or a conditional Bash sandbox isolates the whole
session. Third-party packages and Labs remain opt-in and require review.

## Unreleased

### Added

- S5 release-governance foundation: exact Node/Pi/`pi-subagents` compatibility
  matrix, cumulative promotion policy, digest-pinned `release-gates-v2`, and
  a clean-source deterministic runner that never spawns protected live gates;
- a source-pinned Ed25519 protected-evidence contract and direct-child Git
  importer for live Agent terminal/cancel, BatchSwarm, background/resume, and
  guarded-writer receipts; the default trust policy has no signer and remains
  fail-closed;
- an inert-by-default S5-A Alpha evidence producer with a one-time bounded
  authorization contract, exact runtime-row preflight, empty disposable Pi
  root, synthetic fixture workspace, canonical `omp-reviewer` regeneration and
  drift check, temporary upstream artifacts, cumulative capture budgets,
  disjoint runtime/staging/source roots, pre/post source checks, credential
  allowlist, read-only Agent terminal/cancel and two-item BatchSwarm scenarios
  over the sole `pi-subagents` backend, digest-only external signing, and
  review-only evidence staging; no real live run has been performed and
  declared endpoint hosts are not an OS network policy;
- an independently authorized S5-B `background-resume` producer that runs two
  distinct Pi parent processes over one isolated persisted parent session,
  keeps `pi-subagents` artifacts session-scoped, binds restart state through a
  private mode-0600 handoff, requires a new correlated resume binding and two
  authoritative terminals, and stages only digest-only session-reload,
  backend-rebind, terminal, and metering proofs; no live run has been performed;
- compatibility/provenance contracts plus listener/timer resource-leak soaks,
  with Preview/Alpha/Beta/Stable claims kept separate from `NOT_RUN_BY_POLICY`
  live evidence;

- a single `packages/subagents/` orchestration facade with typed Agent,
  Assignment, backend capability, terminal receipt, immutable WorkflowPlan,
  event journal, budget ledger, and RunCoordinator contracts;
- an exact `pi-subagents@0.45.2` extension-RPC v1 backend that emits only
  statement-body workflow code and correlates every lifecycle action to an
  explicit backend run ID;
- dual-read migration of legacy Workflow and heterogeneous Swarm resources to
  WorkflowPlan v2, without relabelling them as homogeneous BatchSwarm;
- Workflow/Swarm public control routes that use the legacy registries only as
  readers, require exact plan confirmation, and delegate execution solely to
  an injected unified RunCoordinator;
- canonical run-input binding and a stable, run-specific execution envelope
  covering plan/source/input/target/conditions, with an ApprovalReceipt verifier
  for exact revision/policy/capability/budget/repository/delivery scope;
- fail-closed live approval-evidence checks at initial admission, resume, and
  every mutating-node admission; cross-run receipt replay is rejected;
- deterministic recovery that may requeue unfinished content-addressed
  read-only attempts but never silently replays an unfinished mutation;
- renewable single-writer leases, crash-safe worst-case budget charging,
  deadline/output/token/cost overrun enforcement, and bounded child-result
  projection before cloning or serialization;
- fail-closed writer admission that requires live approval revalidation and an
  explicitly audited path-enforcement capability; local timeout without
  correlated process proof settles as a non-authoritative orphan;
- 15 orchestration schemas/evaluation contracts in the strict catalog, plus a
  deterministic offline corpus with fixed seed, baselines, thresholds, and
  content digests.
- a disposable-root, no-model Pi probe that source-hash-verifies
  `pi-subagents@0.45.2`, observes the public `ready`/correlated `ping` contract,
  and proves that all four active physical subagent tools remain upstream-owned
  while only-my-pi registers no competing model tool.
- a packaged no-model evidence contract and fresh-tarball topology smoke, so an
  installed artifact must retain the same digest-bound ownership evidence.
- a strict homogeneous BatchSwarm definition/registry with one reviewed
  AgentSpec and prompt template, 0–300 stable item slots, progressive static
  ramp, capability-gated adaptive 429 behavior, finite retry/failure policies,
  bounded per-item output, one root retry owner, a 1000-assignment envelope,
  and deterministic input-order aggregation;
- a real WorkflowPlan batch node and durable Batch event projection sharing the
  single RunCoordinator journal and parent BudgetLedger, including reservation
  reuse after a safe crash and fail-closed handling of unproven child terminals;
- a structured `PiSubagentsBatchItemExecutor` that delegates each item through
  the sole exact RPC backend without exposing raw workflow source;
- `omp swarm batch` and `/omp swarm batch` offline planning/control surfaces,
  a reviewed `review-items` resource, registry doctor, schema semantics, and
  logical 1/8/20/64/300 simulations.

### Security boundary

These unreleased changes remain Preview source evidence. Their receipts are
Preview-only and do not prove live child execution, Provider quality, managed
worktrees, live adaptive rate limiting, SwarmGoal, UltraRun, or a production
BatchSwarm deployment. The BatchSwarm implementation itself is covered by
offline, injected-backend, crash-recovery, and bounded-scale tests; its protected
live read-only dispatch remains `NOT_RUN_BY_POLICY`. Any tracked change after
the final 0.1.0 receipt invalidates that
historical receipt for the new source tree and must follow a new
source/gate/receipt sequence before release promotion.
