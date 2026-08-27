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
import {
  compileAgentResource,
  createAgentRegistry,
} from "../../agent-registry/index.mjs";
import {
  inspectAuditedPiSubagentsPackage,
  PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
  PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
} from "../live-probe.mjs";
import {
  SUBAGENTS_LIVE_EVIDENCE_SCENARIO_SHAPES,
} from "./live-evidence-authorization.mjs";
import {
  SUBAGENTS_LIVE_CAPTURE_ERROR_TYPE,
  SUBAGENTS_LIVE_CAPTURE_REQUEST_ENV,
} from "./live-evidence-extension.mjs";
import { SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE } from "./live-evidence-capture.mjs";
import {
  compileLiveEvidencePiModels,
  loadLiveEvidenceProviderDescriptor,
} from "./live-evidence-provider.mjs";

const execFile = promisify(execFileCallback);
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_AGENT_RESOURCE_BYTES = 128 * 1024;
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const REVIEWER_TOOLS = Object.freeze(["find", "grep", "ls", "read"]);
const WORKSPACE_PACKAGE = `${JSON.stringify({
  name: "only-my-pi-live-evidence-fixture",
  private: true,
  version: "0.0.0",
}, null, 2)}\n`;
const WORKSPACE_README = "# only-my-pi live evidence fixture\n\nRead-only synthetic files for bounded Agent and BatchSwarm Alpha evidence.\n";

export class PiProtectedLiveEvidenceRunnerError extends Error {
  constructor(message, code, details = {}) {
    super(`Pi protected live evidence runner: ${message}`);
    this.name = "PiProtectedLiveEvidenceRunnerError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new PiProtectedLiveEvidenceRunnerError(message, code, details);
}

async function realDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")
    || path.resolve(value) === path.parse(path.resolve(value)).root) {
    fail(`${label} must be an explicit absolute non-root directory`, "LIVE_RUNNER_PATH_INVALID");
  }
  try {
    const resolved = await fs.realpath(value);
    const stat = await fs.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("not a directory");
    return resolved;
  } catch {
    fail(`${label} must be an existing regular directory`, "LIVE_RUNNER_PATH_INVALID");
  }
}

function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function exactRuntimeEnvironment(expected, actual) {
  const keys = ["backend", "node", "pi", "platform"];
  return expected !== null
    && typeof expected === "object"
    && !Array.isArray(expected)
    && JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(keys)
    && keys.every((key) => expected[key] === actual[key]);
}

function scenarioBudget(authorization, id, candidate) {
  const shape = SUBAGENTS_LIVE_EVIDENCE_SCENARIO_SHAPES[id];
  const keys = ["maxChildren", "maxConcurrency", "maxCostUsd", "maxOutputBytes", "maxTokens", "maxWallTimeMs"];
  if (!shape || candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
    || JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(keys)
    || candidate.maxChildren !== shape.children
    || candidate.maxConcurrency !== shape.concurrency) {
    fail("scenario budget does not match the fixed Alpha shape", "LIVE_RUNNER_SCENARIO_BUDGET_INVALID");
  }
  for (const key of ["maxWallTimeMs", "maxOutputBytes", "maxTokens", "maxCostUsd"]) {
    const value = candidate[key];
    const maximum = authorization.limits[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0
      || (maximum !== null && value > maximum)) {
      fail("scenario budget exceeds its aggregate authorization", "LIVE_RUNNER_SCENARIO_BUDGET_INVALID", { key });
    }
  }
  return Object.freeze({ ...candidate });
}

async function containedDirectory(configRoot, target) {
  await ensureConfigDirectory(configRoot, relativeConfigPath(configRoot, target), 0o700);
  await assertSafeContainedPath(configRoot, target, { leafType: "directory" });
}

