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

No unreleased changes are recorded. Any tracked change after the final release
receipt invalidates that receipt and must go through the source/gate/receipt
sequence again.
