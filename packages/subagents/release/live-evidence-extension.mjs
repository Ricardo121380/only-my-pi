import fs from "node:fs";
import path from "node:path";

import {
  PiSubagentsRpcV1Backend,
  PI_SUBAGENTS_RPC_V1_EVENTS,
} from "../adapters/pi-subagents-rpc-v1/index.mjs";
import {
  createAgentRunHandle,
  createTaskAssignment,
  digestValue,
} from "../domain/index.mjs";
import { digestBatchSwarmDefinition } from "../batch-swarm/index.mjs";
import { createPiBatchSwarmRuntime } from "../batch-swarm/runtime.mjs";
import {
  createProtectedLiveCaptureRecord,
  SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE,
} from "./live-evidence-capture.mjs";

export const SUBAGENTS_LIVE_CAPTURE_ERROR_TYPE = "omp_subagents_protected_capture_error_v1";
export const SUBAGENTS_LIVE_CAPTURE_REQUEST_ENV = "OMP_SUBAGENTS_LIVE_CAPTURE_REQUEST";

const REQUEST_KEYS = Object.freeze([
  "authorizationDigest",
  "compatibilityRowId",
  "environment",
  "id",
  "limits",
  "matrixDigest",
  "policyDigest",
  "repositoryRoot",
  "sourceCommit",
  "trustPolicyDigest",
]);
const MAX_REQUEST_BYTES = 64 * 1024;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function readRequest() {
  const requestFile = process.env[SUBAGENTS_LIVE_CAPTURE_REQUEST_ENV];
  const agentRoot = process.env.PI_CODING_AGENT_DIR;
  if (typeof requestFile !== "string" || !path.isAbsolute(requestFile)
    || typeof agentRoot !== "string" || !path.isAbsolute(agentRoot)) {
    throw Object.assign(new Error("capture request path unavailable"), { code: "CAPTURE_REQUEST_UNAVAILABLE" });
  }
  const root = fs.realpathSync(agentRoot);
  const stat = fs.lstatSync(requestFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error("capture request path invalid"), { code: "CAPTURE_REQUEST_INVALID" });
  }
  const target = fs.realpathSync(requestFile);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error("capture request escaped agent root"), { code: "CAPTURE_REQUEST_INVALID" });
  }
  const request = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!exactKeys(request, REQUEST_KEYS)
    || !path.isAbsolute(request.repositoryRoot)
    || !object(request.environment)
    || !object(request.limits)) {
    throw Object.assign(new Error("capture request shape invalid"), { code: "CAPTURE_REQUEST_INVALID" });
  }
  const repositoryRoot = fs.realpathSync(request.repositoryRoot);
  const rootStat = fs.lstatSync(repositoryRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw Object.assign(new Error("repository root invalid"), { code: "CAPTURE_REPOSITORY_INVALID" });
  }
  if (request.environment.node !== process.versions.node
    || request.environment.platform !== `${process.platform}-${process.arch}`) {
    throw Object.assign(new Error("runtime environment drift"), { code: "CAPTURE_ENVIRONMENT_DRIFT" });
  }
  return Object.freeze({ ...request, repositoryRoot });
}

export function createPiEventTransport(pi, { timeoutMs }) {
  const subscriptions = new Set();
  return {
    request(envelope) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const replyEvent = `${PI_SUBAGENTS_RPC_V1_EVENTS.replyPrefix}${envelope.requestId}`;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe?.();
          callback();
        };
        const unsubscribe = pi.events.on(replyEvent, (reply) => finish(() => resolve(reply)));
        timer = setTimeout(() => finish(() => reject(Object.assign(new Error("RPC reply timeout"), {
          code: "PI_SUBAGENTS_RPC_TIMEOUT",
        }))), timeoutMs);
        timer.unref?.();
        pi.events.emit(PI_SUBAGENTS_RPC_V1_EVENTS.request, envelope);
      });
    },
    subscribe(eventName, handler) {
      const unsubscribe = pi.events.on(eventName, handler);
      subscriptions.add(unsubscribe);
      return () => {
        subscriptions.delete(unsubscribe);
        unsubscribe();
      };
    },
    dispose() {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
    },
  };
}

function taskText(id) {
  if (id === "live-agent-cancel") {
    return "Perform a bounded read-only review of package.json and return the declared JSON output. Do not mutate files.";
  }
  return "Return a bounded read-only review result with verdict pass, no findings, no tests run, and no unverified claims. Do not mutate files.";
}

