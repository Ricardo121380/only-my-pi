# Mode Registry v1

The Mode Registry is the behavior layer above a loaded Profile. A Profile is a
load-time capability ceiling; a Mode selects a task workflow inside that
ceiling. `executionState` (`ask`, `plan`, `build`, or `review`) is a projection
of the mode and is not a second permission owner.

## Discovery and trust

`packages/mode-registry/index.mjs` discovers JSON manifests from these source
kinds, in deterministic order:

1. built-in `modes/`;
2. user roots explicitly supplied by the caller;
3. trusted project roots (the caller must set `trusted: true`);
4. reviewed package roots.

The public factory is runtime-agnostic:

```js
const registry = createModeRegistry({
  rootDir,                         // optional repository root
  searchRoots: [{ kind: "builtin", root }],
  profile: { capabilityIds, packageIds, policy },
  fs: injectedFilesystem,          // optional; no implicit Pi-home writes
});
await registry.list();
const snapshot = await registry.resolve("inspect");
```

`createModeRegistry()` accepts explicit `sources` as well as the convenience
`rootDir`/`searchRoots` form. A supplied `rootDir` loads the repository's
capability, package, and enforcement-surface catalogs; an injected registry
without catalogs fails closed for every declared requirement. User discovery
is opt-in (`userRoot` or an explicit `configRoot`); the implementation never
walks `~/.pi` implicitly. Source roots are required unless marked
`optional: true`, which is used only for absent default roots.

Built-in IDs cannot be silently overridden. Duplicate IDs and aliases are
rejected. Every source root and prompt file is checked with `lstat`, realpath
containment, and symlink rejection. A project mode is therefore never loaded
merely because a repository contains a JSON file.

## Resolution

Resolution validates `mode-v1`, detects inheritance cycles, unions required
capabilities/packages/surfaces, intersects tool allowlists, unions denies, and
monotonically narrows workspace, approval, egress, and swarm policy.
The effective snapshot contains:

- resolved manifest and lineage;
- manifest/prompt source hashes;
- a stable snapshot hash;
- profile-ceiling projection;
- explain decisions for tools, capabilities, packages, and surfaces.

Manifest and prompt bytes are hashed as `sha256:<64 lowercase hex>` values.
Array-like declarations are canonicalized before hashing, so filesystem
enumeration order cannot change a snapshot. Unknown capabilities, packages,
surfaces, tools, aliases, duplicate IDs, path traversal, symlink resources,
web-tool/egress conflicts, inheritance cycles, and policy/execution-state
escalations are rejected rather than partially loaded.

`ModeRegistry.diff()` reports the changed paths and whether the hard envelope
changed. `activate()` only injects prompts and status after an idle-session
check. A hard change requires the one audited `ExecutionStateDriver`; when the
Pi/permission package exposes no public runtime switch, activation returns
`RESTART_REQUIRED` with launch guidance. The registry never simulates `/perm`,
imports private extension internals, or treats prompt injection as sandboxing.
The driver is injected through the public `probe()`/`apply()` seam (and
`restore()` for reset). An absent driver returns `RESTART_REQUIRED`; a
present-but-non-switchable driver returns `UNAVAILABLE`. A changed source hash
for the currently active mode returns `STALE_MODE_SNAPSHOT` before any prompt
or status publication.

## CLI and Pi command

The offline CLI surface is:

```text
omp mode list
omp mode show <id> [--resolved]
omp mode diff <id>
omp mode doctor
omp mode scaffold <id>
omp mode use <id>
omp mode reset
```

`use` and `reset` are fail-closed without a live public session driver. The Pi
extension owns the single `/omp` command and the `/omp-context` compatibility
alias. `context-doctor` supplies metrics and lifecycle hooks but does not
register a competing command.

`scaffoldMode({ id })` returns a `PLAN_ONLY` read-only template containing a
mode manifest and prompt. It performs no filesystem write. A caller must pass
`write: true`, an explicit absolute destination, and the injected writer to
create files with exclusive (`wx`) flags; parent directories are contained
under that destination.

## State and evidence

Mode snapshots are low-sensitivity metadata: ID, version, source hash,
resolved policy projection, and driver receipt. The Pi extension persists a
bounded `only-my-pi-mode` custom session entry containing the mode/hash/source
receipt and a sanitized hard-envelope projection. Prompt contents, prompt
paths, sessions, credentials, and model responses are not written to that
receipt. On `session_start`, the current registry re-resolves the receipt;
matching hashes restore the current prompt for the next turn, while a source
change reports `STALE_MODE_SNAPSHOT` and injects nothing. Malformed receipts
are ignored fail-closed.

The returned `promptPayloads` are in-memory-only input for a caller's public
prompt hook. They are intentionally excluded from the stable snapshot and
explain output; callers must not persist them as session or settings data.
