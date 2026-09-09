# only-my-pi status

Baseline snapshot: **2026-08-15** · Roadmap updated: **2026-08-30** · Stable
kernel merged to `main`: **2026-08-27** · Pi **0.84.3** · Node **25.8.0** · macOS
`darwin-arm64`

## Active milestone — M12 Direct Terminal Coding Agent Closure

### Installed M13 follow-up — 2026-09-09

The writer-verification and direct-child-budget follow-up is now installed and
has completed **C1-C12 / 12 PASS** on the acceptance host:

- Source: `15c40a23c6c819e87ad81f4141b6f1fdd495af08`.
- Direct evidence-only child: `f7346b3996b2f0947f8bd221da437c66240b03fa`.
- [Protected evidence](../verification/protected/2026-09-09-m13-cpar-installed-coding.json):
  eight C11 assertions and eighteen C12 assertions.
- [Completion receipt](../verification/receipts/2026-09-09-m13-local-closure.json).

The active stack is
`sha256:b195234e0cf2b73a8564098e9a9ad1823831951d88c5f8e5f5711a78d8821c39`,
generation is
`sha256:d0b349d69efd6a39b8b60603dbe7299441489407dfbb05ec5cf483e1f94eaaf3`,
and OMP artifact is
`sha256:f13c03bb9777d885741b554009689df2c5b5ff19d1e74f1783676666d9d2a782`.
Final doctor is **PASS / MATCH**. Node `24.19.0`, Pi `0.84.3`, pi-subagents
`0.57.0`, all nine external/user-owned packages, and system runtime identities
are preserved. No Pi processes or incomplete stack transactions remain.

C11 installed the candidate, exercised the no-model picker and Inspect state,
rolled back to the original M12 stack, and reapplied the same candidate.
Settings, stack state, package-lock and current/LKG stack pointers matched the
baseline exactly. Restored CLI links resolve to the same binaries even though
their text is canonicalized; the Harness records a new rollback transaction and
time while preserving its generation, manifest and settings bindings.

C12 used the real installed `omp` entry for edits/tests, grant reuse, continued
sessions and renewed approval, complex planning, parallel scouts, managed
writing, runtime clone gates, fresh review and real-worktree verification.
Dirty overlap preserved the user's existing comment without starting a child.
A defective signed-addition patch passed a deliberately incomplete positive-only
gate but was rejected by the fresh reviewer. Web denial started no child; a
separately approved fetch then produced the requested note. Headless writer
denial, project-external write denial and cancellation with verified child
process exit also passed.

The matrix records 369,347 directly reported tokens, 99 terminal messages with
usage fields (including reported zero-usage errors), 107 tool calls and 2,554
seconds between recorded events. CPAR fixed-subscription variable cost remains
zero under the user's existing billing confirmation. Intermittent
`CredentialUnavailable` / `EgressUnavailable` 503 responses and the first cancel
trial's turn-limit termination remain in private diagnostics; bounded retries
and a precisely timed cancellation established the passing assertions. No
unobserved usage is estimated, and continuous provider availability is not claimed.

These results are separate from earlier isolated checks and historical M12
evidence. Publication remains **HOLD_PUBLICATION**; hosted CI, push, tag and
release were not performed.

### M13 follow-up: writer verification admission

The `codex/m13-writer-verification` development branch tightens automatic writer
integration with a runtime-owned Project Gate verifier. Real zero exit codes
from every explicitly confirmed clone gate are required before fresh review;
missing, failed, killed or mismatched results cannot be replaced by model prose.
Patch identity is rechecked after testing and after review. Missing manifests
fail closed with a retained patch. Parent-worktree testing remains a required
follow-up, not an automatically completed claim. This behavior is included in
the separately accepted installation above; historical evidence remains bound
to its original source.

Focused validation covers orchestration, composer wiring, real argv execution
in a temporary clone, failure/denial/cancellation, manifest drift, and patch
drift. Protected acceptance and installation are recorded above; the historical
M12 completion claims below apply only to the original M12 source.

### M13 follow-up: direct child budgets

The direct delegation path now honors lower configured turn and tool-call
limits, disallows delegation when `maxDepth=0`, reserves tool-call allowances
across concurrent children, and shares one deadline from the first child
admission for the lifetime of the direct orchestrator. Reported tokens (including
cache usage), cost and tool calls accumulate across children, including failed
terminals. Returned JSON result bytes are also bounded per child and cumulatively.
Repeated progress/terminal events do not double-charge usage. Exhaustion cancels
active children, rejects queued/new
delegation and blocks writer integration. Unreconciled usage after cancellation,
timeout or missing/invalid terminal usage stops further delegation for that
process instead of treating unknown usage as zero. `/agents` exposes this state.
Native `toolBudget.block` is set to `"*"`: this field selects which tools are
blocked after exhaustion, not which tools are unavailable before it. Reported
tool-call counts may include rejected attempts.

The audit distinguishes these child budgets from the main Pi Agent, which is
not included and receives no new spending ceiling in this change. The pinned
pi-subagents delegation API reports tokens during progress and cost only at
termination; it does not accept token/cost limits in delegation requests. These
are observed-usage stop conditions, not exact provider billing caps: in-flight
model calls may overshoot, and cache usage is reconciled at termination. Output
limits cover returned results, not all child tool logs. Project Gate commands
retain their own timeouts; the shared child deadline is rechecked before patch
integration. The separately accepted installation includes this follow-up;
historical acceptance evidence is unchanged. Focused deterministic tests cover
the admission, accounting, concurrency, cancellation, deadline and
writer-integration boundaries.

M12 changes the product entry from `pi` followed by `/omp run` into a direct
terminal coding Agent started with `omp`. The implementation reuses the
controlled Pi TUI, model registry, sessions, signals and tools; it does not
create a second terminal runtime. Interactive sessions select a model, start in
read-only `Inspect`, and may enter guarded project-local `Coding` only after one
explicit, process-scoped approval. Complex work requires a decision-ready plan.

The main Agent works in the current repository while preserving the initial Git
state. Automatic orchestration remains bounded and visible over the sole
`pi-subagents` physical runtime. At most one writer may run, in an OMP-managed
ordinary clone; dirty-scope overlap falls back to the main Agent. Headless
`omp -p` remains read-only, and coding authority never survives process exit or
session resume.

The target Preview is `0.3.0-preview.1` with capability ceiling
`GUARDED_PROJECT_CODING`. No GitHub push or publication is authorized until the
local C1-C12 gates, real Pi smoke, protected coding matrix, rollback and reapply
all pass. The contract is in
[`ADR-0013`](decisions/ADR-0013-direct-terminal-coding-agent.md).

The M12 source implementation now includes the direct `execve` launcher,
audited extension admission, startup model picker, unified Inspect/Planning/
Coding state machine, process-local `request_coding_access`, tool-call and
user-bash backstops, permission-mode YOLO revocation, dirty-worktree baseline,
managed ordinary-clone writer, fresh reviewer, automatic visible delegation,
direct-Agent doctor and the guarded daily profile. The package identity is now
`0.3.0-preview.1`; the release contract validates both historical M11 read-only
stacks and the current M12 guarded-coding stack without granting the former
current release authority.

The versioned M12 gate contract is
[`m12-direct-coding-gates-v1`](../verification/m12-direct-coding-gates-v1.json).
C1-C10 are local, no-model deterministic gates. C11 and C12 import protected
real-install and live coding evidence. On September 9, the complete C1-C12
runner returned **COMPLETE / 12 PASS**, including the existing global coverage
thresholds and the stricter direct-Agent module thresholds.

The accepted chain is:

