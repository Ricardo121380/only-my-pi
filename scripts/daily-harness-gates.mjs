#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  DAILY_HARNESS_DETERMINISTIC_IDS,
  DAILY_HARNESS_PROTECTED_IDS,
  dailyHarnessGatesDigest,
  loadDailyHarnessGatesManifest,
  loadDailyHarnessProtectedEvidence,
  resolveDailyHarnessGate,
} from "./lib/daily-harness-gates.mjs";
import { repositoryRoot, runCheck } from "./verification-receipt.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/u;

function fail(message) {
  throw new Error(`daily-harness-gates: ${message}`);
}

export function parseDailyHarnessGateArgs(argv) {
  const output = { run: false, json: false, help: false, gate: null, output: null, sourceCommit: null, protectedEvidence: {} };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--run", "--json", "--help", "-h"].includes(argument)) {
      const key = argument === "-h" ? "--help" : argument;
      if (seen.has(key)) fail(`duplicate ${key}`);
      seen.add(key);
      if (key === "--run") output.run = true;
      else if (key === "--json") output.json = true;
      else output.help = true;
      continue;
    }
    if (["--gate", "--output", "--source-commit", "--protected-evidence"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("-") || value.includes("\0")) fail(`${argument} requires a value`);
      if (argument !== "--protected-evidence" && seen.has(argument)) fail(`duplicate ${argument}`);
      seen.add(argument);
      if (argument === "--gate") output.gate = value;
      else if (argument === "--output") output.output = value;
      else if (argument === "--source-commit") {
        if (!FULL_SHA.test(value)) fail("--source-commit requires a full lowercase Git SHA");
        output.sourceCommit = value;
      } else {
        const separator = value.indexOf("=");
        const gateId = value.slice(0, separator);
        const source = value.slice(separator + 1);
        if (separator < 1 || !DAILY_HARNESS_PROTECTED_IDS.includes(gateId) || Object.hasOwn(output.protectedEvidence, gateId)) fail("--protected-evidence requires unique D13=path or D14=path values");
        if (!source.startsWith("verification/protected/") || !source.endsWith(".json") || path.isAbsolute(source) || source.includes("..")) fail("protected evidence must be a JSON file inside verification/protected");
        output.protectedEvidence[gateId] = source;
      }
      continue;
    }
    fail(`unknown argument ${argument}`);
  }
  if (output.output !== null && !output.run) fail("--output requires --run");
  if (output.run && output.gate !== null) fail("--run cannot be combined with --gate");
  const evidenceIds = Object.keys(output.protectedEvidence).sort();
  if (evidenceIds.length > 0) {
    if (!output.run || output.sourceCommit === null) fail("protected evidence requires --run and --source-commit");
    if (JSON.stringify(evidenceIds) !== JSON.stringify([...DAILY_HARNESS_PROTECTED_IDS].sort())) fail("protected completion requires the exact D13 and D14 evidence set");
  } else if (output.sourceCommit !== null) fail("--source-commit is valid only with protected evidence");
  return Object.freeze({ ...output, protectedEvidence: Object.freeze({ ...output.protectedEvidence }) });
}

function usage() {
  return [
    "Usage: node scripts/daily-harness-gates.mjs [--gate D1..D15] [--json]",
    "       node scripts/daily-harness-gates.mjs --run [--output verification/receipts/<file>.json] [--json]",
    "       node scripts/daily-harness-gates.mjs --run --source-commit <40-hex> --protected-evidence D13=verification/protected/<file>.json --protected-evidence D14=verification/protected/<file>.json [--output verification/receipts/<file>.json] [--json]",
    "",
    "Without --run this validates the fixed D1-D15 contract without executing it.",
    "With --run it executes D1-D12 and D15 with shell:false. D13 and D14 are never spawned and default to NOT_RUN_BY_POLICY unless exact source-bound evidence is supplied.",
  ].join("\n");
}

export function inspectDailyHarnessGates(argv = process.argv.slice(2)) {
  const args = parseDailyHarnessGateArgs(argv);
  if (args.help) return { help: usage() };
  if (args.run) fail("inspect mode cannot use --run");
  const manifest = loadDailyHarnessGatesManifest();
  if (args.gate !== null) {
    return {
      formatVersion: 1,
      manifest: manifest.id,
      manifestDigest: dailyHarnessGatesDigest(manifest),
      gate: resolveDailyHarnessGate(manifest, args.gate),
      executable: false,
    };
  }
  return {
    formatVersion: 1,
    manifest: manifest.id,
    manifestDigest: dailyHarnessGatesDigest(manifest),
    deterministicGateIds: [...DAILY_HARNESS_DETERMINISTIC_IDS],
    protectedGateIds: [...DAILY_HARNESS_PROTECTED_IDS],
    protectedDefault: "NOT_RUN_BY_POLICY",
    executable: false,
  };
}

