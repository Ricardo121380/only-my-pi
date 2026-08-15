# ADR-0001: Treat Pi packages as versioned capabilities, not harmless plugins

## Status

Accepted — 2026-08-15

## Context

Pi packages can register tools, commands, providers, lifecycle listeners,
renderers, skills, prompts, themes, and child processes. They run with the
invoking user's permissions. Project Trust and approval prompts regulate
resource loading or tool calls; neither is an operating-system sandbox.

The local Pi installation also contains packages from different dates and
different compatibility generations. Some community packages still declare the
old `@mariozechner/*` scope or an older Pi peer range. Multiple packages can
claim the same UI, memory, MCP, subagent, or permission surface.

## Decision

`only-my-pi` will manage package choices as explicit, versioned profiles:

1. Every npm package spec is pinned to an exact version or commit.
2. Every package has an inventory entry with source, scope, review state,
   owner groups, risk tags, and rollback notes.
3. A profile may select at most one owner for each mutually exclusive group:
   memory, MCP bridge, subagents, permission, renderer, footer, and editor.
4. Unreviewed or incompatible packages remain candidates or blocked entries;
   they are not silently promoted by `latest` updates.
5. Third-party packages are tried with `pi -e` or a project-local install in a
   disposable workspace before global activation.
6. Credentials, sessions, caches, memory stores, logs, and host-specific paths
   remain outside the repository.
7. Every promotion records a smoke test and a disable/recovery procedure.

## Consequences

This creates more bookkeeping than `pi install latest`, but it makes upgrades,
cross-machine synchronization, and incident recovery reviewable. It also lets
the repository learn from DeepSeek Harness and OpenCode without importing
their preview-stage internal APIs.

## Rejected alternatives

- Installing every package mentioned in a forum thread.
- Treating GitHub stars/downloads as a security or compatibility signal.
- Synchronizing all of `~/.pi/agent` through Git.
- Stacking multiple memory, renderer, footer, or permission systems.
- Calling plan mode or Project Trust a sandbox.
