#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  defaultReleaseGatesPath,
  loadReleaseGatesManifest,
  releaseGatesDigest,
  repositoryRoot,
  resolveReleaseGate,
  verificationRoot,
} from "./lib/release-gates.mjs";
import { runReleaseVerification } from "./verification-receipt.mjs";

function fail(message) {
  throw new Error(`release-gates: ${message}`);
}

export function parseReleaseGateArgs(argv) {
  const result = { manifest: defaultReleaseGatesPath, gate: null, json: false, help: false, run: false, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      if (seen.has("help")) fail("duplicate --help");
      seen.add("help");
      result.help = true;
      continue;
    }
    if (arg === "--json") {
      if (seen.has("json")) fail("duplicate --json");
      seen.add("json");
      result.json = true;
      continue;
    }
    if (arg === "--run") {
      if (seen.has("run")) fail("duplicate --run");
      seen.add("run");
      result.run = true;
      continue;
    }
    if (arg === "--output") {
      if (seen.has("output")) fail("duplicate --output");
      seen.add("output");
      const value = argv[++index];
      if (!value || value.startsWith("-")) fail("--output requires a path");
      result.output = value;
      continue;
    }
    if (arg === "--manifest") {
      if (seen.has("manifest")) fail("duplicate --manifest");
      seen.add("manifest");
      const value = argv[++index];
      if (!value || value.startsWith("-")) fail("--manifest requires a path");
      result.manifest = path.resolve(repositoryRoot, value);
      continue;
    }
    if (arg === "--gate") {
      if (seen.has("gate")) fail("duplicate --gate");
      seen.add("gate");
      const value = argv[++index];
      if (!value || value.startsWith("-")) fail("--gate requires an ID");
      result.gate = value;
      continue;
    }
    throw new Error(`release-gates: unknown argument ${arg}`);
  }
  if (result.output !== null && !result.run) fail("--output requires --run");
  if (result.run && result.gate !== null) fail("--run cannot be combined with --gate");
  return Object.freeze(result);
}

function usage() {
  return [
    "Usage: node scripts/release-gates.mjs [--manifest verification/release-gates-v1.json] [--gate <id>] [--json]",
    "       node scripts/release-gates.mjs --run [--output verification/receipts/<file>.json] [--json]",
    "",
    "Without --run this validates and resolves the fixed release gate contract without executing it.",
    "With --run it requires a clean source commit, executes the exact manifest, and writes one bounded receipt.",
    "The receipt runner is the orchestrator and is intentionally absent from the gate set.",
  ].join("\n");
}

export function inspectReleaseGates(argv = process.argv.slice(2)) {
  const args = parseReleaseGateArgs(argv);
  if (args.help) return { help: usage() };
  const manifest = loadReleaseGatesManifest(args.manifest, { allowedRoot: verificationRoot });
  const digest = releaseGatesDigest(manifest);
  if (args.gate) {
    return {
      formatVersion: 1,
      manifest: manifest.id,
      manifestDigest: digest,
      gate: resolveReleaseGate(manifest, args.gate),
      executable: false,
    };
  }
  return {
    formatVersion: 1,
    manifest: manifest.id,
    manifestDigest: digest,
    gateIds: manifest.gates.map((gate) => gate.id),
    gateCount: manifest.gates.length,
    executable: false,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseReleaseGateArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.run) {
    const manifest = loadReleaseGatesManifest(args.manifest, { allowedRoot: verificationRoot });
    const result = await runReleaseVerification({
      manifest,
      rootDir: repositoryRoot,
      output: args.output,
      onGate: (gate) => process.stderr.write(`${gate.status} ${gate.id} (${gate.durationMs} ms)\n`),
    });
    const summary = {
      status: result.receipt.status,
      passed: result.receipt.passed,
      sourceCommit: result.receipt.sourceCommit,
      manifestDigest: result.receipt.manifest.digest,
      gateCount: result.receipt.gates.length,
      receipt: path.relative(repositoryRoot, result.target),
    };
    console.log(args.json ? JSON.stringify(summary, null, 2) : `release-gates-v1: ${summary.status} (${summary.gateCount} gates, ${summary.receipt})`);
    return result.receipt.passed ? 0 : 1;
  }
  const result = inspectReleaseGates(argv);
  if (args.json || args.gate) console.log(JSON.stringify(result, null, 2));
  else console.log(`release-gates-v1: PASS (${result.gateCount} gates, ${result.manifestDigest})`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`release-gates: ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
