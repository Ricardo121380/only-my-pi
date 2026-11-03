# Documentation

## Current development entry

| I want to… | Start here |
| --- | --- |
| Run a local Pi session in the WebUI | [Development checkout and demo commands](minimal-webui.md) |
| Understand the current goals or choose work | [Native Pi → WebUI → selected modules → Electron](plans/2026-10-25-pi-native-client-reset.md) · [ADR-0022](decisions/ADR-0022-pi-native-web-first.md) |
| Install the published terminal Preview | [Installation guide](quickstart.md) · [GitHub releases](https://github.com/Ricardo121380/only-my-pi/releases) |
| Find source, contracts or tests | [Repository layout and synchronization](maintenance/README.md) · [Domain glossary](../CONTEXT.md) |
| Check an issue or a proposed integration | [GitHub Issues](https://github.com/Ricardo121380/only-my-pi/issues) · [Pull requests](https://github.com/Ricardo121380/only-my-pi/pulls) |

### Public main and development source

The October 22 main code baseline includes CLI product accounts and authenticated MCP. The native Pi WebUI, its persistent development launcher and their tests are on a [separate development branch](https://github.com/Ricardo121380/only-my-pi/tree/codex/dev/pi-native-web). The [source guide](minimal-webui.md) identifies the exact revision, runtime and checks.

| Work | Source or evidence |
| --- | --- |
| CLI accounts and explicit account selection | [Account guide](cli-accounts.md) · [Scoped acceptance](compatibility/2026-10-20-cli-product-accounts.md) · [Merged PR #86](https://github.com/Ricardo121380/only-my-pi/pull/86) |
| Authenticated MCP from the CLI | [MCP guide](cli-mcp.md) · [Scoped acceptance](compatibility/2026-10-21-cli-authenticated-mcp.md) · [Merged PR #89](https://github.com/Ricardo121380/only-my-pi/pull/89) |
| Shared product settings | [Development guide](shared-product-settings.md) · [Source-scoped results and retained failures](compatibility/2026-10-22-shared-product-settings.md) · [PR #90 and its checks](https://github.com/Ricardo121380/only-my-pi/pull/90) · [Issue #80](https://github.com/Ricardo121380/only-my-pi/issues/80) |
| Versions, candidates and previous installation gates | [Node/Pi matrix](compatibility/node-pi-matrix.md) · [Pi 1.3.0 private candidate](compatibility/2026-10-18-pi-1.3.0-private-candidate-acceptance.md) |

## Historical specifications and evidence

The [October 17 blueprint](plans/2026-10-17-product-direction-and-iteration-plan.md), [full WebUI specification](plans/2026-10-01-webui-remaining-spec.md) and [Task/Gate mapping](plans/2026-09-26-webui-optimization-tasks.md) preserve past requirements, dependencies and results. Use the current roadmap to decide which of them enter a new milestone. The [previous WebUI guide](webui.md) describes the Glacier client. The [status archive](STATUS.md) records the candidates and dates for M0–M13.

## Accepted architecture and historical milestones

M1/M2 and S0/U0/U1 have historical acceptance records. Read each record with
its source, candidate, date, and scope; those results do not certify a newer
runtime or the expanded WebUI scope. The following documents preserve the
accepted architecture and original stage definitions.

- [Development plan and automatic acceptance gates](plans/2026-09-20-omp-webui-desktop-plan.md)
- [Q1–Q22 decisions and shared-understanding confirmation](plans/2026-09-20-web-desktop-discussion.md)
- [Phase 1 detailed development and daily-install promotion plan](plans/2026-09-20-omp-webui-phase1-plan.md)
- [Phase 1 P1-Q1–Q9 decisions](plans/2026-09-20-omp-webui-phase1-discussion.md)
- [Domain glossary](../CONTEXT.md)
- [ADR-0014: shared WebUI to Electron](decisions/ADR-0014-webui-to-electron.md)
- [ADR-0015: GUI account isolation](decisions/ADR-0015-gui-account-isolation.md)
- [ADR-0016: execution lifecycle and project writer ownership](decisions/ADR-0016-host-lifecycle-and-project-writer-ownership.md)
- [ADR-0017: versioned runtime contracts and stack promotion](decisions/ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)

The historical Phase 1 completion rule requires both M1-T (candidate technical
acceptance) and M1-I (daily CLI switch, rollback, and reapplication of the same
candidate). New candidates and later milestones retain separate acceptance.

## Directory guide

Recommended records:

- `research/` — package and harness research with source dates
- `plans/` — executable product roadmaps, milestone gates, and definitions of done
- `decisions/` — compatibility, security, and architecture decisions
- `LABS.md` — non-default offline experiments and their graduation requirements
- `compatibility/` — Pi/core and package version matrices
- `quickstart.md` — current installation links and the historical M12/M13 guide
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

The original governance and package foundations are recorded in
`decisions/ADR-0001-package-governance.md`,
`decisions/ADR-0002-product-boundary.md`, and
`decisions/ADR-0003-package-topology.md`.
Their historical milestone language is qualified by the current blueprint and
ADR-0020; applicable ownership and evidence rules remain in force.
