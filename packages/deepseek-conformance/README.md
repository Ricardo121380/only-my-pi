# DeepSeek provider conformance fixtures

This package is a dependency-free, deterministic protocol fixture for the
DeepSeek OpenAI-compatible Chat Completions surface. It is intentionally a
small library rather than a network client: it never reads an API key, calls a
URL, starts a subprocess, or writes a session. A caller supplies a transport
function, which makes the same checks useful with a local mock, a recorded
response, or an explicitly approved real HTTP adapter.

The fixtures follow the public DeepSeek documentation for [Chat
Completions](https://api-docs.deepseek.com/api/create-chat-completion),
[thinking mode and tool-call reasoning round trips](https://api-docs.deepseek.com/guides/thinking_mode),
and [context caching usage fields](https://api-docs.deepseek.com/guides/kv_cache).
The default thinking behavior in this package is deliberately **disabled** as
a harness policy; callers can opt in with `extra_body.thinking.type =
"enabled"`.

## What is covered

- non-stream responses with `reasoning_content`, `tool_calls`, and usage;
- SSE streams split at arbitrary chunk boundaries;
- empty `choices` chunks and `[DONE]` handling;
- interleaved parallel tool-call deltas aggregated by `tool_calls[].index`;
- streamed reasoning/content buffers with bounded output;
- `stream_options.include_usage = true` by default for streaming requests (can
  be explicitly disabled by the caller);
- assistant tool-call message round trips that preserve
  `reasoning_content`;
- native `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` and the
  OpenAI-compatible `prompt_tokens_details.cached_tokens` alias;
- `prompt_tokens + max_tokens` validation against the one-million-token
  context ceiling used by the conformance policy;
- retryable HTTP statuses, `Retry-After`, bounded backoff, and abort signals;
- non-retryable HTTP error metadata with sensitive headers removed;
- custom base URL routing and a guard against using `/beta` with tools.

## Small API

```js
import {
  normalizeRequest,
  parseSse,
  runConformance,
} from "./index.mjs";

const request = normalizeRequest({
  model: "deepseek-v4-pro",
  messages: [{ role: "user", content: "hello" }],
});

const result = await runConformance({
  request,
  // The adapter owns network policy. This example is deliberately local.
  transport: async ({ url, init, signal }) => {
    const response = await fetch(url, { ...init, signal });
    return response;
  },
});

console.log(result.response.choices[0].message.content);
```

The example shows the adapter contract only; the package itself does not call
`fetch`. Do not pass an API key through a fixture or commit one to a test. A
real adapter should obtain credentials through the caller's approved secret
manager and should be tested separately from this repository's deterministic
suite.

For streaming, set `stream: true` in the request. The injected transport must
return a Response-like object whose `body` is text or an iterable of byte/text
chunks. `consumeSse` is also exported for direct testing. A successful result
contains `stream_stats.event_count` and
`stream_stats.empty_choice_chunks` as diagnostics; these are not sent back to
the model.

## Fixtures and tests

The checked-in JSON files contain synthetic identifiers and no secrets:

- `fixtures/non-stream-thinking.json` — one assistant tool call with native
  cache and reasoning usage;
- `fixtures/sse-parallel-tools.json` — empty choices plus interleaved tool
  deltas at indexes 0 and 1;
- `fixtures/multi-turn-tool-loop.json` — assistant reasoning replay followed
  by a tool result;
- `fixtures/retry-after.json` — a 429 followed by a successful response;
- `fixtures/custom-base-url.json` — a non-default base URL.

Run only this package's tests with:

```bash
node packages/deepseek-conformance/test.mjs
```

The root `npm test` command also discovers the test because it uses Node's test
runner.

## Simulated versus real endpoint behavior

The suite simulates protocol data and transport outcomes. It does **not**
prove that a live model or gateway will behave identically. In particular, a
real endpoint still needs a separately authorized smoke test for:

1. the selected model's exact thinking toggle and `reasoning_effort` behavior;
2. whether tool-call assistant messages require `reasoning_content` on every
   subsequent turn (the fixture enforces the documented thinking-mode rule);
3. actual SSE framing, proxy buffering, disconnects, and final usage chunks;
4. malformed or partial tool-call JSON and provider-specific error bodies;
5. cache hit/miss values, rate limits, `Retry-After`, and billing semantics;
6. custom gateway authentication, TLS, redirects, and path rewriting;
7. the gateway's handling of unsupported parameters such as
   `tool_choice`, temperature, and penalties in thinking mode.

The helper intentionally does not silently repair malformed tool arguments,
does not infer a missing reasoning trace, and does not retry arbitrary 4xx
errors. Those decisions belong in the provider adapter's explicit policy and
should be represented by additional recorded fixtures before enabling them in
an Agent Harness profile.
