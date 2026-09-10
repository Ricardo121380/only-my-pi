import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { hashFile } from "../packages/release-stack/index.mjs";
import {
  M11_PROTECTED_ASSERTION_IDS,
  validateM11ProtectedEvidence,
} from "../scripts/m11-release-gates.mjs";
import {
  applyM11ProtectedStack,
  captureM11ProtectedBaselineIdentity,
  captureM11ProtectedInstalledIdentity,
  captureM11ProtectedSystemRuntime,
  createM11ProtectedEvidence,
  digestM11ProtectedPath,
  executeM11ProtectedAcceptance,
  inspectM11ProtectedExecutable,
  inspectM11ProtectedReleaseRoot,
  parseM11ProtectedAcceptanceArgs,
  prepareM11ProtectedBootstrap,
  removeM11ProtectedStack,
  runM11ProtectedJsonCommand,
  writeM11ProtectedEvidence,
} from "../scripts/m11-protected-release-acceptance.mjs";

const sourceCommit = "a".repeat(40);
const output = path.resolve("verification/protected/m11-q11-test.json");

function protectedOperations({ liveError = null, rollbackError = null } = {}) {
  const stackId = `sha256:${"1".repeat(64)}`;
  const identity = Object.freeze({
    stackId,
    payloadMode: "thin",
    generationId: `sha256:${"2".repeat(64)}`,
    nodeVersion: "24.19.0",
    piVersion: "0.84.3",
    sourceCommit,
    artifactSha256: `sha256:${"3".repeat(64)}`,
    bindingCount: 7,
    externalPackageCount: 9,
  });
  const baseline = Object.freeze({ status: "INSTALLED", doctor: "PASS", stack: "NOT_INSTALLED", digest: "baseline" });
  const runtime = Object.freeze({ pi: { exists: true, versionDigest: "pi" }, node: { exists: true, versionDigest: "node" } });
  const liveIds = ["agent-terminal", "workflow-artifact-flow", "ultra-agent-route", "ultra-workflow-route", "public-web", "cancellation", "resume-prepared", "resume-across-session", "budget-boundary", "writer-denial", "usage-metering"];
  let removeCalls = 0;
  let capturedEvidence;
  const operations = {
    async git(args) { return args[0] === "rev-parse" ? sourceCommit : ""; },
    async inspectReleaseRoot() { return { assets: { thin: "/tmp/thin", full: "/tmp/full" }, stackManifest: { stackId } }; },
    async prepareBootstrap() { return { node: "/tmp/node", omp: "/tmp/omp" }; },
    async captureBaselineIdentity() { return { ...baseline }; },
    async captureSystemRuntime() { return { ...runtime }; },
    async applyStack(_bootstrap, bundle) { return { plan: { mutation: false }, result: { status: bundle.endsWith("thin") ? "COMMITTED" : "PATH_ACTION_REQUIRED" } }; },
    async captureInstalledIdentity() { return { ...identity }; },
    async removeStack() {
      removeCalls += 1;
      if (rollbackError && removeCalls > 1) throw rollbackError;
      return { result: { status: "REMOVED" } };
    },
    async runPublicBaselineLiveMatrix() {
      if (liveError) throw liveError;
      return { assertions: liveIds.map((id) => ({ id, status: "PASS", evidenceSha256: `sha256:${"4".repeat(64)}` })), usage: { tokens: 321, costUsd: 0, toolCalls: 5, meteredTerminals: 3 }, wallSeconds: 60 };
    },
    async verifyPublicPiList() { return { status: "PASS", commandOwners: 1 }; },
    async writeEvidence(_target, evidence) { capturedEvidence = evidence; },
  };
  return { operations, state: { get removeCalls() { return removeCalls; }, get capturedEvidence() { return capturedEvidence; } } };
}

test("Q11 protected runner is plan-first and separates all live authorities", async () => {
  const plan = parseM11ProtectedAcceptanceArgs(["--plan", "--json"]);
  const result = await executeM11ProtectedAcceptance(plan);
  assert.equal(result.mutation, false);
  assert.equal(result.plan.writes, "ZERO");
  assert.equal(result.plan.providerRequests, "NOT_RUN_BY_POLICY");
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--run", "--yes", "--release-root", "/tmp/rc", "--source-commit", sourceCommit, "--output", output]), { code: "M11_PROTECTED_CONFIRMATION_REQUIRED" });
  const run = parseM11ProtectedAcceptanceArgs(["--run", "--yes", "--terminate-pi", "--authorize-web", "--release-root", "/tmp/rc", "--source-commit", sourceCommit, "--output", output]);
  assert.equal(run.operation, "run");
  assert.equal(run.terminatePi, true);
  assert.equal(run.authorizeWeb, true);
});

