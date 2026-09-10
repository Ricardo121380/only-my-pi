# only-my-pi

A governed terminal coding Agent built on Pi.

This repository is intended to hold the parts of a Pi workflow that are safe to
version and share:

- Pi extensions
- skills
- prompt templates
- themes
- documented settings and package selections
- research notes and compatibility decisions

It must not contain credentials, OAuth tokens, model keys, sessions, caches,
local npm installs, or private source code copied from another project.

## Layout

```text
extensions/   Pi extensions developed for this project
skills/       Agent Skills (`SKILL.md` directories)
prompts/      Product-facing Pi prompt templates
themes/       Pi theme JSON files
codex/        Codex-only development goals; never loaded as Pi package resources
docs/         Research, design notes, and compatibility records
inventory/    Version-pinned package inventory and risk metadata
profiles/     Explicit package/policy profiles for different workflows
policies/     Capability, owner, command, and enforcement-surface contracts
contracts/    Versioned compatibility contracts and schema catalog
agents/       Canonical Agent roles and generated pi-subagents resources
modes/        Declarative Mode contracts
workflows/    Declarative Workflow contracts
swarm/        Declarative AgentSwarm recipe contracts
ultra/        UltraRun strategy contracts
packages/     First-party protocol/recovery seams and offline fixtures
scripts/      Repository checks and package governance tooling
```

## Current milestone

M12 local Direct Terminal Coding Agent acceptance and its M13 writer/budget
follow-up are complete. The current installation passed C1-C12 on source
`15c40a2` with protected evidence child `f7346b3`; hosted CI and public Preview
publication remain deferred. The installed daily path is:

```bash
cd /path/to/project
omp
```

`omp` enters the controlled Pi TUI directly, selects an authenticated model,
start read-only, and request one explicit session coding approval before the
first project mutation. Complex work must present a complete plan before that
approval. Pi remains the internal TUI, model, session and tool runtime;
`pi-subagents` remains the sole physical child runtime.

M11 proved the user-local stack, Full/Thin acquisition, reproducible builder,
SBOM/notices and transaction recovery, but its `/omp run` read-only product
experience is not being published. `0.2.0-preview.1` remains
`HOLD_PUBLICATION`; there is no public tag or Release. Those assets are retained
as `INTERNAL_DISTRIBUTION_FOUNDATION`, while `0.3.0-preview.1` is the first
planned public candidate for the direct coding experience.

The product decision is frozen in
[ADR-0013](docs/decisions/ADR-0013-direct-terminal-coding-agent.md). The earlier
distribution and history boundary remains in
[ADR-0012](docs/decisions/ADR-0012-public-preview-distribution-and-history-privacy.md).

## Development quickstart

The M13 follow-up is installed and locally verified on the acceptance host, but
is not publicly released. Acceptance restored the original M12 stack and then
reapplied the M13 candidate. Do not use the old bootstrap command: no
`0.2.0-preview.1` Release exists. See the
[local closure receipt](verification/receipts/2026-09-09-m13-local-closure.json)
and [protected matrix](verification/protected/2026-09-09-m13-cpar-installed-coding.json).

After M12 is installed locally, use:

```bash
omp                         # interactive terminal coding Agent
omp "fix the failing test"  # interactive Agent with an initial task
omp -c                      # continue the latest Pi session
omp -r                      # choose a Pi session to resume
omp -p "review this repo"   # non-interactive, read-only
omp admin doctor            # installation/runtime diagnostics
```

Inside the TUI, `/plan` enters the same OMP planning flow, `/access` displays or
revokes the ephemeral coding grant, and `/exit` returns to the shell. The
managed stack remains macOS 14+ Apple Silicon only; MCP, silent YOLO, background
updates and project-external writer access remain unsupported.

