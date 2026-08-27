import crypto from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertSafeContainedPath,
  ensureConfigDirectory,
  relativeConfigPath,
  saveSettings,
} from "../config-runtime/index.mjs";
import {
  assertExactPiSubagentsRpcV1Ping,
  assertPiSubagentsRpcV1Reply,
  resolvePiSubagentsRpcV1Dialect,
} from "./adapters/pi-subagents-rpc-v1/wire.mjs";
import {
  PI_SUBAGENTS_LIVE_PROBE_FIRST_PARTY_ENV,
  PI_SUBAGENTS_LIVE_PROBE_OWNER_ENV,
  PI_SUBAGENTS_LIVE_PROBE_RECORD_TYPE,
  PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID,
} from "./live-probe-extension.mjs";

const execFile = promisify(execFileCallback);
const MAX_CAPTURE_BYTES = 256 * 1024;
const EXPECTED_ACTIVE_TOOLS = Object.freeze(["intercom", "subagent", "subagent_supervisor", "subagent_wait"]);
const CANDIDATE_ACTIVE_TOOLS = Object.freeze(["subagent", "subagent_supervisor", "subagent_wait"]);
const SUBAGENT_COMMAND = /^(?:prompt-workflow|run|subagents?(?:-|$))/u;

export const PI_SUBAGENTS_LIVE_PROBE_ARTIFACT = Object.freeze({
  package: "pi-subagents",
  version: "0.45.2",
  packageJsonSha256: "5ef75c67e2384dc66ccc150ff590d5cea3a09824c40b23b13889e509a8d9bebb",
  rpcSourceSha256: "5c0b683c8e7a59fd5fa730e10039ff8b9e84b465af6202c52405ec5798179a93",
});

export const PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ARTIFACT = Object.freeze({
  package: "pi-subagents",
  version: "0.57.0",
  packageJsonSha256: "aa2d3e8ed9aacf161b03354c65a93f58c977af47152ad23f698b360f65e6018b",
  rpcSourceSha256: "9e25af0a6c8f2657a721f425bf5408798abfaaffb4495a56a0c7d2959669b882",
});

export const PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION = "0.84.1";
export const PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_PI_VERSION = "0.84.3";
export const PI_SUBAGENTS_LIVE_PROBE_ACTIVE_TOOLS = EXPECTED_ACTIVE_TOOLS;
export const PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ACTIVE_TOOLS = CANDIDATE_ACTIVE_TOOLS;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.name = "PiSubagentsLiveProbeError";
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digestValue(value) {
  const input = typeof value === "string" ? value : JSON.stringify(canonical(value));
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

async function digestFile(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

function appendBounded(state, chunk) {
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

function parseProbeRecords(stdout) {
  const records = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line);
    } catch {
      continue;
    }
    if (record?.type === PI_SUBAGENTS_LIVE_PROBE_RECORD_TYPE) records.push(record);
  }
  return records;
}

function relativeContained(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function assertExistingFile(file, code) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch {
    fail(code, "required live-probe source file is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "required live-probe source must be a regular non-symlink file");
}

async function realDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) === path.parse(path.resolve(value)).root) {
    fail("INVALID_PROBE_PATH", `${label} must be an explicit absolute non-root directory`);
  }
  let resolved;
  try {
    resolved = await fs.realpath(value);
    const stat = await fs.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("not a directory");
  } catch {
    fail("INVALID_PROBE_PATH", `${label} must resolve to an existing regular directory`);
  }
  return resolved;
}

