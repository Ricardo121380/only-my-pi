#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  inspectM10Promotion,
  loadM10ProtectedEvidence,
} from "../packages/upstream-migration/index.mjs";
import { canonicalJson } from "../packages/config-runtime/index.mjs";
import { repositoryRoot, runCheck } from "./verification-receipt.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "verification/m10-promotion-gates-v1.json";
const FULL_SHA = /^[a-f0-9]{40}$/u;
const GATE_IDS = Object.freeze(Array.from({ length: 12 }, (_, index) => `P${index + 1}`));
const PROTECTED_IDS = Object.freeze(["P9", "P10"]);
const DETERMINISTIC_IDS = Object.freeze(GATE_IDS.filter((id) => !PROTECTED_IDS.includes(id)));
const COMMANDS = Object.freeze({
  P1: ["node", ["--test", "tests/m10-promotion-history.test.mjs"]],
  P2: ["node", ["--test", "tests/bootstrap-historical-doctor.test.mjs", "tests/version-service.test.mjs"]],
  P3: ["node", ["--test", "tests/m10-bundle-builder.test.mjs", "tests/upstream-migration-contract.test.mjs"]],
  P4: ["node", ["--test", "tests/upstream-migration-candidate-target.test.mjs", "tests/upstream-migration-planner.test.mjs"]],
  P5: ["node", ["--test", "tests/upstream-migration-journal.test.mjs", "tests/upstream-migration-transaction-engine.test.mjs", "tests/upstream-migration-filesystem-platform.test.mjs"]],
  P6: ["node", ["--test", "tests/upstream-migration-process.test.mjs"]],
  P7: ["node", ["--test", "tests/user-cli-installer.test.mjs", "tests/artifact-installer.test.mjs", "tests/version-service.test.mjs"]],
  P8: ["node", ["--test", "tests/upstream-migration-filesystem-platform.test.mjs"]],
  P11: ["node", ["--test", "tests/m10-promotion-contract.test.mjs"]],
  P12: ["node", ["scripts/m10-deterministic-acceptance.mjs"]],
});