The governed S0-S5 kernel reached Stable on 2026-08-27: its exact source,
protected evidence, and receipt chain passed 31/31 required gates. **M8 Daily
Harness Closure is also complete.** Final implementation source `6f77bb6`, its
direct evidence-only child `42185b9`, and receipt commit `02dac32` passed D1-D15 with
15/15 gates. D13 used the configured OpenCode Go / DeepSeek V4 Flash model for
the protected Agent, BatchSwarm, Workflow, SwarmGoal, Ultra, public-Web,
cancellation, resume, budget and writer-denial matrix. D14 applied the same
commit-pinned artifact to the real Pi home, restored the exact pre-install
nine-package baseline, verified it, and reapplied the artifact. The installed
artifact SHA-256 is
`a8d0aaf521f3242776975876f64909fdf97f6e735813146f7258aa95f5fc2455`;
the installed generation is `sha256:62ebd02c...d6ab3310`, with all selected
third-party runtime packages still borrowed as `external` user assets.

M9 has been merged to `main` with its source/evidence commit identities intact.
M10 has now promoted its audited Pi `0.84.3`, `pi-subagents@0.57.0`, and exact
companion extension set to the repository Stable defaults and the current local
installation. The M9 exact artifact audit, strict RPC dialect,
offline 13-extension load, five-executor adapter matrix, Web SSRF black-box
checks, resource soak, package check, and protected 17-assertion live-model
matrix pass. U1-U9 remain complete, including the Agent, BatchSwarm, Workflow,
SwarmGoal, Ultra, public-Web, cancellation, cross-session resume, budget, and
writer-denial paths under OpenCode Go / DeepSeek V4 Flash.

M10 real-root acceptance passed on source `6156955`, with evidence-only child
`9df5f44`: candidate apply, exact M8 rollback, candidate reapply, no-model smoke,
and the protected 17-assertion live matrix all passed. The decision is now
**`PROMOTE`** with Stable Pi `0.84.3` and `pi-subagents@0.57.0`. The current
local `omp` CLI is the immutable user-level entry for installation and diagnosis;
M12 supersedes the Pi-first `/omp` Agent entry. M10 still does
not publish npm or a GitHub Release, add a daemon, writer, or MCP surface.

Final reconciliation built the promoted artifact from source `7973a4e` with
SHA-256 `b718516f...65dd27` and installed generation
`sha256:50caffbf...fc89df`. Local `omp status` is `INSTALLED`, `omp doctor` is
`PASS`, generation alignment is `MATCH`, LKG is verified, and there are no
incomplete transactions. The candidate and Stable graph digests match; all
nine third-party packages remain user-owned, with six exact upgrades and three
unchanged retained versions. The complete M10 receipt reports P1-P12 passing.

- [M8 final D13 protected live-model evidence](verification/protected/2026-08-27-m8-live-model-matrix-final.json)
- [M8 final D14 real-root rehearsal evidence](verification/protected/2026-08-27-m8-real-root-rehearsal-final.json)
- [M8 final D1-D15 completion receipt](verification/receipts/2026-08-27-m8-daily-harness-final.json)
- [M9 upstream candidate compatibility record](docs/compatibility/m9-upstream-candidates.md)
- [M9 machine-readable compatibility decision](contracts/compatibility/upstream-candidates.json)
- [M9 U1-U9 gate contract](verification/upstream-compatibility-gates-v1.json)
- [M9 U9 protected live-model evidence](verification/protected/2026-08-28-m9-candidate-live-readonly-matrix.json)
- [M9 U1-U9 completion receipt](verification/receipts/2026-08-28-m9-upstream-compatibility.json)
- [M10 promotion and migration boundary](docs/decisions/ADR-0011-m10-promotion-and-upstream-migration.md)
- [M10 P9 real-root migration evidence](verification/protected/2026-08-28-m10-real-root-migration.json)
- [M10 P10 promoted live-model evidence](verification/protected/2026-08-28-m10-promoted-live-model-matrix.json)
- [M10 final promoted installation evidence](verification/protected/2026-08-28-m10-final-promoted-install.json)
- [M10 P1-P12 completion receipt](verification/receipts/2026-08-28-m10-promotion.json)

- [M8 Daily Harness Closure plan](docs/plans/2026-08-27-m8-daily-harness-closure.md)
- [Current implementation status](docs/STATUS.md)

## Current research

