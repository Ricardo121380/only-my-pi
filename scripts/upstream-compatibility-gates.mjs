#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadUpstreamCompatibility } from "../packages/upstream-compatibility/index.mjs";
import {
  loadUpstreamCompatibilityGatesManifest,
  resolveUpstreamCompatibilityGate,
  UPSTREAM_COMPATIBILITY_DETERMINISTIC_IDS,
  UPSTREAM_COMPATIBILITY_PROTECTED_IDS,
  upstreamCompatibilityGatesDigest,
} from "./lib/upstream-compatibility-gates.mjs";
import { repositoryRoot, runCheck } from "./verification-receipt.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/u;

function fail(message) {
  throw new Error(`upstream-compatibility-gates: ${message}`);
}

export function parseUpstreamCompatibilityGateArgs(argv) {
  const output = { run: false, json: false, help: false, gate: null, output: null };
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
    if (["--gate", "--output"].includes(argument)) {
      if (seen.has(argument)) fail(`duplicate ${argument}`);
      seen.add(argument);
      const value = argv[++index];
      if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) fail(`${argument} requires a value`);
      if (argument === "--gate") output.gate = value;
      else output.output = value;
      continue;
    }
    fail(`unknown argument ${argument}`);
  }
  if (output.output !== null && !output.run) fail("--output requires --run");
  if (output.run && output.gate !== null) fail("--run cannot be combined with --gate");
  return Object.freeze(output);
}

function usage() {
  return [
    "Usage: node scripts/upstream-compatibility-gates.mjs [--gate U1..U9] [--json]",
    "       node scripts/upstream-compatibility-gates.mjs --run [--output verification/receipts/<file>.json] [--json]",
    "",
    "Without --run this validates and displays the fixed M9 gate contract.",
    "With --run it executes U1-U8 with shell:false. U9 is protected evidence-only,",
    "is never spawned by this runner, and cannot silently promote the candidate defaults.",
  ].join("\n");
}

export function inspectUpstreamCompatibilityGates(argv = process.argv.slice(2), { rootDir = repositoryRoot } = {}) {
  const args = parseUpstreamCompatibilityGateArgs(argv);
  if (args.help) return { help: usage() };
  if (args.run) fail("inspect mode cannot use --run");
  const manifest = loadUpstreamCompatibilityGatesManifest(undefined, { rootDir });
  const contract = loadUpstreamCompatibility({ rootDir });
  if (args.gate !== null) {
    return Object.freeze({
      formatVersion: 1,
      manifest: manifest.id,
      manifestDigest: upstreamCompatibilityGatesDigest(manifest),
      gate: resolveUpstreamCompatibilityGate(manifest, args.gate),
      decision: contract.decision,
      executable: false,
    });
  }
  return Object.freeze({
    formatVersion: 1,
    manifest: manifest.id,
    manifestDigest: upstreamCompatibilityGatesDigest(manifest),
    deterministicGateIds: [...UPSTREAM_COMPATIBILITY_DETERMINISTIC_IDS],
    protectedGateIds: [...UPSTREAM_COMPATIBILITY_PROTECTED_IDS],
    protectedDefault: "NOT_RUN_BY_POLICY",
    decision: contract.decision,
    executable: false,
  });
}

function git(rootDir, args) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertCleanHead(rootDir) {
  if (git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
    fail("verification requires a completely clean source commit");
  }
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(head)) fail("cannot resolve a full source commit");
  return head;
}

function safeOutputPath(requested, rootDir) {
  if (requested === null) return null;
  const receiptsRoot = path.join(rootDir, "verification", "receipts");
  const target = path.resolve(rootDir, requested);
  const relative = path.relative(receiptsRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(".json")) {
    fail("report output must be a JSON file inside verification/receipts");
  }
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

function protectedResult(gate) {
  return Object.freeze({
    id: gate.id,
    execution: "protected-evidence",
    status: "NOT_RUN_BY_POLICY",
    passed: false,
    exitCode: null,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    expectationPassed: false,
    durationMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: emptyDigest(),
    stderrSha256: emptyDigest(),
  });
}

export async function runUpstreamCompatibilityVerification({
  rootDir = repositoryRoot,
  output = null,
  env = process.env,
  spawnImpl,
  onGate = () => {},
  requireCleanSource = true,
  sourceCommit = "UNCOMMITTED_TEST_ONLY",
} = {}) {
  const resolvedRoot = fs.realpathSync(path.resolve(rootDir));
  const manifest = loadUpstreamCompatibilityGatesManifest(undefined, { rootDir: resolvedRoot });
  const contract = loadUpstreamCompatibility({ rootDir: resolvedRoot });
  const target = safeOutputPath(output, resolvedRoot);
  const executionCommit = requireCleanSource ? assertCleanHead(resolvedRoot) : sourceCommit;
  const startedAt = new Date().toISOString();
  const gates = [];

  for (const gate of manifest.gates) {
    let result;
    if (gate.execution === "protected-evidence") result = protectedResult(gate);
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

  if (requireCleanSource && assertCleanHead(resolvedRoot) !== executionCommit) {
    fail("source commit changed while gates were running");
  }
  const deterministic = gates.filter((gate) => gate.execution === "deterministic");
  const deterministicPassed = deterministic.every((gate) => gate.status === "PASS");
  const report = Object.freeze({
    schemaVersion: 1,
    kind: "only-my-pi-upstream-compatibility-report",
    status: deterministicPassed ? "HOLD_PROTECTED_EVIDENCE" : "FAILED",
    sourceCommit: executionCommit,
    manifest: Object.freeze({
      id: manifest.id,
      digest: upstreamCompatibilityGatesDigest(manifest),
      gateIds: manifest.gates.map((gate) => gate.id),
    }),
    contract: Object.freeze({
      id: contract.id,
      digest: contract.contractDigest,
      decision: contract.decision.state,
      baseline: contract.baseline,
      candidate: Object.freeze({
        piVersion: contract.candidate.piVersion,
        subagentsVersion: contract.candidate.subagentsVersion,
      }),
    }),
    startedAt,
    completedAt: new Date().toISOString(),
    passed: false,
    deterministicPassed,
    gates: Object.freeze(gates),
    summary: Object.freeze({
      required: gates.length,
      deterministic: deterministic.length,
      deterministicPassed: deterministic.filter((gate) => gate.status === "PASS").length,
      protected: 1,
      protectedNotRunByPolicy: 1,
    }),
    privacy: Object.freeze({
      rawOutputStored: false,
      hostPathsStored: false,
      secretsStored: false,
      outputFingerprintsMayLeakShortPredictableValues: true,
    }),
    authorization: Object.freeze({
      providerRequests: "NOT_RUN_BY_POLICY",
      realPiHome: "NOT_TOUCHED",
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
  const args = parseUpstreamCompatibilityGateArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!args.run) {
    const result = inspectUpstreamCompatibilityGates(argv);
    process.stdout.write(args.json || args.gate
      ? `${JSON.stringify(result, null, 2)}\n`
      : `upstream-compatibility-gates-v1: PASS (${result.deterministicGateIds.length} deterministic, ${result.protectedGateIds.length} protected)\n`);
    return 0;
  }
  const { report, target } = await runUpstreamCompatibilityVerification({
    output: args.output,
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
  process.stdout.write(args.json
    ? `${JSON.stringify(summary, null, 2)}\n`
    : `upstream-compatibility-gates-v1: ${summary.status} (${summary.deterministic}/${report.summary.required} deterministic/protected gates)\n`);
  return report.deterministicPassed ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`upstream-compatibility-gates: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { usage as upstreamCompatibilityGatesUsage };
