# only-my-pi status

Baseline snapshot: **2026-08-15** · Roadmap updated: **2026-08-27** · Stable
kernel merged to `main`: **2026-08-27** · Pi **0.84.1** · Node **25.8.0** · macOS
`darwin-arm64`

## Active milestone — M8 Daily Harness Closure

The S0-S5 kernel is Stable for the pinned source/evidence/receipt chain below.
M8.0-M8.6 are now implemented: the normal `/omp` extension composes the unified
session runtime, all five read-only execution classes use the same
`pi-subagents` backend, and artifact/run/config/Web/Gate/TUI paths are wired.
The product is not yet claimed complete because protected live-model and
real-root rollback/reapply evidence (D13/D14) is still pending. Its implementation branch is
`codex/m8-daily-harness` and its gate map is
[`../verification/daily-harness-gates-v1.json`](../verification/daily-harness-gates-v1.json).

M8 starts from these explicit truths:

- the current real Pi home already owns nine third-party package entries;
- only-my-pi must borrow verified matching packages and must never remove them
  on uninstall or rollback;
- Agent, BatchSwarm, WorkflowPlan, SwarmGoal and UltraRun remain one logical
  stack over the sole `pi-subagents` physical runtime;
- the production milestone is read-only; the historical protected writer is
  evidence for a synthetic fixture and is not a daily writer capability;
- D1-D12 and D15 have passed as 13 fixed deterministic gates; D13/D14 remain
  evidence-only and cannot be spawned by CI;
- global coverage is above 85/69/85, the session composer is above 90/80/90,
  and `omp-control` is above 85/70/85;
- a scripts-disabled, offline, self-contained artifact installs successfully in
  a shadow root; real Pi-home mutation follows the exact reviewed
  apply/live/rollback/reapply sequence only.

M8 protected acceptance is source-bound. `scripts/m8-live-acceptance.mjs`
uses the configured Pi model without printing or copying credentials, runs the
Agent/BatchSwarm/Workflow/SwarmGoal/Ultra/Web/cancel/resume/budget/writer-denial
matrix in two Pi processes, and stores digest-only D13 evidence.
`scripts/m8-real-root-rehearsal.mjs` owns the D14 no-model
apply/preservation/rollback/reapply sequence. Both scripts are plan-first and
require explicit `--run --yes`; neither is callable from ordinary CI.

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

The completed M0–M7 roadmap remains the historical Harness MVP baseline. The
approved S0–S5 plan and its Codex Goal now define the next implementation
boundary. Both Goals are external development-orchestrator contracts and are
not exposed through the Pi package's `prompts/` resources:

- [`plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md`](plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md) — successor plan
- [`../codex/goals/develop-only-my-pi-subagents-ultrarun.md`](../codex/goals/develop-only-my-pi-subagents-ultrarun.md) — successor Codex Goal
- [`plans/2026-08-16-only-my-pi-development-plan.md`](plans/2026-08-16-only-my-pi-development-plan.md) — historical M0–M7 plan
- [`../codex/goals/develop-only-my-pi.md`](../codex/goals/develop-only-my-pi.md) — historical M0–M7 Goal

The roadmap target is a usable Pi-based Harness distribution. M0 established
the product/Labs boundary, M1 established the strict configuration and
compatibility foundation, M2 delivered the transactional `omp` configuration
runtime, M3 delivered the Mode Registry plus the unified `/omp` control
surface, M4 delivered the practical single-Agent/Workflow layer, and M5
delivered the governed AgentSwarm compiler plus the sole `pi-subagents` RPC
adapter, and M6 delivered the semantic theme/status layer. M7 now connects the
fixed release-gates-v1 manifest to the executable verification receipt and CI,
adds the fresh scripts-disabled tarball end-to-end smoke, and closes the
documentation/threat-model/package metadata loop. The Harness MVP receipt is
complete, its feature-branch CI passed, the feature branch was fast-forwarded
to `main`, and post-merge `main` CI run `32029765621` passed both Node matrix
jobs.

DeepSeek endpoint work, ACP-to-Pi wiring, and automatic turn checkpoints are
not the next product boundary. Their existing offline modules stay under
Labs/Experimental and remain disabled by default. Creator/self-modifying
plugins, arbitrary JavaScript workflows, automatic marketplaces, remote
UI/SSH/Cron, and un-sandboxed web fetch also remain outside the default
profiles.

The static single-owner topology probe, packaged-artifact inclusion, and
digest-bound live no-model Pi RPC capability/visibility probe now pass. The
probe used a disposable Pi root and submitted no prompt, called no Provider,
and dispatched no child. The durable Plan Store, restart-safe
status/resume and cross-process cancel intent are complete; cancel/stop remains
non-authoritative without correlated backend terminal proof. The legacy direct
imports remain one-release compatibility shims but no longer own public
execution. S3 now supplies the true homogeneous BatchSwarm implementation,
stable item ledger, bounded ramp/retry/failure semantics, exact AgentSpec and
template binding, WorkflowPlan node, parent-budget recovery, and CLI/TUI
control. The 1/8/20/64/300 logical simulations and injected adapter tests pass;
the protected live read-only batch is `NOT_RUN_BY_POLICY`. S4 now supplies
dynamic SwarmGoal plan revisions, UltraRun routing, quality policy, immutable
artifacts, and guarded writer handoff without automatic integration. S5 adds
promotion-specific live, fault, security, and compatibility evidence.
