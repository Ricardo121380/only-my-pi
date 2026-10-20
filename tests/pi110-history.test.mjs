import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import * as sdk from "@earendil-works/pi-coding-agent";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { startHost } from "../packages/host/server.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { SessionAdmissions } from "../packages/direct-agent/session-admission.mjs";
import { createAdmittedSessionRuntime } from "../packages/direct-agent/session-runtime.mjs";
import { readSessionSnapshot, openValidatedSession } from "../packages/direct-agent/session-history.mjs";

async function until(check) { for (let i = 0; i < 1000; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error("HISTORY_FIXTURE_TIMED_OUT"); }
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

test("legacy migration retains original bytes and a future version refuses before opening", async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-history-gate-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "legacy.jsonl");
  const original = Buffer.from(JSON.stringify({ type: "session", version: 1, id: "old", cwd: root }) + "\n" + JSON.stringify({ type: "message", message: { role: "user", content: "old bytes" } }) + "\n");
  await fs.writeFile(file, original);
  const preview = await readSessionSnapshot(file);
  assert.equal(preview.manager.buildSessionContext().messages[0].content, "old bytes");
  assert.deepEqual(await fs.readFile(file), original);
  const manager = await openValidatedSession(file, sdk, root, root, root);
  assert.equal(manager.getHeader().version, 3);
  const backup = path.join(root, "only-my-pi/history-backups", `${path.basename(file)}.${digest(original)}`);
  assert.deepEqual(await fs.readFile(backup), original);
  const future = JSON.stringify({ type: "session", version: 4, id: "future", cwd: root }) + "\n";
  await fs.writeFile(file, future);
  await assert.rejects(openValidatedSession(file, sdk, root, root, root), { code: "SESSION_READER_UPGRADE_REQUIRED" });
  assert.equal(await fs.readFile(file, "utf8"), future);
});