function boundedResultBytes(value, maximumBytes) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let bytes = 0;
  let nodes = 0;
  const add = (amount) => {
    bytes += amount;
    if (bytes > maximumBytes) throw Object.assign(new Error("terminal result exceeds its output ceiling"), { code: "CAPTURE_OUTPUT_BUDGET_EXCEEDED" });
  };
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > 10_000 || current.depth > 64) {
      throw Object.assign(new Error("terminal result is too complex"), { code: "CAPTURE_OUTPUT_INVALID" });
    }
    const entry = current.value;
    if (entry === null) { add(4); continue; }
    if (typeof entry === "string") {
      if (Buffer.byteLength(entry, "utf8") > maximumBytes) add(maximumBytes + 1);
      add(Buffer.byteLength(JSON.stringify(entry), "utf8"));
      continue;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw Object.assign(new Error("terminal result contains a non-finite number"), { code: "CAPTURE_OUTPUT_INVALID" });
      add(Buffer.byteLength(String(entry), "utf8"));
      continue;
    }
    if (typeof entry === "boolean") { add(entry ? 4 : 5); continue; }
    if (typeof entry !== "object" || seen.has(entry)) {
      throw Object.assign(new Error("terminal result is not bounded JSON"), { code: "CAPTURE_OUTPUT_INVALID" });
    }
    seen.add(entry);
    add(2);
    if (Array.isArray(entry)) {
      for (let index = entry.length - 1; index >= 0; index -= 1) {
        if (index > 0) add(1);
        stack.push({ value: entry[index], depth: current.depth + 1 });
      }
    } else {
      let count = 0;
      for (const key in entry) {
        if (!Object.hasOwn(entry, key)) continue;
        count += 1;
        if (nodes + stack.length + count > 10_000) {
          throw Object.assign(new Error("terminal result has too many fields"), { code: "CAPTURE_OUTPUT_INVALID" });
        }
        if (Buffer.byteLength(key, "utf8") > maximumBytes) add(maximumBytes + 1);
        add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1 + (count > 1 ? 1 : 0));
        stack.push({ value: entry[key], depth: current.depth + 1 });
      }
    }
  }
  return bytes;
}

export function terminalUsage(receipt, maximumOutputBytes) {
  const completion = object(receipt?.completion) ? receipt.completion : {};
  const tokens = completion.totalTokens?.total
    ?? completion.totalCost?.totalTokens
    ?? completion.usage?.total;
  const costUsd = completion.totalCost?.costUsd
    ?? completion.usage?.costUsd
    ?? completion.usage?.cost;
  if (!Number.isFinite(tokens) || tokens < 0 || !Number.isSafeInteger(tokens)
    || !Number.isFinite(costUsd) || costUsd < 0) {
    throw Object.assign(new Error("terminal receipt lacks reliable token or cost metering"), { code: "CAPTURE_USAGE_METERING_UNAVAILABLE" });
  }
  const rawOutputBytes = boundedResultBytes(receipt?.result ?? null, maximumOutputBytes);
  return {
    rawOutputBytes,
    tokens,
    costUsd,
  };
}

function terminalProofs(id, terminal, extra = []) {
  const requirement = {
    "live-agent-terminal": ["process-terminal", "terminal-receipt"],
    "live-agent-cancel": ["cancel-request", "process-terminal", "terminal-receipt"],
  }[id];
  const values = {
    "cancel-request": { intent: "interrupt", terminalOutcome: terminal.outcome },
    "process-terminal": terminal.processTerminal,
    "terminal-receipt": { receiptId: terminal.receiptId, outcome: terminal.outcome, authoritative: terminal.authoritative },
    ...Object.fromEntries(extra.map((entry) => [entry.kind, entry.value])),
  };
  return [...new Set([...requirement, ...extra.map((entry) => entry.kind)])]
    .sort()
    .map((kind) => ({ kind, digest: digestValue(values[kind]) }));
}

function requireMeteredBackend(backend, maximumOutputBytes) {
  return {
    get capabilityMatrix() { return backend.capabilityMatrix; },
    ensureReady(options) { return backend.ensureReady(options); },
    launch(options) { return backend.launch(options); },
    interrupt(handle, options) { return backend.interrupt(handle, options); },
    async awaitTerminal(handle, options) {
      const terminal = await backend.awaitTerminal(handle, options);
      terminalUsage(terminal, maximumOutputBytes);
      return terminal;
    },
  };
}

