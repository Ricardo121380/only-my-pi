#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  gatesForPromotion,
  loadReleaseGatesV2Manifest,
  releaseGatesV2Digest,
  resolveReleaseGateV2,
  resolveReleaseGatesV2,
  SUBAGENTS_PROMOTION_CHANNELS,
} from "./lib/release-gates-v2.mjs";
import { repositoryRoot, runCheck } from "./verification-receipt.mjs";
import {
  evaluateSubagentsPromotion,
  loadSubagentsReleaseContracts,
  validateCompatibilityMatrix,
  validatePromotionPolicy,
} from "../packages/subagents/release/compatibility.mjs";
import {
  loadProtectedEvidenceSet,
  protectedEvidenceSummary,
  SUBAGENTS_PROTECTED_EVIDENCE_IDS,
} from "../packages/subagents/release/protected-evidence.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/u;
const REPORT_KIND = "only-my-pi-subagents-release-report";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REPORT_KEYS = new Set([
  "schemaVersion", "kind", "status", "sourceCommit", "manifest", "promotion", "startedAt", "completedAt",
  "evidenceCommit", "passed", "gates", "summary", "evaluation", "privacy", "authorization",
]);

export function parseSubagentsReleaseGateArgs(argv) {
  const output = {
    promotion: "preview",
    gate: null,
    json: false,
    help: false,
    run: false,
    output: null,
    sourceCommit: null,
    protectedEvidence: {},
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      if (seen.has("json")) throw new Error("duplicate --json");
      seen.add("json");
      output.json = true;
    } else if (arg === "--run") {
      if (seen.has("run")) throw new Error("duplicate --run");
      seen.add("run");
      output.run = true;
    } else if (arg === "--help" || arg === "-h") {
      if (seen.has("help")) throw new Error("duplicate --help");
      seen.add("help");
      output.help = true;
    } else if (arg === "--promotion") {
      if (seen.has("promotion")) throw new Error("duplicate --promotion");
      seen.add("promotion");
      const value = argv[++index];
      if (!SUBAGENTS_PROMOTION_CHANNELS.includes(value)) throw new Error("--promotion must be preview, alpha, beta, or stable");
      output.promotion = value;
    } else if (arg === "--gate") {
      if (seen.has("gate")) throw new Error("duplicate --gate");
      seen.add("gate");
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--gate requires an ID");
      output.gate = value;
    } else if (arg === "--output") {
      if (seen.has("output")) throw new Error("duplicate --output");
      seen.add("output");
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--output requires a path");
      output.output = value;
    } else if (arg === "--source-commit") {
      if (seen.has("sourceCommit")) throw new Error("duplicate --source-commit");
      seen.add("sourceCommit");
      const value = argv[++index];
      if (!FULL_SHA.test(value ?? "")) throw new Error("--source-commit requires a full lowercase Git SHA");
      output.sourceCommit = value;
    } else if (arg === "--protected-evidence") {
      const value = argv[++index];
      if (!value || value.startsWith("-") || value.includes("\0")) throw new Error("--protected-evidence requires id=verification/protected/file.json");
      const separator = value.indexOf("=");
      const id = value.slice(0, separator);
      const source = value.slice(separator + 1);
      if (separator < 1 || !SUBAGENTS_PROTECTED_EVIDENCE_IDS.includes(id)) throw new Error("--protected-evidence contains an unknown evidence id");
      if (Object.hasOwn(output.protectedEvidence, id)) throw new Error(`duplicate --protected-evidence id ${id}`);
      if (!source.startsWith("verification/protected/") || !source.endsWith(".json")) throw new Error("--protected-evidence source must be inside verification/protected");
      output.protectedEvidence[id] = source;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (output.output !== null && !output.run) throw new Error("--output requires --run");
  if (output.run && output.gate !== null) throw new Error("--run cannot be combined with --gate");
  if (Object.keys(output.protectedEvidence).length > 0 && (!output.run || output.sourceCommit === null)) {
    throw new Error("--protected-evidence requires --run and --source-commit");
  }
  if (output.sourceCommit !== null && Object.keys(output.protectedEvidence).length === 0) {
    throw new Error("--source-commit is only valid with protected evidence import");
  }
  return output;
}

function usage() {
  return [
    "Usage: node scripts/subagents-release-gates.mjs [--promotion preview|alpha|beta|stable] [--gate <id>] [--json]",
    "       node scripts/subagents-release-gates.mjs --run --promotion preview|alpha|beta|stable [--output verification/receipts/<file>.json] [--json]",
    "       node scripts/subagents-release-gates.mjs --run --promotion alpha|beta|stable --source-commit <40-hex> --protected-evidence <id>=verification/protected/<file>.json [...]",
    "",
    "Without --run this validates and inspects the fixed v2 gate contract without executing it.",
    "With --run it executes deterministic gates and may import only explicitly named, source-bound protected evidence files; it never runs a protected gate.",
  ].join("\n");
}

export function inspectSubagentsReleaseGates(argv = process.argv.slice(2)) {
  const args = parseSubagentsReleaseGateArgs(argv);
  if (args.help) return { help: usage() };
  if (args.run) throw new Error("inspect mode cannot use --run");
  const manifest = loadReleaseGatesV2Manifest();
  const resolved = resolveReleaseGatesV2(manifest);
  if (args.gate !== null) {
    return {
      formatVersion: 2,
      manifest: manifest.id,
      manifestDigest: releaseGatesV2Digest(manifest),
      gate: resolveReleaseGateV2(manifest, args.gate),
      executable: false,
    };
  }
  const required = gatesForPromotion(manifest, args.promotion);
  return {
    formatVersion: 2,
    manifest: manifest.id,
    manifestDigest: releaseGatesV2Digest(manifest),
    baseManifest: manifest.base,
    promotion: args.promotion,
    resolvedGateCount: resolved.length,
    requiredGateIds: required.map((gate) => gate.id),
    deterministicGateIds: required.filter((gate) => gate.execution === "deterministic").map((gate) => gate.id),
    protectedGateIds: required.filter((gate) => gate.execution === "protected-evidence").map((gate) => gate.id),
    protectedDefault: "NOT_RUN_BY_POLICY",
    executable: false,
  };
}

function git(rootDir, args) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertCleanSource(rootDir) {
  const status = git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status !== "") throw new Error("subagents release verification requires a completely clean source commit");
  const sourceCommit = git(rootDir, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(sourceCommit)) throw new Error("cannot resolve a full source commit SHA");
  return sourceCommit;
}

