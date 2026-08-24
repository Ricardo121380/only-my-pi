import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureProtectedLiveEvidenceSet,
  createExternalDigestSigner,
  createProtectedLiveCaptureRecord,
  createProtectedLiveEvidenceCapturePlan,
  validateProtectedLiveCaptureRecord,
  writeProtectedLiveEvidenceStaging,
} from "../packages/subagents/release/live-evidence-capture.mjs";
import {
  liveEvidenceAuthorizationDigest,
  loadLiveEvidenceAuthorization,
  validateLiveEvidenceAuthorization,
} from "../packages/subagents/release/live-evidence-authorization.mjs";
import {
  createPiProtectedLiveScenarioRunner,
} from "../packages/subagents/release/live-evidence-pi-runner.mjs";
import {
  compileLiveEvidencePiModels,
  liveEvidenceProviderDescriptorDigest,
  validateLiveEvidenceProviderDescriptor,
} from "../packages/subagents/release/live-evidence-provider.mjs";
import {
  executeProtectedLiveEvidenceScenario,
  protectedLivePublicErrorCode,
} from "../packages/subagents/release/live-evidence-extension.mjs";
import {
  loadProtectedEvidenceTrustPolicy,
  PROTECTED_EVIDENCE_REQUIREMENTS,
  protectedEvidenceTrustPolicyDigest,
} from "../packages/subagents/release/protected-evidence.mjs";
import { loadSubagentsReleaseContracts } from "../packages/subagents/release/compatibility.mjs";
import { sha256 } from "../packages/subagents/state/codec.mjs";
import {
  bindBackendRun,
  createPiSubagentsRpcV1CapabilityMatrix,
} from "../packages/subagents/index.mjs";
import {
  executeSubagentsLiveEvidence,
  parseSubagentsLiveEvidenceArgs,
  validateLiveCaptureRoots,
} from "../scripts/subagents-live-evidence.mjs";

const rootDir = path.resolve(".");
const sourceCommit = "a".repeat(40);
const observedAt = "2026-08-21T00:30:00.000Z";
const evidenceIds = ["live-agent-cancel", "live-agent-terminal", "live-batch-terminal"];

function fixture() {
  const { matrix, policy } = structuredClone(loadSubagentsReleaseContracts({ rootDir }));
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
      id: "capture-test-signer",
      status: "active",
      authorizationClass: "local-operator-protected-live",
      publicKeySpki: publicKeyBytes.toString("base64"),
      publicKeyFingerprint,
      evidenceIds,
      notBefore: "2026-08-21T00:00:00.000Z",
      notAfter: "2026-08-21T02:00:00.000Z",
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
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-live-evidence-authorization-v1.schema.json",
    formatVersion: 1,
    contractStatus: "operator-authorized-live",
    authorizationId: "capture-test-authorization",
    sourceCommit,
    matrixDigest: matrix.matrixDigest,
    policyDigest: policy.policyDigest,
    trustPolicyDigest: trustPolicy.policyDigest,
    compatibilityRowId: matrix.rows[0].id,
    evidenceIds,
    provider: {
      id: "fixture-provider",
      model: "fixture-model",
      configurationDigest: providerDescriptor.descriptorDigest,
      credentialEnvironment: ["FIXTURE_API_KEY"],
      declaredEndpointHosts: ["api.example.com"],
    },
    limits: {
      maxChildren: 4,
      maxConcurrency: 2,
      maxWallTimeMs: 60_000,
      maxOutputBytes: 65_536,
      maxTokens: 10_000,
      maxCostUsd: 2,
    },
    workspace: {
      mode: "disposable-read-only",
      realPiHome: "deny",
      mutation: "deny",
      web: "deny",
      mcp: "deny",
      projectTrust: "deny",
    },
    signer: {
      signerId: "capture-test-signer",
      publicKeyFingerprint,
      protocol: "digest-stdin-signature-stdout-v1",
    },
    approvedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-08-21T01:00:00.000Z",
  };
  authorization.authorizationDigest = liveEvidenceAuthorizationDigest(authorization);
  return { matrix, policy, privateKey, trustPolicy, authorization, providerDescriptor };
}