function git(rootDir, args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8", maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function assertCleanHead(rootDir) {
  if (git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") fail("verification requires a completely clean source commit");
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(head)) fail("cannot resolve a full source commit");
  return head;
}

function validateEvidenceCommit(rootDir, sourceCommit, evidenceCommit, protectedEvidence) {
  const parents = git(rootDir, ["show", "-s", "--format=%P", evidenceCommit]).split(" ").filter(Boolean);
  if (parents.length !== 1 || parents[0] !== sourceCommit) fail("protected evidence must be a direct single-parent child of the source commit");
  const expected = Object.values(protectedEvidence).sort();
  const changed = git(rootDir, ["diff", "--name-only", "--no-renames", `${sourceCommit}..${evidenceCommit}`]).split("\n").filter(Boolean).sort();
  const deleted = git(rootDir, ["diff", "--name-only", "--diff-filter=D", "--no-renames", `${sourceCommit}..${evidenceCommit}`]).split("\n").filter(Boolean);
  if (deleted.length > 0 || JSON.stringify(changed) !== JSON.stringify(expected)) fail("protected evidence commit contains files outside the exact D13/D14 evidence set");
  for (const source of expected) {
    try {
      git(rootDir, ["cat-file", "-e", `${sourceCommit}:${source}`]);
      fail(`protected evidence already existed in source commit: ${source}`);
    } catch (cause) {
      if (cause?.message?.startsWith("daily-harness-gates:")) throw cause;
    }
  }
}

function safeOutputPath(requested, rootDir) {
  if (requested === null) return null;
  const receiptsRoot = path.join(rootDir, "verification", "receipts");
  const target = path.resolve(rootDir, requested);
  const relative = path.relative(receiptsRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(".json")) fail("report output must be a JSON file inside verification/receipts");
  if (fs.existsSync(target)) fail("report output already exists");
  return target;
}

function emptyDigest() {
  return `sha256:${crypto.createHash("sha256").update("").digest("hex")}`;
}

function publicDeterministicResult(result) {
  return Object.freeze({
    id: result.id,
    execution: "deterministic",
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
    stdoutSha256: `sha256:${result.stdoutSha256}`,
    stderrSha256: `sha256:${result.stderrSha256}`,
  });
}

function protectedResult(gate, evidence) {
  const passed = evidence !== undefined;
  return Object.freeze({
    id: gate.id,
    execution: "protected-evidence",
    status: passed ? "PASS" : "NOT_RUN_BY_POLICY",
    passed,
    exitCode: null,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    expectationPassed: passed,
    durationMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: emptyDigest(),
    stderrSha256: emptyDigest(),
    ...(passed ? { evidence: { evidenceId: evidence.evidenceId, evidenceDigest: evidence.evidenceDigest, assertionCount: evidence.assertions.length } } : {}),
  });
}

