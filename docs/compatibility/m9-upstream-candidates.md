# M9 upstream candidate compatibility

M9 evaluates a new upstream package set without changing the Stable defaults or the real `~/.pi/agent` installation. The Stable baseline remains Pi `0.84.1` plus `pi-subagents` `0.45.2`; the candidate is Pi `0.84.3` plus `pi-subagents` `0.57.0` and the exact companion versions recorded in [`contracts/compatibility/upstream-candidates.json`](../../contracts/compatibility/upstream-candidates.json).

## Safety boundary

- Candidate packages are installed only in an explicit disposable root with npm lifecycle scripts disabled.
- Candidate probes are offline, use an isolated empty Pi home, submit no prompt, dispatch no child, and do not read model credentials.
- The current real Pi home is neither modified nor used as an inferred package source.
- M9 evidence is separate from the Stable compatibility matrix and cannot rewrite an older Stable receipt.
- A `HOLD` or `REJECT` decision must retain Pi `0.84.1` and `pi-subagents` `0.45.2` as defaults.
- `PROMOTE` is legal only when every required scope is `PASS`, including the protected live read-only matrix.

## Audited upstream changes

### Pi 0.84.3

The candidate keeps the Node `>=22.19.0` floor. Its relevant upstream changes include safer managed package updates, session-scoped model/thinking selection, and corrected DeepSeek V4 Flash thinking-level handling. Production role configuration does not hard-code OpenCode Go or any model credential. The protected U9 evidence runner is deliberately bound to the separately authorized `cc-switch-open-code-go/deepseek-v4-flash` tuple so that a different Provider or model cannot be substituted into the same evidence claim.

### pi-subagents 0.57.0

The structured delegation event contract remains the audited v1 request/started/update/response/cancel contract. The public RPC protocol remains version 1, but its exact dialect changes:

- RPC methods add `manage`.
- capabilities add `managementActions` and `asyncStatusSnapshot`.
- events add `subagent:child-status`.
- the default active model-facing tools are `subagent`, `subagent_supervisor`, and `subagent_wait`; `intercom` is no longer a default active tool.
- the package adds public agent registration and external job/project APIs. only-my-pi does not activate those new authority surfaces implicitly.

The adapter therefore selects a strict dialect by the verified physical package version. An unknown version, extra field, reordered management action, or baseline/candidate mix-up fails closed.

### plan mode 0.55.2

The supported interactive behavior is `/plan`, `/plan start`, and `/plan <prompt>`. M9 does not assume the obsolete Pi startup flag `--plan`. The only-my-pi terminal CLI's own `--plan` options are unrelated and remain unchanged.

### web access 0.25.0

The candidate adds broader cookie/auth-fetch functionality upstream. only-my-pi rejects a Web run when browser cookies, any `authFetch` profile, SSRF allow-ranges, or trusted environment proxy bypasses are enabled. No project file may inject authentication headers. The published `0.25.0` SSRF implementation has now passed an offline black-box probe covering public control URLs, loopback, RFC1918, link-local metadata, IPv6 loopback, non-HTTP protocols, hostname-to-private resolution, and redirect-to-private revalidation. The fake redirect transport made one in-process call and made zero external network requests.

### Other companion packages

`pi-agent-extensions` remains filtered to sessions, context, review, and notify; the full upstream extension list is not enabled. LSP and usage load through their published Pi entrypoints. Every exact tarball integrity and required entrypoint is contract-bound.

The complete 13-entry extension stack has been launched under Pi `0.84.3` in offline RPC/no-session mode: the selected four agent extensions, plan mode, Web access, subagents, LSP, usage, three first-party only-my-pi extensions, and a non-tool observer. The observer proved unique `/plan`, `/lsp`, `/usage`, `/omp`, `/omp-context`, sessions/context/review commands; one physical owner for the subagent tools; the expected Web and LSP tools; no active first-party model tool; no active `intercom`; and no duplicate command or tool registration. It submitted no prompt and dispatched no child.

