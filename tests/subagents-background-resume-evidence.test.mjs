import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  backgroundResumeAuthorizationDigest,
  loadBackgroundResumeAuthorization,
  validateBackgroundResumeAuthorization,
} from "../packages/subagents/release/background-resume-authorization.mjs";
import {
  captureProtectedBackgroundResumeEvidence,
  createBackgroundResumeCapturePlan,
  validateBackgroundResumeCaptureRecord,
} from "../packages/subagents/release/background-resume-capture.mjs";
import {
  executeBackgroundResumeLaunchPhase,
  executeBackgroundResumeResumePhase,
  loadBackgroundResumeExtensionRequest,
  SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE,
} from "../packages/subagents/release/background-resume-extension.mjs";
import {
  createPiBackgroundResumeScenarioRunner,
} from "../packages/subagents/release/background-resume-pi-runner.mjs";
import {
  liveEvidenceProviderDescriptorDigest,
} from "../packages/subagents/release/live-evidence-provider.mjs";
import {
  createProtectedLiveCaptureRecord,
} from "../packages/subagents/release/live-evidence-capture.mjs";
import {
  compatibilityMatrixDigest,
  loadSubagentsReleaseContracts,
} from "../packages/subagents/release/compatibility.mjs";
import {
  protectedEvidenceTrustPolicyDigest,
} from "../packages/subagents/release/protected-evidence.mjs";
import {
  bindBackendRun,
  createPiSubagentsRpcV1CapabilityMatrix,
} from "../packages/subagents/index.mjs";
import { sha256, withoutKey } from "../packages/subagents/state/codec.mjs";
import {
  executeBackgroundResumeEvidence,
  parseBackgroundResumeEvidenceArgs,
} from "../scripts/subagents-background-resume-evidence.mjs";

const rootDir = path.resolve(".");
const sourceCommit = "b".repeat(40);
const observedAt = "2026-08-22T00:30:00.000Z";

function fixture() {
  const { matrix, policy } = structuredClone(loadSubagentsReleaseContracts({ rootDir }));
  matrix.rows[0].id = `fixture-${process.platform}-${process.arch}-node-${process.versions.node}`;
  matrix.rows[0].environment = {
    node: process.versions.node,
    pi: matrix.policy.piVersion,
    backend: `${matrix.policy.backend.package}@${matrix.policy.backend.version}`,
    platform: `${process.platform}-${process.arch}`,
  };
  matrix.matrixDigest = compatibilityMatrixDigest(matrix);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const publicKeyFingerprint = sha256(publicKeyBytes);
  const trustPolicy = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-protected-evidence-trust-v1.schema.json",
    formatVersion: 1,
    contractStatus: "runtime-ready",
    id: "only-my-pi-subagents-protected-evidence-trust",
    algorithm: "ed25519",
    signers: [{
      id: "background-resume-test-signer",
      status: "active",
      authorizationClass: "local-operator-protected-live",
      publicKeySpki: publicKeyBytes.toString("base64"),
      publicKeyFingerprint,
      evidenceIds: ["background-resume"],
      notBefore: "2026-08-22T00:00:00.000Z",
      notAfter: "2026-08-22T02:00:00.000Z",
    }],
  };
  trustPolicy.policyDigest = protectedEvidenceTrustPolicyDigest(trustPolicy);
  const providerDescriptor = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-live-provider-v1.schema.json",
    formatVersion: 1,
    provider: {
      id: "fixture-provider",
      name: "Fixture Provider",
      baseUrl: "https://api.example.com/v1",
      api: "openai-responses",
      credentialEnvironment: "FIXTURE_API_KEY",
      model: {
        id: "fixture-model",
        name: "Fixture Model",
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
      },
    },
  };
  providerDescriptor.descriptorDigest = liveEvidenceProviderDescriptorDigest(providerDescriptor);
  const authorization = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-background-resume-authorization-v1.schema.json",
    formatVersion: 1,
    contractStatus: "operator-authorized-live",
    authorizationId: "background-resume-test-authorization",
    sourceCommit,
    matrixDigest: matrix.matrixDigest,
    policyDigest: policy.policyDigest,
    trustPolicyDigest: trustPolicy.policyDigest,
    compatibilityRowId: matrix.rows[0].id,
    evidenceIds: ["background-resume"],
    provider: {
      id: "fixture-provider",
      model: "fixture-model",
      configurationDigest: providerDescriptor.descriptorDigest,
      credentialEnvironment: ["FIXTURE_API_KEY"],
      declaredEndpointHosts: ["api.example.com"],
    },
    limits: {
      maxChildren: 2,
      maxConcurrency: 1,
      maxWallTimeMs: 60_000,
      maxOutputBytes: 65_536,
      maxTokens: 2_000,
      maxCostUsd: 1,
    },
    workspace: {
      mode: "disposable-read-only",
      realPiHome: "deny",
      mutation: "deny",
      web: "deny",
      mcp: "deny",
      projectTrust: "deny",
    },
    session: {
      persistence: "isolated-parent-session",
      parentProcesses: 2,
      artifactScope: "session",
      resumeMode: "new-backend-binding",
    },
    signer: {
      signerId: "background-resume-test-signer",
      publicKeyFingerprint,
      protocol: "digest-stdin-signature-stdout-v1",
    },
    approvedAt: "2026-08-22T00:00:00.000Z",
    expiresAt: "2026-08-22T01:00:00.000Z",
  };
  authorization.authorizationDigest = backgroundResumeAuthorizationDigest(authorization);
  return { matrix, policy, privateKey, trustPolicy, authorization, providerDescriptor };
}

