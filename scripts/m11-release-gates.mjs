#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJson } from "../packages/config-runtime/index.mjs";
import { repositoryRoot, runCheck } from "./verification-receipt.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "verification/m11-public-preview-gates-v1.json";
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const GATE_IDS = Object.freeze(Array.from({ length: 12 }, (_, index) => `Q${index + 1}`));
const PLATFORM_ID = "Q10";
const PROTECTED_ID = "Q11";
const DETERMINISTIC_IDS = Object.freeze(GATE_IDS.filter((id) => ![PLATFORM_ID, PROTECTED_ID].includes(id)));
const COMMANDS = Object.freeze({
  Q1: ["node", ["--test", "tests/legacy-authority.test.mjs", "tests/public-baseline.test.mjs", "tests/public-baseline-gates.test.mjs", "tests/public-baseline-protected.test.mjs"]],
  Q2: ["node", ["--test", "tests/release-stack-contracts.test.mjs"]],
  Q3: ["node", ["--test", "tests/release-artifact-ledger.test.mjs", "tests/release-license-sources.test.mjs"]],
  Q4: ["node", ["--test", "tests/release-builder.test.mjs", "tests/release-payload-assembler.test.mjs", "tests/release-payload-stager.test.mjs", "tests/release-thin-resolver.test.mjs"]],
  Q5: ["node", ["--test", "tests/release-downloader.test.mjs", "tests/release-installer.test.mjs", "tests/release-safe-extract.test.mjs"]],
  Q6: ["node", ["--test", "tests/release-environment-planner.test.mjs"]],
  Q7: ["node", ["--test", "tests/stack-transaction.test.mjs"]],
  Q8: ["node", ["--test", "tests/release-stack-service.test.mjs", "tests/version-service.test.mjs"]],
  Q9: ["node", ["--test", "tests/stack-transaction.test.mjs", "tests/release-stack-service.test.mjs"]],
  Q10: ["node", ["scripts/m11-macos-no-model-acceptance.mjs", "--run", "--json"]],
  Q12: ["node", ["--test", "tests/m11-release-gates.test.mjs", "tests/ci-contract.test.mjs", "tests/docs-links.test.mjs"]],
});

