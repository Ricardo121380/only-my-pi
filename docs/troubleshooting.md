# Troubleshooting

## `PATH_ACTION_REQUIRED`

The stack installed successfully, but `~/.local/bin` is not visible in the
current shell. Follow the exact printed export/profile action. only-my-pi does
not edit shell profiles unless `--configure-shell` was explicitly supplied.
Do not replace an existing non-OMP `pi` or `omp` file to work around this.

## `SHIM_CONFLICT`

`~/.local/bin/pi` or `~/.local/bin/omp` already exists and is not a verified
only-my-pi symlink. Installation made no change. Inspect and relocate the
conflicting file yourself, then create a fresh plan; never let the installer
overwrite an unknown command.

## Package or tree conflict

`PACKAGE_VERSION_CONFLICT`, lock/SRI/tree drift, duplicate package identity,
or an unrelated top-level package in a partial root are zero-write outcomes.
The public installer does not upgrade, downgrade or adopt that environment.
Preserve the reported evidence and reconcile the user-owned Pi tree explicitly.

## `PAYLOAD_CONVERGENCE_FAILED`

Full and Thin did not resolve to the same canonical stack identity. Do not
install either payload and do not reuse its staged cache. Preserve the bounded
receipt and report the exact release tag through the private security channel
if provenance or artifact substitution is suspected.

## `MANUAL_RECONCILIATION_REQUIRED`

An interrupted transaction cannot prove whether every root is wholly old or
wholly new, or a concurrent targeted package/settings change prevents safe
automatic restore. Do not delete journals, backup siblings, stack state or LKG
records. Follow the exact machine-readable reconciliation plan or open an
Issue with only the redacted error code/digests—never attach `auth.json`,
sessions, raw prompts or model output.

## Unsupported platform or Rosetta

`0.2.0-preview.1` supports macOS 14+ on native Apple Silicon arm64 only. The
installer intentionally rejects Intel Macs and Rosetta before staging. There is
no supported override.

## `PLAN_READY` or `CONFIRMATION_REQUIRED`

This is expected. Mutations are never implicit. Review the JSON plan and rerun
with `--apply --yes` only when the explicit config root and ownership are
correct.

## `THEME_APPLY_UNAVAILABLE`

The CLI is headless and has no public Pi UI theme driver. Use `/omp theme use`
inside a Pi session, or keep the built-in `dark` theme. Do not add a private
renderer/editor hook to bypass this status.

## `RESTART_REQUIRED`

The requested Mode or permission envelope cannot be proven to change through a
public Pi API in the current session. Restart with the selected Profile/Mode;
do not treat a prompt-only label as enforcement.

## `LIVE_SWARM_REQUIRES_PI_SESSION`

Planning and validation are offline. A run needs an injected Pi RPC session and
the negotiated `pi-subagents` extension-RPC v1 capability. No Provider request
is made by the repository smoke tests.

## `PLAN_STALE` or `CONCURRENT_SETTINGS_CHANGE`

Another writer changed the explicit config root after planning. Keep the
unknown/user-owned fields, discard the stale plan, and generate a fresh plan.
The transactional publisher intentionally refuses to overwrite concurrent
settings.

## `PASS_WITH_UPDATE_AVAILABLE`

The installed historical generation is healthy, but the current checkout has a
different target. This is not installation corruption. Review an update or
upstream migration plan; do not delete the verified generation or LKG.

## `CURRENT_SETTINGS_NOT_LAST_KNOWN_GOOD`

The active generation may exist, but current settings no longer match the
hash-bound LKG snapshot. Stop mutating operations and use the transaction/LKG
recovery plan. Do not manually reorder package entries or rewrite LKG metadata.

## Incomplete upstream transaction

Mutating `omp` commands recover an incomplete upstream journal before starting
new work. Inspect with `omp upstream status --json`. If recovery reports
`MANUAL_RECONCILIATION_REQUIRED`, preserve the journal and follow its exact
root/settings reconciliation plan; never delete backup siblings or transaction
records by hand.

## `PI_EXTENSION_REGISTRATION_UNVERIFIED`

The no-model smoke started Pi but did not observe the expected `omp` command.
Run `npm run pack:check`, verify the staged generation contains the complete
extension import closure, and retry from a disposable config root. Do not
declare the package installed based only on a process exit code.

## Release receipt failure

`npm run verify` is a dry inspector. The executable path requires a clean
source commit:

```bash
npm run verify -- --run --output verification/receipts/2026-08-16-harness-mvp.json
npm run receipt:check -- --receipt verification/receipts/2026-08-16-harness-mvp.json
```

If the worktree changed, form a new source commit and rerun all gates. A
receipt is intentionally not regenerated in place.