async function providerFile(directory, values) {
  const file = path.join(directory, "live-provider.json");
  await fsPromises.writeFile(file, `${JSON.stringify(values.providerDescriptor, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function backgroundRecord(values, overrides = {}) {
  const proofKinds = [
    "backend-rebind",
    "background-spawn",
    "parent-session-reload",
    "process-terminal",
    "resume-request",
    "terminal-receipt",
    "usage-metering",
  ];
  return createProtectedLiveCaptureRecord({
    id: "background-resume",
    status: "PASS",
    authorizationDigest: values.authorization.authorizationDigest,
    sourceCommit,
    matrixDigest: values.matrix.matrixDigest,
    policyDigest: values.policy.policyDigest,
    trustPolicyDigest: values.trustPolicy.policyDigest,
    compatibilityRowId: values.authorization.compatibilityRowId,
    observedAt,
    environment: structuredClone(values.matrix.rows[0].environment),
    claims: {
      authoritativeTerminals: 2,
      batchItemCount: 0,
      cancelObserved: false,
      backgroundResume: true,
      managedWorktree: false,
      parentDiffVerified: false,
      autoIntegrated: false,
    },
    proofs: proofKinds.map((kind) => ({ kind, digest: sha256(`background:${kind}`) })),
    usage: {
      children: 2,
      concurrency: 1,
      elapsedMs: 20,
      rawOutputBytes: 256,
      tokens: 20,
      costUsd: 0.002,
    },
    privacy: {
      rawOutputStored: false,
      hostPathsStored: false,
      credentialsStored: false,
      sessionIdsStored: false,
    },
    ...overrides,
  });
}

test("background resume authorization is separate, bounded, digest-bound, and inert by default", async (t) => {
  const values = fixture();
  assert.equal(createBackgroundResumeCapturePlan({ authorization: null }).runnable, false);
  const checked = validateBackgroundResumeAuthorization(values.authorization, {
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  });
  assert.deepEqual(checked.evidenceIds, ["background-resume"]);
  assert.equal(checked.limits.maxChildren, 2);
  assert.equal(checked.limits.maxConcurrency, 1);
  assert.equal(checked.session.parentProcesses, 2);

  const wrongProcesses = structuredClone(values.authorization);
  wrongProcesses.session.parentProcesses = 1;
  wrongProcesses.authorizationDigest = backgroundResumeAuthorizationDigest(wrongProcesses);
  assert.throws(() => validateBackgroundResumeAuthorization(wrongProcesses, { allowTemplate: true }), {
    code: "AUTHORIZATION_SCHEMA_INVALID",
  });

  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-bg-auth-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const real = path.join(directory, "authorization.json");
  const linked = path.join(directory, "linked.json");
  await fsPromises.writeFile(real, `${JSON.stringify(values.authorization)}\n`);
  await fsPromises.symlink(real, linked);
  assert.throws(() => loadBackgroundResumeAuthorization(linked, { allowTemplate: true }), {
    code: "AUTHORIZATION_PATH_INVALID",
  });
});

test("background resume capture validates the real phase record shape, signs it, and stores no session identifiers", async () => {
  const values = fixture();
  const record = backgroundRecord(values);
  const capture = await captureProtectedBackgroundResumeEvidence({
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    scenarioRunner: async () => record,
    signer: async ({ digest }) => crypto.sign(null, Buffer.from(digest), values.privateKey).toString("base64"),
    now: Date.parse(observedAt),
  });
  assert.equal(capture.status, "PROTECTED_LIVE_EVIDENCE_CAPTURED");
  assert.equal(capture.evidence["background-resume"].status, "PASS");
  assert.equal(capture.records["background-resume"].captureDigest, capture.evidence["background-resume"].attestation.captureDigest);
  assert.deepEqual(capture.usage, record.usage);
  const encoded = JSON.stringify(capture);
  assert.equal(encoded.includes("session-identifier"), false);
  assert.equal(encoded.includes(rootDir), false);

  const missingReload = structuredClone(record);
  missingReload.proofs = missingReload.proofs.filter((proof) => proof.kind !== "parent-session-reload");
  delete missingReload.captureDigest;
  const recomputed = createProtectedLiveCaptureRecord(missingReload);
  assert.throws(() => validateBackgroundResumeCaptureRecord(recomputed, {
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
  }), { code: "CAPTURE_PROOF_MISSING" });
});

function extensionRequest(values, directory, phase, expectedHandoffDigest = null) {
  return {
    id: "background-resume",
    phase,
    processNonce: sha256(`process:${phase}`),
    expectedHandoffDigest,
    parentSessionId: "omp-background-test-session",
    sessionDir: path.join(directory, "sessions"),
    handoffFile: path.join(directory, "agent", "background-resume", "handoff.json"),
    authorizationDigest: values.authorization.authorizationDigest,
    sourceCommit,
    matrixDigest: values.matrix.matrixDigest,
    policyDigest: values.policy.policyDigest,
    trustPolicyDigest: values.trustPolicy.policyDigest,
    compatibilityRowId: values.authorization.compatibilityRowId,
    environment: structuredClone(values.matrix.rows[0].environment),
    limits: structuredClone(values.authorization.limits),
    repositoryRoot: rootDir,
    workspaceRoot: path.join(directory, "workspace"),
    agentRoot: path.join(directory, "agent"),
  };
}

function terminal(handle, sequence) {
  return {
    authoritative: true,
    outcome: "completed",
    receiptId: sha256({ handle: handle.handleId, sequence }),
    result: { verdict: "pass", findings: [], tested: [], unverified: [] },
    completion: {
      state: "completed",
      totalTokens: { total: 10 },
      totalCost: { costUsd: 0.001 },
    },
    processTerminal: { version: 1, state: "observed", sequence },
  };
}

function launchBackend() {
  return {
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix({ observedAt: 1, terminalTransport: true }),
    async launch({ handle, childAsync }) {
      assert.equal(childAsync, true);
      const bound = bindBackendRun(handle, {
        backendId: "pi-subagents-rpc-v1",
        backendVersion: "0.45.2",
        protocolVersion: 1,
        lifecycle: "launch",
        requestId: "launch-request",
        backendRunId: "initial-backend-run",
        backendSessionId: "persisted-child-session",
      });
      return { handle: bound, binding: bound.backendBindings[0] };
    },
    async awaitTerminal(handle) { return terminal(handle, 1); },
  };
}

function resumeBackend() {
  return {
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix({ observedAt: 2, terminalTransport: true }),
    async resume(handle) {
      const rebound = bindBackendRun(handle, {
        backendId: "pi-subagents-rpc-v1",
        backendVersion: "0.45.2",
        protocolVersion: 1,
        lifecycle: "resume",
        requestId: "resume-request",
        backendRunId: "resumed-backend-run",
        backendSessionId: "persisted-child-session",
      });
      return { handle: rebound, binding: rebound.backendBindings[1] };
    },
    async awaitTerminal(handle) { return terminal(handle, 2); },
  };
}

test("two extension phases persist a digest-bound handoff and prove a new correlated backend binding", async (t) => {
  const values = fixture();
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-bg-extension-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fsPromises.mkdir(path.join(directory, "agent", "background-resume"), { recursive: true }),
    fsPromises.mkdir(path.join(directory, "sessions"), { recursive: true }),
    fsPromises.mkdir(path.join(directory, "workspace"), { recursive: true }),
  ]);
  const session = {
    id: "omp-background-test-session",
    file: path.join(directory, "sessions", "2026_session.jsonl"),
    dir: path.join(directory, "sessions"),
    reason: "startup",
    identityDigest: sha256({ id: "omp-background-test-session", file: "2026_session.jsonl" }),
  };
  let time = Date.parse(observedAt) - 20;
  const launchReceipt = await executeBackgroundResumeLaunchPhase(
    extensionRequest(values, directory, "launch"),
    launchBackend(),
    session,
    { clock: () => { time += 5; return time; } },
  );
  assert.equal(launchReceipt.type, SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE);
  const handoffFile = extensionRequest(values, directory, "launch").handoffFile;
  const handoffStat = await fsPromises.stat(handoffFile);
  assert.equal(handoffStat.mode & 0o077, 0);
  const handoff = JSON.parse(await fsPromises.readFile(handoffFile, "utf8"));
  assert.equal(handoff.handle.backendBindings.length, 1);
  assert.equal(handoff.handle.backendBindings[0].lifecycle, "launch");

  const resumedSession = { ...session, reason: "resume" };
  const record = await executeBackgroundResumeResumePhase(
    extensionRequest(values, directory, "resume", handoff.handoffDigest),
    resumeBackend(),
    resumedSession,
    { clock: () => { time += 5; return time; } },
  );
  const checked = validateBackgroundResumeCaptureRecord(record, {
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
  });
  assert.equal(checked.claims.authoritativeTerminals, 2);
  assert.equal(checked.claims.backgroundResume, true);
  assert.deepEqual(checked.usage, {
    children: 2,
    concurrency: 1,
    elapsedMs: 10,
    rawOutputBytes: checked.usage.rawOutputBytes,
    tokens: 20,
    costUsd: 0.002,
  });
  assert.deepEqual(checked.proofs.map((proof) => proof.kind), [
    "backend-rebind",
    "background-spawn",
    "parent-session-reload",
    "process-terminal",
    "resume-request",
    "terminal-receipt",
    "usage-metering",
  ]);
  const serialized = JSON.stringify(checked);
  assert.equal(serialized.includes(session.id), false);
  assert.equal(serialized.includes(session.file), false);

  handoff.handle.ungoverned = true;
  handoff.handoffDigest = sha256(withoutKey(handoff, "handoffDigest"));
  await fsPromises.writeFile(handoffFile, `${JSON.stringify(handoff)}\n`);
  await assert.rejects(executeBackgroundResumeResumePhase(
    extensionRequest(values, directory, "resume", handoff.handoffDigest),
    resumeBackend(),
    resumedSession,
  ), { code: "BACKGROUND_RESUME_HANDLE_DRIFT" });
});

async function auditedPackageFixture(directory) {
  const packageRoot = path.join(directory, "pi-subagents");
  const packageJson = `${JSON.stringify({ name: "pi-subagents", version: "0.45.2" }, null, 2)}\n`;
  const rpcSource = "export const protocolVersion = 1;\n";
  await fsPromises.mkdir(path.join(packageRoot, "src", "extension"), { recursive: true });
  await fsPromises.writeFile(path.join(packageRoot, "package.json"), packageJson);
  await fsPromises.writeFile(path.join(packageRoot, "index.ts"), "export default function extension() {}\n");
  await fsPromises.writeFile(path.join(packageRoot, "src", "extension", "rpc.ts"), rpcSource);
  return {
    packageRoot,
    expected: {
      package: "pi-subagents",
      version: "0.45.2",
      packageJsonSha256: crypto.createHash("sha256").update(packageJson).digest("hex"),
      rpcSourceSha256: crypto.createHash("sha256").update(rpcSource).digest("hex"),
    },
  };
}

function fakeChild(record, invocation, beforeOutput) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end() { queueMicrotask(() => child.emit("exit", 0, null)); } };
  child.kill = () => child.emit("exit", null, "SIGTERM");
  invocation.child = child;
  queueMicrotask(async () => {
    await beforeOutput?.();
    child.stdout.emit("data", `${JSON.stringify(record)}\n`);
  });
  return child;
}

test("Pi runner launches two separate parent processes with one persisted isolated session and credential allowlist", async (t) => {
  const values = fixture();
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-bg-runner-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const configRoot = path.join(directory, "config");
  const fakeHome = path.join(directory, "owner-home");
  await fsPromises.mkdir(configRoot);
  await fsPromises.mkdir(fakeHome);
  const audited = await auditedPackageFixture(directory);
  const modelsFile = await providerFile(directory, values);
  const invocations = [];
  const runner = createPiBackgroundResumeScenarioRunner({
    configRoot,
    packageRoot: audited.packageRoot,
    modelsFile,
    repositoryRoot: rootDir,
    piCommand: "/test/pi",
    expectedArtifact: audited.expected,
    versionProbe: async () => "0.84.1",
    homedir: () => fakeHome,
    nonceFactory: (phase) => sha256(`runner:${phase}`),
    hostEnvironment: {
      PATH: "/usr/bin:/bin",
      FIXTURE_API_KEY: "fixture-secret-value",
      OPENAI_API_KEY: "must-not-cross-boundary",
    },
    spawnImpl: (command, argv, options) => {
      const request = JSON.parse(fs.readFileSync(options.env.OMP_SUBAGENTS_BACKGROUND_RESUME_REQUEST, "utf8"));
      const invocation = { command, argv, options, request };
      invocations.push(invocation);
      if (request.phase === "launch") {
        const handoff = {
          formatVersion: 1,
          type: "omp_subagents_background_resume_handoff_v1",
          status: "READY_FOR_RESUME",
          context: {},
          handle: {},
          initial: {},
          usage: {},
        };
        handoff.handoffDigest = sha256(handoff);
        const phase = {
          formatVersion: 1,
          type: SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE,
          status: "PASS",
          phase: "launch",
          authorizationDigest: values.authorization.authorizationDigest,
          parentSessionIdentityDigest: sha256("session"),
          handoffDigest: handoff.handoffDigest,
          initialTerminalDigest: sha256("terminal"),
          usage: { elapsedMs: 1, rawOutputBytes: 1, tokens: 1, costUsd: 0.001 },
        };
        phase.phaseDigest = sha256(phase);
        return fakeChild(phase, invocation, async () => {
          const sessionFile = path.join(request.sessionDir, `2026-08-22_${request.parentSessionId}.jsonl`);
          await fsPromises.writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: request.parentSessionId, cwd: request.workspaceRoot })}\n`);
          await fsPromises.writeFile(request.handoffFile, `${JSON.stringify(handoff)}\n`, { mode: 0o600 });
        });
      }
      return fakeChild(backgroundRecord(values), invocation);
    },
  });
  const record = await runner({
    id: "background-resume",
    authorization: values.authorization,
    expectedSourceCommit: sourceCommit,
    environment: structuredClone(values.matrix.rows[0].environment),
    scenarioLimits: structuredClone(values.authorization.limits),
  });
  assert.equal(record.id, "background-resume");
  assert.equal(invocations.length, 2);
  assert.notEqual(invocations[0].child, invocations[1].child);
  assert.deepEqual(invocations[0].argv, invocations[1].argv);
  assert.equal(invocations[0].request.phase, "launch");
  assert.equal(invocations[1].request.phase, "resume");
  assert.equal(invocations[0].request.parentSessionId, invocations[1].request.parentSessionId);
  assert.equal(invocations[0].request.sessionDir, invocations[1].request.sessionDir);
  assert.notEqual(invocations[0].request.processNonce, invocations[1].request.processNonce);
  assert.equal(invocations[0].argv.includes("--no-session"), false);
  assert.equal(invocations[0].argv.includes("--session-id"), true);
  assert.equal(invocations[0].argv.includes("--session-dir"), true);
  assert.equal(invocations[0].options.cwd.endsWith(`${path.sep}workspace`), true);
  assert.notEqual(invocations[0].options.cwd, rootDir);
  assert.equal(invocations[0].options.cwd.startsWith(invocations[0].options.env.PI_CODING_AGENT_DIR), true);
  for (const invocation of invocations) {
    const checkedRequest = loadBackgroundResumeExtensionRequest({ environment: invocation.options.env });
    assert.equal(checkedRequest.workspaceRoot, invocation.options.cwd);
  }
  assert.equal(invocations[0].options.env.FIXTURE_API_KEY, "fixture-secret-value");
  assert.equal(Object.hasOwn(invocations[0].options.env, "OPENAI_API_KEY"), false);
  assert.notEqual(invocations[0].options.env.OMP_SUBAGENTS_BACKGROUND_RESUME_REQUEST, invocations[1].options.env.OMP_SUBAGENTS_BACKGROUND_RESUME_REQUEST);
  const subagentConfig = JSON.parse(await fsPromises.readFile(path.join(
    invocations[0].options.env.PI_CODING_AGENT_DIR,
    "extensions",
    "subagent",
    "config.json",
  ), "utf8"));
  assert.deepEqual(subagentConfig, { artifactDir: "session" });
  const models = JSON.parse(await fsPromises.readFile(path.join(
    invocations[0].options.env.PI_CODING_AGENT_DIR,
    "models.json",
  ), "utf8"));
  assert.equal(models.providers["fixture-provider"].apiKey, "$FIXTURE_API_KEY");
});

test("background resume CLI defaults to zero execution and refuses run without explicit confirmation", async () => {
  const parsed = parseBackgroundResumeEvidenceArgs([]);
  assert.equal(parsed.operation, "plan");
  assert.throws(() => parseBackgroundResumeEvidenceArgs(["--run"]), /requires --yes/u);
  assert.throws(() => parseBackgroundResumeEvidenceArgs(["--run", "--yes"]), /requires --authorization-file/u);
  let runnerCalls = 0;
  const result = await executeBackgroundResumeEvidence(["--plan", "--json"], {
    rootDir,
    sourceInspector: async () => ({ sourceCommit, clean: true }),
    scenarioRunnerFactory: () => { runnerCalls += 1; return async () => null; },
    now: () => Date.parse(observedAt),
  });
  assert.equal(result.status, "PLAN");
  assert.equal(result.plan.runnable, false);
  assert.equal(result.plan.providerRequest, "NOT_STARTED");
  assert.equal(result.plan.parentProcessCount, 2);
  assert.equal(result.plan.blockers.includes("TRUST_POLICY_UNAVAILABLE"), false);
  assert.equal(result.plan.blockers.includes("AUTHORIZATION_REQUIRED"), true);
  assert.equal(runnerCalls, 0);
});