- [Subagents Orchestration v2 and UltraRun successor plan (S0-S5 Stable kernel achieved)](docs/plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md)
- [Codex successor development Goal for S0–S5](codex/goals/develop-only-my-pi-subagents-ultrarun.md)
- [Historical Harness MVP development plan (M0–M7, complete)](docs/plans/2026-08-16-only-my-pi-development-plan.md)
- [Historical Codex Harness MVP Goal](codex/goals/develop-only-my-pi.md)
- [Pi / DeepSeek Harness / open-source Harness ecosystem report](docs/research/2026-08-15-harness-ecosystem.md)
- [Security and package review policy](SECURITY.md)
- [Package governance decision](docs/decisions/ADR-0001-package-governance.md)
- [Product boundary decision](docs/decisions/ADR-0002-product-boundary.md)
- [Package topology and capability ownership decision](docs/decisions/ADR-0003-package-topology.md)
- [Transactional bootstrap decision](docs/decisions/ADR-0004-transactional-bootstrap.md)
- [Labs and graduation boundary](docs/LABS.md)
- [Pinned package inventory](inventory/packages.lock.json)
- [Profile resolver design](docs/architecture/profile-resolver.md)
- [Session ledger design](docs/architecture/session-ledger.md)
- [Context Doctor design](docs/architecture/context-doctor.md)
- [Safe mode launcher](docs/architecture/safe-mode.md)
- [Verification receipt design](docs/architecture/verification-receipt.md)
- [MCP Doctor design](docs/architecture/mcp-doctor.md)
- [DeepSeek Provider conformance](docs/architecture/deepseek-conformance.md)
- [ACP v1 adapter](docs/architecture/acp-v1.md)
- [Workspace checkpoint](docs/architecture/workspace-checkpoint.md)
- [Theme and status layer](docs/architecture/theme-status.md)
- [Subagents S5 release boundary](docs/architecture/subagents-s5-release.md)
- [Subagents S5-A protected live capture](docs/architecture/subagents-s5-live-capture.md)
- [Subagents S5-B protected background resume](docs/architecture/subagents-s5-background-resume.md)
- [Subagents S5-C protected guarded writer](docs/architecture/subagents-s5-guarded-writer.md)
- [Subagents S5-D fault and recovery closure](docs/architecture/subagents-s5-fault-recovery.md)
- [Quickstart](docs/quickstart.md)
- [Modes](docs/modes.md)
- [AgentSwarm](docs/agent-swarm.md)
- [Migration, rollback, and uninstall](docs/migration-uninstall.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Threat model](docs/threat-model.md)
- [Node/Pi compatibility matrix](docs/compatibility/node-pi-matrix.md)
- [Transactional bootstrap runtime](docs/architecture/bootstrap-runtime.md)
- [Mode Registry and unified control surface](docs/architecture/mode-registry.md)
- [Agent and Workflow Core](docs/architecture/agent-workflow-core.md)
- [Unified Subagents v2 runtime foundation](docs/architecture/subagents-v2.md)
- [S4 SwarmGoal, UltraRun, and writer handoff](docs/architecture/subagents-s4-goal-ultra.md)
- [Subagents v1 offline evaluation baseline](docs/evaluation/subagents-v1.md)
- [Current implementation status](docs/STATUS.md)

## Product direction

The product is now the terminal coding Agent launched by `omp`; Pi is its
internal runtime. The default user journey does not expose Workflow, Swarm,
Goal or Ultra choices. It begins read-only, asks once for guarded project-local
coding, preserves dirty work, automatically chooses bounded subagents, verifies
changes in the real worktree, and returns to the shell through Pi's native
shutdown path. The older Harness control plane remains an advanced compatibility
surface and supplies the transaction, budget, artifact and recovery kernel.

Historically, M1 supplied the
strict package, Profile, capability, owner, command, enforcement, Mode, Agent,
Workflow, and Swarm contracts needed to build that product without false-green
configuration checks. M2 adds the transactional `omp` configuration runtime,
and M3 adds the dependency-closed Mode Registry and unified `/omp` control
surface:

- a dry-run-first, idempotent `omp bootstrap`, update, uninstall, and rollback
  path with settings published only after immutable generation verification;
- load-time Profiles are validated capability ceilings and can now be applied
  to an explicitly selected Pi config root;
- versioned runtime Modes that can only narrow those ceilings, with
  discovery/hash/explain/diff and an explicit restart path for hard envelope
  changes;
