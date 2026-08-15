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
scripts/      Repository checks and package governance tooling
```

## Current research

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

## Local development

Install this checkout as a local Pi package while developing:

```bash
pi install /Users/huangrui/Documents/ChatGPT/only-my-pi
```

For a one-run test without changing Pi settings:

```bash
pi -e /Users/huangrui/Documents/ChatGPT/only-my-pi
```

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
```

The experimental profile intentionally reports blocked candidates as warnings;
it does not activate them. Package versions are updated only after a source
review, a disposable-workspace smoke test, and a recorded rollback path.
