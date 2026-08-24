import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createAgentRegistry } from "../packages/agent-registry/index.mjs";
import {
  agentTemplateFromRegistryEntry,
  createResolvedAgentSpec,
  createTaskAssignment,
} from "../packages/subagents/domain/index.mjs";
import {
  guardedWriterAuthorizationDigest,
  loadGuardedWriterAuthorization,
  validateGuardedWriterAuthorization,
} from "../packages/subagents/release/guarded-writer-authorization.mjs";
import {
  captureProtectedGuardedWriterEvidence,
  createGuardedWriterCapturePlan,
  createProtectedLiveCaptureRecord,
  validateGuardedWriterCaptureRecord,
} from "../packages/subagents/release/guarded-writer-capture.mjs";
import {
  extractPiSubagentsHandoffPath,
  verifyGuardedWriterWorktree,
} from "../packages/subagents/release/guarded-writer-verifier.mjs";
import { createPiGuardedWriterScenarioRunner } from "../packages/subagents/release/guarded-writer-pi-runner.mjs";
import { liveEvidenceProviderDescriptorDigest } from "../packages/subagents/release/live-evidence-provider.mjs";
import {
  compatibilityMatrixDigest,
  loadSubagentsReleaseContracts,
} from "../packages/subagents/release/compatibility.mjs";
import { protectedEvidenceTrustPolicyDigest } from "../packages/subagents/release/protected-evidence.mjs";
import { sha256 } from "../packages/subagents/state/codec.mjs";
import {
  executeGuardedWriterEvidence,
  parseGuardedWriterEvidenceArgs,
} from "../scripts/subagents-guarded-writer-evidence.mjs";

const run = promisify(execFile);
const rootDir = path.resolve(".");
const sourceCommit = "c".repeat(40);
const observedAt = "2026-08-22T00:30:00.000Z";
const marker = "ONLY_MY_PI_GUARDED_WRITER_PASS";

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
      id: "guarded-writer-test-signer",
      status: "active",
      authorizationClass: "local-operator-protected-live",
      publicKeySpki: publicKeyBytes.toString("base64"),
      publicKeyFingerprint,
      evidenceIds: ["guarded-writer-integration"],
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
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-guarded-writer-authorization-v1.schema.json",
    formatVersion: 1,
    contractStatus: "operator-authorized-live",
    authorizationId: "guarded-writer-test-authorization",
    sourceCommit,
    matrixDigest: matrix.matrixDigest,
    policyDigest: policy.policyDigest,
    trustPolicyDigest: trustPolicy.policyDigest,
    compatibilityRowId: matrix.rows[0].id,
    evidenceIds: ["guarded-writer-integration"],
    provider: {
      id: "fixture-provider",
      model: "fixture-model",
      configurationDigest: providerDescriptor.descriptorDigest,
      credentialEnvironment: ["FIXTURE_API_KEY"],
      declaredEndpointHosts: ["api.example.com"],
    },
    limits: {
      maxChildren: 1,
      maxConcurrency: 1,
      maxWallTimeMs: 60_000,
      maxOutputBytes: 65_536,
      maxTokens: 2_000,
      maxCostUsd: 1,
    },
    workspace: {
      mode: "disposable-managed-worktree",
      realPiHome: "deny",
      mutation: "guarded-exact-claims",
      web: "deny",
      mcp: "deny",
      projectTrust: "deny",
      automaticIntegration: false,
      parentDiffVerification: "required",
    },
    writer: {
      agentId: "implementer",
      upstreamAgentId: "omp-implementer",
      allowedPaths: ["fixture/allowed.txt"],
      fileClaims: ["fixture/allowed.txt"],
      baseCommitPolicy: "fixture-head",
      requiredGateIds: ["diff-check", "fixture-content"],
      expectedMarker: marker,
    },
    signer: {
      signerId: "guarded-writer-test-signer",
      publicKeyFingerprint,
      protocol: "digest-stdin-signature-stdout-v1",
    },
    approvedAt: "2026-08-22T00:00:00.000Z",
    expiresAt: "2026-08-22T01:00:00.000Z",
  };
  authorization.authorizationDigest = guardedWriterAuthorizationDigest(authorization);
  return { matrix, policy, privateKey, trustPolicy, authorization, providerDescriptor };
}