- eight practical Modes (`inspect`, `explore`, `plan`, `coding`, `debug`,
  `review`, `research`, `verify`) with versioned prompts and output contracts;
- a parent-session Workflow Core, deterministic Gate Runner, Agent Registry,
  `.agents/skills` bridge, and bounded repo-map seam;
- declarative Workflows and AgentSwarm recipes; M4 executes agent/gate steps and
  M5 compiles the governed Swarm DAG into the sole `pi-subagents` extension-RPC
  lane (live child dispatch still requires an injected Pi session);
- one `omp` CLI and one package-owned `/omp` Pi command, including the sole
  `/omp-context` compatibility alias;
- a semantic, contrast-checked theme contract plus bounded status projection in
  M6. Theme application uses only Pi's public UI driver, and neither surface
  replaces Pi's runtime, renderer, editor, footer, or permission owner.

AgentSwarm reuses the governed `pi-subagents` package through a narrow adapter.
It does not register a competing subagent tool or child-agent runtime. The
adapter performs capability negotiation before any spawn, compiles a
JSON-safe `workflowScript`, and keeps run/child budgets and cancellation
receipts bounded. DeepSeek conformance, ACP v1, and workspace checkpoint remain
non-default Labs modules with the explicit boundaries in the
[Labs registry](docs/LABS.md).

The S0-S5 Stable kernel now contains a unified
`packages/subagents/` facade. It provides typed AgentTemplate v2,
ResolvedAgentSpec, TaskAssignment and terminal receipts; exact structured-
delegation and extension-RPC v1 adapters over one pinned `pi-subagents`
physical runtime; immutable WorkflowPlan compilation; a single
RunCoordinator; a fenced append-only journal; crash-recoverable parent budget
reservations; dual-read migration from the v1 Workflow/Swarm resources; and a
true homogeneous BatchSwarm with stable item slots, bounded ramp/retry/failure
semantics, item-level provenance, and one structured delegation bridge to the same
physical backend. Batch retry has one owner: a Workflow batch node gets one root
attempt, while `maxItems × item maxAttempts` is capped at 1000 physical
assignments.
The static single-owner check is available as `npm run
doctor:subagents-topology`; it reads only the pinned package/wire contract and
repository ownership catalogs plus the digest-bound low-sensitivity evidence,
and does not itself start Pi or dispatch a child. A separately authorized
disposable Pi `0.84.1` probe has now verified the exact upstream `ready` and
correlated `ping` contract, four upstream-owned active subagent tools, the
first-party `omp` commands, and no competing only-my-pi model tool. It submitted
no prompt, Provider request, or child assignment and did not touch the real Pi
home.
The existing `omp workflow`, `omp swarm`, and `/omp` compatibility routes now
compile those resources to WorkflowPlan and can execute only through an
explicitly injected unified RunCoordinator; they never instantiate the v1
controllers. Execution repeats the previously shown plan digest; canonical run
input, the stable run ID, target, conditions, and mutating ApprovalReceipt are
bound into one execution-envelope digest and fail closed on drift. Approval
requires a live repository/capability evidence provider on initial admission,
resume, and every mutating-node admission; a receipt for one run cannot approve
another. Unfinished read-only content-addressed attempts may be requeued with a
fresh attempt, while unfinished mutation is never silently replayed. Writer
leases renew during long nodes; work that may already have started consumes its
worst-case reservation after recovery. Deadlines and reported output/token/cost
overruns fail closed. Without correlated process-terminal proof, a local timeout
is non-authoritative and leaves the run orphaned. Mutating dispatch also requires
an executor that advertises audited path enforcement; a worktree alone is not
treated as a path allowlist. M8 now exposes the read-only daily-session path
through the real session composer while keeping writer admission unavailable.
Restart-safe plan lookup and durable status/cancel/resume are now implemented
through the versioned Plan Store sidecar. S3 BatchSwarm also reuses the same
event chain and parent reservation across crash recovery: proven completed
items are not replayed, while a started item without terminal proof interrupts
the run. S4 now adds a Pi-native SwarmGoal controller, UltraRun router,
immutable artifact store, and writer handoff contract. These are logical layers
over the same RunCoordinator and sole `pi-subagents` backend; they do not
connect Pi to Kimi Code or add a second scheduler. The protected two-item
homogeneous BatchSwarm check is now source-bound Stable evidence. M8 exposes
dynamic-goal live execution through the real daily session composer, including
bounded replan and permission-expansion approval. General live writer admission
remains `UNAVAILABLE`
because the public backend cannot prove a per-path allowlist. S5-C now provides
one separately authorized, synthetic-fixture producer for the protected
guarded-writer evidence class; it uses parent-side Git verification and never
turns that narrow evidence path into a general writer capability.

