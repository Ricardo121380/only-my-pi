# Documentation

Research and design notes for only-my-pi live here.

## Accepted WebUI / Desktop plan

The 2026-09-20 design discussion is complete. The following records describe
the accepted plan; implementation and milestone acceptance have not started.

- [Development plan and automatic acceptance gates](plans/2026-09-20-omp-webui-desktop-plan.md)
- [Q1–Q22 decisions and shared-understanding confirmation](plans/2026-09-20-web-desktop-discussion.md)
- [Phase 1 detailed development and daily-install promotion plan](plans/2026-09-20-omp-webui-phase1-plan.md)
- [Phase 1 P1-Q1–Q9 decisions](plans/2026-09-20-omp-webui-phase1-discussion.md)
- [Domain glossary](../CONTEXT.md)
- [ADR-0014: shared WebUI to Electron](decisions/ADR-0014-webui-to-electron.md)
- [ADR-0015: GUI account isolation](decisions/ADR-0015-gui-account-isolation.md)
- [ADR-0016: execution lifecycle and project writer ownership](decisions/ADR-0016-host-lifecycle-and-project-writer-ownership.md)
- [ADR-0017: versioned runtime contracts and stack promotion](decisions/ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)

Phase 1 is complete only after both M1-T (candidate technical acceptance) and
M1-I (daily CLI switch, rollback, and reapplication of the same candidate)
pass. Documentation completion does not imply either acceptance has run.

## Directory guide

Recommended records:

- `research/` — package and harness research with source dates
- `plans/` — executable product roadmaps, milestone gates, and definitions of done
- `decisions/` — compatibility, security, and architecture decisions
- `LABS.md` — non-default offline experiments and their graduation requirements
- `compatibility/` — Pi/core and package version matrices
- `quickstart.md` — disposable install, bootstrap, and packed-artifact smoke
- `modes.md` — built-in Mode behavior and extension contract
- `agent-swarm.md` — recipe, budget, and child-policy boundaries
- `migration-uninstall.md` — update, rollback, and uninstall procedures
- `troubleshooting.md` — bounded statuses and recovery paths
- `threat-model.md` — trust boundaries and residual risks
- `../inventory/` — the current machine's redacted, exact-version package inventory
- `../profiles/` — profile contracts that select packages and policy boundaries
- `../policies/` — capability, ownership, command, and enforcement-surface contracts
- `../contracts/` — schema catalog and version-locked upstream compatibility contracts
- `../agents/`, `../modes/`, `../workflows/`, `../swarm/` — declarative product contracts; a
  `contract-only` resource is not a runtime-delivery claim
- `../scripts/package-doctor.mjs` — static cross-document governance validation
- `../prompts/` — product-facing reusable Pi prompts only
- `../codex/goals/` — Codex-only development execution contracts; never Pi package resources

Keep copied third-party code out of this directory; link to upstream sources
and record the version or commit that was reviewed.

Current accepted decisions cover package governance, the Pi Harness product
boundary, and the host/package/resource topology in
`decisions/ADR-0001-package-governance.md`,
`decisions/ADR-0002-product-boundary.md`, and
`decisions/ADR-0003-package-topology.md`.