- Source: `2d6efbd5cf8a602f5dc9d8d2510d800eaffe8eac`.
- Direct evidence-only child: `66a007ce6753a5fa28fa61665e9963c3a93efbe7`.
- [Protected evidence](../verification/protected/2026-09-09-m12-cpar-direct-coding-final.json):
  eight C11 assertions and eighteen C12 assertions.
- [Completion gate report](../verification/receipts/2026-09-09-m12-local-closure.json).

At the original M12 closure, the installed artifact used the accepted source,
embedded Node `24.19.0`, controlled Pi `0.84.3` and pi-subagents `0.57.0`.
Its stack was
`sha256:8612df80bca713bd2139d9f6a27f6bd4b5855ccb18cc341f73158c7c61a6d637`,
artifact was
`sha256:2438ef7bf9f541f8b1f5aa9e39fc4b4bf67ab20174e9f51e17967a15e6d00849`,
and generation was
`sha256:9b9d0bf4c4dc3eb695e6dc4b99d4dbbd7d60f11f6872818ca96f1709725db67d`.
That closure finished **INSTALLED**, with doctor **PASS / MATCH**, all nine
packages `external/owner=user`, and no incomplete transactions.

Protected runs used the existing CPAR `cpar-grok-build/grok-4.6` configuration.
Real tests covered simple edits and tests, same-process grant reuse, resumed
Inspect and renewed approval, complex planning, dirty-overlap main-Agent
fallback, managed clone writing, fresh review, automatic patch integration,
concurrent read-only scouts, cancellation, separate public-Web approval,
headless write denial, child-count budget denial and project-external write
rejection. The negative reviewer fixture produced a defective clone candidate;
the reviewer rejected it and the original worktree remained clean. The positive
fixture integrated only `math.mjs` and passed tests in the real worktree without
creating a commit. No-model reapply smoke also opened the model picker, selected
CPAR, showed Inspect and exited cleanly through `/exit`.

The real rollback restored the M11 `0.2.0-preview.1` baseline at source
`479c69eba4f245df00dbcb126079a58a98a3b607`. Settings and stack state matched their
saved bytes, current/LKG pointers matched, package-lock was unchanged, and the
old stack verified. M12 was then reapplied from the same checked artifact.
The M11 CLI correctly rejected the newer release contract without mutation;
reapply used the verified M12 artifact-contained installer. Homebrew and user
external-package ownership were preserved throughout.

The user removed the aggregate 100,000-token acceptance ceiling. The accepted
matrix records **273,254 directly metered tokens**, **71 metered model
terminals**, **107 tool calls** and **1,065 seconds** between recorded matrix
events. Counts include directly observed child terminals and do not estimate
unobserved nested usage. Individual runtime budgets remain in force; the budget
negative test specifically proves `maxChildren=1`, not every possible budget
limit. CPAR fixed-subscription billing with no per-token variable charge was
confirmed by the user, so variable cost is zero; no provider price discovery is
claimed. Native attempts included intermittent `503 CredentialUnavailable`
errors and a deliberately cancelled child. Successful assertions were recorded
after bounded retries; this does not establish continuous provider availability.
Raw conversations, reasoning, credentials and host paths are absent from the
committed evidence and report; Pi's normal private session storage is separate.

Earlier partial runs on `9903f88` and `829a517` remain diagnostic only. The final
source includes the temporary-index patch-capture fix and direct Web-authorizer
wiring, both exercised again in the accepted source-bound matrix. Historical
results were not relabeled as final evidence.

M12.7 local acceptance is complete. M12.8 hosted CI and publication remain
pending, and `HOLD_PUBLICATION` remains correct. No GitHub workflow, push, tag,
Release or npm publication was used for this closure.

## Frozen milestone — M11 public Preview distribution

M11 converted the locally accepted M10 installation into a macOS 14+
Apple Silicon Preview distributed only through GitHub Releases. The target is
`0.2.0-preview.1` with embedded Node `24.19.0`, controlled user-local Pi
`0.84.3`, the exact nine-package M10 tuple, Full and Thin payloads, reproducible
archives, SPDX 2.3 SBOM, GitHub attestations, rollback and explicit full-stack
removal.

H0 passed before any visibility change: a private mirror, all-ref bundle and
compressed mirror were created; the current tree, full history and all 50
historical Actions logs were scanned with the repository scanner and fixed
Gitleaks `8.30.1`; no real secret, auth/session file, LFS object, submodule,
historical archive or oversized blob was found. Exact false-positive
fingerprints and the old-to-new commit mapping remain private.

H1 is complete. The original repository is now the private
`only-my-pi-private-archive`; its original `main`, five historical PRs, 50
Actions runs and feature branches remain intact. The new private
`Ricardo121380/only-my-pi` has one rewritten `main`, no tags and no inherited
PR/Actions refs. All 219 commits map one-to-one; trees, parents, messages,
names, timestamps and file modes are unchanged, while the personal QQ
author/committer email is absent. The new repository remains private.

H2 is complete. Public-baseline source `73c1c005`, its direct evidence-only
child `d2e45ef`, and completion receipt `f0f61a7` re-established authority for
the sanitized history and the current Pi `0.84.3` read-only runtime. Historical
M8-M10 evidence remains legacy inspection material and cannot regain current
release authority.

The local M11 implementation now includes the four release/stack schemas,
complete transitive SRI ledger, SPDX 2.3 SBOM/notices, reproducible Full/Thin
builder, verified acquisition, unified user-local stack transaction, embedded
Node/Pi shims, release/update/rollback/remove CLI, fixed-SHA POSIX bootstrap,
Q1-Q12 manifest, macOS arm64 Q10 workflow and exact-source RC/final attestation
workflows. Q1-Q9 and Q12 pass locally. A real local Apple Silicon Q10 run
installed, verified and removed both payloads under isolated homes with one
`stackId` and generation, zero Provider requests, external/user package
ownership and no Homebrew mutation. The protected local Q11 release matrix
also passed all 20 assertions within its token, time and privacy bounds.

The first private Draft PR workflow was blocked before either Linux job started
because the account's GitHub Actions allowance was exhausted; Q10 was skipped
only because it depends on those jobs. This is
`GITHUB_HOSTED_CI_BLOCKED_BY_ACTIONS_QUOTA`, not a source or test failure. M11
remains `HOLD_PUBLICATION`: local release-candidate authority is
verified, but hosted PR checks, GitHub attestations, repository protections and
immutable publication are still pending. The three macOS workflows use the
standard Apple Silicon `macos-14` runner; no M11 workflow requires a billed
larger runner. No repository publication, public tag or Preview Release is
authorized. Its release work is retained as
`INTERNAL_DISTRIBUTION_FOUNDATION`; it is not current product release authority
and `0.2.0-preview.1` will not be published. The complete boundary is in
[`ADR-0012`](decisions/ADR-0012-public-preview-distribution-and-history-privacy.md).

## Completed milestone — M10 Stable candidate promotion

M9 was merged to `main` on 2026-08-28 by merge commit `510f11c`; the source and
evidence commits remain intact. The post-merge `main` workflow passed on Node
22.19.0 and Node 24.19.0. M10 now owns the separate promotion boundary.

M10 source `6156955` and evidence-only child `9df5f44` completed the protected
real-root and live-model boundary. The exact source-bound bundle applied the
candidate, restored the M8 baseline exactly (including settings order, LKG and
CLI absence), reapplied the candidate, and passed the protected live read-only
matrix. The machine decision is now `PROMOTE`; Stable defaults and the real Pi
stack use Pi `0.84.3`, `pi-subagents@0.57.0`, and the six audited companion
upgrades, while permission-modes, memory and git-sync retain their prior versions.

