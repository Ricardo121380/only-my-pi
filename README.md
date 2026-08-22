# only-my-pi

Governed, reproducible Pi Harness distribution and configuration companion.

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

## Current research

- [Subagents Orchestration v2 and UltraRun successor plan (S0–S5; S0–S4 Preview source plus S5-A/S5-B/S5-C producers and S5-D fault/recovery closure implemented)](docs/plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md)
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

The product is not another Provider or protocol adapter. The roadmap targets a
usable Pi-based Harness distribution. M1 supplies the
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

The S0–S4 Preview source implementation now contains a unified
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
treated as a path allowlist. This is Contract Preview source evidence only.
Restart-safe plan lookup and durable status/cancel/resume are now implemented
through the versioned Plan Store sidecar. S3 BatchSwarm also reuses the same
event chain and parent reservation across crash recovery: proven completed
items are not replayed, while a started item without terminal proof interrupts
the run. S4 now adds a Pi-native SwarmGoal controller, UltraRun router,
immutable artifact store, and writer handoff contract. These are logical layers
over the same RunCoordinator and sole `pi-subagents` backend; they do not
connect Pi to Kimi Code or add a second scheduler. The protected real-child
BatchSwarm check and dynamic-goal live execution were not authorized and remain
`NOT_RUN_BY_POLICY`. General live writer admission remains `UNAVAILABLE`
because the public backend cannot prove a per-path allowlist. S5-C now provides
one separately authorized, synthetic-fixture producer for the protected
guarded-writer evidence class; it uses parent-side Git verification and never
turns that narrow evidence path into a general writer capability.

S5 now adds a versioned compatibility matrix, cumulative promotion policy, and
digest-pinned `release-gates-v2` runner. `npm run verify:subagents` is an
inspection-only command; `npm run verify:subagents:run` executes the fixed
Preview deterministic gates on a clean source commit. Alpha/Beta/Stable live
claims use a source-pinned Ed25519 evidence-import protocol and cannot be
produced by the deterministic runner. The checked-in trust policy now contains
one time-bounded public Alpha signer whose scope excludes background/resume and
writer evidence. Higher promotion remains unavailable until an operator
separately authorizes and completes the disposable live run; private signing
keys remain outside the repository.

The S5-A Alpha capture producer is now implemented behind
`npm run plan:subagents-live-evidence`. It composes a read-only Agent terminal,
correlated workflow-stop cancellation terminal, and two-item BatchSwarm through the same sole
`pi-subagents` backend, then signs only bounded low-sensitivity evidence through
an external digest-only signer. Children run in an isolated synthetic fixture
workspace, not the source checkout; the canonical read-only `omp-reviewer` is
recompiled and drift-checked before it is copied into the disposable Pi root.
All three scenarios share one cumulative budget, and the source HEAD/worktree
is rechecked after signing before any evidence is staged.
The checked-in plan remains
`CONFIGURED_UNAVAILABLE`; no real Provider/child/signer run has been executed,
and the declared endpoint hosts are not an OS-enforced network allowlist.

S5-B now adds the separately authorized
`npm run plan:subagents-background-resume` producer. It uses two distinct Pi
parent processes, one isolated persisted parent session, session-scoped
`pi-subagents` artifacts, a mode-0600 digest-bound handoff, and a second
correlated backend binding created through the public `resume` RPC. The final
record retains only proof digests and cumulative metering; parent/child session
IDs, host paths, backend IDs, prompts, and outputs remain in the disposable
root. This path is also `CONFIGURED_UNAVAILABLE` by default and has not made a
live Provider request. It supplies producer code for a Beta prerequisite, not
Beta evidence or promotion.

S5-C now adds the separately authorized
`npm run plan:subagents-guarded-writer` producer. It runs exactly one canonical
`omp-implementer` in a synthetic Git repository and an upstream-managed
worktree, then treats the child result and handoff manifest as untrusted. The
parent independently verifies the full base commit, exact staged path claim,
absence of untracked or unstaged changes, regular-file modes, bounded patch,
`git diff --check`, and a fixed fixture-content gate. It creates a
handoff-only WriterHandoff and signs only low-sensitivity proof digests; it
never commits, merges, applies, pushes, or modifies the source checkout. The
ordinary backend compiler still rejects its `DEGRADED` worktree capability;
only this protected fixture path may opt into the recorded
`protected-degraded-probe-v1` admission. The checked-in plan is inert and no
Provider-backed writer run, protected evidence import, or Beta promotion has
occurred.

S5-D adds `npm run plan:subagents-guarded-writer-cleanup`, a review-only
reconciliation surface for the disposable S5-C runtime. It detects partial,
drifted, missing and symlinked state, binds its observations to the exact
authorization/source/request digests, and exposes no deletion operation. The
plan always retains an existing target for operator review; `--run`, `--apply`
and `--yes` are rejected. Deterministic tests also cover missing terminal
records, truncated handoffs, missing worktrees, Git verifier failure,
signer/staging interruption and post-capture source drift. These are Preview
fault/recovery checks, not live evidence.

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
