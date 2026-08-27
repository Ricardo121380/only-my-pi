#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  evaluateSubagentsPromotion,
  loadSubagentsReleaseContracts,
  SUBAGENTS_PROMOTION_CHANNELS,
  validateCompatibilityMatrix,
  validatePromotionPolicy,
} from "../packages/subagents/release/compatibility.mjs";

export function parseCompatibilityArgs(argv) {
  const output = { requested: "preview", json: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      if (seen.has("json")) throw new Error("duplicate --json");
      seen.add("json");
      output.json = true;
    } else if (arg === "--help" || arg === "-h") {
      if (seen.has("help")) throw new Error("duplicate --help");
      seen.add("help");
      output.help = true;
    } else if (arg === "--requested") {
      if (seen.has("requested")) throw new Error("duplicate --requested");
      seen.add("requested");
      const value = argv[++index];
      if (!SUBAGENTS_PROMOTION_CHANNELS.includes(value)) throw new Error("--requested must be preview, alpha, beta, or stable");
      output.requested = value;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return output;
}

function usage() {
  return "Usage: node scripts/subagents-compatibility.mjs [--requested preview|alpha|beta|stable] [--json]";
}

export function inspectSubagentsCompatibility(argv = process.argv.slice(2)) {
  const args = parseCompatibilityArgs(argv);
  if (args.help) return { help: usage() };
  const { matrix, policy } = loadSubagentsReleaseContracts();
  const checkedMatrix = validateCompatibilityMatrix(matrix, { verifyEvidencePaths: true });
  const checkedPolicy = validatePromotionPolicy(policy);
  const evaluation = evaluateSubagentsPromotion({
    requested: args.requested,
    matrix: checkedMatrix,
    policy: checkedPolicy,
  });
  return {
    formatVersion: 1,
    status: "COMPATIBILITY_CONTRACT_PASS",
    requestedPromotion: args.requested,
    promotionEligibility: "NOT_EVALUATED_WITHOUT_GATE_RESULTS",
    highestCompatibilityOnlyChannel: evaluation.achieved,
    matrixDigest: checkedMatrix.matrixDigest,
    policyDigest: checkedPolicy.policyDigest,
    rows: checkedMatrix.rows.map((row) => ({ id: row.id, environment: row.environment, scopes: row.scopes })),
    missingForRequested: evaluation.evaluations.at(-1)?.findings ?? [],
  };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseCompatibilityArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = inspectSubagentsCompatibility(argv);
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.status} ${report.matrixDigest}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`subagents-compatibility: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}
