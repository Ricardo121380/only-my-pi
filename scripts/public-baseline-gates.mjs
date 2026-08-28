#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildGenerationPlan } from "../packages/bootstrap/index.mjs";
import { canonicalJson } from "../packages/config-runtime/index.mjs";
import {
  inspectLegacyAuthority,
  validatePublicBaselineEvidence,
  validatePublicBaselineReceipt,
  validatePublicBaselineRecord,
} from "../packages/release-authority/index.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "verification/public-baseline-gates-v1.json";
const RECORD_PATH = "contracts/release/public-baseline.json";
const GATE_IDS = Object.freeze(["PB1", "PB2", "PB3", "PB4", "PB5"]);
const COMMANDS = Object.freeze({
  PB1: ["node", ["--test", "tests/legacy-authority.test.mjs"]],
  PB2: ["node", ["--test", "tests/public-baseline.test.mjs", "tests/m10-promotion-contract.test.mjs"]],
  PB3: ["node", ["--test", "tests/public-baseline-artifact.test.mjs"]],
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : canonicalJson(value));
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function readJson(rootDir, relative) {
  const root = await fs.realpath(rootDir);
  const target = path.resolve(root, relative);
  const real = await fs.realpath(target);
  const contained = path.relative(root, real);
  if (!contained || contained.startsWith("..") || path.isAbsolute(contained)) fail("PUBLIC_BASELINE_PATH_UNSAFE", `${relative} escapes the repository`);
  const stat = await fs.lstat(real);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) fail("PUBLIC_BASELINE_PATH_UNSAFE", `${relative} is not a bounded regular file`);
  return JSON.parse(await fs.readFile(real, "utf8"));
}