The migration authority is deliberately narrow: it covers the exact M9
candidate and one confirmed transaction. The nine third-party packages remain
`external/owner=user`; migration is not adoption. Terminal `omp` manages
installation, diagnosis and rollback, while `/omp` inside Pi remains the only
Agent execution entry. The full boundary is versioned in
[`ADR-0011`](decisions/ADR-0011-m10-promotion-and-upstream-migration.md).

The final promoted artifact was built from alignment source `7973a4e` and has
SHA-256 `b718516f...65dd27`. The local installation now reports Pi `0.84.3`,
user CLI `~/.local/bin/omp`, generation `sha256:50caffbf...fc89df`, verified
LKG, `omp status` `INSTALLED`, `omp doctor` `PASS` with generation alignment
`MATCH`, and no incomplete transaction. The candidate and Stable target graph
digests are identical. Six packages use the audited upgrade versions; the
three retained packages remain unchanged, and all nine packages remain user
owned.

P1-P12 are complete: 10/10 deterministic gates and both imported protected
gates passed. P9/P10 record 12/12 and 17/17 protected assertions respectively;
P10 directly measured 41,078 tokens, 319 seconds and five tool calls under the
configured fixed-subscription model, without storing raw output, credentials,
sessions, PID or host paths. The final evidence is
[`2026-08-28-m10-final-promoted-install.json`](../verification/protected/2026-08-28-m10-final-promoted-install.json),
and the completion receipt is
[`2026-08-28-m10-promotion.json`](../verification/receipts/2026-08-28-m10-promotion.json).

Repository publication remains deliberately outside the local evidence chain:
the M10 branch is pushed only after all local work is complete, followed by one
Draft PR workflow and one post-merge `main` workflow. No npm package or GitHub
Release is part of M10.

## Completed milestone — M9 upstream candidates (promoted by M10)

M9 now has a complete deterministic compatibility lane for Pi `0.84.3`,
`pi-subagents@0.57.0`, `pi-agent-extensions@0.5.4`,
`@narumitw/pi-plan-mode@0.55.2`, `pi-web-access@0.25.0`,
`@narumitw/pi-lsp@0.49.6`, and `@sreetej510/pi-usage@0.7.1`. This is a
candidate lane, not by itself an installed-version claim. M10 later promoted
the exact audited tuple; the historical M9 baseline remains unchanged.

Completed M9 evidence and controls on the compatibility branch include:

- exact npm SRI, lockfile, disk manifest, required-entrypoint, lifecycle-script,
  containment, and full symlink-ancestry validation for all seven candidates;
- a version-selected strict RPC v1 dialect for `pi-subagents@0.45.2` and
  `0.57.0`, including the candidate `manage`, management-actions,
  async-status-snapshot, and child-status surfaces;
- an offline candidate Pi probe and a complete 13-entry extension-stack load
  with unique command/tool ownership, no prompt, no child dispatch, no model
  request, and no access to the real Pi home;
- the same session composer driving Agent, BatchSwarm, Workflow ArtifactRef
  flow, SwarmGoal, and Ultra under the `0.57.0` adapter;
- candidate background/status/cancel/resume/stop correlation and 100-cycle
  per-version disposal checks;
- a black-box `pi-web-access@0.25.0` SSRF suite, including redirect-to-private
  rejection, with cookies and `authFetch` denied by only-my-pi;
- the fixed [`upstream-compatibility-gates-v1.json`](../verification/upstream-compatibility-gates-v1.json)
  contract: U1-U8 are credential-free, no-shell deterministic gates; U9 is a
  non-executable protected live candidate matrix;
- the source-bound U9 protected matrix on source `a5a71b5`, recorded by the
  evidence-only child `2af92de`: 17/17 assertions passed for Agent, BatchSwarm,
  Workflow ArtifactRef flow, SwarmGoal replan, Ultra Agent/Workflow routing,
  public Web, cancellation, cross-session resume, budget denial, writer denial,
  exact candidate identity, and explicit subscription-pricing authority;
- a clean full repository regression of **714/714 tests** after the protected
  runner and pricing fail-closed change;
- a complete U1-U9 receipt at
  [`2026-08-28-m9-upstream-compatibility.json`](../verification/receipts/2026-08-28-m9-upstream-compatibility.json).

M9 closed with `HOLD` and did not itself authorize promotion. M10 subsequently
completed the separate real-root/live acceptance and changed the current
machine-readable decision to `PROMOTE`. The historical scope and package
provenance remain in
[`upstream-candidates.json`](../contracts/compatibility/upstream-candidates.json),
with the human-readable compatibility record in
[`compatibility/m9-upstream-candidates.md`](compatibility/m9-upstream-candidates.md).

## Completed milestone — M8 Daily Harness Closure

The S0-S5 kernel is Stable for the pinned source/evidence/receipt chain below.
M8.0-M8.7 are now complete: the normal `/omp` extension composes the unified
session runtime, all five read-only execution classes use the same
`pi-subagents` backend, artifact/run/config/Web/Gate/TUI paths are wired, and
the current user's real Pi home completed apply, smoke, exact pre-install
rollback, verification and reapply. The source/evidence/receipt chain is
`6f77bb6` -> `42185b9` -> `02dac32`; its gate map is
[`../verification/daily-harness-gates-v1.json`](../verification/daily-harness-gates-v1.json).

M8 starts from these explicit truths:

- the current real Pi home already owns nine third-party package entries;
- only-my-pi must borrow verified matching packages and must never remove them
  on uninstall or rollback;
- Agent, BatchSwarm, WorkflowPlan, SwarmGoal and UltraRun remain one logical
  stack over the sole `pi-subagents` physical runtime;
- the production milestone is read-only; the historical protected writer is
  evidence for a synthetic fixture and is not a daily writer capability;
- D1-D12 and D15 passed as 13 fixed deterministic gates; source-bound D13/D14
  also passed as evidence-only gates and remain non-executable from ordinary CI;
- final measured coverage is 85.65/70.46/86.78 globally,
  94.20/80.05/91.67 for the session composer, and 94.43/73.69/85.14 for
  `omp-control` (lines/branches/functions);
- a scripts-disabled, offline, self-contained artifact installs successfully in
  both shadow and real roots; the final artifact SHA-256 is
  `a8d0aaf521f3242776975876f64909fdf97f6e735813146f7258aa95f5fc2455`
  and the installed/LKG generation is `sha256:62ebd02c...d6ab3310`;
- the final D13 matrix passed 14/14 assertions with 32,149 metered tokens, five
  tool calls and no stored raw model output, host paths or credentials;
- the D14 rehearsal passed 6/6 assertions and restored the authorized original
  raw or semantic settings baseline before reapplying the same artifact;
- the final Daily receipt reports `COMPLETE`, 13/13 deterministic gates and
  2/2 protected gates with no protected gate left `NOT_RUN_BY_POLICY`.

M8 protected acceptance is source-bound. `scripts/m8-live-acceptance.mjs` used
the configured Pi model without printing or copying credentials, ran the
Agent/BatchSwarm/Workflow/SwarmGoal/Ultra/Web/cancel/resume/budget/writer-denial
matrix in two Pi processes, and produced
[`2026-08-27-m8-live-model-matrix-final.json`](../verification/protected/2026-08-27-m8-live-model-matrix-final.json).
`scripts/m8-real-root-rehearsal.mjs` produced the separately authorized D14
apply/preservation/exact-rollback/reapply evidence in
[`2026-08-27-m8-real-root-rehearsal-final.json`](../verification/protected/2026-08-27-m8-real-root-rehearsal-final.json).
The combined D1-D15 report is
[`2026-08-27-m8-daily-harness-final.json`](../verification/receipts/2026-08-27-m8-daily-harness-final.json).
Both producers remain plan-first and require explicit `--run --yes`; neither is
callable from ordinary CI. The unsuffixed M8 evidence and receipt files remain
as the audit trail for the earlier closure candidate; the `*-final.json` chain
supersedes it after bounded journal-lock and Ultra budget hardening.

