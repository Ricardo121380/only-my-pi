/**
 * Deterministic DeepSeek-compatible Chat Completions conformance helpers.
 *
 * This module deliberately has no network client and no dependency on an API
 * key.  It normalizes the parts of the OpenAI-compatible DeepSeek contract
 * that are easy for an Agent Harness to get wrong: reasoning_content
 * round-tripping, interleaved streamed tool-call deltas, cache usage fields,
 * retry/abort handling, and custom endpoint routing.
 *
 * The runner accepts an injected transport.  A real HTTP client can adapt its
 * fetch implementation to that transport shape, while tests can use a local
 * deterministic fixture transport.  Nothing in this file makes a network
 * request by itself.
 */

export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_MAX_TOKENS = 4096;
export const MAX_CONTEXT_TOKENS = 1_048_576;
export const MAX_SSE_EVENTS = 4096;
export const MAX_OUTPUT_CHARS = 128 * 1024;
export const MAX_TOOL_ARGUMENT_CHARS = 64 * 1024;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function boundedString(value, limit, code = "OUTPUT_LIMIT") {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new DeepSeekConformanceError("INVALID_STRING", "Expected a string field", { code });
  }
  if (value.length > limit) {
    throw new DeepSeekConformanceError(code, `String exceeds ${limit} characters`, {
      limit,
      actual: value.length,
    });
  }
  return value;
}

function nonNegativeInteger(value, field, { optional = true } = {}) {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    throw new DeepSeekConformanceError("INVALID_INTEGER", `${field} is required`, { field });
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeepSeekConformanceError("INVALID_INTEGER", `${field} must be a non-negative integer`, {
      field,
      receivedType: typeof value,
    });
  }
  return value;
}

export class DeepSeekConformanceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DeepSeekConformanceError";
    this.code = code;
    this.details = details;
  }
}

export class DeepSeekHttpError extends Error {
  constructor(status, message = `DeepSeek request failed with HTTP ${status}`, details = {}) {
    super(message);
    this.name = "DeepSeekHttpError";
    this.code = "HTTP_ERROR";
    this.status = status;
    this.retryable = RETRYABLE_STATUSES.has(status);
    this.retryAfterMs = details.retryAfterMs;
    this.attempt = details.attempt;
    this.headers = details.headers ?? {};
  }
}

export function createAbortError(message = "DeepSeek request aborted") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "ABORTED";
  return error;
}

export function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === "ABORTED"));
}

export function normalizeBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new DeepSeekConformanceError("INVALID_BASE_URL", "baseUrl must be a non-empty URL");
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    // Do not echo the rejected URL: callers may have accidentally supplied a
    // credential-bearing or otherwise sensitive value.
    throw new DeepSeekConformanceError("INVALID_BASE_URL", "baseUrl must be an absolute URL");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new DeepSeekConformanceError("INVALID_BASE_URL", "baseUrl must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new DeepSeekConformanceError("URL_CREDENTIALS", "baseUrl must not embed credentials");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function buildChatCompletionsUrl({
  baseUrl = DEFAULT_BASE_URL,
  beta = false,
  hasTools = false,
} = {}) {
  if (beta && hasTools) {
    throw new DeepSeekConformanceError(
      "BETA_TOOL_ROUTING",
      "The /beta endpoint is not allowed for tool-call requests",
    );
  }
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}${beta ? "/beta" : ""}/chat/completions`;
}

export function validateContextBudget({
  promptTokens,
  maxTokens,
  limit = MAX_CONTEXT_TOKENS,
} = {}) {
  const output = nonNegativeInteger(maxTokens, "maxTokens", { optional: false });
  const input = nonNegativeInteger(promptTokens, "promptTokens");
  if (input === undefined) {
    return { known: false, promptTokens: undefined, maxTokens: output, limit };
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new DeepSeekConformanceError("INVALID_CONTEXT_LIMIT", "context limit must be a positive integer");
  }
  if (input + output > limit) {
    throw new DeepSeekConformanceError(
      "CONTEXT_LIMIT",
      `prompt_tokens + max_tokens exceeds the ${limit}-token context limit`,
      { promptTokens: input, maxTokens: output, limit },
    );
  }
  return { known: true, promptTokens: input, maxTokens: output, limit };
}

function textFromContent(value, field = "content") {
  if (value === undefined || value === null) return value === null ? null : "";
  if (typeof value === "string") return boundedString(value, MAX_OUTPUT_CHARS, "OUTPUT_LIMIT");
  if (Array.isArray(value)) {
    const pieces = value.map((part) => {
      if (typeof part === "string") return part;
      if (!isObject(part)) {
        throw new DeepSeekConformanceError("INVALID_CONTENT", `${field} contains an invalid part`);
      }
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    });
    return boundedString(pieces.join(""), MAX_OUTPUT_CHARS, "OUTPUT_LIMIT");
  }
  throw new DeepSeekConformanceError("INVALID_CONTENT", `${field} must be a string, array, or null`);
}

function normalizeToolCall(call, fallbackIndex = 0) {
  if (!isObject(call)) {
    throw new DeepSeekConformanceError("INVALID_TOOL_CALL", "tool call must be an object");
  }
  const fn = isObject(call.function) ? call.function : {};
  const name = fn.name ?? call.name;
  if (name !== undefined && typeof name !== "string") {
    throw new DeepSeekConformanceError("INVALID_TOOL_CALL", "tool call function.name must be a string");
  }
  let args = fn.arguments ?? call.arguments ?? "";
  if (typeof args !== "string") {
    try {
      args = JSON.stringify(args);
    } catch (error) {
      throw new DeepSeekConformanceError("INVALID_TOOL_CALL", "tool call arguments are not JSON serializable", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
  args = boundedString(args, MAX_TOOL_ARGUMENT_CHARS, "TOOL_ARGUMENT_LIMIT");
  const result = {
    type: typeof call.type === "string" ? call.type : "function",
    function: {
      ...(name !== undefined ? { name } : {}),
      arguments: args,
    },
  };
  if (typeof call.id === "string") result.id = call.id;
  const index = call.index ?? fallbackIndex;
  if (Number.isSafeInteger(index) && index >= 0) result.index = index;
  return result;
}

function normalizeMessages(messages, { thinkingEnabled }) {
  if (!Array.isArray(messages)) {
    throw new DeepSeekConformanceError("INVALID_MESSAGES", "messages must be an array");
  }
  return messages.map((raw, messageIndex) => {
    if (!isObject(raw) || typeof raw.role !== "string") {
      throw new DeepSeekConformanceError("INVALID_MESSAGE", "each message needs a string role", {
        messageIndex,
      });
    }
    const message = cloneJson(raw);
    if (hasOwn(message, "content")) message.content = textFromContent(message.content);
    if (hasOwn(message, "reasoning_content")) {
      if (message.reasoning_content !== null && typeof message.reasoning_content !== "string") {
        throw new DeepSeekConformanceError(
          "INVALID_REASONING_CONTENT",
          "reasoning_content must be a string or null",
          { messageIndex },
        );
      }
      if (typeof message.reasoning_content === "string") {
        message.reasoning_content = boundedString(
          message.reasoning_content,
          MAX_OUTPUT_CHARS,
          "REASONING_LIMIT",
        );
      }
    }
    if (hasOwn(message, "tool_calls")) {
      if (!Array.isArray(message.tool_calls)) {
        throw new DeepSeekConformanceError("INVALID_TOOL_CALL", "tool_calls must be an array", {
          messageIndex,
        });
      }
      message.tool_calls = message.tool_calls.map((call, index) => normalizeToolCall(call, index));
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      if (thinkingEnabled && typeof message.reasoning_content !== "string") {
        throw new DeepSeekConformanceError(
          "MISSING_REASONING_CONTENT",
          "assistant tool-call messages in thinking mode must preserve reasoning_content",
          { messageIndex },
        );
      }
    }
    if (message.role === "tool" && typeof message.tool_call_id !== "string") {
      throw new DeepSeekConformanceError("INVALID_TOOL_MESSAGE", "tool messages need tool_call_id", {
        messageIndex,
      });
    }
    return message;
  });
}

function normalizeThinking(input, options, warnings) {
  const extraBody = isObject(input.extra_body) ? cloneJson(input.extra_body) : {};
  let thinking = input.thinking ?? extraBody.thinking;
  if (thinking === undefined) thinking = { type: options.defaultThinking ?? "disabled" };
  if (typeof thinking === "string") thinking = { type: thinking };
  if (!isObject(thinking) || !["enabled", "disabled"].includes(thinking.type)) {
    throw new DeepSeekConformanceError(
      "INVALID_THINKING",
      'thinking must be {type:"enabled"} or {type:"disabled"}',
    );
  }
  extraBody.thinking = { ...thinking };
  const enabled = thinking.type === "enabled";
  if (enabled) {
    for (const field of ["temperature", "top_p", "presence_penalty", "frequency_penalty"]) {
      if (hasOwn(input, field)) warnings.push(`thinking mode ignores ${field}`);
    }
  }
  return { extraBody, enabled };
}

export function prepareRequest(input, options = {}) {
  if (!isObject(input)) throw new DeepSeekConformanceError("INVALID_REQUEST", "request must be an object");
  const request = cloneJson(input);
  if (typeof request.model !== "string" || request.model.trim() === "") {
    throw new DeepSeekConformanceError("INVALID_MODEL", "request.model must be a non-empty string");
  }
  const maxTokens = request.max_tokens ?? options.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new DeepSeekConformanceError("INVALID_MAX_TOKENS", "max_tokens must be a positive integer");
  }
  const warnings = [];
  const { extraBody, enabled: thinkingEnabled } = normalizeThinking(request, options, warnings);
  request.max_tokens = maxTokens;
  request.stream = Boolean(request.stream);
  if (request.stream && options.includeUsage !== false) {
    const streamOptions = isObject(request.stream_options) ? cloneJson(request.stream_options) : {};
    if (streamOptions.include_usage === undefined) streamOptions.include_usage = true;
    request.stream_options = streamOptions;
  }
  request.extra_body = extraBody;
  delete request.thinking;
  request.messages = normalizeMessages(request.messages, { thinkingEnabled });
  const context = validateContextBudget({
    promptTokens: options.promptTokens,
    maxTokens,
    limit: options.contextLimit ?? MAX_CONTEXT_TOKENS,
  });
  const hasTools = Array.isArray(request.tools) && request.tools.length > 0;
  const url = buildChatCompletionsUrl({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    beta: Boolean(options.beta),
    hasTools,
  });
  return {
    request,
    url,
    warnings,
    thinkingEnabled,
    context,
  };
}

export function normalizeRequest(input, options = {}) {
  return prepareRequest(input, options).request;
}

function usageNumber(usage, key) {
  const value = usage?.[key];
  return value === undefined || value === null ? undefined : nonNegativeInteger(value, `usage.${key}`);
}

/**
 * Normalize DeepSeek's native cache fields and the OpenAI-compatible nested
 * cached_tokens alias into one bounded, API-shaped usage object.
 */
export function normalizeUsage(usage) {
  if (usage === undefined || usage === null) return undefined;
  if (!isObject(usage)) throw new DeepSeekConformanceError("INVALID_USAGE", "usage must be an object");
  const prompt = usageNumber(usage, "prompt_tokens");
  const completion = usageNumber(usage, "completion_tokens");
  const nestedDetails = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const nestedHit = usageNumber(nestedDetails, "cached_tokens");
  const hit = usageNumber(usage, "prompt_cache_hit_tokens") ?? nestedHit;
  let miss = usageNumber(usage, "prompt_cache_miss_tokens");
  let normalizedPrompt = prompt;
  if (normalizedPrompt === undefined && hit !== undefined && miss !== undefined) normalizedPrompt = hit + miss;
  if (miss === undefined && normalizedPrompt !== undefined && hit !== undefined && normalizedPrompt >= hit) {
    miss = normalizedPrompt - hit;
  }
  if (normalizedPrompt !== undefined && hit !== undefined && miss !== undefined && normalizedPrompt !== hit + miss) {
    throw new DeepSeekConformanceError("USAGE_INVARIANT", "prompt_tokens must equal cache hit + miss", {
      prompt_tokens: normalizedPrompt,
      prompt_cache_hit_tokens: hit,
      prompt_cache_miss_tokens: miss,
    });
  }
  const reasoning = usageNumber(
    isObject(usage.completion_tokens_details) ? usage.completion_tokens_details : {},
    "reasoning_tokens",
  ) ?? usageNumber(usage, "reasoning_tokens");
  let total = usageNumber(usage, "total_tokens");
  if (total === undefined && normalizedPrompt !== undefined && completion !== undefined) {
    total = normalizedPrompt + completion;
  }
  const result = {};
  if (normalizedPrompt !== undefined) result.prompt_tokens = normalizedPrompt;
  if (completion !== undefined) result.completion_tokens = completion;
  if (total !== undefined) result.total_tokens = total;
  if (hit !== undefined) result.prompt_cache_hit_tokens = hit;
  if (miss !== undefined) result.prompt_cache_miss_tokens = miss;
  if (reasoning !== undefined) result.completion_tokens_details = { reasoning_tokens: reasoning };
  if (nestedHit !== undefined) result.prompt_tokens_details = { cached_tokens: nestedHit };
  return result;
}

function normalizeChoice(choice, fallbackIndex = 0) {
  if (!isObject(choice)) throw new DeepSeekConformanceError("INVALID_CHOICE", "choice must be an object");
  const index = Number.isSafeInteger(choice.index) && choice.index >= 0 ? choice.index : fallbackIndex;
  const rawMessage = isObject(choice.message) ? choice.message : {};
  const message = {
    role: typeof rawMessage.role === "string" ? rawMessage.role : "assistant",
    content: textFromContent(rawMessage.content),
  };
  const reasoning = rawMessage.reasoning_content ?? rawMessage.reasoningContent;
  if (reasoning !== undefined && reasoning !== null) {
    message.reasoning_content = boundedString(reasoning, MAX_OUTPUT_CHARS, "REASONING_LIMIT");
  }
  if (Array.isArray(rawMessage.tool_calls) && rawMessage.tool_calls.length > 0) {
    message.tool_calls = rawMessage.tool_calls.map((call, callIndex) => normalizeToolCall(call, callIndex));
  }
  return {
    index,
    message,
    finish_reason: choice.finish_reason ?? null,
  };
}

export function normalizeNonStreamResponse(response) {
  if (!isObject(response)) {
    throw new DeepSeekConformanceError("INVALID_RESPONSE", "non-stream response must be an object");
  }
  const choices = Array.isArray(response.choices)
    ? response.choices.map((choice, index) => normalizeChoice(choice, index))
    : [];
  const result = {
    ...(typeof response.id === "string" ? { id: response.id } : {}),
    object: typeof response.object === "string" ? response.object : "chat.completion",
    ...(Number.isSafeInteger(response.created) ? { created: response.created } : {}),
    ...(typeof response.model === "string" ? { model: response.model } : {}),
    choices,
  };
  const usage = normalizeUsage(response.usage);
  if (usage !== undefined) result.usage = usage;
  return result;
}

function appendBounded(parts, value, limit, code) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string") {
    throw new DeepSeekConformanceError("INVALID_DELTA", "stream delta text must be a string", { code });
  }
  const current = parts.join("").length;
  if (current + value.length > limit) {
    throw new DeepSeekConformanceError(code, `stream output exceeds ${limit} characters`, {
      limit,
      actual: current + value.length,
    });
  }
  parts.push(value);
}

function createStreamState() {
  return {
    id: undefined,
    object: "chat.completion",
    created: undefined,
    model: undefined,
    usage: undefined,
    eventCount: 0,
    emptyChoiceChunks: 0,
    done: false,
    choices: new Map(),
  };
}

function streamChoice(state, index) {
  if (!state.choices.has(index)) {
    state.choices.set(index, {
      index,
      role: "assistant",
      content: [],
      reasoning: [],
      toolCalls: new Map(),
      finishReason: null,
    });
  }
  return state.choices.get(index);
}

function mergeStreamToolCall(choiceState, rawCall, fallbackIndex = 0) {
  const call = isObject(rawCall) ? rawCall : {};
  const index = Number.isSafeInteger(call.index) && call.index >= 0 ? call.index : fallbackIndex;
  if (!choiceState.toolCalls.has(index)) {
    choiceState.toolCalls.set(index, {
      index,
      type: "function",
      id: undefined,
      name: undefined,
      arguments: [],
    });
  }
  const target = choiceState.toolCalls.get(index);
  if (typeof call.id === "string") target.id = call.id;
  if (typeof call.type === "string") target.type = call.type;
  const fn = isObject(call.function) ? call.function : {};
  if (typeof fn.name === "string") target.name = fn.name;
  if (fn.arguments !== undefined && fn.arguments !== null) {
    appendBounded(target.arguments, String(fn.arguments), MAX_TOOL_ARGUMENT_CHARS, "TOOL_ARGUMENT_LIMIT");
  }
}

function applyStreamEvent(state, event) {
  if (!isObject(event)) return;
  state.eventCount += 1;
  if (state.eventCount > MAX_SSE_EVENTS) {
    throw new DeepSeekConformanceError("SSE_EVENT_LIMIT", `stream exceeds ${MAX_SSE_EVENTS} events`);
  }
  if (typeof event.id === "string") state.id = event.id;
  if (typeof event.object === "string") state.object = event.object;
  if (Number.isSafeInteger(event.created)) state.created = event.created;
  if (typeof event.model === "string") state.model = event.model;
  if (event.usage !== undefined && event.usage !== null) state.usage = normalizeUsage(event.usage);
  if (!Array.isArray(event.choices)) return;
  if (event.choices.length === 0) {
    state.emptyChoiceChunks += 1;
    return;
  }
  event.choices.forEach((rawChoice, choicePosition) => {
    if (!isObject(rawChoice)) return;
    const index = Number.isSafeInteger(rawChoice.index) && rawChoice.index >= 0
      ? rawChoice.index
      : choicePosition;
    const target = streamChoice(state, index);
    if (rawChoice.finish_reason !== undefined && rawChoice.finish_reason !== null) {
      target.finishReason = rawChoice.finish_reason;
    }
    const delta = isObject(rawChoice.delta)
      ? rawChoice.delta
      : isObject(rawChoice.message)
        ? rawChoice.message
        : {};
    if (typeof delta.role === "string") target.role = delta.role;
    appendBounded(target.content, textFromContent(delta.content), MAX_OUTPUT_CHARS, "OUTPUT_LIMIT");
    appendBounded(
      target.reasoning,
      delta.reasoning_content ?? delta.reasoningContent,
      MAX_OUTPUT_CHARS,
      "REASONING_LIMIT",
    );
    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((call, callPosition) => mergeStreamToolCall(target, call, callPosition));
    }
    if (isObject(delta.function_call)) mergeStreamToolCall(target, { index: 0, function: delta.function_call }, 0);
  });
}

function streamStateToResponse(state) {
  const choices = [...state.choices.values()]
    .sort((left, right) => left.index - right.index)
    .map((choice) => {
      const message = {
        role: choice.role,
        content: choice.content.join(""),
      };
      const reasoning = choice.reasoning.join("");
      if (reasoning !== "") message.reasoning_content = reasoning;
      const calls = [...choice.toolCalls.values()]
        .sort((left, right) => left.index - right.index)
        .map((call) => {
          const normalized = {
            type: call.type,
            function: {
              ...(call.name !== undefined ? { name: call.name } : {}),
              arguments: call.arguments.join(""),
            },
            index: call.index,
          };
          if (call.id !== undefined) normalized.id = call.id;
          return normalized;
        });
      if (calls.length > 0) message.tool_calls = calls;
      return { index: choice.index, message, finish_reason: choice.finishReason };
    });
  const result = {
    ...(state.id !== undefined ? { id: state.id } : {}),
    object: state.object,
    ...(state.created !== undefined ? { created: state.created } : {}),
    ...(state.model !== undefined ? { model: state.model } : {}),
    choices,
    stream_stats: {
      event_count: state.eventCount,
      empty_choice_chunks: state.emptyChoiceChunks,
    },
  };
  if (state.usage !== undefined) result.usage = state.usage;
  return result;
}

function processSseData(state, data) {
  const normalized = data.trim();
  if (normalized === "" || normalized === ":keep-alive") return;
  if (normalized === "[DONE]") {
    state.done = true;
    return;
  }
  let event;
  try {
    event = JSON.parse(normalized);
  } catch (error) {
    throw new DeepSeekConformanceError("INVALID_SSE_JSON", "SSE data is not valid JSON", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  applyStreamEvent(state, event);
}

function feedSseLine(state, line) {
  if (line === "") {
    if (state.dataLines?.length) processSseData(state, state.dataLines.join("\n"));
    state.dataLines = [];
    return;
  }
  if (line.startsWith(":")) return;
  if (line.startsWith("data:")) {
    if (!state.dataLines) state.dataLines = [];
    state.dataLines.push(line.slice(5).replace(/^ /, ""));
  }
}

export function parseSse(text, options = {}) {
  if (typeof text !== "string") throw new DeepSeekConformanceError("INVALID_SSE", "SSE input must be a string");
  const state = createStreamState();
  state.dataLines = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) feedSseLine(state, line);
  if (state.dataLines.length) processSseData(state, state.dataLines.join("\n"));
  delete state.dataLines;
  if (options.requireDone && !state.done) {
    throw new DeepSeekConformanceError("MISSING_SSE_DONE", "stream did not include [DONE]");
  }
  return streamStateToResponse(state);
}

export async function consumeSse(body, options = {}) {
  if (typeof body === "string") return parseSse(body, options);
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    if (body && typeof body[Symbol.iterator] === "function") {
      const chunks = [];
      for (const chunk of body) chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return parseSse(chunks.join(""), options);
    }
    throw new DeepSeekConformanceError("INVALID_SSE", "body must be text or an iterable of chunks");
  }
  const decoder = new TextDecoder();
  const state = createStreamState();
  state.dataLines = [];
  let pending = "";
  for await (const chunk of body) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) feedSseLine(state, line);
  }
  pending += decoder.decode();
  if (pending !== "") feedSseLine(state, pending);
  if (state.dataLines.length) processSseData(state, state.dataLines.join("\n"));
  delete state.dataLines;
  if (options.requireDone && !state.done) {
    throw new DeepSeekConformanceError("MISSING_SSE_DONE", "stream did not include [DONE]");
  }
  return streamStateToResponse(state);
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  if (typeof headers.get === "function") return headers.get(name) ?? headers.get(wanted) ?? undefined;
  if (headers instanceof Map) {
    for (const [key, value] of headers) if (String(key).toLowerCase() === wanted) return String(value);
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === wanted) return String(value);
  return undefined;
}

export function parseRetryAfter(value, { now = Date.now(), maxMs = 60_000 } = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim();
  let milliseconds;
  if (/^\d+$/.test(text)) {
    milliseconds = Number(text) * 1000;
  } else {
    const timestamp = Date.parse(text);
    if (!Number.isFinite(timestamp)) return undefined;
    milliseconds = Math.max(0, timestamp - now);
  }
  if (!Number.isFinite(milliseconds)) return undefined;
  return Math.min(Math.max(0, Math.floor(milliseconds)), maxMs);
}

function safeHeaders(headers) {
  const output = {};
  if (!headers) return output;
  const entries = typeof headers.entries === "function"
    ? [...headers.entries()]
    : headers instanceof Map
      ? [...headers.entries()]
      : Object.entries(headers);
  for (const [key, value] of entries) {
    if (SENSITIVE_HEADER_NAMES.has(String(key).toLowerCase())) continue;
    if (String(key).toLowerCase() === "retry-after" || String(key).toLowerCase() === "content-type") {
      output[String(key).toLowerCase()] = String(value).slice(0, 256);
    }
  }
  return output;
}

async function responsePayload(response, { stream = false } = {}) {
  // A native fetch Response exposes an SSE ReadableStream through a prototype
  // getter, so checking only own properties would miss it. Never call
  // response.json() before consuming a streamed body: that would try to parse
  // the entire SSE document as one JSON value.
  if (stream && response?.body !== undefined && response?.body !== null) return response.body;
  if (hasOwn(response, "payload")) return response.payload;
  if (stream && typeof response.text === "function") return response.text();
  if (typeof response.json === "function") return response.json();
  if (hasOwn(response, "json") && typeof response.json !== "function") return response.json;
  if (typeof response.text === "function") {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (hasOwn(response, "body")) return response.body;
  return undefined;
}

function statusOf(response) {
  if (!response || typeof response !== "object") return 200;
  return Number.isSafeInteger(response.status) ? response.status : 200;
}

function responseOk(response, status) {
  return typeof response?.ok === "boolean" ? response.ok : status >= 200 && status < 300;
}

const defaultSleep = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(createAbortError());
  let settled = false;
  const cleanup = () => signal?.removeEventListener("abort", onAbort);
  const onAbort = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();
    reject(createAbortError());
  };
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  }, milliseconds);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
});

/**
 * Run one prepared request through an injected fetch-like transport.  The
 * transport receives `{url, request, init, signal, attempt}` and returns an
 * object shaped like a Response or a fixture descriptor.  Retry sleeps are
 * injectable so tests never wait on wall-clock delays.
 */
export async function runConformance({
  request,
  transport,
  baseUrl,
  beta = false,
  promptTokens,
  contextLimit,
  maxRetries = 2,
  retryBaseMs = 250,
  maxRetryDelayMs = 5000,
  now = Date.now,
  sleep = defaultSleep,
  signal,
} = {}) {
  if (typeof transport !== "function") {
    throw new DeepSeekConformanceError("MISSING_TRANSPORT", "runConformance requires an injected transport");
  }
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 8) {
    throw new DeepSeekConformanceError("INVALID_RETRIES", "maxRetries must be an integer between 0 and 8");
  }
  const prepared = prepareRequest(request, { baseUrl, beta, promptTokens, contextLimit });
  const attempts = [];
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) throw createAbortError();
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prepared.request),
    };
    let response;
    try {
      response = await transport({
        url: prepared.url,
        request: cloneJson(prepared.request),
        init,
        signal,
        attempt,
      });
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw createAbortError();
      throw error;
    }
    const status = statusOf(response);
    if (!responseOk(response, status)) {
      const retryAfterMs = parseRetryAfter(headerValue(response.headers, "retry-after"), {
        now: typeof now === "function" ? now() : now,
        maxMs: maxRetryDelayMs,
      });
      const retryable = RETRYABLE_STATUSES.has(status);
      const canRetry = retryable && attempt < maxRetries;
      attempts.push({ attempt, status, retryable, retryAfterMs, retried: canRetry });
      if (!canRetry) {
        throw new DeepSeekHttpError(status, `DeepSeek request failed with HTTP ${status}`, {
          attempt,
          retryAfterMs,
          headers: safeHeaders(response.headers),
        });
      }
      const exponential = Math.min(maxRetryDelayMs, retryBaseMs * (2 ** attempt));
      const delay = retryAfterMs ?? exponential;
      await sleep(delay, signal);
      continue;
    }
    const stream = prepared.request.stream || response.stream === true;
    const payload = await responsePayload(response, { stream });
    if (signal?.aborted) throw createAbortError();
    const normalized = stream
      ? await consumeSse(payload ?? response.body, { requireDone: false })
      : normalizeNonStreamResponse(payload);
    return {
      request: prepared.request,
      url: prepared.url,
      warnings: prepared.warnings,
      thinkingEnabled: prepared.thinkingEnabled,
      context: prepared.context,
      attempts,
      response: normalized,
    };
  }
  throw new DeepSeekConformanceError("RETRY_EXHAUSTED", "retry loop exhausted unexpectedly");
}

/**
 * Build a deterministic fixture transport.  Sequence entries can use
 * `{status, headers, payload}` for JSON responses, `{status, headers, body,
 * stream:true}` for SSE, or `{abort:true}` to simulate cancellation.  Calls
 * expose metadata and a cloned request for assertions; no credentials are
 * accepted or generated.
 */
export function createFixtureTransport(sequence, { onCall } = {}) {
  if (!Array.isArray(sequence) || sequence.length === 0) {
    throw new DeepSeekConformanceError("INVALID_FIXTURE", "fixture sequence must be a non-empty array");
  }
  let cursor = 0;
  const calls = [];
  const transport = async ({ url, request, signal, attempt }) => {
    if (signal?.aborted) throw createAbortError();
    const entry = sequence[Math.min(cursor, sequence.length - 1)];
    cursor += 1;
    const call = { url, attempt, request: cloneJson(request) };
    calls.push(call);
    if (typeof onCall === "function") await onCall(call, entry);
    if (entry?.abort) throw createAbortError();
    if (entry?.delayMs) await defaultSleep(Math.min(entry.delayMs, 1000), signal);
    return {
      status: entry?.status ?? 200,
      ok: entry?.ok ?? ((entry?.status ?? 200) >= 200 && (entry?.status ?? 200) < 300),
      headers: entry?.headers ?? {},
      stream: entry?.stream === true,
      payload: entry?.payload,
      body: entry?.body,
    };
  };
  return { transport, calls };
}
