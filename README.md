# only-my-pi

Personal Pi Agent package and configuration companion.

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
prompts/      Prompt templates
themes/       Pi theme JSON files
docs/         Research, design notes, and compatibility records
inventory/    Version-pinned package inventory and risk metadata
profiles/     Explicit package/policy profiles for different workflows
packages/     First-party protocol/recovery seams and offline fixtures
scripts/      Repository checks and package governance tooling
```

## Current research

- [Harness product development plan and milestone gates](docs/plans/2026-08-16-only-my-pi-development-plan.md)
- [End-to-end Goal Prompt](prompts/goal-develop-only-my-pi.md)
- [Pi / DeepSeek Harness / open-source Harness ecosystem report](docs/research/2026-08-15-harness-ecosystem.md)
- [Security and package review policy](SECURITY.md)
- [Package governance decision](docs/decisions/ADR-0001-package-governance.md)
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
- [Current implementation status](docs/STATUS.md)

## Product direction

The next product milestone is not another Provider or protocol adapter. The
roadmap targets a usable Pi-based Harness distribution. The following Harness
features are planned; they are not claims about the current implementation:

- a dry-run-first, idempotent `omp bootstrap` and rollback path;
- load-time Profiles as capability ceilings;
- runtime Modes that can only narrow those ceilings;
- declarative Workflows, Agent roles, and AgentSwarm recipes;
- a single `omp` / `/omp` control surface;
- lightweight status and theme resources that do not replace Pi's runtime or
  TUI.

The planned AgentSwarm reuses the governed `pi-subagents` package through a
narrow adapter. It will not register a competing subagent tool or child-agent
runtime. DeepSeek conformance, ACP v1, and workspace checkpoint remain
non-default Labs modules.

## Local development

Install this checkout as a local Pi package while developing:

```bash
pi install .
```

For a one-run test without changing Pi settings:

```bash
pi -e .
```

Run the full development Goal from the repository root:

```text
/goal-develop-only-my-pi all
```

If Pi was started outside this checkout, pass the validated repository path
explicitly instead of relying on prompt-package discovery:

```text
/goal-develop-only-my-pi all repo=/absolute/path/to/only-my-pi
```

The Goal Prompt also accepts milestone ranges such as `M0-M3`, `M4`, `M5`,
and `M6-M7`, plus `delivery=local` when the result must remain local. It does
not grant permission to read credentials, mutate the real Pi home, call a live
model Provider, publish a package, or push `main`.

## Safety boundary

Pi packages execute with the invoking user's permissions. New extensions and
skills must be reviewed before enabling them globally. Keep secrets in Pi's
local credential stores or a secret manager, never in this repository.

## Repository checks

Run the no-dependency package inventory check before changing a profile:

```bash
npm run doctor
npm run doctor:profiles
npm run profile:check
npm run schema:check
npm test

# The three protocol/recovery increments
npm run test:deepseek
npm run test:acp
npm run test:checkpoint
```

The experimental profile intentionally reports blocked candidates as warnings;
it does not activate them. Package versions are updated only after a source
review, a disposable-workspace smoke test, and a recorded rollback path.
