# Documentation

Research and design notes for only-my-pi live here.

For source folders, local evidence boundaries, and Git synchronization, see the
[repository maintenance guide](maintenance/README.md) and the
[2026-10-19 repository audit](maintenance/2026-10-19-repository-audit.md).

## CLI product accounts — 2026-10-20

The development CLI independently creates and configures product accounts, accepts hidden API Key input or Pi-supported OAuth, and explicitly selects an account for real Pi execution. The GUI reads the same accounts and status. Cross-process use and authentication reservations cover both clients. See the [CLI account guide](cli-accounts.md) and the [ten-criterion CLIENT-01A evidence map](compatibility/2026-10-20-cli-product-accounts.md). Only the account foundation and account OAuth portions of GCLIENT-01 belong to #78; #79–#83 and the material blockers remain separate.

The current CLIENT-01C / #79 implementation adds independent `omp mcp` configuration, safe credential input and native Pi OAuth. It reuses the GUI catalog, revisions and credential references, with real CLI/PTY/Pi and local MCP receivers. See the [CLI MCP guide](cli-mcp.md) and [five-criterion evidence map](compatibility/2026-10-21-cli-authenticated-mcp.md). Actual Ego GUI and CLI/Pi interoperation now covers shared identities, conflict rejection and bidirectional revocation. A live ledger contention defect was fixed; the retained full-coverage timeout exposed PTY fixture cleanup and prompted a separate test-only fix. The fixed `80062c5` candidate passes complete local gates and independent source reviews. Historical Ego B retains its earlier source identity; post-fix same-source GUI B and public PR/CI acceptance remain pending. See the evidence map for exact results and retained failures.

Current source development and validation use Node 24.19.0 and exact Pi 1.3.0. This does not change the daily installation or publish a new product version.

## Historical Pi 1.3.0 private candidate — 2026-10-19

[Same-candidate delivery and acceptance](compatibility/2026-10-18-pi-1.3.0-private-candidate-acceptance.md) records `pi130-v1`, private source `dd996352`, the exact production lock/materials and actual candidate CLI/PTY/Ego. GP130-02 PASS; GP130-03 PASS. #77: CLOSED / completed，已独立回读. The four required installed checks run successfully on the packaged Node24; Node22 and Linux have explicit applicable scopes.

[#76 development adaptation](compatibility/2026-10-18-pi-1.3.0-runtime-adaptation.md#7-三类完整回归失败的处置与本轮验收) remains CLOSED/completed for its own source and two 1679-PASS lanes. New candidate acceptance is recorded separately; material, Full, installation and external Provider gates keep their scope.

## Current development entry

Only my pi targets two first-class clients directly on the latest stable Pi core:
a CLI/TUI and a desktop Agent application. The graphical client is delivered
first as a local WebUI, then in Electron with the shared UI. Pi supplies the
Agent runtime; application integration stays limited to the needs of each client.
The current Host/worker topology is an implementation choice to evaluate, not
an additional product stage or a required second Agent runtime.

- [Complete development blueprint, confirmed decisions, and next iteration](plans/2026-10-17-product-direction-and-iteration-plan.md)
- [ADR-0020: Pi-native clients, explicit accounts, and shared sessions](decisions/ADR-0020-pi-native-clients-and-shared-sessions.md)
- [ADR-0021: shared product configuration and independent client setup](decisions/ADR-0021-shared-product-configuration.md)
- [Pi 1.3.0 upgrade preflight](compatibility/2026-10-17-pi-1.3.0-upgrade-preflight.md)
- [Shared client, WebUI, and Pi feature specification](plans/2026-10-01-webui-remaining-spec.md)
- [Implementation scope and published issue mapping](plans/2026-10-18-client-baseline-work-items.md)
- [Published consolidated tickets and verification receipt](plans/2026-10-18-client-ticket-review.md)
- [GitHub implementation tasks](https://github.com/Ricardo121380/only-my-pi/issues)
- [Original Task/Gate mapping and historical acceptance](plans/2026-09-26-webui-optimization-tasks.md)

As checked on 2026-10-18, development dependencies and the private candidate use
exact Pi 1.3.0; the final upstream metadata readback also reports 1.3.0. Pi 1.1.0 tasks #62–#75 and material
tasks #20/#22 are closed within their recorded scope. #21 still blocks the
remaining material chain; U2–U6 and the desktop application remain incomplete.
Current runtime, installation, and Provider acceptance require their own evidence.

Confirmed in the current discussion: finish the full selected WebUI before the
desktop; support session viewing and continuation across clients with one active
executor per session; let the CLI explicitly use product accounts without
changing their ownership or silently switching identities; sequence independent
features by their actual dependencies. These are requirements, not completed
runtime acceptance. Account setup and login now have the bounded #78 evidence above;
MCP authentication is being implemented in #79; the remaining shared tool setup belongs to #80/#81. Product settings are shared defaults with project overrides; original Pi
and external settings keep their ownership and require explicit import. Initial
cross-client continuation is guaranteed only for verified matching runtime
combinations; unverified combinations may show readable history and require
matching versions without updating the other installation automatically.
The approved native dependency changes were published and independently read
back on 2026-10-18; the complete graph has 66 issues and 88 edges without cycles.

Confirmed on 2026-10-18: new core capabilities first reach CLI/graphical parity
on macOS Apple Silicon. Existing Linux CLI capabilities remain maintained;
new Linux capabilities receive separate adaptation and acceptance afterward.
They do not block the first complete macOS WebUI or desktop milestone.

Q12 was confirmed on 2026-10-18, closing the design interview and accepting
blueprint v1 as the development baseline. The same specification now tracks
US-129–US-143 and the GP130/GCLIENT acceptance requirements. The work-item
record defines the Pi and shared-client scope, material-route evaluation, and
existing-issue changes. On 2026-10-18, to-spec updated
[the existing specification Issue #19](https://github.com/Ricardo121380/only-my-pi/issues/19).
After approval of the consolidated breakdown, to-tickets published nine new
issues #76–#84, updated 25 existing issue bodies, and synchronized native
dependencies. Independent readback verified every body and dependency, preserving
the parent specification, existing states, metadata, and comments. The original
62 concrete acceptance criteria remain covered by the nine tickets.
[PI130-01 / #76](https://github.com/Ricardo121380/only-my-pi/issues/76) is CLOSED/completed with both full Node lanes passing.
[PI130-02 / #77](https://github.com/Ricardo121380/only-my-pi/issues/77) owns both candidate assembly and same-candidate regression: GP130-02 PASS; GP130-03 PASS; CLOSED / completed，已独立回读.
The [publication receipt](plans/2026-10-18-client-ticket-publication.json) records
the actual issue mapping and verification results.
This publication does not claim new runtime acceptance.

## Documentation lifecycle

Use the blueprint for current work, the feature specification for requirements,
and Issues for published task status. The blueprint also contains the document
maintenance ledger. Historical plans, receipts, failures, and task drafts retain
their dated scope and links; old dates alone are not a deletion criterion.

- [Current version identities and historical compatibility](compatibility/node-pi-matrix.md)
- [Published installation entry and historical M12/M13 guide](quickstart.md)
- [WebUI guide and its verified historical scope](webui.md)
- [M0–M13 status archive with current navigation](STATUS.md)

Delete obsolete duplicates only after confirming a complete replacement and
checking document, script, test, and evidence references. No safely deletable
duplicate was established by the 2026-10-17 inventory; this pass updates stale
current statements and preserves historical evidence in place.

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
