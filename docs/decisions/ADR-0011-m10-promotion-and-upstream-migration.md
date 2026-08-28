# ADR-0011: M10 promotion and upstream migration boundary

Status: Accepted, 2026-08-28.

## Context

M9 proved the exact Pi `0.84.3`, `pi-subagents@0.57.0` and companion-extension
candidate in isolated and protected read-only tests. Its machine decision is
still `HOLD`; the Stable inventory and real installation remain on the M8
baseline. The existing doctor also conflates an installed historical
generation with the target graph computed by a newer checkout.

## Decision

M10 promotes only the already audited M9 tuple. Promotion requires a
source-bound implementation commit, a local regular-file migration bundle, a
protected real apply/rollback/exact-verify/reapply rehearsal, and protected
live-model acceptance. Passing M9 alone does not authorize a default or
real-root change.

Installed health and checkout alignment are independent results. Doctor first
verifies the installed generation using that generation's own versioned
manifest. A healthy historical generation is `PASS_WITH_UPDATE_AVAILABLE`
when the current target differs; it is not damaged merely because the checkout
is newer.

The user CLI is installed without sudo at `~/.local/bin/omp` and dispatches
from a digest-addressed immutable artifact under
`~/.local/share/only-my-pi`. It manages installation, configuration,
diagnosis, receipts and rollback. It does not run Agent tasks; `/omp` in a Pi
session remains the sole Agent execution entry.

An `upstream-migration-v1` bundle may name only the exact audited Pi and
nine-package target. It contains no command language, arbitrary script,
credential, host target path, floating version or mutable URL. Lifecycle
scripts are disabled. Normal apply is offline.

Pi, the complete external npm tree, only-my-pi generation and CLI are four
publication units coordinated by a durable journal. Each unit is staged and
verified before publication. Settings are published with compare-and-swap and
field-level preservation of unrelated user changes. An ordinary failure rolls
back immediately; a later mutating `omp` invocation recovers a hard-crashed
transaction before starting new work. No daemon is introduced.

Running Pi processes are listed and revalidated by PID, start identity and
executable before an explicitly authorized `SIGTERM`. The wait is bounded to
15 seconds. `SIGKILL` is forbidden, and no package switch begins while a Pi
process remains alive.

Third-party packages remain `external` and `owner:user` throughout. The
explicit migration grants one-transaction mutation authority but never
ownership. Uninstall, generation garbage collection and CLI removal cannot
delete the external package tree.

The protected producer is plan-first. Its run mode requires four separate,
machine-visible grants: `--run`, migration approval via `--yes`, Pi process
termination via `--terminate-pi`, and public-Web authority via
`--authorize-web`. It accepts only a source-bound regular-file bundle and
distinct P9/P10 paths under `verification/protected/`. The run executes from
the immutable only-my-pi artifact embedded in that bundle, not from the
mutable checkout. It rechecks the clean source commit before publishing the
low-sensitivity evidence pair. Any failure attempts journal-driven rollback;
an unprovable recovery is reported as `MANUAL_RECONCILIATION_REQUIRED`.

The exact protected sequence is:

```text
preflight -> apply -> no-model smoke -> rollback -> exact verify
          -> reapply -> no-model smoke -> live matrix -> evidence pair
```

Plan mode performs no write and no Provider request:

```sh
npm run plan:m10:protected
```

The bundle is built only after the source commit is frozen. Run mode is not a
CI command and is invoked locally with the full source SHA, absolute bundle
path, and explicit evidence destinations.

## Promotion rule

The machine decision may become `PROMOTE` only when deterministic M10 gates,
shadow migration, protected real-root rehearsal and protected live-model gates
all pass for the same source and bundle identities. The promotion commit then
changes Stable defaults to the audited candidate and preserves the M9 baseline
as historical comparison data. A final artifact reconcile must prove that the
candidate graph and promoted Stable graph are identical.

## Non-goals

M10 does not create a generic package manager, daemon, writer, MCP surface,
public npm package, GitHub Release, Kimi/Claude/OpenHands integration, or a new
Agent runtime.
