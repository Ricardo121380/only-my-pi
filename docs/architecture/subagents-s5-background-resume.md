# Subagents S5-B protected background resume

Status: **production capture path implemented; no Provider-backed background
resume run has been authorized or executed** · 2026-08-22

S5-B implements the producer for the `background-resume` protected-evidence
class. It does not integrate Kimi Code or create a second scheduler. The design
uses only the pinned `pi-subagents@0.45.2` public extension-RPC `spawn`,
`resume`, and terminal-event contracts. Kimi AgentSwarm contributed the design
idea of persistent, resumable child work; Pi and `pi-subagents` remain the only
runtime and physical child owner.

This increment is a Beta prerequisite, not a Beta promotion. Alpha still needs
separately captured and imported live Agent terminal/cancel and two-item
BatchSwarm evidence. Beta additionally needs the still-unimplemented
`guarded-writer-integration` protected evidence. Deterministic tests of this
producer are not live evidence.

## What is proved

The fixed scenario executes exactly two sequential physical child runs with a
maximum concurrency of one:

```text
isolated parent session P
        |
        |  Pi parent process #1
        v
pi-subagents spawn reviewer in background
        |
        +-- authoritative completed terminal T1
        +-- persisted child session/artifacts under P
        +-- digest-bound internal handoff H
        `-- parent process #1 exits

        |  Pi parent process #2, same --session-id and --session-dir
        v
reload P -> pi-subagents resume prior child session
        |
        +-- new backend binding B2, parentBinding=B1
        +-- new backend run ID, same stable only-my-pi handle
        `-- authoritative completed terminal T2

        v
bounded low-sensitivity record -> external digest-only signer -> review staging
```

The record requires seven canonical proof digests:

- `background-spawn`;
- `parent-session-reload`;
- `resume-request`;
- `backend-rebind`;
- `process-terminal`;
- `terminal-receipt`;
- `usage-metering`.

`authoritativeTerminals` must be at least two. The second binding must have
`lifecycle=resume`, name the first binding as its parent, differ from the first
binding, and map to a different backend run. Merely repeating a prompt, loading
an in-memory handle, or starting a second unrelated child cannot satisfy the
contract.

## Parent-session and handoff boundary

Both Pi invocations use one explicit contained `--session-id` and
`--session-dir`. The runner does not use `--no-session`. After process #1 exits,
it verifies exactly one bounded non-symlink JSONL parent session with the
expected header ID. Process #2 must reopen the same file path.

The `pi-subagents` artifact preference is `session`, not `temp` or `project`.
This allows the upstream extension to rediscover its child state after the
parent process restart without writing `.pi-subagents/` into the source or
synthetic workspace.

The internal handoff is mode `0600`, bounded to 256 KiB, and lives only inside
the disposable Pi Agent root. It contains the stable handle, first backend
binding, first terminal projection, exact release-contract context, parent
session identity, and observed usage. It has a canonical digest. Process #1
emits that digest in a bounded phase receipt; only after process #1 exits does
the outer runner create the process #2 request with the expected digest. The
resume extension rejects a missing, stale, symlinked, context-drifted, or
modified handoff.

The handoff is operational state, not promotion evidence. It can contain local
backend/session correlation identifiers and must never be committed, staged,
or synchronized. The final evidence contains only proof digests and explicit
false privacy flags. It stores no raw output, prompt, reasoning, host path,
credential, parent/child session ID, backend run ID, or binding ID.

## Authorization

`subagents-background-resume-authorization-v1` is deliberately separate from
the S5-A authorization contract. It fixes:

- the sole evidence ID to `background-resume`;
- two physical child runs and concurrency one;
- two distinct Pi parent processes;
- an isolated persisted parent session;
- session-scoped upstream artifacts;
- a new backend binding for resume;
- exact source, release-contract and runtime-row digests;
- Provider/model, credential-variable names and declared endpoint hosts;
- positive cumulative wall-time, output, token and USD ceilings;
- a read-only/no-web/no-MCP/no-project-trust workspace;
- one trusted external signer and a maximum 24-hour authorization window.

The S5-A command continues to reject `background-resume`; the operator cannot
silently widen an Alpha capture authorization into S5-B.

The default command is inspection-only:

```bash
npm run plan:subagents-background-resume
```

In the checked-in repository it reports `CONFIGURED_UNAVAILABLE` because the
trust policy contains no signer and no one-time authorization exists. It makes
no Provider request, child dispatch, signer call, filesystem mutation, or Pi
home access.

An operator-authorized run requires every explicit path and confirmation:

```bash
node scripts/subagents-background-resume-evidence.mjs --run --yes \
  --authorization-file /absolute/background-resume-authorization.json \
  --config-root /absolute/empty-disposable-root \
  --package-root /absolute/audited-pi-subagents-0.45.2 \
  --repository-root /absolute/only-my-pi \
  --pi-command /absolute/pi \
  --signer-command /absolute/external-digest-signer \
  --output-dir /absolute/empty-evidence-staging --json
```

Source, config and staging roots must be real, non-symlink and pairwise
disjoint. The source HEAD/worktree is checked before capture and again after
signing but before staging. The command never writes directly to
`verification/protected/`, imports evidence, commits, pushes, tags, publishes,
or changes a compatibility row.

## Runtime and security limits

The reviewer is recompiled from the canonical manifest and prompt, compared
byte-for-byte with the checked-in resource, and copied into the isolated Agent
root. It has only `read`, `grep`, `find`, and `ls`; it has no Bash, write, web,
MCP, or nested-subagent authority. Its `cwd` is a tiny synthetic fixture, not
the source checkout.

Only authorization-listed credential variables enter the Pi subprocess. HOME,
TMP, XDG and `PI_CODING_AGENT_DIR` point into the disposable root. The real
`~/.pi` is neither read nor mutated. The external signer receives one payload
digest, not a key path, model output, session ID, or host path.

These controls do not create an OS sandbox or an egress firewall. Pi and
extension code still execute with the caller's OS and network authority.
`declaredEndpointHosts` are review metadata, not enforced DNS/network policy.
Use a container, VM, account-level budget or OS egress policy when prevention
is required.

The pinned RPC backend supplies terminal token/USD observations but not a
verified mid-child token or billing kill switch. Cumulative ceilings therefore
reject an evidence record after observed overrun; wall time also terminates the
isolated Pi process group. Provider/account controls remain necessary for a
prospective hard spend cap.

## Current claim

The implementation is covered by deterministic authorization, schema,
signature, handoff-tamper, session-correlation, two-process runner, credential
allowlist, proof-parity and packaging tests. No real Provider-backed run was
performed. The `background-resume` gate remains `NOT_RUN_BY_POLICY`, no signed
document was imported, and the repository remains Preview.
