# Migration, rollback, and uninstall

## Public Preview stack lifecycle

Public stack mutations are plan-first and require exact authority:

```bash
omp release check --channel preview --json
omp stack update --release 0.2.0-preview.2 --payload thin --plan --json
omp stack update --release 0.2.0-preview.2 --payload thin --apply --yes --json

omp stack rollback --plan --json
omp stack rollback --apply --yes --json

omp stack remove --plan --json
omp stack remove --apply --yes --json
```

`release check` is explicit, read-only, writes no cache and discovers only a
newer `0.2.0-preview.N`; it never crosses channels or updates in the
background. A mutation that detects controlled Pi processes reports their
bounded identity and requires separate `--terminate-pi` authority. It uses
`SIGTERM`, waits at most 15 seconds and never sends `SIGKILL`.

`omp uninstall` removes only Harness activation and the `omp` entry. It does
not use stack provisioning evidence as permission to delete embedded Node,
controlled Pi or third-party packages. `omp stack remove` is the separate,
explicit full-stack authority. It removes only verified OMP-owned stack assets,
restores an exact pre-install LKG package root when safe, and deletes a
provisioned nine-package root only when it began empty and has not drifted.
Preexisting packages and any ambiguous or changed data are retained with a
reconciliation plan.

Neither operation removes Homebrew Pi/Node, `auth.json`, sessions, models,
memory, git-sync data or Provider secrets. Transaction and removal receipts are
retained as bounded audit material.

## From a manual Pi package list

Do not copy `~/.pi/agent/settings.json`, `auth.json`, sessions, or npm caches
into this repository. Start with an explicit disposable config root and run a
plan:

```bash
node bin/omp.mjs bootstrap --profile coding --mode coding --config-root /absolute/pi-root
```

The plan shows the exact Profile, package/resource graph, ownership, and
provider metadata. Provider/model fields are identifiers only and remain
`CONFIGURED_UNVERIFIED`; credentials stay in Pi's credential store or a secret
manager.

## Update

`omp update` follows the same plan → stage → verify → settings-last protocol.
Direct tarball integrity and the realized tree are rechecked. A changed
settings digest produces `PLAN_STALE`/`CONCURRENT_SETTINGS_CHANGE` rather than
silently dropping user fields.

## Governed upstream migration

Pi and the complete nine-package external tree use the separate `upstream`
transaction namespace. Always review the immutable bundle first:

```bash
omp upstream plan --bundle /absolute/migration-bundle.json --json
omp upstream apply --bundle /absolute/migration-bundle.json \
  --apply --yes --terminate-pi --json
```

The apply step is offline, requires a source-bound bundle, accepts only the
exact package matrix in its manifest, stops reviewed Pi processes with bounded
`SIGTERM` only, and journals every cross-root boundary. It does not adopt the
nine packages: their binding remains `external/owner=user`. Use
`omp upstream status --json` to inspect terminal or incomplete transactions,
and `omp upstream rollback <transaction-id> --yes --terminate-pi --json` for a
reviewed upstream rollback. Ordinary `omp rollback` only handles only-my-pi
generation/CLI state.

## Rollback

List a reviewable rollback plan first:

```bash
node bin/omp.mjs rollback --config-root /absolute/pi-root --json
node bin/omp.mjs rollback --config-root /absolute/pi-root --yes --json
```

Rollback is hash-gated and reconciles only entries recorded as managed by
only-my-pi. Packages/extensions/skills/prompts/themes added by the user after
the snapshot remain intact. A failed phase leaves a durable journal that can
be recovered; do not delete transaction directories by hand.

## Uninstall

```bash
node bin/omp.mjs uninstall --config-root /absolute/pi-root
node bin/omp.mjs uninstall --config-root /absolute/pi-root --apply --yes
```

Uninstall removes only the recorded only-my-pi settings/resources. Verified
immutable generations and snapshots are retained for reviewed rollback and are
not automatically purged. The plan reports this as
`RETAIN_IMMUTABLE_FOR_ROLLBACK`; a future purge command would need a separate
retention and deletion contract.

Never run these commands against the real Pi home until the plan and backup
boundary have been reviewed. `~/.pi/agent/auth.json`, sessions, model catalogs,
and caches are outside repository ownership.
