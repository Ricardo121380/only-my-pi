# `pi-subagents@0.45.2` compatibility contract

Status: **STATIC PASS; no live child was dispatched.**

The repository-level ownership probe is `npm run doctor:subagents-topology`.
It independently verifies one exact physical package/owner, one public
subagent command owner, a separate first-party logical resource owner, and the
RPC single-lane flags. Its result is static evidence with
`liveRuntime: NOT_RUN_BY_POLICY`; it does not inspect the user's Pi home or
pretend that a no-model startup proves child-runtime capability.

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

## Exported delegation reference

`pi-subagents/delegation` is a genuine public package export. Its structured
types and five `prompt-template:subagent:*` event names are useful as a
compatibility reference for request identity, budget, context, result, update,
cancel, and terminal-response concepts.

For this harness version it is **reference-only**. It is not imported by the
live adapter and must not become a parallel runtime lane beside RPC v1. This
avoids two request protocols, two correlation models, and ambiguous ownership
of cancellation or terminal state. Reconsidering that choice requires a new
versioned contract, not an incidental import.

## Promotion gate

M1 inspected the pinned tarball and validated JSON fixtures only. It did not
start Pi, load a provider, read credentials, contact a model, or dispatch a
child. The live state therefore remains `NOT_RUN_BY_POLICY` until M5.

M5 promotion must use a disposable Pi environment and, in order:

1. observe RPC ready or issue a bounded `ping` with a newline-free request ID;
2. require the exact protocol, method, event, and capability contract;
3. fail closed before spawn on timeout or any mismatch;
4. compile a schema-valid repository workflow into `workflowScript` without
   accepting raw command-line workflow source;
5. correlate the reply only through `subagents:rpc:v1:reply:<requestId>`;
6. verify async-complete and process-terminal evidence, including cancellation;
   and
7. prove only `pi-subagents` owns the physical tool, scheduler, and child
   lifecycle.

Until those checks pass, `contracts/pi-subagents-wire-v1.json` is a static
compatibility contract, not a runtime-support claim.