async function regularContainedFile(root, target, maximumBytes) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!inside(resolvedRoot, resolvedTarget)) fail("agent resource escaped repository root", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  let current = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, resolvedTarget).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(() => null);
    if (!stat || stat.isSymbolicLink()) fail("agent resource is missing or symlinked", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  }
  const stat = await fs.lstat(resolvedTarget);
  if (!stat.isFile() || stat.size < 2 || stat.size > maximumBytes) {
    fail("agent resource is not a bounded regular file", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  }
  if (!inside(await fs.realpath(resolvedRoot), await fs.realpath(resolvedTarget))) {
    fail("agent resource escaped repository root", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  }
  return fs.readFile(resolvedTarget, "utf8");
}

async function governedReviewerResource(repositoryRoot) {
  try {
    const reviewer = await createAgentRegistry({ rootDir: repositoryRoot }).resolve("reviewer");
    const manifest = reviewer.manifest;
    const allow = [...manifest.tools.allow].sort();
    if (manifest.contractStatus !== "runtime-ready"
      || manifest.upstreamAgentId !== "omp-reviewer"
      || manifest.writer !== false
      || JSON.stringify(allow) !== JSON.stringify(REVIEWER_TOOLS)
      || manifest.policyCeiling.workspace !== "read-only"
      || manifest.policyCeiling.mutation !== "none"
      || manifest.policyCeiling.egress.web !== "deny"
      || manifest.policyCeiling.egress.mcp !== "deny") {
      fail("canonical reviewer exceeds the Alpha read-only envelope", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
    }
    const compiled = compileAgentResource(manifest, reviewer.prompt.content);
    if (compiled.name !== manifest.upstreamAgentId || Buffer.byteLength(compiled.content) > MAX_AGENT_RESOURCE_BYTES) {
      fail("compiled reviewer resource is invalid", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
    }
    const checkedIn = await regularContainedFile(
      repositoryRoot,
      path.join(repositoryRoot, "agents", "generated", `${manifest.upstreamAgentId}.md`),
      MAX_AGENT_RESOURCE_BYTES,
    );
    if (checkedIn !== compiled.content) {
      fail("generated reviewer resource drifted from its canonical manifest", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
    }
    return compiled.content;
  } catch (cause) {
    if (cause instanceof PiProtectedLiveEvidenceRunnerError) throw cause;
    fail("canonical reviewer resource could not be validated", "LIVE_RUNNER_AGENT_RESOURCE_UNAVAILABLE");
  }
}

async function writeContainedFile(configRoot, target, contents, mode) {
  await fs.writeFile(target, contents, { flag: "wx", mode });
  await assertSafeContainedPath(configRoot, target, { leafType: "file" });
}

function boundedAppend(state, chunk, maximum) {
  const input = Buffer.from(chunk);
  const remaining = maximum - state.bytes;
  if (remaining <= 0) {
    state.truncated = true;
    return;
  }
  state.parts.push(input.subarray(0, remaining));
  state.bytes += Math.min(remaining, input.length);
  if (input.length > remaining) state.truncated = true;
}

function outputText(state) {
  return Buffer.concat(state.parts).toString("utf8");
}

function terminateProcessTree(child) {
  if (process.platform !== "win32" && Number.isSafeInteger(child?.pid) && child.pid > 1) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to the direct child handle when a process group is unavailable.
    }
  }
  child?.kill?.("SIGTERM");
}

function parseCaptureRecords(text) {
  const records = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value?.type === SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE
      || value?.type === SUBAGENTS_LIVE_CAPTURE_ERROR_TYPE) records.push(value);
  }
  return records;
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
  const credentialEnvironment = {};
  for (const name of authorization.provider.credentialEnvironment) {
    const value = hostEnvironment[name];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      fail(`required credential environment is unavailable: ${name}`, "LIVE_RUNNER_CREDENTIAL_UNAVAILABLE", { name });
    }
    credentialEnvironment[name] = value;
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
    PI_SUBAGENT_MAX_SPAWNS_PER_SESSION: String(authorization.limits.maxChildren),
    PI_SUBAGENT_WAIT_TOOL_ENABLED: "false",
    NO_COLOR: "1",
    TERM: "dumb",
    [SUBAGENTS_LIVE_CAPTURE_REQUEST_ENV]: requestFile,
    ...credentialEnvironment,
  };
}

