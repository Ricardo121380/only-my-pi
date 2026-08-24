import crypto from "node:crypto";
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
import { sha256, withoutKey } from "../state/codec.mjs";
import { digestValue } from "../domain/index.mjs";
import {
  SUBAGENTS_BACKGROUND_RESUME_ERROR_TYPE,
  SUBAGENTS_BACKGROUND_RESUME_HANDOFF_TYPE,
  SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE,
  SUBAGENTS_BACKGROUND_RESUME_REQUEST_ENV,
} from "./background-resume-extension.mjs";
import { SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE } from "./live-evidence-capture.mjs";
import {
  compileLiveEvidencePiModels,
  loadLiveEvidenceProviderDescriptor,
} from "./live-evidence-provider.mjs";

const execFile = promisify(execFileCallback);
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
const MAX_AGENT_RESOURCE_BYTES = 128 * 1024;
const REVIEWER_TOOLS = Object.freeze(["find", "grep", "ls", "read"]);
const WORKSPACE_PACKAGE = `${JSON.stringify({
  name: "only-my-pi-background-resume-fixture",
  private: true,
  version: "0.0.0",
}, null, 2)}\n`;
const WORKSPACE_README = "# only-my-pi background resume fixture\n\nRead-only synthetic files for a two-parent-process resume proof.\n";

export class PiBackgroundResumeRunnerError extends Error {
  constructor(message, code, details = {}) {
    super(`Pi background resume runner: ${message}`);
    this.name = "PiBackgroundResumeRunnerError";
    this.code = code;
    Object.assign(this, details);
  }
}

function exactScenarioLimits(candidate, expected) {
  const keys = ["maxChildren", "maxConcurrency", "maxCostUsd", "maxOutputBytes", "maxTokens", "maxWallTimeMs"];
  return candidate !== null
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && expected !== null
    && typeof expected === "object"
    && JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify(keys)
    && keys.every((key) => candidate[key] === expected[key]);
}

function fail(message, code, details) {
  throw new PiBackgroundResumeRunnerError(message, code, details);
}

function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")
    || path.resolve(value) === path.parse(path.resolve(value)).root) {
    fail(`${label} must be an explicit absolute non-root directory`, "BACKGROUND_RUNNER_PATH_INVALID");
  }
  try {
    const resolved = await fs.realpath(value);
    const stat = await fs.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("not a directory");
    return resolved;
  } catch {
    fail(`${label} must be an existing regular directory`, "BACKGROUND_RUNNER_PATH_INVALID");
  }
}

function exactRuntimeEnvironment(expected, actual) {
  const keys = ["backend", "node", "pi", "platform"];
  return expected !== null
    && typeof expected === "object"
    && !Array.isArray(expected)
    && JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(keys)
    && keys.every((key) => expected[key] === actual[key]);
}

async function containedDirectory(configRoot, target) {
  await ensureConfigDirectory(configRoot, relativeConfigPath(configRoot, target), 0o700);
  await assertSafeContainedPath(configRoot, target, { leafType: "directory" });
}

async function writeContainedFile(configRoot, target, contents, mode) {
  await fs.writeFile(target, contents, { flag: "wx", mode });
  await assertSafeContainedPath(configRoot, target, { leafType: "file" });
}

async function regularContainedRepositoryFile(repositoryRoot, target) {
  if (!inside(repositoryRoot, target)) fail("agent resource escaped repository root", "BACKGROUND_RUNNER_AGENT_UNAVAILABLE");
  let current = repositoryRoot;
  for (const segment of path.relative(repositoryRoot, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(() => null);
    if (!stat || stat.isSymbolicLink()) fail("agent resource is missing or symlinked", "BACKGROUND_RUNNER_AGENT_UNAVAILABLE");
  }
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_AGENT_RESOURCE_BYTES) {
    fail("agent resource is not a bounded regular file", "BACKGROUND_RUNNER_AGENT_UNAVAILABLE");
  }
  return fs.readFile(target, "utf8");
}

