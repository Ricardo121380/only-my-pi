import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  assertSafeContainedPath,
  ensureConfigDirectory,
  relativeConfigPath,
  saveSettings,
} from "../config-runtime/index.mjs";

const MAX_CAPTURE_BYTES = 256 * 1024;
const REQUEST_ID = "omp-no-model-smoke-v1";
const COMMANDS_REQUEST_ID = "omp-extension-commands-smoke-v1";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function boundedAppend(state, chunk) {
  if (state.bytes >= MAX_CAPTURE_BYTES) {
    state.truncated = true;
    return;
  }
  const input = Buffer.from(chunk);
  const remaining = MAX_CAPTURE_BYTES - state.bytes;
  state.parts.push(input.subarray(0, remaining));
  state.bytes += Math.min(input.length, remaining);
  if (input.length > remaining) state.truncated = true;
}

function captured(state) {
  return Buffer.concat(state.parts).toString("utf8");
}

function digestText(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function assertContained(root, target) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("SMOKE_SETTINGS_PATH_ESCAPE", "managed smoke path escapes configRoot");
  }
}

function absoluteManagedPath(configRoot, value) {
  if (typeof value !== "string" || !value.startsWith("./") || /[\0\r\n]/u.test(value)) {
    fail("SMOKE_SETTINGS_INVALID", "managed smoke resources must be relative local paths");
  }
  const target = path.resolve(configRoot, value);
  assertContained(configRoot, target);
  return target;
}

function compileSmokeSettings(configRoot, settings) {
  const managed = settings?.onlyMyPi?.managedSettings;
  if (managed === undefined) {
    return {
      defaultProjectTrust: "never",
      enableInstallTelemetry: false,
      enableAnalytics: false,
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    };
  }
  if (managed === null || typeof managed !== "object" || Array.isArray(managed)) {
    fail("SMOKE_SETTINGS_INVALID", "managed smoke settings are malformed");
  }
  const output = {};
  for (const field of ["packages", "extensions", "skills", "prompts", "themes"]) {
    if (!Array.isArray(managed[field])) fail("SMOKE_SETTINGS_INVALID", `managed ${field} must be an array`);
    output[field] = managed[field].map((entry) => {
      if (typeof entry === "string") return absoluteManagedPath(configRoot, entry);
      if (field !== "packages" || entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        fail("SMOKE_SETTINGS_INVALID", `managed ${field} contains an unsupported entry`);
      }
      const keys = Object.keys(entry).sort();
      const allowed = ["extensions", "prompts", "skills", "source", "themes"].sort();
      if (JSON.stringify(keys) !== JSON.stringify(allowed)) {
        fail("SMOKE_SETTINGS_INVALID", "managed package filter contains unknown fields");
      }
      for (const filter of ["extensions", "skills", "prompts", "themes"]) {
        if (!Array.isArray(entry[filter]) || entry[filter].some((value) => typeof value !== "string" || /[\0\r\n]/u.test(value))) {
          fail("SMOKE_SETTINGS_INVALID", `managed package ${filter} filter is invalid`);
        }
      }
      return {
        source: absoluteManagedPath(configRoot, entry.source),
        extensions: [...entry.extensions],
        skills: [...entry.skills],
        prompts: [...entry.prompts],
        themes: [...entry.themes],
      };
    });
  }
  return {
    defaultProjectTrust: "never",
    enableInstallTelemetry: false,
    enableAnalytics: false,
    ...output,
  };
}

function expectedManagedCommands(settings) {
  const extensions = settings?.onlyMyPi?.managedSettings?.extensions;
  if (!Array.isArray(extensions)) return [];
  const expected = new Set();
  for (const entry of extensions) {
    if (typeof entry !== "string") continue;
    const normalized = entry.replaceAll("\\", "/").replace(/\/$/u, "");
    if (/\/(?:resources\/)?extensions\/context-doctor(?:\/index\.(?:ts|js))?$/u.test(normalized)) {
      // The compatibility alias is owned by omp-control, not context-doctor.
      expected.add("omp-context");
    }
    if (/\/(?:resources\/)?extensions\/omp-control(?:\/index\.(?:ts|js))?$/u.test(normalized)) {
      expected.add("omp");
      expected.add("omp-context");
    }
  }
  return [...expected].sort();
}

