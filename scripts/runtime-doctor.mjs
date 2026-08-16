#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExpectedRuntimeSnapshot, reconcileRuntimeMetadata } from "./lib/runtime-doctor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = [...argv];
  const result = { live: false, profile: "coding" };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--live") result.live = true;
    else if (arg === "--profile" && args.length) result.profile = args.shift();
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  if (!result.live) throw new Error("runtime doctor currently requires --live");
  return result;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const expected = loadExpectedRuntimeSnapshot({ rootDir: ROOT, profileId: options.profile });
  // The reconciliation library accepts injected metadata so deterministic
  // contract tests and a future first-party collector can share one validator.
  // The public CLI deliberately has no arbitrary --metadata lane: until a
  // versioned collector can prove provenance, external JSON must never become
  // release-authoritative live evidence.
  const result = reconcileRuntimeMetadata(undefined, expected);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = result.status === "UNAVAILABLE" ? 2 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`runtime-doctor: ${error.message}\n`);
    process.exitCode = 1;
  }
}