export function createPiProtectedLiveScenarioRunner({
  configRoot,
  packageRoot,
  modelsFile,
  repositoryRoot,
  piCommand = "pi",
  spawnImpl = spawn,
  versionProbe = defaultVersionProbe,
  hostEnvironment = process.env,
  homedir = os.homedir,
  expectedPiVersion = PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
  expectedArtifact = PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
} = {}) {
  if (typeof piCommand !== "string" || piCommand.length === 0 || /[\0\r\n]/u.test(piCommand)) {
    throw new TypeError("piCommand must be a bounded executable name or path");
  }
  if (typeof spawnImpl !== "function" || typeof versionProbe !== "function") throw new TypeError("live runner dependencies must be functions");
  const providerDescriptor = loadLiveEvidenceProviderDescriptor(modelsFile);
  let initializedConfigRoot = null;

  return async function runPiProtectedLiveScenario({ id, authorization, expectedSourceCommit, environment, scenarioLimits } = {}) {
    if (!SAFE_SEGMENT.test(id ?? "") || !authorization?.evidenceIds?.includes(id)) fail("scenario id was not authorized", "LIVE_RUNNER_SCENARIO_INVALID");
    const limits = scenarioBudget(authorization, id, scenarioLimits);
    const resolvedConfigRoot = await realDirectory(configRoot, "configRoot");
    if (initializedConfigRoot === null) {
      if ((await fs.readdir(resolvedConfigRoot)).length !== 0) {
        fail("configRoot must be an empty disposable directory on first use", "LIVE_RUNNER_CONFIG_ROOT_NOT_EMPTY");
      }
      initializedConfigRoot = resolvedConfigRoot;
    } else if (initializedConfigRoot !== resolvedConfigRoot) {
      fail("configRoot changed after runner initialization", "LIVE_RUNNER_PATH_INVALID");
    }
    const resolvedRepositoryRoot = await realDirectory(repositoryRoot, "repositoryRoot");
    const resolvedHome = path.resolve(homedir());
    if (inside(path.join(resolvedHome, ".pi"), resolvedConfigRoot)) {
      fail("live evidence cannot use the real Pi home", "LIVE_RUNNER_REAL_PI_HOME_FORBIDDEN");
    }
    const audited = await inspectAuditedPiSubagentsPackage({ packageRoot, expected: expectedArtifact });
    const actualEnvironment = {
      node: process.versions.node,
      pi: expectedPiVersion,
      backend: `${audited.package}@${audited.version}`,
      platform: `${process.platform}-${process.arch}`,
    };
    if (!exactRuntimeEnvironment(environment, actualEnvironment)) {
      fail("host runtime differs from the authorized compatibility row", "LIVE_RUNNER_ENVIRONMENT_MISMATCH");
    }
    const reviewerResource = await governedReviewerResource(resolvedRepositoryRoot);
    const piModels = compileLiveEvidencePiModels(providerDescriptor, { authorization });
    const extension = fileURLToPath(new URL("./live-evidence-extension.mjs", import.meta.url));
    const extensionStat = await fs.lstat(extension).catch(() => null);
    if (!extensionStat?.isFile() || extensionStat.isSymbolicLink()) fail("live evidence extension is unavailable", "LIVE_RUNNER_EXTENSION_UNAVAILABLE");

    const runtimeRoot = path.join(resolvedConfigRoot, "only-my-pi", "subagents-live-evidence", authorization.authorizationId, id);
    const directories = {
      runtimeRoot,
      agentRoot: path.join(runtimeRoot, "agent"),
      agentDefinitions: path.join(runtimeRoot, "agent", "agents"),
      subagentConfig: path.join(runtimeRoot, "agent", "extensions", "subagent"),
      workspace: path.join(runtimeRoot, "workspace"),
      home: path.join(runtimeRoot, "home"),
      tmp: path.join(runtimeRoot, "tmp"),
      xdgCache: path.join(runtimeRoot, "xdg-cache"),
      xdgConfig: path.join(runtimeRoot, "xdg-config"),
      xdgData: path.join(runtimeRoot, "xdg-data"),
    };
    for (const directory of [
      path.join(resolvedConfigRoot, "only-my-pi"),
      path.join(resolvedConfigRoot, "only-my-pi", "subagents-live-evidence"),
      path.join(resolvedConfigRoot, "only-my-pi", "subagents-live-evidence", authorization.authorizationId),
      ...Object.values(directories),
    ]) await containedDirectory(resolvedConfigRoot, directory);

    await writeContainedFile(
      resolvedConfigRoot,
      path.join(directories.agentDefinitions, "omp-reviewer.md"),
      reviewerResource,
      0o600,
    );
    await writeContainedFile(
      resolvedConfigRoot,
      path.join(directories.agentRoot, "models.json"),
      `${JSON.stringify(piModels, null, 2)}\n`,
      0o600,
    );
    await writeContainedFile(
      resolvedConfigRoot,
      path.join(directories.subagentConfig, "config.json"),
      `${JSON.stringify({ artifactDir: "temp" }, null, 2)}\n`,
      0o600,
    );
    await writeContainedFile(resolvedConfigRoot, path.join(directories.workspace, "package.json"), WORKSPACE_PACKAGE, 0o400);
    await writeContainedFile(resolvedConfigRoot, path.join(directories.workspace, "README.md"), WORKSPACE_README, 0o400);
    await assertSafeContainedPath(resolvedConfigRoot, directories.workspace, { leafType: "directory" });

    const requestFile = path.join(directories.agentRoot, "capture-request.json");
    const row = authorization.compatibilityRowId;
    const request = {
      id,
      authorizationDigest: authorization.authorizationDigest,
      sourceCommit: expectedSourceCommit,
      matrixDigest: authorization.matrixDigest,
      policyDigest: authorization.policyDigest,
      trustPolicyDigest: authorization.trustPolicyDigest,
      compatibilityRowId: row,
      environment: actualEnvironment,
      limits,
      repositoryRoot: resolvedRepositoryRoot,
    };
    await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await assertSafeContainedPath(resolvedConfigRoot, requestFile, { leafType: "file" });
    const scenarioAuthorization = { ...authorization, limits };
    const env = safeEnvironment({ directories, authorization: scenarioAuthorization, hostEnvironment, requestFile });
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

    let piVersion;
    try {
      piVersion = await versionProbe(piCommand, {
        cwd: directories.workspace,
        env,
        timeoutMs: Math.min(60_000, limits.maxWallTimeMs),
      });
    } catch {
      fail("Pi version probe failed", "LIVE_RUNNER_PI_VERSION_FAILED");
    }
    if (piVersion !== expectedPiVersion) fail("Pi version differs from the authorized runtime", "LIVE_RUNNER_PI_VERSION_MISMATCH");

    const argv = [
      "--mode", "rpc",
      "--provider", authorization.provider.id,
      "--model", authorization.provider.model,
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-builtin-tools",
      "--no-approve",
    ];
    const maximumCaptureBytes = Math.min(MAX_CAPTURE_BYTES, limits.maxOutputBytes);
    const stdout = { parts: [], bytes: 0, truncated: false };
    const stderr = { parts: [], bytes: 0, truncated: false };
    return await new Promise((resolve, reject) => {
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
        const records = [...parseCaptureRecords(outputText(stdout)), ...parseCaptureRecords(outputText(stderr))];
        if (records.length > 1) {
          terminateProcessTree(child);
          finish(() => reject(new PiProtectedLiveEvidenceRunnerError("multiple capture records were emitted", "LIVE_RUNNER_RECORD_AMBIGUOUS")));
          return;
        }
        if (records.length === 1 && !recordObserved) {
          recordObserved = true;
          child?.stdin?.end?.();
        }
      };
      try {
        child = spawnImpl(piCommand, argv, {
          cwd: directories.workspace,
          env,
          detached: process.platform !== "win32",
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        fail("Pi subprocess could not start", "LIVE_RUNNER_START_FAILED");
      }
      child.stdout?.on?.("data", (chunk) => {
        boundedAppend(stdout, chunk, maximumCaptureBytes);
        observe();
      });
      child.stderr?.on?.("data", (chunk) => {
        boundedAppend(stderr, chunk, maximumCaptureBytes);
        observe();
      });
      child.stdin?.on?.("error", () => {});
      child.on?.("error", () => finish(() => reject(new PiProtectedLiveEvidenceRunnerError("Pi subprocess failed", "LIVE_RUNNER_PROCESS_ERROR"))));
      child.on?.("exit", (code, signal) => finish(() => {
        if (code !== 0 || signal !== null || stdout.truncated || stderr.truncated) {
          reject(new PiProtectedLiveEvidenceRunnerError("Pi live scenario exited unsuccessfully", "LIVE_RUNNER_FAILED", {
            exitCode: code,
            signal: signal ?? null,
            outputTruncated: stdout.truncated || stderr.truncated,
          }));
          return;
        }
        const records = [...parseCaptureRecords(outputText(stdout)), ...parseCaptureRecords(outputText(stderr))];
        if (records.length !== 1) {
          reject(new PiProtectedLiveEvidenceRunnerError("Pi emitted no unique capture record", "LIVE_RUNNER_RECORD_MISSING"));
          return;
        }
        if (records[0].type === SUBAGENTS_LIVE_CAPTURE_ERROR_TYPE) {
          reject(new PiProtectedLiveEvidenceRunnerError("Pi extension rejected the live scenario", records[0].code));
          return;
        }
        resolve(records[0]);
      }));
      timer = setTimeout(() => {
        terminateProcessTree(child);
        finish(() => reject(new PiProtectedLiveEvidenceRunnerError("Pi live scenario timed out", "LIVE_RUNNER_TIMEOUT")));
      }, limits.maxWallTimeMs);
      timer.unref?.();
    });
  };
}
