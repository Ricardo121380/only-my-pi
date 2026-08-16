#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { BootstrapService } from "../packages/bootstrap/bootstrap-service.mjs";
import { createNpmCommandRunner } from "../packages/bootstrap/command-runner.mjs";
import { DoctorService } from "../packages/bootstrap/doctor-service.mjs";
import { createNoModelSmokeRunner } from "../packages/bootstrap/smoke-runner.mjs";
import { TransactionEngine } from "../packages/bootstrap/transaction-engine.mjs";
import { parseOmpArgs } from "../packages/control-service/cli-parser.mjs";
import { ControlService, OMP_USAGE } from "../packages/control-service/service.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;
const UNAVAILABLE_STATUSES = new Set([
  "UNAVAILABLE",
  "LIVE_METADATA_UNAVAILABLE",
  "TRANSACTION_ENGINE_UNAVAILABLE",
  "PACKAGE_RUNNER_UNAVAILABLE",
  "SMOKE_RUNNER_UNAVAILABLE",
]);

export const OMP_EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  FAILURE: 1,
  USAGE: 2,
  CONFIRMATION_REQUIRED: 3,
  UNAVAILABLE: 4,
});

const DEFAULT_DEPENDENCIES = Object.freeze({
  BootstrapService,
  ControlService,
  DoctorService,
  TransactionEngine,
  createNpmCommandRunner,
  createNoModelSmokeRunner,
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertFunction(value, label) {
  if (typeof value !== "function") fail("INVALID_CLI_DEPENDENCY", `${label} must be a function`);
  return value;
}

function assertAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    fail("INVALID_CLI_PATH", `${label} must be an explicit absolute path`);
  }
  return path.resolve(value);
}

function dependenciesWithDefaults(overrides = {}) {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    fail("INVALID_CLI_DEPENDENCY", "dependencies must be an object");
  }
  const allowed = new Set(Object.keys(DEFAULT_DEPENDENCIES));
  for (const key of Object.keys(overrides)) {
    if (!allowed.has(key)) fail("INVALID_CLI_DEPENDENCY", `unknown CLI dependency: ${key}`);
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  for (const key of allowed) assertFunction(dependencies[key], key);
  return dependencies;
}

/**
 * Construct the complete production control plane for one already-parsed
 * config root. Constructors are injectable so tests never need to spawn npm,
 * Pi, access a Provider, or use the real Pi home.
 */
export function createProductionControlService({
  rootDir = DEFAULT_ROOT,
  configRoot,
  spawnImpl,
  confirm,
  dependencies,
} = {}) {
  const resolvedRoot = assertAbsolutePath(rootDir, "rootDir");
  const resolvedConfigRoot = assertAbsolutePath(configRoot, "configRoot");
  const wired = dependenciesWithDefaults(dependencies);
  const doctor = new wired.DoctorService({ rootDir: resolvedRoot });
  const runner = wired.createNpmCommandRunner({ configRoot: resolvedConfigRoot });
  const smokeOptions = spawnImpl === undefined ? {} : { spawnImpl };
  const smokeRunner = wired.createNoModelSmokeRunner(smokeOptions);
  const transactionEngine = new wired.TransactionEngine({
    rootDir: resolvedRoot,
    runner,
    smokeRunner,
    doctorService: doctor,
  });
  const bootstrap = new wired.BootstrapService({
    rootDir: resolvedRoot,
    doctorService: doctor,
    transactionEngine,
  });
  return new wired.ControlService({
    bootstrap,
    doctor,
    confirm,
    rootDir: resolvedRoot,
    configRoot: resolvedConfigRoot,
  });
}

/**
 * Interactive approval is deliberately exact: only the full word "yes" is
 * accepted. Non-TTY callers cannot approve through this seam and must pass an
 * explicit parser-approved --yes flag.
 */