async function providerFile(directory, values) {
  const file = path.join(directory, "live-provider.json");
  await fsPromises.writeFile(file, `${JSON.stringify(values.providerDescriptor, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function captureRecord(values, proofDigests = {}) {
  const proofKinds = [
    "approval-receipt",
    "base-commit",
    "parent-diff-verification",
    "process-terminal",
    "task-assignment",
    "terminal-receipt",
    "worktree-receipt",
  ];
  return createProtectedLiveCaptureRecord({
    id: "guarded-writer-integration",
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
      authoritativeTerminals: 1,
      batchItemCount: 0,
      cancelObserved: false,
      backgroundResume: false,
      managedWorktree: true,
      parentDiffVerified: true,
      autoIntegrated: false,
    },
    proofs: proofKinds.map((kind) => ({ kind, digest: proofDigests[kind] ?? sha256(`writer:${kind}`) })),
    usage: { children: 1, concurrency: 1, elapsedMs: 20, rawOutputBytes: 256, tokens: 20, costUsd: 0.002 },
    privacy: { rawOutputStored: false, hostPathsStored: false, credentialsStored: false, sessionIdsStored: false },
  });
}

test("guarded writer authorization is separate, exact-claim, handoff-only, and inert by default", async (t) => {
  const values = fixture();
  assert.equal(createGuardedWriterCapturePlan({ authorization: null }).runnable, false);
  const checked = validateGuardedWriterAuthorization(values.authorization, {
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  });
  assert.deepEqual(checked.evidenceIds, ["guarded-writer-integration"]);
  assert.deepEqual(checked.writer.fileClaims, ["fixture/allowed.txt"]);
  assert.equal(checked.workspace.automaticIntegration, false);

  const widened = structuredClone(values.authorization);
  widened.writer.fileClaims = ["fixture/other.txt"];
  widened.authorizationDigest = guardedWriterAuthorizationDigest(widened);
  assert.throws(() => validateGuardedWriterAuthorization(widened, { allowTemplate: true }), {
    code: "AUTHORIZATION_SCHEMA_INVALID",
  });

  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-writer-auth-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const real = path.join(directory, "authorization.json");
  const linked = path.join(directory, "linked.json");
  await fsPromises.writeFile(real, `${JSON.stringify(values.authorization)}\n`);
  await fsPromises.symlink(real, linked);
  assert.throws(() => loadGuardedWriterAuthorization(linked, { allowTemplate: true }), {
    code: "AUTHORIZATION_PATH_INVALID",
  });
});

async function git(cwd, ...argv) {
  return (await run("git", argv, {
    cwd,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LC_ALL: "C" },
    encoding: "utf8",
  })).stdout.trim();
}

async function writerFixture(t, { capturedAndRemoved = false } = {}) {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-writer-verify-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const repository = path.join(directory, "fixture-repo");
  const worktreeRoot = path.join(directory, "worktrees");
  const worktree = path.join(worktreeRoot, "writer-1");
  const artifactRoot = path.join(directory, "artifacts");
  await fsPromises.mkdir(path.join(repository, "fixture"), { recursive: true });
  await fsPromises.mkdir(worktreeRoot);
  await fsPromises.mkdir(path.join(artifactRoot, "handoffs"), { recursive: true });
  await fsPromises.writeFile(path.join(repository, "fixture", "allowed.txt"), "before\n");
  await git(repository, "init", "-q");
  await git(repository, "add", "--", "fixture/allowed.txt");
  await run("git", ["-c", "user.name=only-my-pi", "-c", "user.email=only-my-pi@example.invalid", "commit", "-q", "-m", "fixture"], { cwd: repository });
  const baseCommit = await git(repository, "rev-parse", "HEAD");
  await git(repository, "worktree", "add", "-q", "-b", "omp-writer-test", worktree, baseCommit);
  await fsPromises.writeFile(path.join(worktree, "fixture", "allowed.txt"), `before\n${marker}\n`);
  await git(worktree, "add", "--", "fixture/allowed.txt");
  const patchPath = path.join(artifactRoot, "handoffs", "writer.patch");
  await fsPromises.writeFile(patchPath, `${await git(worktree, "diff", "--cached", "--binary", baseCommit, "--")}\n`);
  const manifestPath = path.join(artifactRoot, "handoffs", "writer.json");
  const manifest = {
    version: 1,
    runId: "upstream-writer-run",
    mode: "parallel",
    source: "async",
    cwd: repository,
    createdAt: 1,
    updatedAt: 2,
    groups: [{
      stepIndex: 0,
      baseCommit,
      repoRoot: repository,
      children: [{
        index: 0,
        taskIndex: 0,
        agent: "omp-implementer",
        status: "completed",
        summary: "bounded",
        patch: { path: patchPath, branch: "omp-writer-test", changed: true, diffStat: "1 file changed", filesChanged: 1, insertions: 1, deletions: 0 },
      }],
      cleanup: {
        state: "complete",
        pruned: true,
        tasks: [{
          index: 0,
          path: worktree,
          branch: "omp-writer-test",
          worktreeRemoved: capturedAndRemoved,
          branchRemoved: capturedAndRemoved,
          ...(capturedAndRemoved ? {} : { preserved: true, reason: "handoff" }),
        }],
      },
    }],
  };
  await fsPromises.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  if (capturedAndRemoved) {
    await git(repository, "worktree", "remove", "--force", worktree);
    await git(repository, "branch", "-D", "omp-writer-test");
  }
  const registry = createAgentRegistry({ rootDir });
  const entry = await registry.resolve("implementer");
  const template = agentTemplateFromRegistryEntry(entry);
  const agentSpec = createResolvedAgentSpec({ template, id: "guarded-writer-live" });
  const assignment = createTaskAssignment({
    assignmentId: "guarded-writer-assignment",
    agentSpec,
    task: "Edit only fixture/allowed.txt and add the exact authorized marker. Do not commit or integrate.",
    ownership: { writer: true, workspace: "managed-worktree", allowedPaths: ["fixture/allowed.txt"], fileClaims: ["fixture/allowed.txt"], baseCommit },
  });
  const terminalReceipt = {
    authoritative: true,
    outcome: "completed",
    receiptId: sha256("writer-terminal"),
    result: { parallelHandoff: { version: 1, path: manifestPath } },
    completion: { state: "completed" },
    processTerminal: { state: "observed" },
  };
  return { directory, repository, worktreeRoot, artifactRoot, manifestPath, baseCommit, assignment, terminalReceipt };
}

test("parent verifier recomputes an exact staged diff and creates a handoff without integrating it", async (t) => {
  const value = await writerFixture(t);
  assert.equal(extractPiSubagentsHandoffPath(value.terminalReceipt), value.manifestPath);
  const verified = await verifyGuardedWriterWorktree({
    assignment: value.assignment,
    terminalReceipt: value.terminalReceipt,
    artifactRoot: value.artifactRoot,
    worktreeRoot: value.worktreeRoot,
    fixtureRoot: value.repository,
    expectedMarker: marker,
  });
  assert.equal(verified.status, "HANDOFF_READY_FOR_OPERATOR_REVIEW");
  assert.deepEqual(verified.changedPaths, ["fixture/allowed.txt"]);
  assert.equal(verified.integration.automaticIntegration, false);
  assert.equal(verified.handoff.integration.state, "HANDOFF_ONLY");
  assert.equal(verified.reviewWorktreeMode, "preserved-upstream-worktree");
  assert.equal(await fsPromises.readFile(path.join(value.repository, "fixture", "allowed.txt"), "utf8"), "before\n");

  await fsPromises.appendFile(path.join(value.worktreeRoot, "writer-1", "fixture", "allowed.txt"), "unstaged\n");
  await assert.rejects(verifyGuardedWriterWorktree({
    assignment: value.assignment,
    terminalReceipt: value.terminalReceipt,
    artifactRoot: value.artifactRoot,
    worktreeRoot: value.worktreeRoot,
    fixtureRoot: value.repository,
    expectedMarker: marker,
  }), { code: "WRITER_UNSTAGED_CHANGE_FORBIDDEN" });
  await git(path.join(value.worktreeRoot, "writer-1"), "restore", "--worktree", "--", "fixture/allowed.txt");

  await fsPromises.writeFile(path.join(value.worktreeRoot, "writer-1", "fixture", "outside.txt"), "escape\n");
  await git(path.join(value.worktreeRoot, "writer-1"), "add", "--", "fixture/outside.txt");
  await assert.rejects(verifyGuardedWriterWorktree({
    assignment: value.assignment,
    terminalReceipt: value.terminalReceipt,
    artifactRoot: value.artifactRoot,
    worktreeRoot: value.worktreeRoot,
    fixtureRoot: value.repository,
    expectedMarker: marker,
  }), { code: "WRITER_CHANGED_PATH_OUTSIDE_CLAIMS" });

  const escapedRoot = path.join(value.directory, "escaped-worktrees");
  const escapedWorktree = path.join(escapedRoot, "writer-2");
  await fsPromises.mkdir(escapedWorktree, { recursive: true });
  const link = path.join(value.worktreeRoot, "linked-parent");
  await fsPromises.symlink(escapedRoot, link);
  const maliciousManifest = JSON.parse(await fsPromises.readFile(value.manifestPath, "utf8"));
  maliciousManifest.groups[0].cleanup.tasks[0].path = path.join(link, "writer-2");
  const maliciousManifestPath = path.join(value.artifactRoot, "handoffs", "writer-symlink.json");
  await fsPromises.writeFile(maliciousManifestPath, `${JSON.stringify(maliciousManifest)}\n`);
  await assert.rejects(verifyGuardedWriterWorktree({
    assignment: value.assignment,
    terminalReceipt: value.terminalReceipt,
    artifactRoot: value.artifactRoot,
    worktreeRoot: value.worktreeRoot,
    fixtureRoot: value.repository,
    manifestPath: maliciousManifestPath,
    expectedMarker: marker,
  }), { code: "WRITER_SYMLINK_FORBIDDEN" });
});

test("parent reconstructs a detached review worktree when upstream preserves only the captured patch", async (t) => {
  const value = await writerFixture(t, { capturedAndRemoved: true });
  const verified = await verifyGuardedWriterWorktree({
    assignment: value.assignment,
    terminalReceipt: value.terminalReceipt,
    artifactRoot: value.artifactRoot,
    worktreeRoot: value.worktreeRoot,
    fixtureRoot: value.repository,
    expectedMarker: marker,
  });
  assert.equal(verified.status, "HANDOFF_READY_FOR_OPERATOR_REVIEW");
  assert.equal(verified.reviewWorktreeMode, "captured-patch-removed-upstream-worktree");
  assert.deepEqual(verified.changedPaths, ["fixture/allowed.txt"]);
  const entries = await fsPromises.readdir(value.worktreeRoot, { withFileTypes: true });
  const review = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("review-"));
  assert.ok(review);
  const reviewRoot = path.join(value.worktreeRoot, review.name);
  assert.equal(await git(reviewRoot, "rev-parse", "HEAD"), value.baseCommit);
  assert.equal((await git(reviewRoot, "diff", "--cached", "--name-only")).trim(), "fixture/allowed.txt");
  assert.equal(await fsPromises.readFile(path.join(value.repository, "fixture", "allowed.txt"), "utf8"), "before\n");
});

test("guarded writer handoff faults produce stable fail-closed verifier codes", async (t) => {
  const invalid = await writerFixture(t);
  await fsPromises.writeFile(invalid.manifestPath, "{\"version\":1");
  await assert.rejects(verifyGuardedWriterWorktree({
    assignment: invalid.assignment,
    terminalReceipt: invalid.terminalReceipt,
    artifactRoot: invalid.artifactRoot,
    worktreeRoot: invalid.worktreeRoot,
    fixtureRoot: invalid.repository,
    expectedMarker: marker,
  }), { code: "WRITER_HANDOFF_MANIFEST_INVALID" });

  const missing = await writerFixture(t);
  const manifest = JSON.parse(await fsPromises.readFile(missing.manifestPath, "utf8"));
  manifest.groups[0].cleanup.tasks[0].path = path.join(missing.worktreeRoot, "missing-writer");
  await fsPromises.writeFile(missing.manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(verifyGuardedWriterWorktree({
    assignment: missing.assignment,
    terminalReceipt: missing.terminalReceipt,
    artifactRoot: missing.artifactRoot,
    worktreeRoot: missing.worktreeRoot,
    fixtureRoot: missing.repository,
    expectedMarker: marker,
  }), { code: "WRITER_WORKTREE_UNAVAILABLE" });

  const gitFailure = await writerFixture(t);
  await assert.rejects(verifyGuardedWriterWorktree({
    assignment: gitFailure.assignment,
    terminalReceipt: gitFailure.terminalReceipt,
    artifactRoot: gitFailure.artifactRoot,
    worktreeRoot: gitFailure.worktreeRoot,
    fixtureRoot: gitFailure.repository,
    expectedMarker: marker,
    runGit: async () => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("bounded timeout") }),
  }), { code: "WRITER_GIT_VERIFICATION_FAILED" });
});

test("writer capture signs only bounded proof digests and marks liveWriter authorized", async () => {
  const values = fixture();
  const record = captureRecord(values);
  const checked = validateGuardedWriterCaptureRecord(record, {
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
  });
  assert.equal(checked.claims.managedWorktree, true);
  const capture = await captureProtectedGuardedWriterEvidence({
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    scenarioRunner: async () => record,
    signer: async ({ digest }) => crypto.sign(null, Buffer.from(digest), values.privateKey).toString("base64"),
    now: Date.parse(observedAt),
  });
  const evidence = capture.evidence["guarded-writer-integration"];
  assert.equal(evidence.authorization.liveWriter, "AUTHORIZED");
  assert.equal(evidence.authorization.disposableRoot, true);
  assert.equal(evidence.claims.autoIntegrated, false);
  assert.equal(JSON.stringify(capture).includes("omp-writer-test"), false);
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

function fakeChild(record, invocation) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end() { queueMicrotask(() => child.emit("exit", 0, null)); }, on() {} };
  child.kill = () => child.emit("exit", null, "SIGTERM");
  invocation.child = child;
  queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify(record)}\n`));
  return child;
}

