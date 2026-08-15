# ACP v1 core adapter

This directory contains a small, dependency-free Agent Client Protocol (ACP)
v1 core. It is intentionally runtime-agnostic: it handles ACP JSON-RPC
messages in memory, but it does not start Pi, spawn a child process, open a
socket, read a filesystem session, or call a model provider.

The adapter currently implements the Agent-side stable baseline:

- `initialize` (protocol version 1 and capability negotiation);
- `session/new`;
- optional capability-gated `session/load`;
- `session/prompt` and `session/cancel`;
- Agent → Client `session/update` notifications;
- Agent → Client `session/request_permission` requests and matching responses;
- newline-delimited JSON (NDJSON) framing with JSON-RPC 2.0 validation.

`ACP_V1_CAPABILITY_MATRIX` is exported from `index.mjs`. The matrix makes
message direction, request/notification kind, baseline status, and optional
capability gates explicit. Reserved methods such as `session/list`, terminal
delegation, and file delegation return a standard `-32601` method-not-found
error with a structured `UNSUPPORTED_METHOD` data code. Unsupported content
blocks and unavailable optional capabilities return structured `-32003`
errors.

## Minimal use

```js
import { AcpV1Adapter } from "./index.mjs";

const adapter = new AcpV1Adapter({
  agentCapabilities: { loadSession: true },
  promptHandler: async ({ emit, requestPermission, signal }) => {
    emit({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "working" },
    });
    // A real tool runner may await requestPermission(...) before mutating data.
    // The runtime must still enforce its own policy and sandbox.
    if (signal.aborted) return { stopReason: "cancelled" };
    return { stopReason: "end_turn" };
  },
});

const responseLines = await adapter.dispatchLine(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: 1 },
}));
```

`dispatchLine` returns encoded lines; it never writes them. A transport may
instead call `dispatchChunk` for arbitrary chunks and write each returned line
to its own stream. `send(message)` is an optional observation/sink callback for
outbound messages, not a stream implementation. `drainOutbound()` is useful in
tests and small event loops.

## Permission and cancellation

`requestPermission(sessionId, request)` creates a JSON-RPC request with a
unique ID and returns a Promise. Feed the matching response back to
`dispatch()`:

```js
const decision = await adapter.requestPermission(sessionId, {
  toolCall: { toolCallId: "call-1", title: "write file" },
  options: [
    { optionId: "allow", name: "Allow once", kind: "allow_once" },
  ],
});
// { outcome: "selected", optionId: "allow" }
```

When `session/cancel` is received, the adapter aborts the active prompt and
settles pending local permission Promises as `{ outcome: "cancelled" }`.
The ACP client remains responsible for replying to any already-sent
`session/request_permission` request with its own cancelled outcome, as
required by ACP v1. A prompt that observes cancellation returns
`stopReason: "cancelled"`.

## Session loading

`MemorySessionStore` is an in-memory test store only. A durable store must be
injected explicitly and reviewed by the caller. Stored `history` entries are
plain ACP `SessionUpdate` objects; loading replays a snapshot of that history
without appending it again. The adapter does not encrypt, redact, or persist
secrets.

## Boundary and next integration work

This package is not a live Pi ACP server or client. A future integration must
still provide all of the following outside this directory:

1. a subprocess/stdio or other transport with lifecycle, backpressure, and
   disconnect handling;
2. a Pi prompt/tool runner that maps its events into ACP `SessionUpdate`
   variants;
3. a policy and sandbox layer for filesystem, terminal, MCP, and network
   access;
4. credential handling and provider/model configuration;
5. ACP conformance fixtures, abort behavior, and compatibility tests against
   the chosen client (for example Zed or OpenHands).

Run deterministic tests directly with:

```bash
node --test packages/acp-v1/acp-v1.test.mjs
```
