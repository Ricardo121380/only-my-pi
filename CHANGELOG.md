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

- a single `packages/subagents/` orchestration facade with typed Agent,
  Assignment, backend capability, terminal receipt, immutable WorkflowPlan,
  event journal, budget ledger, and RunCoordinator contracts;
- an exact `pi-subagents@0.45.2` extension-RPC v1 backend that emits only
  statement-body workflow code and correlates every lifecycle action to an
  explicit backend run ID;
- dual-read migration of legacy Workflow and heterogeneous Swarm resources to
  WorkflowPlan v2, without relabelling them as homogeneous BatchSwarm;
- 15 orchestration schemas/evaluation contracts in the strict catalog, plus a
  deterministic offline corpus with fixed seed, baselines, thresholds, and
  content digests.

### Security boundary

These unreleased changes remain Contract Preview source evidence. They have no
promotion receipt and do not prove live child execution, Provider quality,
managed worktrees, adaptive rate limiting, SwarmGoal, UltraRun, or production
BatchSwarm. Any tracked change after the final 0.1.0 receipt invalidates that
historical receipt for the new source tree and must follow a new
source/gate/receipt sequence before release promotion.
