import crypto from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const COMMAND = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SECRET_ENV = /(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)/u;
const MAX_OUTPUT_BYTES = 2_097_152;
const DEFAULT_ENV = Object.freeze({ CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" });

function fail(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); throw error; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("PROJECT_GATE_MANIFEST_INVALID", `${label} must be an object`); return value; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest("hex")}`; }
function exactKeys(value, keys, label) { object(value, label); const unknown = Object.keys(value).filter((key) => !keys.includes(key)); if (unknown.length) fail("PROJECT_GATE_MANIFEST_INVALID", `${label} contains unknown fields`, { unknown }); }
function inside(root, target) { const relative = path.relative(path.resolve(root), path.resolve(target)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }

async function assertContainedPath(root, target, { file = false } = {}) {
  if (!inside(root, target)) fail("PROJECT_GATE_PATH_ESCAPE", "project gate path escapes repository root");
  let current = path.resolve(root);
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) fail("PROJECT_GATE_PATH_UNSAFE", "project gate path traverses a symlink");
  }
  const stat = await fs.lstat(target);
  if (file ? !stat.isFile() : !stat.isDirectory()) fail("PROJECT_GATE_PATH_UNSAFE", `project gate ${file ? "file" : "directory"} has the wrong type`);
  return path.resolve(target);
}

async function readManifest(repositoryRoot) {
  const target = path.join(repositoryRoot, ".pi", "only-my-pi-gates.json");
  await assertContainedPath(repositoryRoot, target, { file: true });
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (stat.size > 256 * 1024) fail("PROJECT_GATE_MANIFEST_INVALID", "project gate manifest exceeds 256 KiB");
    return { target, document: JSON.parse((await handle.readFile()).toString("utf8")) };
  } catch (cause) {
    if (cause instanceof SyntaxError) fail("PROJECT_GATE_MANIFEST_INVALID", "project gate manifest is not valid JSON");
    throw cause;
  } finally { await handle?.close().catch(() => {}); }
}

function normalizedRelativeCwd(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value)) fail("PROJECT_GATE_MANIFEST_INVALID", "gate cwd must be a portable repository-relative path");
  if (value === ".") return value;
  const normalized = path.posix.normalize(value);
  if (normalized !== value || value.split("/").some((segment) => !segment || segment === "." || segment === "..")) fail("PROJECT_GATE_MANIFEST_INVALID", "gate cwd is not normalized");
  return value;
}

function normalizeGate(raw, index) {
  exactKeys(raw, ["id", "description", "command", "args", "cwd", "timeoutSeconds", "env"], `gates[${index}]`);
  if (!ID.test(raw.id ?? "")) fail("PROJECT_GATE_MANIFEST_INVALID", `gates[${index}].id is invalid`);
  if (typeof raw.description !== "string" || raw.description.length < 1 || raw.description.length > 500) fail("PROJECT_GATE_MANIFEST_INVALID", `gate ${raw.id} description is invalid`);
  if (typeof raw.command !== "string" || !COMMAND.test(raw.command) || raw.command.includes("/") || raw.command.includes("\\")) fail("PROJECT_GATE_MANIFEST_INVALID", `gate ${raw.id} command must be an executable basename`);
  if (!Array.isArray(raw.args) || raw.args.length > 64 || raw.args.some((entry) => typeof entry !== "string" || entry.length > 1024 || /[\0\r\n]/u.test(entry))) fail("PROJECT_GATE_MANIFEST_INVALID", `gate ${raw.id} args are invalid`);
  const cwd = normalizedRelativeCwd(raw.cwd);
  if (!Number.isSafeInteger(raw.timeoutSeconds) || raw.timeoutSeconds < 1 || raw.timeoutSeconds > 1800) fail("PROJECT_GATE_MANIFEST_INVALID", `gate ${raw.id} timeout is invalid`);
  object(raw.env, `gate ${raw.id} env`);
  if (Object.keys(raw.env).length > 16) fail("PROJECT_GATE_MANIFEST_INVALID", `gate ${raw.id} env is too large`);
  const env = {};
  for (const [name, value] of Object.entries(raw.env)) {
    if (!ENV_NAME.test(name) || SECRET_ENV.test(name)) fail("PROJECT_GATE_SECRET_ENV_FORBIDDEN", `gate ${raw.id} env contains forbidden key ${name}`);
    if (typeof value !== "string" || value.length > 512 || /[\0\r\n]/u.test(value)) fail("PROJECT_GATE_MANIFEST_INVALID", `gate ${raw.id} env value is invalid`);
    env[name] = value;
  }
  return Object.freeze({ id: raw.id, description: raw.description, command: raw.command, args: Object.freeze([...raw.args]), cwd, timeoutSeconds: raw.timeoutSeconds, env: Object.freeze(env) });
}

export function validateProjectGateManifest(input) {
  exactKeys(input, ["$schema", "formatVersion", "id", "gates"], "project gate manifest");
  if (!String(input.$schema ?? "").endsWith("project-gates-v1.schema.json") || input.formatVersion !== 1 || !ID.test(input.id ?? "")) fail("PROJECT_GATE_MANIFEST_INVALID", "project gate manifest schema, version, or id is invalid");
  if (!Array.isArray(input.gates) || input.gates.length < 1 || input.gates.length > 16) fail("PROJECT_GATE_MANIFEST_INVALID", "project gate manifest requires 1..16 gates");
  const gates = input.gates.map(normalizeGate);
  if (new Set(gates.map((gate) => gate.id)).size !== gates.length) fail("PROJECT_GATE_MANIFEST_INVALID", "project gate IDs must be unique");
  const manifest = Object.freeze({ $schema: input.$schema, formatVersion: 1, id: input.id, gates: Object.freeze(gates) });
  return Object.freeze({ manifest, manifestDigest: digest(manifest) });
}

async function resolveExecutable(command, environmentPath = process.env.PATH ?? "") {
  const entries = environmentPath.split(path.delimiter).filter((entry) => path.isAbsolute(entry)).slice(0, 64);
  for (const directory of entries) {
    const candidate = path.join(directory, command);
    try {
      await fs.access(candidate, fsConstants.X_OK);
      const real = await fs.realpath(candidate);
      const stat = await fs.stat(real);
      if (stat.isFile()) return real;
    } catch (cause) { if (!["ENOENT", "EACCES", "ENOTDIR"].includes(cause?.code)) throw cause; }
  }
  fail("PROJECT_GATE_EXECUTABLE_NOT_FOUND", `project gate executable ${command} is unavailable`);
}

function execResultCode(result) { return Number.isInteger(result?.code) ? result.code : Number.isInteger(result?.exitCode) ? result.exitCode : null; }

async function gitRepository(exec, projectRoot) {
  const realProjectRoot = await fs.realpath(projectRoot);
  const rootResult = await exec("git", ["-C", realProjectRoot, "rev-parse", "--show-toplevel"], { cwd: realProjectRoot, timeout: 10_000 });
  if (execResultCode(rootResult) !== 0) fail("PROJECT_GATE_GIT_REQUIRED", "project gates require a Git repository");
  const rawRoot = String(rootResult.stdout ?? "").trim();
  if (!path.isAbsolute(rawRoot)) fail("PROJECT_GATE_GIT_INVALID", "Git returned a non-absolute repository root");
  const repositoryRoot = await fs.realpath(rawRoot);
  await assertContainedPath(repositoryRoot, repositoryRoot);
  if (!inside(repositoryRoot, realProjectRoot)) fail("PROJECT_GATE_PROJECT_ESCAPE", "current project is outside the Git repository root");
  const headResult = await exec("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { cwd: repositoryRoot, timeout: 10_000 });
  const head = String(headResult.stdout ?? "").trim();
  if (execResultCode(headResult) !== 0 || !/^[a-f0-9]{40}$/u.test(head)) fail("PROJECT_GATE_HEAD_UNAVAILABLE", "project gate Git HEAD is unavailable");
  return { repositoryRoot, head };
}

export class ProjectGateService {
  constructor({ configRoot, getContext, exec, environmentPath = process.env.PATH ?? "", clock = Date.now } = {}) {
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("ProjectGateService requires absolute configRoot");
    if (typeof getContext !== "function") throw new TypeError("ProjectGateService requires getContext()");
    if (typeof exec !== "function") throw new TypeError("ProjectGateService requires an exec adapter");
    this.configRoot = path.resolve(configRoot);
    this.getContext = getContext;
    this.exec = exec;
    this.environmentPath = environmentPath;
    this.clock = clock;
    this.grants = new Map();
  }

  async plan(gateIds = null, options = {}) {
    const ctx = this.getContext();
    if (options.requireTrust !== false && ctx?.isProjectTrusted?.() !== true) fail("PROJECT_TRUST_REQUIRED", "project gate manifest is ignored until Pi Project Trust is active");
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    if (typeof sessionId !== "string" || !sessionId) fail("PI_SESSION_ID_UNAVAILABLE", "project gate authorization requires a Pi session id");
    const requestedRoot = path.resolve(options.projectRoot ?? ctx?.cwd ?? "");
    const { repositoryRoot, head } = await gitRepository(this.exec, requestedRoot);
    const { document } = await readManifest(repositoryRoot);
    const { manifest, manifestDigest } = validateProjectGateManifest(document);
    const requestedIds = gateIds ?? manifest.gates.map((gate) => gate.id);
    if (!Array.isArray(requestedIds) || requestedIds.length < 1 || new Set(requestedIds).size !== requestedIds.length) fail("PROJECT_GATE_SET_INVALID", "project gate set must be a non-empty unique array");
    const byId = new Map(manifest.gates.map((gate) => [gate.id, gate]));
    const gates = [];
    let totalTimeoutSeconds = 0;
    for (const id of requestedIds) {
      if (!ID.test(id) || !byId.has(id)) fail("PROJECT_GATE_UNKNOWN", `unknown project gate ${id}`);
      const gate = byId.get(id);
      const cwd = path.resolve(repositoryRoot, gate.cwd);
      await assertContainedPath(repositoryRoot, cwd);
      const executableRealpath = await resolveExecutable(gate.command, this.environmentPath);
      totalTimeoutSeconds += gate.timeoutSeconds;
      gates.push(Object.freeze({ ...gate, cwd, executableRealpath, tupleDigest: digest({ command: gate.command, args: gate.args, cwd: path.relative(repositoryRoot, cwd) || ".", env: gate.env, executableRealpath }) }));
    }
    if (totalTimeoutSeconds > 2700) fail("PROJECT_GATE_TOTAL_TIMEOUT_EXCEEDED", "project gate set exceeds 45 minutes total timeout");
    const binding = {
      formatVersion: 1,
      sessionId,
      repositoryRootDigest: digest(repositoryRoot),
      head,
      manifestDigest,
      gateIds: gates.map((gate) => gate.id),
      tupleDigests: gates.map((gate) => gate.tupleDigest),
    };
    return Object.freeze({ ok: true, status: "PROJECT_GATE_PLAN", mutation: false, repositoryRoot, binding: Object.freeze({ ...binding, bindingDigest: digest(binding) }), gates: Object.freeze(gates), warning: "Process execution allowlist only; build artifacts are not filesystem-sandboxed." });
  }

  async grant(plan) {
    const current = await this.plan(plan?.binding?.gateIds);
    if (current.binding.bindingDigest !== plan?.binding?.bindingDigest) fail("PROJECT_GATE_PLAN_STALE", "project gate plan changed before authorization");
    this.grants.set(current.binding.sessionId, current);
    return Object.freeze({ ok: true, status: "PROJECT_GATE_TRUSTED_SESSION", mutation: true, bindingDigest: current.binding.bindingDigest, gateIds: current.binding.gateIds, expires: "session-shutdown" });
  }

  status() {
    const sessionId = this.getContext()?.sessionManager?.getSessionId?.();
    const grant = this.grants.get(sessionId);
    return Object.freeze({ ok: true, status: grant ? "PROJECT_GATE_TRUSTED_SESSION" : "PROJECT_GATE_UNTRUSTED", mutation: false, bindingDigest: grant?.binding.bindingDigest ?? null, gateIds: grant?.binding.gateIds ?? [] });
  }

  reset() {
    const sessionId = this.getContext()?.sessionManager?.getSessionId?.();
    const removed = this.grants.delete(sessionId);
    return Object.freeze({ ok: true, status: removed ? "PROJECT_GATE_TRUST_RESET" : "NO_CHANGES", mutation: removed });
  }

  async run(gateId, { signal, dryRun = false } = {}) {
    const sessionId = this.getContext()?.sessionManager?.getSessionId?.();
    const grant = this.grants.get(sessionId);
    if (!grant || !grant.binding.gateIds.includes(gateId)) fail("PROJECT_GATE_AUTHORIZATION_REQUIRED", `project gate ${gateId} is not authorized for this session`);
    const current = await this.plan(grant.binding.gateIds);
    if (current.binding.bindingDigest !== grant.binding.bindingDigest) { this.grants.delete(sessionId); fail("PROJECT_GATE_GRANT_DRIFT", "project gate authorization drifted and was revoked"); }
    const gate = current.gates.find((entry) => entry.id === gateId);
    if (dryRun) return Object.freeze({ status: "PLANNED", gateId, bindingDigest: current.binding.bindingDigest, tupleDigest: gate.tupleDigest, shell: false });
    const gateHome = path.join(this.configRoot, "only-my-pi", "gate-home");
    await fs.mkdir(gateHome, { recursive: true, mode: 0o700 });
    const safePath = this.environmentPath.split(path.delimiter).filter((entry) => path.isAbsolute(entry)).slice(0, 64).join(path.delimiter);
    const envArgs = Object.entries({ ...DEFAULT_ENV, ...gate.env, PATH: safePath, HOME: gateHome, TMPDIR: os.tmpdir() }).map(([name, value]) => `${name}=${value}`);
    const started = this.clock();
    const result = await this.exec("/usr/bin/env", ["-i", ...envArgs, gate.executableRealpath, ...gate.args], { cwd: gate.cwd, timeout: gate.timeoutSeconds * 1000, signal });
    if (result.outputLimitExceeded === true) fail("PROJECT_GATE_OUTPUT_LIMIT", `project gate ${gateId} output exceeded 2 MiB`);
    const combined = Buffer.from(`${result.stdout ?? ""}${result.stderr ?? ""}`, "utf8");
    if (combined.byteLength > MAX_OUTPUT_BYTES) fail("PROJECT_GATE_OUTPUT_LIMIT", `project gate ${gateId} output exceeded 2 MiB`);
    const exitCode = execResultCode(result);
    return Object.freeze({ status: exitCode === 0 ? "PASS" : "FAIL", gateId, exitCode, killed: result.killed === true, durationMs: Math.max(0, this.clock() - started), outputBytes: combined.byteLength, outputDigest: digest(combined), bindingDigest: current.binding.bindingDigest, tupleDigest: gate.tupleDigest, shell: false, network: "not-enforced" });
  }

  async dispose() { this.grants.clear(); return { status: "DISPOSED" }; }
}

export function createProjectGateService(options = {}) { return new ProjectGateService(options); }
export async function inspectProjectGateManifest({ projectRoot, exec, environmentPath } = {}) {
  const service = new ProjectGateService({ configRoot: path.join(os.tmpdir(), "only-my-pi-gate-inspector"), getContext: () => ({ cwd: projectRoot, isProjectTrusted: () => true, sessionManager: { getSessionId: () => "explicit-cli-inspection" } }), exec, environmentPath });
  return service.plan(null, { projectRoot, requireTrust: false });
}
export { digest as projectGateDigest };

export function createNodeExecAdapter({ spawnImpl = nodeSpawn, maxOutputBytes = MAX_OUTPUT_BYTES } = {}) {
  return (command, args, options = {}) => new Promise((resolve) => {
    const child = spawnImpl(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const output = { stdout: [], stderr: [] };
    let bytes = 0;
    let killed = false;
    let outputLimitExceeded = false;
    let settled = false;
    let timer;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    const append = (field, chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { outputLimitExceeded = true; killed = true; child.kill("SIGTERM"); return; }
      output[field].push(Buffer.from(chunk));
    };
    child.stdout?.on("data", (chunk) => append("stdout", chunk));
    child.stderr?.on("data", (chunk) => append("stderr", chunk));
    const abort = () => { killed = true; child.kill("SIGTERM"); };
    options.signal?.addEventListener?.("abort", abort, { once: true });
    if (options.timeout) timer = setTimeout(abort, options.timeout);
    child.once("error", (error) => finish({ stdout: "", stderr: error.message, code: 1, killed, outputLimitExceeded }));
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", abort);
      finish({ stdout: Buffer.concat(output.stdout).toString("utf8"), stderr: Buffer.concat(output.stderr).toString("utf8"), code: Number.isInteger(code) ? code : 1, killed, outputLimitExceeded });
    });
  });
}
