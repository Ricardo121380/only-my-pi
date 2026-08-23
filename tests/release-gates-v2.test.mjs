import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  gatesForPromotion,
  loadReleaseGatesV2Manifest,
  releaseGatesV2Digest,
  REQUIRED_RELEASE_GATES_V2_EXTENSION_IDS,
  resolveReleaseGateV2,
  resolveReleaseGatesV2,
  validateReleaseGatesV2Manifest,
} from "../scripts/lib/release-gates-v2.mjs";
import {
  inspectSubagentsReleaseGates,
  parseSubagentsReleaseGateArgs,
  runSubagentsReleaseVerification,
  validateProtectedEvidenceImportCommit,
  validateProtectedEvidenceImportPaths,
  validateSubagentsReleaseReport,
} from "../scripts/subagents-release-gates.mjs";
import {
  compatibilityMatrixDigest,
  loadSubagentsReleaseContracts,
} from "../packages/subagents/release/compatibility.mjs";
import {
  createProtectedEvidenceDocument,
  PROTECTED_EVIDENCE_REQUIREMENTS,
  protectedEvidenceSigningDigest,
  protectedEvidenceTrustPolicyDigest,
} from "../packages/subagents/release/protected-evidence.mjs";
import { sha256 as stateSha256 } from "../packages/subagents/state/codec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function manifest() {
  return structuredClone(loadReleaseGatesV2Manifest());
}

