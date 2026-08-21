import fs from "node:fs";
import path from "node:path";

import { createAgentRegistry } from "../../agent-registry/index.mjs";
import {
  PiSubagentsRpcV1Backend,
} from "../adapters/pi-subagents-rpc-v1/index.mjs";
import {
  agentTemplateFromRegistryEntry,
  createAgentRunHandle,
  createResolvedAgentSpec,
  createTaskAssignment,
  digestValue,
} from "../domain/index.mjs";
import { createProtectedLiveCaptureRecord } from "./live-evidence-capture.mjs";
import { createPiEventTransport, terminalUsage } from "./live-evidence-extension.mjs";
import { verifyGuardedWriterWorktree } from "./guarded-writer-verifier.mjs";

export const SUBAGENTS_GUARDED_WRITER_ERROR_TYPE = "omp_subagents_guarded_writer_error_v1";
export const SUBAGENTS_GUARDED_WRITER_REQUEST_ENV = "OMP_SUBAGENTS_GUARDED_WRITER_REQUEST";

const REQUEST_KEYS = Object.freeze([
  "agentRoot", "artifactRoot", "authorizationDigest", "baseCommit", "compatibilityRowId",
  "environment", "expectedMarker", "fixtureRoot", "limits", "matrixDigest", "policyDigest",
  "repositoryRoot", "requiredGateIds", "runtimeRoot", "sourceCommit", "trustPolicyDigest",
  "worktreeRoot",
]);
const MAX_REQUEST_BYTES = 64 * 1024;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realDirectory(target, label) {
  if (typeof target !== "string" || !path.isAbsolute(target)) {
    throw Object.assign(new Error(`${label} is invalid`), { code: "WRITER_REQUEST_INVALID" });
  }
  const real = fs.realpathSync(target);
  const stat = fs.lstatSync(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw Object.assign(new Error(`${label} is invalid`), { code: "WRITER_REQUEST_INVALID" });
  }
  return real;
}

function readRequest() {
  const requestFile = process.env[SUBAGENTS_GUARDED_WRITER_REQUEST_ENV];
  const configuredAgentRoot = process.env.PI_CODING_AGENT_DIR;
  if (typeof requestFile !== "string" || !path.isAbsolute(requestFile)
    || typeof configuredAgentRoot !== "string" || !path.isAbsolute(configuredAgentRoot)) {
    throw Object.assign(new Error("guarded writer request path unavailable"), { code: "WRITER_REQUEST_UNAVAILABLE" });
  }
  const agentRoot = fs.realpathSync(configuredAgentRoot);
  const stat = fs.lstatSync(requestFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error("guarded writer request path invalid"), { code: "WRITER_REQUEST_INVALID" });
  }
  const target = fs.realpathSync(requestFile);
  if (!inside(agentRoot, target)) {
    throw Object.assign(new Error("guarded writer request escaped agent root"), { code: "WRITER_REQUEST_INVALID" });
  }
  const request = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!exactKeys(request, REQUEST_KEYS) || !object(request.environment) || !object(request.limits)
    || !FULL_COMMIT.test(request.baseCommit ?? "")
    || request.expectedMarker?.length < 1
    || JSON.stringify(request.requiredGateIds) !== JSON.stringify(["diff-check", "fixture-content"])) {
    throw Object.assign(new Error("guarded writer request shape invalid"), { code: "WRITER_REQUEST_INVALID" });
  }
  const runtimeRoot = realDirectory(request.runtimeRoot, "runtimeRoot");
  const roots = {
    runtimeRoot,
    agentRoot: realDirectory(request.agentRoot, "agentRoot"),
    artifactRoot: realDirectory(request.artifactRoot, "artifactRoot"),
    fixtureRoot: realDirectory(request.fixtureRoot, "fixtureRoot"),
    worktreeRoot: realDirectory(request.worktreeRoot, "worktreeRoot"),
    repositoryRoot: realDirectory(request.repositoryRoot, "repositoryRoot"),
  };
  for (const key of ["agentRoot", "artifactRoot", "fixtureRoot", "worktreeRoot"]) {
    if (!inside(runtimeRoot, roots[key])) {
      throw Object.assign(new Error(`${key} escaped runtime root`), { code: "WRITER_REQUEST_INVALID" });
    }
  }
  if (inside(runtimeRoot, roots.repositoryRoot) || inside(roots.repositoryRoot, runtimeRoot)) {
    throw Object.assign(new Error("source and guarded writer runtime roots overlap"), { code: "WRITER_REQUEST_ROOT_OVERLAP" });
  }
  if (roots.agentRoot !== agentRoot
    || request.environment.node !== process.versions.node
    || request.environment.platform !== `${process.platform}-${process.arch}`) {
    throw Object.assign(new Error("guarded writer runtime environment drift"), { code: "WRITER_ENVIRONMENT_DRIFT" });
  }
  return Object.freeze({ ...request, ...roots });
}

