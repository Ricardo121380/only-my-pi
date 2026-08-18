# only-my-pi status

Baseline snapshot: **2026-08-15** · Roadmap updated: **2026-08-18** · Merged
to `main`: **2026-08-17** · Pi **0.84.1** · Node **25.8.0** · macOS
`darwin-arm64`

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

## Successor roadmap — S0–S2 implementation underway

The M0–M7 Harness MVP described below remains the current released baseline.
Development of its S0–S5 successor has started on the isolated
`codex/subagents-ultrarun-v2` branch:

- [`plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md`](plans/2026-08-18-only-my-pi-subagents-ultrarun-plan.md)
- [`../codex/goals/develop-only-my-pi-subagents-ultrarun.md`](../codex/goals/develop-only-my-pi-subagents-ultrarun.md)

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

The first S0–S2 source slice now contains:

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
- public Workflow/Swarm compatibility facades that use the legacy catalogs as
  readers, assign one stable run ID while planning, require the confirmed plan
  and execution-envelope digests on execution, reuse the exact input snapshot,
  and delegate all live lifecycle work to the one injected RunCoordinator;
- a 15-case, fixed-seed, three-baseline offline evaluation corpus.

This source slice has no S0–S2 promotion receipt yet. Its tests use injected
transports and temporary roots; no live child dispatch, Provider/model call,
credential read, global install, or real Pi home mutation was performed.
All planned orchestration contracts plus the evaluation-corpus and durable
run-control contracts are now registered in the strict catalog. The catalog validates 33 kinds and 64
non-vacuous production documents, with positive, unknown-field/version, and
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
`pi-subagents` v1 wire does not itself prove a per-path allowlist, so this live
writer seam remains unavailable rather than being inferred from a worktree.
The immutable Plan Store now persists the exact run-ID-to-WorkflowPlan binding;
fresh coordinators can re-project status, publish cross-process cancel intent,
and resume read-only/recoverable runs after restart without persisting raw
input. The bounded no-model Pi topology probe remains S2 closure work.
BatchSwarm execution,
SwarmGoal, UltraRun, and promotion-specific live evidence remain S3–S5.
Historical M5 receipts must not be described as successor evidence.

Current branch evidence for this Contract Preview slice:

- `npm test`: **459/459** pass;
- `npm run test:subagents`: **101/101** pass;
- `npm run schema:check`: **64 production documents / 33 schema kinds / 0 findings**;
- `npm run pack:check`: **224 allowlisted files**, with no tests, receipts, or
  Codex Goal in the tarball;
- `npm run lint`: **587 files / 0 findings**;
- `npm run secret:scan`: **587 tracked files + 224 packed files / 0 findings**;
- `npm run doctor`, all six Profile doctors, Mode/Agent/Workflow/Swarm doctors,
  `npm run typecheck`, and the deterministic agent/profile generators: pass.
  Static doctor retains only the two explicit inactive-candidate warnings.

These are source-tree gates only. A promotion receipt intentionally does not
exist until the remaining S2 compatibility/topology work and the requested
promotion closure are complete.

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
- `pi-subagents@0.45.2` remains the sole physical child runtime. The future
  only-my-pi adapter must use its capability-gated extension RPC and compiled
  `workflowScript`; exported delegation types are fixture/reference-only.

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
- `packages/pi-subagents-adapter` is the only live child seam. It pins the
  audited `pi-subagents@0.45.2` extension-RPC v1 wire, performs capability ping
  negotiation before spawn, maps stop/interrupt/status events, and refuses
  private imports or the exported delegation surface as a runtime lane;
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

The next successor closure step is the bounded no-model Pi topology probe and
its packaged-artifact evidence. The durable Plan Store, restart-safe
status/resume and cross-process cancel intent are complete; cancel/stop remains
non-authoritative without correlated backend terminal proof. The legacy direct
imports remain one-release compatibility shims but no longer own public
execution. After that S2 closure, S3 adds a true homogeneous BatchSwarm, S4
introduces dynamic SwarmGoal plan revisions and UltraRun routing, and S5 adds
promotion-specific live, fault, security, and compatibility evidence.
