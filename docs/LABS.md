# Labs

Labs are reviewed experiments and compatibility seams that are useful to keep
under test but are not part of the default only-my-pi Harness. They are not
loaded by a default Profile, do not run during bootstrap, and must be invoked
explicitly by a developer.

Passing an offline Labs test proves only the documented local contract. It does
not prove compatibility with a live model, gateway, Pi session, editor, network
service, or operating-system sandbox.

## Current modules

### ACP v1 adapter

Location: `packages/acp-v1/`

The adapter implements an in-memory, runtime-neutral subset of the stable ACP
v1 JSON-RPC/NDJSON agent-side protocol. It covers initialization, session
create/load/prompt/cancel, updates, and permission request/response handling.

It does **not** start Pi, wire Pi events or tools, spawn an ACP subprocess,
delegate filesystem/terminal operations, launch MCP servers, call a Provider,
or persist a session. ACP v2 remains out of scope.

Explicit test:

```bash
npm run test:acp
```

### DeepSeek Provider conformance

Location: `packages/deepseek-conformance/`

This dependency-free fixture runner exercises request normalization, reasoning
content replay, streamed tool-call assembly, usage/cache fields, retries,
cancellation, and bounded error/output behavior through an injected transport.

It does **not** read an API key, call DeepSeek or another gateway, identify a
working model, or prove that Pi's live Provider adapter has the same behavior.
Real endpoint testing requires a separate authorization and evidence plan and
is not on the current Harness critical path.

Explicit test:

```bash
npm run test:deepseek
```

### Workspace checkpoint

Location: `packages/workspace-checkpoint/`

This module creates content-addressed, Git-directory-local snapshots and
produces reviewable restore/undo plans. Restore is dry-run-first and requires
explicit flags for applying changes, overwriting a changed workspace, and
deleting files.

It is **not** automatically hooked to Pi turns, is not an atomic filesystem
transaction, does not replace Git commits, and is not a security sandbox.

Explicit test:

```bash
npm run test:checkpoint
```

## Graduation rule

A Labs module may enter a default or opt-in product Profile only after all of
the following are recorded:

- a single runtime/capability owner and public integration seam;
- schemas and positive/negative contract fixtures;
- least-privilege policy and observable degraded behavior;
- deterministic install, disable, and rollback paths;
- no-model Pi smoke plus any separately authorized live evidence;
- a decision record explaining why the capability belongs in only-my-pi rather
  than Pi or an existing governed package.

Until then, Labs remain excluded from default package resources and product
status must report them as `EXPERIMENTAL_OFFLINE`, not `READY` or `ENFORCED`.
