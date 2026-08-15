import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_MAX_TOKENS,
  MAX_CONTEXT_TOKENS,
  MAX_OUTPUT_CHARS,
  DeepSeekConformanceError,
  DeepSeekHttpError,
  buildChatCompletionsUrl,
  consumeSse,
  createAbortError,
  createFixtureTransport,
  normalizeNonStreamResponse,
  normalizeRequest,
  normalizeUsage,
  parseRetryAfter,
  parseSse,
  prepareRequest,
  runConformance,
} from "./index.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const sse = (events, { done = true } = {}) => {
  const lines = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  if (done) lines.push("data: [DONE]\n\n");
  return lines.join("");
};

test("request normalization applies bounded harness defaults and custom routing", () => {
  const result = prepareRequest({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "hello" }],
  }, {
    baseUrl: "https://proxy.example.test/deepseek/v1/",
    promptTokens: 16,
  });
  assert.equal(result.request.max_tokens, DEFAULT_MAX_TOKENS);
  assert.equal(result.request.extra_body.thinking.type, "disabled");
  assert.equal(result.url, "https://proxy.example.test/deepseek/v1/chat/completions");
  assert.equal(result.context.known, true);
  assert.equal(result.context.promptTokens, 16);

  const stream = normalizeRequest({
    model: "deepseek-v4-pro",
    stream: true,
    messages: [{ role: "user", content: "stream" }],
  });
  assert.equal(stream.stream_options.include_usage, true);
});

test("thinking mode preserves reasoning_content on assistant tool-call messages", () => {
  const request = {
    model: "deepseek-v4-pro",
    messages: [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: "",
        reasoning_content: "I should call the weather tool.",
        tool_calls: [{ id: "call-1", type: "function", function: { name: "weather", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call-1", content: "sunny" },
    ],
    extra_body: { thinking: { type: "enabled" } },
  };
  const normalized = normalizeRequest(request);
  assert.equal(normalized.messages[1].reasoning_content, "I should call the weather tool.");
  assert.equal(normalized.messages[1].tool_calls[0].function.arguments, "{}");

  const missing = structuredClone(request);
  delete missing.messages[1].reasoning_content;
  assert.throws(
    () => normalizeRequest(missing),
    (error) => error instanceof DeepSeekConformanceError && error.code === "MISSING_REASONING_CONTENT",
  );
});

test("context budget rejects an over-limit request before transport", () => {
  assert.throws(
    () => prepareRequest({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "x" }],
      max_tokens: 2,
    }, { promptTokens: MAX_CONTEXT_TOKENS - 1 }),
    (error) => error.code === "CONTEXT_LIMIT" && error.details.limit === MAX_CONTEXT_TOKENS,
  );
});

test("non-stream response retains reasoning, tool calls, and native cache usage", () => {
  const normalized = normalizeNonStreamResponse(fixture("non-stream-thinking.json"));
  const message = normalized.choices[0].message;
  assert.equal(message.reasoning_content, "The user asked for a weather lookup.");
  assert.equal(message.tool_calls[0].function.name, "get_weather");
  assert.equal(message.tool_calls[0].function.arguments, '{"city":"Hangzhou"}');
  assert.equal(normalized.usage.prompt_cache_hit_tokens, 32);
  assert.equal(normalized.usage.prompt_cache_miss_tokens, 8);
  assert.equal(normalized.usage.completion_tokens_details.reasoning_tokens, 9);
});

test("stream parser tolerates empty choices and aggregates interleaved tool calls by index", async () => {
  const source = fixture("sse-parallel-tools.json");
  const body = sse(source.events);
  const parsed = parseSse(body, { requireDone: true });
  const message = parsed.choices[0].message;
  assert.equal(message.reasoning_content, "I will check both cities. ");
  assert.equal(parsed.choices[0].finish_reason, "tool_calls");
  assert.equal(parsed.stream_stats.empty_choice_chunks, 2);
  assert.deepEqual(
    message.tool_calls.map((call) => [call.index, call.id, call.function.arguments]),
    [
      [0, "call-weather-a", '{"city":"Hangzhou"}'],
      [1, "call-weather-b", '{"city":"Guangzhou"}'],
    ],
  );
  assert.equal(parsed.usage.prompt_cache_hit_tokens, 48);
  assert.equal(parsed.usage.prompt_cache_miss_tokens, 16);

  const chunks = [];
  for (let index = 0; index < body.length; index += 7) chunks.push(body.slice(index, index + 7));
  async function* chunked() {
    for (const chunk of chunks) yield chunk;
  }
  const chunkedParsed = await consumeSse(chunked(), { requireDone: true });
  assert.deepEqual(chunkedParsed.choices, parsed.choices);
});

test("runner consumes a native fetch-like SSE Response body without calling json()", async () => {
  const source = fixture("sse-parallel-tools.json");
  const body = sse(source.events);
  let calls = 0;
  const result = await runConformance({
    request: {
      model: "deepseek-v4-pro",
      stream: true,
      messages: [{ role: "user", content: "stream response" }],
    },
    transport: async () => {
      calls += 1;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.response.choices[0].message.tool_calls[1].id, "call-weather-b");
});

test("multi-turn tool loop replays the assistant reasoning content", () => {
  const source = fixture("multi-turn-tool-loop.json");
  const first = prepareRequest({
    ...source.request,
    extra_body: { thinking: { type: "enabled" } },
  });
  const secondMessages = [
    ...first.request.messages,
    source.assistant,
    source.tool,
    { role: "user", content: "Now summarize it." },
  ];
  const second = prepareRequest({
    ...source.request,
    messages: secondMessages,
    extra_body: { thinking: { type: "enabled" } },
  });
  assert.equal(second.request.messages[1].reasoning_content, source.assistant.reasoning_content);
  assert.equal(second.request.messages[2].tool_call_id, source.tool.tool_call_id);
});

test("usage normalizer maps nested cached_tokens and derives totals", () => {
  const usage = normalizeUsage({
    prompt_tokens: 100,
    prompt_tokens_details: { cached_tokens: 64 },
    completion_tokens: 12,
    completion_tokens_details: { reasoning_tokens: 7 },
  });
  assert.equal(usage.prompt_cache_hit_tokens, 64);
  assert.equal(usage.prompt_cache_miss_tokens, 36);
  assert.equal(usage.total_tokens, 112);
  assert.equal(usage.prompt_tokens_details.cached_tokens, 64);
  assert.equal(usage.completion_tokens_details.reasoning_tokens, 7);
});

test("retry honors Retry-After without putting response bodies in the result", async () => {
  const source = fixture("retry-after.json");
  const { transport, calls } = createFixtureTransport(source.responses);
  const sleeps = [];
  const result = await runConformance({
    request: {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "retry" }],
    },
    transport,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    maxRetries: 1,
    now: () => 1700000000000,
  });
  assert.equal(result.response.choices[0].message.content, "Recovered.");
  assert.deepEqual(sleeps, [1000]);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.attempts, [{
    attempt: 0,
    status: 429,
    retryable: true,
    retryAfterMs: 1000,
    retried: true,
  }]);
  assert.equal(JSON.stringify(result).includes("fixture response"), false);
});

