#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHECKS = Object.freeze([
  Object.freeze({ id: "lint", command: "npm", args: Object.freeze(["run", "lint"]) }),
  Object.freeze({ id: "typecheck", command: "npm", args: Object.freeze(["run", "typecheck"]) }),
  Object.freeze({ id: "schema", command: "npm", args: Object.freeze(["run", "schema:check"]) }),
  Object.freeze({ id: "pack", command: "npm", args: Object.freeze(["run", "pack:check"]) }),
  Object.freeze({ id: "agents", command: "npm", args: Object.freeze(["run", "agents:check"]) }),
  Object.freeze({
    id: "global-coverage",
    command: process.execPath,
    args: Object.freeze(["--test", "--experimental-test-coverage", "--test-coverage-lines=85", "--test-coverage-branches=69", "--test-coverage-functions=85"]),
  }),
  Object.freeze({
    id: "session-composer-coverage",
    command: process.execPath,
    args: Object.freeze([
      "--test", "--experimental-test-coverage",
      "--test-coverage-include=packages/subagents/runtime/session-composer.mjs",
      "--test-coverage-lines=90", "--test-coverage-branches=80", "--test-coverage-functions=90",
      "tests/session-runtime-composer.test.mjs", "tests/session-runtime-components.test.mjs",
    ]),
  }),
  Object.freeze({
    id: "omp-control-coverage",
    command: process.execPath,
    args: Object.freeze([
      "--test", "--experimental-test-coverage",
      "--test-coverage-include=extensions/omp-control/runtime.mjs",
      "--test-coverage-lines=85", "--test-coverage-branches=70", "--test-coverage-functions=85",
      "tests/omp-control-runtime.test.mjs", "tests/omp-control-runtime-daily.test.mjs",
    ]),
  }),
]);

function safeEnvironment(inherited = process.env) {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SYSTEMROOT", "COMSPEC", "PATHEXT"]) {
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

export function runM8AcceptanceCheck(check, { spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(check.command, check.args, {
        cwd: repositoryRoot,
        env: safeEnvironment(env),
        shell: false,
        stdio: "inherit",
      });
    } catch (cause) {
      reject(Object.assign(new Error(`M8 acceptance check could not start: ${check.id}`, { cause }), { code: "M8_CHECK_START_FAILED" }));
      return;
    }
    child.once("error", (cause) => reject(Object.assign(new Error(`M8 acceptance check could not start: ${check.id}`, { cause }), { code: "M8_CHECK_START_FAILED" })));
    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) resolve({ id: check.id, status: "PASS" });
      else reject(Object.assign(new Error(`M8 acceptance check failed: ${check.id}`), { code: "M8_CHECK_FAILED", checkId: check.id, exitCode, signal: signal ?? null }));
    });
  });
}

export async function runM8DeterministicAcceptance(options = {}) {
  const passed = [];
  for (const check of CHECKS) {
    process.stderr.write(`M8_CHECK_START ${check.id}\n`);
    const result = await runM8AcceptanceCheck(check, options);
    passed.push(result.id);
    process.stderr.write(`M8_CHECK_PASS ${check.id}\n`);
  }
  return Object.freeze({ ok: true, status: "M8_DETERMINISTIC_ACCEPTANCE_PASS", checks: Object.freeze(passed) });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) throw Object.assign(new Error("m8-deterministic-acceptance accepts no arguments"), { code: "INVALID_ARGUMENT" });
  const result = await runM8DeterministicAcceptance();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`m8-deterministic-acceptance: ERROR ${error.code ?? "M8_ACCEPTANCE_FAILED"} ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { CHECKS as M8_DETERMINISTIC_CHECKS };
