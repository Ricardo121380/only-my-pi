# Transactional bootstrap runtime

M2 turns the governed Profile inventory into an installed, reviewable Pi
configuration without creating another agent runtime. The public entry point is
`omp`; the reusable layers are:

```text
CLI parser and confirmation
  → ControlService
    → BootstrapService (zero-write planning/status/doctor)
      → TransactionEngine
        → config-runtime lock/journal/snapshot/LKG
        → scripts-disabled generation staging
        → owned settings merge
        → static doctor
        → isolated Pi RPC get_state + get_commands smoke
```

## Commands

Use an explicit temporary root while evaluating the bootstrap:

```bash
export PI_CODING_AGENT_DIR="$(mktemp -d)"

omp bootstrap --profile minimal --mode inspect
omp bootstrap --profile minimal --mode inspect --apply
omp status
omp doctor
omp safe
```

For non-interactive application, approval must be direct:

```bash
omp bootstrap --profile coding --mode coding --apply --yes --json
```

Update and uninstall are also plan-first:

```bash
omp update --plan
omp update --apply
omp rollback
omp rollback <snapshot-id> --yes
omp uninstall --plan
omp uninstall --apply
```

`--provider` and `--model` record identifiers only. They never accept a key,
open Pi auth storage, or call the endpoint. Until a separately authorized live
check succeeds, status remains `CONFIGURED_UNVERIFIED`.

M2 treats `--mode` the same way as a bounded selection seam: it records
`PENDING_M3_RESOLUTION` and does not claim the Mode is active. M3 owns Mode
manifest resolution, Profile-ceiling checks, activation, and session restore.

## Runtime files

All runtime files are below the selected Pi agent directory:

```text
settings.json
only-my-pi/
  locks/configuration.lock/owner.json
  transactions/<transaction-id>/journal.json
  snapshots/<snapshot-id>/manifest.json
  state/last-known-good.json
  generations/<graph-digest>/
  smoke-runtime/agent/
  npm-home/
  npm-cache/
  npm-tmp/
  npm-prefix/
  npm-workspace/
```

The exact layout is versioned by the config-runtime path contract. Do not edit
journal, snapshot, generation manifest, or LKG files by hand; their hashes and
cross-references intentionally make tampering fail closed.

## Failure behavior

- A plan is immutable and bound to source settings and graph digests.
- Apply and rollback serialize on one lock.
- Package acquisition/install uses contained runtime directories for its
  working tree, HOME, npm user/global/project configuration, cache, temporary
  files, and prefix. The production runner accepts only the exact scripts-off
  `npm pack` and `npm install` command shapes required by staging, adds
  `--omit=peer --legacy-peer-deps` so npm cannot auto-install a second Pi host,
  scrubs credential-shaped environment variables, and rejects symlinked
  runtime paths or realized `@earendil-works/pi-coding-agent`/
  `@mariozechner/pi-coding-agent` host copies.
- Lifecycle scripts are disabled and each promoted package carries an exact
  command digest audit. A package that truly requires one is unavailable until
  an outer sandbox policy is designed and approved; there is no implicit
  lifecycle executor in the bootstrap runtime.
- Failed staging retains only the exact staging path for journal recovery.
- Settings are published after generation verification and promotion, with a
  final compare-and-swap check against the settings version used by the plan.
- Doctor or no-model smoke failure restores the owned pre-transaction state.
- A process crash leaves an incomplete journal. The next explicit locked
  mutation recovers it before evaluating the new plan.
- If another writer changes settings before publication, the CAS preserves
  that third version, settles the transaction as failed, and requires a fresh
  plan. Recovery never absorbs the concurrent version into the old plan or
  overwrites it. A third version after a journaled settings publication remains
  an ambiguous state and fails closed.

Snapshots record the selected Pi resource arrays plus only-my-pi metadata so
that entry-level reconciliation can restore the historical managed entries
without deleting user entries added later. They can therefore contain local
package/resource paths and must be treated as sensitive local rollback state:
never commit or synchronize the runtime directory. They do not intentionally
capture auth stores, sessions, model keys, caches, or unrelated top-level
settings.

## What `omp safe` means

`omp safe` prints a conservative Pi command using offline maintenance mode,
no sessions, no extensions/skills/context files, and read-only built-in tools.
It is guidance, not a launcher and not a sandbox claim. `--offline` suppresses
Pi's own update/package/telemetry traffic; a local model plus OS/container
network policy is still required for a genuinely offline task.

## Verification

The M2 suites use only temporary config roots. Most subprocess seams are
injected, while a bounded local fixture test exercises the production npm
runner using only local package/tarball inputs and no network request, and
proves a malicious lifecycle script is not executed. This fixture does not
claim OS-level network isolation. The suites cover empty and unknown-field
settings, first apply, second no-op, exact owned rollback/uninstall, update
failure, exclusive locking, malicious lifecycle scripts, byte integrity,
symlink/path escape, settings rename interruption, every journal boundary,
recovery CAS, missing LKG repair, CLI confirmation, and the real Pi no-prompt
RPC handshake in an isolated empty root. The smoke checks
both Pi state and the expected `omp-context` registration so an extension import
failure cannot pass merely because the RPC process stayed alive. No test calls
a model Provider or opens the real Pi home. A production smoke that loads
governed extensions still inherits the invoking user's OS authority; use an
external sandbox when that distinction matters.