export async function runDailyHarnessVerification({
  rootDir = repositoryRoot,
  output = null,
  protectedEvidence = {},
  sourceCommit: suppliedSourceCommit,
  env = process.env,
  spawnImpl,
  onGate = () => {},
  requireCleanSource = true,
} = {}) {
  const resolvedRoot = fs.realpathSync(path.resolve(rootDir));
  const manifest = loadDailyHarnessGatesManifest(undefined, { rootDir: resolvedRoot });
  const target = safeOutputPath(output, resolvedRoot);
  const cleanHead = requireCleanSource ? assertCleanHead(resolvedRoot) : suppliedSourceCommit ?? "UNCOMMITTED_TEST_ONLY";
  const evidenceRequested = Object.keys(protectedEvidence).length > 0;
  let sourceCommit = cleanHead;
  let evidenceCommit;
  const loadedEvidence = {};
  if (evidenceRequested) {
    if (!FULL_SHA.test(suppliedSourceCommit ?? "")) fail("protected evidence requires an exact source commit");
    sourceCommit = suppliedSourceCommit;
    evidenceCommit = cleanHead;
    if (requireCleanSource) validateEvidenceCommit(resolvedRoot, sourceCommit, evidenceCommit, protectedEvidence);
    for (const gateId of DAILY_HARNESS_PROTECTED_IDS) {
      loadedEvidence[gateId] = loadDailyHarnessProtectedEvidence(path.resolve(resolvedRoot, protectedEvidence[gateId]), { rootDir: resolvedRoot, gateId, expectedSourceCommit: sourceCommit });
    }
  }
  const startedAt = new Date().toISOString();
  const gates = [];
  for (const gate of manifest.gates) {
    let result;
    if (gate.execution === "protected-evidence") result = protectedResult(gate, loadedEvidence[gate.id]);
    else {
      const raw = await runCheck(gate, {
        cwd: resolvedRoot,
        maxOutputBytes: Math.min(gate.maxOutputBytes, manifest.policy.maxOutputBytes),
        env,
        ...(spawnImpl === undefined ? {} : { spawnImpl }),
      });
      result = publicDeterministicResult(raw);
    }
    gates.push(result);
    onGate(result);
  }
  if (requireCleanSource && assertCleanHead(resolvedRoot) !== cleanHead) fail("source commit changed while gates were running");
  const deterministic = gates.filter((gate) => gate.execution === "deterministic");
  const protectedGates = gates.filter((gate) => gate.execution === "protected-evidence");
  const deterministicPassed = deterministic.every((gate) => gate.status === "PASS");
  const protectedPassed = protectedGates.every((gate) => gate.status === "PASS");
  const passed = deterministicPassed && protectedPassed;
  const report = Object.freeze({
    schemaVersion: 1,
    kind: "only-my-pi-daily-harness-report",
    status: passed ? "COMPLETE" : deterministicPassed ? "BLOCKED_PROTECTED_EVIDENCE" : "FAILED",
    sourceCommit,
    executionCommit: cleanHead,
    ...(evidenceCommit ? { evidenceCommit } : {}),
    manifest: Object.freeze({ id: manifest.id, digest: dailyHarnessGatesDigest(manifest), gateIds: manifest.gates.map((gate) => gate.id) }),
    startedAt,
    completedAt: new Date().toISOString(),
    passed,
    deterministicPassed,
    gates: Object.freeze(gates),
    summary: Object.freeze({
      required: gates.length,
      deterministic: deterministic.length,
      deterministicPassed: deterministic.filter((gate) => gate.status === "PASS").length,
      protected: protectedGates.length,
      protectedPassed: protectedGates.filter((gate) => gate.status === "PASS").length,
      protectedNotRunByPolicy: protectedGates.filter((gate) => gate.status === "NOT_RUN_BY_POLICY").length,
    }),
    privacy: Object.freeze({ rawOutputStored: false, hostPathsStored: false, secretsStored: false, outputFingerprintsMayLeakShortPredictableValues: true }),
    authorization: Object.freeze({
      providerRequests: loadedEvidence.D13 ? "AUTHORIZED_BY_IMPORTED_EVIDENCE" : "NOT_RUN_BY_POLICY",
      realPiHome: loadedEvidence.D14 ? "AUTHORIZED_BY_IMPORTED_EVIDENCE" : "NOT_TOUCHED",
      publish: "NOT_AUTHORIZED",
      release: "NOT_AUTHORIZED",
    }),
  });
  if (target) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  }
  return Object.freeze({ report, target });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseDailyHarnessGateArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!args.run) {
    const result = inspectDailyHarnessGates(argv);
    process.stdout.write(args.json || args.gate ? `${JSON.stringify(result, null, 2)}\n` : `daily-harness-gates-v1: PASS (${result.deterministicGateIds.length} deterministic, ${result.protectedGateIds.length} protected)\n`);
    return 0;
  }
  const { report, target } = await runDailyHarnessVerification({
    output: args.output,
    protectedEvidence: args.protectedEvidence,
    ...(args.sourceCommit ? { sourceCommit: args.sourceCommit } : {}),
    onGate: (gate) => process.stderr.write(`${gate.status} ${gate.id} (${gate.durationMs} ms)\n`),
  });
  const summary = {
    status: report.status,
    passed: report.passed,
    deterministicPassed: report.deterministicPassed,
    deterministic: report.summary.deterministic,
    protectedNotRunByPolicy: report.summary.protectedNotRunByPolicy,
    ...(target ? { report: path.relative(repositoryRoot, target) } : {}),
  };
  process.stdout.write(args.json ? `${JSON.stringify(summary, null, 2)}\n` : `daily-harness-gates-v1: ${summary.status} (${summary.deterministic}/${report.summary.required} deterministic/protected gates)\n`);
  return Object.keys(args.protectedEvidence).length > 0 ? (report.passed ? 0 : 1) : (report.deterministicPassed ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`daily-harness-gates: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}
