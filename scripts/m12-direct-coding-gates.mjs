#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../packages/config-runtime/index.mjs";
import { DIRECT_AGENT_VERSION } from "../packages/direct-agent/product-contract.mjs";
import { repositoryRoot, runCheck } from "./verification-receipt.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "verification/m12-direct-coding-gates-v1.json";
const GATE_IDS = Object.freeze(Array.from({ length: 12 }, (_, index) => `C${index + 1}`));
const DETERMINISTIC_IDS = Object.freeze(GATE_IDS.slice(0, 10));
const PROTECTED_IDS = Object.freeze(GATE_IDS.slice(10));
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMANDS = Object.freeze({
  C1: ["node", ["--test", "tests/direct-agent-launcher.test.mjs", "tests/omp-cli.test.mjs"]],
  C2: ["node", ["--test", "tests/omp-direct-session.test.mjs", "tests/daily-config.test.mjs"]],
  C3: ["node", ["--test", "tests/omp-direct-session.test.mjs"]],
  C4: ["node", ["--test", "tests/omp-direct-session.test.mjs", "tests/m12-direct-coding-integration.test.mjs"]],
  C5: ["node", ["--test", "tests/omp-direct-session.test.mjs", "tests/direct-agent-workspace.test.mjs"]],
  C6: ["node", ["--test", "tests/direct-agent-workspace.test.mjs", "tests/m12-direct-coding-integration.test.mjs"]],
  C7: ["node", ["--test", "tests/m12-direct-coding-integration.test.mjs"]],
  C8: ["node", ["--test", "tests/direct-agent-managed-clone.test.mjs"]],
  C9: ["node", ["--test", "tests/direct-agent-orchestration.test.mjs", "tests/session-runtime-composer.test.mjs"]],
  C10: ["node", ["scripts/m12-deterministic-acceptance.mjs"]],
});

export const M12_PROTECTED_ASSERTIONS = Object.freeze({
  C11: Object.freeze([
    "candidate-install",
    "no-model-direct-launch",
    "baseline-exact-rollback",
    "candidate-reapply",
    "cli-generation-identity",
    "external-ownership-preserved",
    "system-runtime-preserved",
    "no-incomplete-transaction",
  ]),
  C12: Object.freeze([
    "simple-single-file-fix",
    "same-session-grant-reuse",
    "new-session-reapproval",
    "complex-plan-before-coding",
    "dirty-overlap-main-agent",
    "managed-clone-writer",
    "parallel-readonly-scouts",
    "fresh-reviewer-blocks-defect",
    "conflict-free-auto-integration",
    "public-web-separate-approval",
    "cancellation",
    "session-continue",
    "budget-denial",
    "headless-writer-denial",
    "project-external-write-denial",
    "graceful-exit",
    "runtime-and-package-identity",
    "single-runtime-owner",
  ]),
});

function fail(code, message) {
  const error = new Error(`m12-direct-coding-gates: ${message}`);
  error.code = code;
  throw error;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function exactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && equal(Object.keys(value).sort(), [...keys].sort());
}