async function governedReviewerResource(repositoryRoot) {
  try {
    const reviewer = await createAgentRegistry({ rootDir: repositoryRoot }).resolve("reviewer");
    const manifest = reviewer.manifest;
    if (manifest.contractStatus !== "runtime-ready"
      || manifest.upstreamAgentId !== "omp-reviewer"
      || manifest.writer !== false
      || JSON.stringify([...manifest.tools.allow].sort()) !== JSON.stringify(REVIEWER_TOOLS)
      || manifest.policyCeiling.workspace !== "read-only"
      || manifest.policyCeiling.mutation !== "none"
      || manifest.policyCeiling.egress.web !== "deny"
      || manifest.policyCeiling.egress.mcp !== "deny"
      || manifest.resumable !== true) {
      fail("canonical reviewer exceeds the background resume envelope", "BACKGROUND_RUNNER_AGENT_UNAVAILABLE");
    }
    const compiled = compileAgentResource(manifest, reviewer.prompt.content);
    const checkedIn = await regularContainedRepositoryFile(
      repositoryRoot,
      path.join(repositoryRoot, "agents", "generated", "omp-reviewer.md"),
    );
    if (compiled.name !== "omp-reviewer" || compiled.content !== checkedIn) {
      fail("generated reviewer resource drifted from its canonical manifest", "BACKGROUND_RUNNER_AGENT_UNAVAILABLE");
    }
    return compiled.content;
  } catch (cause) {
    if (cause instanceof PiBackgroundResumeRunnerError) throw cause;
    fail("canonical reviewer resource could not be validated", "BACKGROUND_RUNNER_AGENT_UNAVAILABLE");
  }
}

function boundedAppend(state, aggregate, chunk, maximum) {
  const input = Buffer.from(chunk);
  const remaining = maximum - aggregate.bytes;
  if (remaining <= 0) {
    state.truncated = true;
    aggregate.truncated = true;
    return;
  }
  const accepted = Math.min(remaining, input.length);
  state.parts.push(input.subarray(0, accepted));
  state.bytes += accepted;
  aggregate.bytes += accepted;
  if (input.length > remaining) {
    state.truncated = true;
    aggregate.truncated = true;
  }
}

function parseRecords(text) {
  const records = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line);
      if ([
        SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE,
        SUBAGENTS_BACKGROUND_RESUME_ERROR_TYPE,
        SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE,
      ].includes(value?.type)) records.push(value);
    } catch {
      // Pi RPC startup messages are not capture records.
    }
  }
  return records;
}

function validateLaunchPhaseReceipt(receipt, authorizationDigest) {
  const keys = [
    "authorizationDigest", "formatVersion", "handoffDigest", "initialTerminalDigest",
    "parentSessionIdentityDigest", "phase", "phaseDigest", "status", "type", "usage",
  ];
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(keys)
    || receipt.formatVersion !== 1
    || receipt.type !== SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE
    || receipt.status !== "PASS"
    || receipt.phase !== "launch"
    || receipt.authorizationDigest !== authorizationDigest
    || !/^sha256:[a-f0-9]{64}$/u.test(receipt.handoffDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/u.test(receipt.initialTerminalDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/u.test(receipt.parentSessionIdentityDigest ?? "")
    || receipt.phaseDigest !== digestValue(withoutKey(receipt, "phaseDigest"))) {
    fail("launch phase receipt is malformed or drifted", "BACKGROUND_RUNNER_RECORD_INVALID");
  }
  return receipt;
}

function terminateProcessTree(child) {
  if (process.platform !== "win32" && Number.isSafeInteger(child?.pid) && child.pid > 1) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to the direct child when no process group is available.
    }
  }
  child?.kill?.("SIGTERM");
}

async function defaultVersionProbe(command, { cwd, env, timeoutMs }) {
  const result = await execFile(command, ["--version"], {
    cwd,
    env,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024,
    windowsHide: true,
  });
  return result.stdout.trim();
}

