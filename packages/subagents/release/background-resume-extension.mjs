import fs from "node:fs";
import path from "node:path";

import { PiSubagentsRpcV1Backend } from "../adapters/pi-subagents-rpc-v1/index.mjs";
import {
  bindBackendRun,
  createAgentRunHandle,
  createTaskAssignment,
  digestValue,
} from "../domain/index.mjs";
import { sha256, withoutKey } from "../state/codec.mjs";
import {
  createProtectedLiveCaptureRecord,
} from "./live-evidence-capture.mjs";
import {
  createPiEventTransport,
  resolvedReviewer,
  terminalUsage,
} from "./live-evidence-extension.mjs";

export const SUBAGENTS_BACKGROUND_RESUME_REQUEST_ENV = "OMP_SUBAGENTS_BACKGROUND_RESUME_REQUEST";
export const SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE = "omp_subagents_background_resume_phase_v1";
export const SUBAGENTS_BACKGROUND_RESUME_ERROR_TYPE = "omp_subagents_background_resume_error_v1";
export const SUBAGENTS_BACKGROUND_RESUME_HANDOFF_TYPE = "omp_subagents_background_resume_handoff_v1";

const REQUEST_KEYS = Object.freeze([
  "authorizationDigest",
  "compatibilityRowId",
  "environment",
  "expectedHandoffDigest",
  "handoffFile",
  "id",
  "limits",
  "matrixDigest",
  "parentSessionId",
  "phase",
  "processNonce",
  "policyDigest",
  "repositoryRoot",
  "sessionDir",
  "sourceCommit",
  "trustPolicyDigest",
  "workspaceRoot",
]);
const HANDOFF_KEYS = Object.freeze([
  "context",
  "formatVersion",
  "handle",
  "handoffDigest",
  "initial",
  "status",
  "type",
  "usage",
]);
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_HANDOFF_BYTES = 256 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const SAFE_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function fail(message, code) {
  throw Object.assign(new Error(message), { code });
}

function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function containedRegularFile(root, file, maximumBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) {
    fail("bounded regular file required", "BACKGROUND_RESUME_PATH_INVALID");
  }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  if (!inside(realRoot, realFile)) fail("file escaped isolated agent root", "BACKGROUND_RESUME_PATH_INVALID");
  return realFile;
}