export async function inspectAuditedPiSubagentsPackage({
  packageRoot,
  expected = PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
} = {}) {
  const root = await realDirectory(packageRoot, "packageRoot");
  const packageFile = path.join(root, "package.json");
  const rpcSource = path.join(root, "src", "extension", "rpc.ts");
  const extensionEntry = path.join(root, "index.ts");
  await Promise.all([
    assertExistingFile(packageFile, "PI_SUBAGENTS_PACKAGE_INVALID"),
    assertExistingFile(rpcSource, "PI_SUBAGENTS_RPC_SOURCE_INVALID"),
    assertExistingFile(extensionEntry, "PI_SUBAGENTS_EXTENSION_ENTRY_INVALID"),
  ]);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(packageFile, "utf8"));
  } catch {
    fail("PI_SUBAGENTS_PACKAGE_INVALID", "pi-subagents package.json is not valid JSON");
  }
  const packageJsonSha256 = await digestFile(packageFile);
  const rpcSourceSha256 = await digestFile(rpcSource);
  if (manifest?.name !== expected.package || manifest?.version !== expected.version) {
    fail("PI_SUBAGENTS_VERSION_MISMATCH", "pi-subagents identity differs from the audited artifact", {
      expectedVersion: expected.version,
      actualVersion: typeof manifest?.version === "string" ? manifest.version : null,
    });
  }
  if (packageJsonSha256 !== expected.packageJsonSha256 || rpcSourceSha256 !== expected.rpcSourceSha256) {
    fail("PI_SUBAGENTS_SOURCE_DRIFT", "pi-subagents source hashes differ from the audited artifact", {
      packageJsonMatch: packageJsonSha256 === expected.packageJsonSha256,
      rpcSourceMatch: rpcSourceSha256 === expected.rpcSourceSha256,
    });
  }
  return Object.freeze({
    package: manifest.name,
    version: manifest.version,
    packageJsonSha256,
    rpcSourceSha256,
    extensionEntry,
    packageRoot: root,
  });
}

function exactNames(entries) {
  return entries.map((entry) => entry.name).sort();
}

function exactValue(actual, expected) {
  return JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));
}

function assertProbeRecord(record, {
  expectedFirstPartyCommands = [],
  expectedBackendVersion = PI_SUBAGENTS_LIVE_PROBE_ARTIFACT.version,
  expectedActiveTools = EXPECTED_ACTIVE_TOOLS,
} = {}) {
  const dialect = resolvePiSubagentsRpcV1Dialect(expectedBackendVersion);
  if (!isObject(record) || record.formatVersion !== 1 || record.type !== PI_SUBAGENTS_LIVE_PROBE_RECORD_TYPE) {
    fail("PI_SUBAGENTS_PROBE_SHAPE_INVALID", "live probe emitted an unsupported record");
  }
  assertExactPiSubagentsRpcV1Ping(record.ready, { backendVersion: expectedBackendVersion });
  assertPiSubagentsRpcV1Reply(record.reply, PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID);
  assertExactPiSubagentsRpcV1Ping(record.reply, { backendVersion: expectedBackendVersion });
  if (record.sameSession !== true) fail("PI_SUBAGENTS_SESSION_MISMATCH", "ready and ping reply did not originate from one Pi session");
  for (const payload of [record.ready, record.reply.data]) {
    if (payload?.session?.cwdPresent !== true || payload?.session?.sessionIdPresent !== true || payload?.session?.sessionFilePresent !== false) {
      fail("PI_SUBAGENTS_SESSION_BOUNDARY_MISMATCH", "live probe did not remain in an ephemeral no-session Pi context");
    }
  }
  if (!Array.isArray(record.activeTools) || !record.activeTools.every((entry) => isObject(entry))) {
    fail("PI_SUBAGENTS_TOOL_VISIBILITY_INVALID", "live probe tool registry is malformed");
  }
  const toolNames = exactNames(record.activeTools);
  if (JSON.stringify(toolNames) !== JSON.stringify([...expectedActiveTools].sort())) {
    fail("PI_SUBAGENTS_TOOL_SET_DRIFT", "active pi-subagents tool set differs from the audited version", {
      expectedTools: expectedActiveTools,
      actualTools: toolNames,
    });
  }
  const wrongToolOwners = record.activeTools.filter((entry) => entry.owner !== "pi-subagents");
  if (wrongToolOwners.length > 0) {
    fail("PI_SUBAGENTS_TOOL_OWNER_DRIFT", "an active physical subagent tool has a competing owner", {
      tools: wrongToolOwners.map((entry) => entry.name).sort(),
    });
  }
  if (record.activeTools.filter((entry) => entry.name === "subagent").length !== 1) {
    fail("PI_SUBAGENTS_PRIMARY_TOOL_AMBIGUOUS", "the primary subagent tool must have one physical owner");
  }
  if (!Array.isArray(record.commands) || !record.commands.every((entry) => isObject(entry))) {
    fail("PI_SUBAGENTS_COMMAND_VISIBILITY_INVALID", "live probe command registry is malformed");
  }
  const competingCommands = record.commands
    .filter((entry) => SUBAGENT_COMMAND.test(entry.name))
    .filter((entry) => entry.owner !== "pi-subagents");
  if (competingCommands.length > 0) {
    fail("PI_SUBAGENTS_COMMAND_OWNER_DRIFT", "a subagent control command has a competing owner", {
      commands: competingCommands.map((entry) => entry.name).sort(),
    });
  }
  for (const commandName of expectedFirstPartyCommands) {
    const matches = record.commands.filter((entry) => entry.name === commandName && entry.owner === "only-my-pi");
    if (matches.length !== 1) {
      fail("FIRST_PARTY_COMMAND_REGISTRATION_UNVERIFIED", "an expected only-my-pi command was not uniquely registered", {
        command: commandName,
      });
    }
  }
  if (record.activeTools.some((entry) => entry.owner === "only-my-pi")) {
    fail("SECOND_FIRST_PARTY_MODEL_TOOL", "only-my-pi registered a competing model-facing tool");
  }
  const stableHandshake = {
    version: record.ready.version,
    methods: record.ready.methods,
    capabilities: record.ready.capabilities,
    events: record.ready.events,
  };
  return Object.freeze({
    capabilityDigest: digestValue(stableHandshake),
    dialect,
    activeTools: Object.freeze([...toolNames]),
    upstreamCommandCount: record.commands.filter((entry) => entry.owner === "pi-subagents").length,
    firstPartyCommands: Object.freeze(expectedFirstPartyCommands.slice().sort()),
  });
}

