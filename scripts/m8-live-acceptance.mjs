#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveBoundPackageRoot } from "../packages/subagents/runtime/session-composer.mjs";
import { inspectPublicWebPolicy } from "../packages/web-policy/index.mjs";
import {
  M8_LIVE_ERROR_TYPE,
  M8_LIVE_RECORD_TYPE,
  M8_LIVE_REQUEST_ENV,
} from "../packages/subagents/release/m8-live-acceptance-extension.mjs";
import {
  protectedEvidenceDigest,
  validateDailyHarnessProtectedEvidence,
} from "./lib/daily-harness-gates.mjs";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_SHA = /^[a-f0-9]{40}$/u;
const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/u;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_PROVIDER = "cc-switch-open-code-go";
const DEFAULT_MODEL = "deepseek-v4-flash";
const EXPECTED_ASSERTIONS = Object.freeze([
  "agent-terminal",
  "artifact-identity",
  "batch-swarm-terminal",
  "budget-boundary",
  "cancellation",
  "public-web",
  "resume-across-session",
  "resume-prepared",
  "swarm-goal-replan",
  "ultra-agent-route",
  "ultra-workflow-route",
  "usage-metering",
  "workflow-artifact-flow",
  "writer-denial",
].sort());
const EXTERNAL_IDS = Object.freeze(["agent-extensions", "lsp", "permission-modes", "plan-mode", "subagents", "usage", "web-access"].sort());

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) fail("M8_LIVE_ARGUMENT_INVALID", `${label} must be an explicit absolute path`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("M8_LIVE_ARGUMENT_INVALID", `${label} cannot be a filesystem root`);
  return resolved;
}

export function parseM8LiveAcceptanceArgs(argv) {
  const output = { operation: "plan", yes: false, json: false, configRoot: path.join(os.homedir(), ".pi", "agent"), provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, artifactSha256: null, output: null, piCommand: "pi" };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--run", "--plan", "--yes", "--json"].includes(argument)) {
      if (seen.has(argument)) fail("M8_LIVE_ARGUMENT_INVALID", `duplicate ${argument}`);
      seen.add(argument);
      if (argument === "--run") output.operation = "run";
      else if (argument === "--plan") output.operation = "plan";
      else if (argument === "--yes") output.yes = true;
      else output.json = true;
      continue;
    }
    if (["--config-root", "--provider", "--model", "--artifact-sha256", "--output", "--pi-command"].includes(argument)) {
      if (seen.has(argument)) fail("M8_LIVE_ARGUMENT_INVALID", `duplicate ${argument}`);
      seen.add(argument);
      const value = argv[++index];
      if (!value || value.startsWith("-") || value.includes("\0") || /[\r\n]/u.test(value)) fail("M8_LIVE_ARGUMENT_INVALID", `${argument} requires a bounded value`);
      if (argument === "--config-root") output.configRoot = absolute(value, "configRoot");
      else if (argument === "--provider") output.provider = value;
      else if (argument === "--model") output.model = value;
      else if (argument === "--artifact-sha256") output.artifactSha256 = value.replace(/^sha256:/u, "");
      else if (argument === "--output") output.output = absolute(value, "output");
      else output.piCommand = value;
      continue;
    }
    fail("M8_LIVE_ARGUMENT_INVALID", `unknown argument ${argument}`);
  }
  if (seen.has("--run") && seen.has("--plan")) fail("M8_LIVE_ARGUMENT_INVALID", "--run and --plan are mutually exclusive");
  if (output.yes && output.operation !== "run") fail("M8_LIVE_ARGUMENT_INVALID", "--yes requires --run");
  if (output.operation === "run" && (!output.yes || !HEX_SHA256.test(output.artifactSha256 ?? "") || output.output === null)) fail("M8_LIVE_ARGUMENT_INVALID", "--run requires --yes, --artifact-sha256, and --output");
  if (![output.provider, output.model, output.piCommand].every((value) => SAFE_MODEL.test(value))) fail("M8_LIVE_ARGUMENT_INVALID", "provider, model, or Pi command is invalid");
  return Object.freeze(output);
}

function git(args) {
  return execFile("git", args, { cwd: rootDir, encoding: "utf8", maxBuffer: 1024 * 1024 }).then((result) => result.stdout.trim());
}