function safeEnvironment(configRoot, smokeAgentRoot) {
  const runtimeRoot = path.dirname(smokeAgentRoot);
  const directories = Object.freeze({
    runtimeRoot,
    smokeAgentRoot,
    home: path.join(runtimeRoot, "home"),
    tmp: path.join(runtimeRoot, "tmp"),
    xdgCache: path.join(runtimeRoot, "xdg-cache"),
    xdgConfig: path.join(runtimeRoot, "xdg-config"),
    xdgData: path.join(runtimeRoot, "xdg-data"),
  });
  return {
    directories,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: directories.home,
      TMPDIR: directories.tmp,
      XDG_CACHE_HOME: directories.xdgCache,
      XDG_CONFIG_HOME: directories.xdgConfig,
      XDG_DATA_HOME: directories.xdgData,
      PI_CODING_AGENT_DIR: smokeAgentRoot,
      PI_OFFLINE: "1",
      NO_COLOR: "1",
      TERM: "dumb",
    },
  };
}

async function ensureContainedDirectory(configRoot, target) {
  const relative = relativeConfigPath(configRoot, target);
  await ensureConfigDirectory(configRoot, relative, 0o700);
  await assertSafeContainedPath(configRoot, target, { leafType: "directory" });
}

async function prepareSmokeRuntime(configRoot, directories) {
  const ordered = [
    path.join(configRoot, "only-my-pi"),
    directories.runtimeRoot,
    directories.smokeAgentRoot,
    directories.home,
    directories.tmp,
    directories.xdgCache,
    directories.xdgConfig,
    directories.xdgData,
  ];
  for (const directory of ordered) await ensureContainedDirectory(configRoot, directory);
  for (const directory of ordered) {
    await assertSafeContainedPath(configRoot, directory, { leafType: "directory" });
  }
}

function parseResponse(stdout, requestId, command) {
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line);
    } catch {
      continue;
    }
    if (record?.type === "response" && record.id === requestId && record.command === command) {
      return record;
    }
  }
  return null;
}

/**
 * Starts Pi in RPC mode against an isolated config root, asks only for local
 * session state and the command registry needed to prove first-party extension
 * registration, then closes stdin. The configured credential root and
 * environment are isolated, and this runner submits no prompt. Loaded
 * extension code still has the invoking OS user's filesystem/network
 * authority, so this is not a Provider-inactivity, credential-isolation,
 * network-isolation, or sandbox claim.
 */