function fail(code, message) {
  const error = new Error(`m10-promotion-gates: ${message}`);
  error.code = code;
  throw error;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function readManifest(rootDir) {
  const target = path.resolve(rootDir, MANIFEST);
  const verificationRoot = fs.realpathSync(path.join(rootDir, "verification"));
  const real = fs.realpathSync(target);
  if (!real.startsWith(`${verificationRoot}${path.sep}`)) fail("M10_GATE_MANIFEST_UNSAFE", "gate manifest escapes verification root");
  return validateM10GateManifest(JSON.parse(fs.readFileSync(real, "utf8")));
}

export function validateM10GateManifest(input) {
  const topKeys = ["formatVersion", "id", "description", "policy", "gates"];
  if (!input || typeof input !== "object" || Array.isArray(input) || !equal(Object.keys(input).sort(), topKeys.sort())) fail("M10_GATE_MANIFEST_INVALID", "gate manifest field set is invalid");
  if (input.formatVersion !== 1 || input.id !== "m10-promotion-gates-v1" || typeof input.description !== "string") fail("M10_GATE_MANIFEST_INVALID", "gate manifest identity is invalid");
  if (!equal(input.policy, { cwd: "repository-root", network: "deny", shell: false, protectedExecution: "evidence-only", maxGateCount: 12, maxOutputBytes: 8388608 })) fail("M10_GATE_MANIFEST_INVALID", "gate policy drifted");
  if (!Array.isArray(input.gates) || input.gates.length !== 12) fail("M10_GATE_MANIFEST_INVALID", "P1-P12 must appear exactly once");
  input.gates.forEach((gate, index) => {
    const id = GATE_IDS[index];
    const common = ["id", "description", "command", "args", "timeoutMs", "maxOutputBytes", "execution"];
    const expectedKeys = PROTECTED_IDS.includes(id) ? [...common, "defaultStatus", "evidenceId"] : common;
    if (!gate || typeof gate !== "object" || Array.isArray(gate) || !equal(Object.keys(gate).sort(), expectedKeys.sort()) || gate.id !== id) fail("M10_GATE_MANIFEST_INVALID", `gate order or shape drifted for ${id}`);
    if (typeof gate.description !== "string" || gate.description.length < 1 || gate.description.length > 240 || !Number.isSafeInteger(gate.timeoutMs) || gate.timeoutMs < 1 || gate.timeoutMs > 600_000 || !Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes < 1024 || gate.maxOutputBytes > input.policy.maxOutputBytes) fail("M10_GATE_MANIFEST_INVALID", `gate bounds are invalid for ${id}`);
    if (PROTECTED_IDS.includes(id)) {
      const evidenceId = id === "P9" ? "m10-real-root-migration" : "m10-promoted-live-model-matrix";
      if (gate.execution !== "protected-evidence" || gate.command !== null || !equal(gate.args, []) || gate.defaultStatus !== "NOT_RUN_BY_POLICY" || gate.evidenceId !== evidenceId) fail("M10_GATE_MANIFEST_INVALID", `${id} must remain protected evidence-only`);
      return;
    }
    const [command, args] = COMMANDS[id];
    if (gate.execution !== "deterministic" || gate.command !== command || !equal(gate.args, args)) fail("M10_GATE_MANIFEST_INVALID", `${id} executable contract drifted`);
    if (gate.args.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 256 || path.isAbsolute(entry) || /[|&;<>`$\r\n]/u.test(entry) || entry === ".." || entry.startsWith("../") || entry.includes("/../"))) fail("M10_GATE_MANIFEST_INVALID", `${id} argv is unsafe`);
  });
  return Object.freeze(structuredClone(input));
}

export function parseM10GateArgs(argv) {
  const result = { run: false, json: false, help: false, gate: null, output: null, sourceCommit: null, evidence: new Map() };
  const single = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--run", "--json", "--help", "-h"].includes(token)) {
      const key = token === "-h" ? "--help" : token;
      if (single.has(key)) fail("M10_GATE_ARGUMENT_INVALID", `duplicate ${key}`);
      single.add(key);
      if (key === "--run") result.run = true;
      else if (key === "--json") result.json = true;
      else result.help = true;
      continue;
    }
    if (["--gate", "--output", "--source-commit", "--protected-evidence"].includes(token)) {
      if (token !== "--protected-evidence" && single.has(token)) fail("M10_GATE_ARGUMENT_INVALID", `duplicate ${token}`);
      single.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) fail("M10_GATE_ARGUMENT_INVALID", `${token} requires a value`);
      if (token === "--gate") result.gate = value;
      else if (token === "--output") result.output = value;
      else if (token === "--source-commit") {
        if (!FULL_SHA.test(value)) fail("M10_GATE_ARGUMENT_INVALID", "--source-commit requires a full lowercase SHA");
        result.sourceCommit = value;
      } else {
        const separator = value.indexOf("=");
        const gateId = value.slice(0, separator);
        const relative = value.slice(separator + 1);
        if (!PROTECTED_IDS.includes(gateId) || result.evidence.has(gateId) || !/^verification\/protected\/[a-z0-9][a-z0-9._-]*\.json$/u.test(relative)) fail("M10_GATE_ARGUMENT_INVALID", "--protected-evidence requires unique P9=path or P10=path inside verification/protected");
        result.evidence.set(gateId, relative);
      }
      continue;
    }
    fail("M10_GATE_ARGUMENT_INVALID", `unknown argument ${token}`);
  }
  if (result.output !== null && !result.run) fail("M10_GATE_ARGUMENT_INVALID", "--output requires --run");
  if (result.run && result.gate !== null) fail("M10_GATE_ARGUMENT_INVALID", "--run cannot be combined with --gate");
  if (result.evidence.size > 0 && (!result.run || result.sourceCommit === null || result.evidence.size !== 2)) fail("M10_GATE_ARGUMENT_INVALID", "protected import requires --run, --source-commit and both P9/P10 evidence files");
  if (result.evidence.size === 0 && result.sourceCommit !== null) fail("M10_GATE_ARGUMENT_INVALID", "--source-commit is valid only with protected evidence");
  return Object.freeze({ ...result, evidence: new Map(result.evidence) });
}

function git(rootDir, args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024 }).trim();
}

function cleanHead(rootDir) {
  if (git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") fail("M10_GATE_SOURCE_DIRTY", "verification requires a clean source commit");
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(head)) fail("M10_GATE_SOURCE_INVALID", "cannot resolve source commit");
  return head;
}

function validateEvidenceCommit(rootDir, { sourceCommit, evidenceCommit, paths }) {
  const parents = git(rootDir, ["show", "-s", "--format=%P", evidenceCommit]).split(" ").filter(Boolean);
  if (!equal(parents, [sourceCommit])) fail("M10_EVIDENCE_COMMIT_INVALID", "evidence commit must be a direct single-parent child of source S");
  const changed = git(rootDir, ["diff", "--name-only", "--no-renames", `${sourceCommit}..${evidenceCommit}`]).split("\n").filter(Boolean).sort();
  const deleted = git(rootDir, ["diff", "--name-only", "--diff-filter=D", "--no-renames", `${sourceCommit}..${evidenceCommit}`]).split("\n").filter(Boolean);
  if (deleted.length > 0 || !equal(changed, [...paths].sort())) fail("M10_EVIDENCE_COMMIT_INVALID", "evidence commit must contain exactly the P9/P10 evidence files");
  try { execFileSync("git", ["merge-base", "--is-ancestor", evidenceCommit, "HEAD"], { cwd: rootDir, stdio: "ignore" }); } catch { fail("M10_EVIDENCE_COMMIT_INVALID", "current source does not descend from the evidence commit"); }
}

function safeOutput(requested, rootDir) {
  if (requested === null) return null;
  const receipts = path.join(rootDir, "verification", "receipts");
  const target = path.resolve(rootDir, requested);
  const relative = path.relative(receipts, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(".json") || fs.existsSync(target)) fail("M10_GATE_OUTPUT_INVALID", "output must be a new JSON file inside verification/receipts");
  return target;
}

function publicResult(raw) {
  return Object.freeze({
    id: raw.id,
    execution: "deterministic",
    status: raw.status,
    passed: raw.passed,
    exitCode: raw.exitCode,
    signal: raw.signal,
    timedOut: raw.timedOut,
    outputLimitExceeded: raw.outputLimitExceeded,
    durationMs: raw.durationMs,
    stdoutBytes: raw.stdoutBytes,
    stderrBytes: raw.stderrBytes,
    stdoutSha256: `sha256:${raw.stdoutSha256}`,
    stderrSha256: `sha256:${raw.stderrSha256}`,
  });
}

function protectedResult(gate, evidence) {
  return Object.freeze({
    id: gate.id,
    execution: "protected-evidence",
    status: evidence ? "PASS" : "NOT_RUN_BY_POLICY",
    passed: Boolean(evidence),
    durationMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: digest(""),
    stderrSha256: digest(""),
    ...(evidence ? { evidence: { evidenceId: evidence.evidenceId, evidenceDigest: evidence.evidenceDigest, assertionCount: evidence.assertions.length } } : {}),
  });
}

async function resolveProtectedEvidence({ rootDir, promotion, explicitEvidence, suppliedSourceCommit, executionCommit, verifyGit }) {
  let sourceCommit = suppliedSourceCommit;
  let evidenceCommit = null;
  let paths = explicitEvidence;
  if (paths.size === 0 && promotion.state === "PROMOTE") {
    sourceCommit = promotion.record.sourceCommit;
    evidenceCommit = promotion.record.evidenceCommit;
    paths = new Map(Object.entries(promotion.record.protectedEvidence));
  } else if (paths.size === 2) evidenceCommit = executionCommit;
  if (paths.size === 0) return { sourceCommit: executionCommit, evidenceCommit: null, evidence: new Map() };
  if (!FULL_SHA.test(sourceCommit ?? "") || !FULL_SHA.test(evidenceCommit ?? "")) fail("M10_EVIDENCE_BINDING_INVALID", "protected evidence requires exact source and evidence commits");
  if (verifyGit) validateEvidenceCommit(rootDir, { sourceCommit, evidenceCommit, paths: [...paths.values()] });
  const evidence = new Map();
  for (const gateId of PROTECTED_IDS) evidence.set(gateId, await loadM10ProtectedEvidence({ rootDir, relativePath: paths.get(gateId), gateId, expectedSourceCommit: sourceCommit }));
  return { sourceCommit, evidenceCommit, evidence };
}

export function inspectM10Gates(argv = process.argv.slice(2), { rootDir = ROOT } = {}) {
  const args = parseM10GateArgs(argv);
  if (args.help) return { help: "M10 promotion gates: inspect with --gate P1..P12; execute with --run. P9/P10 are evidence-only." };
  if (args.run) fail("M10_GATE_ARGUMENT_INVALID", "inspect mode cannot use --run");
  const manifest = readManifest(rootDir);
  if (args.gate !== null) {
    const gate = manifest.gates.find((entry) => entry.id === args.gate);
    if (!gate) fail("M10_GATE_UNKNOWN", `unknown gate ${args.gate}`);
    return Object.freeze({ formatVersion: 1, manifest: manifest.id, manifestDigest: digest(canonicalJson(manifest)), gate, executable: false });
  }
  return Object.freeze({ formatVersion: 1, manifest: manifest.id, manifestDigest: digest(canonicalJson(manifest)), deterministicGateIds: DETERMINISTIC_IDS, protectedGateIds: PROTECTED_IDS, protectedDefault: "NOT_RUN_BY_POLICY", executable: false });
}

export async function runM10PromotionVerification({
  rootDir = repositoryRoot,
  output = null,
  sourceCommit = null,
  protectedEvidence = new Map(),
  env = process.env,
  runCheckImpl = runCheck,
  requireCleanSource = true,
  verifyGit = true,
  onGate = () => {},
} = {}) {
  const resolvedRoot = fs.realpathSync(rootDir);
  const manifest = readManifest(resolvedRoot);
  const promotion = await inspectM10Promotion({ rootDir: resolvedRoot });
  const target = safeOutput(output, resolvedRoot);
  const executionCommit = requireCleanSource ? cleanHead(resolvedRoot) : "UNCOMMITTED_TEST_ONLY";
  const imported = await resolveProtectedEvidence({ rootDir: resolvedRoot, promotion, explicitEvidence: protectedEvidence, suppliedSourceCommit: sourceCommit, executionCommit, verifyGit: verifyGit && requireCleanSource });
  const results = [];
  for (const gate of manifest.gates) {
    const result = gate.execution === "protected-evidence"
      ? protectedResult(gate, imported.evidence.get(gate.id))
      : publicResult(await runCheckImpl({ ...gate, cwd: "repository-root", env: { CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" }, sensitiveOutput: false, required: true }, { cwd: resolvedRoot, maxOutputBytes: Math.min(gate.maxOutputBytes, manifest.policy.maxOutputBytes), env }));
    results.push(result);
    onGate(result);
  }
  if (requireCleanSource && cleanHead(resolvedRoot) !== executionCommit) fail("M10_GATE_SOURCE_CHANGED", "source changed while M10 gates were running");
  const deterministicPassed = results.filter((entry) => entry.execution === "deterministic").every((entry) => entry.status === "PASS");
  const protectedPassed = results.filter((entry) => entry.execution === "protected-evidence").every((entry) => entry.status === "PASS");
  const passed = deterministicPassed && protectedPassed;
  const report = Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-m10-promotion-report",
    status: passed ? "COMPLETE" : deterministicPassed ? "HOLD_PROTECTED_EVIDENCE" : "FAILED",
    sourceCommit: imported.sourceCommit,
    executionCommit,
    ...(imported.evidenceCommit ? { evidenceCommit: imported.evidenceCommit } : {}),
    decision: promotion.state,
    manifest: { id: manifest.id, digest: digest(canonicalJson(manifest)), gateIds: GATE_IDS },
    gates: results,
    passed,
    deterministicPassed,
    summary: {
      required: 12,
      deterministic: 10,
      deterministicPassed: results.filter((entry) => entry.execution === "deterministic" && entry.status === "PASS").length,
      protected: 2,
      protectedPassed: results.filter((entry) => entry.execution === "protected-evidence" && entry.status === "PASS").length,
      protectedNotRunByPolicy: results.filter((entry) => entry.status === "NOT_RUN_BY_POLICY").length,
    },
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false },
    authorization: { providerRequests: imported.evidence.has("P10") ? "IMPORTED_PROTECTED_EVIDENCE" : "NOT_RUN_BY_POLICY", realRootMutation: imported.evidence.has("P9") ? "IMPORTED_PROTECTED_EVIDENCE" : "NOT_TOUCHED", publish: "NOT_AUTHORIZED", release: "NOT_AUTHORIZED" },
  });
  if (target) {
    await fsPromises.mkdir(path.dirname(target), { recursive: true });
    await fsPromises.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  return Object.freeze({ report, target });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseM10GateArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node scripts/m10-promotion-gates.mjs [--gate P1..P12] [--json] | --run [protected import options]\n");
    return 0;
  }
  if (!args.run) {
    process.stdout.write(`${JSON.stringify(inspectM10Gates(argv), null, args.json || args.gate ? 2 : 0)}\n`);
    return 0;
  }
  const { report, target } = await runM10PromotionVerification({
    output: args.output,
    sourceCommit: args.sourceCommit,
    protectedEvidence: args.evidence,
    onGate: (gate) => process.stderr.write(`${gate.status} ${gate.id} (${gate.durationMs} ms)\n`),
  });
  process.stdout.write(`${JSON.stringify({ status: report.status, passed: report.passed, deterministicPassed: report.deterministicPassed, summary: report.summary, ...(target ? { report: path.relative(repositoryRoot, target) } : {}) }, null, args.json ? 2 : 0)}\n`);
  return report.passed || (report.deterministicPassed && report.summary.protectedNotRunByPolicy === 2) ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`m10-promotion-gates: ERROR ${error.code ?? "M10_GATES_FAILED"} ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { DETERMINISTIC_IDS as M10_DETERMINISTIC_GATE_IDS, PROTECTED_IDS as M10_PROTECTED_GATE_IDS };
