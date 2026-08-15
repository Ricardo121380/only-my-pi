# DeepSeek Provider Conformance

`packages/deepseek-conformance` is an offline, dependency-free contract
fixture for the DeepSeek OpenAI-compatible Chat Completions surface. It is a
test seam for Pi/`pi-ai` provider adapters, not a replacement HTTP client and
not a claim that a particular model or gateway is fully compatible.

## Covered contract

- request defaults and bounded context checks;
- Thinking mode and `reasoning_content` round trips;
- assistant tool-call messages and subsequent tool results;
- non-stream responses;
- SSE chunks split at arbitrary boundaries;
- empty `choices` chunks and `[DONE]`;
- interleaved parallel tool-call deltas grouped by index;
- native and nested cache-usage fields;
- retryable status codes, `Retry-After`, bounded backoff and abort;
- safe error metadata with credential headers removed;
- custom base URL routing and `/beta` tool guard;
- output, tool-argument, SSE-event and context bounds.

The fixture transport is injected by the caller. No code in this package reads
an API key, calls a URL, starts a process or persists a session. A real
provider adapter can wrap `fetch` or a test proxy around the same transport
shape, but that integration must be authorized and tested separately.

## Run

```bash
node packages/deepseek-conformance/test.mjs
npm run test:deepseek
```

See the package-level [README](../../packages/deepseek-conformance/README.md)
for the fixture inventory and the boundary between deterministic simulation and
a live endpoint smoke test. The upstream API references are the [DeepSeek Chat
Completions docs](https://api-docs.deepseek.com/api/create-chat-completion),
[Thinking mode guide](https://api-docs.deepseek.com/guides/thinking_mode), and
[KV-cache usage guide](https://api-docs.deepseek.com/guides/kv_cache).

## Promotion gate for a real adapter

Before enabling a DeepSeek Provider in a Pi Profile, add a separately reviewed
recorded fixture for the exact endpoint and model covering streaming,
tool-call reasoning passback, usage/billing semantics, rate limits, redirects,
TLS, gateway path rewriting, unsupported parameters, and cancellation. Keep
the credential out of this repository and out of CI logs.
