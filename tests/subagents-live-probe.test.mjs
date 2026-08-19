import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPiSubagentsLiveProbeRecord,
  assertPiSubagentsLiveProbeEvidence,
  createPiSubagentsNoModelLiveProbe,
  inspectAuditedPiSubagentsPackage,
  PI_SUBAGENTS_LIVE_PROBE_ACTIVE_TOOLS,
  PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
} from "../packages/subagents/live-probe.mjs";
import {
  createPiSubagentsLiveProbeRecord,
  PI_SUBAGENTS_LIVE_PROBE_RECORD_TYPE,
  PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID,
} from "../packages/subagents/live-probe-extension.mjs";
import {
  PI_SUBAGENTS_RPC_V1_EVENTS,
  PI_SUBAGENTS_RPC_V1_METHODS,
  PI_SUBAGENTS_RPC_V1_REQUIRED_CAPABILITIES,
} from "../packages/subagents/adapters/pi-subagents-rpc-v1/wire.mjs";
import { parseSubagentsLiveProbeArgs } from "../scripts/subagents-live-probe.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fixturePackage(root) {
  const packageRoot = path.join(root, "node_modules", "pi-subagents");
  const packageJson = `${JSON.stringify({ name: "pi-subagents", version: "0.45.2" }, null, 2)}\n`;
  const rpcSource = "export const protocolVersion = 1;\n";
  await fs.mkdir(path.join(packageRoot, "src", "extension"), { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), packageJson);
  await fs.writeFile(path.join(packageRoot, "src", "extension", "rpc.ts"), rpcSource);
  await fs.writeFile(path.join(packageRoot, "index.ts"), "export default function extension() {}\n");
  return {
    packageRoot,
    expected: {
      package: "pi-subagents",
      version: "0.45.2",
      packageJsonSha256: sha256(packageJson),
      rpcSourceSha256: sha256(rpcSource),
    },
  };
}

function pingData() {
  return {
    version: 1,
    methods: [...PI_SUBAGENTS_RPC_V1_METHODS],
    capabilities: structuredClone(PI_SUBAGENTS_RPC_V1_REQUIRED_CAPABILITIES),
    events: { ...PI_SUBAGENTS_RPC_V1_EVENTS },
    session: { cwdPresent: true, sessionIdPresent: true, sessionFilePresent: false },
  };
}

function validRecord() {
  return {
    formatVersion: 1,
    type: PI_SUBAGENTS_LIVE_PROBE_RECORD_TYPE,
    ready: pingData(),
    reply: {
      version: 1,
      requestId: PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID,
      method: "ping",
      success: true,
      data: pingData(),
    },
    sameSession: true,
    activeTools: PI_SUBAGENTS_LIVE_PROBE_ACTIVE_TOOLS.map((name) => ({ name, owner: "pi-subagents" })),
    commands: [
      { name: "omp", owner: "only-my-pi" },
      { name: "omp-context", owner: "only-my-pi" },
      { name: "run", owner: "pi-subagents" },
      { name: "subagents", owner: "pi-subagents" },
    ],
  };
}

function fakeChild(record, invocation, stream = "stderr") {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writes: [],
    write(value) {
      this.writes.push(value);
      throw new Error("the live probe must not write an RPC prompt or command");
    },
    end() {
      queueMicrotask(() => child.emit("exit", 0, null));
    },
  };
  child.kill = () => child.emit("exit", null, "SIGTERM");
  invocation.child = child;
  queueMicrotask(() => child[stream].emit("data", `${JSON.stringify(record)}\n`));
  return child;
}