export function validateProtectedEvidenceImportPaths(changedPaths, protectedEvidence, { deletedPaths = [] } = {}) {
  if (!Array.isArray(changedPaths) || !Array.isArray(deletedPaths)) throw new Error("protected evidence import paths must be arrays");
  if (deletedPaths.length > 0) throw new Error("protected evidence import cannot delete repository files");
  const evidenceSources = new Set(Object.values(protectedEvidence));
  const allowed = new Set(["contracts/subagents/compatibility-matrix.json", ...evidenceSources]);
  const normalized = changedPaths.map((entry) => entry.split(path.sep).join("/"));
  if (normalized.length === 0 || !normalized.includes("contracts/subagents/compatibility-matrix.json")) {
    throw new Error("protected evidence import must update the compatibility matrix");
  }
  for (const changed of normalized) {
    if (!allowed.has(changed)) throw new Error(`protected evidence import contains an unauthorized change: ${changed}`);
  }
  for (const source of evidenceSources) {
    if (!normalized.includes(source)) throw new Error(`protected evidence source was not introduced by the evidence-only commit: ${source}`);
  }
  return Object.freeze([...normalized].sort());
}

export function validateProtectedEvidenceImportCommit(rootDir, sourceCommit, evidenceCommit, protectedEvidence) {
  if (!FULL_SHA.test(sourceCommit) || !FULL_SHA.test(evidenceCommit) || sourceCommit === evidenceCommit) {
    throw new Error("protected evidence requires distinct full source and evidence commits");
  }
  try {
    git(rootDir, ["cat-file", "-e", `${sourceCommit}^{commit}`]);
  } catch {
    throw new Error("protected evidence source commit is unavailable");
  }
  const parents = git(rootDir, ["show", "-s", "--format=%P", evidenceCommit]).split(" ").filter(Boolean);
  if (parents.length !== 1 || parents[0] !== sourceCommit) {
    throw new Error("protected evidence commit must be the direct single-parent child of the source commit");
  }
  for (const source of Object.values(protectedEvidence)) {
    let existed = false;
    try {
      git(rootDir, ["cat-file", "-e", `${sourceCommit}:${source}`]);
      existed = true;
    } catch {
      // Expected: protected evidence is introduced only by the evidence commit.
    }
    if (existed) throw new Error(`protected evidence already existed in the source commit: ${source}`);
  }
  const range = `${sourceCommit}..${evidenceCommit}`;
  const changed = git(rootDir, ["diff", "--name-only", "--no-renames", range]).split("\n").filter(Boolean);
  const deleted = git(rootDir, ["diff", "--name-only", "--diff-filter=D", "--no-renames", range]).split("\n").filter(Boolean);
  validateProtectedEvidenceImportPaths(changed, protectedEvidence, { deletedPaths: deleted });
  return evidenceCommit;
}

