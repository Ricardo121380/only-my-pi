import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertSafeContainedPath,
  ensureConfigDirectory,
  relativeConfigPath,
  saveSettings,
} from "../../config-runtime/index.mjs";
import { compileAgentResource, createAgentRegistry } from "../../agent-registry/index.mjs";
import {
  inspectAuditedPiSubagentsPackage,
  PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
  PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
} from "../live-probe.mjs";
import {
  SUBAGENTS_GUARDED_WRITER_ERROR_TYPE,
  SUBAGENTS_GUARDED_WRITER_REQUEST_ENV,
} from "./guarded-writer-extension.mjs";
import { SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE } from "./live-evidence-capture.mjs";
import {
  compileLiveEvidencePiModels,
  loadLiveEvidenceProviderDescriptor,
} from "./live-evidence-provider.mjs";

const execFile = promisify(execFileCallback);
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_AGENT_RESOURCE_BYTES = 128 * 1024;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const IMPLEMENTER_TOOLS = Object.freeze(["bash", "edit", "find", "grep", "ls", "read", "write"]);
const LIMIT_KEYS = Object.freeze([
  "maxChildren",
  "maxConcurrency",
  "maxCostUsd",
  "maxOutputBytes",
  "maxTokens",
  "maxWallTimeMs",
]);

export class PiGuardedWriterRunnerError extends Error {
  constructor(message, code, details = {}) {
    super(`Pi guarded writer runner: ${message}`);
    this.name = "PiGuardedWriterRunnerError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new PiGuardedWriterRunnerError(message, code, details);
}

function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")
    || path.resolve(value) === path.parse(path.resolve(value)).root) {
    fail(`${label} must be an explicit absolute non-root directory`, "WRITER_RUNNER_PATH_INVALID");
  }
  try {
    const resolved = await fs.realpath(value);
    const stat = await fs.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("not a directory");
    return resolved;
  } catch {
    fail(`${label} must be an existing regular directory`, "WRITER_RUNNER_PATH_INVALID");
  }
}

async function containedDirectory(configRoot, target) {
  await ensureConfigDirectory(configRoot, relativeConfigPath(configRoot, target), 0o700);
  await assertSafeContainedPath(configRoot, target, { leafType: "directory" });
}

async function writeContainedFile(configRoot, target, contents, mode) {
  await fs.writeFile(target, contents, { flag: "wx", mode });
  await assertSafeContainedPath(configRoot, target, { leafType: "file" });
}

