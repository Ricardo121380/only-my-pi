#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const M10_DETERMINISTIC_CHECKS = Object.freeze([
  Object.freeze({ id: "lint", command: "npm", args: Object.freeze(["run", "lint"]) }),
  Object.freeze({ id: "typecheck", command: "npm", args: Object.freeze(["run", "typecheck"]) }),
  Object.freeze({ id: "schemas", command: "npm", args: Object.freeze(["run", "schema:check"]) }),
  Object.freeze({ id: "pack", command: "npm", args: Object.freeze(["run", "pack:check"]) }),
  Object.freeze({ id: "agents", command: "npm", args: Object.freeze(["run", "agents:check"]) }),
  Object.freeze({
    id: "global-coverage",
    command: process.execPath,
    args: Object.freeze(["--test", "--experimental-test-coverage", "--test-coverage-lines=85", "--test-coverage-branches=69", "--test-coverage-functions=85"]),
  }),
  Object.freeze({
    id: "upstream-migration-coverage",
    command: process.execPath,
    args: Object.freeze([
      "--test", "--experimental-test-coverage",
      "--test-coverage-include=packages/upstream-migration/*.mjs",
      "--test-coverage-lines=90", "--test-coverage-branches=80", "--test-coverage-functions=90",
      "tests/upstream-migration-candidate-target.test.mjs",
      "tests/upstream-migration-contract.test.mjs",
      "tests/upstream-migration-filesystem-platform.test.mjs",
      "tests/upstream-migration-journal.test.mjs",
      "tests/upstream-migration-planner.test.mjs",
      "tests/upstream-migration-process.test.mjs",
      "tests/upstream-migration-transaction-engine.test.mjs",
      "tests/m10-promotion-contract.test.mjs",
    ]),
  }),
]);

function controlledEnvironment(inherited = process.env) {
  const env = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SYSTEMROOT", "COMSPEC", "PATHEXT"]) {
    if (typeof inherited[key] === "string") env[key] = inherited[key];
  }
  return {
    ...env,
    CI: "1",
    NO_COLOR: "1",
    PI_TELEMETRY: "0",
    npm_config_offline: "true",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    ...(typeof inherited.npm_config_cache === "string" ? { npm_config_cache: inherited.npm_config_cache } : {}),
  };
}

export function runM10AcceptanceCheck(check, { spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(check.command, check.args, { cwd: ROOT, env: controlledEnvironment(env), shell: false, stdio: "inherit" });
    } catch (cause) {
      reject(Object.assign(new Error(`M10 acceptance check could not start: ${check.id}`, { cause }), { code: "M10_CHECK_START_FAILED" }));
      return;
    }
    child.once("error", (cause) => reject(Object.assign(new Error(`M10 acceptance check could not start: ${check.id}`, { cause }), { code: "M10_CHECK_START_FAILED" })));
    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) resolve({ id: check.id, status: "PASS" });
      else reject(Object.assign(new Error(`M10 acceptance check failed: ${check.id}`), { code: "M10_CHECK_FAILED", checkId: check.id, exitCode, signal: signal ?? null }));
    });
  });
}

export async function runM10DeterministicAcceptance(options = {}) {
  const checks = [];
  for (const check of M10_DETERMINISTIC_CHECKS) {
    process.stderr.write(`M10_CHECK_START ${check.id}\n`);
    await runM10AcceptanceCheck(check, options);
    checks.push(check.id);
    process.stderr.write(`M10_CHECK_PASS ${check.id}\n`);
  }
  return Object.freeze({ ok: true, status: "M10_DETERMINISTIC_ACCEPTANCE_PASS", checks: Object.freeze(checks) });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) throw Object.assign(new Error("m10-deterministic-acceptance accepts no arguments"), { code: "INVALID_ARGUMENT" });
  const result = await runM10DeterministicAcceptance();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`m10-deterministic-acceptance: ERROR ${error.code ?? "M10_ACCEPTANCE_FAILED"} ${error.message}\n`);
    process.exitCode = 1;
  });
}
