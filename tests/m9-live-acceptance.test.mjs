import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  executeM9LiveAcceptance,
  M9_LIVE_EXPECTED_ASSERTIONS,
  parseM9LiveAcceptanceArgs,
  runPiM9Phase,
} from "../scripts/m9-live-acceptance.mjs";
import {
  createM9LiveAcceptanceExtension,
  M9_LIVE_CANDIDATE,
  M9_LIVE_ERROR_TYPE,
  M9_LIVE_PRICING,
  M9_LIVE_RECORD_TYPE,
  M9_LIVE_REQUEST_ENV,
} from "../packages/subagents/release/m9-live-acceptance-extension.mjs";
import {
  upstreamProtectedEvidenceDigest,
  validateUpstreamCompatibilityProtectedEvidence,
} from "../scripts/lib/upstream-compatibility-gates.mjs";

test("M9 live CLI is plan-first and requires an explicit candidate root and source artifact", () => {
  const plan = parseM9LiveAcceptanceArgs(["--plan"]);
  assert.equal(plan.operation, "plan");
  assert.equal(plan.provider, "cc-switch-open-code-go");
  assert.equal(plan.model, "deepseek-v4-flash");
  assert.throws(() => parseM9LiveAcceptanceArgs(["--run"]), /requires --yes/u);
  const run = parseM9LiveAcceptanceArgs([
    "--run", "--yes",
    "--installation-root", "/tmp/only-my-pi-candidate",
    "--artifact-sha256", "a".repeat(64),
    "--output", "/tmp/evidence.json",
  ]);
  assert.equal(run.operation, "run");
  assert.equal(run.installationRoot, "/tmp/only-my-pi-candidate");
  const fullySpecified = parseM9LiveAcceptanceArgs([
    "--run", "--yes", "--json",
    "--config-root", "/tmp/only-my-pi-config",
    "--installation-root", "/tmp/only-my-pi-candidate",
    "--provider", "cc-switch-open-code-go",
    "--model", "deepseek-v4-flash",
    "--artifact-sha256", `sha256:${"b".repeat(64)}`,
    "--output", "/tmp/evidence.json",
  ]);
  assert.equal(fullySpecified.artifactSha256, "b".repeat(64));
  assert.equal(fullySpecified.configRoot, "/tmp/only-my-pi-config");
  assert.throws(() => parseM9LiveAcceptanceArgs([
    "--run", "--yes",
    "--installation-root", "/tmp/only-my-pi-candidate",
    "--provider", "other",
    "--artifact-sha256", "a".repeat(64),
    "--output", "/tmp/evidence.json",
  ]), { code: "M9_LIVE_MODEL_UNSUPPORTED" });
  for (const argv of [
    ["--plan", "--run"],
    ["--plan", "--yes"],
    ["--plan", "--plan"],
    ["--unknown"],
    ["--json", "--json"],
    ["--provider"],
    ["--provider", "!invalid"],
    ["--config-root", "relative"],
    ["--provider", "bad value"],
    ["--config-root", "/"],
  ]) assert.throws(() => parseM9LiveAcceptanceArgs(argv), { code: "M9_LIVE_ARGUMENT_INVALID" });
});

test("M9 live plan is source-aware, zero-execution, and exposes the exact protected contract", async () => {
  const args = parseM9LiveAcceptanceArgs(["--plan", "--json"]);
  const result = await executeM9LiveAcceptance(args);
  assert.ok(["PLAN", "PLAN_BLOCKED_SOURCE_DIRTY"].includes(result.status));
  assert.match(result.plan.sourceCommit, /^[a-f0-9]{40}$/u);
  assert.equal(result.plan.providerRequests, "NOT_RUN_BY_POLICY");
  assert.equal(result.plan.writes, "ZERO");
  assert.deepEqual(result.plan.pricing, M9_LIVE_PRICING);
  assert.deepEqual(result.plan.assertions, M9_LIVE_EXPECTED_ASSERTIONS);
});