async function regularContainedFile(root, target, maximumBytes) {
  if (!inside(root, target)) fail("agent resource escaped repository root", "WRITER_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  let current = path.resolve(root);
  for (const segment of path.relative(path.resolve(root), path.resolve(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(() => null);
    if (!stat || stat.isSymbolicLink()) fail("agent resource is missing or symlinked", "WRITER_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  }
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.size < 2 || stat.size > maximumBytes) {
    fail("agent resource is not a bounded regular file", "WRITER_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  }
  return fs.readFile(target, "utf8");
}

async function governedImplementerResource(repositoryRoot) {
  try {
    const implementer = await createAgentRegistry({ rootDir: repositoryRoot }).resolve("implementer");
    const manifest = implementer.manifest;
    if (manifest.contractStatus !== "runtime-ready"
      || manifest.upstreamAgentId !== "omp-implementer"
      || manifest.writer !== true
      || JSON.stringify([...manifest.tools.allow].sort()) !== JSON.stringify(IMPLEMENTER_TOOLS)
      || manifest.policyCeiling.workspace !== "worktree-write"
      || manifest.policyCeiling.mutation !== "isolated-worktree"
      || manifest.policyCeiling.approval !== "ask"
      || manifest.policyCeiling.egress.web !== "deny"
      || manifest.policyCeiling.egress.mcp !== "deny") {
      fail("canonical implementer exceeds the guarded writer envelope", "WRITER_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
    }
    const compiled = compileAgentResource(manifest, implementer.prompt.content);
    const checkedIn = await regularContainedFile(
      repositoryRoot,
      path.join(repositoryRoot, "agents", "generated", "omp-implementer.md"),
      MAX_AGENT_RESOURCE_BYTES,
    );
    if (compiled.name !== "omp-implementer" || checkedIn !== compiled.content) {
      fail("generated implementer resource drifted from its canonical manifest", "WRITER_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
    }
    return compiled.content;
  } catch (cause) {
    if (cause instanceof PiGuardedWriterRunnerError) throw cause;
    fail("canonical implementer resource could not be validated", "WRITER_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  }
}

async function runGit(command, cwd, argv, env, code = "WRITER_RUNNER_GIT_FAILED") {
  try {
    const result = await execFile(command, argv, {
      cwd,
      env,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout.trim();
  } catch {
    fail("disposable fixture Git operation failed", code, { argv });
  }
}

async function createFixtureRepository({ configRoot, fixtureRoot, gitCommand, env }) {
  await writeContainedFile(configRoot, path.join(fixtureRoot, ".gitignore"), ".pi-subagents/\n", 0o400);
  await containedDirectory(configRoot, path.join(fixtureRoot, "fixture"));
  await writeContainedFile(configRoot, path.join(fixtureRoot, "fixture", "allowed.txt"), "before\n", 0o600);
  const gitEnv = {
    PATH: env.PATH,
    HOME: env.HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "only-my-pi",
    GIT_AUTHOR_EMAIL: "only-my-pi@example.invalid",
    GIT_COMMITTER_NAME: "only-my-pi",
    GIT_COMMITTER_EMAIL: "only-my-pi@example.invalid",
    LC_ALL: "C",
  };
  await runGit(gitCommand, fixtureRoot, ["init", "-q", "--initial-branch=main"], gitEnv);
  await runGit(gitCommand, fixtureRoot, ["add", "--", ".gitignore", "fixture/allowed.txt"], gitEnv);
  await runGit(gitCommand, fixtureRoot, ["commit", "-q", "-m", "guarded writer fixture"], gitEnv);
  const baseCommit = await runGit(gitCommand, fixtureRoot, ["rev-parse", "HEAD"], gitEnv);
  if (!FULL_COMMIT.test(baseCommit)) fail("fixture base commit is invalid", "WRITER_RUNNER_GIT_FAILED");
  const status = await runGit(gitCommand, fixtureRoot, ["status", "--porcelain=v1", "--untracked-files=all"], gitEnv);
  if (status !== "") fail("fixture repository is not clean", "WRITER_RUNNER_FIXTURE_DIRTY");
  return { baseCommit, gitEnv };
}

async function defaultVersionProbe(command, { cwd, env, timeoutMs }) {
  const result = await execFile(command, ["--version"], { cwd, env, timeout: timeoutMs, maxBuffer: 16 * 1024, windowsHide: true });
  return result.stdout.trim();
}

function boundedAppend(state, chunk, maximum) {
  const input = Buffer.from(chunk);
  const remaining = maximum - state.bytes;
  if (remaining <= 0) { state.truncated = true; return; }
  state.parts.push(input.subarray(0, remaining));
  state.bytes += Math.min(remaining, input.length);
  if (input.length > remaining) state.truncated = true;
}

function parseRecords(text) {
  const records = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let value;
    try { value = JSON.parse(raw.endsWith("\r") ? raw.slice(0, -1) : raw); } catch { continue; }
    if (value?.type === SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE || value?.type === SUBAGENTS_GUARDED_WRITER_ERROR_TYPE) records.push(value);
  }
  return records;
}

function terminateProcessTree(child) {
  if (process.platform !== "win32" && Number.isSafeInteger(child?.pid) && child.pid > 1) {
    try { process.kill(-child.pid, "SIGTERM"); return; } catch { /* direct fallback */ }
  }
  child?.kill?.("SIGTERM");
}

function exactRuntimeEnvironment(expected, actual) {
  const keys = ["backend", "node", "pi", "platform"];
  return expected && typeof expected === "object" && !Array.isArray(expected)
    && JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(keys)
    && keys.every((key) => expected[key] === actual[key]);
}

function exactScenarioLimits(expected, actual) {
  return expected && actual
    && typeof expected === "object" && !Array.isArray(expected)
    && typeof actual === "object" && !Array.isArray(actual)
    && JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(LIMIT_KEYS)
    && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(LIMIT_KEYS)
    && LIMIT_KEYS.every((key) => expected[key] === actual[key]);
}

function safeEnvironment({ directories, authorization, hostEnvironment, requestFile }) {
  const credentials = {};
  for (const name of authorization.provider.credentialEnvironment) {
    const value = hostEnvironment[name];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      fail(`required credential environment is unavailable: ${name}`, "WRITER_RUNNER_CREDENTIAL_UNAVAILABLE", { name });
    }
    credentials[name] = value;
  }
  return {
    PATH: hostEnvironment.PATH ?? process.env.PATH ?? "",
    HOME: directories.home,
    TMPDIR: directories.tmp,
    XDG_CACHE_HOME: directories.xdgCache,
    XDG_CONFIG_HOME: directories.xdgConfig,
    XDG_DATA_HOME: directories.xdgData,
    PI_CODING_AGENT_DIR: directories.agentRoot,
    PI_SUBAGENTS_WORKTREE_DIR: directories.worktreeRoot,
    PI_SUBAGENT_MAX_DEPTH: "1",
    PI_SUBAGENT_MAX_SPAWNS_PER_SESSION: "1",
    PI_SUBAGENT_WAIT_TOOL_ENABLED: "false",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    NO_COLOR: "1",
    TERM: "dumb",
    [SUBAGENTS_GUARDED_WRITER_REQUEST_ENV]: requestFile,
    ...credentials,
  };
}

export function createPiGuardedWriterScenarioRunner({
  configRoot,
  packageRoot,
  modelsFile,
  repositoryRoot,
  piCommand = "pi",
  gitCommand = "git",
  spawnImpl = spawn,
  versionProbe = defaultVersionProbe,
  hostEnvironment = process.env,
  homedir = os.homedir,
  expectedPiVersion = PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
  expectedArtifact = PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
} = {}) {
  if (typeof piCommand !== "string" || typeof gitCommand !== "string"
    || /[\0\r\n]/u.test(piCommand) || /[\0\r\n]/u.test(gitCommand)
    || typeof spawnImpl !== "function" || typeof versionProbe !== "function") {
    throw new TypeError("guarded writer runner dependencies are invalid");
  }
  const providerDescriptor = loadLiveEvidenceProviderDescriptor(modelsFile);
  let used = false;
  return async function runGuardedWriter({ id, authorization, expectedSourceCommit, environment, scenarioLimits } = {}) {
    if (used) fail("guarded writer runner is one-shot", "WRITER_RUNNER_REUSED");
    used = true;
    if (id !== "guarded-writer-integration"
      || scenarioLimits?.maxChildren !== 1 || scenarioLimits?.maxConcurrency !== 1
      || !exactScenarioLimits(scenarioLimits, authorization?.limits)) {
      fail("scenario differs from its exact authorization", "WRITER_RUNNER_SCENARIO_INVALID");
    }
    const resolvedConfigRoot = await realDirectory(configRoot, "configRoot");
    if ((await fs.readdir(resolvedConfigRoot)).length !== 0) fail("configRoot must be empty", "WRITER_RUNNER_CONFIG_ROOT_NOT_EMPTY");
    const resolvedRepositoryRoot = await realDirectory(repositoryRoot, "repositoryRoot");
    if (inside(path.join(path.resolve(homedir()), ".pi"), resolvedConfigRoot)) {
      fail("guarded writer evidence cannot use the real Pi home", "WRITER_RUNNER_REAL_PI_HOME_FORBIDDEN");
    }
    const audited = await inspectAuditedPiSubagentsPackage({ packageRoot, expected: expectedArtifact });
    const piModels = compileLiveEvidencePiModels(providerDescriptor, { authorization });
    const actualEnvironment = { node: process.versions.node, pi: expectedPiVersion, backend: `${audited.package}@${audited.version}`, platform: `${process.platform}-${process.arch}` };
    if (!exactRuntimeEnvironment(environment, actualEnvironment)) fail("host runtime differs from authorization", "WRITER_RUNNER_ENVIRONMENT_MISMATCH");
    const implementerResource = await governedImplementerResource(resolvedRepositoryRoot);
    const extension = fileURLToPath(new URL("./guarded-writer-extension.mjs", import.meta.url));
    const extensionStat = await fs.lstat(extension).catch(() => null);
    if (!extensionStat?.isFile() || extensionStat.isSymbolicLink()) fail("guarded writer extension unavailable", "WRITER_RUNNER_EXTENSION_UNAVAILABLE");

    const runtimeRoot = path.join(resolvedConfigRoot, "only-my-pi", "subagents-guarded-writer", authorization.authorizationId);
    const directories = {
      runtimeRoot,
      agentRoot: path.join(runtimeRoot, "agent"),
      agentDefinitions: path.join(runtimeRoot, "agent", "agents"),
      subagentConfig: path.join(runtimeRoot, "agent", "extensions", "subagent"),
      sessionDir: path.join(runtimeRoot, "agent", "sessions"),
      artifactRoot: path.join(runtimeRoot, "agent", "sessions", "subagent-artifacts"),
      fixtureRoot: path.join(runtimeRoot, "fixture-repo"),
      worktreeRoot: path.join(runtimeRoot, "worktrees"),
      home: path.join(runtimeRoot, "home"),
      tmp: path.join(runtimeRoot, "tmp"),
      xdgCache: path.join(runtimeRoot, "xdg-cache"),
      xdgConfig: path.join(runtimeRoot, "xdg-config"),
      xdgData: path.join(runtimeRoot, "xdg-data"),
    };
    for (const directory of [
      path.join(resolvedConfigRoot, "only-my-pi"),
      path.join(resolvedConfigRoot, "only-my-pi", "subagents-guarded-writer"),
      ...Object.values(directories),
    ]) await containedDirectory(resolvedConfigRoot, directory);
    const preliminaryEnv = { PATH: hostEnvironment.PATH ?? process.env.PATH ?? "", HOME: directories.home };
    const fixture = await createFixtureRepository({ configRoot: resolvedConfigRoot, fixtureRoot: directories.fixtureRoot, gitCommand, env: preliminaryEnv });
    await writeContainedFile(resolvedConfigRoot, path.join(directories.agentDefinitions, "omp-implementer.md"), implementerResource, 0o600);
    await writeContainedFile(
      resolvedConfigRoot,
      path.join(directories.agentRoot, "models.json"),
      `${JSON.stringify(piModels, null, 2)}\n`,
      0o600,
    );
    await writeContainedFile(resolvedConfigRoot, path.join(directories.subagentConfig, "config.json"), `${JSON.stringify({ artifactDir: "session" }, null, 2)}\n`, 0o600);

    const requestFile = path.join(directories.agentRoot, "guarded-writer-request.json");
    const request = {
      authorizationDigest: authorization.authorizationDigest,
      sourceCommit: expectedSourceCommit,
      matrixDigest: authorization.matrixDigest,
      policyDigest: authorization.policyDigest,
      trustPolicyDigest: authorization.trustPolicyDigest,
      compatibilityRowId: authorization.compatibilityRowId,
      environment: actualEnvironment,
      limits: scenarioLimits,
      repositoryRoot: resolvedRepositoryRoot,
      runtimeRoot,
      agentRoot: directories.agentRoot,
      fixtureRoot: directories.fixtureRoot,
      artifactRoot: directories.artifactRoot,
      worktreeRoot: directories.worktreeRoot,
      baseCommit: fixture.baseCommit,
      expectedMarker: authorization.writer.expectedMarker,
      requiredGateIds: authorization.writer.requiredGateIds,
    };
    await writeContainedFile(resolvedConfigRoot, requestFile, `${JSON.stringify(request, null, 2)}\n`, 0o600);
    const env = safeEnvironment({ directories, authorization, hostEnvironment, requestFile });
    await saveSettings(directories.agentRoot, {
      defaultProjectTrust: "never",
      enableInstallTelemetry: false,
      enableAnalytics: false,
      packages: [],
      extensions: [audited.extensionEntry, extension],
      skills: [],
      prompts: [],
      themes: [],
    });
    await assertSafeContainedPath(resolvedConfigRoot, path.join(directories.agentRoot, "settings.json"), { leafType: "file" });
    const piVersion = await versionProbe(piCommand, { cwd: directories.fixtureRoot, env, timeoutMs: Math.min(60_000, scenarioLimits.maxWallTimeMs) }).catch(() => null);
    if (piVersion !== expectedPiVersion) fail("Pi version differs from authorization", "WRITER_RUNNER_PI_VERSION_MISMATCH");

    const parentSessionId = `omp-guarded-${authorization.authorizationDigest.slice(7, 23)}`;
    const argv = [
      "--mode", "rpc", "--provider", authorization.provider.id, "--model", authorization.provider.model,
      "--session-dir", directories.sessionDir, "--session-id", parentSessionId,
      "--no-context-files", "--no-skills", "--no-builtin-tools", "--no-approve",
    ];
    const maximum = Math.min(MAX_CAPTURE_BYTES, scenarioLimits.maxOutputBytes);
    const stdout = { parts: [], bytes: 0, truncated: false };
    const stderr = { parts: [], bytes: 0, truncated: false };
    const record = await new Promise((resolve, reject) => {
      let child;
      let timer;
      let settled = false;
      let observed = false;
      const finish = (callback) => { if (settled) return; settled = true; clearTimeout(timer); callback(); };
      const observe = () => {
        const records = [...parseRecords(Buffer.concat(stdout.parts).toString("utf8")), ...parseRecords(Buffer.concat(stderr.parts).toString("utf8"))];
        if (records.length > 1) { terminateProcessTree(child); finish(() => reject(new PiGuardedWriterRunnerError("multiple records emitted", "WRITER_RUNNER_RECORD_AMBIGUOUS"))); }
        else if (records.length === 1 && !observed) { observed = true; child?.stdin?.end?.(); }
      };
      try {
        child = spawnImpl(piCommand, argv, { cwd: directories.fixtureRoot, env, detached: process.platform !== "win32", shell: false, stdio: ["pipe", "pipe", "pipe"] });
      } catch { fail("Pi subprocess could not start", "WRITER_RUNNER_START_FAILED"); }
      child.stdout?.on?.("data", (chunk) => { boundedAppend(stdout, chunk, maximum); observe(); });
      child.stderr?.on?.("data", (chunk) => { boundedAppend(stderr, chunk, maximum); observe(); });
      child.stdin?.on?.("error", () => {});
      child.on?.("error", () => finish(() => reject(new PiGuardedWriterRunnerError("Pi subprocess failed", "WRITER_RUNNER_PROCESS_ERROR"))));
      child.on?.("exit", (code, signal) => finish(() => {
        const records = [...parseRecords(Buffer.concat(stdout.parts).toString("utf8")), ...parseRecords(Buffer.concat(stderr.parts).toString("utf8"))];
        if (code !== 0 || signal !== null || stdout.truncated || stderr.truncated) reject(new PiGuardedWriterRunnerError("Pi scenario failed", "WRITER_RUNNER_FAILED"));
        else if (records.length !== 1) reject(new PiGuardedWriterRunnerError("Pi emitted no unique record", "WRITER_RUNNER_RECORD_MISSING"));
        else if (records[0].type === SUBAGENTS_GUARDED_WRITER_ERROR_TYPE) reject(new PiGuardedWriterRunnerError("Pi extension rejected writer", records[0].code));
        else resolve(records[0]);
      }));
      timer = setTimeout(() => { terminateProcessTree(child); finish(() => reject(new PiGuardedWriterRunnerError("Pi scenario timed out", "WRITER_RUNNER_TIMEOUT"))); }, scenarioLimits.maxWallTimeMs);
      timer.unref?.();
    });
    const fixtureHead = await runGit(gitCommand, directories.fixtureRoot, ["rev-parse", "HEAD"], fixture.gitEnv);
    const fixtureStatus = await runGit(gitCommand, directories.fixtureRoot, ["status", "--porcelain=v1", "--untracked-files=all"], fixture.gitEnv);
    if (fixtureHead !== fixture.baseCommit || fixtureStatus !== "") {
      fail("parent fixture was mutated instead of receiving a handoff", "WRITER_RUNNER_AUTOMATIC_INTEGRATION_DETECTED");
    }
    return record;
  };
}