The Harness MVP was fast-forwarded to private repository `main` at
`12b24b59980386683a90af8250a4de4ff738d67c`. The post-merge `main` workflow
completed successfully on Node 22.19.0 and Node 24.x. GitHub Actions now pins
`actions/checkout@v7.0.1` and `actions/setup-node@v7.0.0` by full commit SHA;
both actions use the Node 24 action runtime rather than the deprecated Node 20
runtime.

The installed Pi runtime was rechecked on **2026-08-16**. npm advertised
`@earendil-works/pi-coding-agent@0.84.2`, but this Goal intentionally leaves the
validated local `0.84.1` runtime unchanged; registry availability is not local
installation or compatibility evidence.

This page is a checked-in handoff record. Exact package metadata and risk tags
live in [`inventory/packages.lock.json`](../inventory/packages.lock.json); this
summary intentionally contains no credentials, sessions, or host paths.

## Historical successor roadmap — S0-S5 Stable kernel achieved

The M0-M7 Harness MVP and S0-S5 successor are historical completed baselines.
The exact Stable source/evidence/receipt chain is recorded later on this page:

- [`plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md`](plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md)
- [`../codex/goals/develop-only-my-pi-subagents-ultrarun.md`](../codex/goals/develop-only-my-pi-subagents-ultrarun.md)
- [`architecture/subagents-s5-release.md`](architecture/subagents-s5-release.md)

The successor does **not** connect Pi to the Kimi runtime. It builds one Pi-native
`@only-my-pi/subagents` facade while retaining `pi-subagents@0.45.2` as the sole
physical child/session/worktree backend. Kimi Code and hosted Kimi Agent Swarm
contribute audited source patterns and product concepts; Claude Code Dynamic
Workflows contributes the UltraRun staging model.

The approved semantic split is:

- `Agent`: one bounded child assignment;
- `BatchSwarm`: one resolved AgentSpec mapped over many homogeneous items;
- `WorkflowPlan`: the only durable heterogeneous DAG and resume representation;
- `SwarmGoal`: a dynamic planner that emits immutable WorkflowPlan revisions;
- `UltraRun`: an upper-layer strategy that routes and chains multiple workflows,
  with no separate scheduler or permission owner.

S5 deterministic release governance, the protected-evidence importer, the
S5-A Alpha capture producer, the separate S5-B background-resume producer, the
S5-C protected guarded-writer producer, and the S5-D deterministic fault/
recovery closure are now implemented on this branch.
The versioned
compatibility matrix, cumulative promotion policy, `release-gates-v2`
manifest, protected-evidence and one-time authorization schemas, and Ed25519
trust policy are strict, digest-bound contracts. The producer composes the
read-only Agent terminal, correlated cancellation, and two-item BatchSwarm
scenarios through the sole `pi-subagents` backend, with an empty disposable Pi
root, a synthetic fixture workspace instead of the source checkout, a
canonically recompiled and drift-checked read-only `omp-reviewer`, temporary
upstream artifacts, cumulative capture budgets, pre/post clean-source checks,
pairwise-disjoint roots, credential allowlist, exact runtime-row preflight,
required token/cost metering, process-group wall deadlines, bounded
low-sensitivity records, external digest-only signing, and review-only staging.
S5-B adds a fixed two-parent-process scenario over one isolated persisted Pi
session: process one performs a background launch and writes a private
digest-bound handoff; process two reloads the same parent session and creates a
new correlated binding through the public `resume` RPC. Session-scoped
upstream artifacts allow restart recovery without writing into the source or
fixture workspace. The final record requires two authoritative terminals plus
parent-session-reload and backend-rebind proof digests and stores no session,
backend, output, credential, or host-path values.
S5-C adds a third, independently authorized path for exactly one canonical
`omp-implementer` in a synthetic Git repository and an upstream-managed
worktree. The ordinary compiler still rejects the backend's `DEGRADED`
worktree capability; only the protected fixture path can opt into the recorded
`protected-degraded-probe-v1` admission. After an authoritative child terminal,
the parent ignores child path/patch assertions. When upstream removes its
worktree after capturing the handoff patch, only-my-pi reconstructs a detached
review worktree at the approved base and applies the patch there, then
independently verifies the exact staged file claim, absence of untracked and
unstaged changes, regular-file modes, bounded full diff, `git diff --check`,
and fixture marker. The result is a handoff-only WriterHandoff and digest-only
evidence; there is no commit, merge, push, source-checkout apply, or automatic
integration.
S5-D adds stable fail-closed coverage for a started parent with no terminal,
truncated/missing handoff state, missing worktrees, parent Git failure,
signer/staging interruption, and post-capture source drift. Its separate
guarded-writer reconciliation planner derives exactly one authorization-bound
disposable runtime target and emits a digest-bound review plan without host
paths. It has no apply/delete surface: all existing targets remain
`RETAIN_FOR_REVIEW`, including complete ones, because process liveness and
evidence/handoff disposition are not inferred.
Token/cost ceilings are signed reconciliation gates rather than a verified
mid-child billing circuit breaker. The checked-in default remains inert. One
external one-time Alpha authorization was used for three live cancel attempts on
2026-08-22. The first exposed that upstream async workflows reject `interrupt`;
the second exposed that the v2 adapter sent the undocumented `target` field
instead of upstream's public `runId` field for management RPCs. The third proved
that nested `workflowScript -> runs.run` completes its inner child but leaves
the outer workflow runner without a timely process-terminal proof. All three
failed closed, produced no signed/staged evidence, and left no live child. S5-A
then moved to the same physical package's single-layer structured delegation
transport, which emits a terminal response only after child exit. These are
historical pre-Alpha failures; the later Alpha and Beta source-bound chains
below supersede them without rewriting that audit history.

The first structured-delegation attempt then reached correlated terminal and
usage data but failed closed before signing because the capture reducer chose
a redacted `totalTokens` projection ahead of the numeric `usage.total`
fallback. The reducer now selects only finite numeric token/cost candidates and
has a direct TerminalReceipt regression. No staged evidence was produced.

The next bounded run completed the terminal and both Batch children but was
rejected before signing because cumulative usage was about 40,588 tokens versus
the 20,000-token authorization (cost was about $0.0094 versus the $1 ceiling).
The lifecycle probe now blocks every external tool and permits exactly one
internal `structured_output` call, so it cannot repeatedly spend cached context
reviewing a synthetic fixture. The ceiling was not widened and no additional
live run is authorized implicitly.

After external tools were blocked and only `structured_output` remained, a
source-bound run completed all four children at 8,351 tokens and about
$0.00499. Import review then found that the staging writer persisted the
validator's derived `scope` projection, making the otherwise valid signed JSON
fail the strict schema. The files were not imported. The writer now persists
the exact signed schema document, and the compatibility digest has an explicit
protected-overlay projection so the next evidence-only child commit cannot
create a matrix-digest cycle.

The S0–S4 source slice now contains:

- source dossiers, two ownership/state ADRs, and a dedicated 35-item subagents
  threat model;
- typed AgentTemplate v2, ResolvedAgentSpec, TaskAssignment, stable handle,
  BackendCapabilityV2, and TerminalReceipt v2 contracts;