test("candidate Pi M9 phase is shell-free, scrubbed, and loads only candidate subagents plus the acceptance extension", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-phase-config-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const installationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-phase-candidate-"));
  t.after(() => fs.rm(installationRoot, { recursive: true, force: true }));
  const subagentsEntry = path.join(installationRoot, "subagents.ts");
  await fs.writeFile(subagentsEntry, "// fixture\n");
  let invocation;
  const record = {
    formatVersion: 1,
    type: M9_LIVE_RECORD_TYPE,
    phase: "main",
    status: "PASS",
    sourceCommit: "a".repeat(40),
    model: { provider: "provider", id: "model" },
    candidate: M9_LIVE_CANDIDATE,
    pricing: M9_LIVE_PRICING,
    candidateAuditDigest: `sha256:${"b".repeat(64)}`,
    candidateContractDigest: `sha256:${"c".repeat(64)}`,
    assertions: [],
    usage: { tokens: 0, costUsd: 0, toolCalls: 0, meteredTerminals: 0 },
  };
  const result = await runPiM9Phase({
    piCommand: path.join(installationRoot, "pi"),
    phase: "main",
    request: {
      formatVersion: 1,
      phase: "main",
      sourceCommit: "a".repeat(40),
      repositoryRoot: process.cwd(),
      configRoot,
      candidateInstallationRoot: installationRoot,
      candidateAuditDigest: `sha256:${"b".repeat(64)}`,
      candidateContractDigest: `sha256:${"c".repeat(64)}`,
      model: { provider: "provider", id: "model" },
      pricing: M9_LIVE_PRICING,
      runNonce: "fixture",
      webAuthorized: true,
    },
    configRoot,
    subagentsEntry,
    timeoutMs: 10_000,
    spawnImpl(command, args, options) {
      const child = new EventEmitter();
      child.pid = 999_999;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {};
      invocation = { command, args, options };
      process.nextTick(() => {
        child.stdout.write(`${JSON.stringify(record)}\n`);
        child.stdout.end();
        setImmediate(() => child.emit("exit", 0, null));
      });
      return child;
    },
  });
  assert.equal(result.status, "PASS");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.PI_CODING_AGENT_DIR, configRoot);
  assert.equal(invocation.options.env.OPENCODE_API_KEY, undefined);
  assert.equal(invocation.options.env.CODEX_API_KEY, undefined);
  assert.ok(invocation.args.includes("--no-extensions"));
  assert.equal(invocation.args.filter((entry) => entry === "--extension").length, 2);
  assert.equal(invocation.args.includes("--api-key"), false);
});

function fakePhaseChild(action) {
  const child = new EventEmitter();
  child.pid = 999_999;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  process.nextTick(() => action(child));
  return child;
}

function phaseFixture(configRoot, installationRoot) {
  return {
    piCommand: path.join(installationRoot, "pi"),
    phase: "main",
    request: {
      formatVersion: 1,
      phase: "main",
      sourceCommit: "a".repeat(40),
      repositoryRoot: process.cwd(),
      configRoot,
      candidateInstallationRoot: installationRoot,
      candidateAuditDigest: `sha256:${"b".repeat(64)}`,
      candidateContractDigest: `sha256:${"c".repeat(64)}`,
      model: { provider: "provider", id: "model" },
      pricing: M9_LIVE_PRICING,
      runNonce: "fixture-errors",
      webAuthorized: true,
    },
    configRoot,
    subagentsEntry: path.join(installationRoot, "subagents.ts"),
    timeoutMs: 100,
  };
}

