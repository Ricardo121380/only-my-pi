# ACP v1 Adapter

`packages/acp-v1` is a runtime-neutral Agent-side ACP v1 core. It implements
the stable JSON-RPC/NDJSON protocol seam without importing the ACP SDK, Pi
internals, a subprocess, or a network transport.

## Implemented surface

| Direction | Method | Behavior |
|---|---|---|
| client → agent | `initialize` | negotiate protocol version 1 and capabilities |
| client → agent | `session/new` | validate absolute cwd, MCP transport declarations and create an in-memory session |
| client → agent | `session/load` | optional capability-gated load and update replay |
| client → agent | `session/prompt` | validate content blocks, call an injected prompt handler and return a stop reason |
| client → agent | `session/cancel` | abort the active prompt and pending permissions |
| agent → client | `session/update` | emit model/tool/status updates through a collector or sender |
| agent → client | `session/request_permission` | request a client decision and match the JSON-RPC response |

The capability matrix is exported and intentionally explicit. Unsupported
methods, unsupported content blocks, wrong-direction messages and unsupported
MCP transports return structured errors instead of silently dropping data.

## Transport boundary

`NdjsonDecoder`, `encodeNdjson` and `dispatchChunk` only transform bytes and
messages. The caller owns stdin/stdout, process lifetime, back-pressure and
authentication. `AcpV1Adapter` accepts an injected `promptHandler`; it does
not yet invoke Pi's `AgentSession` or expose a live `pi --mode rpc` process.

This is deliberate: a live ACP server needs a separate review of Pi session
mapping, filesystem/terminal delegation, cancellation propagation, permission
policy and secret handling. ACP v2 remains outside the package and is not a
fallback path.

## Run

```bash
node --test packages/acp-v1/acp-v1.test.mjs
npm run test:acp
```

Tests cover split UTF-8 NDJSON, version negotiation, session lifecycle,
permission round trips, cancellation, update replay without duplicate history,
capability errors, wrong-direction messages and malformed input.

The protocol reference is the [ACP repository](https://github.com/agentclientprotocol/agent-client-protocol),
whose stable wire version is v1; the v2 schema remains experimental.
