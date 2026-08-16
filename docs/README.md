# Documentation

Research and design notes for only-my-pi live here.

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