function fail(code, message) {
  const error = new Error(`m11-release-gates: ${message}`);
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

export function validateM11GateManifest(input) {
  if (!exactObject(input, ["formatVersion", "id", "description", "policy", "gates"])) fail("M11_GATE_MANIFEST_INVALID", "gate manifest field set is invalid");
  if (input.formatVersion !== 1 || input.id !== "m11-public-preview-gates-v1" || typeof input.description !== "string") fail("M11_GATE_MANIFEST_INVALID", "gate manifest identity is invalid");
  if (!equal(input.policy, { cwd: "repository-root", network: "deny-except-q10-declared-hosts", shell: false, platformExecution: "explicit-darwin-arm64", protectedExecution: "evidence-only", maxGateCount: 12, maxOutputBytes: 8388608 })) fail("M11_GATE_MANIFEST_INVALID", "gate policy drifted");
  if (!Array.isArray(input.gates) || input.gates.length !== 12) fail("M11_GATE_MANIFEST_INVALID", "Q1-Q12 must appear exactly once");
  input.gates.forEach((gate, index) => {
    const id = GATE_IDS[index];
    const common = ["id", "description", "command", "args", "timeoutMs", "maxOutputBytes", "execution"];
    const expected = id === PLATFORM_ID ? [...common, "defaultStatus", "platform", "networkHosts"] : id === PROTECTED_ID ? [...common, "defaultStatus", "evidenceId"] : common;
    if (!exactObject(gate, expected) || gate.id !== id || typeof gate.description !== "string" || gate.description.length < 1 || gate.description.length > 240) fail("M11_GATE_MANIFEST_INVALID", `gate shape drifted for ${id}`);
    if (!Number.isSafeInteger(gate.timeoutMs) || gate.timeoutMs < 1 || gate.timeoutMs > 1_800_000 || !Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes < 1024 || gate.maxOutputBytes > input.policy.maxOutputBytes) fail("M11_GATE_MANIFEST_INVALID", `gate bounds are invalid for ${id}`);
    if (id === PROTECTED_ID) {
      if (gate.execution !== "protected-evidence" || gate.command !== null || !equal(gate.args, []) || gate.defaultStatus !== "NOT_RUN_BY_POLICY" || gate.evidenceId !== "m11-protected-final-release-matrix") fail("M11_GATE_MANIFEST_INVALID", "Q11 must remain protected evidence-only");
      return;
    }
    const [command, args] = COMMANDS[id];
    if (gate.command !== command || !equal(gate.args, args) || gate.execution !== (id === PLATFORM_ID ? "platform" : "deterministic")) fail("M11_GATE_MANIFEST_INVALID", `${id} executable contract drifted`);
    if (id === PLATFORM_ID && (gate.defaultStatus !== "NOT_RUN_PLATFORM" || gate.platform !== "darwin-arm64" || !equal(gate.networkHosts, ["nodejs.org", "registry.npmjs.org"]))) fail("M11_GATE_MANIFEST_INVALID", "Q10 platform contract drifted");
    if (gate.args.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 256 || path.isAbsolute(entry) || /[|&;<>`$\r\n]/u.test(entry) || entry === ".." || entry.startsWith("../") || entry.includes("/../"))) fail("M11_GATE_MANIFEST_INVALID", `${id} argv is unsafe`);
  });
  return Object.freeze(structuredClone(input));
}

function readManifest(rootDir) {
  const target = path.resolve(rootDir, MANIFEST);
  const verificationRoot = fs.realpathSync(path.join(rootDir, "verification"));
  const real = fs.realpathSync(target);
  if (!real.startsWith(`${verificationRoot}${path.sep}`)) fail("M11_GATE_MANIFEST_UNSAFE", "gate manifest escapes verification root");
  return validateM11GateManifest(JSON.parse(fs.readFileSync(real, "utf8")));
}

export function parseM11GateArgs(argv) {
  const result = { run: false, json: false, help: false, includePlatform: false, gate: null, output: null, sourceCommit: null, evidence: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--run", "--json", "--include-platform", "--help", "-h"].includes(token)) {
      const key = token === "-h" ? "--help" : token;
      if (seen.has(key)) fail("M11_GATE_ARGUMENT_INVALID", `duplicate ${key}`);
      seen.add(key);
      if (key === "--run") result.run = true;
      else if (key === "--json") result.json = true;
      else if (key === "--include-platform") result.includePlatform = true;
      else result.help = true;
      continue;
    }
    if (["--gate", "--output", "--source-commit", "--protected-evidence"].includes(token)) {
      if (seen.has(token)) fail("M11_GATE_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) fail("M11_GATE_ARGUMENT_INVALID", `${token} requires a value`);
      if (token === "--gate") result.gate = value;
      else if (token === "--output") result.output = value;
      else if (token === "--source-commit") {
        if (!FULL_SHA.test(value)) fail("M11_GATE_ARGUMENT_INVALID", "--source-commit requires a full lowercase SHA");
        result.sourceCommit = value;
      } else {
        const [gateId, relative, ...rest] = value.split("=");
        if (gateId !== PROTECTED_ID || rest.length > 0 || !/^verification\/protected\/[a-z0-9][a-z0-9._-]*\.json$/u.test(relative ?? "")) fail("M11_GATE_ARGUMENT_INVALID", "--protected-evidence requires Q11=verification/protected/file.json");
        result.evidence = relative;
      }
      continue;
    }
    fail("M11_GATE_ARGUMENT_INVALID", `unknown argument ${token}`);
  }
  if (result.output !== null && !result.run) fail("M11_GATE_ARGUMENT_INVALID", "--output requires --run");
  if (result.includePlatform && !result.run) fail("M11_GATE_ARGUMENT_INVALID", "--include-platform requires --run");
  if (result.run && result.gate !== null) fail("M11_GATE_ARGUMENT_INVALID", "--run cannot be combined with --gate");
  if ((result.evidence === null) !== (result.sourceCommit === null) || (result.evidence !== null && !result.run)) fail("M11_GATE_ARGUMENT_INVALID", "protected import requires --run, --source-commit and Q11 evidence");
  return Object.freeze(result);
}

function git(rootDir, args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024 }).trim();
}

function cleanHead(rootDir) {
  if (git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") fail("M11_GATE_SOURCE_DIRTY", "verification requires a clean source commit");
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(head)) fail("M11_GATE_SOURCE_INVALID", "cannot resolve source commit");
  return head;
}

function safeOutput(requested, rootDir) {
  if (requested === null) return null;
  const receipts = path.join(rootDir, "verification", "receipts");
  const target = path.resolve(rootDir, requested);
  const relative = path.relative(receipts, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(".json") || fs.existsSync(target)) fail("M11_GATE_OUTPUT_INVALID", "output must be a new JSON file inside verification/receipts");
  return target;
}

function publicResult(raw, execution = "deterministic") {
  return Object.freeze({ id: raw.id, execution, status: raw.status, passed: raw.passed, exitCode: raw.exitCode, signal: raw.signal, timedOut: raw.timedOut, outputLimitExceeded: raw.outputLimitExceeded, durationMs: raw.durationMs, stdoutBytes: raw.stdoutBytes, stderrBytes: raw.stderrBytes, stdoutSha256: `sha256:${raw.stdoutSha256}`, stderrSha256: `sha256:${raw.stderrSha256}` });
}

function skippedResult(id, execution, status) {
  return Object.freeze({ id, execution, status, passed: false, durationMs: 0, stdoutBytes: 0, stderrBytes: 0, stdoutSha256: digest(""), stderrSha256: digest("") });
}

export function validateM11ProtectedEvidence(document, expectedSourceCommit) {
  if (!exactObject(document, ["formatVersion", "kind", "gateId", "evidenceId", "status", "sourceCommit", "stackId", "assertions", "privacy", "evidenceDigest"])) fail("M11_PROTECTED_EVIDENCE_INVALID", "Q11 evidence field set is invalid");
  if (document.formatVersion !== 1 || document.kind !== "only-my-pi-m11-protected-release-evidence" || document.gateId !== "Q11" || document.evidenceId !== "m11-protected-final-release-matrix" || document.status !== "PASS" || document.sourceCommit !== expectedSourceCommit || !SHA256.test(document.stackId ?? "")) fail("M11_PROTECTED_EVIDENCE_INVALID", "Q11 evidence identity is invalid");
  if (!Array.isArray(document.assertions) || document.assertions.length !== 20 || document.assertions.some((entry) => !exactObject(entry, ["id", "status", "evidenceSha256"]) || typeof entry.id !== "string" || entry.status !== "PASS" || !SHA256.test(entry.evidenceSha256 ?? "")) || new Set(document.assertions.map((entry) => entry.id)).size !== 20) fail("M11_PROTECTED_EVIDENCE_INVALID", "Q11 evidence must contain 20 unique passing assertions");
  if (!equal(document.privacy, { rawPromptsStored: false, rawOutputsStored: false, reasoningStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false })) fail("M11_PROTECTED_EVIDENCE_INVALID", "Q11 evidence privacy boundary drifted");
  const unsigned = structuredClone(document);
  delete unsigned.evidenceDigest;
  if (document.evidenceDigest !== digest(canonicalJson(unsigned))) fail("M11_PROTECTED_EVIDENCE_INVALID", "Q11 evidence digest is invalid");
  return Object.freeze(structuredClone(document));
}

async function loadProtectedEvidence(rootDir, relative, sourceCommit, verifyGit) {
  if (relative === null) return null;
  const target = path.resolve(rootDir, relative);
  const protectedRoot = fs.realpathSync(path.join(rootDir, "verification", "protected"));
  const real = fs.realpathSync(target);
  if (!real.startsWith(`${protectedRoot}${path.sep}`)) fail("M11_PROTECTED_EVIDENCE_INVALID", "Q11 evidence escapes protected root");
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size < 2 || stat.size > 4 * 1024 * 1024) fail("M11_PROTECTED_EVIDENCE_INVALID", "Q11 evidence is not a bounded regular file");
  if (verifyGit) {
    const evidenceCommit = git(rootDir, ["rev-parse", "HEAD"]);
    const parents = git(rootDir, ["show", "-s", "--format=%P", evidenceCommit]).split(" ").filter(Boolean);
    const changed = git(rootDir, ["diff", "--name-only", "--no-renames", `${sourceCommit}..${evidenceCommit}`]).split("\n").filter(Boolean);
    if (!equal(parents, [sourceCommit]) || !equal(changed, [relative])) fail("M11_EVIDENCE_COMMIT_INVALID", "Q11 evidence must be the only file in a direct evidence-only child of source S");
  }
  return validateM11ProtectedEvidence(JSON.parse(await fsPromises.readFile(real, "utf8")), sourceCommit);
}

export function inspectM11Gates(argv = process.argv.slice(2), { rootDir = ROOT } = {}) {
  const args = parseM11GateArgs(argv);
  if (args.help) return { help: "M11 gates: inspect Q1..Q12; --run executes deterministic gates; --include-platform adds Q10; Q11 is evidence-only." };
  if (args.run) fail("M11_GATE_ARGUMENT_INVALID", "inspect mode cannot use --run");
  const manifest = readManifest(rootDir);
  if (args.gate !== null) {
    const gate = manifest.gates.find((entry) => entry.id === args.gate);
    if (!gate) fail("M11_GATE_UNKNOWN", `unknown gate ${args.gate}`);
    return Object.freeze({ formatVersion: 1, manifest: manifest.id, manifestDigest: digest(canonicalJson(manifest)), gate, executable: false });
  }
  return Object.freeze({ formatVersion: 1, manifest: manifest.id, manifestDigest: digest(canonicalJson(manifest)), deterministicGateIds: DETERMINISTIC_IDS, platformGateIds: [PLATFORM_ID], protectedGateIds: [PROTECTED_ID], executable: false });
}

export async function runM11ReleaseVerification({ rootDir = repositoryRoot, output = null, includePlatform = false, sourceCommit = null, protectedEvidence = null, env = process.env, runCheckImpl = runCheck, requireCleanSource = true, verifyGit = true, onGate = () => {} } = {}) {
  const resolvedRoot = fs.realpathSync(rootDir);
  const manifest = readManifest(resolvedRoot);
  const target = safeOutput(output, resolvedRoot);
  const executionCommit = requireCleanSource ? cleanHead(resolvedRoot) : "UNCOMMITTED_TEST_ONLY";
  const evidence = await loadProtectedEvidence(resolvedRoot, protectedEvidence, sourceCommit, verifyGit && requireCleanSource);
  const results = [];
  for (const gate of manifest.gates) {
    let result;
    if (gate.id === PROTECTED_ID) result = evidence ? Object.freeze({ ...skippedResult(gate.id, gate.execution, "PASS"), passed: true, evidence: { evidenceId: evidence.evidenceId, evidenceDigest: evidence.evidenceDigest, assertionCount: evidence.assertions.length } }) : skippedResult(gate.id, gate.execution, gate.defaultStatus);
    else if (gate.id === PLATFORM_ID && !includePlatform) result = skippedResult(gate.id, gate.execution, gate.defaultStatus);
    else result = publicResult(await runCheckImpl({ ...gate, cwd: "repository-root", env: { CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" }, sensitiveOutput: false, required: true }, { cwd: resolvedRoot, maxOutputBytes: Math.min(gate.maxOutputBytes, manifest.policy.maxOutputBytes), env }), gate.execution);
    results.push(result);
    onGate(result);
  }
  if (requireCleanSource && cleanHead(resolvedRoot) !== executionCommit) fail("M11_GATE_SOURCE_CHANGED", "source changed while M11 gates were running");
  const deterministicPassed = results.filter((entry) => entry.execution === "deterministic").every((entry) => entry.status === "PASS");
  const platformPassed = results.find((entry) => entry.id === PLATFORM_ID).status === "PASS";
  const protectedPassed = results.find((entry) => entry.id === PROTECTED_ID).status === "PASS";
  const passed = deterministicPassed && platformPassed && protectedPassed;
  const report = Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-m11-public-preview-report",
    status: passed ? "COMPLETE" : !deterministicPassed ? "FAILED" : !platformPassed && !protectedPassed ? "HOLD_PLATFORM_AND_PROTECTED" : !platformPassed ? "HOLD_PLATFORM" : "HOLD_PROTECTED_EVIDENCE",
    sourceCommit: evidence ? sourceCommit : executionCommit,
    executionCommit,
    manifest: { id: manifest.id, digest: digest(canonicalJson(manifest)), gateIds: GATE_IDS },
    gates: results,
    passed,
    deterministicPassed,
    summary: { required: 12, deterministic: 10, deterministicPassed: results.filter((entry) => entry.execution === "deterministic" && entry.status === "PASS").length, platformPassed: platformPassed ? 1 : 0, platformNotRun: results.filter((entry) => entry.status === "NOT_RUN_PLATFORM").length, protectedPassed: protectedPassed ? 1 : 0, protectedNotRunByPolicy: results.filter((entry) => entry.status === "NOT_RUN_BY_POLICY").length },
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false },
    authorization: { providerRequests: evidence ? "IMPORTED_PROTECTED_EVIDENCE" : "NOT_RUN_BY_POLICY", realRootMutation: evidence ? "IMPORTED_PROTECTED_EVIDENCE" : "NOT_TOUCHED", publish: "NOT_AUTHORIZED", tag: "NOT_AUTHORIZED", release: "NOT_AUTHORIZED" },
  });
  if (target) {
    await fsPromises.mkdir(path.dirname(target), { recursive: true });
    await fsPromises.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  return Object.freeze({ report, target });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseM11GateArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node scripts/m11-release-gates.mjs [--gate Q1..Q12] [--json] | --run [--include-platform] [protected evidence options]\n");
    return 0;
  }
  if (!args.run) {
    process.stdout.write(`${JSON.stringify(inspectM11Gates(argv), null, args.json || args.gate ? 2 : 0)}\n`);
    return 0;
  }
  const { report, target } = await runM11ReleaseVerification({ output: args.output, includePlatform: args.includePlatform, sourceCommit: args.sourceCommit, protectedEvidence: args.evidence, onGate: (gate) => process.stderr.write(`${gate.status} ${gate.id} (${gate.durationMs} ms)\n`) });
  process.stdout.write(`${JSON.stringify({ status: report.status, passed: report.passed, deterministicPassed: report.deterministicPassed, summary: report.summary, ...(target ? { report: path.relative(repositoryRoot, target) } : {}) }, null, args.json ? 2 : 0)}\n`);
  return report.passed || (report.deterministicPassed && (!args.includePlatform || report.summary.platformPassed === 1) && report.summary.protectedNotRunByPolicy === 1) ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`m11-release-gates: ERROR ${error.code ?? "M11_GATES_FAILED"} ${error.message}\n`); process.exitCode = 1; });

export { DETERMINISTIC_IDS as M11_DETERMINISTIC_GATE_IDS, PLATFORM_ID as M11_PLATFORM_GATE_ID, PROTECTED_ID as M11_PROTECTED_GATE_ID };
