import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  M9_LIVE_EXPECTED_ASSERTIONS,
  parseM9LiveAcceptanceArgs,
  runPiM9Phase,
} from "../scripts/m9-live-acceptance.mjs";
import {
  M9_LIVE_CANDIDATE,
  M9_LIVE_PRICING,
  M9_LIVE_RECORD_TYPE,
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
  assert.throws(() => parseM9LiveAcceptanceArgs([
    "--run", "--yes",
    "--installation-root", "/tmp/only-my-pi-candidate",
    "--provider", "other",
    "--artifact-sha256", "a".repeat(64),
    "--output", "/tmp/evidence.json",
  ]), { code: "M9_LIVE_MODEL_UNSUPPORTED" });
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
