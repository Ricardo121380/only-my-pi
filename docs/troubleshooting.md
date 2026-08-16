# Troubleshooting

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