test("no-model live probe verifies ready, correlated ping, visibility, and one physical owner", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-subagents-live-probe-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, "config");
  const firstPartyRoot = path.join(root, "only-my-pi");
  await fs.mkdir(configRoot, { recursive: true });
  await fs.mkdir(path.join(firstPartyRoot, "extensions"), { recursive: true });
  const firstPartyExtension = path.join(firstPartyRoot, "extensions", "control.ts");
  await fs.writeFile(firstPartyExtension, "export default function control() {}\n");
  const fixture = await fixturePackage(root);
  const invocation = {};
  const spawnImpl = (command, argv, options) => {
    Object.assign(invocation, { command, argv, options });
    return fakeChild(validRecord(), invocation);
  };
  const probe = createPiSubagentsNoModelLiveProbe({
    piCommand: "/test/pi",
    spawnImpl,
    versionProbe: async () => PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
    expectedArtifact: fixture.expected,
    timeoutMs: 1_000,
  });
  const result = await probe({
    configRoot,
    packageRoot: fixture.packageRoot,
    firstPartyRoot,
    firstPartyExtensions: [firstPartyExtension],
    expectedFirstPartyCommands: ["omp", "omp-context"],
  });

  assert.equal(result.status, "LIVE_NO_MODEL_CAPABILITY_PASS");
  assert.equal(result.boundary, "PI_RPC_EXTENSION_CAPABILITY_AND_VISIBILITY");
  assert.equal(result.promptSubmitted, false);
  assert.equal(result.providerRequest, "NOT_RUN_BY_POLICY");
  assert.equal(result.childDispatch, "NOT_REQUESTED");
  assert.equal(result.realPiHome, "NOT_TOUCHED");
  assert.equal(result.sessionPersistence, false);
  assert.deepEqual(result.visibility.activeTools, [...PI_SUBAGENTS_LIVE_PROBE_ACTIVE_TOOLS]);
  assert.deepEqual(result.visibility.onlyMyPiModelTools, []);
  assert.deepEqual(result.visibility.expectedFirstPartyCommands, ["omp", "omp-context"]);
  assert.match(result.rpc.capabilityDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(assertPiSubagentsLiveProbeEvidence(result, {
    expectedArtifact: fixture.expected,
    expectedPiVersion: PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
  }).evidenceDigest, result.evidenceDigest);
  const forgedCapabilityDigest = structuredClone(result);
  forgedCapabilityDigest.rpc.capabilityDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => assertPiSubagentsLiveProbeEvidence(forgedCapabilityDigest, {
      expectedArtifact: fixture.expected,
      expectedPiVersion: PI_SUBAGENTS_LIVE_PROBE_EXPECTED_PI_VERSION,
    }),
    (error) => error.code === "PI_SUBAGENTS_EVIDENCE_RPC_DRIFT",
  );
  assert.equal(invocation.command, "/test/pi");
  assert.deepEqual(invocation.argv, [
    "--mode", "rpc",
    "--offline",
    "--no-session",
    "--no-context-files",
    "--no-skills",
    "--no-builtin-tools",
    "--no-approve",
  ]);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(invocation.child.stdin.writes.length, 0);
  assert.equal(invocation.options.env.PI_OFFLINE, "1");
  assert.equal(invocation.options.env.PI_CODING_AGENT_DIR, invocation.options.cwd);
  assert.equal(Object.hasOwn(invocation.options.env, "OPENAI_API_KEY"), false);
  assert.equal(Object.hasOwn(invocation.options.env, "ANTHROPIC_API_KEY"), false);
  assert.equal(Object.hasOwn(invocation.options.env, "CODEX_HOME"), false);
  const settings = JSON.parse(await fs.readFile(path.join(invocation.options.cwd, "settings.json"), "utf8"));
  assert.deepEqual(settings.extensions, [
    path.join(await fs.realpath(fixture.packageRoot), "index.ts"),
    path.resolve("packages/subagents/live-probe-extension.mjs"),
    await fs.realpath(firstPartyExtension),
  ]);
  assert.deepEqual(settings.packages, []);
  assert.deepEqual(settings.skills, []);
});

