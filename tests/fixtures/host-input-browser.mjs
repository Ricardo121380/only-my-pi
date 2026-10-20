// Current-source Host/WebUI + verified Pi stack + loopback-only scripted model.
// Owns a fresh private fixture; never reads user account files or projects.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPi110SourceCli } from "./pi110-source-cli.mjs";
import { startHost } from "../../packages/host/server.mjs";
import { AccountCatalog } from "../../packages/host/accounts.mjs";
import { loadDistribution } from "../../packages/distribution/runtime.mjs";
import { acquireOwnership, groupAlive } from "../../packages/host/ownership.mjs";
import { HostInputStore } from "../../packages/host/input-store.mjs";
import { RpcWorker } from "../../packages/host/rpc-worker.mjs";
import { resolveDirectExtensionSet } from "../../packages/direct-agent/launcher.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url)), output = process.env.OMP_INPUT_BROWSER_EVIDENCE_ROOT;
assert(output && path.isAbsolute(output) && !output.startsWith(repo));
const sourceMode = process.env.OMP_INPUT_PI110_SOURCE === "1";
assert(sourceMode || (process.env.OMP_TEST_STACK_PACKAGE && path.isAbsolute(process.env.OMP_TEST_STACK_PACKAGE)));
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-browser-"))), configRoot = path.join(root, "config");
const sourceCli = sourceMode ? await createPi110SourceCli(root, { installedExtensions: true }) : null;
const stack = sourceCli ? { root: sourceCli.stack, ompPackageRoot: sourceCli.omp, nodePath: path.join(sourceCli.stack, "node/bin/node"), piCliPath: path.join(sourceCli.stack, "pi/dist/bundle/cli.js"), stackId: `sha256:${"a".repeat(64)}` } : await loadDistribution({ packageRoot: process.env.OMP_TEST_STACK_PACKAGE }); assert(stack);
const requests = [];
const deliveryFixture = process.env.OMP_INPUT_BROWSER_DELIVERY === "1", holds = new Set(), waitingTools = new Map();
let rejectNext = false;
let loseNextInput = null, occupiedSession = null;
const damagedDrafts = new Map();
async function live() { if (deliveryFixture) await fs.writeFile(path.join(output, "browser-live-state.json"), JSON.stringify({ requests: requests.length, waitingTaskIds: [...waitingTools.keys()], workers: spawnedWorkers.map((worker) => ({ taskId: worker.taskId, pid: worker.identity?.pid })) }), { mode: 0o600 }); }
const provider = http.createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer fixture-input-only") { res.writeHead(401); res.end(); return; }
  let body = ""; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body); requests.push({ model: request.model, thinking: request.reasoning_effort ?? null, messages: request.messages });
  await live();
  if (rejectNext) { rejectNext = false; res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":{"type":"authentication_error","message":"controlled local failure"}}'); return; }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const text = `本地受控模型完成第 ${requests.length} 轮；未调用外部服务。`;
  const lastUser = JSON.stringify(request.messages.findLast((message) => message.role === "user")?.content);
  const approval = deliveryFixture && lastUser?.includes("U1-05 APPROVAL") && !holds.has(lastUser);
  const hold = deliveryFixture && /U1-0[456] HOLD/.test(lastUser ?? "") && !holds.has(lastUser);
  if (hold) holds.add(lastUser);
  if (approval) holds.add(lastUser);
  const tool = approval ? { name: "request_coding_access", arguments: JSON.stringify({ taskSummary: "U1-05 fixture approval only; no write will be performed", complexity: "simple", scope: ["README.md"], riskFlags: [], verification: ["read-only inspection"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } }) } : { name: "read", arguments: '{"path":"README.md"}' };
  const choices = hold || approval ? [{ delta: { role: "assistant", tool_calls: [{ index: 0, id: `fixture-tool-${requests.length}`, type: "function", function: tool }] }, finish_reason: null }, { delta: {}, finish_reason: "tool_calls" }] : [{ delta: { role: "assistant", content: text }, finish_reason: null }, { delta: {}, finish_reason: "stop" }];
  for (const choice of choices) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: request.model, choices: [{ index: 0, ...choice }] })}\n\n`);
  res.write('data: {"id":"fixture","choices":[],"usage":{"prompt_tokens":20,"completion_tokens":6,"total_tokens":26}}\n\n'); res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const accounts = new AccountCatalog(configRoot), account = await accounts.create({ providerId: "fixture", name: "U1 本地模型", authType: "api_key" });
const removed = await accounts.create({ providerId: "fixture", name: "即将删除的夹具账号", authType: "api_key" });
const paths = await accounts.runtimePaths(account.accountId);
const models = { providers: { fixture: { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, api: "openai-completions", models: [{ id: "reasoner", name: "Fixture Reasoner", reasoning: true, contextWindow: 32000, maxTokens: 128 }, { id: "plain", name: "Fixture Plain", reasoning: false, contextWindow: 32000, maxTokens: 128 }] } } };
for (const id of [account.accountId, removed.accountId]) {
  const own = await accounts.runtimePaths(id);
  await fs.writeFile(own.authPath, JSON.stringify({ fixture: { type: "api_key", key: "fixture-input-only" } }), { mode: 0o600 });
  await fs.writeFile(own.modelsPath, JSON.stringify(models), { mode: 0o600 });
}
await fs.writeFile(path.join(configRoot, "settings.json"), JSON.stringify({ ...(sourceCli ? JSON.parse(await fs.readFile(path.join(configRoot, "settings.json"), "utf8")) : {}), retry: { enabled: false }, compaction: { enabled: false } }), { mode: 0o600 });
const assetsRoot = fileURLToPath(new URL("../../webui/dist", import.meta.url));
const spawnedWorkers = [];
const workerGroups = () => spawnedWorkers.map((worker) => {
  // A worker object can be allocated before a session lease rejects startup.
  // Never pass an absent PID to groupAlive (Node interprets NaN as group 0).
  const pid = worker.child?.pid ?? worker.identity?.pid ?? null;
  return { taskId: worker.taskId, pid, spawned: !!worker.child, alive: pid ? groupAlive(pid) : false, pendingInputs: worker.inputPending.size };
});
const extension = path.join(root, "tool-boundary.mjs");
if (deliveryFixture) await fs.writeFile(extension, `export default function(pi) {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "read") return;
    await new Promise((resolve) => { const listener = (frame) => { if (frame?.type === "fixture_release_tool") { process.off("message", listener); resolve(); } }; process.on("message", listener); process.send({type: "fixture_tool_waiting"}); });
  });
}`);
// Drop a real successful HTTP response only after the production handler commits.
// No React/DOM state or Host return value is fabricated.
const createHttpServer = http.createServer;
if (deliveryFixture) http.createServer = function(handler) {
  return createHttpServer.call(this, (req, res) => {
    if (req.url === "/api/input-command") {
      let inputBody = ""; req.on("data", (chunk) => { inputBody += chunk; });
      const end = res.end;
      res.end = function(...args) {
        let type; try { type = JSON.parse(inputBody).type; } catch { /* normal handler owns validation */ }
        if (type === loseNextInput && res.statusCode === 200) {
          loseNextInput = null;
          void fs.writeFile(path.join(output, `browser-lost-response-${Date.now()}.json`), JSON.stringify({ kind: "HTTP_SOCKET_DESTROY_AFTER_SUCCESSFUL_HANDLER", type, statusCode: res.statusCode, requests: requests.length, response: JSON.parse(String(args[0])) }), { mode: 0o600 });
          res.destroy(); return res;
        }
        return end.apply(this, args);
      };
    }
    handler(req, res);
  });
};
const createHost = () => startHost({ stack, configRoot, assetsRoot, allowControlled: true, env: { PATH: process.env.PATH }, workerFactory: (options) => {
  const worker = new RpcWorker({ ...options, ...(deliveryFixture ? { extensionResolver: async (params) => { const set = await resolveDirectExtensionSet(params); return { ...set, extensions: [...set.extensions, extension] }; }, spawnImpl: (...args) => {
    const child = spawn(...args); child.on("message", (message) => { if (message?.type === "fixture_tool_waiting") { waitingTools.set(options.taskId, worker); void host.scan().then(live); } }); child.on("exit", () => { waitingTools.delete(options.taskId); void live(); }); return child;
  } } : {}) }); spawnedWorkers.push(worker); return worker;
} });
let host = await createHost();
const paired = await fetch(`${host.origin}/pair`, { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
assert(paired.ok); const cookie = paired.headers.get("set-cookie").split(";")[0];
async function command(input) {
  const response = await fetch(`${host.origin}/api/command`, { method: "POST", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2" }, body: JSON.stringify(input) });
  const value = await response.json(); assert(response.ok, value.code); return value;
}
async function settle(id) {
  for (let i = 0; i < 1500; i++) { const task = host.tasks.tasks.get(id); if (!["starting", "running", "cancelling"].includes(task.status)) { await Promise.all([...host.tasks.running.values()]); assert.equal(task.status, "succeeded", task.error); await host.scan(); return host.tasks.public(task); } await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error("FIXTURE_SEED_TIMED_OUT");
}
const projects = [];
for (const name of ["Alpha", "Beta"]) {
  const projectPath = path.join(root, name); await fs.mkdir(projectPath); await fs.writeFile(path.join(projectPath, "README.md"), `# ${name}\nOnly a temporary U1 fixture.\n`);
  projects.push(await command({ type: "addProject", path: projectPath }));
}
const seeds = [];
for (const [requestId, prompt, accountId, model, thinkingLevel] of [["seed-history", "U1 历史会话 A", account.accountId, "fixture/reasoner", "low"], ["seed-plain", "U1 普通模型会话", account.accountId, "fixture/plain", "off"], ["seed-removed", "U1 缺失账号会话", removed.accountId, "fixture/reasoner", "low"]]) {
  const started = await command({ type: "startTask", requestId, prompt, projectId: projects[0].projectId, accountId, model, thinkingLevel }); seeds.push(await settle(started.taskId));
}
await accounts.remove(removed.accountId); await host.scan();
const sourceFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repo }).toString().split("\0").filter((file) => file && !file.startsWith("docs/") && file !== "CONTEXT.md");
const source = {};
for (const file of sourceFiles.sort()) source[file] = createHash("sha256").update(await fs.readFile(path.join(repo, file))).digest("hex");
const identity = { node: process.version, provider: "LOOPBACK_FIXTURE_ONLY", stackId: stack.stackId, stackSourceCommit: stack.distribution?.sourceCommit ?? null, piVersion: sourceCli?.piVersion ?? null, harness: sourceCli ? "SOURCE_WORKTREE_REAL_EXTENSIONS" : "VERIFIED_DISTRIBUTION", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim(), sourceFingerprint: createHash("sha256").update(JSON.stringify(source)).digest("hex"), webIndexSha256: createHash("sha256").update(await fs.readFile(path.join(assetsRoot, "index.html"))).digest("hex"), seedTasks: seeds, projects, accountId: account.accountId, removedAccountId: removed.accountId };
const pair = await fetch(`${host.origin}/internal/pair`, { method: "POST", headers: { Authorization: `Bearer ${host.controlToken}` } }); assert(pair.ok);
await fs.writeFile(path.join(output, "browser-private-startup.json"), JSON.stringify({ pairingUrl: (await pair.json()).url, origin: host.origin, root, configRoot, modelsPath: paths.modelsPath }), { flag: "wx", mode: 0o600 });
await fs.writeFile(path.join(output, "browser-fixture-identity.json"), JSON.stringify(identity, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ ready: true, origin: host.origin, evidence: output, requests: requests.length, provider: identity.provider }));
if (deliveryFixture) {
  await live();
  let buffer = "", control = Promise.resolve();
  const releaseWaiting = () => { for (const [id, worker] of waitingTools) { if (worker.child?.connected) worker.child.send({ type: "fixture_release_tool" }); waitingTools.delete(id); } };
  process.stdin.on("data", (bytes) => { buffer += bytes.toString(); let end; while ((end = buffer.indexOf("\n")) !== -1) {
    const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    control = control.then(async () => {
      if (frame.rejectNext === true) rejectNext = true;
      if (frame.loseNextInput) { assert(["saveDraft", "enqueueInput", "deliverSupplement"].includes(frame.loseNextInput)); loseNextInput = frame.loseNextInput; }
      if (frame.models) { assert(frame.models.every((id) => ["reasoner", "plain"].includes(id))); await fs.writeFile(paths.modelsPath, JSON.stringify({ providers: { fixture: { ...models.providers.fixture, models: models.providers.fixture.models.filter((model) => frame.models.includes(model.id)) } } }), { mode: 0o600 }); }
      if (frame.occupy !== undefined) { assert(!occupiedSession && seeds[frame.occupy]); occupiedSession = await acquireOwnership(configRoot, "session", seeds[frame.occupy].sessionId); }
      if (frame.releaseOccupancy) { await occupiedSession?.release(); occupiedSession = null; }
      if (frame.corruptDraft !== undefined) {
        assert(seeds[frame.corruptDraft]); const seed = seeds[frame.corruptDraft], file = host.inputs.file("draft", { projectId: seed.projectId, sessionId: seed.sessionId });
        assert(!damagedDrafts.has(file)); damagedDrafts.set(file, await fs.readFile(file)); await fs.writeFile(file, "{u106 corrupt original", { mode: 0o600 });
      }
      if (frame.restoreDraft !== undefined) {
        const seed = seeds[frame.restoreDraft], file = host.inputs.file("draft", { projectId: seed.projectId, sessionId: seed.sessionId }); assert(damagedDrafts.has(file));
        await fs.writeFile(path.join(output, `browser-corrupt-preserved-${Date.now()}.json`), JSON.stringify({ kind: "OWNED_DRAFT_CORRUPTION", bytesPreserved: (await fs.readFile(file, "utf8")) === "{u106 corrupt original", requests: requests.length }), { mode: 0o600 });
        await fs.writeFile(file, damagedDrafts.get(file), { mode: 0o600 }); damagedDrafts.delete(file);
      }
      if (frame.release === "all") releaseWaiting();
      if (frame.restart === true) {
        const previous = host, stopping = previous.stop(); releaseWaiting(); await stopping;
        const groups = workerGroups();
        assert(groups.every((group) => !group.alive && group.pendingInputs === 0)); assert.equal(previous.tasks.leases.size, 0); assert.equal(previous.tasks.accountReleases.size, 0);
        host = await createHost(); await host.scan();
        await fs.writeFile(path.join(output, "browser-private-restart.json"), JSON.stringify({ pairingUrl: host.pairingUrl, origin: host.origin }), { mode: 0o600 });
        await fs.writeFile(path.join(output, `browser-restart-${Date.now()}.json`), JSON.stringify({ kind: "GRACEFUL_HOST_RESTART", beforeEpoch: previous.epoch, afterEpoch: host.epoch, before: previous.snapshot(), after: host.snapshot(), requests: requests.length, groups, leases: previous.tasks.leases.size, reservations: previous.tasks.accountReleases.size }), { mode: 0o600 });
      }
      await live(); console.log(JSON.stringify({ fixtureControl: true, origin: host.origin, waiting: waitingTools.size, rejectNext }));
    }).catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });
  } });
}
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  for (const [file, bytes] of damagedDrafts) await fs.writeFile(file, bytes, { mode: 0o600 });
  await occupiedSession?.release();
  await host.stop(); await new Promise((resolve) => { provider.closeAllConnections(); provider.close(resolve); });
  http.createServer = createHttpServer;
  const groups = workerGroups(); assert(groups.every((group) => group.alive === false && group.pendingInputs === 0));
  const drafts = [], receipts = [], histories = [];
  const restored = new HostInputStore({ configRoot }); await restored.load();
  for (const project of projects) {
    drafts.push(await restored.readDraft({ projectId: project.projectId, sessionId: null }));
    for (const session of host.catalog.listSessions(project.projectId)) {
      const scope = { projectId: project.projectId, sessionId: session.sessionId }; drafts.push(await restored.readDraft(scope)); receipts.push(await restored.readQueue(scope));
      const entry = await host.catalog.resume(session.sessionKey, project.projectId), bytes = await fs.readFile(entry.file);
      const carriers = bytes.toString().trim().split("\n").map(JSON.parse).filter((item) => item.type === "custom_message" && item.customType === "omp-host-input-v1");
      histories.push({ ...scope, sha256: createHash("sha256").update(bytes).digest("hex"), carriers });
    }
  }
  await restored.close();
  await fs.writeFile(path.join(output, "browser-fixture-closeout.json"), JSON.stringify({ identity, snapshot: host.snapshot(), requests, drafts, receipts, histories, groups, sessionLeases: host.tasks.leases.size, accountReservations: host.tasks.accountReleases.size, stopped: true }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await fs.rm(root, { recursive: true }); console.log(JSON.stringify({ stopped: true, requests: requests.length, sessionLeases: host.tasks.leases.size, accountReservations: host.tasks.accountReleases.size, fixtureRemoved: true }));
}
process.on("SIGTERM", () => void stop().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; }));
process.on("SIGINT", () => void stop().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; }));