export function loadBackgroundResumeExtensionRequest({ environment = process.env } = {}) {
  const requestFile = environment[SUBAGENTS_BACKGROUND_RESUME_REQUEST_ENV];
  const agentRoot = environment.PI_CODING_AGENT_DIR;
  if (typeof requestFile !== "string" || !path.isAbsolute(requestFile)
    || typeof agentRoot !== "string" || !path.isAbsolute(agentRoot)) {
    fail("background resume request unavailable", "BACKGROUND_RESUME_REQUEST_UNAVAILABLE");
  }
  const target = containedRegularFile(agentRoot, requestFile, MAX_REQUEST_BYTES);
  const request = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!exactKeys(request, REQUEST_KEYS)
    || request.id !== "background-resume"
    || !["launch", "resume"].includes(request.phase)
    || !SHA256.test(request.processNonce ?? "")
    || !SAFE_SESSION_ID.test(request.parentSessionId ?? "")
    || !object(request.environment)
    || !object(request.limits)) {
    fail("background resume request shape invalid", "BACKGROUND_RESUME_REQUEST_INVALID");
  }
  if ((request.phase === "launch" && request.expectedHandoffDigest !== null)
    || (request.phase === "resume" && !SHA256.test(request.expectedHandoffDigest ?? ""))) {
    fail("expected handoff digest does not match the request phase", "BACKGROUND_RESUME_REQUEST_INVALID");
  }
  const root = fs.realpathSync(agentRoot);
  for (const [name, value, type] of [
    ["repositoryRoot", request.repositoryRoot, "directory"],
    ["workspaceRoot", request.workspaceRoot, "directory"],
    ["sessionDir", request.sessionDir, "directory"],
  ]) {
    if (typeof value !== "string" || !path.isAbsolute(value)) fail(`${name} path invalid`, "BACKGROUND_RESUME_PATH_INVALID");
    const stat = fs.lstatSync(value);
    const real = fs.realpathSync(value);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${name} path invalid`, "BACKGROUND_RESUME_PATH_INVALID");
    if (name !== "repositoryRoot" && !inside(root, real)) fail(`${name} escaped agent root`, "BACKGROUND_RESUME_PATH_INVALID");
    request[name] = real;
  }
  if (typeof request.handoffFile !== "string" || !path.isAbsolute(request.handoffFile)
    || !inside(root, path.resolve(request.handoffFile))) {
    fail("handoff path escaped agent root", "BACKGROUND_RESUME_PATH_INVALID");
  }
  if (request.environment.node !== process.versions.node
    || request.environment.platform !== `${process.platform}-${process.arch}`) {
    fail("runtime environment drift", "BACKGROUND_RESUME_ENVIRONMENT_DRIFT");
  }
  return Object.freeze({ ...request, agentRoot: root });
}

function sessionIdentity(request, event, ctx) {
  if (ctx.mode !== "rpc" || ctx.isProjectTrusted()) {
    fail("background resume requires untrusted RPC session mode", "BACKGROUND_RESUME_SESSION_INVALID");
  }
  if (fs.realpathSync(ctx.cwd) !== request.workspaceRoot
    || fs.realpathSync(ctx.sessionManager.getSessionDir()) !== request.sessionDir
    || ctx.sessionManager.getSessionId() !== request.parentSessionId) {
    fail("parent session identity drift", "BACKGROUND_RESUME_SESSION_DRIFT");
  }
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (typeof sessionFile !== "string" || !path.isAbsolute(sessionFile)
    || !inside(request.sessionDir, path.resolve(sessionFile))) {
    fail("parent session file escaped its isolated directory", "BACKGROUND_RESUME_SESSION_INVALID");
  }
  return Object.freeze({
    id: request.parentSessionId,
    file: path.resolve(sessionFile),
    dir: request.sessionDir,
    reason: event.reason,
    identityDigest: digestValue({ id: request.parentSessionId, file: path.basename(sessionFile) }),
  });
}

async function reviewerDomain(request) {
  const { agentSpec } = await resolvedReviewer(request.repositoryRoot);
  const assignment = createTaskAssignment({
    assignmentId: "background-resume-assignment",
    agentSpec,
    task: "Return a bounded read-only review result with verdict pass and no unverified claims. Do not mutate files.",
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
    runId: "background-resume-run",
    nodeId: "background-resume-node",
    attemptId: "background-resume-attempt",
    assignment,
    agentSpec,
  });
  return { agentSpec, assignment, handle };
}

function terminalProjection(terminal, usage) {
  if (terminal?.authoritative !== true || terminal.outcome !== "completed") {
    fail("background phase lacks an authoritative completed terminal", "BACKGROUND_RESUME_TERMINAL_UNPROVEN");
  }
  return Object.freeze({
    receiptId: terminal.receiptId,
    outcome: terminal.outcome,
    authoritative: terminal.authoritative,
    processTerminalDigest: digestValue(terminal.processTerminal),
    usage,
  });
}

function handoffDigest(handoff) {
  return sha256(withoutKey(handoff, "handoffDigest"));
}

function exactUsage(value, { elapsed = false } = {}) {
  const keys = elapsed
    ? ["costUsd", "elapsedMs", "rawOutputBytes", "tokens"]
    : ["costUsd", "rawOutputBytes", "tokens"];
  return exactKeys(value, keys)
    && Number.isFinite(value.costUsd)
    && value.costUsd >= 0
    && Number.isSafeInteger(value.rawOutputBytes)
    && value.rawOutputBytes >= 0
    && Number.isSafeInteger(value.tokens)
    && value.tokens >= 0
    && (!elapsed || (Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0));
}

function writeHandoff(request, handoff) {
  if (fs.existsSync(request.handoffFile)) fail("handoff already exists", "BACKGROUND_RESUME_HANDOFF_EXISTS");
  const value = { ...handoff, handoffDigest: handoffDigest(handoff) };
  const encoded = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(encoded) > MAX_HANDOFF_BYTES) fail("handoff exceeds its bound", "BACKGROUND_RESUME_HANDOFF_INVALID");
  const fd = fs.openSync(request.handoffFile, "wx", 0o600);
  try {
    fs.writeFileSync(fd, encoded, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  containedRegularFile(request.agentRoot, request.handoffFile, MAX_HANDOFF_BYTES);
  return Object.freeze(value);
}

function readHandoff(request, session, expectedHandle) {
  const target = containedRegularFile(request.agentRoot, request.handoffFile, MAX_HANDOFF_BYTES);
  const handoff = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!exactKeys(handoff, HANDOFF_KEYS)
    || handoff.formatVersion !== 1
    || handoff.type !== SUBAGENTS_BACKGROUND_RESUME_HANDOFF_TYPE
    || handoff.status !== "READY_FOR_RESUME"
    || handoff.handoffDigest !== handoffDigest(handoff)
    || handoff.handoffDigest !== request.expectedHandoffDigest) {
    fail("handoff shape or digest invalid", "BACKGROUND_RESUME_HANDOFF_INVALID");
  }
  const context = handoff.context;
  if (!exactKeys(context, [
    "authorizationDigest", "compatibilityRowId", "initialProcessNonce", "matrixDigest",
    "parentSessionFile", "parentSessionIdentityDigest", "parentSessionId", "policyDigest",
    "sourceCommit", "trustPolicyDigest",
  ])
    || context.authorizationDigest !== request.authorizationDigest
    || context.sourceCommit !== request.sourceCommit
    || context.matrixDigest !== request.matrixDigest
    || context.policyDigest !== request.policyDigest
    || context.trustPolicyDigest !== request.trustPolicyDigest
    || context.compatibilityRowId !== request.compatibilityRowId
    || context.parentSessionId !== session.id
    || context.parentSessionFile !== session.file
    || context.parentSessionIdentityDigest !== session.identityDigest
    || context.initialProcessNonce === request.processNonce) {
    fail("handoff context drift", "BACKGROUND_RESUME_HANDOFF_DRIFT");
  }
  const binding = handoff.handle?.backendBindings?.[0];
  if (handoff.handle?.handleId !== expectedHandle.handleId
    || handoff.handle?.local?.assignmentHash !== expectedHandle.local.assignmentHash
    || handoff.handle?.local?.agentSpecHash !== expectedHandle.local.agentSpecHash
    || handoff.handle?.backendBindings?.length !== 1
    || handoff.handle?.activeBindingId !== handoff.initial?.bindingId
    || handoff.handle?.resumable !== true
    || handoff.handle?.backendId !== "pi-subagents-rpc-v1"
    || binding?.lifecycle !== "launch"
    || binding?.backendVersion !== "0.45.2"
    || binding?.protocolVersion !== 1
    || binding?.bindingId !== handoff.initial?.bindingId
    || typeof binding?.backendRunId !== "string"
    || binding.backendRunId.length === 0
    || !exactKeys(handoff.initial, ["bindingId", "terminal"])
    || !exactKeys(handoff.initial?.terminal, ["authoritative", "outcome", "processTerminalDigest", "receiptId", "usage"])
    || !exactUsage(handoff.initial?.terminal?.usage)
    || !exactUsage(handoff.usage, { elapsed: true })
    || handoff.initial.terminal.authoritative !== true
    || handoff.initial.terminal.outcome !== "completed"
    || !SHA256.test(handoff.initial.terminal.processTerminalDigest ?? "")
    || !SHA256.test(handoff.initial.terminal.receiptId ?? "")) {
    fail("handoff handle does not match the governed assignment", "BACKGROUND_RESUME_HANDLE_DRIFT");
  }
  let reconstructed;
  try {
    reconstructed = bindBackendRun(expectedHandle, {
      backendId: binding.backendId,
      backendVersion: binding.backendVersion,
      protocolVersion: binding.protocolVersion,
      lifecycle: binding.lifecycle,
      requestId: binding.requestId,
      backendRunId: binding.backendRunId,
      ...(binding.backendAsyncId === undefined ? {} : { backendAsyncId: binding.backendAsyncId }),
      ...(binding.backendSessionId === undefined ? {} : { backendSessionId: binding.backendSessionId }),
    });
  } catch {
    fail("handoff backend binding cannot be reconstructed", "BACKGROUND_RESUME_HANDLE_DRIFT");
  }
  if (reconstructed.activeBindingId !== handoff.handle.activeBindingId
    || digestValue(reconstructed) !== digestValue(handoff.handle)) {
    fail("handoff handle contains ungoverned fields or values", "BACKGROUND_RESUME_HANDLE_DRIFT");
  }
  return Object.freeze({ ...handoff, handle: reconstructed });
}

function phaseReceipt(request, session, handoff) {
  const receipt = {
    formatVersion: 1,
    type: SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE,
    status: "PASS",
    phase: "launch",
    authorizationDigest: request.authorizationDigest,
    parentSessionIdentityDigest: session.identityDigest,
    handoffDigest: handoff.handoffDigest,
    initialTerminalDigest: digestValue(handoff.initial),
    usage: handoff.usage,
  };
  return Object.freeze({ ...receipt, phaseDigest: digestValue(receipt) });
}

function aggregateUsage(first, second, elapsedMs) {
  const usage = {
    children: 2,
    concurrency: 1,
    elapsedMs,
    rawOutputBytes: first.rawOutputBytes + second.rawOutputBytes,
    tokens: first.tokens + second.tokens,
    costUsd: first.costUsd + second.costUsd,
  };
  for (const [key, maximum] of [
    ["elapsedMs", null],
    ["rawOutputBytes", null],
    ["tokens", null],
    ["costUsd", null],
  ]) {
    if (!Number.isFinite(usage[key]) || usage[key] < 0 || (maximum !== null && usage[key] > maximum)) {
      fail("aggregated usage invalid", "BACKGROUND_RESUME_USAGE_INVALID");
    }
  }
  return Object.freeze(usage);
}

export async function executeBackgroundResumeLaunchPhase(request, backend, session, { clock = Date.now } = {}) {
  const { agentSpec, assignment, handle } = await reviewerDomain(request);
  const startedAt = clock();
  const launched = await backend.launch({ handle, agentSpec, assignment, mode: "background" });
  const terminal = await backend.awaitTerminal(launched.handle, {
    bindingId: launched.binding.bindingId,
    intent: "run",
  });
  const usage = terminalUsage(terminal, request.limits.maxOutputBytes);
  const elapsedMs = Math.max(0, clock() - startedAt);
  if (elapsedMs > request.limits.maxWallTimeMs
    || usage.rawOutputBytes > request.limits.maxOutputBytes
    || usage.tokens > request.limits.maxTokens
    || usage.costUsd > request.limits.maxCostUsd) {
    fail("launch phase exceeded authorization", "BACKGROUND_RESUME_BUDGET_EXCEEDED");
  }
  const initial = {
    bindingId: launched.binding.bindingId,
    terminal: terminalProjection(terminal, usage),
  };
  const handoff = writeHandoff(request, {
    formatVersion: 1,
    type: SUBAGENTS_BACKGROUND_RESUME_HANDOFF_TYPE,
    status: "READY_FOR_RESUME",
    context: {
      authorizationDigest: request.authorizationDigest,
      sourceCommit: request.sourceCommit,
      matrixDigest: request.matrixDigest,
      policyDigest: request.policyDigest,
      trustPolicyDigest: request.trustPolicyDigest,
      compatibilityRowId: request.compatibilityRowId,
      initialProcessNonce: request.processNonce,
      parentSessionId: session.id,
      parentSessionFile: session.file,
      parentSessionIdentityDigest: session.identityDigest,
    },
    handle: launched.handle,
    initial,
    usage: { ...usage, elapsedMs },
  });
  return phaseReceipt(request, session, handoff);
}

export async function executeBackgroundResumeResumePhase(request, backend, session, { clock = Date.now } = {}) {
  const { handle: expectedHandle } = await reviewerDomain(request);
  const handoff = readHandoff(request, session, expectedHandle);
  const startedAt = clock();
  const resumed = await backend.resume(handoff.handle, {
    message: "Resume the same read-only review session and return a second bounded verification result. Do not mutate files.",
    mode: "background",
  });
  if (resumed.binding.lifecycle !== "resume"
    || resumed.binding.parentBindingId !== handoff.initial.bindingId
    || resumed.binding.bindingId === handoff.initial.bindingId
    || resumed.handle.backendBindings.length !== 2
    || resumed.handle.backendBindings[0].backendRunId === resumed.binding.backendRunId) {
    fail("resume did not produce a correlated new backend binding", "BACKGROUND_RESUME_REBIND_INVALID");
  }
  const terminal = await backend.awaitTerminal(resumed.handle, {
    bindingId: resumed.binding.bindingId,
    intent: "resume",
  });
  const resumedUsage = terminalUsage(terminal, request.limits.maxOutputBytes);
  const second = terminalProjection(terminal, resumedUsage);
  const usage = aggregateUsage(
    handoff.initial.terminal.usage,
    resumedUsage,
    handoff.usage.elapsedMs + Math.max(0, clock() - startedAt),
  );
  if (usage.elapsedMs > request.limits.maxWallTimeMs
    || usage.rawOutputBytes > request.limits.maxOutputBytes
    || usage.tokens > request.limits.maxTokens
    || usage.costUsd > request.limits.maxCostUsd) {
    fail("background resume exceeded aggregate authorization", "BACKGROUND_RESUME_BUDGET_EXCEEDED");
  }
  const proofValues = {
    "backend-rebind": {
      handleId: resumed.handle.handleId,
      parentBindingId: resumed.binding.parentBindingId,
      bindingId: resumed.binding.bindingId,
      lifecycle: resumed.binding.lifecycle,
      bindings: resumed.handle.backendBindings.length,
    },
    "background-spawn": {
      handleId: handoff.handle.handleId,
      bindingId: handoff.initial.bindingId,
      lifecycle: handoff.handle.backendBindings[0].lifecycle,
    },
    "parent-session-reload": {
      parentSessionIdentityDigest: session.identityDigest,
      initialProcessNonce: handoff.context.initialProcessNonce,
      resumeProcessNonce: request.processNonce,
      initialReason: "parent-process-one",
      resumeReason: session.reason,
    },
    "process-terminal": {
      initial: handoff.initial.terminal.processTerminalDigest,
      resumed: second.processTerminalDigest,
    },
    "resume-request": {
      parentBindingId: handoff.initial.bindingId,
      resumedBindingId: resumed.binding.bindingId,
      lifecycle: resumed.binding.lifecycle,
    },
    "terminal-receipt": {
      initial: handoff.initial.terminal.receiptId,
      resumed: second.receiptId,
      outcomes: [handoff.initial.terminal.outcome, second.outcome],
    },
    "usage-metering": usage,
  };
  return createProtectedLiveCaptureRecord({
    id: "background-resume",
    status: "PASS",
    authorizationDigest: request.authorizationDigest,
    sourceCommit: request.sourceCommit,
    matrixDigest: request.matrixDigest,
    policyDigest: request.policyDigest,
    trustPolicyDigest: request.trustPolicyDigest,
    compatibilityRowId: request.compatibilityRowId,
    observedAt: new Date(clock()).toISOString(),
    environment: request.environment,
    claims: {
      authoritativeTerminals: 2,
      batchItemCount: 0,
      cancelObserved: false,
      backgroundResume: true,
      managedWorktree: false,
      parentDiffVerified: false,
      autoIntegrated: false,
    },
    proofs: Object.keys(proofValues).sort().map((kind) => ({ kind, digest: digestValue(proofValues[kind]) })),
    usage,
    privacy: {
      rawOutputStored: false,
      hostPathsStored: false,
      credentialsStored: false,
      sessionIdsStored: false,
    },
  });
}

export default function backgroundResumeEvidenceExtension(pi) {
  let started = false;
  pi.on("session_start", async (event, ctx) => {
    if (started) return;
    started = true;
    let transport;
    let backend;
    try {
      const request = loadBackgroundResumeExtensionRequest();
      const session = sessionIdentity(request, event, ctx);
      transport = createPiEventTransport(pi, { timeoutMs: request.limits.maxWallTimeMs });
      backend = new PiSubagentsRpcV1Backend({
        transport,
        timeoutMs: Math.min(60_000, request.limits.maxWallTimeMs),
        terminalTimeoutMs: request.limits.maxWallTimeMs,
        ownsTransport: true,
      });
      const output = request.phase === "launch"
        ? await executeBackgroundResumeLaunchPhase(request, backend, session)
        : await executeBackgroundResumeResumePhase(request, backend, session);
      process.stdout.write(`${JSON.stringify(output)}\n`);
    } catch (cause) {
      const code = SAFE_CODE.test(cause?.code ?? "") ? cause.code : "BACKGROUND_RESUME_EXTENSION_FAILED";
      process.stdout.write(`${JSON.stringify({
        formatVersion: 1,
        type: SUBAGENTS_BACKGROUND_RESUME_ERROR_TYPE,
        status: "FAIL",
        code,
      })}\n`);
    } finally {
      await backend?.dispose?.().catch(() => {});
      transport?.dispose?.();
    }
  });
}
