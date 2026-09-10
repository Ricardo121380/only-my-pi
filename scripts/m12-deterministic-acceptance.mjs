#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  M8_DETERMINISTIC_CHECKS,
  runM8AcceptanceCheck,
} from "./m8-deterministic-acceptance.mjs";

const DIRECT_AGENT_COVERAGE = Object.freeze({
  id: "m12-direct-agent-coverage",
  command: process.execPath,
  args: Object.freeze([
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=packages/direct-agent/launcher.mjs",
    "--test-coverage-include=packages/direct-agent/managed-clone.mjs",
    "--test-coverage-include=extensions/omp-direct/runtime.mjs",
    "--test-coverage-lines=90",
    "--test-coverage-branches=80",
    "--test-coverage-functions=90",
    "tests/direct-agent-launcher.test.mjs",
    "tests/direct-agent-managed-clone.test.mjs",
    "tests/omp-direct-session.test.mjs",
    "tests/m12-direct-coding-integration.test.mjs",
    "tests/m12-direct-agent-error-paths.test.mjs",
  ]),
});

export const M12_DETERMINISTIC_CHECKS = Object.freeze([
  ...M8_DETERMINISTIC_CHECKS,
  DIRECT_AGENT_COVERAGE,
]);

export async function runM12DeterministicAcceptance(options = {}) {
  const passed = [];
  for (const check of M12_DETERMINISTIC_CHECKS) {
    process.stderr.write(`M12_CHECK_START ${check.id}\n`);
    const result = await runM8AcceptanceCheck(check, options);
    passed.push(result.id);
    process.stderr.write(`M12_CHECK_PASS ${check.id}\n`);
  }
  return Object.freeze({
    ok: true,
    status: "M12_DETERMINISTIC_ACCEPTANCE_PASS",
    checks: Object.freeze(passed),
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    const error = new Error("m12-deterministic-acceptance accepts no arguments");
    error.code = "INVALID_ARGUMENT";
    throw error;
  }
  const result = await runM12DeterministicAcceptance();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`m12-deterministic-acceptance: ERROR ${error.code ?? "M12_ACCEPTANCE_FAILED"} ${error.message}\n`);
    process.exitCode = 1;
  }
}