async function resolveImplementer(request) {
  const registry = createAgentRegistry({ rootDir: request.repositoryRoot });
  const entry = await registry.resolve("implementer");
  if (entry.manifest.upstreamAgentId !== "omp-implementer"
    || entry.manifest.writer !== true
    || entry.manifest.policyCeiling.workspace !== "worktree-write"
    || entry.manifest.policyCeiling.mutation !== "isolated-worktree"
    || entry.manifest.policyCeiling.egress.web !== "deny"
    || entry.manifest.policyCeiling.egress.mcp !== "deny") {
    throw Object.assign(new Error("canonical implementer no longer matches guarded writer policy"), { code: "WRITER_AGENT_POLICY_DRIFT" });
  }
  const template = agentTemplateFromRegistryEntry(entry);
  return createResolvedAgentSpec({ template, id: "guarded-writer-live" });
}

function writerTask(request) {
  return [
    "Modify exactly fixture/allowed.txt inside the supplied managed worktree.",
    `Append the exact marker ${request.expectedMarker} on its own line.`,
    "Do not change any other path. Do not commit, merge, integrate, push, use network access, or invoke another agent.",
    "Return a bounded summary; the parent independently verifies the staged diff.",
  ].join(" ");
}

function proofs(request, terminal, assignment, verified) {
  const values = {
    "approval-receipt": { authorizationDigest: request.authorizationDigest, exactClaims: assignment.ownership.fileClaims },
    "base-commit": { digest: verified.baseCommitDigest },
    "parent-diff-verification": { digest: verified.parentDiffVerificationDigest, patchDigest: verified.patchDigest },
    "process-terminal": terminal.processTerminal,
    "task-assignment": { digest: verified.taskAssignmentDigest },
    "terminal-receipt": { digest: verified.terminalReceiptDigest, authoritative: terminal.authoritative, outcome: terminal.outcome },
    "worktree-receipt": { digest: verified.worktreeReceiptDigest, automaticIntegration: false },
  };
  return Object.keys(values).sort().map((kind) => ({ kind, digest: digestValue(values[kind]) }));
}

export async function executeGuardedWriterEvidenceScenario(request, backend, { clock = Date.now } = {}) {
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const agentSpec = await resolveImplementer(request);
  const assignment = createTaskAssignment({
    assignmentId: "guarded-writer-live-assignment",
    agentSpec,
    task: writerTask(request),
    ownership: {
      writer: true,
      workspace: "managed-worktree",
      allowedPaths: ["fixture/allowed.txt"],
      fileClaims: ["fixture/allowed.txt"],
      baseCommit: request.baseCommit,
    },
    idempotency: { class: "side-effect" },
    context: { mode: "fresh", artifactRefs: [] },
    budget: {
      maxElapsedMs: request.limits.maxWallTimeMs,
      maxOutputBytes: request.limits.maxOutputBytes,
      maxTokens: request.limits.maxTokens,
      maxCostUsd: request.limits.maxCostUsd,
    },
  });
  const handle = createAgentRunHandle({
    runId: "guarded-writer-live-run",
    nodeId: "guarded-writer-live-node",
    attemptId: "guarded-writer-live-attempt",
    assignment,
    agentSpec,
  });
  const startedAt = clock();
  const launched = await backend.launch({
    handle,
    agentSpec,
    assignment,
    mode: "background",
    allowWorktree: true,
    allowProtectedWorktreeProbe: true,
  });
  const terminal = await backend.awaitTerminal(launched.handle, {
    bindingId: launched.binding.bindingId,
    intent: "run",
  });
  if (terminal?.authoritative !== true || terminal.outcome !== "completed") {
    throw Object.assign(new Error("guarded writer terminal proof is not authoritative completion"), { code: "WRITER_TERMINAL_UNPROVEN" });
  }
  const usage = terminalUsage(terminal, request.limits.maxOutputBytes);
  const verified = await verifyGuardedWriterWorktree({
    assignment,
    terminalReceipt: terminal,
    artifactRoot: request.artifactRoot,
    worktreeRoot: request.worktreeRoot,
    fixtureRoot: request.fixtureRoot,
    expectedMarker: request.expectedMarker,
    requiredGateIds: request.requiredGateIds,
  });
  return createProtectedLiveCaptureRecord({
    id: "guarded-writer-integration",
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
      authoritativeTerminals: 1,
      batchItemCount: 0,
      cancelObserved: false,
      backgroundResume: false,
      managedWorktree: true,
      parentDiffVerified: true,
      autoIntegrated: false,
    },
    proofs: proofs(request, terminal, assignment, verified),
    usage: {
      children: 1,
      concurrency: 1,
      elapsedMs: Math.max(0, clock() - startedAt),
      ...usage,
    },
    privacy: { rawOutputStored: false, hostPathsStored: false, credentialsStored: false, sessionIdsStored: false },
  });
}

export default function guardedWriterEvidenceExtension(pi) {
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
      const record = await executeGuardedWriterEvidenceScenario(request, backend);
      process.stdout.write(`${JSON.stringify(record)}\n`);
    } catch (cause) {
      const code = SAFE_CODE.test(cause?.code ?? "") ? cause.code : "GUARDED_WRITER_EXTENSION_FAILED";
      process.stdout.write(`${JSON.stringify({ formatVersion: 1, type: SUBAGENTS_GUARDED_WRITER_ERROR_TYPE, status: "FAIL", code })}\n`);
    } finally {
      await backend?.dispose?.().catch(() => {});
      transport?.dispose?.();
    }
  });
}