async function sourceIdentity({ requireClean = true } = {}) {
  const sourceCommit = await git(["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(sourceCommit)) fail("M8_LIVE_SOURCE_INVALID", "source commit is invalid");
  const clean = await git(["status", "--porcelain=v1", "--untracked-files=all"]) === "";
  if (requireClean && !clean) fail("M8_LIVE_SOURCE_DIRTY", "M8 live acceptance requires a clean source commit");
  return Object.freeze({ sourceCommit, clean });
}

function boundedAppend(state, chunk) {
  const bytes = Buffer.from(chunk);
  if (state.bytes >= MAX_OUTPUT_BYTES) { state.truncated = true; return; }
  const remaining = MAX_OUTPUT_BYTES - state.bytes;
  state.parts.push(bytes.subarray(0, remaining));
  state.bytes += Math.min(bytes.length, remaining);
  if (bytes.length > remaining) state.truncated = true;
}

function records(text) {
  const output = [];
  for (const line of text.split(/\r?\n/gu)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if ([M8_LIVE_RECORD_TYPE, M8_LIVE_ERROR_TYPE].includes(value?.type)) output.push(value);
    } catch { /* Pi RPC output may contain non-record lines */ }
  }
  return output;
}

function terminate(child) {
  if (process.platform !== "win32" && Number.isSafeInteger(child?.pid) && child.pid > 1) {
    try { process.kill(-child.pid, "SIGTERM"); return; } catch { /* use direct child */ }
  }
  child?.kill?.("SIGTERM");
}

function safeEnvironment({ temporaryRoot, configRoot, requestFile }) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: path.join(temporaryRoot, "home"),
    TMPDIR: path.join(temporaryRoot, "tmp"),
    XDG_CACHE_HOME: path.join(temporaryRoot, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(temporaryRoot, "xdg-config"),
    XDG_DATA_HOME: path.join(temporaryRoot, "xdg-data"),
    PI_CODING_AGENT_DIR: configRoot,
    PI_SUBAGENT_EXTRA_AGENT_DIRS: path.join(rootDir, "bundles", "only-my-pi-agent-bundle", "agents"),
    PI_SUBAGENT_MAX_DEPTH: "1",
    PI_SUBAGENT_MAX_SPAWNS_PER_SESSION: "64",
    PI_SUBAGENT_WAIT_TOOL_ENABLED: "false",
    PI_TELEMETRY: "0",
    NO_COLOR: "1",
    TERM: "dumb",
    [M8_LIVE_REQUEST_ENV]: requestFile,
  };
}

async function writeRequest(temporaryRoot, request) {
  const requestFile = path.join(temporaryRoot, `request-${request.phase}.json`);
  await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return requestFile;
}