- an exact `pi-subagents@0.45.2` extension-RPC backend using statement-body
  compilation, explicit backend-ID mapping, and correlated terminal proof;
- WorkflowDefinition v2 to immutable WorkflowPlan compilation, a single
  RunCoordinator, writer lease/fencing, hash-chained events, atomic snapshots,
  parent budget reservations, canonical run-input binding, a stable per-run
  execution envelope, run-bound ApprovalReceipt validation, and fail-closed
  mutation recovery. Long-running nodes renew the single writer lease, and
  crash recovery charges any child that may have started against its full
  reservation rather than refunding unknown work;
- deterministic dual-read migration of all four heterogeneous legacy Swarm
  recipes into WorkflowPlan rather than BatchSwarm;
- a true homogeneous BatchSwarm runtime: one hash-bound ResolvedAgentSpec and
  prompt template mapped over 0–300 stable item slots, with static progressive
  ramp, capability-gated adaptive 429 backoff, finite retry, explicit failure
  policies, bounded per-item output, deterministic input-order aggregation,
  and item-level provenance;
- a structured `pi-subagents` item adapter that creates an AgentRunHandle and
  TaskAssignment for every admitted item. It never accepts caller-supplied
  workflow source and requires correlated terminal/process proof from the sole
  physical backend;
- durable Batch events inside the same RunCoordinator journal and parent
  reservation. Crash recovery reuses that reservation and skips an item only
  after an authoritative terminal; a started item without terminal proof is
  charged at worst case and is never replayed;
- a strict registry plus `omp swarm batch` and `/omp swarm batch`
  list/show/validate/plan/run/status/cancel/resume surfaces. Planning is offline
  and reports `NOT_RUN_BY_POLICY`; live run still requires the explicitly
  injected trusted Pi session runtime;
- a bounded SwarmGoal controller that accepts only human-authorized governed
  goals, derives at least three heterogeneous registered AgentSpecs, journals an
  immutable WorkflowPlan proposal before execution, reserves the shared parent
  budget, reuses only proved read-only content-addressed results, and requires a
  fresh independent verifier before root success;
- root-level crash recovery for the proposal/child-run/revision state, including
  the settlement-to-terminal crash window, plus fail-closed worst-case charging
  for a revision that reports usage above its reservation;
- an UltraRun policy/router with explicit U0–U6 phase evidence and
  `quick|standard|deep|critical` quality policies. It selects Agent,
  homogeneous BatchSwarm, predefined Workflow, or explicit dynamic SwarmGoal
  without owning scheduling or permissions;
- a content-addressed, run-scoped immutable ArtifactStore and a writer handoff
  contract that requires non-overlapping file claims, managed-worktree/base
  commit evidence, parent diff verification, authoritative terminal proof, and
  passing fixed gates. Automatic integration remains disabled;
- strict `omp swarm goal`, `/omp swarm goal`, `omp ultra`, and `/omp ultra`
  list/show/validate/plan/run/status surfaces. Offline planning returns exact
  plan/authorization digests; standalone live execution remains unavailable;
- public Workflow/Swarm compatibility facades that use the legacy catalogs as
  readers, assign one stable run ID while planning, require the confirmed plan
  and execution-envelope digests on execution, reuse the exact input snapshot,
  and delegate all live lifecycle work to the one injected RunCoordinator;
- a 15-case, fixed-seed, three-baseline offline evaluation corpus.

This branch retains the source-bound Alpha promotion chain. Source commit
`922b39bc1a8b2bc387cadf66dc366565c47a14f5` is followed by evidence-only
commit `15f29159617d9374cff25136fead29d39e3488d0` and receipt-only commit
`312fc2df97fe1d82da86e4d8d9a5374b6107a232`. The receipt proves 25/25
deterministic gates plus the protected read-only gate. Its live capture used
OpenCode Go `deepseek-v4-flash`: four children, 8,154 tokens, about $0.00474,
and 75.0 seconds. No raw output, host path, credential or session identifier is
stored in the evidence files. Earlier Preview receipts remain historical.

The branch now also contains the cumulative Beta chain. Source commit
`6004e6128dec76d8c301894c289a23d5dc855558` is followed directly by
evidence-only commit `1d19b5c4a44da9b4abe2706c14cd7d3951b2fb71` and
receipt-only commit `cb1a8db81300443002bba4bcff7e8bd4f02adac3`. The
receipt reports `requested=beta`, `achieved=beta`, `eligible=true`, no findings,
25/25 deterministic gates, and 4/4 protected gates. All five cumulative live
documents bind the exact source, matrix, promotion policy, trust policy,
runtime row, proof digests, and Beta signer.

The final OpenCode Go `deepseek-v4-flash` captures used seven children and
28,334 tokens for about $0.02074 in total: inherited Alpha classes 8,117 tokens
and about $0.00391; two-process background/resume 13,067 tokens and about
$0.01178; guarded writer 7,150 tokens and about $0.00506. The evidence stores
no raw output, host path, credential, session identifier, patch byte, or
changed path. The guarded writer modified only a synthetic fixture, and the
parent reconstructed and retained a detached disposable review worktree;
source `HEAD`, commit history, and worktree remained unchanged.

The branch now additionally contains the complete Stable chain. Source commit
`2207d7230217ebd9efdf0f308e6830f52a9d38ff` is followed directly by
evidence-only commit `076052d12cfa3b4b68cd58b560252909eb3ba161` and
receipt-only commit `b205a0b6a848fe5c5785da502dd424354c2c795d`. The Stable
receipt reports `requested=stable`, `achieved=stable`, `eligible=true`, no
findings, 27/27 deterministic gates, and 4/4 protected gates across 31 required
gates. The five new documents use Stable-specific paths and do not overwrite
the historical Alpha/Beta evidence families.

The Stable OpenCode Go `deepseek-v4-flash` captures used seven children,
23,004 tokens, approximately $0.016334112, 22,214 bounded output bytes, and
185,566 ms of aggregate scenario wall time: read-only terminal/cancel/two-item
BatchSwarm used 7,605 tokens and about $0.0041074; two-process
background/resume used 9,546 tokens and about $0.007916096; guarded synthetic
writer used 5,853 tokens and about $0.004310616. Every evidence document binds
the Stable source, compatibility matrix, promotion policy, trust policy,
runtime row, authorization and proof digests, and stores no raw output, host
path, credential, session ID, patch bytes, or changed paths.

The deterministic tests use
injected transports and temporary roots. A separate disposable-root,
no-model Pi probe now proves the public `pi-subagents@0.45.2` `ready`/correlated
`ping` handshake and single physical tool ownership. It submitted no prompt,
made no Provider/model request, dispatched no child, read no credential, made
no global install, and did not read or mutate the real Pi home.
All planned orchestration contracts plus the evaluation-corpus, durable
run-control, compatibility, promotion, protected-evidence, and evidence-trust
contracts are now registered in the strict catalog. The catalog validates 42
kinds and 77 non-vacuous production documents, with positive,
unknown-field/version, and
targeted semantic negatives. Public Workflow/Swarm routing now converges on
the v2 facade. Approval fails closed without a live evidence provider,
revalidates repository/capability scope on resume and before every mutating
node admission, and cannot be replayed for a second run. Unfinished
content-addressed read-only attempts can be deterministically requeued, while
unfinished mutation is settled as interrupted and is never silently replayed.
Every node deadline and reported token/cost/output overrun is enforced against
the reserved envelope. A local deadline without correlated process-terminal
proof is non-authoritative and makes the run `orphaned`, never a forged
`timed-out` terminal claim. Child output is depth/node/byte bounded before
cloning or serialization. Mutating admission additionally requires an executor
that explicitly advertises audited path enforcement; the current
`pi-subagents` v1 wire does not itself prove a per-path allowlist, so the
general live writer seam remains unavailable rather than being inferred from a
worktree. S5-C does not widen that claim: it is a separately authorized
synthetic-fixture evidence producer whose parent validates the staged handoff
after execution.
The immutable Plan Store now persists the exact run-ID-to-WorkflowPlan binding;
fresh coordinators can re-project status, publish cross-process cancel intent,
and resume read-only/recoverable runs after restart without persisting raw
input. The static single-owner topology probe, packaged-artifact inclusion, and
the separately authorized live no-model capability/visibility probe now pass.
The digest-bound no-model receipt is
[`../contracts/subagents/pi-subagents-live-no-model-evidence.json`](../contracts/subagents/pi-subagents-live-no-model-evidence.json).
It proves startup, public RPC compatibility, and tool ownership only; it is not
being reinterpreted as child evidence. Separate signed Stable documents prove
live Agent terminal/cancellation, two-item homogeneous BatchSwarm,
two-parent-process background/resume with metering, and one guarded synthetic
writer handoff. Exact darwin/Node 22.19.0/Node 24.19.0 rows record
`soakResourceLeak: PASS`, and the cumulative Stable receipt closes the declared
promotion contract. Dynamic SwarmGoal execution and general
production-repository writer admission remain deliberately outside this claim.
Producer implementations and deterministic tests are not live evidence by
themselves; only the five imported, source-bound documents satisfy the
protected claims.
Historical M5 receipts must not be described as successor evidence.

The Stable source and receipt prove:

- `npm test`: **587/587** pass;
- `tests/subagents-resource-leak.test.mjs`: **7/7** lifecycle soak groups pass
  in about 13 seconds when run alone;
- RPC request disposal, terminal-event waiters, structured delegation starts,
  and BatchSwarm deadline/ramp/retry timers each pass 100 deterministic cycles;
- RunCoordinator passes 32 completed-run cycles and 16 uncooperative-child
  cancel/orphan cycles with zero retained scheduler handle, active run, writer
  lease, state lock, or temporary file;
- Artifact Store passes 100 publish/read cycles, while injected Plan Store,
  Artifact Store, and Event Journal publication faults leave no temporary or
  lock residue;
- adapter disposal now settles pending requests/waiters through injected,
  auditable schedulers instead of leaving a real timer alive until timeout.

The exact Linux Node 22.19.0 and Node 24.19.0 CI lanes, compatibility matrix,
resource-lifecycle soak, cumulative source-bound protected evidence and Stable
receipt are now closed. Historical Beta evidence remains valid only for its
pinned source and was not silently rebound; the Stable source used a new
signer, three new one-time authorizations and five new evidence files.

Historical Beta source evidence and release receipt:

- `npm test`: **581/581** pass in the source regression run;
- `npm run test:subagents`: **198/198** pass;
- `npm run test:contract`: **149/149** pass;
- `npm run test:integration`: **182/182** pass;
- `npm run schema:check`: **77 production documents / 42 schema kinds / 0 findings**;
- `npm run pack:check`: **292 allowlisted files**, with no tests, receipts, or
  Codex Goal in the tarball;
- `npm run lint`: **737 tracked files / 0 findings** after evidence and receipt
  import;
- `npm run secret:scan`: **737 tracked files + 292 packed files / 0 findings**;
- `npm run test:e2e`: fresh scripts-disabled offline tarball install, packaged
  topology doctor, zero-write plan, bootstrap, idempotent second apply,
  rollback, and final `NOT_INSTALLED` status pass. The verification used a
  temporary credential-isolated cache warmed from the exact lockfile and
  moved that temporary root to Trash after completion. The unified gate now
  forwards an explicitly selected cache only to `test-e2e`, and only after it
  resolves inside the actual user npm-cache root or the system temporary root;
- `npm run doctor`, all six Profile doctors, Mode/Agent/Workflow/Swarm doctors,
  BatchSwarm, SwarmGoal, and UltraRun doctors, `npm run typecheck`, and the
  deterministic agent/profile generators: pass.
  Static doctor retains only the two explicit inactive-candidate warnings.

The S5 deterministic runner, protected importer, S5-A capture/signing path,
S5-B two-process background-resume path, S5-C guarded-writer path and Stable
promotion runner have completed the exact source/evidence/receipt protocol
above. All three capture plan commands currently report
`CONFIGURED_UNAVAILABLE`, with Provider/child/signer all `NOT_STARTED`, because
the three Stable external authorizations were deliberately downgraded to
`operator-template` after capture. The source-pinned trust policy contains
distinct, time-bounded Alpha, Beta and Stable public signers; a public key does
not authorize execution by itself. All three capture commands require a
credential-free Provider descriptor whose digest is bound by their respective
authorization. The commands'
`declaredEndpointHosts` are auditable metadata, not OS network enforcement.
The three authorization contracts remain non-interchangeable and cannot be
reused to start another live capture. Stable closure is complete only for the
exact source/evidence/receipt chain above. It authorizes no merge, tag, package
publish, release, real Pi home mutation, general writer mode, or automatic
integration.

## Current external Pi baseline

These exact versions are already present in the local Pi package selection and
are recorded as global baseline capabilities:

- `@narumitw/pi-plan-mode@0.49.3`
- `pi-agent-extensions@0.5.2` (sessions/context/review/notify only)
- `pi-web-access@0.20.0` (enabled by the current `research` and
  `orchestration` presets; `coding` may opt in after the planned orthogonal
  capability-overlay refinement)
- `pi-subagents@0.45.2` (budgeted; shared-cwd writers have a hard maximum of
  one, and parallel writers require isolated managed worktrees)
- `pi-permission-modes@2.2.0` (policy owner; conditional OS sandboxing applies
  only to eligible Bash subprocesses; report `active`/`degraded`, and do not
  infer session, file, web, MCP, provider, or extension isolation)
- `@narumitw/pi-lsp@0.49.4`
- `@sreetej510/pi-usage@0.4.5`
- `pi-memory@0.4.1` (the one active memory owner)
- `pi-git-sync@0.1.3` (reviewed resource sync only)

The repository does not synchronize `~/.pi/agent/auth.json`, model catalogs,
sessions, caches, or local npm installs.

## First-party modules now in the repository

The package manifest exposes three bounded first-party Pi runtime extensions
when this checkout or a verified generation is explicitly loaded:

- `session-ledger`: local append-only JSONL operational receipts with per-run
  HMAC correlation and no raw prompt/reasoning/tool payloads;
- `context-doctor`: aggregate context/tool-schema metrics, with no command
  ownership, context mutation, or persistence;
- `omp-control`: the sole `/omp` and compatibility `/omp-context` command
  owner. It exposes status/profile/mode/tool/package/context/verify/safe views,
  while hard policy changes fail closed to `RESTART_REQUIRED` when no audited
  public execution-state driver is available.
- `theme-service` and `status-service`: first-party, low-intrusion control
  services. The former validates a semantic contract and delegates mutations
  only to Pi's public `setTheme`; the latter emits a bounded,
  `injected-observations-only` status projection without secrets or a
  whole-session sandbox claim.

The rest of the repository tooling is explicit and side-effect bounded. M1
replaced descriptive-only checks with strict, versioned governance:

- `package-doctor`: exact source/SRI, dependency topology, Profile/capability,
  owner, command, resource, and enforcement-surface consistency gate;
