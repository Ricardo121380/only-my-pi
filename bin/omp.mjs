#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";
import { parseOmpArgs } from "../packages/control-service/cli-parser.mjs";
import { classifyOmpInvocation, launchDirectAgent, OMP_AGENT_USAGE } from "../packages/direct-agent/launcher.mjs";
import { assertSupportedNode, loadDistribution, readRegularJson } from "../packages/distribution/runtime.mjs";

const require = createRequire(import.meta.url);
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

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertFunction(value, label) {
  if (typeof value !== "function") fail("INVALID_CLI_DEPENDENCY", `${label} must be a function`);
  return value;
}

/** Preserve the synchronous public factory while loading management only on demand.
 * Node 24 supports requiring an ESM graph without top-level await. */
export function createProductionControlService(options = {}) {
  return require("../packages/control-service/production.mjs").createProductionControlService(options);
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
  if (["bootstrap", "install", "update", "uninstall"].includes(command)) {
    return `rerun omp ${command} with --apply --yes after reviewing this plan`;
  }
  if (command === "profiles") return "rerun omp profiles apply <preset> with --yes after reviewing this plan";
  if (command === "runs") return "rerun omp runs gc with --apply --yes after reviewing this plan";
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
  addField(lines, "themeId", details.themeId ?? details.theme?.id);
  addField(lines, "piThemeName", details.piThemeName ?? details.theme?.piThemeName);
  addField(lines, "harnessStatus", details.harnessStatus ? details.harnessStatus.status : undefined);
  addField(lines, "packageVersion", details.packageVersion);
  addField(lines, "sourceCommit", details.sourceCommit);
  addField(lines, "artifactSha256", details.artifactSha256);
  addField(lines, "cliRoot", details.cliRoot);
  addField(lines, "piVersion", details.piVersion);
  addField(lines, "subagentsVersion", details.subagentsVersion);
  addField(lines, "decision", details.decision);
  addField(lines, "stackId", details.stackId ?? details.activeStackId);
  addField(lines, "payloadMode", details.payloadMode);
  addField(lines, "nodeVersion", details.nodeVersion ?? details.embeddedNodeVersion);
  addField(lines, "installationChannel", details.installation?.channel);
  addField(lines, "distributionId", details.distributionId);
  addField(lines, "backup", details.backup);
  addField(lines, "replacement", details.replacement);
  if (details.harnessStatus?.provenance) addField(lines, "provenance", details.harnessStatus.provenance);

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
    mutation: error?.mutation === true,
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
      const { OMP_USAGE } = await import("../packages/control-service/service.mjs");
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

/**
 * Route the public `omp` entry without placing a long-lived wrapper around Pi.
 * Management requests retain the existing plan-first CLI. Daily Agent requests
 * replace this process with the controlled Pi runtime through launchDirectAgent.
 */
export async function runOmpEntrypoint(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let route;
  try {
    assertSupportedNode();
    if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) {
      const manifest = await readRegularJson(path.join(options.rootDir ?? DEFAULT_ROOT, "package.json"));
      writeText(stdout, `only-my-pi ${manifest.version}\n`);
      return OMP_EXIT_CODES.SUCCESS;
    }
    route = classifyOmpInvocation(argv);
    if (route.kind === "web") {
      const { runWebCommand } = await import("../packages/host/cli.mjs");
      const result = await (options.webCommand ?? runWebCommand)({ argv: route.argv, packageRoot: options.rootDir ?? DEFAULT_ROOT, env: options.env ?? process.env });
      writeText(stdout, stringifyOmpJson(result));
      return exitCodeForResult(result);
    }
    if (route.kind === "agent-help") {
      writeText(stdout, `${OMP_AGENT_USAGE}\n`);
      return OMP_EXIT_CODES.SUCCESS;
    }
    if (route.kind === "admin") {
      if (route.argv[0] === "account") {
        const { runAccountCli } = await import("../packages/accounts/commands.mjs");
        const { resolveDirectConfigRoot, resolveControlledStack } = await import("../packages/direct-agent/launcher.mjs");
        const env = options.env ?? process.env, homeDir = options.homedir ? options.homedir() : os.homedir();
        const result = await runAccountCli({ argv: route.argv.slice(1), env, stdin: options.stdin ?? process.stdin, stderr,
          configRoot: resolveDirectConfigRoot({ env, homeDir }),
          resolveStack: () => resolveControlledStack({ packageRoot: options.rootDir ?? DEFAULT_ROOT, homeDir, stackRoot: options.stackRoot }) });
        writeText(stdout, stringifyOmpJson(result));
        return ["failed", "cancelled", "timed_out", "stored_sync_failed", "removed_sync_failed"].includes(result.status) ? OMP_EXIT_CODES.FAILURE : OMP_EXIT_CODES.SUCCESS;
      }
      if (["classifier", "image"].includes(route.argv[0])) {
        const { runClassifierCli } = await import("../packages/model-calls/commands.mjs");
        const { resolveDirectConfigRoot, resolveControlledStack } = await import("../packages/direct-agent/launcher.mjs");
        const homeDir = options.homedir ? options.homedir() : os.homedir();
        const configRoot = resolveDirectConfigRoot({ env: options.env ?? process.env, homeDir });
        const stack = await resolveControlledStack({ packageRoot: options.rootDir ?? DEFAULT_ROOT, homeDir, stackRoot: options.stackRoot });
        const result = await runClassifierCli({ argv: route.argv.slice(1), configRoot, stack, kind: route.argv[0] });
        if (Buffer.isBuffer(result)) stdout.write(result);
        else writeText(stdout, stringifyOmpJson(result));
        return OMP_EXIT_CODES.SUCCESS;
      }
      if (route.argv[0] === "settings") {
        const { runSettingsCli } = await import("../packages/product-settings/commands.mjs");
        const { resolveDirectConfigRoot } = await import("../packages/direct-agent/launcher.mjs");
        const homeDir = options.homedir ? options.homedir() : os.homedir();
        const result = await runSettingsCli({ argv: route.argv.slice(1), configRoot: resolveDirectConfigRoot({ env: options.env ?? process.env, homeDir }) });
        writeText(stdout, stringifyOmpJson(result)); return OMP_EXIT_CODES.SUCCESS;
      }
      if (route.argv[0] === "mcp") {
        const { runMcpCli } = await import("../packages/mcp/commands.mjs");
        const { resolveDirectConfigRoot, resolveControlledStack } = await import("../packages/direct-agent/launcher.mjs");
        const homeDir = options.homedir ? options.homedir() : os.homedir();
        const result = await runMcpCli({ argv: route.argv.slice(1), stdin: options.stdin ?? process.stdin, stderr,
          resolveStack: () => resolveControlledStack({ packageRoot: options.rootDir ?? DEFAULT_ROOT, homeDir, stackRoot: options.stackRoot }),
          configRoot: resolveDirectConfigRoot({ env: options.env ?? process.env, homeDir }) });
        writeText(stdout, stringifyOmpJson(result));
        return ["failed", "cancelled", "timed_out", "interrupted", "stored_sync_failed", "publication_unconfirmed"].includes(result.status) ? OMP_EXIT_CODES.FAILURE : OMP_EXIT_CODES.SUCCESS;
      }
      const runtime = await loadDistribution({ packageRoot: options.rootDir ?? DEFAULT_ROOT });
      if (runtime) {
        const { handleDistributionCommand } = await import("../packages/distribution/commands.mjs");
        const native = await handleDistributionCommand({ runtime, argv: route.argv,
          env: options.env ?? process.env, homeDir: options.homedir ? options.homedir() : os.homedir(),
          execve: options.execve ?? process.execve });
        if (native.handled) {
          writeText(stdout, wantsJson(route.argv) ? stringifyOmpJson(native.result) : formatOmpHuman(native.result));
          return exitCodeForResult(native.result);
        }
      }
      return await runOmpCli({ ...options, argv: route.argv });
    }
    const agentLauncher = options.agentLauncher ?? launchDirectAgent;
    assertFunction(agentLauncher, "agentLauncher");
    await agentLauncher({
      argv: route.argv,
      packageRoot: options.rootDir ?? DEFAULT_ROOT,
      homeDir: options.homedir ? options.homedir() : os.homedir(),
      stackRoot: options.stackRoot,
      env: options.env ?? process.env,
      execve: options.execve ?? process.execve,
      randomUUIDImpl: options.randomUUIDImpl,
    });
    return OMP_EXIT_CODES.SUCCESS;
  } catch (error) {
    const output = publicError(error);
    writeText(stderr, route?.kind === "admin" && wantsJson(route.argv) ? stringifyOmpJson(output) : formatOmpHuman(output));
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
  process.exitCode = await runOmpEntrypoint();
}