test("Pi guarded writer runner uses one isolated Git fixture, one managed worktree root, and an allowlisted environment", async (t) => {
  const values = fixture();
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-writer-runner-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const configRoot = path.join(directory, "config");
  const fakeHome = path.join(directory, "owner-home");
  await fsPromises.mkdir(configRoot);
  await fsPromises.mkdir(fakeHome);
  const audited = await auditedPackageFixture(directory);
  const modelsFile = await providerFile(directory, values);
  const invocations = [];
  const runner = createPiGuardedWriterScenarioRunner({
    configRoot,
    packageRoot: audited.packageRoot,
    modelsFile,
    repositoryRoot: rootDir,
    piCommand: "/test/pi",
    expectedArtifact: audited.expected,
    versionProbe: async () => "0.84.1",
    homedir: () => fakeHome,
    hostEnvironment: {
      PATH: process.env.PATH,
      FIXTURE_API_KEY: "fixture-secret-value",
      OPENAI_API_KEY: "must-not-cross-boundary",
    },
    spawnImpl: (command, argv, options) => {
      const request = JSON.parse(fs.readFileSync(options.env.OMP_SUBAGENTS_GUARDED_WRITER_REQUEST, "utf8"));
      const invocation = { command, argv, options, request };
      invocations.push(invocation);
      return fakeChild(captureRecord(values), invocation);
    },
  });
  const result = await runner({
    id: "guarded-writer-integration",
    authorization: values.authorization,
    expectedSourceCommit: sourceCommit,
    environment: structuredClone(values.matrix.rows[0].environment),
    scenarioLimits: structuredClone(values.authorization.limits),
  });
  assert.equal(result.id, "guarded-writer-integration");
  assert.equal(invocations.length, 1);
  const [{ argv, options, request }] = invocations;
  assert.equal(options.shell, false);
  assert.equal(options.cwd, request.fixtureRoot);
  const realConfigRoot = await fsPromises.realpath(configRoot);
  assert.equal(options.cwd.startsWith(realConfigRoot), true);
  assert.equal(request.worktreeRoot.startsWith(realConfigRoot), true);
  assert.equal(request.artifactRoot.startsWith(realConfigRoot), true);
  assert.equal(request.artifactRoot, options.env.TMPDIR);
  assert.match(request.baseCommit, /^[a-f0-9]{40}$/u);
  assert.equal(argv.includes("--session-dir"), true);
  assert.equal(argv.includes("--session-id"), true);
  assert.equal(argv.includes("--no-session"), false);
  assert.equal(options.env.PI_SUBAGENTS_WORKTREE_DIR, request.worktreeRoot);
  assert.equal(options.env.FIXTURE_API_KEY, "fixture-secret-value");
  assert.equal(Object.hasOwn(options.env, "OPENAI_API_KEY"), false);
  const settings = JSON.parse(await fsPromises.readFile(path.join(request.agentRoot, "settings.json"), "utf8"));
  assert.equal(settings.defaultProjectTrust, "never");
  assert.equal(settings.extensions.length, 2);
  const models = JSON.parse(await fsPromises.readFile(path.join(request.agentRoot, "models.json"), "utf8"));
  assert.equal(models.providers["fixture-provider"].apiKey, "$FIXTURE_API_KEY");
  const upstreamConfig = JSON.parse(await fsPromises.readFile(path.join(request.agentRoot, "extensions", "subagent", "config.json"), "utf8"));
  assert.deepEqual(upstreamConfig, { artifactDir: "session" });
  const generated = await fsPromises.readFile(path.join(request.agentRoot, "agents", "omp-implementer.md"), "utf8");
  assert.match(generated, /managed\s+worktree supplied by the parent/u);
  assert.equal(await git(request.fixtureRoot, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("started Pi process without a unique terminal record is never accepted as writer evidence", async (t) => {
  const values = fixture();
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-writer-no-terminal-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const configRoot = path.join(directory, "config");
  const fakeHome = path.join(directory, "owner-home");
  await fsPromises.mkdir(configRoot);
  await fsPromises.mkdir(fakeHome);
  const audited = await auditedPackageFixture(directory);
  const modelsFile = await providerFile(directory, values);
  const runner = createPiGuardedWriterScenarioRunner({
    configRoot,
    packageRoot: audited.packageRoot,
    modelsFile,
    repositoryRoot: rootDir,
    piCommand: "/test/pi",
    expectedArtifact: audited.expected,
    versionProbe: async () => "0.84.1",
    homedir: () => fakeHome,
    hostEnvironment: { PATH: process.env.PATH, FIXTURE_API_KEY: "fixture-secret-value" },
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end() {}, on() {} };
      child.kill = () => child.emit("exit", null, "SIGTERM");
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    },
  });
  await assert.rejects(runner({
    id: "guarded-writer-integration",
    authorization: values.authorization,
    expectedSourceCommit: sourceCommit,
    environment: structuredClone(values.matrix.rows[0].environment),
    scenarioLimits: structuredClone(values.authorization.limits),
  }), { code: "WRITER_RUNNER_RECORD_MISSING" });
});

test("signing, staging, and post-capture source drift never produce a completed writer run", async (t) => {
  const values = fixture();
  const record = captureRecord(values);
  await assert.rejects(captureProtectedGuardedWriterEvidence({
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    scenarioRunner: async () => record,
    signer: async () => { throw Object.assign(new Error("signer interrupted"), { code: "SIGNER_INTERRUPTED" }); },
    now: Date.parse(observedAt),
  }), { code: "SIGNER_INTERRUPTED" });

  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-writer-cli-fault-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const configRoot = path.join(directory, "config");
  const outputDir = path.join(directory, "staging");
  const authorizationFile = path.join(directory, "authorization.json");
  await fsPromises.mkdir(configRoot);
  await fsPromises.mkdir(outputDir);
  await fsPromises.writeFile(authorizationFile, "{}\n");
  const argv = [
    "--run", "--yes", "--authorization-file", authorizationFile,
    "--config-root", configRoot, "--package-root", path.join(directory, "package"),
    "--provider-file", path.join(directory, "provider.json"),
    "--pi-command", "/test/pi", "--signer-command", "/test/signer",
    "--output-dir", outputDir, "--repository-root", rootDir, "--json",
  ];
  const dependencies = {
    rootDir,
    scenarioRunnerFactory: () => async () => record,
    signerFactory: () => async ({ digest }) => crypto.sign(null, Buffer.from(digest), values.privateKey).toString("base64"),
    releaseContractsLoader: () => ({ matrix: values.matrix, policy: values.policy }),
    trustPolicyLoader: () => values.trustPolicy,
    authorizationLoader: () => values.authorization,
    now: () => Date.parse(observedAt),
  };
  await assert.rejects(executeGuardedWriterEvidence(argv, {
    ...dependencies,
    sourceInspector: async () => ({ sourceCommit, clean: true }),
    writer: async () => { throw Object.assign(new Error("staging interrupted"), { code: "STAGING_INTERRUPTED" }); },
  }), { code: "STAGING_INTERRUPTED" });

  let sourceInspections = 0;
  let writerCalls = 0;
  await assert.rejects(executeGuardedWriterEvidence(argv, {
    ...dependencies,
    sourceInspector: async () => {
      sourceInspections += 1;
      return { sourceCommit: sourceInspections === 1 ? sourceCommit : "d".repeat(40), clean: true };
    },
    writer: async () => { writerCalls += 1; },
  }), { code: "GUARDED_WRITER_SOURCE_CHANGED" });
  assert.equal(writerCalls, 0);
});

test("guarded writer CLI is plan-only by default and cannot reuse implicit authorization", async () => {
  assert.equal(parseGuardedWriterEvidenceArgs([]).operation, "plan");
  assert.throws(() => parseGuardedWriterEvidenceArgs(["--run"]), /requires --yes/u);
  assert.throws(() => parseGuardedWriterEvidenceArgs(["--run", "--yes"]), /requires --authorization-file/u);
  let runnerCalls = 0;
  const result = await executeGuardedWriterEvidence(["--plan", "--json"], {
    rootDir,
    sourceInspector: async () => ({ sourceCommit, clean: true }),
    scenarioRunnerFactory: () => { runnerCalls += 1; return async () => null; },
    now: () => Date.parse(observedAt),
  });
  assert.equal(result.status, "PLAN");
  assert.equal(result.plan.runnable, false);
  assert.equal(result.plan.providerRequest, "NOT_STARTED");
  assert.equal(result.plan.automaticIntegration, false);
  assert.equal(result.plan.parentDiffVerification, "REQUIRED");
  assert.equal(result.plan.blockers.includes("TRUST_POLICY_UNAVAILABLE"), false);
  assert.equal(result.plan.blockers.includes("AUTHORIZATION_REQUIRED"), true);
  assert.equal(runnerCalls, 0);
});