export function validatePublicBaselineGateManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !equal(Object.keys(input).sort(), ["description", "formatVersion", "gates", "id", "policy"].sort())
    || input.formatVersion !== 1 || input.id !== "public-baseline-v1" || typeof input.description !== "string") {
    fail("PUBLIC_BASELINE_GATE_MANIFEST_INVALID", "public baseline gate manifest identity is invalid");
  }
  if (!equal(input.policy, { cwd: "repository-root", network: "deny", shell: false, protectedExecution: "evidence-only", maxGateCount: 5, maxOutputBytes: 8388608 })
    || !Array.isArray(input.gates) || input.gates.length !== 5) {
    fail("PUBLIC_BASELINE_GATE_MANIFEST_INVALID", "public baseline gate policy or count drifted");
  }
  input.gates.forEach((gate, index) => {
    const id = GATE_IDS[index];
    if (gate?.id !== id || typeof gate.description !== "string" || !Number.isSafeInteger(gate.timeoutMs)
      || !Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes > input.policy.maxOutputBytes) {
      fail("PUBLIC_BASELINE_GATE_MANIFEST_INVALID", `public baseline gate ${id} is invalid`);
    }
    if (id in COMMANDS) {
      const [command, args] = COMMANDS[id];
      if (gate.execution !== "deterministic" || gate.command !== command || !equal(gate.args, args)) fail("PUBLIC_BASELINE_GATE_MANIFEST_INVALID", `${id} executable drifted`);
      if (args.some((entry) => path.isAbsolute(entry) || /[|&;<>`$\r\n]/u.test(entry) || entry.startsWith("../") || entry.includes("/../"))) fail("PUBLIC_BASELINE_GATE_MANIFEST_INVALID", `${id} argv is unsafe`);
    } else if (id === "PB4") {
      if (gate.execution !== "protected-evidence" || gate.command !== null || !equal(gate.args, []) || gate.defaultStatus !== "NOT_RUN_BY_POLICY" || gate.evidenceId !== "public-baseline-live-matrix") fail("PUBLIC_BASELINE_GATE_MANIFEST_INVALID", "PB4 contract drifted");
    } else if (gate.execution !== "authority-receipt" || gate.command !== null || !equal(gate.args, []) || gate.defaultStatus !== "PUBLIC_BASELINE_PENDING") fail("PUBLIC_BASELINE_GATE_MANIFEST_INVALID", "PB5 contract drifted");
  });
  return Object.freeze(structuredClone(input));
}

async function git(rootDir, args) {
  return (await execFile("git", args, { cwd: rootDir, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
}

async function validateVerifiedChain(rootDir, record) {
  const evidence = validatePublicBaselineEvidence(await readJson(rootDir, record.protectedEvidence), { expectedSourceCommit: record.sourceCommit });
  const receipt = validatePublicBaselineReceipt(await readJson(rootDir, record.completionReceipt));
  const parents = (await git(rootDir, ["show", "-s", "--format=%P", record.evidenceCommit])).split(" ").filter(Boolean);
  if (!equal(parents, [record.sourceCommit])) fail("PUBLIC_BASELINE_EVIDENCE_COMMIT_INVALID", "BE must be the direct single-parent child of B");
  const evidenceChanges = (await git(rootDir, ["diff", "--name-only", "--no-renames", `${record.sourceCommit}..${record.evidenceCommit}`])).split("\n").filter(Boolean);
  if (!equal(evidenceChanges, [record.protectedEvidence])) fail("PUBLIC_BASELINE_EVIDENCE_COMMIT_INVALID", "BE may contain only the protected evidence file");
  const receiptCommit = await git(rootDir, ["log", "--diff-filter=A", "--format=%H", "-1", "--", record.completionReceipt]);
  const receiptParents = (await git(rootDir, ["show", "-s", "--format=%P", receiptCommit])).split(" ").filter(Boolean);
  if (!equal(receiptParents, [record.evidenceCommit])) fail("PUBLIC_BASELINE_RECEIPT_COMMIT_INVALID", "BR must be the direct single-parent child of BE");
  const receiptChanges = (await git(rootDir, ["diff", "--name-only", "--no-renames", `${record.evidenceCommit}..${receiptCommit}`])).split("\n").filter(Boolean).sort();
  if (!equal(receiptChanges, [RECORD_PATH, record.completionReceipt].sort())) fail("PUBLIC_BASELINE_RECEIPT_COMMIT_INVALID", "BR may contain only the baseline record and completion receipt");
  if (receipt.sourceCommit !== record.sourceCommit || receipt.evidenceCommit !== record.evidenceCommit
    || receipt.evidencePath !== record.protectedEvidence || receipt.evidenceDigest !== evidence.evidenceDigest
    || receipt.stableGraphDigest !== record.stable.graphDigest || receipt.legacyRegistryDigest !== record.legacyAuthority.registryDigest) {
    fail("PUBLIC_BASELINE_RECEIPT_BINDING_INVALID", "public baseline receipt differs from the governed record");
  }
  try { await execFile("git", ["merge-base", "--is-ancestor", receiptCommit, "HEAD"], { cwd: rootDir, stdio: "ignore" }); }
  catch { fail("PUBLIC_BASELINE_RECEIPT_COMMIT_INVALID", "current source does not descend from BR"); }
  return { evidence, receipt, receiptCommit };
}

export async function inspectPublicBaseline({ rootDir = ROOT, verifyGit = true } = {}) {
  const [manifest, record, graph] = await Promise.all([
    readJson(rootDir, MANIFEST_PATH).then(validatePublicBaselineGateManifest),
    readJson(rootDir, RECORD_PATH).then(validatePublicBaselineRecord),
    buildGenerationPlan({ rootDir, profileId: "daily" }),
  ]);
  const legacy = inspectLegacyAuthority({ rootDir });
  if (record.stable.graphDigest !== graph.graphDigest || record.legacyAuthority.registryDigest !== legacy.registryDigest) fail("PUBLIC_BASELINE_BINDING_DRIFT", "public baseline graph or legacy binding drifted");
  let authority = null;
  if (record.state === "PUBLIC_BASELINE_VERIFIED") authority = verifyGit ? await validateVerifiedChain(rootDir, record) : { evidence: null, receipt: null, receiptCommit: null };
  return Object.freeze({ manifest, record, graphDigest: graph.graphDigest, legacy, authority });
}

async function runGate(rootDir, gate) {
  const started = Date.now();
  try {
    const result = await execFile(gate.command, gate.args, {
      cwd: rootDir,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME, LC_ALL: "C", NO_COLOR: "1", CI: "1", PI_TELEMETRY: "0" },
      timeout: gate.timeoutMs,
      maxBuffer: gate.maxOutputBytes,
      encoding: "utf8",
    });
    return { id: gate.id, execution: gate.execution, status: "PASS", passed: true, durationMs: Date.now() - started, stdoutSha256: digest(result.stdout), stderrSha256: digest(result.stderr) };
  } catch (error) {
    return { id: gate.id, execution: gate.execution, status: "FAIL", passed: false, durationMs: Date.now() - started, stdoutSha256: digest(error.stdout ?? ""), stderrSha256: digest(error.stderr ?? ""), code: error.code ?? "GATE_FAILED" };
  }
}

export async function runPublicBaselineGates({ rootDir = ROOT } = {}) {
  const inspected = await inspectPublicBaseline({ rootDir, verifyGit: true });
  const results = [];
  for (const gate of inspected.manifest.gates.slice(0, 3)) results.push(await runGate(rootDir, gate));
  const verified = inspected.record.state === "PUBLIC_BASELINE_VERIFIED";
  results.push({ id: "PB4", execution: "protected-evidence", status: verified ? "PASS" : "NOT_RUN_BY_POLICY", passed: verified, ...(verified ? { evidenceDigest: inspected.authority.evidence.evidenceDigest } : {}) });
  results.push({ id: "PB5", execution: "authority-receipt", status: verified ? "PASS" : "PUBLIC_BASELINE_PENDING", passed: verified, ...(verified ? { receiptDigest: inspected.authority.receipt.receiptDigest } : {}) });
  return Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-public-baseline-gate-report",
    status: results.every((entry) => entry.passed) ? "COMPLETE" : verified ? "FAIL" : "PUBLIC_BASELINE_PENDING",
    passed: results.every((entry) => entry.passed),
    manifestDigest: digest(inspected.manifest),
    state: inspected.record.state,
    results,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const unknown = argv.filter((entry) => entry !== "--run" && entry !== "--json");
  if (unknown.length > 0) fail("PUBLIC_BASELINE_GATE_ARGUMENT_INVALID", `unknown argument ${unknown[0]}`);
  const run = argv.includes("--run");
  const result = run ? await runPublicBaselineGates() : await inspectPublicBaseline().then((value) => ({
    formatVersion: 1,
    manifest: value.manifest.id,
    state: value.record.state,
    deterministicGateIds: ["PB1", "PB2", "PB3"],
    protectedGateIds: ["PB4"],
    authorityGateIds: ["PB5"],
    executable: false,
  }));
  process.stdout.write(`${JSON.stringify(result, null, argv.includes("--json") ? 2 : 0)}\n`);
  return run && !result.passed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`public-baseline-gates: ERROR ${error.code ?? "PUBLIC_BASELINE_GATES_FAILED"} ${error.message}\n`); process.exitCode = 1; }
}