function safeEnvironment({ directories, authorization, hostEnvironment, requestFile }) {
  const credentials = {};
  for (const name of authorization.provider.credentialEnvironment) {
    const value = hostEnvironment[name];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      fail(`required credential environment is unavailable: ${name}`, "BACKGROUND_RUNNER_CREDENTIAL_UNAVAILABLE", { name });
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
    PI_SUBAGENT_MAX_DEPTH: "1",
    PI_SUBAGENT_MAX_SPAWNS_PER_SESSION: "2",
    PI_SUBAGENT_WAIT_TOOL_ENABLED: "false",
    NO_COLOR: "1",
    TERM: "dumb",
    [SUBAGENTS_BACKGROUND_RESUME_REQUEST_ENV]: requestFile,
    ...credentials,
  };
}

async function validatePersistedParentSession(configRoot, sessionDir, sessionId) {
  await assertSafeContainedPath(configRoot, sessionDir, { leafType: "directory" });
  const entries = await fs.readdir(sessionDir, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(`_${sessionId}.jsonl`)) continue;
    const file = path.join(sessionDir, entry.name);
    await assertSafeContainedPath(configRoot, file, { leafType: "file" });
    const stat = await fs.lstat(file);
    if (stat.size < 2 || stat.size > 16 * 1024 * 1024) fail("parent session file is outside its size bound", "BACKGROUND_RUNNER_SESSION_INVALID");
    const firstLine = (await fs.readFile(file, "utf8")).split("\n", 1)[0];
    let header;
    try { header = JSON.parse(firstLine); } catch { continue; }
    if (header?.type === "session" && header.id === sessionId) matches.push(file);
  }
  if (matches.length !== 1) fail("parent session did not persist uniquely", "BACKGROUND_RUNNER_SESSION_INVALID");
  return matches[0];
}