function safeOutputPath(requested, rootDir) {
  const receiptsRoot = path.join(rootDir, "verification", "receipts");
  const target = requested
    ? path.resolve(rootDir, requested)
    : path.join(receiptsRoot, `${new Date().toISOString().replace(/[:.]/gu, "-")}-subagents-ultrarun-v2.json`);
  const relative = path.relative(receiptsRoot, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !target.endsWith(".json")) {
    throw new Error("subagents report output must be a JSON file inside verification/receipts");
  }
  return target;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function protectedGateResult(gate, loadedProtectedEvidence = {}) {
  const evidence = (gate.evidenceIds ?? []).map((id) => loadedProtectedEvidence[id]).filter(Boolean);
  const passed = evidence.length === (gate.evidenceIds?.length ?? 0);
  return Object.freeze({
    id: gate.id,
    execution: gate.execution,
    status: passed ? "PASS" : (gate.defaultStatus ?? "NOT_RUN_BY_POLICY"),
    passed,
    exitCode: null,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    expectationPassed: passed,
    durationMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: sha256(""),
    stderrSha256: sha256(""),
    ...(passed ? { evidence: protectedEvidenceSummary(Object.fromEntries(evidence.map((entry) => [entry.id, entry]))) } : {}),
  });
}

function requiredProtectedEvidenceIds(gates) {
  return [...new Set(gates
    .filter((gate) => gate.execution === "protected-evidence")
    .flatMap((gate) => gate.evidenceIds ?? []))]
    .sort();
}

function assertExactProtectedEvidenceInput(gates, protectedEvidence) {
  const supplied = Object.keys(protectedEvidence).sort();
  if (supplied.length === 0) return;
  const required = requiredProtectedEvidenceIds(gates);
  if (JSON.stringify(supplied) !== JSON.stringify(required)) {
    throw new Error(`protected evidence import must supply the exact requested promotion set: ${required.join(", ")}`);
  }
}

function publicGateResult(gate, result) {
  return Object.freeze({
    id: gate.id,
    execution: gate.execution,
    status: result.status,
    passed: result.passed,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded,
    expectationPassed: result.expectationPassed,
    durationMs: result.durationMs,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutSha256: result.stdoutSha256?.startsWith("sha256:") ? result.stdoutSha256 : `sha256:${result.stdoutSha256}`,
    stderrSha256: result.stderrSha256?.startsWith("sha256:") ? result.stderrSha256 : `sha256:${result.stderrSha256}`,
    ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
  });
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
}

const PROTECTED_EVIDENCE_SUMMARY_KEYS = new Set(["id", "scope", "source", "evidenceDigest", "compatibilityRowId"]);

export function validateSubagentsReleaseReport(report, {
  rootDir = repositoryRoot,
  expectedSourceCommit,
  verifyEvidenceCommit = true,
  manifest = loadReleaseGatesV2Manifest(undefined, { rootDir }),
} = {}) {
  exactKeys(report, REPORT_KEYS, "subagents release report");
  if (report.schemaVersion !== 1 || report.kind !== REPORT_KIND) throw new Error("unsupported subagents release report format");
  if (!FULL_SHA.test(report.sourceCommit ?? "")) throw new Error("subagents report sourceCommit is invalid");
  if (expectedSourceCommit !== undefined && report.sourceCommit !== expectedSourceCommit) throw new Error("subagents report sourceCommit mismatch");
  if (!SUBAGENTS_PROMOTION_CHANNELS.includes(report.promotion)) throw new Error("subagents report promotion is invalid");
  if (!Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.completedAt))) throw new Error("subagents report timestamps are invalid");
  if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) throw new Error("subagents report completedAt precedes startedAt");
  exactKeys(report.manifest, new Set(["id", "digest", "base", "gateIds"]), "subagents report manifest");
  exactKeys(report.summary, new Set(["required", "deterministic", "deterministicPassed", "protected", "protectedPassed", "protectedNotRunByPolicy"]), "subagents report summary");
  exactKeys(report.evaluation, new Set(["requested", "achieved", "eligible", "digest", "findings"]), "subagents report evaluation");
  exactKeys(report.privacy, new Set(["rawOutputStored", "hostPathsStored", "credentialsRead", "outputFingerprintsMayLeakShortPredictableValues"]), "subagents report privacy");
  exactKeys(report.authorization, new Set(["providerRequests", "liveChildDispatch", "liveWriter", "realPiHome", "publish", "tag", "release"]), "subagents report authorization");
  if (report.manifest?.id !== manifest.id || report.manifest?.digest !== releaseGatesV2Digest(manifest)) throw new Error("subagents report manifest drift");
  if (report.manifest.base?.path !== manifest.base.path || report.manifest.base?.digest !== manifest.base.digest) throw new Error("subagents report base manifest drift");
  const required = gatesForPromotion(manifest, report.promotion, { rootDir });
  if (JSON.stringify(report.manifest.gateIds) !== JSON.stringify(required.map((gate) => gate.id))) throw new Error("subagents report gate order mismatch");
  if (!Array.isArray(report.gates) || report.gates.length !== required.length) throw new Error("subagents report gate results are incomplete");
  const reportedProtectedEvidence = {};
  for (const [index, result] of report.gates.entries()) {
    const expected = required[index];
    exactKeys(result, new Set(["id", "execution", "status", "passed", "exitCode", "signal", "timedOut", "outputLimitExceeded", "expectationPassed", "durationMs", "stdoutBytes", "stderrBytes", "stdoutSha256", "stderrSha256", "evidence"]), `subagents report gate ${index}`);
    if (result.id !== expected.id || result.execution !== expected.execution) throw new Error("subagents report gate identity mismatch");
    if (!["PASS", "FAIL", "NOT_RUN_BY_POLICY"].includes(result.status)) throw new Error(`subagents report gate ${result.id} status is invalid`);
    if (expected.execution === "protected-evidence" && !["PASS", "NOT_RUN_BY_POLICY"].includes(result.status)) throw new Error(`protected gate ${result.id} has unverifiable status`);
    if (expected.execution === "deterministic" && result.status === "NOT_RUN_BY_POLICY") throw new Error(`deterministic gate ${result.id} cannot be not-run`);
    assertSafeInteger(result.durationMs, `gate ${result.id} durationMs`);
    assertSafeInteger(result.stdoutBytes, `gate ${result.id} stdoutBytes`);
    assertSafeInteger(result.stderrBytes, `gate ${result.id} stderrBytes`);
    if (!SHA256.test(result.stdoutSha256) || !SHA256.test(result.stderrSha256)) throw new Error(`gate ${result.id} output digest is invalid`);
    if (result.status === "PASS" && result.passed !== true) throw new Error(`gate ${result.id} passed/status mismatch`);
    if (result.status !== "PASS" && result.passed === true) throw new Error(`gate ${result.id} failed status cannot be passed`);
    if (result.execution === "protected-evidence" && (result.exitCode !== null || result.durationMs !== 0 || result.stdoutBytes !== 0 || result.stderrBytes !== 0)) {
      throw new Error(`protected gate ${result.id} contains execution evidence`);
    }
    if (result.execution === "protected-evidence" && result.status === "PASS") {
      if (!Array.isArray(result.evidence)) throw new Error(`protected gate ${result.id} lacks imported evidence receipts`);
      const expectedIds = [...expected.evidenceIds].sort();
      const actualIds = result.evidence.map((entry) => entry?.id).sort();
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw new Error(`protected gate ${result.id} evidence-id set mismatch`);
      for (const entry of result.evidence) {
        exactKeys(entry, PROTECTED_EVIDENCE_SUMMARY_KEYS, `protected evidence summary ${entry?.id}`);
        if (reportedProtectedEvidence[entry.id] !== undefined && reportedProtectedEvidence[entry.id] !== entry.source) {
          throw new Error(`protected evidence ${entry.id} has conflicting sources`);
        }
        reportedProtectedEvidence[entry.id] = entry.source;
      }
    } else if (result.execution === "protected-evidence" && result.evidence !== undefined) {
      throw new Error(`not-run protected gate ${result.id} cannot contain evidence receipts`);
    }
  }
  const deterministic = report.gates.filter((gate) => gate.execution === "deterministic");
  const protectedGates = report.gates.filter((gate) => gate.execution === "protected-evidence");
  const expectedSummary = {
    required: required.length,
    deterministic: deterministic.length,
    deterministicPassed: deterministic.filter((gate) => gate.status === "PASS").length,
    protected: protectedGates.length,
    protectedPassed: protectedGates.filter((gate) => gate.status === "PASS").length,
    protectedNotRunByPolicy: protectedGates.filter((gate) => gate.status === "NOT_RUN_BY_POLICY").length,
  };
  if (JSON.stringify(report.summary) !== JSON.stringify(expectedSummary)) throw new Error("subagents report summary mismatch");
  const contracts = loadSubagentsReleaseContracts({ rootDir });
  const matrix = validateCompatibilityMatrix(contracts.matrix, { rootDir, verifyEvidencePaths: true });
  const policy = validatePromotionPolicy(contracts.policy);
  const loadedProtectedEvidence = loadProtectedEvidenceSet(reportedProtectedEvidence, {
    rootDir,
    matrix,
    policy,
    expectedSourceCommit: report.sourceCommit,
  });
  for (const [index, result] of report.gates.entries()) {
    if (result.execution !== "protected-evidence" || result.status !== "PASS") continue;
    const expected = required[index];
    const expectedSummary = protectedEvidenceSummary(Object.fromEntries(expected.evidenceIds.map((id) => [id, loadedProtectedEvidence[id]])));
    if (JSON.stringify(result.evidence) !== JSON.stringify(expectedSummary)) throw new Error(`protected gate ${result.id} evidence receipt drift`);
  }
  const expectedEvaluation = evaluateSubagentsPromotion({
    requested: report.promotion,
    matrix,
    policy,
    deterministicGates: Object.fromEntries(deterministic.map((gate) => [gate.id, gate.status])),
    protectedEvidence: reportedProtectedEvidence,
    expectedSourceCommit: report.sourceCommit,
    rootDir,
    verifyEvidencePaths: true,
  });
  if (report.evaluation?.requested !== expectedEvaluation.requested
    || report.evaluation?.achieved !== expectedEvaluation.achieved
    || report.evaluation?.eligible !== expectedEvaluation.eligible
    || report.evaluation?.digest !== expectedEvaluation.evaluationDigest
    || JSON.stringify(report.evaluation?.findings) !== JSON.stringify(expectedEvaluation.evaluations.at(-1)?.findings ?? [])) {
    throw new Error("subagents report promotion evaluation drift");
  }
  const expectedPassed = report.gates.every((gate) => gate.status === "PASS") && expectedEvaluation.eligible;
  const expectedBlocked = !expectedPassed && expectedSummary.deterministicPassed === expectedSummary.deterministic && expectedSummary.protectedNotRunByPolicy > 0;
  const expectedStatus = expectedPassed ? "COMPLETE" : (expectedBlocked ? "BLOCKED_PROTECTED_EVIDENCE" : "FAILED");
  if (report.passed !== expectedPassed || report.status !== expectedStatus) throw new Error("subagents report aggregate status is inconsistent");
  const liveEvidenceImported = Object.keys(loadedProtectedEvidence).length > 0;
  const writerEvidenceImported = loadedProtectedEvidence["guarded-writer-integration"] !== undefined;
  if (liveEvidenceImported) {
    if (verifyEvidenceCommit) {
      if (!FULL_SHA.test(report.evidenceCommit ?? "")) throw new Error("protected report evidenceCommit is invalid");
      validateProtectedEvidenceImportCommit(rootDir, report.sourceCommit, report.evidenceCommit, reportedProtectedEvidence);
      try {
        git(rootDir, ["merge-base", "--is-ancestor", report.evidenceCommit, "HEAD"]);
      } catch {
        throw new Error("protected report evidenceCommit is not an ancestor of the current checkout");
      }
    } else if (report.evidenceCommit !== "UNCOMMITTED_TEST_ONLY" && !FULL_SHA.test(report.evidenceCommit ?? "")) {
      throw new Error("test protected report evidenceCommit is invalid");
    }
  } else if (report.evidenceCommit !== undefined) {
    throw new Error("non-live report cannot claim an evidenceCommit");
  }
  if (report.privacy?.rawOutputStored !== false
    || report.privacy?.hostPathsStored !== false
    || report.privacy?.credentialsRead !== liveEvidenceImported) throw new Error("subagents report privacy boundary is invalid");
  if (report.authorization?.providerRequests !== (liveEvidenceImported ? "AUTHORIZED" : "NOT_RUN_BY_POLICY")
    || report.authorization?.liveChildDispatch !== (liveEvidenceImported ? "AUTHORIZED" : "NOT_RUN_BY_POLICY")
    || report.authorization?.liveWriter !== (writerEvidenceImported ? "AUTHORIZED" : "NOT_RUN_BY_POLICY")
    || report.authorization?.realPiHome !== "NOT_TOUCHED"
    || report.authorization?.publish !== "NOT_AUTHORIZED") throw new Error("subagents report authorization boundary is invalid");
  if (JSON.stringify(report).match(/\/Users\/[^/\s]+\//u) || JSON.stringify(report).match(/\/home\/[^/\s]+\//u)) throw new Error("subagents report contains a host home path");
  return Object.freeze({ ok: true, status: report.status, sourceCommit: report.sourceCommit, manifestDigest: report.manifest.digest });
}

/**
 * Execute the fixed v2 gate set. This is deliberately separate from the
 * inspector so callers cannot replace the manifest, argv, or protected gate
 * behavior. Protected evidence is never spawned by this function.
 */
export async function runSubagentsReleaseVerification({
  promotion = "preview",
  rootDir = repositoryRoot,
  output = null,
  protectedEvidence = {},
  env = process.env,
  spawnImpl,
  onGate = () => {},
  requireCleanSource = true,
  sourceCommit: suppliedSourceCommit,
} = {}) {
  if (!SUBAGENTS_PROMOTION_CHANNELS.includes(promotion)) throw new Error("unknown promotion");
  const resolvedRoot = fs.realpathSync(path.resolve(rootDir));
  const manifest = loadReleaseGatesV2Manifest(undefined, { rootDir: resolvedRoot });
  const target = output === null ? null : safeOutputPath(output, resolvedRoot);
  if (target && fs.existsSync(target)) throw new Error("report output already exists");
  const evidenceImportRequested = Object.keys(protectedEvidence).length > 0;
  const cleanHead = requireCleanSource ? assertCleanSource(resolvedRoot) : null;
  let sourceCommit;
  if (requireCleanSource && evidenceImportRequested) {
    if (!FULL_SHA.test(suppliedSourceCommit ?? "")) throw new Error("protected evidence import requires an exact source commit");
    validateProtectedEvidenceImportCommit(resolvedRoot, suppliedSourceCommit, cleanHead, protectedEvidence);
    sourceCommit = suppliedSourceCommit;
  } else if (requireCleanSource) {
    if (suppliedSourceCommit !== undefined && suppliedSourceCommit !== cleanHead) throw new Error("sourceCommit override requires protected evidence import");
    sourceCommit = cleanHead;
  } else {
    sourceCommit = suppliedSourceCommit ?? "UNCOMMITTED_TEST_ONLY";
  }
  if (requireCleanSource && !FULL_SHA.test(sourceCommit)) throw new Error("source commit is invalid");
  const executionCommit = requireCleanSource ? cleanHead : sourceCommit;
  const startedAt = new Date().toISOString();
  const required = gatesForPromotion(manifest, promotion, { rootDir: resolvedRoot });
  assertExactProtectedEvidenceInput(required, protectedEvidence);
  const contracts = loadSubagentsReleaseContracts({ rootDir: resolvedRoot });
  const matrix = validateCompatibilityMatrix(contracts.matrix, { rootDir: resolvedRoot, verifyEvidencePaths: true });
  const policy = validatePromotionPolicy(contracts.policy);
  const loadedProtectedEvidence = loadProtectedEvidenceSet(protectedEvidence, {
    rootDir: resolvedRoot,
    matrix,
    policy,
    expectedSourceCommit: sourceCommit,
  });
  const gates = [];
  for (const gate of required) {
    let result;
    if (gate.execution === "protected-evidence") {
      result = protectedGateResult(gate, loadedProtectedEvidence);
    } else {
      result = await runCheck(gate, {
        cwd: resolvedRoot,
        maxOutputBytes: Math.min(gate.maxOutputBytes, manifest.policy.maxOutputBytes),
        env,
        spawnImpl,
      });
      if (gate.id === "test-e2e" && result.evidence?.sourceCommit !== executionCommit) {
        result = Object.freeze({ ...result, status: "FAIL", passed: false, expectationPassed: false });
      }
    }
    const publicResult = publicGateResult(gate, result);
    gates.push(publicResult);
    onGate(publicResult);
  }
  if (requireCleanSource) {
    const afterCommit = assertCleanSource(resolvedRoot);
    if (afterCommit !== cleanHead) throw new Error("evidence commit changed while v2 release gates were running");
  }
  const deterministic = gates.filter((gate) => gate.execution === "deterministic");
  const protectedGates = gates.filter((gate) => gate.execution === "protected-evidence");
  const deterministicPassed = deterministic.every((gate) => gate.status === "PASS");
  const protectedPassed = protectedGates.every((gate) => gate.status === "PASS");
  const deterministicStatuses = Object.fromEntries(deterministic.map((gate) => [gate.id, gate.status]));
  const evaluation = evaluateSubagentsPromotion({
    requested: promotion,
    matrix,
    policy,
    deterministicGates: deterministicStatuses,
    protectedEvidence,
    expectedSourceCommit: sourceCommit,
    rootDir: resolvedRoot,
    verifyEvidencePaths: true,
  });
  const passed = deterministicPassed && protectedPassed && evaluation.eligible;
  const blockedByProtectedEvidence = deterministicPassed
    && protectedGates.some((gate) => gate.status === "NOT_RUN_BY_POLICY")
    && evaluation.evaluations.some((entry) => entry.findings.some((finding) => finding.kind === "protected-evidence"));
  const report = {
    schemaVersion: 1,
    kind: REPORT_KIND,
    status: passed ? "COMPLETE" : (blockedByProtectedEvidence ? "BLOCKED_PROTECTED_EVIDENCE" : "FAILED"),
    sourceCommit,
    ...(evidenceImportRequested ? { evidenceCommit: requireCleanSource ? cleanHead : "UNCOMMITTED_TEST_ONLY" } : {}),
    manifest: {
      id: manifest.id,
      digest: releaseGatesV2Digest(manifest),
      base: manifest.base,
      gateIds: required.map((gate) => gate.id),
    },
    promotion,
    startedAt,
    completedAt: new Date().toISOString(),
    passed,
    gates,
    summary: {
      required: required.length,
      deterministic: deterministic.length,
      deterministicPassed: deterministic.filter((gate) => gate.status === "PASS").length,
      protected: protectedGates.length,
      protectedPassed: protectedGates.filter((gate) => gate.status === "PASS").length,
      protectedNotRunByPolicy: protectedGates.filter((gate) => gate.status === "NOT_RUN_BY_POLICY").length,
    },
    evaluation: {
      requested: evaluation.requested,
      achieved: evaluation.achieved,
      eligible: evaluation.eligible,
      digest: evaluation.evaluationDigest,
      findings: evaluation.evaluations.at(-1)?.findings ?? [],
    },
    privacy: {
      rawOutputStored: false,
      hostPathsStored: false,
      credentialsRead: evidenceImportRequested,
      outputFingerprintsMayLeakShortPredictableValues: true,
    },
    authorization: {
      providerRequests: evidenceImportRequested ? "AUTHORIZED" : "NOT_RUN_BY_POLICY",
      liveChildDispatch: evidenceImportRequested ? "AUTHORIZED" : "NOT_RUN_BY_POLICY",
      liveWriter: loadedProtectedEvidence["guarded-writer-integration"] ? "AUTHORIZED" : "NOT_RUN_BY_POLICY",
      realPiHome: "NOT_TOUCHED",
      publish: "NOT_AUTHORIZED",
      tag: "NOT_AUTHORIZED",
      release: "NOT_AUTHORIZED",
    },
  };
  validateSubagentsReleaseReport(report, {
    rootDir: resolvedRoot,
    expectedSourceCommit: sourceCommit,
    verifyEvidenceCommit: requireCleanSource,
    manifest,
  });
  if (target) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  }
  return Object.freeze({ report: Object.freeze(report), target });
}