test("actual Pi 0.85.1 history resumes through public Host HTTP and forks at the selected new entry", { skip: !process.env.OMP_PI085_SDK_ROOT, timeout: 60000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi-history-")));
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); requests.push(request);
    const read = requests.length === 1;
    const choices = read ? [{ delta: { role: "assistant", tool_calls: [{ index: 0, id: "legacy-read", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } }] }, finish_reason: null }, { delta: {}, finish_reason: "tool_calls" }]
      : [{ delta: { role: "assistant", content: "LEGACY_MARKER complete" }, finish_reason: null }, { delta: {}, finish_reason: "stop" }];
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of choices) res.write(`data: ${JSON.stringify({ id: "legacy-fixture", model: request.model, choices: [{ index: 0, ...choice }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  }); await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  let host, runtime;
  t.after(async () => { await runtime?.dispose(); await host?.stop(); await new Promise(resolve => { provider.closeAllConnections(); provider.close(resolve); }); await fs.rm(root, { recursive: true, force: true }); });
  const source = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const models = { providers: { fixture: { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, api: "openai-completions", models: [{ id: "legacy", name: "Legacy local fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 128 }] } } };
  await fs.writeFile(path.join(source.config, "models.json"), JSON.stringify(models));
  const sessions = path.join(source.config, "sessions"); await fs.mkdir(sessions);
  const generated = await promisify(execFile)(process.execPath, [new URL("./fixtures/pi110-legacy-history.mjs", import.meta.url).pathname, process.env.OMP_PI085_SDK_ROOT, source.project, source.config, sessions], { env: source.env, timeout: 30000 });
  const old = JSON.parse(generated.stdout.trim().split("\n").at(-1)), original = await fs.readFile(old.file);
  assert.equal(old.version, "0.85.1"); assert.equal(requests.length, 2);
  const accounts = new AccountCatalog(source.config), account = await accounts.create({ providerId: "fixture", name: "history fixture", authType: "api_key" });
  const own = await accounts.runtimePaths(account.accountId);
  await fs.writeFile(own.authPath, JSON.stringify({ fixture: { type: "api_key", key: "local-history-fixture" } }));
  await fs.writeFile(own.modelsPath, JSON.stringify(models));
  const settings = JSON.parse(await fs.readFile(path.join(source.config, "settings.json"), "utf8"));
  await fs.writeFile(path.join(source.config, "settings.json"), JSON.stringify({ ...settings, retry: { enabled: false }, compaction: { enabled: false } }));
  const assets = path.join(root, "assets"); await fs.mkdir(assets); await fs.writeFile(path.join(assets, "index.html"), "fixture");
  host = await startHost({ configRoot: source.config, assetsRoot: assets, stack: { root: source.stack, ompPackageRoot: source.omp, nodePath: path.join(source.stack, "node/bin/node"), piCliPath: path.join(source.stack, "pi/dist/bundle/cli.js"), stackId: `sha256:${"a".repeat(64)}` }, env: source.env });
  const pair = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  const headers = { Cookie: pair.headers.get("set-cookie").split(";")[0], Origin: host.origin, "content-type": "application/json", "x-omp-host-protocol": "2" };
  const command = async data => { const response = await fetch(host.origin + "/api/command", { method: "POST", headers, body: JSON.stringify(data) }); const value = await response.json(); assert(response.ok, value.code); return value; };
  const project = await command({ type: "addProject", path: source.project }); await host.scan();
  const session = host.catalog.listSessions(project.projectId).find(session => session.sessionId === old.sessionId);
  const history = await fetch(`${host.origin}/api/history?sessionKey=${session.sessionKey}`, { headers }).then(response => response.json());
  assert.ok(history.messages.some(message => message.toolName === "read"));
  assert.deepEqual(await fs.readFile(old.file), original);
  const resumed = await command({ type: "startTask", requestId: "legacy-resume", projectId: project.projectId, accountId: account.accountId, model: "fixture/legacy", thinkingLevel: "off", resumeSessionKey: session.sessionKey, prompt: "Resume NEW_MARKER" });
  await until(() => ["failed", "succeeded"].includes(host.tasks.tasks.get(resumed.taskId).status));
  await Promise.all([...host.tasks.running.values()]);
  assert.equal(host.tasks.tasks.get(resumed.taskId).status, "succeeded", host.tasks.tasks.get(resumed.taskId).error);
  assert.equal(requests.length, 3); assert.equal(host.tasks.tasks.get(resumed.taskId).sessionId, old.sessionId);
  assert.ok(requests[2].messages.some(message => JSON.stringify(message.content).includes("LEGACY_MARKER")));
  assert.ok((await fs.readFile(old.file)).subarray(0, original.length).equals(original));
  const manager = sdk.SessionManager.open(old.file);
  const edited = manager.getEntries().find(entry => entry.type === "message" && entry.message.role === "user");
  manager.appendContextEdit(edited.id, { content: "REDACTED_MARKER" });
  const usageEntry = manager.appendUsage("cache_warm", "fixture", "legacy", { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  const selected = usageEntry.id;
  const excluded = manager.appendMessage({ role: "user", content: "EXCLUDED_MARKER", timestamp: Date.now() });
  const beforeFork = await fs.readFile(old.file);
  const oldSdk = await import(pathToFileURL(path.join(process.env.OMP_PI085_SDK_ROOT, "dist/index.js")));
  // The upstream old reader accepts unknown entries and projects stale text.
  // Probe only an owned copy, then test the supported public OMP resume gate.
  const probeFile = path.join(root, "old-reader-copy.jsonl");
  await fs.writeFile(probeFile, beforeFork);
  const unguarded = oldSdk.SessionManager.open(probeFile);
  assert.deepEqual(unguarded.buildSessionContext().messages[0].content, edited.message.content);
  assert.notEqual(unguarded.buildSessionContext().messages[0].content, "REDACTED_MARKER");
  assert.deepEqual(await fs.readFile(probeFile), beforeFork);
  const oldAdmissions = new SessionAdmissions(source.config, { loadSdk: async () => oldSdk });
  let oldRuntimeCalls = 0;
  try {
    await assert.rejects(createAdmittedSessionRuntime({ sdk: oldSdk, admissions: oldAdmissions,
      sessionFile: old.file, sessionDir: sessions,
      createRuntime: async () => { oldRuntimeCalls++; throw new Error("OLD_RUNTIME_MUST_NOT_START"); }
    }), { code: "SESSION_READER_UPGRADE_REQUIRED" });
  } finally { await oldAdmissions.close(); }
  assert.equal(oldRuntimeCalls, 0);
  assert.equal(requests.length, 3);
  assert.deepEqual(await fs.readFile(old.file), beforeFork);
  const admissions = new SessionAdmissions(source.config);
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: own.authPath, modelsPath: own.modelsPath, allowModelNetwork: false, refreshOnCreate: false });
  const createRuntime = async ({ cwd, sessionManager }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir: source.config, modelRuntime, settingsManager: sdk.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true } });
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, model: modelRuntime.getAvailableSnapshot()[0], tools: ["read"] });
    await created.session.bindExtensions({ mode: "rpc" }); return { ...created, services, diagnostics: services.diagnostics };
  };
  runtime = await createAdmittedSessionRuntime({ sdk, admissions, sessionFile: old.file, sessionDir: sessions, createRuntime });
  await runtime.session.sendCustomMessage({ customType: "fixture-pending", content: "DO_NOT_INHERIT_QUEUE", display: false }, { deliverAs: "nextTurn" });
  // nextTurn stays outside the saved history and must not reach the fork.
  assert(!JSON.stringify(runtime.session.sessionManager.getEntries()).includes("DO_NOT_INHERIT_QUEUE"));
  assert.deepEqual(await runtime.fork(selected, { position: "at" }), { cancelled: false, selectedText: undefined });
  const fork = runtime.session.sessionManager;
  assert.notEqual(fork.getSessionId(), old.sessionId); assert(fork.getEntry(selected)); assert.equal(fork.getEntry(excluded), undefined);
  assert.equal(runtime.session.pendingMessageCount, 0); assert.deepEqual(await fs.readFile(old.file), beforeFork);
  assert.equal(fork.buildSessionContext().messages[0].content, "REDACTED_MARKER");
  assert.equal((await host.inputs.readQueue({ projectId: project.projectId, sessionId: fork.getSessionId() })).items.length, 0);
  await runtime.session.prompt("FORK_NEW_MARKER");
  assert.equal(requests.length, 4); assert.ok(JSON.stringify(requests[3].messages).includes("REDACTED_MARKER")); assert(!JSON.stringify(requests[3].messages).includes("EXCLUDED_MARKER")); assert(!JSON.stringify(requests[3].messages).includes("DO_NOT_INHERIT_QUEUE"));
  if (process.env.OMP_INPUT_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_INPUT_EVIDENCE_ROOT, `legacy-history-${process.pid}-${Date.now()}.json`), JSON.stringify({ node: process.version, oldSdk: old.version, candidateSdk: source.piVersion, provider: "LOOPBACK_ONLY", sourceId: old.sessionId, forkId: fork.getSessionId(), selected, excluded, originalSha256: digest(original), beforeForkSha256: digest(beforeFork), sourcePreserved: (await fs.readFile(old.file)).equals(beforeFork), readerGate: "SESSION_READER_UPGRADE_REQUIRED", oldReader: { upstreamRawReader: "ACCEPTS_BUT_IGNORES_CONTEXT_EDIT", probeCopyPreserved: (await fs.readFile(probeFile)).equals(beforeFork), publicOmpResume: "REFUSED_BEFORE_RUNTIME", runtimeCalls: oldRuntimeCalls, requestsAtRefusal: 3 }, hostResume: host.tasks.public(host.tasks.tasks.get(resumed.taskId)), requests, inheritedQueue: false }, null, 2), { mode: 0o600 });
});
