#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const defaultSuite = path.join(root, "verification", "suites", "repository.json");
const receiptsRoot = path.join(root, "verification", "receipts");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readSuite(file) {
  const text = fs.readFileSync(file, "utf8");
  return { text, suite: JSON.parse(text) };
}

function validateSuite(suite) {
  if (suite.formatVersion !== 1) throw new Error("unsupported verification suite format");
  if (!Array.isArray(suite.checks) || suite.checks.length === 0) throw new Error("suite has no checks");
  const allowed = new Set(suite.allowedCommands ?? []);
  const ids = new Set();
  for (const check of suite.checks) {
    if (!check.id || ids.has(check.id)) throw new Error(`invalid or duplicate check id: ${check.id}`);
    ids.add(check.id);
    if (!allowed.has(check.command)) throw new Error(`command is not allowlisted: ${check.command}`);
    if (!Array.isArray(check.args) || !check.args.every((arg) => typeof arg === "string")) {
      throw new Error(`check ${check.id} args must be strings`);
    }
    if (check.sensitiveOutput !== false) {
      throw new Error(`check ${check.id} must explicitly declare sensitiveOutput: false`);
    }
    if (!Number.isInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 300000) {
      throw new Error(`check ${check.id} has an invalid timeout`);
    }
  }
}

function collect(chunks) {
  return Buffer.concat(chunks);
}

export function runCheck(check, { cwd = root, maxOutputBytes = 2097152, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    const child = spawn(check.command, check.args, {
      cwd,
      env: { ...env, PI_TELEMETRY: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const stopForOutput = () => {
      if (outputLimitExceeded) return;
      outputLimitExceeded = true;
      child.kill("SIGTERM");
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes + stderrBytes <= maxOutputBytes) stdout.push(chunk);
      else stopForOutput();
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes <= maxOutputBytes) stderr.push(chunk);
      else stopForOutput();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2000).unref();
    }, check.timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const out = collect(stdout);
      const err = collect(stderr);
      const expectationPassed = check.expectStdout === "empty" ? out.toString("utf8").trim().length === 0 : true;
      const passed = code === 0 && !timedOut && !outputLimitExceeded && expectationPassed;
      resolve({
        id: check.id,
        command: check.command,
        args: check.args,
        passed,
        exitCode: code,
        signal,
        timedOut,
        outputLimitExceeded,
        expectationPassed,
        durationMs: Date.now() - started,
        stdoutBytes,
        stderrBytes,
        stdoutSha256: sha256(out),
        stderrSha256: sha256(err),
      });
    });
  });
}

async function gitHead() {
  const result = await runCheck(
    { id: "source-commit", command: "git", args: ["rev-parse", "HEAD"], timeoutMs: 10000 },
    { maxOutputBytes: 4096 },
  );
  if (!result.passed) throw new Error("cannot resolve source commit");
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error("git rev-parse failed")));
  });
}

function outputPath(requested, suiteId) {
  if (requested) {
    const target = path.resolve(root, requested);
    const relative = path.relative(receiptsRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("receipt output must stay inside verification/receipts");
    }
    return target;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(receiptsRoot, `${stamp}-${suiteId}.json`);
}

function parseArgs(argv) {
  const result = { run: false, suite: defaultSuite, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run") result.run = true;
    else if (arg === "--suite") result.suite = path.resolve(root, argv[++i]);
    else if (arg === "--output") result.output = argv[++i];
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  console.log(
    "Usage: node scripts/verification-receipt.mjs [--run] [--suite <file>] [--output verification/receipts/<file>]\n" +
      "Default is a dry-run that validates and prints the suite without executing commands.",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  const suiteFile = path.resolve(args.suite);
  const suiteRelative = path.relative(path.join(root, "verification", "suites"), suiteFile);
  if (suiteRelative.startsWith("..") || path.isAbsolute(suiteRelative)) {
    throw new Error("verification suite must stay inside verification/suites");
  }
  const { text, suite } = readSuite(suiteFile);
  validateSuite(suite);
  if (!args.run) {
    console.log(JSON.stringify({ dryRun: true, suite: suite.id, checks: suite.checks }, null, 2));
    return 0;
  }

  const startedAt = new Date().toISOString();
  const sourceCommit = await gitHead();
  const checks = [];
  for (const check of suite.checks) {
    const result = await runCheck(check, { maxOutputBytes: suite.maxOutputBytes });
    checks.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id} (${result.durationMs} ms)`);
  }
  const receipt = {
    schemaVersion: 1,
    suite: suite.id,
    suiteSha256: sha256(text),
    sourceCommit,
    startedAt,
    completedAt: new Date().toISOString(),
    passed: checks.every((check) => check.passed),
    checks,
    privacy: {
      rawOutputStored: false,
      outputFingerprintsMayLeakShortPredictableValues: true,
      intendedForSensitiveOutput: false
    }
  };
  const target = outputPath(args.output, suite.id);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  console.log(`receipt: ${path.relative(root, target)}`);
  return receipt.passed ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`verification-receipt: ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