test("probe extension emits only bounded ownership and session-presence data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-subagents-record-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const upstreamRoot = path.join(root, "upstream");
  const firstPartyRoot = path.join(root, "first-party");
  await fs.mkdir(upstreamRoot);
  await fs.mkdir(firstPartyRoot);
  const upstreamEntry = path.join(upstreamRoot, "index.ts");
  const firstPartyEntry = path.join(firstPartyRoot, "index.ts");
  await fs.writeFile(upstreamEntry, "upstream\n");
  await fs.writeFile(firstPartyEntry, "first-party\n");
  const rawSessionId = "raw-session-id-must-not-escape";
  const rawCwd = path.join(root, "private-workspace");
  const raw = {
    version: 1,
    methods: [...PI_SUBAGENTS_RPC_V1_METHODS],
    capabilities: structuredClone(PI_SUBAGENTS_RPC_V1_REQUIRED_CAPABILITIES),
    events: { ...PI_SUBAGENTS_RPC_V1_EVENTS },
    session: { cwd: rawCwd, sessionId: rawSessionId, sessionFile: null },
  };
  const record = createPiSubagentsLiveProbeRecord({
    upstreamRoot,
    firstPartyRoot,
    ready: raw,
    reply: {
      version: 1,
      requestId: PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID,
      method: "ping",
      success: true,
      data: raw,
    },
    pi: {
      getActiveTools: () => ["subagent"],
      getAllTools: () => [{ name: "subagent", sourceInfo: { path: upstreamEntry } }],
      getCommands: () => [{ name: "omp", sourceInfo: { path: firstPartyEntry } }],
    },
  });
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(rawSessionId), false);
  assert.equal(serialized.includes(rawCwd), false);
  assert.equal(serialized.includes(upstreamEntry), false);
  assert.equal(serialized.includes(firstPartyEntry), false);
  assert.deepEqual(record.ready.session, { cwdPresent: true, sessionIdPresent: true, sessionFilePresent: false });
  assert.deepEqual(record.activeTools, [{ name: "subagent", owner: "pi-subagents" }]);
  assert.deepEqual(record.commands, [{ name: "omp", owner: "only-my-pi" }]);
  assert.equal(record.sameSession, true);
});

test("live probe fails closed on capability drift and a competing physical tool owner", () => {
  const capabilityDrift = validRecord();
  capabilityDrift.reply.data.capabilities.stop = false;
  assert.throws(
    () => assertPiSubagentsLiveProbeRecord(capabilityDrift, { expectedFirstPartyCommands: ["omp", "omp-context"] }),
    (error) => error.code === "PI_SUBAGENTS_CAPABILITY_DRIFT",
  );
  const ownerDrift = validRecord();
  ownerDrift.activeTools.find((entry) => entry.name === "subagent").owner = "only-my-pi";
  assert.throws(
    () => assertPiSubagentsLiveProbeRecord(ownerDrift, { expectedFirstPartyCommands: ["omp", "omp-context"] }),
    (error) => error.code === "PI_SUBAGENTS_TOOL_OWNER_DRIFT",
  );
});

test("audited package inspection rejects source drift before Pi starts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-subagents-artifact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = await fixturePackage(root);
  const inspected = await inspectAuditedPiSubagentsPackage({ packageRoot: fixture.packageRoot, expected: fixture.expected });
  assert.equal(inspected.version, "0.45.2");
  await fs.appendFile(path.join(fixture.packageRoot, "src", "extension", "rpc.ts"), "// drift\n");
  await assert.rejects(
    inspectAuditedPiSubagentsPackage({ packageRoot: fixture.packageRoot, expected: fixture.expected }),
    (error) => error.code === "PI_SUBAGENTS_SOURCE_DRIFT" && error.rpcSourceMatch === false,
  );
});

test("live probe CLI requires explicit disposable and package roots", () => {
  assert.deepEqual(parseSubagentsLiveProbeArgs(["--help"]), {
    configRoot: null,
    packageRoot: null,
    onlyMyPiRoot: null,
    piCommand: "pi",
    help: true,
  });
  assert.throws(() => parseSubagentsLiveProbeArgs([]), /--config-root must be absolute/u);
  assert.throws(
    () => parseSubagentsLiveProbeArgs(["--config-root", "/tmp/probe", "--package-root", "relative"]),
    /--package-root must be absolute/u,
  );
  const parsed = parseSubagentsLiveProbeArgs([
    "--config-root", "/tmp/probe",
    "--package-root", "/tmp/package",
    "--only-my-pi-root", "/tmp/only-my-pi",
    "--pi-command", "/opt/homebrew/bin/pi",
  ]);
  assert.equal(parsed.configRoot, "/tmp/probe");
  assert.equal(parsed.packageRoot, "/tmp/package");
  assert.equal(parsed.onlyMyPiRoot, "/tmp/only-my-pi");
  assert.equal(parsed.piCommand, "/opt/homebrew/bin/pi");
});
