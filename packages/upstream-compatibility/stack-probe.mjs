import crypto from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { sha256, withoutKey } from "../subagents/state/codec.mjs";
import {
  inspectM9CandidateInstallation,
  loadUpstreamCompatibility,
  UpstreamCompatibilityError,
} from "./index.mjs";
import {
  M9_STACK_PROBE_RECORD_TYPE,
  M9_STACK_PROBE_ROOTS_ENV,
} from "./stack-probe-extension.mjs";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT = 256 * 1024;
const REQUIRED_COMMANDS = Object.freeze({
  plan: "plan-mode",
  lsp: "lsp",
  sessions: "agent-extensions",
  "context-simple": "agent-extensions",
  review: "agent-extensions",
  "end-review": "agent-extensions",
  omp: "only-my-pi",
  "omp-context": "only-my-pi",
});
const REQUIRED_ACTIVE_TOOLS = Object.freeze({
  subagent: "subagents",
  subagent_supervisor: "subagents",
  subagent_wait: "subagents",
  lsp_diagnostics: "lsp",
  lsp_fix: "lsp",
  web_search: "web-access",
  source_check: "web-access",
  fetch_content: "web-access",
  get_search_content: "web-access",
});

function fail(message, code, details) {
  throw new UpstreamCompatibilityError(message, code, details);
}

function exactDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) === path.parse(path.resolve(value)).root) throw new TypeError(`${label} must be an explicit absolute non-root directory`);
  return fs.realpath(value).then(async (root) => {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`, "M9_STACK_PATH_UNSAFE");
    return root;
  });
}

async function regularEntry(root, relative) {
  const target = path.join(root, ...relative.split("/"));
  const real = await fs.realpath(target);
  const contained = path.relative(root, real);
  if (contained.startsWith("..") || path.isAbsolute(contained)) fail("candidate extension entry escapes its package root", "M9_STACK_ENTRY_ESCAPE", { relative });
  const stat = await fs.lstat(real);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("candidate extension entry must be a regular file", "M9_STACK_ENTRY_UNSAFE", { relative });
  return real;
}

function appendBounded(state, chunk) {
  const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const remaining = MAX_OUTPUT - state.bytes;
  if (remaining > 0) {
    const bounded = value.subarray(0, remaining);
    state.chunks.push(bounded);
    state.bytes += bounded.length;
  }
  if (value.length > remaining) state.truncated = true;
}

function duplicateNames(entries) {
  const seen = new Set();
  const duplicate = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) duplicate.add(entry.name);
    seen.add(entry.name);
  }
  return [...duplicate].sort();
}

function requireOwner(entries, name, owner, { active = false } = {}) {
  const matches = entries.filter((entry) => entry.name === name && entry.owner === owner && (!active || entry.active === true));
  if (matches.length !== 1) fail(`candidate stack did not expose one ${owner} ${name}`, "M9_STACK_REGISTRY_DRIFT", { name, owner, active, matchCount: matches.length });
}

export function m9StackProbeEvidenceDigest(evidence) {
  return sha256(withoutKey(evidence, "evidenceDigest"));
}

export function assertM9StackProbeEvidence(evidence) {
  if (evidence?.formatVersion !== 1 || evidence?.status !== "PASS" || evidence?.boundary !== "PI_0_84_3_FULL_EXTENSION_STACK_NO_MODEL") {
    fail("candidate stack evidence shape is invalid", "M9_STACK_EVIDENCE_INVALID");
  }
  if (evidence.piVersion !== "0.84.3" || evidence.subagentsVersion !== "0.57.0" || evidence.extensionCount !== 13) {
    fail("candidate stack version or extension count drifted", "M9_STACK_EVIDENCE_VERSION_DRIFT");
  }
  if (evidence.promptSubmitted !== false || evidence.providerRequest !== "NOT_RUN_BY_POLICY" || evidence.childDispatch !== "NOT_REQUESTED" || evidence.realPiHome !== "NOT_TOUCHED" || evidence.exitCode !== 0 || evidence.outputTruncated !== false) {
    fail("candidate stack evidence crossed its no-model boundary", "M9_STACK_EVIDENCE_BOUNDARY_DRIFT");
  }
  if (duplicateNames(evidence.commands ?? []).length !== 0 || duplicateNames(evidence.tools ?? []).length !== 0) {
    fail("candidate stack evidence contains duplicate registry names", "M9_STACK_DUPLICATE_REGISTRATION");
  }
  for (const [name, owner] of Object.entries(REQUIRED_COMMANDS)) requireOwner(evidence.commands, name, owner);
  for (const [name, owner] of Object.entries(REQUIRED_ACTIVE_TOOLS)) requireOwner(evidence.tools, name, owner, { active: true });
  if (evidence.tools.some((entry) => entry.active && entry.name === "intercom")
    || evidence.tools.some((entry) => entry.active && entry.owner === "only-my-pi")) {
    fail("candidate stack has an unexpected active physical tool owner", "M9_STACK_TOOL_OWNER_DRIFT");
  }
  if (!evidence.commands.some((entry) => entry.owner === "usage")) fail("candidate usage extension registered no command", "M9_STACK_USAGE_UNOBSERVED");
  if (!/^sha256:[a-f0-9]{64}$/u.test(evidence.stdoutDigest ?? "") || !/^sha256:[a-f0-9]{64}$/u.test(evidence.stderrDigest ?? "")) fail("candidate stack stream digest is invalid", "M9_STACK_EVIDENCE_DIGEST_DRIFT");
  if (typeof evidence.observedAt !== "string" || new Date(evidence.observedAt).toISOString() !== evidence.observedAt) fail("candidate stack evidence timestamp is invalid", "M9_STACK_EVIDENCE_TIME_INVALID");
  if (evidence.evidenceDigest !== m9StackProbeEvidenceDigest(evidence)) fail("candidate stack evidence digest drifted", "M9_STACK_EVIDENCE_DIGEST_DRIFT");
  return Object.freeze(structuredClone(evidence));
}

export async function runM9StackProbe({
  installationRoot,
  configRoot,
  piCommand,
  onlyMyPiRoot,
  contract = loadUpstreamCompatibility(),
  spawnImpl = spawn,
  versionProbe = async (command, options) => (await execFile(command, ["--version"], options)).stdout.trim(),
  timeoutMs = 20_000,
  clock = () => new Date(),
} = {}) {
  const installation = await exactDirectory(installationRoot, "installationRoot");
  const config = await exactDirectory(configRoot, "configRoot");
  const firstParty = await exactDirectory(onlyMyPiRoot, "onlyMyPiRoot");
  inspectM9CandidateInstallation({ installationRoot: installation, contract });
  const packageRoot = (name) => path.join(installation, "node_modules", ...name.split("/"));
  const roots = {
    "agent-extensions": packageRoot("pi-agent-extensions"),
    lsp: packageRoot("@narumitw/pi-lsp"),
    "plan-mode": packageRoot("@narumitw/pi-plan-mode"),
    subagents: packageRoot("pi-subagents"),
    usage: packageRoot("@sreetej510/pi-usage"),
    "web-access": packageRoot("pi-web-access"),
    "only-my-pi": firstParty,
  };
  const entries = [
    await regularEntry(roots["plan-mode"], "dist/index.ts"),
    ...await Promise.all(["sessions", "context", "review", "notify"].map((name) => regularEntry(roots["agent-extensions"], `extensions/${name}/index.ts`))),
    await regularEntry(roots["web-access"], "index.ts"),
    await regularEntry(roots.subagents, "index.ts"),
    await regularEntry(roots.lsp, "dist/index.ts"),
    await regularEntry(roots.usage, "dist/index.js"),
    await regularEntry(firstParty, "extensions/session-ledger/index.ts"),
    await regularEntry(firstParty, "extensions/context-doctor/index.ts"),
    await regularEntry(firstParty, "extensions/omp-control/index.ts"),
    await regularEntry(firstParty, "packages/upstream-compatibility/stack-probe-extension.mjs"),
  ];
  const runtime = await fs.mkdtemp(path.join(config, "m9-stack-"));
  const home = path.join(runtime, "home");
  const temporary = path.join(runtime, "tmp");
  const cache = path.join(runtime, "xdg-cache");
  const xdgConfig = path.join(runtime, "xdg-config");
  const data = path.join(runtime, "xdg-data");
  await Promise.all([home, temporary, cache, xdgConfig, data].map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
  await fs.writeFile(path.join(runtime, "settings.json"), `${JSON.stringify({
    extensions: entries,
    packages: [],
    skills: [],
    prompts: [],
    themes: [],
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(runtime, "web-search.json"), `${JSON.stringify({
    allowBrowserCookies: false,
    autoOpenBrowser: false,
    workflow: "none",
    ssrf: { allowRanges: [], trustEnvProxy: false },
  }, null, 2)}\n`, { mode: 0o600 });
  const command = piCommand ?? path.join(installation, "node_modules", ".bin", "pi");
  if (!path.isAbsolute(command)) throw new TypeError("piCommand must be an absolute path");
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: temporary,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: data,
    PI_CODING_AGENT_DIR: runtime,
    PI_OFFLINE: "1",
    PI_SUBAGENT_WAIT_TOOL_ENABLED: "false",
    NO_COLOR: "1",
    TERM: "dumb",
    [M9_STACK_PROBE_ROOTS_ENV]: JSON.stringify(roots),
  };
  const piVersion = await versionProbe(command, { cwd: runtime, env, timeout: timeoutMs, maxBuffer: 16 * 1024 });
  if (piVersion !== contract.candidate.piVersion) fail("candidate Pi executable version drifted", "M9_STACK_PI_VERSION_DRIFT", { piVersion });
  const stdout = { chunks: [], bytes: 0, truncated: false };
  const stderr = { chunks: [], bytes: 0, truncated: false };
  const child = spawnImpl(command, ["--mode", "rpc", "--offline", "--no-session", "--no-context-files", "--no-skills", "--no-builtin-tools", "--no-approve"], {
    cwd: runtime,
    env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => appendBounded(stdout, chunk));
  child.stderr.on("data", (chunk) => appendBounded(stderr, chunk));
  child.stdin.end();
  const terminal = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new UpstreamCompatibilityError("candidate stack probe timed out", "M9_STACK_TIMEOUT"));
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (cause) => { clearTimeout(timer); reject(cause); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  const stdoutText = Buffer.concat(stdout.chunks).toString("utf8");
  const stderrText = Buffer.concat(stderr.chunks).toString("utf8");
  const records = `${stdoutText}\n${stderrText}`.split(/\r?\n/u).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value?.type === M9_STACK_PROBE_RECORD_TYPE ? [value] : [];
    } catch { return []; }
  });
  if (terminal.code !== 0 || terminal.signal !== null || records.length !== 1 || stdout.truncated || stderr.truncated) {
    fail("candidate full extension stack did not exit cleanly with one observer record", "M9_STACK_PROCESS_FAILED", {
      exitCode: terminal.code,
      signal: terminal.signal,
      recordCount: records.length,
      outputTruncated: stdout.truncated || stderr.truncated,
    });
  }
  if (/(?:failed|error)\s+(?:to\s+)?load\s+extension|duplicate\s+(?:command|tool)/iu.test(`${stdoutText}\n${stderrText}`)) {
    fail("candidate Pi reported an extension load or registry error", "M9_STACK_LOAD_ERROR");
  }
  const result = {
    formatVersion: 1,
    status: "PASS",
    boundary: "PI_0_84_3_FULL_EXTENSION_STACK_NO_MODEL",
    observedAt: clock().toISOString(),
    piVersion,
    subagentsVersion: contract.candidate.subagentsVersion,
    extensionCount: entries.length,
    commands: records[0].commands,
    tools: records[0].tools,
    promptSubmitted: false,
    providerRequest: "NOT_RUN_BY_POLICY",
    childDispatch: "NOT_REQUESTED",
    realPiHome: "NOT_TOUCHED",
    exitCode: terminal.code,
    signal: terminal.signal,
    outputTruncated: false,
    stdoutDigest: `sha256:${crypto.createHash("sha256").update(stdoutText).digest("hex")}`,
    stderrDigest: `sha256:${crypto.createHash("sha256").update(stderrText).digest("hex")}`,
  };
  return assertM9StackProbeEvidence({ ...result, evidenceDigest: m9StackProbeEvidenceDigest(result) });
}