test("candidate Pi phase classifies start, process, exit, missing, extension, ambiguity, and timeout failures", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-errors-config-"));
  const installationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-errors-candidate-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  t.after(() => fs.rm(installationRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(installationRoot, "subagents.ts"), "// fixture\n");
  const fixture = phaseFixture(configRoot, installationRoot);

  await assert.rejects(runPiM9Phase({ ...fixture, spawnImpl() { throw new Error("start"); } }), { code: "M9_LIVE_START_FAILED" });
  await assert.rejects(runPiM9Phase({
    ...fixture,
    spawnImpl() { return fakePhaseChild((child) => child.emit("error", new Error("process"))); },
  }), { code: "M9_LIVE_PROCESS_FAILED" });
  await assert.rejects(runPiM9Phase({
    ...fixture,
    spawnImpl() { return fakePhaseChild((child) => child.emit("exit", 2, null)); },
  }), { code: "M9_LIVE_PHASE_FAILED" });
  await assert.rejects(runPiM9Phase({
    ...fixture,
    spawnImpl() { return fakePhaseChild((child) => child.emit("exit", 0, null)); },
  }), { code: "M9_LIVE_RECORD_MISSING" });
  await assert.rejects(runPiM9Phase({
    ...fixture,
    spawnImpl() {
      return fakePhaseChild((child) => {
        child.stdout.end(`${JSON.stringify({ type: M9_LIVE_ERROR_TYPE, code: "M9_FIXTURE_REJECTED" })}\n`);
        setImmediate(() => child.emit("exit", 0, null));
      });
    },
  }), { code: "M9_FIXTURE_REJECTED" });
  await assert.rejects(runPiM9Phase({
    ...fixture,
    spawnImpl() {
      return fakePhaseChild((child) => {
        const record = { type: M9_LIVE_RECORD_TYPE };
        child.stdout.write(`${JSON.stringify(record)}\n${JSON.stringify(record)}\n`);
      });
    },
  }), { code: "M9_LIVE_RECORD_AMBIGUOUS" });
  await assert.rejects(runPiM9Phase({
    ...fixture,
    timeoutMs: 5,
    spawnImpl() { return fakePhaseChild(() => {}); },
  }), { code: "M9_LIVE_TIMEOUT" });
  await assert.rejects(runPiM9Phase({
    ...fixture,
    spawnImpl() {
      return fakePhaseChild((child) => {
        child.stderr.write("not-json\n");
        child.stdout.write(Buffer.alloc((1024 * 1024) + 1, 0x78));
        setImmediate(() => child.emit("exit", 0, null));
      });
    },
  }), (error) => error.code === "M9_LIVE_PHASE_FAILED" && error.outputTruncated === true);
});