export function createNoModelSmokeRunner({
  piCommand = "pi",
  spawnImpl = spawn,
  timeoutMs = 15_000,
} = {}) {
  if (typeof piCommand !== "string" || piCommand.length === 0 || /[\0\r\n]/u.test(piCommand)) {
    throw new TypeError("piCommand must be a bounded executable name or path");
  }
  if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new TypeError("timeoutMs must be between 100 and 120000 milliseconds");
  }

  return async function runNoModelSmoke({ configRoot, settings = {} } = {}) {
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) {
      fail("INVALID_CONFIG_ROOT", "no-model smoke requires an explicit absolute configRoot");
    }
    const resolvedRoot = path.resolve(configRoot);
    if (resolvedRoot === path.parse(resolvedRoot).root) {
      fail("INVALID_CONFIG_ROOT", "no-model smoke refuses a filesystem root as configRoot");
    }
    const smokeAgentRoot = path.join(resolvedRoot, "only-my-pi", "smoke-runtime", "agent");
    const { directories, env } = safeEnvironment(resolvedRoot, smokeAgentRoot);
    const expectedCommands = expectedManagedCommands(settings);
    await prepareSmokeRuntime(resolvedRoot, directories);
    await saveSettings(smokeAgentRoot, compileSmokeSettings(resolvedRoot, settings));
    for (const directory of Object.values(directories)) {
      await assertSafeContainedPath(resolvedRoot, directory, { leafType: "directory" });
    }
    await assertSafeContainedPath(resolvedRoot, path.join(smokeAgentRoot, "settings.json"), { leafType: "file" });

    const argv = [
      "--mode", "rpc",
      "--offline",
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-tools",
      "--no-approve",
    ];
    const stdoutState = { parts: [], bytes: 0, truncated: false };
    const stderrState = { parts: [], bytes: 0, truncated: false };
    const startedAt = Date.now();

    return await new Promise((resolve, reject) => {
      let settled = false;
      let stateResponse = null;
      let commandsResponse = expectedCommands.length === 0
        ? { success: true, data: { commands: [] } }
        : null;
      let child;
      const settleError = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const settleExit = (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const stdout = captured(stdoutState);
        const stderr = captured(stderrState);
        stateResponse ??= parseResponse(stdout, REQUEST_ID, "get_state");
        commandsResponse ??= parseResponse(stdout, COMMANDS_REQUEST_ID, "get_commands");
        if (!stateResponse?.success) {
          const code = exitCode === 0 ? "PI_RPC_STATE_UNAVAILABLE" : "PI_NO_MODEL_SMOKE_FAILED";
          const error = new Error("Pi exited before a successful no-model RPC state response");
          error.code = code;
          error.exitCode = exitCode;
          error.signal = signal ?? null;
          error.stdoutDigest = digestText(stdout);
          error.stderrDigest = digestText(stderr);
          error.outputTruncated = stdoutState.truncated || stderrState.truncated;
          reject(error);
          return;
        }
        const commandNames = new Set(
          Array.isArray(commandsResponse?.data?.commands)
            ? commandsResponse.data.commands.map((command) => command?.name).filter((name) => typeof name === "string")
            : [],
        );
        const missingCommands = expectedCommands.filter((command) => !commandNames.has(command));
        if (!commandsResponse?.success || missingCommands.length > 0) {
          const error = new Error("Pi started but required first-party extension commands were not registered");
          error.code = "PI_EXTENSION_REGISTRATION_UNVERIFIED";
          error.exitCode = exitCode;
          error.signal = signal ?? null;
          error.expectedCommands = expectedCommands;
          error.missingCommands = missingCommands;
          error.stdoutDigest = digestText(stdout);
          error.stderrDigest = digestText(stderr);
          error.outputTruncated = stdoutState.truncated || stderrState.truncated;
          reject(error);
          return;
        }
        resolve(Object.freeze({
          ok: true,
          status: "NO_MODEL_STARTUP_PASS",
          boundary: "PI_RPC_CONFIG_AND_EXTENSION_STARTUP",
          promptSubmitted: false,
          configuredCredentialRoot: "ISOLATED_EMPTY",
          hostFilesystemIsolation: "NOT_ENFORCED",
          extensionNetworkIsolation: "NOT_ENFORCED",
          sessionPersistenceEnabled: false,
          offlinePiMaintenance: true,
          modelConfigured: stateResponse.data?.model != null,
          extensionRegistrationVerified: expectedCommands.length > 0,
          verifiedCommandCount: expectedCommands.length,
          exitCode: exitCode ?? 0,
          signal: signal ?? null,
          durationMs: Math.max(0, Date.now() - startedAt),
          stdoutDigest: digestText(stdout),
          stderrDigest: digestText(stderr),
          outputTruncated: stdoutState.truncated || stderrState.truncated,
        }));
      };

      let timer;
      try {
        child = spawnImpl(piCommand, argv, {
          cwd: smokeAgentRoot,
          env,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (cause) {
        const error = new Error("Pi no-model smoke subprocess could not start", { cause });
        error.code = "PI_SUBPROCESS_START_FAILED";
        reject(error);
        return;
      }
      timer = setTimeout(() => {
        child.kill?.("SIGTERM");
        const error = new Error("Pi no-model smoke timed out");
        error.code = "PI_NO_MODEL_SMOKE_TIMEOUT";
        settleError(error);
      }, timeoutMs);
      timer.unref?.();

      child.stdout?.on("data", (chunk) => {
        boundedAppend(stdoutState, chunk);
        const stdout = captured(stdoutState);
        stateResponse ??= parseResponse(stdout, REQUEST_ID, "get_state");
        commandsResponse ??= parseResponse(stdout, COMMANDS_REQUEST_ID, "get_commands");
        if (stateResponse?.success && commandsResponse?.success) {
          child.stdin?.end();
        }
      });
      child.stderr?.on("data", (chunk) => boundedAppend(stderrState, chunk));
      child.once?.("error", (cause) => {
        const error = new Error("Pi no-model smoke subprocess could not start", { cause });
        error.code = "PI_SUBPROCESS_START_FAILED";
        settleError(error);
      });
      child.once?.("exit", settleExit);
      child.stdin?.write(`${JSON.stringify({ id: REQUEST_ID, type: "get_state" })}\n`);
      if (expectedCommands.length > 0) {
        child.stdin?.write(`${JSON.stringify({ id: COMMANDS_REQUEST_ID, type: "get_commands" })}\n`);
      }
    });
  };
}

export const NO_MODEL_SMOKE_REQUEST_ID = REQUEST_ID;
export const NO_MODEL_SMOKE_COMMANDS_REQUEST_ID = COMMANDS_REQUEST_ID;
