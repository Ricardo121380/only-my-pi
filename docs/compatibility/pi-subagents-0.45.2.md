# `pi-subagents@0.45.2` compatibility contract

Status: **LIVE NO-MODEL CAPABILITY PASS; no prompt, Provider request, or child
dispatch was performed.**

The repository-level ownership probe is `npm run doctor:subagents-topology`.
It independently verifies one exact physical package/owner, one public
subagent command owner, a separate first-party logical resource owner, the RPC
single-lane flags, and the digest-bound no-model evidence receipt. Running this
doctor remains static: it does not start Pi or inspect the user's Pi home.

only-my-pi delegates physical subagent execution to one installed
`pi-subagents` extension. It does not register a competing subagent tool,
scheduler, or child-process runtime. The one planned live integration lane is
the extension's RPC v1 event protocol: capability `ping`, followed by detached
`spawn` with a schema-validated, compiler-produced `workflowScript`.

## Audited artifact

| Field | Exact value |
| --- | --- |
| npm spec | `npm:pi-subagents@0.45.2` |
| npm integrity | `sha512-VEvBF6vrpi+eLEjhgwqutSnaH/aw58+Um9vdJUc6Td1asH22bAKahrgD3AafaRNsROgiaukw4DRdmlRjEhBxQA==` |
| tarball SHA-256 | `fb247e0d45f130d0f3f53efb63a95c56e417d8579af5ba2ba2f211b322701374` |
| `package.json` SHA-256 | `5ef75c67e2384dc66ccc150ff590d5cea3a09824c40b23b13889e509a8d9bebb` |
| `src/extension/rpc.ts` SHA-256 | `5c0b683c8e7a59fd5fa730e10039ff8b9e84b465af6202c52405ec5798179a93` |
| `src/api/delegation.ts` SHA-256 | `5abfc8b1a59fa86b9b29e133e2f17418b9b3a3ddb9fd7d9a8ee606d8622f461d` |
| upstream | [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) |

The exact npm artifact exports its extension entrypoint plus public modules for
background work, external runs, delegation, capability ceilings, preflight,
control channel, intercom bridge, Pi arguments, and shared types. None of those
exports authorizes importing `pi-subagents/src/**`; private source imports are
forbidden even when the pinned tarball happens to contain those files.

## One live lane

The integration topology is fixed:

```text
only-my-pi workflow manifest
  -> schema-validated workflow compiler
  -> Pi event: subagents:rpc:v1:request
  -> installed pi-subagents runtime
  -> Pi event: subagents:rpc:v1:reply:<requestId>
```

The RPC protocol version is `1`. Its methods are exactly `ping`, `status`,
`spawn`, `steer`, `interrupt`, `stop`, and `resume`. Event discovery must
confirm these exact values:

| Purpose | Event |
| --- | --- |
| ready | `subagents:rpc:v1:ready` |
| request | `subagents:rpc:v1:request` |
| correlated reply prefix | `subagents:rpc:v1:reply:` |
| async completion | `subagent:async-complete` |
| process-terminal proof | `subagent:process-terminal` |

Before any later milestone can dispatch a child, a `ping` reply must match the
complete capability object in `contracts/pi-subagents-wire-v1.json`. This
includes fleet status v1, detached async spawn, non-recovering steer,
interrupt/stop/resume, launch-resolved extension evidence, child-runtime
extension acknowledgement, and process-terminal proof with lifecycle artifact
version `3`. Missing, additional, or version-mismatched required capability
data fails closed.

## Validated no-model live evidence

On 2026-08-19 the repository ran the packaged probe against Pi `0.84.1` and the
source-hash-verified `pi-subagents@0.45.2` artifact in a disposable explicit Pi
root. The probe loaded the three actual only-my-pi extensions plus one
observer-only extension and used only Pi's public event/tool/command APIs.

It observed the exact `ready` envelope and a correlated `ping` reply. Active
extension tools were exactly `intercom`, `subagent`, `subagent_supervisor`, and
`subagent_wait`, all owned by the upstream package. `omp` and `omp-context`
were registered by only-my-pi, while only-my-pi registered no model-facing
tool. The low-sensitivity receipt is
[`contracts/subagents/pi-subagents-live-no-model-evidence.json`](../../contracts/subagents/pi-subagents-live-no-model-evidence.json).

The packaged manual command is `npm run probe:subagents-live -- ...`. It
requires explicit absolute disposable, package, and optional only-my-pi roots;
it never infers `~/.pi` and never downloads a package. Source identity and the
two audited source hashes are checked before Pi starts. The observer emits no
paths, cwd, or session identifier, and the checked-in receipt stores only
bounded metadata and output digests.

This proves startup, public RPC compatibility, and tool ownership only. The
extension still has the invoking user's host filesystem and network authority.
The run did not submit a prompt, send a Provider request, dispatch a child, or
prove terminal, cancellation, worktree, metering, or writer behavior.

## Compiled workflow boundary

RPC `spawn` is detached/async only. Public direct `agent`, `task`, or `step`
execution is not accepted by the audited version, nor are legacy top-level
chain/parallel fields. `clarify`, `async: false`, and a management `action`
combined with workflow execution are rejected.

`workflowScript` is executable workflow source, so accepting an arbitrary CLI
string would turn a declarative harness boundary into code injection. The
only-my-pi adapter may therefore emit it only from a schema-validated workflow
manifest through a fixed compiler. The RPC envelope records the source as:

```json
{
  "extension": "only-my-pi",
  "kind": "schema-validated-workflow-compiler",
  "schemaValidated": true
}
```

The compiler and live adapter are later-milestone work. M1 contains a static,
non-executed request fixture solely to lock the boundary and its negative tests.

## Exported structured delegation

`pi-subagents/delegation` is a genuine public package export. Its structured
types and five `prompt-template:subagent:*` event names are useful as a
compatibility reference for request identity, budget, context, result, update,
cancel, and terminal-response concepts.

M1 originally retained this surface as reference-only. S5 live validation then
proved that a nested `workflowScript -> runs.run` can complete its inner child
without closing the outer workflow runner or producing timely process-terminal
proof. The successor therefore adopts the exact structured events as the
read-only foreground Agent/Batch lane. It does not statically import the
package implementation: event names, request fields, identity, exit-code and
usage requirements are pinned in the local wire contract and tests. Extension
RPC remains the async workflow/background/resume/control lane. Both are owned
by the same physical package; no second scheduler or public subagent tool is
introduced.

## Remaining promotion gate

The original M1 evidence was static. S1 has now completed the disposable
no-model `ready`/`ping`/visibility portion without reading credentials or the
real Pi home. A later live-child promotion must still, in order:

1. revalidate the exact protocol, method, event, capability, and ownership
   contract before every spawn-capable session;
2. fail closed before spawn on timeout or any mismatch;
3. compile a schema-valid repository workflow into `workflowScript` without
   accepting raw command-line workflow source;
4. correlate the spawn reply only through
   `subagents:rpc:v1:reply:<requestId>`;
5. verify async-complete and process-terminal evidence, including cancellation;
   and
6. continue to prove only `pi-subagents` owns the physical tool, scheduler, and
   child
   lifecycle.

Until a separately authorized child terminal passes, this remains a no-model
compatibility/ownership claim rather than evidence of live child execution.