test("release-gates-v2 digest-pins all v1 gates and adds the exact S5 extension set", () => {
  const checked = manifest();
  const resolved = resolveReleaseGatesV2(checked);
  assert.equal(checked.base.path, "verification/release-gates-v1.json");
  assert.match(checked.base.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(releaseGatesV2Digest(checked), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(resolved.length, 31);
  assert.deepEqual(checked.gates.map((gate) => gate.id), [...REQUIRED_RELEASE_GATES_V2_EXTENSION_IDS]);
  assert.equal(new Set(resolved.map((gate) => gate.id)).size, resolved.length);
});

test("Preview is deterministic while higher promotions expose exact protected evidence gates", () => {
  const checked = manifest();
  const preview = gatesForPromotion(checked, "preview");
  assert.equal(preview.some((gate) => gate.execution === "protected-evidence"), false);
  assert.ok(preview.some((gate) => gate.id === "subagent-security-redteam"));
  assert.ok(preview.some((gate) => gate.id === "license-provenance-check"));

  const alpha = gatesForPromotion(checked, "alpha");
  assert.deepEqual(alpha.filter((gate) => gate.execution === "protected-evidence").map((gate) => gate.id), [
    "pi-subagents-live-readonly-smoke",
  ]);
  const beta = gatesForPromotion(checked, "beta");
  assert.deepEqual(beta.filter((gate) => gate.execution === "protected-evidence").map((gate) => gate.id), [
    "worktree-writer-e2e",
    "pi-subagents-live-readonly-smoke",
    "pi-subagents-background-resume-smoke",
    "pi-subagents-live-writer-smoke",
  ]);
});

test("protected gates have no executable command and bind an exact evidence-id set", () => {
  const checked = manifest();
  const expected = {
    "worktree-writer-e2e": ["guarded-writer-integration"],
    "pi-subagents-live-readonly-smoke": ["live-agent-cancel", "live-agent-terminal", "live-batch-terminal"],
    "pi-subagents-background-resume-smoke": ["background-resume"],
    "pi-subagents-live-writer-smoke": ["guarded-writer-integration"],
  };
  for (const [id, evidenceIds] of Object.entries(expected)) {
    const gate = resolveReleaseGateV2(checked, id);
    assert.equal(gate.execution, "protected-evidence");
    assert.equal(gate.command, null);
    assert.deepEqual(gate.args, []);
    assert.equal(gate.defaultStatus, "NOT_RUN_BY_POLICY");
    assert.deepEqual(gate.evidenceIds, evidenceIds);
  }
});

test("v2 gate validation rejects base drift, command drift, executable protected gates, and promotion widening", () => {
  const baseDrift = manifest();
  baseDrift.base.digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateReleaseGatesV2Manifest(baseDrift), /base release-gates-v1 digest drift/);

  const commandDrift = manifest();
  commandDrift.gates[0].args.push("--unsafe");
  assert.throws(() => validateReleaseGatesV2Manifest(commandDrift), /command\/argv differs/);

  const executableProtected = manifest();
  const protectedGate = executableProtected.gates.find((gate) => gate.id === "pi-subagents-live-readonly-smoke");
  protectedGate.command = "node";
  protectedGate.args = ["unsafe.mjs"];
  assert.throws(() => validateReleaseGatesV2Manifest(executableProtected), /evidence-only/);

  const evidenceSetDrift = manifest();
  evidenceSetDrift.gates.find((gate) => gate.id === "pi-subagents-live-readonly-smoke").evidenceIds.pop();
  assert.throws(() => validateReleaseGatesV2Manifest(evidenceSetDrift), /evidence-only/);

  const promotionWidening = manifest();
  promotionWidening.gates.find((gate) => gate.id === "resource-leak-check").channels = ["preview", "stable"];
  assert.throws(() => validateReleaseGatesV2Manifest(promotionWidening), /promotion channels differ/);
});

test("v2 runner has an explicit execution flag but no arbitrary manifest override", () => {
  assert.deepEqual(parseSubagentsReleaseGateArgs(["--run", "--promotion", "preview"]), {
    promotion: "preview",
    gate: null,
    json: false,
    help: false,
    run: true,
    output: null,
    sourceCommit: null,
    protectedEvidence: {},
  });
  assert.throws(() => parseSubagentsReleaseGateArgs(["--manifest", "package.json"]), /unknown argument/);
  assert.throws(() => parseSubagentsReleaseGateArgs(["--promotion", "stable", "--promotion", "preview"]), /duplicate/);
  assert.throws(() => parseSubagentsReleaseGateArgs(["--protected-evidence", "live-agent-terminal=verification/protected/terminal.json"]), /requires --run and --source-commit/);
  assert.throws(() => parseSubagentsReleaseGateArgs(["--run", "--source-commit", "a".repeat(40)]), /only valid with protected evidence/);
  assert.throws(() => parseSubagentsReleaseGateArgs(["--run", "--source-commit", "a".repeat(40), "--protected-evidence", "unknown=verification/protected/unknown.json"]), /unknown evidence id/);
  const protectedArgs = parseSubagentsReleaseGateArgs([
    "--run",
    "--promotion", "alpha",
    "--source-commit", "a".repeat(40),
    "--protected-evidence", "live-agent-terminal=verification/protected/terminal.json",
  ]);
  assert.equal(protectedArgs.sourceCommit, "a".repeat(40));
  assert.deepEqual(protectedArgs.protectedEvidence, { "live-agent-terminal": "verification/protected/terminal.json" });
  const report = inspectSubagentsReleaseGates(["--promotion", "alpha", "--json"]);
  assert.equal(report.executable, false);
  assert.equal(report.protectedDefault, "NOT_RUN_BY_POLICY");
  assert.deepEqual(report.protectedGateIds, ["pi-subagents-live-readonly-smoke"]);
});

test("evidence-only commit boundary allows only the matrix and exact imported files", () => {
  const evidence = {
    "live-agent-terminal": "verification/protected/live-agent-terminal.json",
    "live-agent-cancel": "verification/protected/live-agent-cancel.json",
  };
  const allowed = [
    "contracts/subagents/compatibility-matrix.json",
    ...Object.values(evidence),
  ];
  assert.deepEqual(validateProtectedEvidenceImportPaths(allowed, evidence), [...allowed].sort());
  assert.throws(
    () => validateProtectedEvidenceImportPaths([...allowed, "packages/subagents/index.mjs"], evidence),
    /unauthorized change/,
  );
  assert.throws(
    () => validateProtectedEvidenceImportPaths(allowed, evidence, { deletedPaths: ["docs/STATUS.md"] }),
    /cannot delete/,
  );
  assert.throws(
    () => validateProtectedEvidenceImportPaths(allowed.filter((entry) => !entry.endsWith("live-agent-cancel.json")), evidence),
    /was not introduced/,
  );
  assert.throws(
    () => validateProtectedEvidenceImportPaths(Object.values(evidence), evidence),
    /must update the compatibility matrix/,
  );
});

function git(repository, args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).trim();
}

