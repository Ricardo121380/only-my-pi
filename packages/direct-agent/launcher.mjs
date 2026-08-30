import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { OMP_CONTROL_COMMANDS } from "../control-service/cli-parser.mjs";

const STACK_DIRECTORY = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9-]{36}$/u;
const INTERACTIVE_TOOLS = "read,grep,find,ls";
const HEADLESS_TOOLS = "read,grep,find,ls";

const SAFE_BOOLEAN_FLAGS = new Set([
  "--print", "-p",
  "--continue", "-c",
  "--resume", "-r",
  "--no-session",
  "--verbose",
  "--offline",
  "--version", "-v",
]);

const SAFE_VALUE_FLAGS = new Set([
  "--provider",
  "--model",
  "--thinking",
  "--session",
  "--session-id",
  "--fork",
  "--session-dir",
  "--name", "-n",
  "--models",
  "--mode",
  "--tui-mode",
  "--use-theme",
  "--export",
]);

const CONTROL_COMMANDS = new Set(OMP_CONTROL_COMMANDS);

export const OMP_AGENT_USAGE = `only-my-pi - guarded terminal coding Agent

Usage:
  omp [options] [--] [@files...] [messages...]
  omp admin <command> [options]

Daily Agent:
  omp                         Start the interactive coding Agent
  omp "fix the failing test"  Start with an initial task
  omp -c                      Continue the latest session
  omp -r                      Choose a session to resume
  omp -p "review this repo"   Run a read-only non-interactive task
  omp --model <provider/id>   Select a model without the startup picker

Management:
  omp admin status
  omp admin doctor
  omp admin version

Existing management commands such as "omp status" remain aliases for one
Preview cycle. Use "omp -- status" when the initial task is a management word.
Inside the TUI use /exit or Ctrl+D to return to the shell.`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function cleanEnvironment(env) {
  const output = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") output[key] = value;
  }
  return output;
}

function flagValue(argv, flag) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--") return undefined;
    if (argv[index] === flag) return argv[index + 1];
  }
  return undefined;
}

function hasFlag(argv, ...names) {
  for (const token of argv) {
    if (token === "--") return false;
    if (names.includes(token)) return true;
  }
  return false;
}

export function classifyOmpInvocation(argv = []) {
  if (!Array.isArray(argv)) fail("OMP_ARGUMENTS_INVALID", "OMP arguments must be an array");
  if (argv[0] === "admin") {
    const controlArgs = argv.slice(1);
    return Object.freeze({ kind: "admin", argv: controlArgs.length === 0 ? ["help"] : controlArgs, compatibilityAlias: false });
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    return Object.freeze({ kind: "agent-help", argv: [], compatibilityAlias: false });
  }
  if (argv[0] === "--") {
    return Object.freeze({ kind: "agent", argv: argv.slice(1), compatibilityAlias: false });
  }
  if (typeof argv[0] === "string" && CONTROL_COMMANDS.has(argv[0])) {
    return Object.freeze({ kind: "admin", argv: [...argv], compatibilityAlias: true });
  }
  return Object.freeze({ kind: "agent", argv: [...argv], compatibilityAlias: false });
}

export function inspectDirectAgentArguments(argv) {
  if (!Array.isArray(argv) || argv.length > 128) fail("OMP_ARGUMENTS_INVALID", "too many Agent arguments");
  let separator = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== "string" || token.includes("\0") || token.includes("\n") || token.includes("\r")) {
      fail("OMP_ARGUMENTS_INVALID", "Agent arguments contain invalid control characters");
    }
    if (separator) continue;
    if (token === "--") {
      separator = true;
      continue;
    }
    if (!token.startsWith("-")) continue;
    if (token.includes("=")) fail("OMP_AGENT_OPTION_UNSUPPORTED", `inline option assignment is not supported by OMP: ${token}`);
    if (SAFE_BOOLEAN_FLAGS.has(token)) continue;
    if (SAFE_VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.startsWith("-") || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
        fail("OMP_AGENT_OPTION_INVALID", `${token} requires a bounded value`);
      }
      index += 1;
      continue;
    }
    fail("OMP_AGENT_OPTION_UNSUPPORTED", `${token} can change the controlled Agent boundary; use raw pi for advanced runtime overrides`);
  }

  const outputMode = flagValue(argv, "--mode");
  const headless = hasFlag(argv, "--print", "-p") || outputMode === "json" || outputMode === "rpc";
  const explicitModel = hasFlag(argv, "--model");
  return Object.freeze({ headless, explicitModel });
}