test("Q11 evidence binds the exact twenty low-sensitivity release assertions", () => {
  const values = Object.fromEntries(M11_PROTECTED_ASSERTION_IDS.map((id) => [id, { id, proof: "bounded" }]));
  const document = createM11ProtectedEvidence({ sourceCommit, stackId: `sha256:${"1".repeat(64)}`, usage: { tokens: 123, costUsd: 0, wallSeconds: 45, toolCalls: 4, meteredTerminals: 2 }, values });
  assert.equal(document.assertions.length, 20);
  assert.deepEqual(document.assertions.map((entry) => entry.id).sort(), M11_PROTECTED_ASSERTION_IDS);
  assert.equal(validateM11ProtectedEvidence(document, sourceCommit).evidenceDigest, document.evidenceDigest);
  assert.deepEqual(document.usage, { directlyMeteredTokens: 123, variableCostUsd: 0, wallSeconds: 45, toolCalls: 4, meteredTerminals: 2 });
  const drift = structuredClone(document);
  drift.assertions[0].id = "unexpected";
  assert.throws(() => validateM11ProtectedEvidence(drift, sourceCommit), { code: "M11_PROTECTED_EVIDENCE_INVALID" });
});

test("Q11 executes the complete Thin, Full, rollback, live and reinstall state sequence", async () => {
  const fixture = protectedOperations();
  const args = parseM11ProtectedAcceptanceArgs(["--run", "--yes", "--terminate-pi", "--authorize-web", "--release-root", "/tmp/rc", "--source-commit", sourceCommit, "--output", output]);
  const result = await executeM11ProtectedAcceptance(args, { operations: fixture.operations, now: () => new Date("2026-08-29T00:00:00.000Z") });
  assert.equal(result.status, "M11_PROTECTED_RELEASE_MATRIX_COMPLETE");
  assert.equal(result.finalStack, "THIN_REINSTALLED");
  assert.equal(result.completedAt, "2026-08-29T00:00:00.000Z");
  assert.equal(fixture.state.removeCalls, 2);
  assert.equal(fixture.state.capturedEvidence.assertions.length, 20);
  assert.equal(fixture.state.capturedEvidence.usage.directlyMeteredTokens, 321);
});

test("Q11 failure rolls an active stack back and reports rollback failure separately", async () => {
  const liveFailure = Object.assign(new Error("live failed"), { code: "LIVE_FAILED" });
  const first = protectedOperations({ liveError: liveFailure });
  const args = parseM11ProtectedAcceptanceArgs(["--run", "--yes", "--terminate-pi", "--authorize-web", "--release-root", "/tmp/rc", "--source-commit", sourceCommit, "--output", output]);
  await assert.rejects(executeM11ProtectedAcceptance(args, { operations: first.operations }), { code: "LIVE_FAILED" });
  assert.equal(first.state.removeCalls, 2);

  const rollbackFailure = Object.assign(new Error("rollback failed"), { code: "ROLLBACK_FAILED" });
  const second = protectedOperations({ liveError: liveFailure, rollbackError: rollbackFailure });
  await assert.rejects(executeM11ProtectedAcceptance(args, { operations: second.operations }), { code: "M11_PROTECTED_AUTOMATIC_ROLLBACK_FAILED" });
  assert.equal(second.state.removeCalls, 2);
});

test("Q11 argument parser rejects ambiguous and unsafe protected authority", () => {
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--plan", "--run"]), { code: "M11_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--plan", "--yes"]), { code: "M11_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--plan", "--source-commit", "bad"]), { code: "M11_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--plan", "--plan"]), { code: "M11_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--unknown"]), { code: "M11_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--release-root", "/"]), { code: "M11_PROTECTED_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--output", path.resolve("outside.json")]), { code: "M11_PROTECTED_OUTPUT_INVALID" });
});