export async function resolvedReviewer(repositoryRoot, registry) {
  const resolvedRegistry = registry ?? (await import("../batch-swarm/registry.mjs")).createBatchSwarmRegistry({ rootDir: repositoryRoot });
  return {
    registry: resolvedRegistry,
    agentSpec: await resolvedRegistry.resolveAgentSpec("omp-reviewer-resolved"),
  };
}

async function runSingleScenario(request, backend, clock) {
  const { agentSpec } = await resolvedReviewer(request.repositoryRoot);
  const assignment = createTaskAssignment({
    assignmentId: `${request.id}-assignment`,
    agentSpec,
    task: taskText(request.id),
    ownership: { writer: false, workspace: "shared-read-only", allowedPaths: [] },
    idempotency: { class: "read-only" },
    context: { mode: "fresh", artifactRefs: [] },
    budget: {
      maxElapsedMs: request.limits.maxWallTimeMs,
      maxOutputBytes: request.limits.maxOutputBytes,
      maxTokens: request.limits.maxTokens,
      maxCostUsd: request.limits.maxCostUsd,
    },
  });
  const handle = createAgentRunHandle({
    runId: `${request.id}-run`,
    nodeId: `${request.id}-node`,
    attemptId: `${request.id}-attempt`,
    assignment,
    agentSpec,
  });
  const startedAt = clock();
  const launched = await backend.launch({ handle, agentSpec, assignment, mode: "background" });
  const terminal = request.id === "live-agent-cancel"
    ? (await backend.interrupt(launched.handle, { awaitTerminal: true })).terminal
    : await backend.awaitTerminal(launched.handle, { bindingId: launched.binding.bindingId, intent: "run" });
  if (terminal?.authoritative !== true) {
    throw Object.assign(new Error("terminal proof is not authoritative"), { code: "CAPTURE_TERMINAL_UNPROVEN" });
  }
  if (request.id === "live-agent-terminal" && terminal.outcome !== "completed") {
    throw Object.assign(new Error("terminal scenario did not complete"), { code: "CAPTURE_TERMINAL_OUTCOME_INVALID" });
  }
  if (request.id === "live-agent-cancel" && !["cancelled", "interrupted"].includes(terminal.outcome)) {
    throw Object.assign(new Error("cancel scenario did not observe cancellation"), { code: "CAPTURE_CANCEL_OUTCOME_INVALID" });
  }
  const usage = terminalUsage(terminal, request.limits.maxOutputBytes);
  return {
    claims: {
      authoritativeTerminals: 1,
      batchItemCount: 0,
      cancelObserved: request.id === "live-agent-cancel",
      backgroundResume: false,
      managedWorktree: false,
      parentDiffVerified: false,
      autoIntegrated: false,
    },
    proofs: terminalProofs(request.id, terminal, [{ kind: "usage-metering", value: usage }]),
    usage: {
      children: 1,
      concurrency: 1,
      elapsedMs: Math.max(0, clock() - startedAt),
      ...usage,
    },
  };
}