export function main(argv = process.argv.slice(2)) {
  const args = parseSubagentsReleaseGateArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (args.run) {
    return runSubagentsReleaseVerification({
      promotion: args.promotion,
      output: args.output,
      protectedEvidence: args.protectedEvidence,
      ...(args.sourceCommit ? { sourceCommit: args.sourceCommit } : {}),
      onGate: (gate) => process.stderr.write(`${gate.status} ${gate.id} (${gate.durationMs} ms)\n`),
    }).then(({ report, target }) => {
      const summary = {
        status: report.status,
        passed: report.passed,
        promotion: report.promotion,
        gateCount: report.gates.length,
        deterministicPassed: report.summary.deterministicPassed,
        deterministic: report.summary.deterministic,
        protectedNotRunByPolicy: report.summary.protectedNotRunByPolicy,
        ...(target ? { report: path.relative(repositoryRoot, target) } : {}),
      };
      process.stdout.write(args.json
        ? `${JSON.stringify(summary, null, 2)}\n`
        : `release-gates-v2: ${summary.status} (${summary.promotion}, ${summary.gateCount} gates)\n`);
      return report.passed ? 0 : 1;
    });
  }
  const report = inspectSubagentsReleaseGates(argv);
  process.stdout.write(args.json || args.gate
    ? `${JSON.stringify(report, null, 2)}\n`
    : `release-gates-v2: PASS (${report.promotion}, ${report.requiredGateIds.length} required, ${report.protectedGateIds.length} protected)\n`);
  return Promise.resolve(0);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`subagents-release-gates: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}