S5 now adds a versioned compatibility matrix, cumulative promotion policy, and
digest-pinned `release-gates-v2` runner. `npm run verify:subagents` is an
inspection-only command; `npm run verify:subagents:run` executes the fixed
Preview deterministic gates on a clean source commit. Alpha/Beta/Stable live
claims use a source-pinned Ed25519 evidence-import protocol and cannot be
produced by the deterministic runner. The checked-in trust policy retains the
Alpha public signer and adds an independent time-bounded Beta signer for a
cumulative five-scenario capture. Alpha is proved for source `922b39b`, evidence commit
`15f2915`, and receipt commit `312fc2d`: 25 deterministic gates plus the
protected read-only gate passed. The OpenCode Go `deepseek-v4-flash` capture ran
four children within 8,154 tokens and about $0.00474, without storing raw
output, credentials, host paths, or session IDs.

Beta is now proved by source `6004e61`, direct evidence-only commit `1d19b5c`,
and receipt-only commit `cb1a8db`. The cumulative capture used OpenCode Go
`deepseek-v4-flash` for seven physical children: the three inherited Alpha
classes used 8,117 tokens and about $0.00391; background/resume used 13,067
tokens and about $0.01178; the guarded writer used 7,150 tokens and about
$0.00506. The final release run passed 25/25 deterministic and 4/4 protected
gates. Its five signed evidence documents retain no raw output, credentials,
host paths, session IDs, patch bytes, or changed paths. The three external
one-time authorizations were subsequently downgraded to inert templates.
Stable was subsequently closed by the source/evidence/receipt chain documented
in `docs/STATUS.md`. Private signing keys remain outside the repository. That
promotion does not authorize real Pi-home installation or general writer use.

The S5-A Alpha capture producer is now implemented behind
`npm run plan:subagents-live-evidence`. It composes a read-only Agent terminal,
correlated workflow-stop cancellation terminal, and two-item BatchSwarm through the same sole
`pi-subagents` backend, then signs only bounded low-sensitivity evidence through
an external digest-only signer. Children run in an isolated synthetic fixture
workspace, not the source checkout; the canonical read-only `omp-reviewer` is
recompiled and drift-checked before it is copied into the disposable Pi root.
All three scenarios share one cumulative budget, and the source HEAD/worktree
is rechecked after signing before any evidence is staged.
The checked-in plan is again `CONFIGURED_UNAVAILABLE`: the used Beta
authorization is now an `operator-template`, so Provider, child, and signer
work remain `NOT_STARTED`. The imported evidence remains valid because it is
bound to source `6004e61`, not to the post-promotion checkout. Declared endpoint
hosts are not an OS-enforced network allowlist.

S5-B now adds the separately authorized
`npm run plan:subagents-background-resume` producer. It uses two distinct Pi
parent processes, one isolated persisted parent session, session-scoped
`pi-subagents` artifacts, a mode-0600 digest-bound handoff, and a second
correlated backend binding created through the public `resume` RPC. The final
record retains only proof digests and cumulative metering; parent/child session
IDs, host paths, backend IDs, prompts, and outputs remain in the disposable
root. A live run additionally requires `--provider-file`; that credential-free
descriptor is digest-bound by the authorization and compiled into the isolated
Pi root. The protected run proved two authoritative terminals across two Pi
parent processes and a new resume binding; its signed document is
`verification/protected/background-resume.json`. The command is inert again
because its used authorization was downgraded to a template.