test("Q11 release inspection binds exact RC metadata and both asset bytes", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-q11-release-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(await fs.readFile(path.resolve("contracts/release/stack-manifest.example.json"), "utf8"));
  const index = JSON.parse(await fs.readFile(path.resolve("contracts/release/release-index.example.json"), "utf8"));
  const manifestPath = path.join(root, "stack-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [mode, contents] of [["full", "f"], ["thin", "tt"]]) {
    const asset = path.join(root, index.assets[mode].name);
    await fs.writeFile(asset, contents);
    index.assets[mode].bytes = Buffer.byteLength(contents);
    index.assets[mode].sha256 = await hashFile(asset);
  }
  index.stackManifestSha256 = await hashFile(manifestPath);
  await fs.writeFile(path.join(root, "release-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  const inspected = await inspectM11ProtectedReleaseRoot(root, sourceCommit);
  assert.equal(inspected.releaseIndex.status, "RC");
  assert.equal(inspected.stackManifest.stackId, manifest.stackId);
  await fs.appendFile(inspected.assets.full, "drift");
  await assert.rejects(inspectM11ProtectedReleaseRoot(root, sourceCommit), { code: "M11_PROTECTED_RELEASE_ASSET_INVALID" });
});

test("Q11 bounded command, path digest and evidence publication fail closed", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-q11-boundaries-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await runM11ProtectedJsonCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify({ok:true}))"]), { ok: true });
  await assert.rejects(runM11ProtectedJsonCommand(process.execPath, ["-e", "process.stdout.write('not-json')"]), { code: "M11_PROTECTED_COMMAND_OUTPUT_INVALID" });
  await assert.rejects(runM11ProtectedJsonCommand(process.execPath, ["-e", "process.exit(2)"]), { code: "M11_PROTECTED_COMMAND_FAILED" });

  const file = path.join(root, "file");
  const directory = path.join(root, "directory");
  const link = path.join(root, "link");
  await fs.writeFile(file, "bytes");
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, "nested"), "nested");
  await fs.symlink("file", link);
  assert.match(await digestM11ProtectedPath(path.join(root, "missing")), /^sha256:/u);
  assert.equal(await digestM11ProtectedPath(file), await hashFile(file));
  assert.match(await digestM11ProtectedPath(directory), /^sha256:/u);
  assert.match(await digestM11ProtectedPath(link), /^sha256:/u);

  const evidencePath = path.join(root, "evidence.json");
  await writeM11ProtectedEvidence(evidencePath, { status: "PASS" });
  assert.equal(JSON.parse(await fs.readFile(evidencePath, "utf8")).status, "PASS");
  await assert.rejects(writeM11ProtectedEvidence(evidencePath, { status: "PASS" }), { code: "M11_PROTECTED_OUTPUT_EXISTS" });
});

test("Q11 baseline, installed identity and stack lifecycle use exact bounded contracts", async () => {
  const stackId = `sha256:${"1".repeat(64)}`;
  const generationId = `sha256:${"2".repeat(64)}`;
  const run = async (_bootstrap, args) => {
    const command = args.join(" ");
    if (command === "version") return { ok: true, status: "VERSION_IDENTITY", sourceCommit, artifactSha256: `sha256:${"3".repeat(64)}`, installedGenerationId: generationId, piVersion: "0.84.3", subagentsVersion: "0.57.0", stackId, releaseChannel: "preview", embeddedNodeVersion: "24.19.0", decision: "PUBLIC_PREVIEW" };
    if (command === "status") return { status: "INSTALLED" };
    if (command === "doctor") return { status: "PASS", generation: { alignment: "MATCH" } };
    if (command === "stack status") return { status: "INSTALLED", stackId, payloadMode: "thin", generationId, nodeVersion: "24.19.0", piVersion: "0.84.3", externalOwnership: { binding: "external", owner: "user", packageCount: 9 }, incompleteTransactions: [] };
    throw new Error(`unexpected command ${command}`);
  };
  const baselineRun = async (_bootstrap, args) => {
    if (args.join(" ") === "stack status") return { status: "NOT_INSTALLED" };
    return run(_bootstrap, args);
  };
  const baseline = await captureM11ProtectedBaselineIdentity({}, { run: baselineRun, digest: async (target) => `digest:${path.basename(target)}`, home: "/tmp/home", configRoot: "/tmp/config", createLayout: () => ({ ompShim: "/tmp/omp", stateFile: "/tmp/state" }) });
  assert.equal(baseline.doctor, "PASS");
  assert.equal(baseline.stack, "NOT_INSTALLED");
  const bindings = Array.from({ length: 7 }, (_, index) => ({ name: `package-${index}`, binding: "external", owner: "user" }));
  const installed = await captureM11ProtectedInstalledIdentity({}, sourceCommit, stackId, { run, loadSettings: async () => ({ settings: { onlyMyPi: { packageBindings: bindings } } }) });
  assert.equal(installed.bindingCount, 7);
  assert.equal(installed.externalPackageCount, 9);

  const lifecycleCalls = [];
  const lifecycleRun = async (_bootstrap, args) => {
    lifecycleCalls.push(args);
    if (args.includes("install") && args.includes("--plan")) return { mutation: false, stackId };
    if (args.includes("install")) return { ok: true, status: "COMMITTED" };
    if (args.includes("--plan")) return { status: "STACK_REMOVE_PLAN" };
    return { status: "REMOVED", systemHomebrewModified: false, userDataDeleted: false };
  };
  assert.equal((await applyM11ProtectedStack({}, "/tmp/bundle", lifecycleRun)).result.status, "COMMITTED");
  assert.equal((await removeM11ProtectedStack({}, lifecycleRun)).result.status, "REMOVED");
  assert.equal(lifecycleCalls.length, 4);
});

