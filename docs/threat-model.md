# Threat model

The Harness is a policy and reproducibility layer around Pi. It is not an OS
sandbox. The threat model therefore distinguishes configuration claims from
enforcement evidence for every surface.

| Threat | Failure mode | Default control | Evidence |
| --- | --- | --- | --- |
| package supply chain | install script or mutable tag executes as the user | exact version/SRI, scripts disabled, lifecycle audit, pack allowlist | package-doctor and staging negatives |
| path/symlink escape | resource or npm config writes outside the explicit root | realpath containment and segment-by-segment symlink rejection | bootstrap command-runner tests |
| settings overwrite | user field disappears during staging | owned-entry merge, snapshot, compare-and-swap publication | transaction crash/CAS tests |
| project injection | untrusted Mode/Agent/Skill widens tools | trust gate, namespace, Profile ceiling, fail-closed discovery | registry negative fixtures |
| child privilege leak | reviewer/tester receives writer or shell authority | child policy projection, no-bash read-only roles, Gate Runner | Swarm contract/fake-runtime tests |
| runaway Swarm | fanout, recursion, cost, or process leak | depth/fanout/time/retry/cancel budgets | Swarm cancellation tests |
| web/MCP/provider egress | private data leaves through a tool or plugin | per-surface egress owner, explicit Profile selection, no default web fetch | governance and MCP doctor |
| ledger disclosure | prompts/reasoning/tool payloads persist | metadata-only bounded receipts and redaction | session/status/receipt tests |
| false runtime claim | prompt or static metadata presented as sandbox/live Provider | `CONFIGURED_UNVERIFIED`, `RESTART_REQUIRED`, `UNAVAILABLE`, and explicit provenance | runtime doctor and status tests |
| release drift | CI verifies a different suite than local | one versioned manifest and manifest digest in receipt/CI | release-gates and CI contract |
| payload divergence | Full and Thin install different bytes under one version | acquisition-independent canonical stack manifest and post-stage tree convergence | release stack contract and builder tests |
| download substitution | registry, redirect, or release bytes change after planning | fixed HTTPS hosts, manual redirect validation, complete SRI/SHA ledger, apply offline | downloader and plan/apply drift tests |
| installer bootstrap | a one-line command executes unverified remote shell | download to a temporary regular file, compare fixed SHA-256, execute only after match | bootstrap installer tests |
| local stack confusion | system Pi/Node or an unknown shim is overwritten | user-local immutable stack, exact symlink identity, unknown shim conflict, no `/opt/homebrew` writes | stack transaction and clean-host tests |
| unsafe removal | provisioned package ownership is mistaken for OMP ownership | separate asset disposition, external/user ownership, exact LKG and drift checks | stack remove preservation tests |
| incomplete license evidence | public bundle redistributes an unresolved artifact | complete transitive ledger, direct dependency review, SPDX 2.3 and shipped license texts | SBOM/notices validator |

## Public Preview release boundary

The public installer is not a general package manager. It accepts one exact
Preview release identity, the fixed Node/Pi/package tuple, and either the Full
or Thin acquisition path. Full plan/apply is offline once the user has the
bundle. Thin may stage bytes only from the allowlisted GitHub Release,
`nodejs.org`, and `registry.npmjs.org` hosts. Neither path may read `.npmrc`,
GitHub credentials, provider credentials, browser cookies, Pi sessions, or
model memory. Lifecycle scripts remain disabled.

SHA-256, npm SHA-512 SRI, SPDX and GitHub attestations provide integrity and
provenance evidence; they do not make third-party code safe. The staged tree is
still executable code with the user's OS authority when Pi starts. The
read-only Harness ceiling limits registered Agent tools, not arbitrary behavior
inside a malicious extension or dependency. Public users should inspect the
ledger/SBOM and use host isolation when their repository or credential boundary
requires it.

`omp stack remove` is deliberately a different authority from `omp uninstall`.
The former may remove only immutable stack assets or a complete package root
whose provision transaction, current identity and pre-install LKG are all
provable. Any drift preserves the asset and returns a reconciliation plan.
Authentication, session, model, memory and git-sync data are outside both
removal surfaces.

## Trust boundaries

1. The Pi host owns model/provider/auth/session behavior.
2. only-my-pi owns its declared settings fields, staged resources, registry
   contracts, and verification receipts.
3. Third-party packages, skills, hooks, MCP servers, and extension code run
   with the invoking user's authority unless an external container/micro-VM
   covers the relevant surface.
4. The release receipt stores hashes and statuses, not command output or host
   paths; output hashes are not encryption.

The fresh smoke proves a disposable startup/configuration path only. It does
not prove filesystem, network, credential, Provider, browser-cookie, or
whole-session isolation. For untrusted repositories and unattended tasks,
provide OS/container/VM isolation before enabling write/bash/network surfaces.
