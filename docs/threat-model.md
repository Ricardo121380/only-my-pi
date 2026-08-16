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
