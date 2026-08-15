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
```

## Current research

- [Pi / DeepSeek Harness / open-source Harness ecosystem report](docs/research/2026-08-15-harness-ecosystem.md)
- [Security and package review policy](SECURITY.md)

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