test("Q11 executable inspection records only digest identity", async () => {
  assert.deepEqual(await inspectM11ProtectedExecutable(path.join(os.tmpdir(), "does-not-exist-omp"), ["--version"]), { exists: false });
  const identity = await inspectM11ProtectedExecutable(process.execPath, ["--version"]);
  assert.equal(identity.exists, true);
  assert.match(identity.executableSha256, /^sha256:/u);
  assert.match(identity.versionDigest, /^sha256:/u);
  const system = await captureM11ProtectedSystemRuntime();
  assert.equal(typeof system.pi.exists, "boolean");
  assert.equal(typeof system.node.exists, "boolean");
});

test("Q11 bootstrap uses only embedded Node, offline npm and scripts-disabled staging", async (t) => {
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-q11-bootstrap-")));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  let executed = false;
  const bootstrap = await prepareM11ProtectedBootstrap({ assets: { full: "/tmp/full.tar.gz" }, releaseIndex: { assets: { full: { sha256: `sha256:${"1".repeat(64)}` } } } }, workspace, {
    async extract({ destination }) {
      const nodeRoot = path.join(destination, "only-my-pi", "node");
      await fs.mkdir(path.join(nodeRoot, "bin"), { recursive: true });
      await fs.writeFile(path.join(nodeRoot, "bin", "node"), "node");
    },
    async execute(command, args, options) {
      executed = true;
      assert.equal(command, path.join(workspace, "bootstrap-full", "only-my-pi", "node", "bin", "node"));
      assert.ok(args.includes("--offline"));
      assert.ok(args.includes("--ignore-scripts"));
      assert.equal(options.env.npm_config_offline, "true");
      assert.equal(options.env.npm_config_ignore_scripts, "true");
      const omp = path.join(workspace, "bootstrap-prefix", "node_modules", "only-my-pi", "bin", "omp.mjs");
      await fs.mkdir(path.dirname(omp), { recursive: true });
      await fs.writeFile(omp, "export {};\n");
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(executed, true);
  assert.equal(bootstrap.nodeRoot, path.join(workspace, "bootstrap-full", "only-my-pi", "node"));
  assert.match(bootstrap.omp, /bootstrap-prefix\/node_modules\/only-my-pi\/bin\/omp\.mjs$/u);
});

test("Q11 source keeps failure rollback and leaves only a successful reinstall active", async () => {
  const source = await fs.readFile(path.resolve("scripts/m11-protected-release-acceptance.mjs"), "utf8");
  assert.match(source, /catch \(error\)[\s\S]*if \(active && bootstrap\)[\s\S]*await ops\.removeStack\(bootstrap\)/u);
  assert.match(source, /finalStack: "THIN_REINSTALLED"/u);
  assert.match(source, /live\.usage\.tokens > 75_000/u);
  assert.doesNotMatch(source, /API_KEY|AUTHORIZATION|COOKIE/u);
});
