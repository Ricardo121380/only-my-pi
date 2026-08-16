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
packages/     First-party protocol/recovery seams and offline fixtures
scripts/      Repository checks and package governance tooling
```

## Current research

- [Harness product development plan and milestone gates](docs/plans/2026-08-16-only-my-pi-development-plan.md)
- [Codex end-to-end development Goal](codex/goals/develop-only-my-pi.md)
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
- [Transactional bootstrap runtime](docs/architecture/bootstrap-runtime.md)
- [Mode Registry and unified control surface](docs/architecture/mode-registry.md)
- [Agent and Workflow Core](docs/architecture/agent-workflow-core.md)
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

## Run the Harness development Goal with Codex

The repository development Goal is for Codex, not for Pi or the future
only-my-pi Agent. It is deliberately stored outside `prompts/`, so installing
this repository as a Pi package cannot expose it as a Pi slash prompt.

Open this repository as the Codex workspace, then start the complete run with:

```text
/goal Read codex/goals/develop-only-my-pi.md and execute it with TARGET=all, REPO=/absolute/path/to/only-my-pi, DELIVERY=push. Continue until the specified Definition of Done and verification gates are satisfied.
```

For the safer first delivery slice:

```text
/goal Read codex/goals/develop-only-my-pi.md and execute it with TARGET=M0-M3, REPO=/absolute/path/to/only-my-pi, DELIVERY=push. Continue until that target and all required dependencies are complete.
```

This follows Codex's durable `/goal` workflow: one objective, explicit source
files, checkpoints, validation commands, and a verifiable stopping condition.
See the [official OpenAI Goal guide](https://learn.chatgpt.com/use-cases/follow-goals).
The execution contract also supports `M4`, `M5`, and `M6-M7`, plus
`DELIVERY=local` when the result must remain local. It does not grant permission
to read credentials, mutate the real Pi home, call a live product Provider,
publish a package, or push `main`.

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

# The three protocol/recovery increments
npm run test:deepseek
npm run test:acp
npm run test:checkpoint
```

The experimental profile intentionally reports blocked candidates as warnings;
it does not activate them. Package versions are updated only after a source
review, a disposable-workspace smoke test, and a recorded rollback path.