function runPiPhase({
  phase,
  piCommand,
  argv,
  cwd,
  env,
  spawnImpl,
  timeoutMs,
  maximumOutputBytes,
}) {
  return new Promise((resolve, reject) => {
    const stdout = { parts: [], bytes: 0, truncated: false };
    const stderr = { parts: [], bytes: 0, truncated: false };
    const aggregate = { bytes: 0, truncated: false };
    const outputLimit = Math.min(MAX_PROCESS_OUTPUT_BYTES, maximumOutputBytes);
    let child;
    let timer;
    let settled = false;
    let recordObserved = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const observe = () => {
      const records = [
        ...parseRecords(Buffer.concat(stdout.parts).toString("utf8")),
        ...parseRecords(Buffer.concat(stderr.parts).toString("utf8")),
      ];
      if (records.length > 1) {
        terminateProcessTree(child);
        finish(() => reject(new PiBackgroundResumeRunnerError("multiple phase records were emitted", "BACKGROUND_RUNNER_RECORD_AMBIGUOUS")));
      } else if (records.length === 1 && !recordObserved) {
        recordObserved = true;
        child?.stdin?.end?.();
      }
    };
    try {
      child = spawnImpl(piCommand, argv, {
        cwd,
        env,
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      fail("Pi subprocess could not start", "BACKGROUND_RUNNER_START_FAILED");
    }
    child.stdout?.on?.("data", (chunk) => { boundedAppend(stdout, aggregate, chunk, outputLimit); observe(); });
    child.stderr?.on?.("data", (chunk) => { boundedAppend(stderr, aggregate, chunk, outputLimit); observe(); });
    child.stdin?.on?.("error", () => {});
    child.on?.("error", () => finish(() => reject(new PiBackgroundResumeRunnerError("Pi subprocess failed", "BACKGROUND_RUNNER_PROCESS_ERROR"))));
    child.on?.("exit", (code, signal) => finish(() => {
      if (code !== 0 || signal !== null || aggregate.truncated) {
        reject(new PiBackgroundResumeRunnerError("Pi phase exited unsuccessfully", "BACKGROUND_RUNNER_FAILED", {
          phase,
          exitCode: code,
          signal: signal ?? null,
          outputTruncated: aggregate.truncated,
        }));
        return;
      }
      const records = [
        ...parseRecords(Buffer.concat(stdout.parts).toString("utf8")),
        ...parseRecords(Buffer.concat(stderr.parts).toString("utf8")),
      ];
      if (records.length !== 1) {
        reject(new PiBackgroundResumeRunnerError("Pi emitted no unique phase record", "BACKGROUND_RUNNER_RECORD_MISSING"));
      } else if (records[0].type === SUBAGENTS_BACKGROUND_RESUME_ERROR_TYPE) {
        reject(new PiBackgroundResumeRunnerError("Pi extension rejected the phase", records[0].code));
      } else if (phase === "launch" && records[0].type !== SUBAGENTS_BACKGROUND_RESUME_PHASE_TYPE) {
        reject(new PiBackgroundResumeRunnerError("launch phase emitted the wrong record type", "BACKGROUND_RUNNER_RECORD_INVALID"));
      } else if (phase === "resume" && records[0].type !== SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE) {
        reject(new PiBackgroundResumeRunnerError("resume phase emitted the wrong record type", "BACKGROUND_RUNNER_RECORD_INVALID"));
      } else {
        resolve(records[0]);
      }
    }));
    timer = setTimeout(() => {
      terminateProcessTree(child);
      finish(() => reject(new PiBackgroundResumeRunnerError("Pi phase timed out", "BACKGROUND_RUNNER_TIMEOUT", { phase })));
    }, timeoutMs);
    timer.unref?.();
  });
}

export function createPiBackgroundResumeScenarioRunner({
  configRoot,
  packageRoot,
  modelsFile,
  repositoryRoot,
  piCommand = "pi",
  spawnImpl = spawn,
  versionProbe = defaultVersionProbe,
  hostEnvironment = process.env,
  homedir = os.homedir,
  nonceFactory = () => sha256(crypto.randomUUID()),
  clock = () => Date.now(),
  expectedPiVersion = PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
  expectedArtifact = PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
} = {}) {
  if (typeof piCommand !== "string" || piCommand.length === 0 || /[\0\r\n]/u.test(piCommand)) {
    throw new TypeError("piCommand must be a bounded executable name or path");
  }
  for (const dependency of [spawnImpl, versionProbe, nonceFactory, clock]) {
    if (typeof dependency !== "function") throw new TypeError("runner dependencies must be functions");
  }
  const providerDescriptor = loadLiveEvidenceProviderDescriptor(modelsFile);
  let used = false;
  return async function runBackgroundResume({ id, authorization, expectedSourceCommit, environment, scenarioLimits } = {}) {
    if (used) fail("background resume runner is one-shot", "BACKGROUND_RUNNER_REUSED");
    used = true;
    if (id !== "background-resume" || !exactScenarioLimits(scenarioLimits, authorization?.limits)) {
      fail("scenario differs from its exact authorization", "BACKGROUND_RUNNER_SCENARIO_INVALID");
    }
    const resolvedConfigRoot = await realDirectory(configRoot, "configRoot");
    if ((await fs.readdir(resolvedConfigRoot)).length !== 0) fail("configRoot must be empty", "BACKGROUND_RUNNER_CONFIG_ROOT_NOT_EMPTY");
    const resolvedRepositoryRoot = await realDirectory(repositoryRoot, "repositoryRoot");
    const resolvedHome = path.resolve(homedir());
    if (inside(path.join(resolvedHome, ".pi"), resolvedConfigRoot)) {
      fail("background evidence cannot use the real Pi home", "BACKGROUND_RUNNER_REAL_PI_HOME_FORBIDDEN");
    }
    const audited = await inspectAuditedPiSubagentsPackage({ packageRoot, expected: expectedArtifact });
    const piModels = compileLiveEvidencePiModels(providerDescriptor, { authorization });
    const actualEnvironment = {
      node: process.versions.node,
      pi: expectedPiVersion,
      backend: `${audited.package}@${audited.version}`,
      platform: `${process.platform}-${process.arch}`,
    };
    if (!exactRuntimeEnvironment(environment, actualEnvironment)) {
      fail("host runtime differs from the authorized compatibility row", "BACKGROUND_RUNNER_ENVIRONMENT_MISMATCH");
    }
    const reviewerResource = await governedReviewerResource(resolvedRepositoryRoot);
    const extension = fileURLToPath(new URL("./background-resume-extension.mjs", import.meta.url));
    const extensionStat = await fs.lstat(extension).catch(() => null);
    if (!extensionStat?.isFile() || extensionStat.isSymbolicLink()) fail("background extension unavailable", "BACKGROUND_RUNNER_EXTENSION_UNAVAILABLE");

    const runtimeRoot = path.join(resolvedConfigRoot, "only-my-pi", "subagents-background-resume", authorization.authorizationId);
    const directories = {
      runtimeRoot,
      agentRoot: path.join(runtimeRoot, "agent"),
      agentDefinitions: path.join(runtimeRoot, "agent", "agents"),
      subagentConfig: path.join(runtimeRoot, "agent", "extensions", "subagent"),
      workspace: path.join(runtimeRoot, "workspace"),
      sessionDir: path.join(runtimeRoot, "agent", "sessions"),
      handoffDir: path.join(runtimeRoot, "agent", "background-resume"),
      home: path.join(runtimeRoot, "home"),
      tmp: path.join(runtimeRoot, "tmp"),
      xdgCache: path.join(runtimeRoot, "xdg-cache"),
      xdgConfig: path.join(runtimeRoot, "xdg-config"),
      xdgData: path.join(runtimeRoot, "xdg-data"),
    };
    for (const directory of [
      path.join(resolvedConfigRoot, "only-my-pi"),
      path.join(resolvedConfigRoot, "only-my-pi", "subagents-background-resume"),
      ...Object.values(directories),
    ]) await containedDirectory(resolvedConfigRoot, directory);
    await writeContainedFile(resolvedConfigRoot, path.join(directories.agentDefinitions, "omp-reviewer.md"), reviewerResource, 0o600);
    await writeContainedFile(
      resolvedConfigRoot,
      path.join(directories.agentRoot, "models.json"),
      `${JSON.stringify(piModels, null, 2)}\n`,
      0o600,
    );
    await writeContainedFile(
      resolvedConfigRoot,
      path.join(directories.subagentConfig, "config.json"),
      `${JSON.stringify({ artifactDir: "session" }, null, 2)}\n`,
      0o600,
    );
    await writeContainedFile(resolvedConfigRoot, path.join(directories.workspace, "package.json"), WORKSPACE_PACKAGE, 0o400);
    await writeContainedFile(resolvedConfigRoot, path.join(directories.workspace, "README.md"), WORKSPACE_README, 0o400);
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

    const parentSessionId = `omp-bg-${authorization.authorizationDigest.slice(7, 31)}`;
    const handoffFile = path.join(directories.handoffDir, "handoff.json");
    const requestFiles = {
      launch: path.join(directories.agentRoot, "background-resume-launch.json"),
      resume: path.join(directories.agentRoot, "background-resume-resume.json"),
    };
    const nonces = { launch: nonceFactory("launch"), resume: nonceFactory("resume") };
    if (!/^sha256:[a-f0-9]{64}$/u.test(nonces.launch ?? "")
      || !/^sha256:[a-f0-9]{64}$/u.test(nonces.resume ?? "")
      || nonces.launch === nonces.resume) {
      fail("process nonces must be unique sha256 values", "BACKGROUND_RUNNER_NONCE_INVALID");
    }
    const writeRequest = async (phase, expectedHandoffDigest) => {
      const request = {
        id: "background-resume",
        phase,
        processNonce: nonces[phase],
        expectedHandoffDigest,
        parentSessionId,
        sessionDir: directories.sessionDir,
        handoffFile,
        authorizationDigest: authorization.authorizationDigest,
        sourceCommit: expectedSourceCommit,
        matrixDigest: authorization.matrixDigest,
        policyDigest: authorization.policyDigest,
        trustPolicyDigest: authorization.trustPolicyDigest,
        compatibilityRowId: authorization.compatibilityRowId,
        environment: actualEnvironment,
        limits: scenarioLimits,
        repositoryRoot: resolvedRepositoryRoot,
        workspaceRoot: directories.workspace,
      };
      await writeContainedFile(resolvedConfigRoot, requestFiles[phase], `${JSON.stringify(request, null, 2)}\n`, 0o600);
    };
    await writeRequest("launch", null);
    const probeEnv = safeEnvironment({
      directories,
      authorization,
      hostEnvironment,
      requestFile: requestFiles.launch,
    });
    let piVersion;
    try {
      piVersion = await versionProbe(piCommand, {
        cwd: directories.workspace,
        env: probeEnv,
        timeoutMs: Math.min(60_000, scenarioLimits.maxWallTimeMs),
      });
    } catch {
      fail("Pi version probe failed", "BACKGROUND_RUNNER_PI_VERSION_FAILED");
    }
    if (piVersion !== expectedPiVersion) fail("Pi version differs from authorization", "BACKGROUND_RUNNER_PI_VERSION_MISMATCH");
    const argv = [
      "--mode", "rpc",
      "--provider", authorization.provider.id,
      "--model", authorization.provider.model,
      "--session-id", parentSessionId,
      "--session-dir", directories.sessionDir,
      "--no-context-files",
      "--no-skills",
      "--no-builtin-tools",
      "--no-approve",
    ];
    const operationStartedAt = clock();
    const launch = await runPiPhase({
      phase: "launch",
      piCommand,
      argv,
      cwd: directories.workspace,
      env: safeEnvironment({ directories, authorization, hostEnvironment, requestFile: requestFiles.launch }),
      spawnImpl,
      timeoutMs: scenarioLimits.maxWallTimeMs,
      maximumOutputBytes: scenarioLimits.maxOutputBytes,
    });
    validateLaunchPhaseReceipt(launch, authorization.authorizationDigest);
    const parentSessionFile = await validatePersistedParentSession(resolvedConfigRoot, directories.sessionDir, parentSessionId);
    await assertSafeContainedPath(resolvedConfigRoot, handoffFile, { leafType: "file" });
    const handoffStat = await fs.lstat(handoffFile);
    if (!handoffStat.isFile() || handoffStat.isSymbolicLink()
      || (handoffStat.mode & 0o077) !== 0
      || handoffStat.size < 2 || handoffStat.size > 256 * 1024) {
      fail("phase handoff is not a bounded regular file", "BACKGROUND_RUNNER_HANDOFF_INVALID");
    }
    let handoff;
    try { handoff = JSON.parse(await fs.readFile(handoffFile, "utf8")); } catch {
      fail("phase handoff is invalid JSON", "BACKGROUND_RUNNER_HANDOFF_INVALID");
    }
    const handoffKeys = ["context", "formatVersion", "handle", "handoffDigest", "initial", "status", "type", "usage"];
    if (handoff === null || typeof handoff !== "object" || Array.isArray(handoff)
      || JSON.stringify(Object.keys(handoff).sort()) !== JSON.stringify(handoffKeys)
      || handoff.formatVersion !== 1
      || handoff.type !== SUBAGENTS_BACKGROUND_RESUME_HANDOFF_TYPE
      || handoff.status !== "READY_FOR_RESUME"
      || sha256(withoutKey(handoff, "handoffDigest")) !== launch.handoffDigest
      || handoff.handoffDigest !== launch.handoffDigest) {
      fail("phase handoff differs from the launch receipt", "BACKGROUND_RUNNER_HANDOFF_INVALID");
    }
    await writeRequest("resume", launch.handoffDigest);
    const elapsed = Math.max(0, clock() - operationStartedAt);
    const remaining = scenarioLimits.maxWallTimeMs - elapsed;
    if (remaining < 1) fail("launch consumed the total wall-time authorization", "BACKGROUND_RUNNER_TIMEOUT");
    const record = await runPiPhase({
      phase: "resume",
      piCommand,
      argv,
      cwd: directories.workspace,
      env: safeEnvironment({ directories, authorization, hostEnvironment, requestFile: requestFiles.resume }),
      spawnImpl,
      timeoutMs: remaining,
      maximumOutputBytes: scenarioLimits.maxOutputBytes,
    });
    const parentSessionAfter = await validatePersistedParentSession(resolvedConfigRoot, directories.sessionDir, parentSessionId);
    if (parentSessionAfter !== parentSessionFile) fail("parent session path changed across processes", "BACKGROUND_RUNNER_SESSION_DRIFT");
    return record;
  };
}