async function runBatchScenario(request, backend, clock) {
  const meteredBackend = requireMeteredBackend(backend, request.limits.maxOutputBytes);
  const runtime = createPiBatchSwarmRuntime({
    backend: meteredBackend,
    rootDir: request.repositoryRoot,
    resolveItems: async () => [
      { itemId: "alpha-one", scope: ["package.json"], objective: "read-only contract review" },
      { itemId: "alpha-two", scope: ["README.md"], objective: "read-only contract review" },
    ],
    maximumItemOutputBytes: Math.min(65_536, request.limits.maxOutputBytes),
  });
  const definition = (await runtime.registry.resolve("review-items")).definition;
  const node = {
    id: "live-batch-node",
    kind: "batch-swarm",
    batchRef: definition.id,
    batchDigest: digestBatchSwarmDefinition(definition),
    batchMaxItems: definition.maxItems,
    batchMaxAttempts: definition.retryPolicy.maxAttempts,
    budget: {
      maxAttempts: 1,
      timeoutMs: request.limits.maxWallTimeMs,
      maxOutputBytes: request.limits.maxOutputBytes,
      maxTokens: request.limits.maxTokens,
      maxCostUsd: request.limits.maxCostUsd,
    },
  };
  const events = [];
  const startedAt = clock();
  const result = await runtime.nodeExecutor.runBatch(node, {
    runId: "live-batch-terminal-run",
    attemptId: "live-batch-terminal-attempt",
    input: { artifacts: { items: [] } },
    inputDigest: digestValue({ evidence: "live-batch-terminal", items: 2 }),
    recordBatchEvent: async (event) => { events.push(event); },
  });
  if (result.authoritative !== true
    || result.outcome !== "completed"
    || result.result.total < 2
    || result.result.succeeded !== result.result.total) {
    throw Object.assign(new Error("batch terminal set is incomplete"), { code: "CAPTURE_BATCH_TERMINAL_UNPROVEN" });
  }
  const terminalEvents = events.filter((event) => event.type === "BatchItemTerminal");
  const terminalProjection = terminalEvents.map((event) => ({
    index: event.payload.index,
    itemId: event.payload.itemId,
    receiptId: event.payload.receiptId,
    authoritative: event.payload.authoritative,
    status: event.payload.status,
  }));
  return {
    claims: {
      authoritativeTerminals: terminalProjection.filter((entry) => entry.authoritative === true).length,
      batchItemCount: result.result.total,
      cancelObserved: false,
      backgroundResume: false,
      managedWorktree: false,
      parentDiffVerified: false,
      autoIntegrated: false,
    },
    proofs: [
      { kind: "batch-plan", digest: digestValue({ batchDigest: definition.id, node }) },
      { kind: "batch-terminal-set", digest: digestValue(terminalProjection) },
      { kind: "input-order-aggregation", digest: digestValue(result.result.items.map(({ index, itemId }) => ({ index, itemId }))) },
      { kind: "process-terminal-set", digest: digestValue(terminalProjection.map(({ index, receiptId, authoritative }) => ({ index, receiptId, authoritative }))) },
      { kind: "usage-metering", digest: digestValue(result.usage) },
    ],
    usage: {
      children: result.usage.assignments,
      concurrency: result.result.maximumActive,
      elapsedMs: Math.max(result.usage.elapsedMs, clock() - startedAt),
      rawOutputBytes: result.usage.rawOutputBytes,
      tokens: result.usage.tokens,
      costUsd: result.usage.costUsd,
    },
  };
}

export async function executeProtectedLiveEvidenceScenario(request, backend, { clock = Date.now } = {}) {
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const observation = request.id === "live-batch-terminal"
    ? await runBatchScenario(request, backend, clock)
    : await runSingleScenario(request, backend, clock);
  return createProtectedLiveCaptureRecord({
    id: request.id,
    status: "PASS",
    authorizationDigest: request.authorizationDigest,
    sourceCommit: request.sourceCommit,
    matrixDigest: request.matrixDigest,
    policyDigest: request.policyDigest,
    trustPolicyDigest: request.trustPolicyDigest,
    compatibilityRowId: request.compatibilityRowId,
    observedAt: new Date(clock()).toISOString(),
    environment: request.environment,
    ...observation,
    privacy: {
      rawOutputStored: false,
      hostPathsStored: false,
      credentialsStored: false,
      sessionIdsStored: false,
    },
  });
}

export default function protectedLiveEvidenceExtension(pi) {
  let started = false;
  pi.on("session_start", async () => {
    if (started) return;
    started = true;
    let transport;
    let backend;
    try {
      const request = readRequest();
      transport = createPiEventTransport(pi, { timeoutMs: request.limits.maxWallTimeMs });
      backend = new PiSubagentsRpcV1Backend({
        transport,
        timeoutMs: Math.min(60_000, request.limits.maxWallTimeMs),
        terminalTimeoutMs: request.limits.maxWallTimeMs,
        ownsTransport: true,
      });
      const record = await executeProtectedLiveEvidenceScenario(request, backend);
      process.stdout.write(`${JSON.stringify(record)}\n`);
    } catch (cause) {
      const code = SAFE_CODE.test(cause?.code ?? "") ? cause.code : "CAPTURE_EXTENSION_FAILED";
      process.stdout.write(`${JSON.stringify({
        formatVersion: 1,
        type: SUBAGENTS_LIVE_CAPTURE_ERROR_TYPE,
        status: "FAIL",
        code,
      })}\n`);
    } finally {
      await backend?.dispose?.().catch(() => {});
      transport?.dispose?.();
    }
  });
}

export { SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE };
