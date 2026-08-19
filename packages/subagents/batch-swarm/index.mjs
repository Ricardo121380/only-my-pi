import crypto from "node:crypto";

import { createTaskAssignment } from "../domain/assignment.mjs";
import {
  assertPlainJson,
  canonicalJson,
  sha256,
} from "../state/codec.mjs";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT = /^artifact:\/\/[a-z0-9][a-z0-9._:/-]{0,511}$/u;
const TEMPLATE_TOKEN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu;
const ALLOWED_TEMPLATE_TOKENS = new Set(["batchId", "index", "item", "itemId"]);
const HETEROGENEOUS_ITEM_KEYS = new Set([
  "agentSpec", "agentSpecHash", "agentSpecRef", "outputSchemaHash", "outputSchemaRef",
  "policy", "policyHash", "promptTemplateHash", "promptTemplateRef",
]);
const ITEM_TERMINAL_STATUSES = new Set([
  "succeeded", "failed", "cancelled", "skipped", "budget-exhausted",
]);
const RETRYABLE_CODES = new Set([
  "429", "BACKEND_BUSY", "RATE_LIMITED", "TEMPORARY_UNAVAILABLE", "TRANSIENT_BACKEND_ERROR",
]);
const MAX_PHYSICAL_ASSIGNMENTS = 1000;
const DEFINITION_KEYS = Object.freeze([
  "$schema", "agentSpecHash", "agentSpecRef", "budgetRef", "concurrency", "contractStatus",
  "failurePolicy", "formatVersion", "id", "itemsFrom", "kind", "maxItems", "outputSchemaHash",
  "outputSchemaRef", "policyHash", "promptTemplateHash", "promptTemplateRef", "retryPolicy",
]);

export class BatchSwarmError extends Error {
  constructor(message, code = "BATCH_SWARM_ERROR", details = {}) {
    super(`batch-swarm: ${message}`);
    this.name = "BatchSwarmError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new BatchSwarmError(message, code, details);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function immutable(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) immutable(child);
  return value;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function canonicalId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} is invalid`, "INVALID_BATCH_ID", { value });
  return value;
}

function digest(value) {
  return sha256(value);
}

function definitionProjection(definition) {
  return Object.fromEntries(Object.entries(definition).filter(([key]) => key !== "$schema"));
}

export function digestBatchSwarmDefinition(definition) {
  return digest(definitionProjection(definition));
}

function exactKeys(value, expected) {
  return object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateDefinition(definition) {
  const errors = [];
  const add = (code, path, message) => errors.push({ code, path, message });
  if (!object(definition)) return [{ code: "INVALID_BATCH_DEFINITION", path: "", message: "definition must be an object" }];
  if (!exactKeys(definition, DEFINITION_KEYS)) add("INVALID_BATCH_DEFINITION", "", "definition contains missing or unknown fields");
  if (definition.$schema !== "https://github.com/Ricardo121380/only-my-pi/schemas/batch-swarm-v1.schema.json") add("INVALID_BATCH_SCHEMA", "/$schema", "schema id is invalid");
  if (definition.formatVersion !== 1 || !["contract-preview", "runtime-ready"].includes(definition.contractStatus) || definition.kind !== "batch-swarm") add("INVALID_BATCH_VERSION", "", "version, status, or kind is invalid");
  for (const field of ["id", "agentSpecRef", "promptTemplateRef", "outputSchemaRef", "budgetRef"]) {
    if (typeof definition[field] !== "string" || !ID.test(definition[field])) add("INVALID_BATCH_ID", `/${field}`, `${field} is invalid`);
  }
  for (const field of ["agentSpecHash", "policyHash", "promptTemplateHash", "outputSchemaHash"]) {
    if (typeof definition[field] !== "string" || !SHA256.test(definition[field])) add("INVALID_BATCH_DIGEST", `/${field}`, `${field} is invalid`);
  }
  if (typeof definition.itemsFrom !== "string" || !ARTIFACT.test(definition.itemsFrom)) add("INVALID_BATCH_ITEMS", "/itemsFrom", "itemsFrom is invalid");
  if (!Number.isSafeInteger(definition.maxItems) || definition.maxItems < 1 || definition.maxItems > 300) add("INVALID_BATCH_MAX_ITEMS", "/maxItems", "maxItems must be between 1 and 300");
  const concurrency = definition.concurrency;
  if (!object(concurrency)
    || !exactKeys(concurrency, ["adaptiveRateLimit", "initial", "max", "rampEveryMs"])
    || !Number.isSafeInteger(concurrency.initial) || concurrency.initial < 1 || concurrency.initial > 16
    || !Number.isSafeInteger(concurrency.max) || concurrency.max < 1 || concurrency.max > 16
    || concurrency.initial > concurrency.max
    || !Number.isSafeInteger(concurrency.rampEveryMs) || concurrency.rampEveryMs < 1 || concurrency.rampEveryMs > 3_600_000
    || typeof concurrency.adaptiveRateLimit !== "boolean") {
    add("INVALID_BATCH_CONCURRENCY", "/concurrency", "concurrency envelope is invalid");
  }
  const failure = definition.failurePolicy;
  const failureKinds = ["fail-fast", "continue", "quorum", "minimum-success", "all-required"];
  if (!object(failure)
    || !failureKinds.includes(failure.kind)
    || !Object.keys(failure).every((key) => ["kind", "threshold"].includes(key))) {
    add("INVALID_BATCH_FAILURE_POLICY", "/failurePolicy", "failure policy is invalid");
  } else {
    const thresholdKind = ["quorum", "minimum-success"].includes(failure.kind);
    if (thresholdKind && (!Number.isSafeInteger(failure.threshold) || failure.threshold < 1 || failure.threshold > definition.maxItems)) {
      add("INVALID_BATCH_FAILURE_THRESHOLD", "/failurePolicy/threshold", "failure threshold is invalid");
    }
    if (!thresholdKind && failure.threshold !== undefined) add("INVALID_BATCH_FAILURE_THRESHOLD", "/failurePolicy/threshold", "threshold is not allowed for this policy");
  }
  const retry = definition.retryPolicy;
  if (!object(retry)
    || !exactKeys(retry, ["deadlineMs", "maxAttempts", "maxDelayMs"])
    || !Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 8
    || !Number.isSafeInteger(retry.maxDelayMs) || retry.maxDelayMs < 0 || retry.maxDelayMs > 3_600_000
    || !Number.isSafeInteger(retry.deadlineMs) || retry.deadlineMs < 1 || retry.deadlineMs > 86_400_000
    || retry.maxDelayMs > retry.deadlineMs) {
    add("INVALID_BATCH_RETRY_POLICY", "/retryPolicy", "retry policy is invalid");
  }
  if (Number.isSafeInteger(definition.maxItems)
    && Number.isSafeInteger(retry?.maxAttempts)
    && definition.maxItems * retry.maxAttempts > MAX_PHYSICAL_ASSIGNMENTS) {
    add(
      "INVALID_BATCH_ASSIGNMENT_ENVELOPE",
      "/retryPolicy/maxAttempts",
      `maxItems multiplied by maxAttempts must not exceed ${MAX_PHYSICAL_ASSIGNMENTS}`,
    );
  }
  return errors;
}

export function validateBatchSwarmDefinition(definition) {
  const errors = validateDefinition(definition);
  return immutable({ valid: errors.length === 0, errors });
}

export function assertBatchSwarmDefinition(definition) {
  const result = validateBatchSwarmDefinition(definition);
  if (!result.valid) fail(result.errors[0].message, result.errors[0].code, { errors: result.errors });
  return immutable(clone(definition));
}

function capabilityState(matrix, name) {
  return matrix?.capabilities?.[name]?.state ?? "UNAVAILABLE";
}

function assertCapabilityEnvelope(definition, matrix) {
  if (capabilityState(matrix, "perItemResult") === "UNAVAILABLE") {
    fail("backend cannot correlate per-item results", "PER_ITEM_RESULT_UNAVAILABLE");
  }
  if (definition.concurrency.adaptiveRateLimit
    && (capabilityState(matrix, "rateLimitSignal") !== "SUPPORTED"
      || capabilityState(matrix, "dynamicConcurrency") !== "SUPPORTED")) {
    fail("adaptive capacity requires backend rate-limit and dynamic-concurrency signals", "ADAPTIVE_CAPACITY_UNAVAILABLE", {
      rateLimitSignal: capabilityState(matrix, "rateLimitSignal"),
      dynamicConcurrency: capabilityState(matrix, "dynamicConcurrency"),
    });
  }
}

function assertAgentBinding(definition, agentSpec) {
  if (agentSpec?.kind !== "resolved-agent-spec" || agentSpec?.formatVersion !== 1) fail("resolved AgentSpec is invalid", "BATCH_AGENT_SPEC_INVALID");
  const { specHash, ...specProjection } = agentSpec;
  if (typeof specHash !== "string" || digest(specProjection) !== specHash) {
    fail("resolved AgentSpec content does not match specHash", "BATCH_AGENT_SPEC_TAMPERED");
  }
  if (digest(agentSpec.effectivePolicy) !== agentSpec.effectivePolicyHash) {
    fail("resolved AgentSpec policy content does not match effectivePolicyHash", "BATCH_AGENT_SPEC_TAMPERED");
  }
  const output = agentSpec.outputSchema;
  const outputValue = output?.value ?? output?.schema ?? output?.ref;
  if (outputValue === undefined || digest(outputValue) !== output?.hash) {
    fail("resolved AgentSpec output content does not match output hash", "BATCH_AGENT_SPEC_TAMPERED");
  }
  if (agentSpec.id !== definition.agentSpecRef || agentSpec.specHash !== definition.agentSpecHash) fail("resolved AgentSpec hash differs from the batch contract", "BATCH_AGENT_SPEC_HASH_MISMATCH");
  if (agentSpec.effectivePolicyHash !== definition.policyHash) fail("resolved AgentSpec policy differs from the batch contract", "BATCH_POLICY_HASH_MISMATCH");
  if (agentSpec.outputSchema?.hash !== definition.outputSchemaHash) fail("resolved AgentSpec output differs from the batch contract", "BATCH_OUTPUT_SCHEMA_HASH_MISMATCH");
  if (agentSpec.writer || agentSpec.effectivePolicy?.mutation !== "none" || !["none", "shared-read-only"].includes(agentSpec.effectivePolicy?.workspace)) {
    fail("S3 BatchSwarm accepts read-only AgentSpecs only", "BATCH_WRITER_UNAVAILABLE");
  }
}

function assertTemplateBinding(definition, template) {
  if (typeof template !== "string" || template.length < 1 || template.length > 131_072 || template.includes("\0")) fail("prompt template is invalid", "BATCH_PROMPT_TEMPLATE_INVALID");
  if (digest(template) !== definition.promptTemplateHash) fail("prompt template hash differs from the batch contract", "BATCH_PROMPT_TEMPLATE_HASH_MISMATCH");
  const tokens = [...template.matchAll(TEMPLATE_TOKEN)].map((match) => match[1]);
  const unknown = tokens.filter((token) => !ALLOWED_TEMPLATE_TOKENS.has(token));
  if (unknown.length > 0) fail(`prompt template contains unsupported tokens: ${unknown.join(", ")}`, "BATCH_PROMPT_TEMPLATE_INVALID");
  if (!tokens.includes("item")) fail("prompt template must contain {{item}}", "BATCH_PROMPT_TEMPLATE_INVALID");
}

export function assertBatchSwarmResources(definition, agentSpec, promptTemplate) {
  const normalized = assertBatchSwarmDefinition(definition);
  assertAgentBinding(normalized, agentSpec);
  assertTemplateBinding(normalized, promptTemplate);
  return immutable({
    definition: normalized,
    definitionDigest: digestBatchSwarmDefinition(normalized),
    agentSpec: clone(agentSpec),
    promptTemplate,
  });
}

function itemId(item, index) {
  const explicit = object(item) ? item.itemId : undefined;
  if (explicit !== undefined) return canonicalId(explicit, `item ${index} itemId`);
  return `item-${String(index).padStart(3, "0")}-${digest(item).slice(7, 19)}`;
}

function assertNoHeterogeneousOverride(item, index) {
  if (!object(item)) return;
  const forbidden = Object.keys(item).filter((key) => HETEROGENEOUS_ITEM_KEYS.has(key));
  if (forbidden.length > 0) fail(`item ${index} attempts to override the homogeneous contract`, "BATCH_HETEROGENEOUS_ITEM_OVERRIDE", { index, forbidden });
}

function defaultResolveItems(definition, input) {
  const key = definition.itemsFrom.slice("artifact://".length);
  const artifacts = input?.artifacts;
  if (!object(artifacts) || !Object.hasOwn(artifacts, key)) fail(`missing batch artifact ${definition.itemsFrom}`, "BATCH_ITEMS_UNAVAILABLE");
  return artifacts[key];
}

function normalizeItems(definition, raw) {
  if (!Array.isArray(raw)) fail("batch items artifact must be an array", "BATCH_ITEMS_INVALID");
  if (raw.length > definition.maxItems) fail(`batch contains ${raw.length} items but maxItems is ${definition.maxItems}`, "BATCH_ITEMS_EXCEEDED", { actual: raw.length, maximum: definition.maxItems });
  const ids = new Set();
  return raw.map((candidate, index) => {
    const item = assertPlainJson(candidate, `BatchSwarm item ${index}`);
    assertNoHeterogeneousOverride(item, index);
    const id = itemId(item, index);
    if (ids.has(id)) fail(`duplicate batch item id: ${id}`, "BATCH_ITEM_ID_DUPLICATE", { itemId: id });
    ids.add(id);
    return immutable({ index, itemId: id, item, itemDigest: digest(item) });
  });
}

function renderPrompt(template, values) {
  const replacements = {
    batchId: values.batchId,
    index: String(values.index),
    item: canonicalJson(values.item),
    itemId: values.itemId,
  };
  const rendered = template.replace(TEMPLATE_TOKEN, (_, token) => replacements[token]);
  if (rendered.length > 131_072) fail("rendered batch prompt exceeds 128 KiB", "BATCH_PROMPT_TOO_LARGE", { index: values.index });
  return rendered;
}

function eventPayload(event) {
  return event?.payload ?? {};
}

function newItemSlot(item) {
  return {
    index: item.index,
    itemId: item.itemId,
    itemDigest: item.itemDigest,
    status: "queued",
    attempts: 0,
    assignmentId: null,
    assignmentHash: null,
    handleId: null,
    receiptId: null,
    authoritative: null,
    result: null,
    error: null,
    usage: null,
  };
}

function eventMatchesPrepared(event, prepared) {
  const payload = eventPayload(event);
  return typeof event?.type === "string"
    && event.type.startsWith("Batch")
    && payload.batchId === prepared.batchId
    && payload.batchDigest === prepared.batchDigest;
}

export function projectBatchSwarmEvents(events, prepared) {
  if (!prepared || !Array.isArray(prepared.items)) fail("prepared batch is required", "BATCH_PREPARATION_INVALID");
  const slots = prepared.items.map(newItemSlot);
  let status = slots.length === 0 ? "completed" : "running";
  const capacityChanges = [];
  for (const event of events ?? []) {
    if (!eventMatchesPrepared(event, prepared)) continue;
    const payload = eventPayload(event);
    if (event.type === "BatchSettled") {
      status = payload.status;
      continue;
    }
    if (event.type === "BatchStarted") continue;
    if (event.type === "BatchCapacityChanged") {
      capacityChanges.push(clone(payload));
      continue;
    }
    if (!Number.isSafeInteger(payload.index) || payload.index < 0 || payload.index >= slots.length) fail("batch event index is invalid", "BATCH_EVENT_CORRELATION_MISMATCH");
    const slot = slots[payload.index];
    if (slot.itemId !== payload.itemId || slot.itemDigest !== payload.itemDigest) fail("batch event item identity drifted", "BATCH_EVENT_CORRELATION_MISMATCH");
    if (event.type === "BatchItemQueued") {
      slot.status = "queued";
      slot.attempts = Math.max(slot.attempts, payload.itemAttempt ?? 0);
    } else if (event.type === "BatchItemStarted") {
      slot.status = "running";
      slot.attempts = Math.max(slot.attempts, payload.itemAttempt ?? 0);
      slot.assignmentId = payload.assignmentId;
      slot.assignmentHash = payload.assignmentHash;
      slot.handleId = payload.handleId ?? null;
    } else if (event.type === "BatchItemTerminal") {
      if (!ITEM_TERMINAL_STATUSES.has(payload.status)) fail("batch event terminal status is invalid", "BATCH_EVENT_CORRELATION_MISMATCH");
      slot.status = payload.status;
      slot.attempts = Math.max(slot.attempts, payload.itemAttempt ?? 0);
      slot.assignmentId = payload.assignmentId ?? slot.assignmentId;
      slot.assignmentHash = payload.assignmentHash ?? slot.assignmentHash;
      slot.handleId = payload.handleId ?? slot.handleId;
      slot.receiptId = payload.receiptId ?? null;
      slot.authoritative = payload.authoritative === true;
      slot.result = clone(payload.result ?? null);
      slot.error = clone(payload.error ?? null);
      slot.usage = clone(payload.usage ?? null);
    }
  }
  return immutable({ status, items: slots, capacityChanges });
}

function boundedValue(value, maximumBytes) {
  let bytes = 0;
  let nodes = 0;
  let failed = false;
  const seen = new WeakSet();
  const stack = [{ value, depth: 0 }];
  while (stack.length > 0 && !failed) {
    const current = stack.pop();
    const candidate = current.value;
    nodes += 1;
    if (nodes > 4096 || current.depth > 32) { failed = true; break; }
    if (candidate === null) { bytes += 4; continue; }
    if (typeof candidate === "string") {
      const raw = Buffer.byteLength(candidate, "utf8");
      if (raw > maximumBytes - bytes) { failed = true; bytes = maximumBytes + 1; break; }
      bytes += Buffer.byteLength(JSON.stringify(candidate), "utf8");
      continue;
    }
    if (["number", "boolean"].includes(typeof candidate)) {
      const encoded = JSON.stringify(candidate);
      if (encoded === undefined) { failed = true; break; }
      bytes += Buffer.byteLength(encoded, "utf8");
      continue;
    }
    if ((!object(candidate) && !Array.isArray(candidate)) || seen.has(candidate)) { failed = true; break; }
    seen.add(candidate);
    const entries = Array.isArray(candidate)
      ? candidate.map((child, index) => [String(index), child])
      : Object.entries(candidate);
    bytes += 2 + Math.max(0, entries.length - 1);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (!Array.isArray(candidate)) bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
      stack.push({ value: child, depth: current.depth + 1 });
    }
    if (bytes > maximumBytes) failed = true;
  }
  if (failed || bytes > maximumBytes) {
    return immutable({
      projection: { truncated: true, code: "OUTPUT_LIMIT_EXCEEDED", observedBytes: Math.max(bytes, maximumBytes + 1) },
      bytes: Math.max(bytes, maximumBytes + 1),
      digest: digest({ code: "OUTPUT_LIMIT_EXCEEDED", bytes: Math.max(bytes, maximumBytes + 1), nodes }),
      truncated: true,
    });
  }
  const projection = assertPlainJson(value, "batch item result");
  return immutable({ projection, bytes, digest: digest(projection), truncated: false });
}

function normalizeUsage(value) {
  const usage = object(value) ? value : {};
  const read = (field, fallback = 0) => {
    const result = usage[field] ?? fallback;
    return typeof result === "number" && Number.isFinite(result) && result >= 0 ? result : 0;
  };
  return immutable({
    elapsedMs: Math.trunc(read("elapsedMs")),
    rawOutputBytes: Math.trunc(read("rawOutputBytes")),
    tokens: Math.trunc(read("tokens")),
    costUsd: read("costUsd", read("cost")),
  });
}

function normalizeItemTerminal(value, maximumBytes) {
  const terminal = value?.terminal ?? value?.receipt ?? value ?? {};
  const outcome = terminal.outcome ?? "failed";
  const allowed = new Set(["completed", "failed", "cancelled", "interrupted", "orphaned", "timed-out", "budget-exhausted", "unavailable"]);
  const normalizedOutcome = allowed.has(outcome) ? outcome : "failed";
  const result = boundedValue(terminal.result ?? terminal.data ?? null, maximumBytes);
  const error = boundedValue(terminal.error ?? null, Math.min(4096, maximumBytes));
  const reportedUsage = normalizeUsage(terminal.usage ?? value?.usage);
  const usage = immutable({ ...reportedUsage, rawOutputBytes: result.bytes });
  const handleId = value?.handle?.handleId ?? terminal?.handle?.handleId ?? null;
  return immutable({
    outcome: normalizedOutcome,
    authoritative: terminal.authoritative === true,
    receiptId: typeof terminal.receiptId === "string" && SHA256.test(terminal.receiptId)
      ? terminal.receiptId
      : digest({ outcome: normalizedOutcome, authoritative: terminal.authoritative === true, resultDigest: result.digest, errorDigest: error.digest }),
    result: result.projection,
    resultBytes: result.bytes,
    resultTruncated: result.truncated,
    error: error.projection,
    usage,
    handleId: typeof handleId === "string" ? handleId.slice(0, 512) : null,
    retryable: terminal.error?.retryable === true || RETRYABLE_CODES.has(String(terminal.error?.code ?? "")),
    rateLimited: ["429", "RATE_LIMITED"].includes(String(terminal.error?.code ?? "")),
    retryAfterMs: Number.isSafeInteger(terminal.error?.retryAfterMs) && terminal.error.retryAfterMs >= 0
      ? terminal.error.retryAfterMs
      : 0,
  });
}

function summarizePriorUsage(events, prepared, maximumItemOutputBytes) {
  const eventIds = new Set();
  const startedAssignments = new Set();
  let elapsedFromTerminals = 0;
  let elapsedFromSettlement = 0;
  let rawOutputBytes = 0;
  let tokens = 0;
  let costUsd = 0;
  for (const event of events ?? []) {
    if (!eventMatchesPrepared(event, prepared) || eventIds.has(event.eventId)) continue;
    eventIds.add(event.eventId);
    const payload = eventPayload(event);
    if (event.type === "BatchItemStarted") {
      startedAssignments.add(`${payload.itemId}:${payload.itemAttempt}`);
      continue;
    }
    if (event.type === "BatchItemTerminal") {
      const usage = normalizeUsage(payload.usage);
      elapsedFromTerminals += usage.elapsedMs;
      rawOutputBytes += usage.rawOutputBytes > 0
        ? usage.rawOutputBytes
        : boundedValue(payload.result ?? null, maximumItemOutputBytes).bytes;
      tokens += usage.tokens;
      costUsd += usage.costUsd;
      continue;
    }
    if (event.type === "BatchSettled") {
      elapsedFromSettlement = Math.max(elapsedFromSettlement, normalizeUsage(payload.usage).elapsedMs);
    }
  }
  return immutable({
    assignments: startedAssignments.size,
    elapsedMs: elapsedFromSettlement > 0 ? elapsedFromSettlement : elapsedFromTerminals,
    rawOutputBytes,
    tokens,
    costUsd,
  });
}

function itemStatus(terminal) {
  if (terminal.outcome === "completed") return "succeeded";
  if (terminal.outcome === "cancelled") return "cancelled";
  if (terminal.outcome === "budget-exhausted") return "budget-exhausted";
  return "failed";
}

function aggregateOutcome(definition, slots, aborted) {
  const succeeded = slots.filter((slot) => slot.status === "succeeded").length;
  const failed = slots.filter((slot) => ["failed", "budget-exhausted"].includes(slot.status)).length;
  const cancelled = slots.filter((slot) => slot.status === "cancelled").length;
  if (aborted || cancelled > 0) return "cancelled";
  if (definition.failurePolicy.kind === "continue") return "completed";
  if (["quorum", "minimum-success"].includes(definition.failurePolicy.kind)) {
    return succeeded >= definition.failurePolicy.threshold ? "completed" : "failed";
  }
  return failed === 0 && succeeded === slots.length ? "completed" : "failed";
}

function aggregateStatus(outcome, slots) {
  if (outcome === "cancelled") return "cancelled";
  if (outcome !== "completed") return "failed";
  return slots.some((slot) => slot.status !== "succeeded") ? "partial" : "completed";
}

function sleep(scheduler, milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      if (timer !== undefined) scheduler.clearTimeout(timer);
      signal?.removeEventListener?.("abort", done);
      resolve();
    };
    timer = scheduler.setTimeout(done, milliseconds);
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new BatchSwarmError("batch item execution aborted", "BATCH_ITEM_ABORTED");
}

async function awaitAbortable(operation, signal) {
  const pending = Promise.resolve(operation);
  // A backend that ignores AbortSignal may settle after the BatchSwarm has
  // already closed admission. Observe that late rejection without waiting for
  // it, and never treat it as terminal proof for the cancelled item.
  pending.catch(() => {});
  if (!signal) return pending;
  if (signal.aborted) throw abortReason(signal);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function batchEvent(type, prepared, slot, values = {}) {
  const itemAttempt = slot === null ? null : (values.itemAttempt ?? slot.attempts);
  const suffix = slot === null ? "batch" : `${slot.itemId}:${itemAttempt}`;
  const rawEventId = `${type.replace(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase()}:${prepared.batchId}:${prepared.executionAttemptId}:${suffix}`;
  const eventId = rawEventId.length <= 191 && /^[a-z0-9][a-z0-9._:-]{0,190}$/u.test(rawEventId)
    ? rawEventId
    : `batch-event:${digest(rawEventId).slice(7)}`;
  return immutable({
    eventId,
    type,
    swarmRunId: prepared.batchRunId,
    childId: values.childId ?? null,
    payload: {
      batchId: prepared.batchId,
      batchDigest: prepared.batchDigest,
      ...(slot === null ? {} : {
        index: slot.index,
        itemId: slot.itemId,
        itemDigest: slot.itemDigest,
        itemAttempt,
      }),
      ...(values.payload ?? {}),
    },
  });
}

function assignmentId(prepared, slot, itemAttempt) {
  const raw = `${prepared.batchId}:${slot.itemId}:a${itemAttempt}`;
  return ID.test(raw) ? raw : `batch-assignment:${digest(raw).slice(7, 39)}`;
}

function normalizeScheduler(input) {
  const scheduler = input ?? {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  };
  if (typeof scheduler.setTimeout !== "function" || typeof scheduler.clearTimeout !== "function") throw new TypeError("BatchSwarm scheduler requires setTimeout and clearTimeout");
  return scheduler;
}

export class BatchSwarmNodeExecutor {
  constructor(options = {}) {
    for (const method of ["resolveBatch", "resolveAgentSpec", "resolvePromptTemplate", "executeItem"]) {
      if (typeof options[method] !== "function") throw new TypeError(`BatchSwarm requires ${method}()`);
    }
    this.resolveBatch = options.resolveBatch;
    this.resolveAgentSpec = options.resolveAgentSpec;
    this.resolvePromptTemplate = options.resolvePromptTemplate;
    this.resolveItems = options.resolveItems ?? defaultResolveItems;
    this.executeItem = options.executeItem;
    this.capabilityMatrix = options.capabilityMatrix ?? null;
    this.scheduler = normalizeScheduler(options.scheduler);
    this.clock = options.clock ?? (() => Date.now());
    this.maximumItemOutputBytes = options.maximumItemOutputBytes ?? 8192;
    if (!Number.isSafeInteger(this.maximumItemOutputBytes) || this.maximumItemOutputBytes < 256 || this.maximumItemOutputBytes > 65_536) throw new TypeError("maximumItemOutputBytes must be between 256 and 65536");
  }

  async prepareBatch(node, context = {}) {
    if (node?.kind !== "batch-swarm") fail("prepareBatch requires a batch-swarm node", "BATCH_NODE_INVALID");
    const definition = assertBatchSwarmDefinition(await this.resolveBatch(node.batchRef, context));
    const batchDigest = digestBatchSwarmDefinition(definition);
    if (node.batchDigest !== undefined && node.batchDigest !== batchDigest) fail("WorkflowPlan batch digest differs from the resolved definition", "BATCH_PLAN_DRIFT");
    if (node.batchMaxItems !== undefined && node.batchMaxItems !== definition.maxItems) fail("WorkflowPlan batch item ceiling differs from the definition", "BATCH_PLAN_DRIFT");
    if (node.batchMaxAttempts !== undefined && node.batchMaxAttempts !== definition.retryPolicy.maxAttempts) fail("WorkflowPlan batch retry ceiling differs from the definition", "BATCH_PLAN_DRIFT");
    const capabilityMatrix = typeof this.capabilityMatrix === "function"
      ? await this.capabilityMatrix(context)
      : this.capabilityMatrix;
    assertCapabilityEnvelope(definition, capabilityMatrix);
    const agentSpec = immutable(clone(await this.resolveAgentSpec(definition.agentSpecRef, context)));
    assertAgentBinding(definition, agentSpec);
    const promptTemplate = await this.resolvePromptTemplate(definition.promptTemplateRef, context);
    assertTemplateBinding(definition, promptTemplate);
    const rawItems = await this.resolveItems(definition, context.input ?? {}, context);
    const items = normalizeItems(definition, rawItems);
    const prior = projectBatchSwarmEvents(context.priorBatchEvents ?? [], {
      batchId: definition.id,
      batchDigest,
      items,
    });
    const priorUsage = summarizePriorUsage(context.priorBatchEvents ?? [], {
      batchId: definition.id,
      batchDigest,
    }, this.maximumItemOutputBytes);
    const remaining = prior.items.filter((slot) => slot.status !== "succeeded");
    const remainingAttempts = remaining.reduce((sum, slot) => sum + Math.max(0, definition.retryPolicy.maxAttempts - slot.attempts), 0);
    const rawBatchRunId = `${context.runId ?? "batch-run"}:${node.id}`;
    const batchRunId = ID.test(rawBatchRunId) ? rawBatchRunId : `batch:${digest(rawBatchRunId).slice(7, 39)}`;
    const executionAttemptId = canonicalId(context.attemptId ?? "batch-attempt", "batch execution attemptId");
    return immutable({
      formatVersion: 1,
      kind: "prepared-batch-swarm",
      batchId: definition.id,
      batchRunId,
      executionAttemptId,
      batchDigest,
      definition,
      agentSpec,
      agentSpecHash: agentSpec.specHash,
      policyHash: agentSpec.effectivePolicyHash,
      promptTemplate,
      promptTemplateHash: digest(promptTemplate),
      items,
      itemCount: items.length,
      degradedToAgent: items.length === 1,
      reservation: {
        assignments: remainingAttempts,
        elapsedMs: node.budget?.timeoutMs ?? definition.retryPolicy.deadlineMs,
        rawOutputBytes: node.budget?.maxOutputBytes ?? 1_048_576,
        ...(node.budget?.maxTokens === null || node.budget?.maxTokens === undefined ? {} : { tokens: node.budget.maxTokens }),
        ...(node.budget?.maxCostUsd === null || node.budget?.maxCostUsd === undefined ? {} : { cost: node.budget.maxCostUsd }),
      },
      prior,
      priorUsage,
      preparationDigest: digest({ batchDigest, agentSpecHash: agentSpec.specHash, promptTemplateHash: digest(promptTemplate), items: items.map(({ index, itemId, itemDigest }) => ({ index, itemId, itemDigest })) }),
    });
  }

  async runBatch(node, context = {}) {
    const prepared = context.prepared ?? await this.prepareBatch(node, context);
    const emit = typeof context.recordBatchEvent === "function" ? context.recordBatchEvent : async () => {};
    const slots = prepared.prior.items.map((slot) => clone(slot));
    const definition = prepared.definition;
    const startedAt = Number(this.clock());
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(context.signal?.reason);
    if (context.signal?.aborted) forwardAbort();
    else context.signal?.addEventListener?.("abort", forwardAbort, { once: true });
    let deadlineTimer;
    let deadlineExceeded = false;
    deadlineTimer = this.scheduler.setTimeout(() => {
      deadlineExceeded = true;
      controller.abort(new BatchSwarmError("batch deadline exceeded", "BATCH_DEADLINE_EXCEEDED"));
    }, definition.retryPolicy.deadlineMs);
    const batchStarted = batchEvent("BatchStarted", prepared, null, { payload: { itemCount: slots.length, preparationDigest: prepared.preparationDigest } });
    try {
      await emit(batchStarted);
    } catch (cause) {
      this.scheduler.clearTimeout(deadlineTimer);
      context.signal?.removeEventListener?.("abort", forwardAbort);
      throw new BatchSwarmError("failed to persist BatchStarted before dispatch", "BATCH_EVENT_APPEND_FAILED", { cause });
    }

    if (slots.length === 0) {
      this.scheduler.clearTimeout(deadlineTimer);
      context.signal?.removeEventListener?.("abort", forwardAbort);
      const result = immutable({
        formatVersion: 1,
        kind: "batch-swarm-result",
        batchId: prepared.batchId,
        batchDigest: prepared.batchDigest,
        agentSpecHash: prepared.agentSpecHash,
        policyHash: prepared.policyHash,
        promptTemplateHash: prepared.promptTemplateHash,
        inputDigest: context.inputDigest ?? digest(context.input ?? {}),
        status: "completed",
        degradedToAgent: false,
        total: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
        budgetExhausted: 0,
        attempts: 0,
        maximumActive: 0,
        items: [],
      });
      await emit(batchEvent("BatchSettled", prepared, null, { payload: { status: result.status, resultDigest: digest(result) } }));
      return immutable({ outcome: "completed", authoritative: true, receiptId: digest(result), result, usage: { assignments: 0, elapsedMs: 0, rawOutputBytes: 0, tokens: 0, costUsd: 0 }, handle: { handleId: prepared.batchRunId } });
    }

    let active = 0;
    let maximumActive = 0;
    let capacity = Math.min(definition.concurrency.initial, slots.length);
    let nextIndex = 0;
    let admissionClosed = controller.signal.aborted;
    let rampTimer;
    let completionResolve;
    let completionReject;
    let completed = 0;
    let totalAttempts = slots.reduce((sum, slot) => sum + slot.attempts, 0);
    let executionAttempts = 0;
    const executionUsage = { rawOutputBytes: 0, tokens: 0, costUsd: 0 };
    let fatalError = null;
    const done = new Promise((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });

    const markQueuedWithoutEvents = (status = "cancelled") => {
      for (const slot of slots) {
        if (slot.status !== "queued") continue;
        slot.status = status;
        slot.authoritative = false;
        slot.error = { code: "BATCH_EVENT_APPEND_FAILED" };
        completed += 1;
      }
    };

    const failRun = (cause) => {
      if (fatalError === null) {
        fatalError = cause instanceof BatchSwarmError
          ? cause
          : new BatchSwarmError("failed to persist a batch event", "BATCH_EVENT_APPEND_FAILED", { cause });
        admissionClosed = true;
        controller.abort(fatalError);
        markQueuedWithoutEvents();
      }
      if (active === 0) completionReject(fatalError);
    };

    const closeQueued = async (status) => {
      for (const slot of slots) {
        if (slot.status !== "queued") continue;
        slot.status = status;
        completed += 1;
        await emit(batchEvent("BatchItemTerminal", prepared, slot, {
          payload: { status, authoritative: true, receiptId: null, result: null, error: { code: status === "skipped" ? "FAIL_FAST_ADMISSION_CLOSED" : "BATCH_CANCELLED_BEFORE_ADMISSION" }, usage: { elapsedMs: 0, tokens: 0, costUsd: 0 } },
        }));
      }
    };

    const maybeComplete = () => {
      if (fatalError !== null && active === 0) completionReject(fatalError);
      else if (completed >= slots.length && active === 0) completionResolve();
    };

    const scheduleRamp = () => {
      if (rampTimer !== undefined || admissionClosed || capacity >= definition.concurrency.max || nextIndex >= slots.length) return;
      rampTimer = this.scheduler.setTimeout(() => {
        rampTimer = undefined;
        if (!admissionClosed) capacity = Math.min(definition.concurrency.max, capacity + 1, slots.length);
        pump();
        scheduleRamp();
      }, definition.concurrency.rampEveryMs);
    };

    const applyRateLimit = async (slot, itemAttempt) => {
      if (!definition.concurrency.adaptiveRateLimit) return;
      const previous = capacity;
      capacity = Math.max(1, Math.floor(capacity / 2));
      if (rampTimer !== undefined) {
        this.scheduler.clearTimeout(rampTimer);
        rampTimer = undefined;
      }
      if (capacity !== previous) {
        await emit(batchEvent("BatchCapacityChanged", prepared, slot, {
          itemAttempt,
          payload: { previous, current: capacity, reason: "rate-limit" },
        }));
      }
      scheduleRamp();
    };

    const runSlot = async (slot) => {
      try {
        while (!controller.signal.aborted && slot.attempts < definition.retryPolicy.maxAttempts) {
          slot.attempts += 1;
          totalAttempts += 1;
          executionAttempts += 1;
          const itemAttempt = slot.attempts;
          const prompt = renderPrompt(prepared.promptTemplate, { batchId: prepared.batchId, index: slot.index, itemId: slot.itemId, item: prepared.items[slot.index].item });
          const assignment = createTaskAssignment({
            assignmentId: assignmentId(prepared, slot, itemAttempt),
            agentSpec: prepared.agentSpec,
            task: prompt,
            ownership: { writer: false, workspace: prepared.agentSpec.effectivePolicy.workspace, allowedPaths: [] },
            idempotency: { class: "read-only" },
            context: { mode: "fresh", artifactRefs: [definition.itemsFrom] },
            budget: {
              maxElapsedMs: Math.min(prepared.agentSpec.timeoutMs, definition.retryPolicy.deadlineMs),
              maxOutputBytes: this.maximumItemOutputBytes,
            },
          });
          slot.assignmentId = assignment.assignmentId;
          slot.assignmentHash = assignment.assignmentHash;
          slot.status = "running";
          await emit(batchEvent("BatchItemStarted", prepared, slot, {
            itemAttempt,
            payload: { assignmentId: assignment.assignmentId, assignmentHash: assignment.assignmentHash, handleId: null },
          }));
          let terminal;
          try {
            terminal = normalizeItemTerminal(await awaitAbortable(Promise.resolve().then(() => this.executeItem({
              runId: context.runId,
              nodeId: node.id,
              batchRunId: prepared.batchRunId,
              batchId: prepared.batchId,
              batchDigest: prepared.batchDigest,
              index: slot.index,
              itemId: slot.itemId,
              item: prepared.items[slot.index].item,
              itemDigest: slot.itemDigest,
              itemAttempt,
              agentSpec: prepared.agentSpec,
              assignment,
              prompt,
              signal: controller.signal,
              authorization: context.authorization ?? null,
              renewLease: context.renewLease,
            })), controller.signal), this.maximumItemOutputBytes);
          } catch (cause) {
            terminal = normalizeItemTerminal({
              outcome: controller.signal.aborted ? "cancelled" : "failed",
              authoritative: false,
              error: { code: cause?.code ?? "BATCH_ITEM_EXECUTION_ERROR", retryable: cause?.retryable === true },
            }, this.maximumItemOutputBytes);
          }
          const status = itemStatus(terminal);
          slot.status = status;
          slot.handleId = terminal.handleId;
          slot.receiptId = terminal.receiptId;
          slot.authoritative = terminal.authoritative;
          slot.result = terminal.result;
          slot.error = terminal.error;
          slot.usage = terminal.usage;
          executionUsage.rawOutputBytes += terminal.usage.rawOutputBytes;
          executionUsage.tokens += terminal.usage.tokens;
          executionUsage.costUsd += terminal.usage.costUsd;
          await emit(batchEvent("BatchItemTerminal", prepared, slot, {
            itemAttempt,
            childId: terminal.handleId,
            payload: {
              status,
              assignmentId: assignment.assignmentId,
              assignmentHash: assignment.assignmentHash,
              handleId: terminal.handleId,
              receiptId: terminal.receiptId,
              authoritative: terminal.authoritative,
              result: terminal.result,
              error: terminal.error,
              usage: terminal.usage,
            },
          }));
          if (status === "succeeded"
            || status === "cancelled"
            || status === "budget-exhausted"
            || terminal.authoritative !== true
            || !terminal.retryable
            || slot.attempts >= definition.retryPolicy.maxAttempts) break;
          if (terminal.rateLimited) await applyRateLimit(slot, itemAttempt);
          slot.status = "queued";
          await emit(batchEvent("BatchItemQueued", prepared, slot, { itemAttempt: slot.attempts, payload: { reason: "finite-retry" } }));
          const exponential = Math.min(definition.retryPolicy.maxDelayMs, 250 * (2 ** Math.max(0, itemAttempt - 1)));
          await sleep(this.scheduler, Math.min(definition.retryPolicy.maxDelayMs, Math.max(exponential, terminal.retryAfterMs)), controller.signal);
        }
        if (controller.signal.aborted && fatalError === null && !ITEM_TERMINAL_STATUSES.has(slot.status)) {
          slot.status = "cancelled";
          await emit(batchEvent("BatchItemTerminal", prepared, slot, { payload: { status: "cancelled", authoritative: false, receiptId: null, result: null, error: { code: deadlineExceeded ? "BATCH_DEADLINE_EXCEEDED" : "BATCH_CANCELLED" }, usage: { elapsedMs: 0, tokens: 0, costUsd: 0 } } }));
        }
        if (definition.failurePolicy.kind === "fail-fast" && slot.status !== "succeeded") admissionClosed = true;
      } finally {
        active -= 1;
        completed += 1;
      }
      if (admissionClosed) await closeQueued(controller.signal.aborted ? "cancelled" : "skipped");
      pump();
      maybeComplete();
    };

    const pump = () => {
      if (controller.signal.aborted) admissionClosed = true;
      while (!admissionClosed && active < capacity && nextIndex < slots.length) {
        const slot = slots[nextIndex];
        nextIndex += 1;
        if (slot.status === "succeeded") {
          completed += 1;
          continue;
        }
        // Reserve the logical slot synchronously before the first async event
        // append. Otherwise a fast pump can admit the whole queue while every
        // starter is still waiting on its queued receipt.
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        void emit(batchEvent("BatchItemQueued", prepared, slot, { payload: { reason: slot.attempts > 0 ? "resume" : "initial" } }))
          .then(() => runSlot(slot).catch(failRun))
          .catch((cause) => {
            active -= 1;
            completed += 1;
            slot.status = "failed";
            slot.authoritative = false;
            slot.error = { code: "BATCH_EVENT_APPEND_FAILED" };
            failRun(cause);
            maybeComplete();
          });
      }
      if (admissionClosed && fatalError === null) {
        void closeQueued(controller.signal.aborted ? "cancelled" : "skipped")
          .then(maybeComplete)
          .catch(failRun);
      }
      scheduleRamp();
      maybeComplete();
    };

    const abortAdmission = () => {
      admissionClosed = true;
      if (fatalError !== null) {
        markQueuedWithoutEvents();
        maybeComplete();
      } else {
        void closeQueued("cancelled").then(maybeComplete).catch(failRun);
      }
    };
    controller.signal.addEventListener("abort", abortAdmission, { once: true });
    try {
      pump();
      await done;
    } finally {
      if (rampTimer !== undefined) this.scheduler.clearTimeout(rampTimer);
      this.scheduler.clearTimeout(deadlineTimer);
      controller.signal.removeEventListener("abort", abortAdmission);
      context.signal?.removeEventListener?.("abort", forwardAbort);
    }

    const outcome = aggregateOutcome(definition, slots, controller.signal.aborted);
    const result = immutable({
      formatVersion: 1,
      kind: "batch-swarm-result",
      batchId: prepared.batchId,
      batchDigest: prepared.batchDigest,
      agentSpecHash: prepared.agentSpecHash,
      policyHash: prepared.policyHash,
      promptTemplateHash: prepared.promptTemplateHash,
      inputDigest: context.inputDigest ?? digest(context.input ?? {}),
      status: aggregateStatus(outcome, slots),
      degradedToAgent: prepared.degradedToAgent,
      total: slots.length,
      succeeded: slots.filter((slot) => slot.status === "succeeded").length,
      failed: slots.filter((slot) => slot.status === "failed").length,
      cancelled: slots.filter((slot) => slot.status === "cancelled").length,
      skipped: slots.filter((slot) => slot.status === "skipped").length,
      budgetExhausted: slots.filter((slot) => slot.status === "budget-exhausted").length,
      attempts: totalAttempts,
      maximumActive,
      items: slots.map((slot) => immutable(clone(slot))),
    });
    const settledAt = Number(this.clock());
    const usage = immutable({
      assignments: prepared.priorUsage.assignments + executionAttempts,
      elapsedMs: prepared.priorUsage.elapsedMs + Math.max(0, Math.trunc(settledAt - startedAt)),
      rawOutputBytes: prepared.priorUsage.rawOutputBytes + executionUsage.rawOutputBytes,
      tokens: prepared.priorUsage.tokens + executionUsage.tokens,
      costUsd: prepared.priorUsage.costUsd + executionUsage.costUsd,
    });
    const authoritative = slots.every((slot) => ["skipped"].includes(slot.status) || slot.authoritative === true);
    const receiptId = digest({ batchDigest: prepared.batchDigest, inputDigest: result.inputDigest, status: result.status, items: result.items.map((slot) => ({ itemId: slot.itemId, receiptId: slot.receiptId, status: slot.status })) });
    await emit(batchEvent("BatchSettled", prepared, null, { payload: { status: result.status, outcome, authoritative, receiptId, resultDigest: digest(result), usage } }));
    return immutable({
      outcome: deadlineExceeded ? "timed-out" : outcome,
      authoritative: deadlineExceeded ? false : authoritative,
      receiptId,
      result,
      usage,
      error: outcome === "completed" ? null : { code: deadlineExceeded ? "BATCH_DEADLINE_EXCEEDED" : outcome === "cancelled" ? "BATCH_CANCELLED" : "BATCH_FAILURE_POLICY_UNSATISFIED" },
      handle: { handleId: prepared.batchRunId },
    });
  }
}

export function createBatchSwarmNodeExecutor(options = {}) {
  return new BatchSwarmNodeExecutor(options);
}

export const BATCH_SWARM_MAX_LOGICAL_ITEMS = 300;
export const BATCH_SWARM_MAX_PHYSICAL_ASSIGNMENTS = MAX_PHYSICAL_ASSIGNMENTS;
export const BATCH_SWARM_ITEM_STATUSES = Object.freeze([
  "queued", "running", "succeeded", "failed", "cancelled", "skipped", "budget-exhausted",
]);