- `profile-resolver`: deterministic Profile projection and diff, read-only;
- `safe-mode`: dry-run-first read-only Pi launcher;
- `verification-receipt`: allowlisted no-shell checks with metadata-only receipt;
- `mcp-doctor`: static MCP configuration audit, never starts a server;
- Draft 2020-12 validation for 16 catalogued schema kinds (including the
  semantic theme contract and four transactional bootstrap wires), with
  semantic reference, cycle, duplicate-owner, and capability-escalation checks;
- a positive npm pack allowlist that excludes receipts, fixtures, research,
  tests, the Codex Goal, and Labs implementations;
- deterministic JSON-to-Markdown generation for package-owned
  `pi-subagents` Agent resources;
- a fixed `release-gates-v1` command/argv manifest and parser-injection
  negatives, connected by M7 to the executable receipt and CI flow.

Profiles now separate single-agent and orchestration use explicitly. `research`
does not claim subagents; only `orchestration` selects the one governed
`pi-subagents` runtime. Static resolution reports runtime-dependent capabilities
as `CONFIGURED_UNVERIFIED`, never as live or sandboxed.

Profiles are defaults, not permanent feature silos. The next Profile refinement
will separate base workload (`coding`, `research`, `orchestration`) from
orthogonal capability overlays such as Web, LSP, memory, UI, and subagents. In
particular, Web search must be available to a coding session when explicitly
selected without forcing that session to adopt the full research preset.

Two version-locked compatibility spikes are also complete:

- `pi-permission-modes@2.2.0` has no audited public cross-extension read or
  hot-switch API, so hard execution-state changes return `RESTART_REQUIRED`;
  its OS sandbox is conditional and limited to eligible Bash subprocesses.
- `pi-subagents@0.45.2` remains the sole physical child runtime. The runtime
  now uses two upstream-owned, version-locked protocols without introducing a
  second scheduler: structured delegation for read-only foreground Agent/
  BatchSwarm children, and extension RPC for asynchronous workflow management,
  background/resume, and control. Caller-supplied workflow source is still
  forbidden.

M2 now turns those governed inputs into an installable, transactional
configuration runtime:

- `omp bootstrap`, `update`, and `uninstall` are zero-write plans unless the
  caller explicitly supplies `--apply` and confirms the mutation;
- package and first-party resource graphs are staged and verified in an
  immutable generation before owned settings are published last;
- exact direct tarballs are checked against their reviewed integrity metadata,
  package lifecycle scripts are disabled, and the complete realized install
  tree is content-hashed;
- exclusive locks, durable phase journals, owned-field snapshots,
  last-known-good state, compare-and-swap rollback, and phase-boundary recovery
  cover first install, update, uninstall, rollback, and interrupted operations;
- `status`, static `doctor`, `safe`, and rollback planning are available through
  the same production control service and `omp` executable;
- Provider/model flags persist only bounded identifiers with
  `CONFIGURED_UNVERIFIED`; bootstrap never reads credentials or submits a
  prompt;
- the final smoke starts Pi in RPC mode against an isolated, empty credential
  root, checks both runtime state and the expected first-party
  `omp`/`omp-context` command registration, and submits no model request. This is a
  startup/configuration check, not a filesystem or network sandbox for
  extension code.

M3 now supplies the runtime behavior layer on top of that transactional graph:

- a versioned Mode Registry with deterministic discovery, namespaces,
  inheritance, immutable hashes, explain/diff, Profile-ceiling intersection,
  path/symlink/cycle/collision checks, and read-only scaffolding;
- built-in, user, explicitly trusted project, and reviewed-package source
  roots without implicit selection when names collide;
- `omp mode list|show|diff|doctor|scaffold|use|reset` and the equivalent
  `/omp mode` surface through the same resolver;
- bootstrap resolves an initial Mode as read-only evidence, while session
  activation uses only public Pi prompt/status/append seams and never creates
  a competing permission owner;
- mode activation appends a bounded `only-my-pi-mode` receipt; on session
  restore the extension re-resolves the current registry and restores the next
  prompt only when mode and source hashes match, otherwise it reports
  `STALE_MODE_SNAPSHOT` or ignores malformed evidence;
- staged generations include the Mode schema, prompt, Profile, policy, and
  inventory data needed by relative imports. A fresh scripts-disabled tarball
  can list and resolve `inspect` without a checkout or package-level Ajv lookup.

M4 now supplies the practical single-Agent harness layer:

- eight runtime-ready Modes (`inspect`, `explore`, `plan`, `coding`, `debug`,
  `review`, `research`, `verify`) have distinct prompts, tool ceilings,
  egress declarations, workflows, and structured completion gates;
- `packages/agent-registry` validates role manifests, prompt containment,
  Profile ceilings, source hashes, and redacted receipts; canonical JSON roles
  generate namespaced `omp-*` Pi-subagents resources;
- `packages/workflow-core` provides deterministic DAG discovery, parent-session
  `SingleAgentWorkflowRunner`, durable injected state, source-drift checks,
  structured terminal verdicts, real AbortSignal cancellation, and explicit
  unavailable/fallback behavior for M5 `swarm` steps;
- `packages/gate-runner` is the only M4 verification executor and accepts only
  fixed release-gate command tuples with `shell:false`, bounded output,
  timeout, cancellation, and digest-only receipts;
- five JSON Workflows, `.agents/skills` discovery/precedence, and an Aider-style
  bounded repo-map adapter are packaged as opt-in resources; M1 contract seeds
  remain contract-only where their upstream runtime is not yet connected.

M5 now supplies the governed AgentSwarm layer without introducing a second
child scheduler or subagent owner:

> Successor note（2026-08-18）：下列 M5 controller/compiler 仍作为 direct-import
> 兼容实现保留；公共 `omp workflow`、`omp swarm` 与 `/omp` 路由已经不再创建它们，
> 而是把旧资源迁移为 WorkflowPlan 并交给 `packages/subagents/` 的统一
> RunCoordinator。历史 M5 evidence 不能充当 successor live evidence。

- `packages/swarm-core` discovers and validates four versioned recipes, applies
  Profile/Mode/role budget intersections, rejects recursive or unsafe writer
  topologies, compiles a JSON-safe `workflowScript`, and aggregates child
  results in stable recipe order;
- `packages/pi-subagents-adapter` remains the legacy RPC compatibility seam.
  The successor runtime pins the same `pi-subagents@0.45.2` package and uses
  extension RPC for async workflow/background/resume/control plus structured
  delegation for read-only foreground Agent/Batch execution. Both refuse
  private imports and caller-provided executable workflow source;
- read-only research, review, and debug recipes never receive `bash`, `edit`,
  or `write`; tester/verifier evidence is supplied by the fixed Gate Runner;
  coding writers require a negotiated managed-worktree capability and shared
  cwd writer concurrency is one;
- `omp swarm list|show|validate|plan|run|status|cancel` and `/omp swarm` share
  the same bounded control service. Planning is offline and read-only; `run`
  returns `LIVE_SWARM_REQUIRES_PI_SESSION` without an injected Pi RPC session;
- five additional role manifests are generated into namespaced `omp-*`
  resources, and `research-synthesis` is the first promoted read-only recipe.
  The other contract seeds remain explicit and non-default.

M5 verification is intentionally fake/injected-runtime evidence: no live child
dispatch, Provider call, credential read, global install, or real Pi home
mutation was performed. A worktree capability is negotiated at admission, but
the adapter does not claim that the upstream child runtime itself is an OS
sandbox; any degraded Bash state must remain visible to the caller.

M6 now supplies the presentation layer without taking ownership of Pi's TUI:

- `schemas/theme-v1.schema.json` and `contracts/themes/only-my-pi-dark.json`
  bind a Pi-native theme file to semantic tokens, dark-mode metadata, and
  recomputed contrast receipts. The semantic contract is kept outside
  `themes/` so Pi's own theme loader never sees it;
- `omp theme list|show|preview|doctor|use|reset` and `/omp theme` share the
  same bounded service. Listing, inspection, preview, and doctor are
  read-only; use/reset are plan-first and require explicit approval;
- theme application is available only through the public Pi UI `setTheme`
  driver. Headless CLI apply returns `THEME_APPLY_UNAVAILABLE`, and reset
  restores Pi's built-in `dark` theme as the safe-disable path;
- `StatusService` is shared by CLI and Pi runtime. It reports low-sensitivity
  profile/mode/model/context/Git/permission/Swarm/theme observations, marks
  provenance explicitly, and keeps Bash sandbox state separate from any
  whole-session isolation claim.

The repository audits the direct package tarballs before staging and then
hashes the entire realized dependency tree. It does not yet carry an independently
audited SRI closure for every transitive dependency; first transitive resolution
therefore still relies on npm registry metadata inside the isolated staging
runner.

The repository also contains three explicit, non-default integration seams:

- `deepseek-conformance`: dependency-free, injected-transport fixtures for
  DeepSeek-compatible Chat Completions requests, thinking/reasoning content,
  streamed parallel tool calls, usage/cache fields, retry/abort behavior and
  bounded error/output handling. It does not call a provider or read a key.
- `acp-v1`: runtime-neutral ACP v1 JSON-RPC/NDJSON agent-side adapter with
  `initialize`, session create/load/prompt/cancel, update notifications and
  permission request/response handling. It does not start Pi, an ACP process,
  an MCP server or a network transport.
- `workspace-checkpoint`: Git-backed snapshots under the Git directory,
  manifest hashes, symlink/path checks and a dry-run-first restore/undo CLI.
  Applying a restore requires explicit `--run`, and changed workspaces also
  require `--force`; file deletion additionally requires `--allow-delete`.

Their shared status is `EXPERIMENTAL_OFFLINE`. The canonical non-default and
graduation boundary is documented in [`LABS.md`](LABS.md).

## Trial and block decisions

Audited with exact npm tarballs and Pi startup smoke, but not promoted to the
global or project package selection:

- `pi-terminal-theme@0.2.0`: pure MIT theme package; plain `terminal` is the
  first visual candidate, tinted palette remains a visual-check opt-in;
- `pi-simplify@0.2.3`: current Pi peer scope, narrow `/simplify` diff review;
  needs a real Provider/model smoke in a disposable worktree before promotion.

Blocked for the current runtime until adapted:

- `pi-workspace-history@0.2.2`: old `@mariozechner/pi-coding-agent` peer;
- `pi-tool-display@0.5.0`: peer metadata only declares the older Pi range and
  owns a renderer surface.

No second memory, MCP bridge, subagent stack, footer/editor takeover, or
automatic browser-cookie capability has been enabled.

## Verification evidence

Run locally:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run agents:check
npm run pack:check
npm run test:deepseek
npm run test:acp
npm run test:checkpoint
npm run doctor
npm run doctor:profiles
npm run doctor:subagents-topology
npm run doctor:batches
npm run profile:check
npm run schema:check
npm run mcp:doctor -- --file verification/fixtures/mcp.safe.json --strict
npm run verify  # inspect release-gates-v1; never executes gates
npm run lint
npm run secret:scan
npm run test:e2e
```

The four 2026-08-15 receipts were produced before the executable
`release-gates-v1` runner existed. They remain historical evidence only and
must not be used to claim the Harness MVP release gate. The canonical M7
receipt is `2026-08-16-harness-mvp.json`; it binds source commit
`6941761b3948d96a77596e1302d3205efb5169f1`, is the only file in its receipt
commit, and was revalidated after fast-forwarding to `main`. The M7 runner
executes only the fixed manifest, requires a clean source commit, and writes a
metadata-only receipt with exclusive-create semantics:

```bash
npm run verify -- --run --output verification/receipts/2026-08-16-harness-mvp.json
npm run receipt:check -- --receipt verification/receipts/2026-08-16-harness-mvp.json
```

The current M7 source gate set passes **350/350** Node tests, including the M2
transactional suite, Mode Registry, unified control, staged-generation,
Agent Registry, Workflow Core, Gate Runner, skills bridge, repo-map, Swarm
Core, PiSubagentsAdapter, theme/status services, and fresh-tarball closure
tests. It validates 47 production documents against 16 schema kinds,
typechecks against the exact Pi 0.84.1 development dependency,
passes static, per-Profile, Agent, Workflow, and Swarm doctors, and packs the
current allowlisted runtime files (164 files in the current source tree). Crash injection covers every durable transaction phase,
including the settings rename window. Injected Workflow tests cover
deterministic stage order, structured gate receipts, source drift, explicit
fallback, resume, and cancellation terminal proof. A disposable
scripts-disabled tarball install proves the npm `.bin/omp` entry, help output,
zero-write plan, and absence of checkout-path dependence. No live Provider
call, child dispatch, global install, or real Pi home mutation is part of this
evidence.
`doctor:live`
without an injected non-sensitive runtime metadata seam intentionally returns
`UNAVAILABLE`; that is a correct boundary, not a failed static configuration.
Synthetic runtime metadata remains a library-level conformance seam only: the
public CLI rejects arbitrary `--metadata` files, so self-asserted state cannot
be promoted to live PASS evidence.

Committed receipts:

- [`2026-08-15-bootstrap.json`](../verification/receipts/2026-08-15-bootstrap.json)
- [`2026-08-15-mcp-bootstrap.json`](../verification/receipts/2026-08-15-mcp-bootstrap.json)
- [`2026-08-15-status.json`](../verification/receipts/2026-08-15-status.json)
- [`2026-08-15-three-increments.json`](../verification/receipts/2026-08-15-three-increments.json)
- [`2026-08-16-harness-mvp.json`](../verification/receipts/2026-08-16-harness-mvp.json)

The four historical receipts record successful bounded checks without raw
command output. The canonical Harness MVP receipt records all 14
`release-gates-v1` gates, including the 350-test repository run and fresh
tarball end-to-end evidence. Its source commit and receipt-only parent relation
are verified independently by `receipt:check`.

The post-merge status and Action-runtime maintenance in this source snapshot is
bound by a second receipt-only child commit at
`verification/receipts/2026-08-17-post-merge-maintenance.json`. Keeping that
receipt out of the source commit preserves the same parent-verification
invariant as the Harness MVP receipt.

## Next implementation boundary

The local M12.7 boundary is closed by the source/evidence/report chain above.
The acceptance host can start `omp` directly and recover the prior M11 stack.

The next release boundary is M12.8, after hosted quota is available:

1. retain the source/evidence commits without squash or amend;
2. push the locally verified branch once and open the planned Draft PR;
3. run the minimum required hosted CI, changing code only for demonstrated
   failures rather than producing test-only pushes;
4. merge with the evidence history preserved and run one main CI; and
5. build and verify the exact `0.3.0-preview.1` RC before any approved Preview
   publication.

Until then, keep `HOLD_PUBLICATION`, do not publish `0.2.0-preview.1`, and use
the locally installed M12 Agent. New feature work is not required to substitute
for hosted release acceptance.
DeepSeek endpoint conformance, ACP-to-Pi wiring, automatic checkpoints, MCP,
daemon work, cross-platform support and a general package manager remain
outside this boundary. Historical M0-M11 plans and evidence stay available for
audit but do not define the current product entry.