async function providerFile(directory, values) {
  const file = path.join(directory, "live-provider.json");
  await fsPromises.writeFile(file, `${JSON.stringify(values.providerDescriptor, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function captureRecord(id, values) {
  const requirement = PROTECTED_EVIDENCE_REQUIREMENTS[id];
  return createProtectedLiveCaptureRecord({
    id,
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
      authoritativeTerminals: requirement.minimumAuthoritativeTerminals,
      batchItemCount: requirement.minimumBatchItems,
      cancelObserved: requirement.claims.cancelObserved,
      backgroundResume: requirement.claims.backgroundResume,
      managedWorktree: requirement.claims.managedWorktree,
      parentDiffVerified: requirement.claims.parentDiffVerified,
      autoIntegrated: false,
    },
    proofs: requirement.requiredProofs.map((kind) => ({ kind, digest: sha256(`${id}:${kind}`) })),
    usage: {
      children: id === "live-batch-terminal" ? 2 : 1,
      concurrency: id === "live-batch-terminal" ? 2 : 1,
      elapsedMs: 10,
      rawOutputBytes: 128,
      tokens: 100,
      costUsd: 0.01,
    },
    privacy: {
      rawOutputStored: false,
      hostPathsStored: false,
      credentialsStored: false,
      sessionIdsStored: false,
    },
  });
}

function limitsForScenario(id, values) {
  const shape = id === "live-batch-terminal"
    ? { maxChildren: 2, maxConcurrency: 2 }
    : { maxChildren: 1, maxConcurrency: 1 };
  return {
    ...shape,
    maxWallTimeMs: values.authorization.limits.maxWallTimeMs,
    maxOutputBytes: values.authorization.limits.maxOutputBytes,
    maxTokens: values.authorization.limits.maxTokens,
    maxCostUsd: values.authorization.limits.maxCostUsd,
  };
}

test("capture plan is inert without live authorization and rejects a signer outside configured trust", () => {
  const values = fixture();
  let runnerCalls = 0;
  let signerCalls = 0;
  const noAuthorization = createProtectedLiveEvidenceCapturePlan({
    authorization: null,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
    scenarioRunner: () => { runnerCalls += 1; },
    signer: () => { signerCalls += 1; },
  });
  assert.equal(noAuthorization.runnable, false);
  assert.equal(noAuthorization.status, "AUTHORIZATION_REQUIRED");
  assert.equal(noAuthorization.providerRequest, "NOT_STARTED");
  assert.equal(noAuthorization.childDispatch, "NOT_STARTED");

  const checkedInTrust = loadProtectedEvidenceTrustPolicy({ rootDir });
  const unavailableAuthorization = {
    ...values.authorization,
    trustPolicyDigest: checkedInTrust.policyDigest,
  };
  unavailableAuthorization.authorizationDigest = liveEvidenceAuthorizationDigest(unavailableAuthorization);
  const unavailable = createProtectedLiveEvidenceCapturePlan({
    authorization: unavailableAuthorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: checkedInTrust,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  });
  assert.equal(unavailable.runnable, false);
  assert.equal(unavailable.status, "AUTHORIZATION_SIGNER_UNAVAILABLE");
  assert.equal(runnerCalls, 0);
  assert.equal(signerCalls, 0);
});

test("live Provider descriptor is digest-bound, authorization-bound, and compiles no literal credential", () => {
  const values = fixture();
  assert.equal(validateLiveEvidenceProviderDescriptor(values.providerDescriptor, {
    authorization: values.authorization,
  }).descriptorDigest, values.authorization.provider.configurationDigest);
  const compiled = compileLiveEvidencePiModels(values.providerDescriptor, { authorization: values.authorization });
  assert.equal(compiled.providers[values.authorization.provider.id].apiKey, "$FIXTURE_API_KEY");
  assert.equal(JSON.stringify(compiled).includes("fixture-secret-value"), false);
  assert.deepEqual(compiled.providers[values.authorization.provider.id].models.map((model) => model.id), ["fixture-model"]);

  const endpointDrift = structuredClone(values.providerDescriptor);
  endpointDrift.provider.baseUrl = "https://other.example.net/v1";
  endpointDrift.descriptorDigest = liveEvidenceProviderDescriptorDigest(endpointDrift);
  const endpointAuthorization = structuredClone(values.authorization);
  endpointAuthorization.provider.configurationDigest = endpointDrift.descriptorDigest;
  assert.throws(() => validateLiveEvidenceProviderDescriptor(endpointDrift, {
    authorization: endpointAuthorization,
  }), { code: "PROVIDER_ENDPOINT_DRIFT" });

  const unsafe = structuredClone(values.providerDescriptor);
  unsafe.provider.model.compat = { apiToken: "!credential-command" };
  unsafe.descriptorDigest = liveEvidenceProviderDescriptorDigest(unsafe);
  const unsafeAuthorization = structuredClone(values.authorization);
  unsafeAuthorization.provider.configurationDigest = unsafe.descriptorDigest;
  assert.throws(() => validateLiveEvidenceProviderDescriptor(unsafe, {
    authorization: unsafeAuthorization,
  }), { code: "PROVIDER_COMPAT_UNSAFE" });
});

test("authorized capture signs all Alpha read-only evidence and stages only low-sensitivity documents", async (t) => {
  const values = fixture();
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-live-capture-"));
  t.after(() => fsPromises.rm(root, { recursive: true, force: true }));
  const plan = createProtectedLiveEvidenceCapturePlan({
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  });
  assert.equal(plan.runnable, true);
  assert.deepEqual(plan.evidenceIds, evidenceIds);

  const scenarioBudgets = [];
  const capture = await captureProtectedLiveEvidenceSet({
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
    scenarioRunner: async ({ id, scenarioLimits }) => {
      scenarioBudgets.push({ id, ...scenarioLimits });
      return captureRecord(id, values);
    },
    signer: async ({ digest }) => crypto.sign(null, Buffer.from(digest), values.privateKey).toString("base64"),
  });
  assert.equal(capture.status, "PROTECTED_LIVE_EVIDENCE_CAPTURED");
  assert.equal(Object.values(capture.evidence).every((document) => !Object.hasOwn(document, "scope")), true);
  assert.deepEqual(capture.usage, {
    children: 4,
    elapsedMs: 30,
    rawOutputBytes: 384,
    tokens: 300,
    costUsd: 0.03,
  });
  assert.deepEqual(scenarioBudgets.map(({ id, maxChildren, maxConcurrency, maxTokens }) => ({ id, maxChildren, maxConcurrency, maxTokens })), [
    { id: "live-agent-cancel", maxChildren: 1, maxConcurrency: 1, maxTokens: 10_000 },
    { id: "live-agent-terminal", maxChildren: 1, maxConcurrency: 1, maxTokens: 9_900 },
    { id: "live-batch-terminal", maxChildren: 2, maxConcurrency: 2, maxTokens: 9_800 },
  ]);
  for (const id of evidenceIds) {
    assert.equal(capture.records[id].captureDigest, capture.evidence[id].attestation.captureDigest);
  }
  assert.deepEqual(Object.keys(capture.evidence), evidenceIds);
  for (const document of Object.values(capture.evidence)) {
    assert.equal(document.contractStatus, "protected-live-evidence");
    assert.equal(document.status, "PASS");
    assert.equal(document.attestation.authorizationDigest, values.authorization.authorizationDigest);
    const serialized = JSON.stringify(document);
    assert.equal(serialized.includes("FIXTURE_API_KEY"), false);
    assert.equal(serialized.includes(root), false);
  }

  const outputDir = path.join(root, "staging");
  await fsPromises.mkdir(outputDir);
  const staged = await writeProtectedLiveEvidenceStaging(capture, { outputDir });
  assert.deepEqual(staged.files, [
    "live-agent-cancel.json",
    "live-agent-terminal.json",
    "live-batch-terminal.json",
    "capture-manifest.json",
  ]);
  const captureManifest = JSON.parse(await fsPromises.readFile(path.join(outputDir, "capture-manifest.json"), "utf8"));
  assert.deepEqual(captureManifest.usage, capture.usage);
  assert.deepEqual(Object.keys(captureManifest.captureRecords), evidenceIds);
  assert.equal(JSON.stringify(captureManifest).includes("fixture-secret-value"), false);
  for (const id of evidenceIds) {
    assert.equal(captureManifest.captureRecords[id].captureDigest, capture.evidence[id].attestation.captureDigest);
  }
  await assert.rejects(writeProtectedLiveEvidenceStaging(capture, { outputDir }), { code: "CAPTURE_OUTPUT_NOT_EMPTY" });
});

test("authorization, capture tampering, replay, budget overflow, and symlink inputs fail closed", async (t) => {
  const values = fixture();
  const valid = captureRecord("live-agent-terminal", values);
  const tampered = structuredClone(valid);
  tampered.claims.authoritativeTerminals = 2;
  assert.throws(() => validateProtectedLiveCaptureRecord(tampered, {
    ...values,
    expectedSourceCommit: sourceCommit,
  }), { code: "CAPTURE_DIGEST_MISMATCH" });

  const overBudget = createProtectedLiveCaptureRecord({ ...valid, usage: { ...valid.usage, tokens: 10_001 } });
  assert.throws(() => validateProtectedLiveCaptureRecord(overBudget, {
    ...values,
    expectedSourceCommit: sourceCommit,
  }), { code: "CAPTURE_BUDGET_EXCEEDED" });

  assert.throws(() => validateLiveEvidenceAuthorization(values.authorization, {
    ...values,
    expectedSourceCommit: "b".repeat(40),
    now: Date.parse(observedAt),
  }), { code: "AUTHORIZATION_SOURCE_DRIFT" });
  assert.throws(() => validateLiveEvidenceAuthorization(values.authorization, {
    ...values,
    expectedSourceCommit: sourceCommit,
    now: Date.parse("2026-08-21T01:00:00.001Z"),
  }), { code: "AUTHORIZATION_EXPIRED" });

  const unsupportedBetaScope = structuredClone(values.authorization);
  unsupportedBetaScope.evidenceIds = ["background-resume"];
  unsupportedBetaScope.authorizationDigest = liveEvidenceAuthorizationDigest(unsupportedBetaScope);
  assert.throws(() => validateLiveEvidenceAuthorization(unsupportedBetaScope, {
    ...values,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  }), { code: "AUTHORIZATION_SCHEMA_INVALID" });

  const insufficientBatchConcurrency = structuredClone(values.authorization);
  insufficientBatchConcurrency.limits.maxConcurrency = 1;
  insufficientBatchConcurrency.authorizationDigest = liveEvidenceAuthorizationDigest(insufficientBatchConcurrency);
  assert.throws(() => validateLiveEvidenceAuthorization(insufficientBatchConcurrency, {
    ...values,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  }), { code: "AUTHORIZATION_LIMIT_INVALID" });

  const insufficientAggregateChildren = structuredClone(values.authorization);
  insufficientAggregateChildren.limits.maxChildren = 3;
  insufficientAggregateChildren.authorizationDigest = liveEvidenceAuthorizationDigest(insufficientAggregateChildren);
  assert.throws(() => validateLiveEvidenceAuthorization(insufficientAggregateChildren, {
    ...values,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  }), { code: "AUTHORIZATION_LIMIT_INVALID" });

  const aggregateTokenBudget = structuredClone(values.authorization);
  aggregateTokenBudget.limits.maxTokens = 250;
  aggregateTokenBudget.authorizationDigest = liveEvidenceAuthorizationDigest(aggregateTokenBudget);
  await assert.rejects(captureProtectedLiveEvidenceSet({
    authorization: aggregateTokenBudget,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
    scenarioRunner: async ({ id }) => captureRecord(id, { ...values, authorization: aggregateTokenBudget }),
    signer: async ({ digest }) => crypto.sign(null, Buffer.from(digest), values.privateKey).toString("base64"),
  }), { code: "CAPTURE_BUDGET_EXCEEDED" });

  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-live-auth-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const real = path.join(directory, "authorization.json");
  const linked = path.join(directory, "linked.json");
  await fsPromises.writeFile(real, `${JSON.stringify(values.authorization)}\n`);
  await fsPromises.symlink(real, linked);
  assert.throws(() => loadLiveEvidenceAuthorization(linked, {
    ...values,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
  }), { code: "AUTHORIZATION_PATH_INVALID" });
});

test("external signer receives only one digest and rejects noncanonical output", async (t) => {
  const values = fixture();
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-live-signer-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const key = values.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const signerFile = path.join(directory, "signer.mjs");
  await fsPromises.writeFile(signerFile, `#!/usr/bin/env node\nimport crypto from "node:crypto";\nlet input="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{const key=crypto.createPrivateKey({key:Buffer.from(${JSON.stringify(key)},"base64"),format:"der",type:"pkcs8"});process.stdout.write(crypto.sign(null,Buffer.from(input.trim()),key).toString("base64")+"\\n")});\n`);
  await fsPromises.chmod(signerFile, 0o700);
  const signer = createExternalDigestSigner({ command: signerFile });
  const digest = sha256("external-signer-test");
  const signature = await signer({ digest });
  assert.equal(crypto.verify(null, Buffer.from(digest), values.privateKey.asymmetricKeyType === "ed25519"
    ? crypto.createPublicKey(values.privateKey)
    : null, Buffer.from(signature, "base64")), true);

  const invalidFile = path.join(directory, "invalid-signer.mjs");
  await fsPromises.writeFile(invalidFile, "#!/usr/bin/env node\nprocess.stdout.write('not-a-signature\\n')\n");
  await fsPromises.chmod(invalidFile, 0o700);
  const invalidSigner = createExternalDigestSigner({ command: invalidFile });
  await assert.rejects(invalidSigner({ digest }), { code: "SIGNER_SIGNATURE_INVALID" });
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

function fakePiChild(record, invocation) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    end() { queueMicrotask(() => child.emit("exit", 0, null)); },
  };
  child.kill = () => child.emit("exit", null, "SIGTERM");
  invocation.child = child;
  queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify(record)}\n`));
  return child;
}

test("Pi scenario runner uses an isolated fixture workspace, governed reviewer, explicit provider tuple, and credential allowlist", async (t) => {
  const values = fixture();
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-live-pi-runner-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const configRoot = path.join(directory, "config");
  const fakeHome = path.join(directory, "home-owner");
  await fsPromises.mkdir(configRoot);
  await fsPromises.mkdir(fakeHome);
  const audited = await auditedPackageFixture(directory);
  const modelsFile = await providerFile(directory, values);
  const invocation = {};
  const runner = createPiProtectedLiveScenarioRunner({
    configRoot,
    packageRoot: audited.packageRoot,
    modelsFile,
    repositoryRoot: rootDir,
    piCommand: "/test/pi",
    expectedArtifact: audited.expected,
    versionProbe: async () => "0.84.1",
    homedir: () => fakeHome,
    hostEnvironment: {
      PATH: "/usr/bin:/bin",
      FIXTURE_API_KEY: "fixture-secret-value",
      OPENAI_API_KEY: "must-not-cross-boundary",
    },
    spawnImpl: (command, argv, options) => {
      Object.assign(invocation, { command, argv, options });
      return fakePiChild(captureRecord("live-agent-terminal", values), invocation);
    },
  });
  await assert.rejects(runner({
    id: "live-agent-terminal",
    authorization: values.authorization,
    expectedSourceCommit: sourceCommit,
    environment: { ...values.matrix.rows[0].environment, node: "0.0.0" },
    scenarioLimits: limitsForScenario("live-agent-terminal", values),
  }), { code: "LIVE_RUNNER_ENVIRONMENT_MISMATCH" });
  assert.equal(invocation.command, undefined);
  const record = await runner({
    id: "live-agent-terminal",
    authorization: values.authorization,
    expectedSourceCommit: sourceCommit,
    environment: structuredClone(values.matrix.rows[0].environment),
    scenarioLimits: limitsForScenario("live-agent-terminal", values),
  });
  assert.equal(record.id, "live-agent-terminal");
  assert.equal(invocation.command, "/test/pi");
  assert.deepEqual(invocation.argv.slice(0, 6), ["--mode", "rpc", "--provider", "fixture-provider", "--model", "fixture-model"]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.detached, process.platform !== "win32");
  assert.equal(invocation.options.env.FIXTURE_API_KEY, "fixture-secret-value");
  assert.equal(Object.hasOwn(invocation.options.env, "OPENAI_API_KEY"), false);
  assert.equal(invocation.options.env.PI_SUBAGENT_MAX_DEPTH, "1");
  assert.equal(invocation.options.env.PI_SUBAGENT_MAX_SPAWNS_PER_SESSION, "1");
  const realConfigRoot = await fsPromises.realpath(configRoot);
  assert.equal(invocation.options.env.HOME.startsWith(realConfigRoot), true);
  assert.equal(invocation.options.env.PI_CODING_AGENT_DIR.startsWith(realConfigRoot), true);
  assert.equal(invocation.options.cwd.startsWith(realConfigRoot), true);
  assert.equal(invocation.options.cwd.endsWith(`${path.sep}workspace`), true);
  assert.notEqual(invocation.options.cwd, rootDir);
  assert.deepEqual(JSON.parse(await fsPromises.readFile(path.join(invocation.options.cwd, "package.json"), "utf8")), {
    name: "only-my-pi-live-evidence-fixture",
    private: true,
    version: "0.0.0",
  });
  assert.match(await fsPromises.readFile(path.join(invocation.options.cwd, "README.md"), "utf8"), /read-only synthetic files/iu);
  const settings = JSON.parse(await fsPromises.readFile(path.join(invocation.options.env.PI_CODING_AGENT_DIR, "settings.json"), "utf8"));
  assert.equal(settings.extensions.length, 2);
  assert.deepEqual(settings.packages, []);
  assert.deepEqual(settings.skills, []);
  const reviewer = await fsPromises.readFile(path.join(invocation.options.env.PI_CODING_AGENT_DIR, "agents", "omp-reviewer.md"), "utf8");
  assert.match(reviewer, /^---\nname: omp-reviewer\n/);
  assert.match(reviewer, /tools: read, grep, find, ls/u);
  assert.deepEqual(JSON.parse(await fsPromises.readFile(path.join(
    invocation.options.env.PI_CODING_AGENT_DIR,
    "extensions",
    "subagent",
    "config.json",
  ), "utf8")), { artifactDir: "temp" });
  assert.deepEqual(
    JSON.parse(await fsPromises.readFile(path.join(invocation.options.env.PI_CODING_AGENT_DIR, "models.json"), "utf8")),
    compileLiveEvidencePiModels(values.providerDescriptor, { authorization: values.authorization }),
  );

  const nonemptyRoot = path.join(directory, "nonempty-config");
  await fsPromises.mkdir(nonemptyRoot);
  await fsPromises.writeFile(path.join(nonemptyRoot, "unrelated.txt"), "do not touch\n");
  const nonemptyRunner = createPiProtectedLiveScenarioRunner({
    configRoot: nonemptyRoot,
    packageRoot: audited.packageRoot,
    modelsFile,
    repositoryRoot: rootDir,
    piCommand: "/test/pi",
    expectedArtifact: audited.expected,
    versionProbe: async () => "0.84.1",
    homedir: () => fakeHome,
    hostEnvironment: { PATH: "/usr/bin:/bin", FIXTURE_API_KEY: "fixture-secret-value" },
    spawnImpl: () => { throw new Error("must not spawn"); },
  });
  await assert.rejects(nonemptyRunner({
    id: "live-agent-terminal",
    authorization: values.authorization,
    expectedSourceCommit: sourceCommit,
    environment: structuredClone(values.matrix.rows[0].environment),
    scenarioLimits: limitsForScenario("live-agent-terminal", values),
  }), { code: "LIVE_RUNNER_CONFIG_ROOT_NOT_EMPTY" });
  assert.equal(await fsPromises.readFile(path.join(nonemptyRoot, "unrelated.txt"), "utf8"), "do not touch\n");

  const invalidRepository = path.join(directory, "invalid-repository");
  const invalidConfigRoot = path.join(directory, "invalid-repository-config");
  await fsPromises.mkdir(invalidRepository);
  await fsPromises.mkdir(invalidConfigRoot);
  await fsPromises.writeFile(path.join(invalidRepository, "package.json"), "{\"name\":\"invalid-fixture\"}\n");
  let invalidSpawnCalls = 0;
  const invalidRepositoryRunner = createPiProtectedLiveScenarioRunner({
    configRoot: invalidConfigRoot,
    packageRoot: audited.packageRoot,
    modelsFile,
    repositoryRoot: invalidRepository,
    piCommand: "/test/pi",
    expectedArtifact: audited.expected,
    versionProbe: async () => "0.84.1",
    homedir: () => fakeHome,
    hostEnvironment: { PATH: "/usr/bin:/bin", FIXTURE_API_KEY: "fixture-secret-value" },
    spawnImpl: () => { invalidSpawnCalls += 1; throw new Error("must not spawn"); },
  });
  await assert.rejects(invalidRepositoryRunner({
    id: "live-agent-terminal",
    authorization: values.authorization,
    expectedSourceCommit: sourceCommit,
    environment: structuredClone(values.matrix.rows[0].environment),
    scenarioLimits: limitsForScenario("live-agent-terminal", values),
  }), { code: "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE" });
  assert.equal(invalidSpawnCalls, 0);
});

function extensionRequest(id, values) {
  return {
    id,
    authorizationDigest: values.authorization.authorizationDigest,
    sourceCommit,
    matrixDigest: values.matrix.matrixDigest,
    policyDigest: values.policy.policyDigest,
    trustPolicyDigest: values.trustPolicy.policyDigest,
    compatibilityRowId: values.authorization.compatibilityRowId,
    environment: structuredClone(values.matrix.rows[0].environment),
    limits: structuredClone(values.authorization.limits),
    repositoryRoot: rootDir,
  };
}

function extensionBackend({ metering = true, calls = {}, statusNotFound = 0 } = {}) {
  let sequence = 0;
  const capabilityMatrix = createPiSubagentsRpcV1CapabilityMatrix({ observedAt: 1, terminalTransport: true });
  const terminal = (handle) => ({
    authoritative: true,
    outcome: "completed",
    receiptId: sha256({ terminal: handle.handleId }),
    result: { verdict: "pass", findings: [], tested: [], unverified: [] },
    completion: metering ? { totalTokens: { total: 10 }, totalCost: { costUsd: 0.001 } } : {},
    processTerminal: { state: "observed" },
  });
  return {
    capabilityMatrix,
    async ensureReady() { return { capabilityMatrix }; },
    async launch({ handle }) {
      sequence += 1;
      const bound = bindBackendRun(handle, {
        backendId: "pi-subagents-rpc-v1",
        backendVersion: "0.45.2",
        protocolVersion: 1,
        lifecycle: "launch",
        requestId: `fixture-request-${sequence}`,
        backendRunId: `fixture-run-${sequence}`,
      });
      return { handle: bound, binding: bound.backendBindings[0] };
    },
    async awaitTerminal(handle) { return terminal(handle); },
    async status() {
      calls.status = (calls.status ?? 0) + 1;
      if (calls.status <= statusNotFound) throw Object.assign(new Error("not ready"), { code: "not_found" });
      return { data: { state: "running" } };
    },
    async stop(handle) { calls.stop = (calls.stop ?? 0) + 1; return { terminal: { ...terminal(handle), outcome: "cancelled" } }; },
    async interrupt(handle) { calls.interrupt = (calls.interrupt ?? 0) + 1; return { terminal: { ...terminal(handle), outcome: "interrupted" } }; },
  };
}

test("Pi capture extension composes Agent, cancel, and 2-item BatchSwarm through one backend", async () => {
  const values = fixture();
  for (const id of evidenceIds) {
    const calls = {};
    const record = await executeProtectedLiveEvidenceScenario(extensionRequest(id, values), extensionBackend({
      calls,
      statusNotFound: id === "live-agent-cancel" ? 1 : 0,
    }), {
      clock: () => Date.parse(observedAt),
    });
    const checked = validateProtectedLiveCaptureRecord(record, {
      authorization: values.authorization,
      matrix: values.matrix,
      policy: values.policy,
      trustPolicy: values.trustPolicy,
      expectedSourceCommit: sourceCommit,
    });
    assert.equal(checked.id, id);
    assert.equal(checked.claims.authoritativeTerminals >= PROTECTED_EVIDENCE_REQUIREMENTS[id].minimumAuthoritativeTerminals, true);
    assert.equal(checked.proofs.some((proof) => proof.kind === "usage-metering"), true);
    if (id === "live-batch-terminal") {
      assert.equal(checked.claims.batchItemCount, 2);
      assert.equal(checked.usage.concurrency, 2);
    }
    if (id === "live-agent-cancel") {
      assert.equal(calls.status, 2);
      assert.equal(calls.stop, 1);
      assert.equal(calls.interrupt, undefined);
    }
  }
  await assert.rejects(executeProtectedLiveEvidenceScenario(
    extensionRequest("live-agent-terminal", values),
    extensionBackend({ metering: false }),
    { clock: () => Date.parse(observedAt) },
  ), { code: "CAPTURE_USAGE_METERING_UNAVAILABLE" });

  const signedActualRecords = await captureProtectedLiveEvidenceSet({
    authorization: values.authorization,
    matrix: values.matrix,
    policy: values.policy,
    trustPolicy: values.trustPolicy,
    expectedSourceCommit: sourceCommit,
    now: Date.parse(observedAt),
    scenarioRunner: async ({ id, authorization, expectedSourceCommit, compatibilityRowId, environment, scenarioLimits }) => (
      executeProtectedLiveEvidenceScenario({
        id,
        authorizationDigest: authorization.authorizationDigest,
        sourceCommit: expectedSourceCommit,
        matrixDigest: values.matrix.matrixDigest,
        policyDigest: values.policy.policyDigest,
        trustPolicyDigest: values.trustPolicy.policyDigest,
        compatibilityRowId,
        environment,
        limits: scenarioLimits,
        repositoryRoot: rootDir,
      }, extensionBackend(), { clock: () => Date.parse(observedAt) })
    ),
    signer: async ({ digest }) => crypto.sign(null, Buffer.from(digest), values.privateKey).toString("base64"),
  });
  for (const id of evidenceIds) {
    assert.equal(signedActualRecords.evidence[id].proofs.some((proof) => proof.kind === "usage-metering"), true);
  }
});

test("live extension preserves stable errors and normalizes upstream lowercase RPC codes", () => {
  assert.equal(protectedLivePublicErrorCode({ code: "CAPTURE_CANCEL_NOT_READY" }), "CAPTURE_CANCEL_NOT_READY");
  assert.equal(protectedLivePublicErrorCode({ code: "not_found" }), "UPSTREAM_NOT_FOUND");
  assert.equal(protectedLivePublicErrorCode(new TypeError("private detail")), "CAPTURE_EXTENSION_FAILED");
});

test("live evidence CLI defaults to a zero-execution plan and run parsing is fail-closed", async () => {
  const parsed = parseSubagentsLiveEvidenceArgs([]);
  assert.equal(parsed.operation, "plan");
  assert.equal(parsed.authorizationFile, null);
  assert.throws(() => parseSubagentsLiveEvidenceArgs(["--run"]), /--run requires --yes/u);
  assert.throws(() => parseSubagentsLiveEvidenceArgs(["--run", "--yes"]), /--run requires --authorization-file/u);
  assert.throws(() => parseSubagentsLiveEvidenceArgs(["--config-root", "relative"]), /must be absolute/u);

  let runnerFactoryCalls = 0;
  let signerFactoryCalls = 0;
  const result = await executeSubagentsLiveEvidence(["--plan", "--json"], {
    rootDir,
    sourceInspector: async () => ({ sourceCommit, clean: true }),
    scenarioRunnerFactory: () => { runnerFactoryCalls += 1; return async () => null; },
    signerFactory: () => { signerFactoryCalls += 1; return async () => null; },
    now: () => Date.parse(observedAt),
  });
  assert.equal(result.status, "PLAN");
  assert.equal(result.plan.runnable, false);
  assert.equal(result.plan.providerRequest, "NOT_STARTED");
  assert.equal(result.plan.childDispatch, "NOT_STARTED");
  assert.equal(result.plan.signerInvocation, "NOT_STARTED");
  assert.equal(result.plan.blockers.includes("TRUST_POLICY_UNAVAILABLE"), false);
  assert.equal(result.plan.blockers.includes("AUTHORIZATION_REQUIRED"), true);
  assert.equal(runnerFactoryCalls, 0);
  assert.equal(signerFactoryCalls, 0);
});

test("live evidence run rejects overlapping roots and source drift before staging", async (t) => {
  const values = fixture();
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omp-live-cli-"));
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }));
  const repositoryRoot = path.join(directory, "repository");
  const configRoot = path.join(directory, "config");
  const outputDir = path.join(directory, "output");
  const packageRoot = path.join(directory, "package");
  const nestedConfig = path.join(repositoryRoot, "nested-config");
  await Promise.all([
    fsPromises.mkdir(repositoryRoot),
    fsPromises.mkdir(configRoot),
    fsPromises.mkdir(outputDir),
    fsPromises.mkdir(packageRoot),
  ]);
  await fsPromises.mkdir(nestedConfig);
  assert.throws(() => validateLiveCaptureRoots({ repositoryRoot, configRoot: nestedConfig, outputDir }), {
    code: "LIVE_CAPTURE_ROOT_OVERLAP",
  });

  const authorizationFile = path.join(directory, "authorization.json");
  await fsPromises.writeFile(authorizationFile, `${JSON.stringify(values.authorization)}\n`);
  let sourceInspections = 0;
  let writerCalls = 0;
  await assert.rejects(executeSubagentsLiveEvidence([
    "--run", "--yes",
    "--authorization-file", authorizationFile,
    "--config-root", configRoot,
    "--package-root", packageRoot,
    "--provider-file", path.join(directory, "provider.json"),
    "--repository-root", repositoryRoot,
    "--pi-command", path.join(directory, "pi"),
    "--signer-command", path.join(directory, "signer"),
    "--output-dir", outputDir,
  ], {
    sourceInspector: async () => {
      sourceInspections += 1;
      return { sourceCommit, clean: sourceInspections === 1 };
    },
    releaseContractsLoader: () => ({ matrix: values.matrix, policy: values.policy }),
    trustPolicyLoader: () => values.trustPolicy,
    authorizationLoader: () => values.authorization,
    scenarioRunnerFactory: () => async ({ id }) => captureRecord(id, values),
    signerFactory: () => async ({ digest }) => crypto.sign(null, Buffer.from(digest), values.privateKey).toString("base64"),
    writer: async () => { writerCalls += 1; return { status: "must-not-write" }; },
    now: () => Date.parse(observedAt),
  }), { code: "LIVE_CAPTURE_SOURCE_CHANGED" });
  assert.equal(sourceInspections, 2);
  assert.equal(writerCalls, 0);
  assert.deepEqual(await fsPromises.readdir(outputDir), []);
});