S5-C now adds the separately authorized
`npm run plan:subagents-guarded-writer` producer. It runs exactly one canonical
`omp-implementer` in a synthetic Git repository and an upstream-managed
worktree, then treats the child result and handoff manifest as untrusted. The
parent reconstructs a detached review worktree at the approved base, applies
the captured patch only there, then independently verifies the exact staged
path claim, absence of untracked or unstaged changes, regular-file modes,
bounded full diff, `git diff --check`, and a fixed fixture-content gate. It
creates a
handoff-only WriterHandoff and signs only low-sensitivity proof digests; it
never commits, merges, pushes, or applies anything to the source checkout. The
ordinary backend compiler still rejects its `DEGRADED` worktree capability;
only this protected fixture path may opt into the recorded
`protected-degraded-probe-v1` admission. Its credential-free Provider
descriptor is also authorization-digest-bound. The protected fixture run is
imported as `verification/protected/guarded-writer-integration.json`; the
checked-in plan is inert again because the used writer authorization is now a
template. This narrow proof does not make the general writer seam available.

S5-D adds `npm run plan:subagents-guarded-writer-cleanup`, a review-only
reconciliation surface for the disposable S5-C runtime. It detects partial,
drifted, missing and symlinked state, binds its observations to the exact
authorization/source/request digests, and exposes no deletion operation. The
plan always retains an existing target for operator review; `--run`, `--apply`
and `--yes` are rejected. Deterministic tests also cover missing terminal
records, truncated handoffs, missing worktrees, Git verifier failure,
signer/staging interruption, patch reconstruction failure, and post-capture
source drift. These remain deterministic fault/recovery checks; the separate
source-bound writer document is the live evidence.

`omp workflow|swarm run` and `resume` accept an optional bounded absolute JSON
`--input-file`; it is read with `O_NOFOLLOW`, hashed into the execution
envelope, and never copied into the durable Plan Store. A resume without the
original input (or with a changed file) fails closed before child admission.

Inspect and plan the first reviewed homogeneous batch without dispatching a
child:

```bash
node bin/omp.mjs swarm batch list
node bin/omp.mjs swarm batch show review-items
node bin/omp.mjs swarm batch plan review-items \
  --input-file /absolute/path/batch-input.json --json
```

`batch-input.json` must be a bounded JSON object such as
`{"artifacts":{"items":[{"path":"src/a.ts"},{"path":"src/b.ts"}]}}`.
Planning returns the stable run ID, exact plan/execution digests, logical item
expansion, and `liveDispatch: NOT_RUN_BY_POLICY`. A live `run` additionally
requires the trusted Pi-session RunCoordinator and the exact confirmed
digests; the standalone CLI does not fabricate that runtime.

## Local development

Run a zero-write bootstrap plan against a disposable Pi configuration root:

```bash
export PI_CODING_AGENT_DIR="$(mktemp -d)"
node bin/omp.mjs bootstrap --profile minimal --mode inspect
```

After reviewing the plan, apply it interactively or use `--yes` only for a
directly authorized non-interactive run:

```bash
node bin/omp.mjs bootstrap --profile minimal --mode inspect --apply
node bin/omp.mjs status
node bin/omp.mjs doctor
```

The apply path may fetch the exact reviewed package tarballs. It disables
lifecycle scripts, verifies direct tarball integrity, stages a complete
generation, publishes only owned settings last, runs a static doctor and an
isolated no-model Pi RPC startup, then records rollback state. Provider/model
flags store non-sensitive identifiers as `CONFIGURED_UNVERIFIED`; they do not
read a key or call a model. See the [bootstrap runtime guide](docs/architecture/bootstrap-runtime.md)
before targeting an existing Pi directory. `--mode` is now resolved against the
same Mode Registry used by `omp mode` and `/omp mode`; persisted metadata remains
bounded evidence rather than a claim that every enforcement surface is live.

Inspect the available Modes without changing settings:

```bash
node bin/omp.mjs mode list
node bin/omp.mjs mode show inspect --resolved
node bin/omp.mjs mode diff inspect
node bin/omp.mjs theme list
node bin/omp.mjs theme preview only-my-pi-dark
node bin/omp.mjs status --json
```

Install this checkout as a local Pi package while developing:

```bash
pi install .
```

For a one-run test without changing Pi settings:

```bash
pi -e .
```

### Re-run the no-model subagents compatibility probe

The checked-in S2 evidence can be reproduced without using the real Pi home,
submitting a prompt, calling a Provider, or dispatching a child. Supply an
already-present, dependency-complete copy of the exact audited
`pi-subagents@0.45.2` artifact; the command never downloads or installs it:

```bash
probe_root="$(mktemp -d)"
npm run probe:subagents-live -- \
  --config-root "$probe_root" \
  --package-root /absolute/path/to/audited/pi-subagents \
  --only-my-pi-root "$PWD" \
  --pi-command "$(command -v pi)"
```

The probe verifies source hashes before starting Pi, creates all runtime state
under the explicit disposable root, loads the real first-party extensions,
and observes only the public `ready`/correlated `ping` plus tool/command
registries. Delete the disposable root after inspecting the result. This is a
compatibility and ownership check, not evidence of child execution, Provider
quality, terminal/cancellation behavior, worktree enforcement, or host
filesystem/network isolation. See the
[compatibility contract](docs/compatibility/pi-subagents-0.45.2.md) and the
[low-sensitivity evidence](contracts/subagents/pi-subagents-live-no-model-evidence.json).

## Run the successor development Goal with Codex

The repository development Goal is for Codex, not for Pi or the future
only-my-pi Agent. It is deliberately stored outside `prompts/`, so installing
this repository as a Pi package cannot expose it as a Pi slash prompt.

M0–M7 are already complete. Open this repository as the Codex workspace, then
start the S0–S5 successor run with:

```text
/goal Read codex/goals/develop-only-my-pi-subagents-ultrarun.md and execute it with TARGET=all, REPO=/absolute/path/to/only-my-pi, DELIVERY=local, PROMOTION=preview. Continue until the stopping condition is satisfied.
```

For the architecture and runtime-foundation slice:

```text
/goal Read codex/goals/develop-only-my-pi-subagents-ultrarun.md and execute it with TARGET=S4, REPO=/absolute/path/to/only-my-pi, DELIVERY=local, PROMOTION=preview. Continue until that target and all required dependencies are complete.
```

This follows Codex's durable `/goal` workflow: one objective, explicit source
files, checkpoints, validation commands, and a verifiable stopping condition.
See the [official OpenAI Goal guide](https://learn.chatgpt.com/use-cases/follow-goals).
The successor contract supports `S0` through `S5`, promotion-specific live
gates, and `DELIVERY=local|push`. It does not grant permission to read
credentials, mutate the real Pi home, call a live product Provider, publish a
package, or push `main`. The historical M0–M7 Goal remains available for audit,
but must not be rerun to manufacture successor evidence.

## Safety boundary

Pi packages execute with the invoking user's permissions. New extensions and
skills must be reviewed before enabling them globally. Keep secrets in Pi's
local credential stores or a secret manager, never in this repository.

## Repository checks

Run the reproducible governance and package checks before changing a Profile or
promoting a package:

```bash
npm ci --ignore-scripts
npm run typecheck
npm run doctor
npm run doctor:profiles
npm run profile:check
npm run schema:check
npm run agents:check
npm run pack:check
npm run verify
npm run verify:m12
npm test

# M7 executable release receipt (clean source commit only)
npm run verify -- --run --output verification/receipts/2026-08-16-harness-mvp.json
npm run receipt:check -- --receipt verification/receipts/2026-08-16-harness-mvp.json

# The three protocol/recovery increments
npm run test:deepseek
npm run test:acp
npm run test:checkpoint
npm run test:subagents
npm run eval:subagents
npm run doctor:batches
```

The local and CI release gates both read `verification/release-gates-v1.json`.
The final receipt is metadata-only and must be the sole file in its receipt
commit. A tracked source change after that commit invalidates the receipt and
requires a new source/gate/receipt sequence. Publishing, tagging, releasing,
and opening a pull request remain separately unauthorized by the development
Goal.

The experimental profile intentionally reports blocked candidates as warnings;
it does not activate them. Package versions are updated only after a source
review, a disposable-workspace smoke test, and a recorded rollback path.
