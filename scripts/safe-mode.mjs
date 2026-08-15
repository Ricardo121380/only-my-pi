#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const SAFE_FLAGS = [
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--no-context-files",
  "--no-session",
  "--no-approve",
  "--tools",
  "read,grep,find,ls",
];

const VALUE_OPTIONS = new Set(["--provider", "--model", "--thinking"]);
const BOOLEAN_OPTIONS = new Set(["--offline", "--print", "-p"]);

export function validateForwardedArgs(args) {
  const forwarded = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      const prompt = args.slice(i + 1).join(" ");
      if (prompt) forwarded.push(`Task:\n${prompt}`);
      break;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("-") || value.startsWith("@")) throw new Error(`${arg} requires a value`);
      forwarded.push(arg, value);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(arg)) {
      forwarded.push(arg);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Option is not allowed in safe mode: ${arg}`);
    }
    if (arg.startsWith("@")) {
      throw new Error("Pi @file expansion is not allowed in safe mode; ask the read tool to inspect a reviewed path instead");
    }
    forwarded.push(arg);
  }
  return forwarded;
}

export function buildSafeArgs(forwarded) {
  return [...SAFE_FLAGS, ...validateForwardedArgs(forwarded)];
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function usage() {
  console.log(
    `Usage: node scripts/safe-mode.mjs [--run] [--shell] [safe Pi options] [--] [prompt]\n\n` +
      `Default: print the exact argv as JSON without starting Pi.\n` +
      `  --run    execute Pi with the fixed read-only resource profile\n` +
      `  --shell  print a copyable shell rendering as well as JSON\n\n` +
      `Allowed Pi options: --provider, --model, --thinking, --offline, --print/-p.\n` +
      `This is a tool/resource profile, not an operating-system sandbox.`,
  );
}

export async function main(argv = process.argv.slice(2)) {
  let run = false;
  let showShell = false;
  const forwarded = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      return 0;
    }
    if (arg === "--run") run = true;
    else if (arg === "--shell") showShell = true;
    else forwarded.push(arg);
  }

  const args = buildSafeArgs(forwarded);
  const command = { command: "pi", args, environment: { PI_TELEMETRY: "0" } };
  console.log(JSON.stringify(command, null, 2));
  if (showShell) console.log(["PI_TELEMETRY=0", "pi", ...args].map(shellQuote).join(" "));
  if (!run) return 0;

  return await new Promise((resolve, reject) => {
    const child = spawn("pi", args, {
      stdio: "inherit",
      env: { ...process.env, PI_TELEMETRY: "0" },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`pi terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`safe-mode: ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
