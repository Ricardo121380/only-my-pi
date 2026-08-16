# `pi-permission-modes@2.2.0` compatibility contract

Status: **STATIC PASS; harness-controlled runtime mode changes are `RESTART_REQUIRED`.**

This record is deliberately narrower than an endorsement of the package's
complete security boundary. It defines what only-my-pi may claim and how the
harness can select an execution policy without importing implementation files,
simulating UI commands, or creating a second policy owner.

## Audited artifact

| Field | Exact value |
| --- | --- |
| npm spec | `npm:pi-permission-modes@2.2.0` |
| npm integrity | `sha512-y4n110DiN99xl2tyLLU7ZyMadZUOYvxm9YKEpoZo2vFF4QJIgV7RKBAI6KztaRayAWPhA+95FdIBcV0He8vyfw==` |
| tarball SHA-256 | `e3104a36f6ca1b60a7bd965d6e1ae95181196d8f8fe4b60909625f037400c957` |
| `package.json` SHA-256 | `086f81da209daef0b0d0ce60371f47859b8a75b1c5705fc8c1fa15946609614c` |
| `src/index.ts` SHA-256 | `fd4462a3b7ba986af734c2e17ba8ea7178df56c933e87ed444ba90ba24c2fd5b` |
| upstream | [wynainfo/pi-permission-modes](https://github.com/wynainfo/pi-permission-modes) |

The unpacked npm artifact was reviewed at the exact version above. Its manifest
declares `src/index.ts` as a Pi extension but declares no Node `exports` map.
The source's `setMode` function is a closure inside the extension entrypoint,
not an exported cross-extension API.

## Public control surface and decision

The package exposes user/session controls through Pi:

- startup flag `--perm <mode>`;
- environment input `PI_PERMISSION_MODE`;
- `/perm`, `/net`, and `/sandbox` commands;
- the `alt+m` shortcut; and
- persisted session entries of type `perm-mode`.

Those controls let the package itself change state. They do **not** give another
extension a public, typed way to read the authoritative active state, request a
mode change, await sandbox reconciliation, or prove the resulting state. For
only-my-pi, a hard execution-policy change therefore returns:

```text
RESTART_REQUIRED: NO_PUBLIC_CROSS_EXTENSION_STATE_API
```

The next Pi process receives the audited mode through `--perm` or
`PI_PERMISSION_MODE`. The harness must not import `pi-permission-modes/src/**`,
inject `/perm`, synthesize `alt+m`, infer success from visible tool lists, or
implement a competing permission engine. A same-session switch between a task
prompt and a planning prompt is only a workflow/prompt change; it is not a
verified hard-policy transition.

## Enforcement surfaces

Static package review can identify ownership and scope, but it cannot claim a
surface is active in the current process. All runtime states remain `unknown`
until the M3 live checks run.

| Surface | Owner | Static scope | Static state |
| --- | --- | --- | --- |
| Tool-call policy | `pi-permission-modes` | Extension-owned allow/ask/deny decisions | `unknown` |
| Bash sandbox | `pi-permission-modes` | Eligible replacement Bash subprocesses only | `unknown` |
| File-tool policy | `pi-permission-modes` | Pi file-tool policy and path checks, not OS containment | `unknown` |
| Web egress | none for full transport | Bash proxy filtering does not contain every Web/extension path | `unknown` |
| MCP egress | none | MCP transports are outside this package's sandbox | `unknown` |
| Provider egress | none | Provider/model transports are outside this package's sandbox | `unknown` |
| Extension egress | none | Arbitrary extension lifecycle traffic is outside this package's sandbox | `unknown` |

The upstream security notes explicitly distinguish OS containment of eligible
Bash subprocesses from policy checks on Pi file tools. Approved unsandboxed
commands, `--no-sandbox`, modes with sandboxing disabled, an unavailable
platform runtime, and worktree/submodule limitations can change or degrade the
Bash boundary. Network grants apply to the package's Bash sandbox proxy; they
must not be generalized into a whole-session egress guarantee.

## Promotion gate

M1 performs static artifact and contract checks only. No Pi process, provider,
credential, or real user configuration is used. M3 may promote a runtime
observation only after a disposable environment demonstrates all of the
following:

1. the exact pinned package starts with an audited `--perm` value;
2. the extension reports the expected mode and Bash sandbox state through its
   own public user-facing surface;
3. allowed, denied, and approval-required probes behave as declared;
4. unavailable/degraded sandbox behavior fails closed and is surfaced; and
5. Web, MCP, provider, and extension transport remain explicitly out of scope.

Until then, only the static compatibility contract in
`contracts/execution-state-driver-v1.json` is authoritative.