export function createTerminalConfirm({ input = process.stdin, output = process.stderr } = {}) {
  return async function confirmMutation({ command, plan } = {}) {
    if (input?.isTTY !== true || output?.isTTY !== true) return false;
    const planDigest = typeof plan?.planDigest === "string" ? plan.planDigest : "unavailable";
    const prompt = `Apply ${String(command)} plan ${planDigest}? Type 'yes' to continue: `;
    output.write(formatOmpHuman(plan));
    const readline = createInterface({ input, output, terminal: true });
    try {
      return (await readline.question(prompt)).trim() === "yes";
    } finally {
      readline.close();
    }
  };
}

function canonicalize(value, stack = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (["undefined", "function", "symbol"].includes(typeof value)) return undefined;
  if (typeof value === "bigint") fail("OUTPUT_NOT_SERIALIZABLE", "CLI output contains a bigint");
  if (stack.has(value)) fail("OUTPUT_NOT_SERIALIZABLE", "CLI output contains a cycle");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalize(entry, stack) ?? null);
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = canonicalize(value[key], stack);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  } finally {
    stack.delete(value);
  }
}

export function stringifyOmpJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function singleLine(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\0\r\n\t]+/gu, " ").trim().slice(0, 512);
}

function shellWord(value) {
  return /^[A-Za-z0-9_./,:+-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function addField(lines, label, value) {
  if (value === undefined || value === null || value === "") return;
  lines.push(`${label}: ${String(value)}`);
}

function humanConfirmationHint(command) {
  if (["bootstrap", "update", "uninstall"].includes(command)) {
    return `rerun omp ${command} with --apply --yes after reviewing this plan`;
  }
  return `rerun omp ${command} with --yes after reviewing this plan`;
}

export function formatOmpHuman(result) {
  if (result?.status === "HELP" && typeof result.text === "string") {
    return `${result.text.replace(/\n+$/u, "")}\n`;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail("INVALID_SERVICE_RESULT", "control service must return an object");
  }

  const plan = result.status === "CONFIRMATION_REQUIRED" ? result.plan : null;
  const details = plan ?? result;
  const lines = [];
  addField(lines, "status", result.status ?? details.status ?? "UNKNOWN");
  if (typeof result.ok === "boolean") addField(lines, "ok", result.ok);
  if (typeof result.mutation === "boolean") addField(lines, "mutation", result.mutation);
  addField(lines, "code", result.code);
  addField(lines, "message", singleLine(result.message));
  addField(lines, "command", typeof result.command === "string" ? result.command : undefined);
  addField(lines, "operation", details.operation);
  addField(lines, "configRoot", details.configRoot);
  addField(lines, "profileId", details.profileId);
  addField(lines, "generationId", details.generationId ?? details.desired?.generationId);
  addField(lines, "snapshotId", details.snapshotId);
  addField(lines, "transactionId", details.transactionId);
  addField(lines, "planDigest", details.planDigest);
  addField(lines, "settingsDigest", details.settingsDigest);
  addField(lines, "generationProbe", details.generationProbe?.status);

  const providerSelection = details.providerSelection ?? details.desired?.metadata?.providerSelection;
  if (providerSelection) {
    addField(lines, "provider", providerSelection.providerId);
    addField(lines, "model", providerSelection.modelId);
    addField(lines, "providerStatus", providerSelection.status);
  }
  if (details.zeroWriteEvidence) {
    const evidence = details.zeroWriteEvidence;
    lines.push(`zeroWrite: writes=${evidence.writes} subprocesses=${evidence.subprocesses} providerRequests=${evidence.providerRequests}`);
  }
  if (Array.isArray(details.changes)) {
    lines.push(`changes: ${details.changes.length}`);
    for (const change of details.changes) lines.push(`  - ${singleLine(String(change))}`);
  }
  if (Array.isArray(result.incompleteTransactions)) {
    lines.push(`incompleteTransactions: ${result.incompleteTransactions.length}`);
  }
  if (Array.isArray(result.command)) {
    lines.push(`safeCommand: ${result.command.map((entry) => shellWord(String(entry))).join(" ")}`);
  }
  addField(lines, "next", result.next);
  addField(lines, "note", singleLine(result.note));
  if (result.status === "CONFIRMATION_REQUIRED") {
    lines.push(`confirmation: ${humanConfirmationHint(result.command)}`);
  }
  return `${lines.join("\n")}\n`;
}

function publicError(error) {
  const candidateCode = typeof error?.code === "string" ? error.code.toUpperCase() : "CLI_FAILED";
  const code = ERROR_CODE.test(candidateCode) ? candidateCode : "CLI_FAILED";
  return Object.freeze({
    ok: false,
    status: "ERROR",
    mutation: false,
    code,
    message: singleLine(error?.message, "only-my-pi CLI failed"),
  });
}

function isUsageError(error) {
  return ["INVALID_ARGUMENT", "INVALID_CONFIG_ROOT"].includes(error?.code);
}

function exitCodeForError(error) {
  if (isUsageError(error)) return OMP_EXIT_CODES.USAGE;
  const code = String(error?.code ?? "");
  if (UNAVAILABLE_STATUSES.has(code) || code.endsWith("_UNAVAILABLE")) return OMP_EXIT_CODES.UNAVAILABLE;
  return OMP_EXIT_CODES.FAILURE;
}

export function exitCodeForResult(result) {
  if (result?.status === "CONFIRMATION_REQUIRED") return OMP_EXIT_CODES.CONFIRMATION_REQUIRED;
  if (UNAVAILABLE_STATUSES.has(result?.status) || String(result?.status ?? "").endsWith("_UNAVAILABLE")) {
    return OMP_EXIT_CODES.UNAVAILABLE;
  }
  if (result?.ok === false) return OMP_EXIT_CODES.FAILURE;
  return OMP_EXIT_CODES.SUCCESS;
}

function writeText(stream, content) {
  if (!stream || typeof stream.write !== "function") fail("INVALID_CLI_STREAM", "CLI output stream must implement write()");
  stream.write(content);
}

function wantsJson(argv) {
  return Array.isArray(argv) && argv.includes("--json");
}

/**
 * Execute one CLI request and return an exit code without calling process.exit.
 * Callers may inject a complete service or a factory; production construction
 * occurs only after strict argument parsing and never for help.
 */
export async function runOmpCli({
  argv = process.argv.slice(2),
  env = process.env,
  homedir = os.homedir,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  rootDir = DEFAULT_ROOT,
  service,
  serviceFactory = createProductionControlService,
  dependencies,
  spawnImpl,
  confirm,
} = {}) {
  let request;
  try {
    request = parseOmpArgs(argv, { env, homedir });
    if (request.command === "help") {
      writeText(stdout, formatOmpHuman({ ok: true, status: "HELP", mutation: false, text: OMP_USAGE }));
      return OMP_EXIT_CODES.SUCCESS;
    }
    if (service !== undefined && (service === null || typeof service.dispatch !== "function")) {
      fail("INVALID_CONTROL_SERVICE", "injected service must implement dispatch()");
    }
    if (service === undefined) {
      assertFunction(serviceFactory, "serviceFactory");
      const terminalConfirm = confirm ?? createTerminalConfirm({ input: stdin, output: stderr });
      service = serviceFactory({
        rootDir,
        configRoot: request.options.configRoot,
        spawnImpl,
        confirm: terminalConfirm,
        dependencies,
      });
      if (!service || typeof service.dispatch !== "function") {
        fail("INVALID_CONTROL_SERVICE", "serviceFactory must return a dispatch-capable service");
      }
    }
    const result = await service.dispatch(request);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      fail("INVALID_SERVICE_RESULT", "control service must return an object");
    }
    writeText(stdout, request.options.json ? stringifyOmpJson(result) : formatOmpHuman(result));
    return exitCodeForResult(result);
  } catch (error) {
    const output = publicError(error);
    writeText(stderr, wantsJson(argv) ? stringifyOmpJson(output) : formatOmpHuman(output));
    return exitCodeForError(error);
  }
}

function isExecutedAsProgram(argvPath) {
  if (typeof argvPath !== "string" || argvPath.length === 0) return false;
  try {
    return realpathSync(argvPath) === realpathSync(THIS_FILE);
  } catch {
    return false;
  }
}

if (isExecutedAsProgram(process.argv[1])) {
  process.exitCode = await runOmpCli();
}