export function assertPiSubagentsLiveProbeEvidence(evidence, {
  expectedArtifact = PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
  expectedPiVersion = PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
  expectedActiveTools = EXPECTED_ACTIVE_TOOLS,
  expectedFirstPartyCommands = ["omp", "omp-context"],
} = {}) {
  const dialect = resolvePiSubagentsRpcV1Dialect(expectedArtifact.version);
  if (!isObject(evidence)
    || evidence.formatVersion !== 1
    || evidence.status !== "LIVE_NO_MODEL_CAPABILITY_PASS"
    || evidence.boundary !== "PI_RPC_EXTENSION_CAPABILITY_AND_VISIBILITY") {
    fail("PI_SUBAGENTS_EVIDENCE_SHAPE_INVALID", "live probe evidence uses an unsupported shape or status");
  }
  if (typeof evidence.observedAt !== "string"
    || !Number.isFinite(Date.parse(evidence.observedAt))
    || new Date(evidence.observedAt).toISOString() !== evidence.observedAt) {
    fail("PI_SUBAGENTS_EVIDENCE_TIME_INVALID", "live probe evidence observedAt must be an exact ISO timestamp");
  }
  if (evidence.piVersion !== expectedPiVersion
    || !isObject(evidence.upstream)
    || evidence.upstream.package !== expectedArtifact.package
    || evidence.upstream.version !== expectedArtifact.version
    || evidence.upstream.packageJsonSha256 !== expectedArtifact.packageJsonSha256
    || evidence.upstream.rpcSourceSha256 !== expectedArtifact.rpcSourceSha256) {
    fail("PI_SUBAGENTS_EVIDENCE_ARTIFACT_DRIFT", "live probe evidence is not bound to the audited Pi and package versions");
  }
  if (!isObject(evidence.rpc)
    || evidence.rpc.ready !== "PASS"
    || evidence.rpc.correlatedPing !== "PASS"
    || evidence.rpc.protocolVersion !== 1
    || !exactValue(evidence.rpc.methods, dialect.methods)
    || !exactValue(evidence.rpc.events, dialect.events)
    || !exactValue(evidence.rpc.requiredCapabilities, dialect.capabilities)
    || !/^sha256:[a-f0-9]{64}$/u.test(evidence.rpc.capabilityDigest ?? "")) {
    fail("PI_SUBAGENTS_EVIDENCE_RPC_DRIFT", "live probe evidence RPC contract differs from the audited wire");
  }
  const expectedCapabilityDigest = digestValue({
    version: evidence.rpc.protocolVersion,
    methods: evidence.rpc.methods,
    capabilities: evidence.rpc.requiredCapabilities,
    events: evidence.rpc.events,
  });
  if (evidence.rpc.capabilityDigest !== expectedCapabilityDigest) {
    fail("PI_SUBAGENTS_EVIDENCE_RPC_DRIFT", "live probe evidence capability digest does not match the audited wire");
  }
  if (!isObject(evidence.visibility)
    || !exactValue(evidence.visibility.activeTools, expectedActiveTools)
    || evidence.visibility.primaryTool !== "subagent"
    || evidence.visibility.primaryToolOwner !== "pi-subagents"
    || !exactValue(evidence.visibility.onlyMyPiModelTools, [])
    || !exactValue(evidence.visibility.expectedFirstPartyCommands, [...expectedFirstPartyCommands].sort())
    || !Number.isSafeInteger(evidence.visibility.upstreamCommandCount)
    || evidence.visibility.upstreamCommandCount < 1) {
    fail("PI_SUBAGENTS_EVIDENCE_VISIBILITY_DRIFT", "live probe evidence does not prove one physical model-tool owner");
  }
  const fixed = {
    promptSubmitted: false,
    providerRequest: "NOT_RUN_BY_POLICY",
    childDispatch: "NOT_REQUESTED",
    sessionPersistence: false,
    credentialRoot: "ISOLATED_EMPTY",
    realPiHome: "NOT_TOUCHED",
    hostFilesystemIsolation: "NOT_ENFORCED",
    extensionNetworkIsolation: "NOT_ENFORCED",
    exitCode: 0,
    signal: null,
    outputTruncated: false,
  };
  for (const [key, expected] of Object.entries(fixed)) {
    if (evidence[key] !== expected) fail("PI_SUBAGENTS_EVIDENCE_BOUNDARY_DRIFT", `live probe evidence boundary field differs: ${key}`);
  }
  if (typeof evidence.nodeVersion !== "string"
    || !/^v\d+\.\d+\.\d+$/u.test(evidence.nodeVersion)
    || typeof evidence.platform !== "string"
    || !/^[a-z0-9]+-[a-z0-9_]+$/u.test(evidence.platform)
    || !Number.isSafeInteger(evidence.durationMs)
    || evidence.durationMs < 0
    || !/^sha256:[a-f0-9]{64}$/u.test(evidence.stdoutDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/u.test(evidence.stderrDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/u.test(evidence.evidenceDigest ?? "")) {
    fail("PI_SUBAGENTS_EVIDENCE_METADATA_INVALID", "live probe evidence metadata or digest is invalid");
  }
  const digestInput = structuredClone(evidence);
  delete digestInput.evidenceDigest;
  if (evidence.evidenceDigest !== digestValue(digestInput)) {
    fail("PI_SUBAGENTS_EVIDENCE_TAMPERED", "live probe evidence digest does not match its contents");
  }
  return Object.freeze(structuredClone(evidence));
}

function safeEnvironment({ runtimeRoot, agentRoot, upstreamRoot, firstPartyRoot }) {
  const directories = Object.freeze({
    runtimeRoot,
    agentRoot,
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
      PI_CODING_AGENT_DIR: directories.agentRoot,
      PI_OFFLINE: "1",
      PI_SUBAGENT_WAIT_TOOL_ENABLED: "false",
      NO_COLOR: "1",
      TERM: "dumb",
      [PI_SUBAGENTS_LIVE_PROBE_OWNER_ENV]: upstreamRoot,
      ...(firstPartyRoot ? { [PI_SUBAGENTS_LIVE_PROBE_FIRST_PARTY_ENV]: firstPartyRoot } : {}),
    },
  };
}

async function ensureContainedDirectory(configRoot, target) {
  const relative = relativeConfigPath(configRoot, target);
  await ensureConfigDirectory(configRoot, relative, 0o700);
  await assertSafeContainedPath(configRoot, target, { leafType: "directory" });
}

async function prepareRuntime(configRoot, directories) {
  const ordered = [
    path.join(configRoot, "only-my-pi"),
    directories.runtimeRoot,
    directories.agentRoot,
    directories.home,
    directories.tmp,
    directories.xdgCache,
    directories.xdgConfig,
    directories.xdgData,
  ];
  for (const directory of ordered) await ensureContainedDirectory(configRoot, directory);
  for (const directory of ordered) await assertSafeContainedPath(configRoot, directory, { leafType: "directory" });
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

export function createPiSubagentsNoModelLiveProbe({
  piCommand = "pi",
  spawnImpl = spawn,
  versionProbe = defaultVersionProbe,
  timeoutMs = 15_000,
  expectedPiVersion = PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
  expectedArtifact = PI_SUBAGENTS_LIVE_PROBE_ARTIFACT,
  expectedActiveTools = EXPECTED_ACTIVE_TOOLS,
} = {}) {
  if (typeof piCommand !== "string" || piCommand.length === 0 || /[\0\r\n]/u.test(piCommand)) {
    throw new TypeError("piCommand must be a bounded executable name or path");
  }
  if (typeof spawnImpl !== "function" || typeof versionProbe !== "function") throw new TypeError("live probe runners must be functions");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new TypeError("timeoutMs must be between 100 and 120000 milliseconds");
  }

  return async function runPiSubagentsNoModelLiveProbe({
    configRoot,
    packageRoot,
    firstPartyRoot,
    firstPartyExtensions = [],
    expectedFirstPartyCommands = [],
  } = {}) {
    const resolvedConfigRoot = await realDirectory(configRoot, "configRoot");
    const audited = await inspectAuditedPiSubagentsPackage({ packageRoot, expected: expectedArtifact });
    const resolvedFirstPartyRoot = firstPartyRoot === undefined ? null : await realDirectory(firstPartyRoot, "firstPartyRoot");
    if (!Array.isArray(firstPartyExtensions) || !Array.isArray(expectedFirstPartyCommands)) {
      fail("INVALID_PROBE_INPUT", "first-party extension and command inputs must be arrays");
    }
    const extensionPaths = [];
    for (const value of firstPartyExtensions) {
      if (!resolvedFirstPartyRoot || typeof value !== "string" || !path.isAbsolute(value)) {
        fail("INVALID_FIRST_PARTY_EXTENSION", "first-party extension paths require an explicit root and absolute files");
      }
      const resolved = await fs.realpath(value).catch(() => null);
      if (!resolved || !relativeContained(resolvedFirstPartyRoot, resolved)) {
        fail("INVALID_FIRST_PARTY_EXTENSION", "first-party extension path escapes its declared root");
      }
      await assertExistingFile(resolved, "INVALID_FIRST_PARTY_EXTENSION");
      extensionPaths.push(resolved);
    }
    const uniqueExtensions = [...new Set(extensionPaths)];
    if (uniqueExtensions.length !== extensionPaths.length) fail("INVALID_FIRST_PARTY_EXTENSION", "duplicate first-party extension path");
    const commandSet = new Set(expectedFirstPartyCommands);
    if (commandSet.size !== expectedFirstPartyCommands.length || [...commandSet].some((value) => typeof value !== "string" || !value || /[\0\r\n]/u.test(value))) {
      fail("INVALID_PROBE_INPUT", "expected first-party commands must be unique bounded names");
    }

    const runtimeRoot = path.join(resolvedConfigRoot, "only-my-pi", "subagents-live-probe");
    const agentRoot = path.join(runtimeRoot, "agent");
    const probeExtension = fileURLToPath(new URL("./live-probe-extension.mjs", import.meta.url));
    await assertExistingFile(probeExtension, "LIVE_PROBE_EXTENSION_UNAVAILABLE");
    const { directories, env } = safeEnvironment({
      runtimeRoot,
      agentRoot,
      upstreamRoot: audited.packageRoot,
      firstPartyRoot: resolvedFirstPartyRoot,
    });
    await prepareRuntime(resolvedConfigRoot, directories);
    await saveSettings(agentRoot, {
      defaultProjectTrust: "never",
      enableInstallTelemetry: false,
      enableAnalytics: false,
      packages: [],
      // The observer runs immediately after the upstream extension. All
      // extensions have already registered tools/commands at this point, while
      // a slower first-party session_start handler cannot delay the bounded
      // public ping handshake.
      extensions: [audited.extensionEntry, probeExtension, ...uniqueExtensions],
      skills: [],
      prompts: [],
      themes: [],
    });
    await assertSafeContainedPath(resolvedConfigRoot, path.join(agentRoot, "settings.json"), { leafType: "file" });
    let piVersion;
    try {
      piVersion = await versionProbe(piCommand, { cwd: agentRoot, env, timeoutMs });
    } catch (cause) {
      fail("PI_VERSION_PROBE_FAILED", "Pi version probe failed", { causeName: cause?.name ?? "Error" });
    }
    if (piVersion !== expectedPiVersion) {
      fail("PI_VERSION_MISMATCH", "Pi version differs from the audited live-probe contract", {
        expectedPiVersion,
        actualPiVersion: typeof piVersion === "string" ? piVersion.slice(0, 64) : null,
      });
    }

    const argv = [
      "--mode", "rpc",
      "--offline",
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-builtin-tools",
      "--no-approve",
    ];
    const stdoutState = { parts: [], bytes: 0, truncated: false };
    const stderrState = { parts: [], bytes: 0, truncated: false };
    const startedAt = Date.now();

    return await new Promise((resolve, reject) => {
      let settled = false;
      let probeRecord = null;
      let child;
      const stopTimer = () => clearTimeout(timer);
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        stopTimer();
        reject(error);
      };
      const observe = () => {
        // Pi's extension loader may route direct extension writes to stderr in
        // RPC mode. Treat both bounded streams as transport, then persist only
        // digests and the validated low-sensitivity record.
        const records = [
          ...parseProbeRecords(captured(stdoutState)),
          ...parseProbeRecords(captured(stderrState)),
        ];
        if (records.length > 1) {
          child?.kill?.("SIGTERM");
          fail("PI_SUBAGENTS_PROBE_AMBIGUOUS", "Pi emitted more than one live-probe record");
        }
        if (records.length === 1 && probeRecord === null) {
          probeRecord = records[0];
          child?.stdin?.end();
        }
      };
      const finish = (exitCode, signal) => {
        if (settled) return;
        settled = true;
        stopTimer();
        const stdout = captured(stdoutState);
        const stderr = captured(stderrState);
        try {
          if (exitCode !== 0 || signal !== null) {
            fail("PI_SUBAGENTS_LIVE_PROBE_FAILED", "Pi exited unsuccessfully during the no-model live probe", {
              exitCode,
              signal: signal ?? null,
            });
          }
          const records = [...parseProbeRecords(stdout), ...parseProbeRecords(stderr)];
          if (records.length !== 1) fail("PI_SUBAGENTS_LIVE_PROBE_MISSING", "Pi did not emit exactly one live-probe record");
          const verified = assertProbeRecord(records[0], {
            expectedFirstPartyCommands,
            expectedBackendVersion: expectedArtifact.version,
            expectedActiveTools,
          });
          const evidence = {
            formatVersion: 1,
            status: "LIVE_NO_MODEL_CAPABILITY_PASS",
            boundary: "PI_RPC_EXTENSION_CAPABILITY_AND_VISIBILITY",
            observedAt: new Date().toISOString(),
            piVersion,
            nodeVersion: process.version,
            platform: `${process.platform}-${process.arch}`,
            upstream: {
              package: audited.package,
              version: audited.version,
              packageJsonSha256: audited.packageJsonSha256,
              rpcSourceSha256: audited.rpcSourceSha256,
            },
            rpc: {
              ready: "PASS",
              correlatedPing: "PASS",
              protocolVersion: 1,
              methods: [...verified.dialect.methods],
              events: { ...verified.dialect.events },
              requiredCapabilities: structuredClone(verified.dialect.capabilities),
              capabilityDigest: verified.capabilityDigest,
            },
            visibility: {
              activeTools: [...verified.activeTools],
              primaryTool: "subagent",
              primaryToolOwner: "pi-subagents",
              onlyMyPiModelTools: [],
              expectedFirstPartyCommands: [...verified.firstPartyCommands],
              upstreamCommandCount: verified.upstreamCommandCount,
            },
            promptSubmitted: false,
            providerRequest: "NOT_RUN_BY_POLICY",
            childDispatch: "NOT_REQUESTED",
            sessionPersistence: false,
            credentialRoot: "ISOLATED_EMPTY",
            realPiHome: "NOT_TOUCHED",
            hostFilesystemIsolation: "NOT_ENFORCED",
            extensionNetworkIsolation: "NOT_ENFORCED",
            exitCode,
            signal: null,
            durationMs: Math.max(0, Date.now() - startedAt),
            stdoutDigest: digestValue(stdout),
            stderrDigest: digestValue(stderr),
            outputTruncated: stdoutState.truncated || stderrState.truncated,
          };
          evidence.evidenceDigest = digestValue(evidence);
          resolve(assertPiSubagentsLiveProbeEvidence(evidence, {
            expectedArtifact,
            expectedPiVersion,
            expectedActiveTools,
            expectedFirstPartyCommands,
          }));
        } catch (error) {
          error.stdoutDigest ??= digestValue(stdout);
          error.stderrDigest ??= digestValue(stderr);
          error.outputTruncated ??= stdoutState.truncated || stderrState.truncated;
          reject(error);
        }
      };

      let timer;
      try {
        child = spawnImpl(piCommand, argv, {
          cwd: agentRoot,
          env,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (cause) {
        fail("PI_SUBPROCESS_START_FAILED", "Pi live-probe subprocess could not start", { causeName: cause?.name ?? "Error" });
      }
      timer = setTimeout(() => {
        child.kill?.("SIGTERM");
        const error = new Error("Pi subagents live probe timed out");
        error.name = "PiSubagentsLiveProbeError";
        error.code = "PI_SUBAGENTS_LIVE_PROBE_TIMEOUT";
        rejectOnce(error);
      }, timeoutMs);
      timer.unref?.();
      child.stdout?.on?.("data", (chunk) => {
        appendBounded(stdoutState, chunk);
        try {
          observe();
        } catch (error) {
          child.kill?.("SIGTERM");
          rejectOnce(error);
        }
      });
      child.stderr?.on?.("data", (chunk) => {
        appendBounded(stderrState, chunk);
        try {
          observe();
        } catch (error) {
          child.kill?.("SIGTERM");
          rejectOnce(error);
        }
      });
      child.once?.("error", (cause) => {
        const error = new Error("Pi live-probe subprocess could not start");
        error.name = "PiSubagentsLiveProbeError";
        error.code = "PI_SUBPROCESS_START_FAILED";
        error.causeName = cause?.name ?? "Error";
        rejectOnce(error);
      });
      child.once?.("exit", finish);
    });
  };
}

export { assertProbeRecord as assertPiSubagentsLiveProbeRecord };