## Protected U9 live-model matrix

U9 is complete. Source `a5a71b596e8983ffbba8075f02bc2b39ba19a72b` was packed into a fixed local artifact with SHA-256 `746d171f580a0c58d6f58a5a4c600ecd0487d59c1b341909a99a5e7842da7877`; the direct evidence-only child is `2af92de9f701d305f7263aeecec017b7c10bd696`. The candidate installation audit remained bound to Pi `0.84.3`, `pi-subagents@0.57.0`, and `pi-web-access@0.25.0` before and after the run. The low-sensitivity result is recorded in [`2026-08-28-m9-candidate-live-readonly-matrix.json`](../../verification/protected/2026-08-28-m9-candidate-live-readonly-matrix.json), and the combined U1-U9 result is recorded in [`2026-08-28-m9-upstream-compatibility.json`](../../verification/receipts/2026-08-28-m9-upstream-compatibility.json). The receipt intentionally retains the execution-time contract digest from the evidence commit; the later machine-contract update records that U9 passed and changes only the post-evidence decision reason to promotion review pending.

The protected matrix passed all 17 assertions: single Agent, BatchSwarm, Workflow ArtifactRef transfer, SwarmGoal replan, Ultra Agent and Workflow routes, public Web, cancellation, preparation plus cross-session resume, budget denial, writer denial, candidate artifact/runtime identity, usage metering, and pricing authority. It stored neither raw model output, host paths, nor credentials. The real Pi home was used only for existing runtime authentication and private run state; byte digests of `settings.json` and the installed generation identity were unchanged.

OpenCode Go is a fixed-fee subscription rather than a metered token-price Provider. The protected runner therefore records the verified billing mode explicitly: `$10` fixed fee, zero variable input/output price, and the fixed subscription fee excluded from the per-run `costUsd` subtotal. Pi's implicit zero-filled price metadata is not accepted as pricing authority. The recorded `24,960` tokens and three tool calls are a low-sensitivity subtotal from two directly metered terminal paths, not a claim that every nested child token was aggregated. No pricing override was written to the user's global preferences.

## Current decision

The current decision is `HOLD`. Manifest/source-surface, strict RPC,
delegation, capability-ceiling, isolated session composition, all five
read-only executor paths, background/cancel/resume adapter behavior, Web
black-box security, 100-cycle-per-version resource disposal, and the complete
repository regression now pass. The protected live read-only matrix also
passed 17/17 assertions and was imported into a complete U1-U9 receipt. The
remaining `HOLD` is a deliberate promotion-review boundary, not a missing-test
state: the Stable defaults cannot change until a separate reviewed decision
explicitly approves the candidate versions.

The complete repository regression has since passed with 714/714 tests. M9 is
now represented by a fixed U1-U9 gate contract:

| Gate | Scope | Current policy |
| --- | --- | --- |
| U1 | exact candidate provenance, schema, contract, and CLI | deterministic |
| U2 | strict RPC/delegation/live-probe dialects | deterministic |
| U3 | session composition and five executor adapters | deterministic |
| U4 | background, cancellation, resume, terminal correlation, recovery | deterministic |
| U5 | full-stack evidence, Web SSRF, project Gate safety | deterministic |
| U6 | version-paired resource/lifecycle soak | deterministic |
| U7 | package, schemas, links, evidence, and CI consistency | deterministic |
| U8 | complete repository regression | deterministic |
| U9 | candidate live read-only model matrix | protected evidence-only |

Ordinary CI executes U1-U8 with no credentials and `shell:false`. U9 has no
command tuple and cannot be triggered by that runner. U9 is imported only from
the exact source-bound evidence file and has now passed. The decision stays
`HOLD` with reason `CANDIDATE_PROMOTION_REVIEW_PENDING`, the baseline versions
remain the defaults, and the real Pi home is not changed until a separate
promotion review says otherwise.