test("abort is never retried", async () => {
  const { transport, calls } = createFixtureTransport([{ abort: true }]);
  await assert.rejects(
    () => runConformance({
      request: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "abort" }] },
      transport,
      maxRetries: 4,
    }),
    (error) => error.code === "ABORTED" && error.name === "AbortError",
  );
  assert.equal(calls.length, 1);
});

test("abort signal short-circuits before transport", async () => {
  const controller = new AbortController();
  controller.abort();
  const { transport, calls } = createFixtureTransport([{
    payload: { choices: [] },
  }]);
  await assert.rejects(
    () => runConformance({
      request: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "abort" }] },
      transport,
      signal: controller.signal,
    }),
    (error) => error.code === "ABORTED",
  );
  assert.equal(calls.length, 0);
});

test("custom base URL is routed verbatim and beta tool routing is blocked", async () => {
  const source = fixture("custom-base-url.json");
  const { transport, calls } = createFixtureTransport([{ payload: source.response }]);
  const result = await runConformance({
    request: {
      model: source.model,
      messages: [{ role: "user", content: "custom" }],
    },
    baseUrl: source.baseUrl,
    transport,
  });
  assert.equal(result.url, `${source.baseUrl}/chat/completions`);
  assert.equal(calls[0].url, result.url);
  assert.equal(result.response.choices[0].message.content, "Custom route works.");
  assert.throws(
    () => buildChatCompletionsUrl({ baseUrl: source.baseUrl, beta: true, hasTools: true }),
    (error) => error.code === "BETA_TOOL_ROUTING",
  );
});

test("non-retryable API errors expose status and safe headers only", async () => {
  const { transport } = createFixtureTransport([{
    status: 400,
    headers: new Headers({
      "content-type": "application/json",
      authorization: "fixture-header-should-not-escape",
    }),
    payload: { error: { message: "fixture-only" } },
  }]);
  await assert.rejects(
    () => runConformance({
      request: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "bad" }] },
      transport,
      maxRetries: 4,
    }),
    (error) => {
      assert.ok(error instanceof DeepSeekHttpError);
      assert.equal(error.status, 400);
      assert.equal(error.headers.authorization, undefined);
      assert.equal(error.headers["content-type"], "application/json");
      return true;
    },
  );
});

test("retry-after parser supports seconds, dates, and a bounded delay", () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", {
    now: Date.parse("Wed, 21 Oct 2015 07:27:00 GMT"),
  }), 60000);
  assert.equal(parseRetryAfter("not-a-date"), undefined);
});

test("stream output is bounded before it can consume untrusted payloads", () => {
  const tooLarge = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "x".repeat(MAX_OUTPUT_CHARS + 1) } }] })}\n\n`;
  assert.throws(
    () => parseSse(tooLarge),
    (error) => error.code === "OUTPUT_LIMIT",
  );
});

test("fixture abort helper preserves the standard AbortError shape", () => {
  const error = createAbortError("fixture abort");
  assert.equal(error.name, "AbortError");
  assert.equal(error.code, "ABORTED");
  assert.equal(error.message, "fixture abort");
});