export async function runPiM8Phase({ piCommand, phase, request, configRoot, subagentsEntry, spawnImpl = spawn, timeoutMs }) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), `only-my-pi-m8-live-${phase}-`));
  await Promise.all(["home", "tmp", "xdg-cache", "xdg-config", "xdg-data"].map((name) => fs.mkdir(path.join(temporaryRoot, name), { mode: 0o700 })));
  const requestFile = await writeRequest(temporaryRoot, { ...request, phase });
  const extension = fileURLToPath(new URL("../packages/subagents/release/m8-live-acceptance-extension.mjs", import.meta.url));
  const env = safeEnvironment({ temporaryRoot, configRoot, requestFile });
  const argv = [
      "--mode", "rpc",
      "--provider", request.model.provider,
      "--model", request.model.id,
      "--thinking", "low",
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-builtin-tools",
      "--no-approve",
      "--no-extensions",
      "--extension", subagentsEntry,
      "--extension", extension,
  ];
  return await new Promise((resolve, reject) => {
    const stdout = { parts: [], bytes: 0, truncated: false };
    const stderr = { parts: [], bytes: 0, truncated: false };
    let child;
    let settled = false;
    let timer;
    const finish = async (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { await callback(); } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
    };
    const observe = () => {
      const found = [...records(Buffer.concat(stdout.parts).toString("utf8")), ...records(Buffer.concat(stderr.parts).toString("utf8"))];
      if (found.length === 1) child.stdin?.end?.();
      if (found.length > 1) { terminate(child); void finish(() => reject(Object.assign(new Error("multiple M8 live records were emitted"), { code: "M8_LIVE_RECORD_AMBIGUOUS" }))); }
    };
    try {
      child = spawnImpl(piCommand, argv, { cwd: rootDir, env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    } catch (cause) {
      void finish(() => reject(Object.assign(new Error("Pi M8 live phase could not start", { cause }), { code: "M8_LIVE_START_FAILED" })));
      return;
    }
    child.stdout?.on("data", (chunk) => { boundedAppend(stdout, chunk); observe(); });
    child.stderr?.on("data", (chunk) => { boundedAppend(stderr, chunk); observe(); });
    child.stdin?.on("error", () => {});
    child.once("error", (cause) => void finish(() => reject(Object.assign(new Error("Pi M8 live process failed", { cause }), { code: "M8_LIVE_PROCESS_FAILED" }))));
    child.once("exit", (exitCode, signal) => void finish(() => {
      if (exitCode !== 0 || signal !== null || stdout.truncated || stderr.truncated) {
        reject(Object.assign(new Error("Pi M8 live phase exited unsuccessfully"), { code: "M8_LIVE_PHASE_FAILED", exitCode, signal: signal ?? null, outputTruncated: stdout.truncated || stderr.truncated }));
        return;
      }
      const found = [...records(Buffer.concat(stdout.parts).toString("utf8")), ...records(Buffer.concat(stderr.parts).toString("utf8"))];
      if (found.length !== 1) { reject(Object.assign(new Error("Pi M8 live phase emitted no unique record"), { code: "M8_LIVE_RECORD_MISSING" })); return; }
      if (found[0].type === M8_LIVE_ERROR_TYPE) { reject(Object.assign(new Error("Pi M8 live extension rejected the phase"), { code: found[0].code })); return; }
      resolve(found[0]);
    }));
    timer = setTimeout(() => { terminate(child); void finish(() => reject(Object.assign(new Error("Pi M8 live phase timed out"), { code: "M8_LIVE_TIMEOUT" }))); }, timeoutMs);
    timer.unref?.();
  });
}

async function safeAuthCheck(args) {
  let result;
  try {
    result = await execFile(args.piCommand, ["auth", "check", "--provider", args.provider, "--model", args.model, "--json", "--no-refresh"], { cwd: rootDir, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 });
  } catch { fail("M8_LIVE_AUTH_UNAVAILABLE", "Pi reports that the selected model authentication is unavailable"); }
  let record;
  try { record = JSON.parse(result.stdout); } catch { fail("M8_LIVE_AUTH_UNAVAILABLE", "Pi auth check did not return bounded JSON"); }
  if (record?.status !== "ready" || record.provider !== args.provider || typeof record.authType !== "string") fail("M8_LIVE_AUTH_UNAVAILABLE", "Pi authentication is not ready for the selected Provider");
  return { status: record.status, provider: record.provider, authType: record.authType };
}

async function assertRealInstall(configRoot) {
  const settingsPath = path.join(configRoot, "settings.json");
  const bytes = await fs.readFile(settingsPath);
  const settings = JSON.parse(bytes.toString("utf8"));
  const metadata = settings.onlyMyPi;
  if (metadata?.profileId !== "daily" || typeof metadata.generationId !== "string") fail("M8_LIVE_INSTALL_UNAVAILABLE", "only-my-pi daily generation is not installed");
  const bindings = metadata.packageBindings ?? [];
  const actual = bindings.filter((binding) => binding.binding === "external" && binding.owner === "user").map((binding) => binding.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(EXTERNAL_IDS)) fail("M8_LIVE_EXTERNAL_BINDING_DRIFT", "real install does not retain the exact external package set");
  return { settingsSha256: crypto.createHash("sha256").update(bytes).digest("hex"), generationId: metadata.generationId, bindings: actual };
}

function combineRecords(main, resume, { sourceCommit, artifactSha256 }) {
  for (const record of [main, resume]) {
    if (record?.status !== "PASS" || record.sourceCommit !== sourceCommit) fail("M8_LIVE_RECORD_INVALID", "M8 live record source/status is invalid");
  }
  const assertions = [...main.assertions, ...resume.assertions, { id: "artifact-identity", status: "PASS", digest: digest({ sourceCommit, artifactSha256, model: main.model }) }].sort((left, right) => left.id.localeCompare(right.id));
  const ids = assertions.map((entry) => entry.id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_ASSERTIONS) || new Set(ids).size !== ids.length) fail("M8_LIVE_ASSERTION_SET_INVALID", "M8 live assertion set is incomplete or duplicated");
  return assertions;
}

function safeOutputPath(output) {
  const protectedRoot = path.join(rootDir, "verification", "protected");
  const relative = path.relative(protectedRoot, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !output.endsWith(".json")) fail("M8_LIVE_OUTPUT_INVALID", "M8 evidence output must be a JSON file inside verification/protected");
  return output;
}