test("M9 extension emits only a stable error record for unavailable or drifted requests", async (t) => {
  const originalRequest = process.env[M9_LIVE_REQUEST_ENV];
  const originalConfig = process.env.PI_CODING_AGENT_DIR;
  const output = [];
  t.after(() => {
    if (originalRequest === undefined) delete process.env[M9_LIVE_REQUEST_ENV];
    else process.env[M9_LIVE_REQUEST_ENV] = originalRequest;
    if (originalConfig === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalConfig;
  });

  let handler;
  createM9LiveAcceptanceExtension({ writeRecord: (record) => output.push(record) })({ on(_event, callback) { handler = callback; } });
  delete process.env[M9_LIVE_REQUEST_ENV];
  await handler({}, {});
  assert.equal(output.pop().code, "M9_LIVE_REQUEST_UNAVAILABLE");
  await handler({}, {});
  assert.equal(output.length, 0, "a session-scoped extension must run at most once");

  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-extension-repo-"));
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-extension-config-"));
  const installationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m9-extension-install-"));
  t.after(() => Promise.all([repositoryRoot, configRoot, installationRoot].map((root) => fs.rm(root, { recursive: true, force: true }))));
  const requestFile = path.join(configRoot, "request.json");
  await fs.writeFile(requestFile, `${JSON.stringify({
    candidateAuditDigest: `sha256:${"a".repeat(64)}`,
    candidateContractDigest: `sha256:${"b".repeat(64)}`,
    candidateInstallationRoot: installationRoot,
    configRoot,
    formatVersion: 1,
    model: { id: "deepseek-v4-flash", provider: "cc-switch-open-code-go" },
    phase: "main",
    pricing: M9_LIVE_PRICING,
    repositoryRoot,
    runNonce: "fixture",
    sourceCommit: "c".repeat(40),
    webAuthorized: true,
  })}\n`);
  process.env[M9_LIVE_REQUEST_ENV] = requestFile;
  process.env.PI_CODING_AGENT_DIR = await fs.realpath(configRoot);
  let driftHandler;
  createM9LiveAcceptanceExtension({ writeRecord: (record) => output.push(record) })({ on(_event, callback) { driftHandler = callback; } });
  await driftHandler({}, { model: { provider: "other", id: "model" } });
  assert.equal(output.pop().code, "M9_LIVE_MODEL_DRIFT");

  for (const [name, version] of [["pi-subagents", "0.57.0"], ["pi-web-access", "0.25.0"]]) {
    const packageRoot = path.join(installationRoot, "node_modules", name);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name, version })}\n`);
  }
  let composerBoundaryHandler;
  createM9LiveAcceptanceExtension({ writeRecord: (record) => output.push(record) })({ on(_event, callback) { composerBoundaryHandler = callback; } });
  await composerBoundaryHandler({}, { model: { provider: "cc-switch-open-code-go", id: "deepseek-v4-flash" } });
  assert.equal(output.pop().code, "ENOENT");

  await fs.writeFile(requestFile, "{}\n");
  let malformedHandler;
  createM9LiveAcceptanceExtension({ writeRecord: (record) => output.push(record) })({ on(_event, callback) { malformedHandler = callback; } });
  await malformedHandler({}, { model: { provider: "cc-switch-open-code-go", id: "deepseek-v4-flash" } });
  assert.equal(output.pop().code, "M9_LIVE_REQUEST_INVALID");
  assert.throws(() => createM9LiveAcceptanceExtension({ writeRecord: true }), TypeError);
});

test("U9 evidence is exact candidate-, source-, digest-, privacy-, and assertion-bound", () => {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-upstream-compatibility-protected-evidence",
    gateId: "U9",
    evidenceId: "m9-candidate-live-readonly-matrix",
    sourceCommit: "a".repeat(40),
    status: "PASS",
    createdAt: "2026-08-28T00:00:00.000Z",
    candidate: {
      piVersion: "0.84.3",
      subagentsVersion: "0.57.0",
      webAccessVersion: "0.25.0",
      provider: "cc-switch-open-code-go",
      model: "deepseek-v4-flash",
    },
    pricing: M9_LIVE_PRICING,
    artifacts: {
      sourceArtifactSha256: `sha256:${"b".repeat(64)}`,
      candidateAuditDigest: `sha256:${"c".repeat(64)}`,
      contractDigest: `sha256:${"d".repeat(64)}`,
    },
    assertions: M9_LIVE_EXPECTED_ASSERTIONS.map((id, index) => ({ id, status: "PASS", digest: `sha256:${String((index % 9) + 1).repeat(64)}` })),
    usage: { tokens: 10, costUsd: 0.001, toolCalls: 1, meteredTerminals: 2 },
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false },
    authorization: { providerRequests: "AUTHORIZED", realPiHome: "AUTH_AND_PRIVATE_RUN_STATE_ONLY", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
  };
  document.evidenceDigest = upstreamProtectedEvidenceDigest(document);
  assert.equal(validateUpstreamCompatibilityProtectedEvidence(document, { expectedSourceCommit: "a".repeat(40) }).status, "PASS");
  const drift = structuredClone(document);
  drift.candidate.subagentsVersion = "0.57.1";
  drift.evidenceDigest = upstreamProtectedEvidenceDigest(drift);
  assert.throws(() => validateUpstreamCompatibilityProtectedEvidence(drift), /candidate identity/u);
});