export function validateM12GateManifest(input) {
  if (!exactObject(input, ["formatVersion", "id", "description", "policy", "gates"])) fail("M12_GATE_MANIFEST_INVALID", "manifest field set is invalid");
  if (input.formatVersion !== 1 || input.id !== "m12-direct-coding-gates-v1" || typeof input.description !== "string") fail("M12_GATE_MANIFEST_INVALID", "manifest identity is invalid");
  if (!equal(input.policy, { cwd: "repository-root", network: "deny", shell: false, protectedExecution: "evidence-only", maxGateCount: 12, maxOutputBytes: 8388608 })) fail("M12_GATE_MANIFEST_INVALID", "manifest policy drifted");
  if (!Array.isArray(input.gates) || input.gates.length !== 12) fail("M12_GATE_MANIFEST_INVALID", "C1-C12 must appear exactly once");
  input.gates.forEach((gate, index) => {
    const id = GATE_IDS[index];
    const common = ["id", "description", "command", "args", "timeoutMs", "maxOutputBytes", "execution"];
    const expected = PROTECTED_IDS.includes(id) ? [...common, "defaultStatus", "evidenceId"] : common;
    if (!exactObject(gate, expected) || gate.id !== id || typeof gate.description !== "string" || gate.description.length < 1 || gate.description.length > 240) fail("M12_GATE_MANIFEST_INVALID", `gate shape drifted for ${id}`);
    if (!Number.isSafeInteger(gate.timeoutMs) || gate.timeoutMs < 1 || gate.timeoutMs > 1_800_000 || !Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes < 1024 || gate.maxOutputBytes > input.policy.maxOutputBytes) fail("M12_GATE_MANIFEST_INVALID", `gate bounds are invalid for ${id}`);
    if (PROTECTED_IDS.includes(id)) {
      const evidenceId = id === "C11" ? "m12-real-install-rollback-reapply" : "m12-protected-live-coding-matrix";
      if (gate.execution !== "protected-evidence" || gate.command !== null || !equal(gate.args, []) || gate.defaultStatus !== "NOT_RUN_BY_POLICY" || gate.evidenceId !== evidenceId) fail("M12_GATE_MANIFEST_INVALID", `${id} must remain protected evidence-only`);
      return;
    }
    const [command, args] = COMMANDS[id];
    if (gate.command !== command || gate.execution !== "deterministic" || !equal(gate.args, args)) fail("M12_GATE_MANIFEST_INVALID", `${id} executable contract drifted`);
    if (gate.args.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 256 || path.isAbsolute(entry) || /[|&;<>`$\r\n]/u.test(entry) || entry === ".." || entry.startsWith("../") || entry.includes("/../"))) fail("M12_GATE_MANIFEST_INVALID", `${id} argv is unsafe`);
  });
  return Object.freeze(structuredClone(input));
}

function readManifest(rootDir = ROOT) {
  const target = path.resolve(rootDir, MANIFEST);
  const verificationRoot = fs.realpathSync(path.join(rootDir, "verification"));
  const real = fs.realpathSync(target);
  if (!real.startsWith(`${verificationRoot}${path.sep}`)) fail("M12_GATE_MANIFEST_UNSAFE", "manifest escapes verification root");
  return validateM12GateManifest(JSON.parse(fs.readFileSync(real, "utf8")));
}

export function parseM12GateArgs(argv) {
  const output = { run: false, json: false, help: false, gate: null, receipt: null, sourceCommit: null, protectedEvidence: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--run", "--json", "--help", "-h"].includes(token)) {
      const key = token === "-h" ? "--help" : token;
      if (seen.has(key)) fail("M12_GATE_ARGUMENT_INVALID", `duplicate ${key}`);
      seen.add(key);
      if (key === "--run") output.run = true;
      else if (key === "--json") output.json = true;
      else output.help = true;
      continue;
    }
    if (["--gate", "--output", "--source-commit", "--protected-evidence"].includes(token)) {
      if (seen.has(token)) fail("M12_GATE_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) fail("M12_GATE_ARGUMENT_INVALID", `${token} requires a value`);
      if (token === "--gate") output.gate = value;
      else if (token === "--output") output.receipt = value;
      else if (token === "--source-commit") {
        if (!FULL_SHA.test(value)) fail("M12_GATE_ARGUMENT_INVALID", "--source-commit requires a full lowercase SHA");
        output.sourceCommit = value;
      } else {
        if (!/^verification\/protected\/[a-z0-9][a-z0-9._-]*\.json$/u.test(value)) fail("M12_GATE_ARGUMENT_INVALID", "protected evidence must be a JSON file under verification/protected");
        output.protectedEvidence = value;
      }
      continue;
    }
    fail("M12_GATE_ARGUMENT_INVALID", `unknown argument ${token}`);
  }
  if (output.receipt !== null && !output.run) fail("M12_GATE_ARGUMENT_INVALID", "--output requires --run");
  if (output.gate !== null && output.run) fail("M12_GATE_ARGUMENT_INVALID", "--gate cannot be combined with --run");
  if ((output.sourceCommit === null) !== (output.protectedEvidence === null) || (output.protectedEvidence !== null && !output.run)) fail("M12_GATE_ARGUMENT_INVALID", "protected import requires --run, --source-commit and --protected-evidence");
  return Object.freeze(output);
}

export function validateM12ProtectedEvidence(document, expectedSourceCommit) {
  const keys = ["formatVersion", "kind", "status", "sourceCommit", "productVersion", "stackId", "installedGenerationId", "artifactSha256", "usage", "assertions", "privacy", "evidenceDigest"];
  if (!exactObject(document, keys) || document.formatVersion !== 1 || document.kind !== "only-my-pi-m12-protected-local-evidence" || document.status !== "PASS" || document.sourceCommit !== expectedSourceCommit || document.productVersion !== DIRECT_AGENT_VERSION) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected evidence identity is invalid");
  if (![document.stackId, document.installedGenerationId, document.artifactSha256].every((entry) => SHA256.test(entry ?? ""))) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected runtime identity is incomplete");
  if (!exactObject(document.usage, ["directlyMeteredTokens", "variableCostUsd", "wallSeconds", "toolCalls", "meteredTerminals"]) || !Number.isSafeInteger(document.usage.directlyMeteredTokens) || document.usage.directlyMeteredTokens < 0 || document.usage.variableCostUsd !== 0 || !Number.isSafeInteger(document.usage.wallSeconds) || document.usage.wallSeconds < 0 || document.usage.wallSeconds > 5_400 || !Number.isSafeInteger(document.usage.toolCalls) || document.usage.toolCalls < 0 || !Number.isSafeInteger(document.usage.meteredTerminals) || document.usage.meteredTerminals < 0) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected usage is invalid or exceeds the bounded matrix");
  const expected = Object.entries(M12_PROTECTED_ASSERTIONS).flatMap(([gateId, ids]) => ids.map((id) => `${gateId}:${id}`)).sort();
  const actual = Array.isArray(document.assertions) ? document.assertions.map((entry) => `${entry?.gateId}:${entry?.id}`).sort() : [];
  if (!Array.isArray(document.assertions) || document.assertions.length !== expected.length || !equal(actual, expected) || document.assertions.some((entry) => !exactObject(entry, ["gateId", "id", "status", "evidenceSha256"]) || !PROTECTED_IDS.includes(entry.gateId) || entry.status !== "PASS" || !SHA256.test(entry.evidenceSha256 ?? ""))) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected evidence assertion set is incomplete");
  if (!equal(document.privacy, { rawPromptsStored: false, rawOutputsStored: false, reasoningStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false, credentialsRead: false })) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected evidence privacy boundary drifted");
  const unsigned = structuredClone(document);
  delete unsigned.evidenceDigest;
  if (document.evidenceDigest !== digest(canonicalJson(unsigned))) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected evidence digest is invalid");
  return Object.freeze(structuredClone(document));
}

function git(rootDir, args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024 }).trim();
}

function cleanHead(rootDir) {
  if (git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") fail("M12_GATE_SOURCE_DIRTY", "verification requires a clean source commit");
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(head)) fail("M12_GATE_SOURCE_INVALID", "cannot resolve source commit");
  return head;
}

function safeReceipt(requested, rootDir) {
  if (requested === null) return null;
  const receipts = path.join(rootDir, "verification", "receipts");
  const target = path.resolve(rootDir, requested);
  const relative = path.relative(receipts, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(".json") || fs.existsSync(target)) fail("M12_GATE_OUTPUT_INVALID", "output must be a new JSON file inside verification/receipts");
  return target;
}

async function loadProtectedEvidence(rootDir, relative, sourceCommit, verifyGit) {
  if (relative === null) return null;
  const target = path.resolve(rootDir, relative);
  const protectedRoot = fs.realpathSync(path.join(rootDir, "verification", "protected"));
  const real = fs.realpathSync(target);
  if (!real.startsWith(`${protectedRoot}${path.sep}`)) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected evidence escapes its root");
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size < 2 || stat.size > 4 * 1024 * 1024) fail("M12_PROTECTED_EVIDENCE_INVALID", "protected evidence is not a bounded regular file");
  if (verifyGit) {
    const evidenceCommit = git(rootDir, ["rev-parse", "HEAD"]);
    const parents = git(rootDir, ["show", "-s", "--format=%P", evidenceCommit]).split(" ").filter(Boolean);
    const changed = git(rootDir, ["diff", "--name-only", "--no-renames", `${sourceCommit}..${evidenceCommit}`]).split("\n").filter(Boolean);
    if (!equal(parents, [sourceCommit]) || !equal(changed, [relative])) fail("M12_EVIDENCE_COMMIT_INVALID", "protected evidence must be the only file in a direct evidence-only child of source S");
  }
  return validateM12ProtectedEvidence(JSON.parse(await fsPromises.readFile(real, "utf8")), sourceCommit);
}

function publicResult(raw) {
  return Object.freeze({ id: raw.id, execution: "deterministic", status: raw.status, passed: raw.passed, exitCode: raw.exitCode, signal: raw.signal, timedOut: raw.timedOut, outputLimitExceeded: raw.outputLimitExceeded, durationMs: raw.durationMs, stdoutBytes: raw.stdoutBytes, stderrBytes: raw.stderrBytes, stdoutSha256: `sha256:${raw.stdoutSha256}`, stderrSha256: `sha256:${raw.stderrSha256}` });
}

function protectedResult(gate, evidence) {
  if (!evidence) return Object.freeze({ id: gate.id, execution: gate.execution, status: gate.defaultStatus, passed: false, durationMs: 0, evidence: null });
  const assertions = evidence.assertions.filter((entry) => entry.gateId === gate.id);
  return Object.freeze({ id: gate.id, execution: gate.execution, status: "PASS", passed: true, durationMs: 0, evidence: { evidenceDigest: evidence.evidenceDigest, assertionCount: assertions.length } });
}

export function inspectM12Gates(argv = process.argv.slice(2), { rootDir = ROOT } = {}) {
  const args = parseM12GateArgs(argv);
  if (args.help) return { help: "M12 gates: inspect C1-C12; --run executes C1-C10; C11-C12 require one source-bound protected evidence file." };
  if (args.run) fail("M12_GATE_ARGUMENT_INVALID", "inspect mode cannot use --run");
  const manifest = readManifest(rootDir);
  if (args.gate !== null) {
    const gate = manifest.gates.find((entry) => entry.id === args.gate);
    if (!gate) fail("M12_GATE_UNKNOWN", `unknown gate ${args.gate}`);
    return Object.freeze({ formatVersion: 1, manifest: manifest.id, manifestDigest: digest(canonicalJson(manifest)), gate, executable: false });
  }
  return Object.freeze({ formatVersion: 1, manifest: manifest.id, manifestDigest: digest(canonicalJson(manifest)), deterministicGateIds: DETERMINISTIC_IDS, protectedGateIds: PROTECTED_IDS, executable: false });
}

export async function runM12Verification({ rootDir = repositoryRoot, output = null, sourceCommit = null, protectedEvidence = null, env = process.env, runCheckImpl = runCheck, requireCleanSource = true, verifyGit = true, onGate = () => {} } = {}) {
  const resolvedRoot = fs.realpathSync(rootDir);
  const manifest = readManifest(resolvedRoot);
  const receiptTarget = safeReceipt(output, resolvedRoot);
  const executionCommit = requireCleanSource ? cleanHead(resolvedRoot) : "UNCOMMITTED_TEST_ONLY";
  const authoritativeSource = sourceCommit ?? executionCommit;
  const evidence = await loadProtectedEvidence(resolvedRoot, protectedEvidence, authoritativeSource, verifyGit && requireCleanSource);
  const results = [];
  for (const gate of manifest.gates) {
    const result = gate.execution === "protected-evidence"
      ? protectedResult(gate, evidence)
      : publicResult(await runCheckImpl({ ...gate, cwd: "repository-root", env: { CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" }, sensitiveOutput: false, required: true }, { cwd: resolvedRoot, maxOutputBytes: Math.min(gate.maxOutputBytes, manifest.policy.maxOutputBytes), env }));
    results.push(result);
    onGate(result);
  }
  if (requireCleanSource && cleanHead(resolvedRoot) !== executionCommit) fail("M12_GATE_SOURCE_CHANGED", "source changed while M12 gates were running");
  const deterministicPassed = results.filter((entry) => entry.execution === "deterministic").every((entry) => entry.status === "PASS");
  const protectedPassed = results.filter((entry) => entry.execution === "protected-evidence").every((entry) => entry.status === "PASS");
  const complete = deterministicPassed && protectedPassed;
  const status = complete ? "COMPLETE" : deterministicPassed && evidence === null ? "DETERMINISTIC_PASS_PROTECTED_PENDING" : "FAILED";
  const report = Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-m12-gate-report",
    status,
    ok: deterministicPassed && (evidence === null || protectedPassed),
    complete,
    sourceCommit: authoritativeSource,
    executionCommit,
    productVersion: DIRECT_AGENT_VERSION,
    manifest: { id: manifest.id, digest: digest(canonicalJson(manifest)) },
    deterministicPassed,
    protectedPassed,
    results: Object.freeze(results),
    privacy: { rawOutputStored: false, hostPathsStored: false, credentialsRead: false, providerRequests: evidence ? "IMPORTED_BOUNDED_EVIDENCE" : "NOT_RUN_BY_POLICY", github: "NOT_USED" },
  });
  if (receiptTarget !== null) {
    await fsPromises.mkdir(path.dirname(receiptTarget), { recursive: true, mode: 0o700 });
    await fsPromises.writeFile(receiptTarget, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  return Object.freeze({ report, target: receiptTarget });
}

async function main() {
  const args = parseM12GateArgs(process.argv.slice(2));
  let result;
  if (!args.run) result = inspectM12Gates(process.argv.slice(2));
  else result = (await runM12Verification({ output: args.receipt, sourceCommit: args.sourceCommit, protectedEvidence: args.protectedEvidence })).report;
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  if (args.run && result.ok !== true) process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.code ?? "M12_GATE_FAILED"}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