function write(repository, relativePath, contents) {
  const target = path.join(repository, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

test("protected evidence import is a direct evidence-only Git child of its source", (t) => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "omp-evidence-git-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  git(repository, ["init", "--quiet"]);
  git(repository, ["config", "user.name", "only-my-pi test"]);
  git(repository, ["config", "user.email", "only-my-pi-test@example.invalid"]);
  write(repository, "contracts/subagents/compatibility-matrix.json", "{\"phase\":\"source\"}\n");
  write(repository, "contracts/subagents/protected-evidence-trust.json", "{\"trust\":\"source-pinned\"}\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "--quiet", "-m", "source"]);
  const sourceCommit = git(repository, ["rev-parse", "HEAD"]);
  const protectedEvidence = {
    "live-agent-terminal": "verification/protected/live-agent-terminal.json",
    "live-agent-cancel": "verification/protected/live-agent-cancel.json",
  };
  write(repository, "contracts/subagents/compatibility-matrix.json", "{\"phase\":\"evidence\"}\n");
  for (const [id, source] of Object.entries(protectedEvidence)) write(repository, source, `${id}\n`);
  git(repository, ["add", "."]);
  git(repository, ["commit", "--quiet", "-m", "evidence"]);
  const evidenceCommit = git(repository, ["rev-parse", "HEAD"]);
  assert.equal(validateProtectedEvidenceImportCommit(repository, sourceCommit, evidenceCommit, protectedEvidence), evidenceCommit);

  write(repository, "docs/unrelated.md", "not evidence\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "--quiet", "-m", "unrelated descendant"]);
  const descendant = git(repository, ["rev-parse", "HEAD"]);
  assert.throws(
    () => validateProtectedEvidenceImportCommit(repository, sourceCommit, descendant, protectedEvidence),
    /direct single-parent child/,
  );

  git(repository, ["switch", "--quiet", "--detach", sourceCommit]);
  write(repository, "contracts/subagents/compatibility-matrix.json", "{\"phase\":\"forged-evidence\"}\n");
  write(repository, "contracts/subagents/protected-evidence-trust.json", "{\"trust\":\"forged\"}\n");
  for (const [id, source] of Object.entries(protectedEvidence)) write(repository, source, `${id}-forged\n`);
  git(repository, ["add", "."]);
  git(repository, ["commit", "--quiet", "-m", "forged evidence"]);
  const forgedCommit = git(repository, ["rev-parse", "HEAD"]);
  assert.throws(
    () => validateProtectedEvidenceImportCommit(repository, sourceCommit, forgedCommit, protectedEvidence),
    /unauthorized change: contracts\/subagents\/protected-evidence-trust\.json/,
  );
});

function fakeSpawnRecorder(sourceCommit) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 12345;
    if (args.join(" ") === "run test:e2e") {
      const evidence = {
        formatVersion: 1,
        status: "PASS",
        sourceCommit,
        nodeVersion: process.version,
        piVersion: "0.84.1",
        tarball: { sha256: "a".repeat(64), integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
        install: { scripts: "disabled", offline: true, global: false, checkoutRuntime: false, dependencySeed: "repository-lockfile-local-tarball" },
        bootstrap: { dryRun: "PLAN_READY_ZERO_WRITE", firstApply: "COMMITTED", secondApply: "NO_CHANGES", doctor: "PASS", safe: "PASS", rollback: "COMMITTED", finalStatus: "NOT_INSTALLED", piNoModelStartup: "NO_MODEL_STARTUP_PASS" },
        provider: "NOT_RUN_BY_POLICY",
        credentials: "NOT_READ",
        realPiHome: "NOT_TOUCHED",
      };
      queueMicrotask(() => child.stdout.emit("data", `OMP_FRESH_TARBALL_EVIDENCE=${JSON.stringify(evidence)}\n`));
    }
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  };
  return { calls, spawnImpl };
}

function createAlphaEvidenceRoot(sourceCommit) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-release-alpha-"));
  for (const relative of [
    "verification/release-gates-v1.json",
    "verification/release-gates-v2.json",
    "contracts/subagents/promotion-policy.json",
  ]) {
    const target = path.join(temporaryRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
  }
  const { matrix, policy } = structuredClone(loadSubagentsReleaseContracts({ rootDir: root }));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const publicKeyFingerprint = stateSha256(publicKeyBytes);
  const ids = ["live-agent-cancel", "live-agent-terminal", "live-batch-terminal"];
  const trustPolicy = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-protected-evidence-trust-v1.schema.json",
    formatVersion: 1,
    contractStatus: "runtime-ready",
    id: "only-my-pi-subagents-protected-evidence-trust",
    algorithm: "ed25519",
    signers: [{
      id: "test-operator",
      status: "active",
      authorizationClass: "local-operator-protected-live",
      publicKeySpki: publicKeyBytes.toString("base64"),
      publicKeyFingerprint,
      evidenceIds: ids,
      notBefore: "2026-08-20T00:00:00.000Z",
      notAfter: "2026-08-22T00:00:00.000Z",
    }],
  };
  trustPolicy.policyDigest = protectedEvidenceTrustPolicyDigest(trustPolicy);
  fs.writeFileSync(
    path.join(temporaryRoot, "contracts/subagents/protected-evidence-trust.json"),
    `${JSON.stringify(trustPolicy, null, 2)}\n`,
  );
  const sources = Object.fromEntries(ids.map((id) => [id, `verification/protected/${id}.json`]));
  const row = matrix.rows[0];
  row.evidence = row.evidence.filter((entry) => !entry.startsWith("verification/protected/"));
  for (const id of ids) {
    const requirement = PROTECTED_EVIDENCE_REQUIREMENTS[id];
    row.scopes[requirement.scope] = "PASS";
    if (!row.evidence.includes(sources[id])) row.evidence.push(sources[id]);
  }
  row.evidence.sort();
  matrix.matrixDigest = compatibilityMatrixDigest(matrix);
  for (const evidencePath of matrix.rows.flatMap((candidate) => candidate.evidence)) {
    const target = path.join(temporaryRoot, evidencePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, "bounded contract evidence\n");
  }
  fs.writeFileSync(
    path.join(temporaryRoot, "contracts/subagents/compatibility-matrix.json"),
    `${JSON.stringify(matrix, null, 2)}\n`,
  );
  for (const id of ids) {
    const requirement = PROTECTED_EVIDENCE_REQUIREMENTS[id];
    const input = {
      formatVersion: 1,
      contractStatus: "protected-live-evidence",
      id,
      status: "PASS",
      sourceCommit,
      matrixDigest: matrix.matrixDigest,
      policyDigest: policy.policyDigest,
      trustPolicyDigest: trustPolicy.policyDigest,
      compatibilityRowId: row.id,
      observedAt: "2026-08-21T01:02:03.000Z",
      environment: structuredClone(row.environment),
      authorization: {
        providerRequests: "AUTHORIZED",
        liveChildDispatch: "AUTHORIZED",
        liveWriter: "NOT_RUN_BY_POLICY",
        realPiHome: "NOT_TOUCHED",
        disposableRoot: true,
      },
      privacy: { rawOutputStored: false, hostPathsStored: false, credentialsStored: false, sessionIdsStored: false },
      claims: {
        authoritativeTerminals: requirement.minimumAuthoritativeTerminals,
        batchItemCount: requirement.minimumBatchItems,
        ...requirement.claims,
        autoIntegrated: false,
      },
      proofs: requirement.requiredProofs.map((kind) => ({ kind, digest: stateSha256(`${id}:${kind}`) })),
      attestation: {
        class: "operator-authorized-live-import",
        signerId: "test-operator",
        publicKeyFingerprint,
        authorizationDigest: stateSha256(`authorization:${id}`),
        captureDigest: stateSha256(`capture:${id}`),
        signedPayloadDigest: `sha256:${"0".repeat(64)}`,
        signature: Buffer.alloc(64).toString("base64"),
      },
    };
    input.attestation.signedPayloadDigest = protectedEvidenceSigningDigest(input);
    input.attestation.signature = crypto.sign(
      null,
      Buffer.from(input.attestation.signedPayloadDigest),
      privateKey,
    ).toString("base64");
    const document = createProtectedEvidenceDocument(input);
    fs.writeFileSync(path.join(temporaryRoot, sources[id]), `${JSON.stringify(document, null, 2)}\n`);
  }
  return { temporaryRoot, sources };
}

test("v2 runner executes deterministic gates only and reports preview complete", async () => {
  const sourceCommit = "a".repeat(40);
  const fake = fakeSpawnRecorder(sourceCommit);
  const result = await runSubagentsReleaseVerification({
    promotion: "preview",
    rootDir: root,
    requireCleanSource: false,
    sourceCommit,
    spawnImpl: fake.spawnImpl,
  });
  assert.equal(result.report.status, "COMPLETE");
  assert.equal(result.report.passed, true);
  assert.equal(result.report.summary.protected, 0);
  assert.equal(fake.calls.length, result.report.summary.deterministic);
  assert.ok(fake.calls.every((call) => call.options.shell === false));
  assert.equal(validateSubagentsReleaseReport(result.report, { rootDir: root, expectedSourceCommit: sourceCommit }).ok, true);
  const tampered = structuredClone(result.report);
  tampered.gates[0].status = "FAIL";
  assert.throws(() => validateSubagentsReleaseReport(tampered, { rootDir: root }), /gate .*failed status|summary mismatch|aggregate status|promotion evaluation drift/);
});

test("v2 runner never spawns protected gates and blocks higher promotion without evidence", async () => {
  const sourceCommit = "b".repeat(40);
  const fake = fakeSpawnRecorder(sourceCommit);
  const result = await runSubagentsReleaseVerification({
    promotion: "alpha",
    rootDir: root,
    requireCleanSource: false,
    sourceCommit,
    spawnImpl: fake.spawnImpl,
  });
  assert.equal(result.report.status, "BLOCKED_PROTECTED_EVIDENCE");
  assert.equal(result.report.passed, false);
  assert.ok(result.report.gates.some((gate) => gate.id === "pi-subagents-live-readonly-smoke" && gate.status === "NOT_RUN_BY_POLICY"));
  assert.ok(fake.calls.every((call) => !call.args.includes("pi-subagents-live-readonly-smoke")));
});

test("authorized Alpha import validates files, marks protected gate PASS, and never executes a protected command", async (t) => {
  const sourceCommit = "c".repeat(40);
  const fixture = createAlphaEvidenceRoot(sourceCommit);
  t.after(() => fs.rmSync(fixture.temporaryRoot, { recursive: true, force: true }));
  const fake = fakeSpawnRecorder(sourceCommit);
  const result = await runSubagentsReleaseVerification({
    promotion: "alpha",
    rootDir: fixture.temporaryRoot,
    requireCleanSource: false,
    sourceCommit,
    protectedEvidence: fixture.sources,
    spawnImpl: fake.spawnImpl,
  });
  assert.equal(result.report.status, "COMPLETE");
  assert.equal(result.report.passed, true);
  const gate = result.report.gates.find((candidate) => candidate.id === "pi-subagents-live-readonly-smoke");
  assert.equal(gate.status, "PASS");
  assert.deepEqual(gate.evidence.map((entry) => entry.id), Object.keys(fixture.sources).sort());
  assert.equal(result.report.authorization.providerRequests, "AUTHORIZED");
  assert.equal(result.report.authorization.liveChildDispatch, "AUTHORIZED");
  assert.equal(result.report.authorization.liveWriter, "NOT_RUN_BY_POLICY");
  assert.equal(result.report.privacy.credentialsRead, true);
  assert.ok(fake.calls.every((call) => call.command !== null));
  assert.equal(validateSubagentsReleaseReport(result.report, {
    rootDir: fixture.temporaryRoot,
    expectedSourceCommit: sourceCommit,
    verifyEvidenceCommit: false,
  }).ok, true);

  const tampered = structuredClone(result.report);
  tampered.gates.find((candidate) => candidate.id === "pi-subagents-live-readonly-smoke").evidence[0].evidenceDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateSubagentsReleaseReport(tampered, {
    rootDir: fixture.temporaryRoot,
    expectedSourceCommit: sourceCommit,
    verifyEvidenceCommit: false,
  }), /evidence receipt drift/);
});