async function resolveContainedRegularFile(root, relativePath, label, { executable = false } = {}) {
  const candidate = path.join(root, relativePath);
  let resolved;
  try {
    resolved = await fs.realpath(candidate);
  } catch {
    fail("OMP_CONTROLLED_STACK_UNAVAILABLE", `${label} is missing from the controlled stack`);
  }
  if (!within(root, resolved)) fail("OMP_CONTROLLED_STACK_INVALID", `${label} escapes the controlled stack`);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) fail("OMP_CONTROLLED_STACK_INVALID", `${label} is not a regular file`);
  if (executable && (stat.mode & 0o111) === 0) fail("OMP_CONTROLLED_STACK_INVALID", `${label} is not executable`);
  return resolved;
}

async function inspectStackRoot(candidate) {
  let root;
  try {
    root = await fs.realpath(candidate);
  } catch {
    return null;
  }
  const stat = await fs.stat(root);
  if (!stat.isDirectory() || !STACK_DIRECTORY.test(path.basename(root))) return null;
  const nodePath = await resolveContainedRegularFile(root, path.join("node", "bin", "node"), "embedded Node", { executable: true });
  const piCliPath = await resolveContainedRegularFile(root, path.join("pi", "dist", "bundle", "cli.js"), "controlled Pi CLI");
  const ompCliPath = await resolveContainedRegularFile(root, path.join("only-my-pi", "package", "bin", "omp.mjs"), "only-my-pi CLI");
  return Object.freeze({
    root,
    stackId: `sha256:${path.basename(root)}`,
    nodePath,
    piCliPath,
    ompCliPath,
  });
}

export async function resolveControlledStack({ packageRoot, homeDir = os.homedir(), stackRoot } = {}) {
  const candidates = [];
  if (stackRoot !== undefined) {
    if (typeof stackRoot !== "string" || !path.isAbsolute(stackRoot)) fail("OMP_CONTROLLED_STACK_INVALID", "stack root must be absolute");
    candidates.push(stackRoot);
  }
  if (typeof packageRoot === "string" && path.isAbsolute(packageRoot)) candidates.push(path.resolve(packageRoot, "../.."));
  if (typeof homeDir === "string" && path.isAbsolute(homeDir)) candidates.push(path.join(homeDir, ".local", "share", "only-my-pi", "current-stack"));

  for (const candidate of candidates) {
    const stack = await inspectStackRoot(candidate);
    if (stack) return stack;
  }
  fail("OMP_CONTROLLED_STACK_UNAVAILABLE", "No verified active only-my-pi stack is available; run the installed OMP CLI or use `omp admin doctor`");
}

export function buildDirectPiInvocation({ argv, stack, env = process.env, randomUUIDImpl = randomUUID } = {}) {
  const inspected = inspectDirectAgentArguments(argv ?? []);
  if (!stack || typeof stack.nodePath !== "string" || typeof stack.piCliPath !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(stack.stackId ?? "")) {
    fail("OMP_CONTROLLED_STACK_INVALID", "direct Agent launch requires a verified controlled stack");
  }
  const launchId = randomUUIDImpl();
  if (typeof launchId !== "string" || !UUID.test(launchId)) fail("OMP_LAUNCH_ID_INVALID", "launch id generator returned an invalid UUID");

  const piArgs = [
    stack.piCliPath,
    "--tools",
    inspected.headless ? HEADLESS_TOOLS : INTERACTIVE_TOOLS,
    "--perm",
    inspected.headless ? "plan" : "build",
    ...(argv ?? []),
  ];
  const childEnv = {
    ...cleanEnvironment(env),
    ONLY_MY_PI_DIRECT: "1",
    ONLY_MY_PI_HEADLESS: inspected.headless ? "1" : "0",
    ONLY_MY_PI_MODEL_EXPLICIT: inspected.explicitModel ? "1" : "0",
    ONLY_MY_PI_LAUNCH_ID: launchId,
    ONLY_MY_PI_STACK_ID: stack.stackId,
  };
  return Object.freeze({ executable: stack.nodePath, argv: Object.freeze([stack.nodePath, ...piArgs]), env: Object.freeze(childEnv), headless: inspected.headless });
}

export async function launchDirectAgent({ argv = [], packageRoot, homeDir, stackRoot, env = process.env, execve = process.execve, randomUUIDImpl } = {}) {
  if (typeof execve !== "function") fail("OMP_EXECVE_UNAVAILABLE", "this Node runtime does not support process.execve()");
  const stack = await resolveControlledStack({ packageRoot, homeDir, stackRoot });
  const invocation = buildDirectPiInvocation({ argv, stack, env, randomUUIDImpl });
  execve(invocation.executable, [...invocation.argv], { ...invocation.env });
  fail("OMP_EXECVE_RETURNED", "controlled Pi process replacement returned unexpectedly");
}