export async function executeM8LiveAcceptance(args, { phaseRunner = runPiM8Phase, now = () => new Date() } = {}) {
  const source = await sourceIdentity({ requireClean: args.operation === "run" });
  const sourceCommit = source.sourceCommit;
  const plan = Object.freeze({
    status: "M8_LIVE_PLAN_READY",
    sourceCommit,
    sourceClean: source.clean,
    model: { provider: args.provider, id: args.model },
    artifactSha256: args.artifactSha256 ? `sha256:${args.artifactSha256}` : null,
    configRoot: "REAL_PI_HOME_EXPLICIT",
    phases: ["main", "resume-new-pi-session"],
    assertions: EXPECTED_ASSERTIONS,
    providerRequests: args.operation === "run" ? "AUTHORIZED_ON_CONFIRMATION" : "NOT_RUN_BY_POLICY",
    writes: args.operation === "run" ? "PRIVATE_RUN_STATE_AND_EXPLICIT_EVIDENCE_ONLY" : "ZERO",
  });
  if (args.operation === "plan") return { status: source.clean ? "PLAN" : "PLAN_BLOCKED_SOURCE_DIRTY", plan, exitCode: 0 };
  const configRoot = await fs.realpath(args.configRoot);
  const before = await assertRealInstall(configRoot);
  const auth = await safeAuthCheck(args);
  const web = await inspectPublicWebPolicy({ configRoot });
  if (web.status !== "PUBLIC_WEB_SSRF_GUARDED") fail("M8_LIVE_WEB_POLICY_UNSAFE", "public Web policy is not SSRF guarded");
  const subagents = await resolveBoundPackageRoot({ configRoot, packageId: "subagents" });
  const extensionEntry = subagents.manifest?.pi?.extensions?.[0];
  if (typeof extensionEntry !== "string") fail("M8_LIVE_SUBAGENTS_ENTRY_INVALID", "pi-subagents extension entry is unavailable");
  const subagentsEntry = await fs.realpath(path.resolve(subagents.root, extensionEntry));
  if (!subagentsEntry.startsWith(`${subagents.root}${path.sep}`) || !(await fs.lstat(subagentsEntry)).isFile()) fail("M8_LIVE_SUBAGENTS_ENTRY_INVALID", "pi-subagents extension entry escaped its package");
  const runNonce = sourceCommit.slice(0, 12);
  const request = { formatVersion: 1, phase: "main", sourceCommit, repositoryRoot: rootDir, configRoot, model: { provider: args.provider, id: args.model }, runNonce, webAuthorized: true };
  const main = await phaseRunner({ piCommand: args.piCommand, phase: "main", request, configRoot, subagentsEntry, timeoutMs: 30 * 60 * 1000 });
  const resume = await phaseRunner({ piCommand: args.piCommand, phase: "resume", request, configRoot, subagentsEntry, timeoutMs: 10 * 60 * 1000 });
  const assertions = combineRecords(main, resume, { sourceCommit, artifactSha256: args.artifactSha256 });
  const after = await assertRealInstall(configRoot);
  if (after.settingsSha256 !== before.settingsSha256 || after.generationId !== before.generationId) fail("M8_LIVE_SETTINGS_DRIFT", "live acceptance changed installed settings or generation identity");
  if ((await sourceIdentity()).sourceCommit !== sourceCommit) fail("M8_LIVE_SOURCE_DRIFT", "source changed during M8 live acceptance");
  const evidence = {
    formatVersion: 1,
    kind: "only-my-pi-daily-harness-protected-evidence",
    gateId: "D13",
    evidenceId: "m8-live-model-matrix",
    sourceCommit,
    status: "PASS",
    createdAt: now().toISOString(),
    assertions,
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false },
    authorization: { providerRequests: "AUTHORIZED", realPiHome: "AUTHORIZED", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
  };
  evidence.evidenceDigest = protectedEvidenceDigest(evidence);
  validateDailyHarnessProtectedEvidence(evidence, { gateId: "D13", expectedSourceCommit: sourceCommit });
  const output = safeOutputPath(args.output);
  await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { status: "RUN_COMPLETE", sourceCommit, evidenceDigest: evidence.evidenceDigest, assertionCount: assertions.length, usage: main.usage, auth: { status: auth.status, provider: auth.provider, authType: auth.authType }, output: path.relative(rootDir, output), exitCode: 0 };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseM8LiveAcceptanceArgs(argv);
  const result = await executeM8LiveAcceptance(args);
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return result.exitCode;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`m8-live-acceptance: ERROR ${error.code ?? "M8_LIVE_FAILED"} ${error.message}\n`); process.exitCode = 1; }
}

export { EXPECTED_ASSERTIONS as M8_LIVE_EXPECTED_ASSERTIONS };
