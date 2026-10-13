import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const fromRepo = relative => import(pathToFileURL(path.join(repo, relative)).href);
const { providerReply, until } = await fromRepo("tests/fixtures/mcp-host.mjs");
const { createHttpMcpServer } = await fromRepo("tests/fixtures/mcp-http-server.mjs");
const { createOAuthMcpServer } = await fromRepo("tests/fixtures/mcp-oauth-server.mjs");
const { classificationCode, classificationReply, classificationBudget, classificationContext } = await fromRepo("tests/fixtures/classification-host.mjs");
const { imageCode, imageReply, imageDigest, imageBudget, imageContext } = await fromRepo("tests/fixtures/image-host.mjs");
const { codingRequest } = await fromRepo("tests/fixtures/mcp-write-host.mjs");
const terminal = task => ["succeeded", "failed", "cancelled", "interrupted"].includes(task.status);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fullCode = `text(await tools.read({path:"README.md"})); text(await tools.mcp__local__read_file({path:"README.md"})); text(await tools.mcp__http__echo({value:"N14-http"})); text(await tools.mcp__oauth__echo({value:"N14-oauth"})); { ${classificationCode} } { ${imageCode} } store("n14","integrated");`;

export async function createIntegratedHost({ candidateRoot, evidenceRoot, scenario = "full" }) {
  assert.ok(path.isAbsolute(candidateRoot) && path.isAbsolute(evidenceRoot));
  const omp = path.join(candidateRoot, "only-my-pi/package");
  const candidateImport = relative => import(pathToFileURL(path.join(omp, relative)).href);
  const { loadDistribution } = await candidateImport("packages/distribution/runtime.mjs");
  const stack = await loadDistribution({ packageRoot: omp });
  assert.ok(stack); assert.equal(stack.distribution.runtimeContract, "pi110-v1");
  const { inspectResolvedStack } = await candidateImport("packages/release-stack/release-builder.mjs");
  const checked = await inspectResolvedStack({ resolvedRoot: candidateRoot, stackManifest: JSON.parse(await fs.readFile(path.join(candidateRoot, "stack-manifest.json"), "utf8")) });
  await fs.mkdir(evidenceRoot, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(path.join(evidenceRoot, "journey-")));
  const config = path.join(root, "config"), home = path.join(root, "home"), project = path.join(root, "project");
  for (const directory of [config, home, project]) await fs.mkdir(directory);
  await fs.writeFile(path.join(project, "README.md"), "N14 synthetic project\n");
  await promisify(execFile)("git", ["init", "--quiet"], { cwd: project });
  await promisify(execFile)("git", ["add", "README.md"], { cwd: project });
  await promisify(execFile)("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "N14"], { cwd: project });
  let host, remote, oauth, provider, modelService, cookie, projectId, closing;
  let code = fullCode, modelMode = "normal";
  const chat = [], received = [], sockets = new Set();
  const env = { PATH: `${path.dirname(stack.nodePath)}:/usr/bin:/bin:/opt/homebrew/bin`, HOME: home, TERM: "xterm-256color", LANG: "en_US.UTF-8", PI_CODING_AGENT_DIR: config, PI_CODING_AGENT_SESSION_DIR: path.join(config, "sessions"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" };
  const closeServer = async server => { if (server?.listening) await new Promise(resolve => server.close(resolve)); };
  const close = () => closing ??= (async () => {
    try { await host?.stop(); }
    finally { for (const socket of sockets) socket.destroy(); await closeServer(provider); await closeServer(modelService); await remote?.close(); await oauth?.close(); }
  })();
  try {
    const listen = async handler => {
      const server = http.createServer(handler);
      server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return server;
    };
    provider = await listen(async (req, res) => {
      let raw = ""; for await (const bytes of req) raw += bytes;
      const body = JSON.parse(raw); chat.push({ model: body.model, lastRole: body.messages.at(-1)?.role });
      const count = body.messages.slice(body.messages.findLastIndex(message => message.role === "user")).filter(message => message.role === "tool").length;
      const writing = scenario.startsWith("write");
      providerReply(res, writing && count === 0 ? "request_coding_access" : count < (writing ? 2 : 1) ? "codemode" : null, writing && count === 0 ? codingRequest : { code });
    });
    modelService = await listen(async (req, res) => {
      let raw = ""; for await (const bytes of req) raw += bytes;
      const body = JSON.parse(raw), kind = body.model === "checkerboard" ? "image" : "classifier";
      received.push({ requestId: req.headers["x-omp-model-request-id"], kind, model: body.model, account: req.headers.authorization === `Bearer ${kind}-synthetic` ? kind : req.headers.authorization === `Bearer ${kind}-synthetic-b` ? `${kind}-B` : "unexpected", mode: modelMode });
      if (modelMode === "drop") { req.socket.destroy(); return; }
      if (modelMode === "hold") { res.once("close", () => {}); return; }
      if (modelMode === "delay") await new Promise(resolve => setTimeout(resolve, 200));
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(kind === "image" ? imageReply : classificationReply));
    });
    const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
    await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "one", tuiMode: "regular", cacheWarming: "idle", enableAnalytics: false, onlyMyPi: { packageBindings: [] } }));
    await fs.writeFile(path.join(config, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "chat-synthetic" } }), { mode: 0o600 });
    await fs.writeFile(path.join(config, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl, api: "openai-completions", models: [{ id: "one", name: "N14 controlled chat", input: ["text"], contextWindow: 32000, maxTokens: 128 }] } } }));
    remote = await createHttpMcpServer(); oauth = await createOAuthMcpServer();
    const { runWebCommand, hostEndpoint, hostControl } = await candidateImport("packages/host/cli.mjs");
    const { processIdentity } = await candidateImport("packages/host/ownership.mjs");
    const web = argv => runWebCommand({ argv, packageRoot: omp, env, openBrowser: async () => {} });
    const open = async () => {
      assert.equal((await web(["start"])).status, "HOST_RUNNING");
      const endpoint = await hostEndpoint(config);
      host = { ...endpoint, pairingUrl: (await hostControl(endpoint, "pair", "POST")).url,
        stop: async () => { assert.ok(["HOST_STOPPED", "HOST_NOT_RUNNING"].includes((await web(["stop"])).status)); } };
    };
    const pair = async () => {
      const response = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
      assert.equal(response.status, 200); cookie = response.headers.get("set-cookie").split(";")[0];
    };
    await open(); await pair();
    const request = async (route, input, expected = 200) => {
      const response = await fetch(host.origin + route, { method: input ? "POST" : "GET", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-mcp-protocol": "1", "x-omp-account-protocol": "1", "x-omp-input-protocol": "1", "x-omp-image-export-protocol": "1" }, ...(input ? { body: JSON.stringify(input) } : {}) });
      const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
    };
    projectId = (await request("/api/command", { type: "addProject", path: project })).projectId;
    const mcp = (input, expected) => request("/api/mcp", { ...input, projectId }, expected);
    const start = (extra = {}) => request("/api/command", { type: "startTask", requestId: randomUUID(), projectId, accountId: "cli-readonly", model: "fixture/one", prompt: "N14 integrated journey", ...extra }, 202);
    const task = id => request(`/api/task?taskId=${id}`);
    const calls = () => request(`/api/model-calls?projectId=${projectId}`);
    const configure = async () => {
      const serviceFile = path.join(repo, "tests/fixtures/mcp-server.mjs");
      for (const server of [
        { name: "local", transport: "stdio", command: stack.nodePath, args: [serviceFile], codePaths: [serviceFile], env: {}, credentialRefs: {}, tools: [{ name: "read_file", effect: "read", pathArgument: "path", paths: ["README.md"] }], enabled: false },
        ...[["http", remote.url], ["oauth", oauth.url]].map(([name, url]) => ({ name, transport: "streamable-http", url, credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }], enabled: false })),
      ]) { const saved = await mcp({ type: "save", revision: (await mcp({ type: "list" })).revision, server }); await mcp({ type: "enable", name: server.name, revision: saved.revision, enabled: true }); }
      await mcp({ type: "credential", name: "http", envName: "MCP_TOKEN", revision: (await mcp({ type: "list" })).revision, value: remote.token });
      const modelOrigin = `http://127.0.0.1:${modelService.address().port}`;
      for (const kind of ["classifier", "image"]) {
        const providerId = kind === "image" ? "fixtureimage" : "fixtureclass", id = kind === "image" ? "checkerboard" : "sentiment";
        const account = (await request("/api/accounts", { name: `N14 ${kind}`, providerId, authType: "api_key" }, 201)).account;
        const action = action => request("/api/account-action", { accountId: account.accountId, action });
        await action({ type: "configure", config: { baseUrl: modelOrigin + (kind === "image" ? "/v1" : ""), api: kind === "image" ? "openrouter-images" : "typesafe-system-one", models: [{ type: kind, id, name: `N14 ${kind}`, contextWindow: 8192, ...(kind === "image" ? { input: ["text"], output: ["image", "text"] } : {}) }] } });
        await action({ type: "apiKey", key: `${kind}-synthetic` });
        await request("/api/model-calls", { type: "save", projectId, revision: (await calls()).config.revision, [kind]: { accountId: account.accountId, model: `${providerId}/${id}`, budget: kind === "image" ? imageBudget : classificationBudget } });
      }
    };
    const login = async () => {
      const flow = await mcp({ type: "oauthStart", name: "oauth", revision: (await mcp({ type: "list" })).revision });
      const opened = await fetch(host.origin + `/api/mcp-oauth/open?flowId=${flow.flowId}`, { headers: { Origin: host.origin, Cookie: cookie }, redirect: "manual" }); assert.equal(opened.status, 303);
      const authorized = await fetch(opened.headers.get("location"), { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" }); assert.equal(authorized.status, 303);
      assert.equal((await fetch(authorized.headers.get("location"))).status, 200);
      await until(() => mcp({ type: "oauthStatus", flowId: flow.flowId }), flow => flow.status === "stored", "N14 OAuth stored", 15000);
    };
    const selectScenario = value => {
      scenario = value; modelMode = value === "image-unknown" ? "drop" : ["image-cancel", "image-crash"].includes(value) ? "hold" : value.endsWith("parallel") ? "delay" : "normal";
      remote.setMode(value === "http-unknown" ? "disconnect" : "json");
      code = value === "full" ? fullCode : value === "ordinary" ? 'text(await tools.read({path:"README.md"}));' : value === "http-unknown" ? 'text(await tools.mcp__http__echo({value:"N14-unknown"}));' : value === "parallel" ? `const m = await models.getModelOfType("image","fixtureimage","checkerboard"); text((await Promise.allSettled([models.generateImages(m,${JSON.stringify(imageContext)}),models.generateImages(m,${JSON.stringify(imageContext)})])).map(r=>r.status==="rejected"?{status:r.status,error:String(r.reason)}:{status:r.status,artifacts:r.value.artifacts}));` : value === "class-parallel" ? `const m = await models.getModelOfType("classifier","fixtureclass","sentiment"); text((await Promise.allSettled([models.classify(m,${JSON.stringify(classificationContext)}),models.classify(m,${JSON.stringify(classificationContext)})])).map(r=>r.status==="rejected"?{status:r.status,error:String(r.reason)}:{status:r.status}));` : value === "restore" ? 'text(load("n14"));' : value === "restore-read" ? 'text(load("n14")); text(await tools.read({path:"README.md"}));' : value.startsWith("write") ? `${value === "write" ? 'text(await tools.write({path:"README.md",content:"ordinary child bytes\\n"}));' : ""}text(await tools.mcp__writer__write_file({path:"README.md",text:"N14 descriptor bytes\\n"}));` : value.startsWith("image") ? imageCode : classificationCode;
    };
    const configureWrite = async (mode) => {
      const service = path.join(repo, "tests/fixtures/mcp-write-server.mjs");
      await mcp({ type: "save", revision: (await mcp({ type: "list" })).revision, server: { name: "writer", transport: "stdio", enabled: true, command: stack.nodePath, args: [service], codePaths: [service], env: mode ? { F_MODE: mode } : {}, credentialRefs: {}, tools: [{ name: "write_file", effect: "write", writeMode: "descriptor", pathArgument: "path", paths: ["README.md"] }] } });
    };
    selectScenario(scenario);
    const reception = async (offline = false) => {
      const runs = (offline ? await cli(["admin", "mcp", "status", "--project", project]) : await mcp({ type: "status" })).runs, stdio = [];
      for (const run of runs) for (const process of run.processes.filter(p => p.transport === "stdio")) for (const entry of (await fs.readFile(path.join(process.runtimeDir, "received.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)) stdio.push({ runId: run.runId, taskId: run.taskId, ...entry });
      return { runs, stdio, http: remote.received, oauth: oauth.received, models: received, chatCount: chat.length, ledger: offline ? await cli(["admin", "image", "status", "--project", project]) : await calls(), readback: offline ? "actual candidate CLI after Host unavailable" : "actual Host HTTP" };
    };
    const receipt = async (offline = false) => ({ scope: "PI110-N14_SAME_PRIVATE_CANDIDATE_C_P_B", root, candidateRoot, nodePath: stack.nodePath, nodeVersion: process.version, nodeSha256: digest(await fs.readFile(stack.nodePath)), sdkSha256: digest(await fs.readFile(path.join(candidateRoot, "pi/dist/index.js"))), probeSha256: digest(await fs.readFile(fileURLToPath(import.meta.url))), stackId: stack.stackId, distributionId: stack.distribution.distributionId, checked, scenario, ...(await reception(offline)) });
    const approve = async id => {
      for (let i = 0; i < 16; i++) {
        const waiting = await until(() => task(id), t => t.approvals.length || terminal(t), "N14 approval or terminal", 30000);
        if (terminal(waiting)) return waiting;
        for (const approval of waiting.approvals) await request("/api/command", { type: "answerApproval", taskId: id, approvalId: approval.approvalId, value: approval.options.includes("本任务，按其他额度运行") ? "本任务，按其他额度运行" : approval.options.includes("仅本次") ? "仅本次" : approval.options[0] });
      }
      assert.fail("too many approvals");
    };
    const authorize = async id => {
      const waiting = await until(() => task(id), t => t.approvals.length || terminal(t), "N14 explicit approval", 30000);
      assert.ok(waiting.approvals.length, JSON.stringify(waiting));
      const approval = waiting.approvals[0];
      await request("/api/command", { type: "answerApproval", taskId: id, approvalId: approval.approvalId, value: approval.options.includes("本任务，按其他额度运行") ? "本任务，按其他额度运行" : approval.options.includes("仅本次") ? "仅本次" : approval.options[0] });
      return approval;
    };
    const restart = async ({ crash = false } = {}) => {
      const previous = { pid: host.pid, identity: host.identity, epoch: host.epoch, cookie };
      if (crash) { process.kill(host.pid, "SIGKILL"); await until(() => processIdentity(previous.pid), value => value !== previous.identity, "Host process exited", 5000); }
      else await host.stop();
      await open(); await pair(); return previous;
    };
    const cli = async args => JSON.parse((await promisify(execFile)(stack.nodePath, [stack.ompCliPath, ...args], { env, cwd: project, timeout: 30000, maxBuffer: 4194304 })).stdout);
    return { root, project, config, home, env, stack, omp, modelOrigin: `http://127.0.0.1:${modelService.address().port}`, cliPath: stack.ompCliPath, cli, web, projectId, remote, oauth, received, chat, request, mcp, start, task, calls, configure, configureWrite, login, selectScenario, reception, receipt, approve, authorize, close,
      get host() { return host; }, get cookie() { return cookie; }, restart,
      pairing: async () => (await fetch(host.origin + "/internal/pair", { method: "POST", headers: { authorization: `Bearer ${host.controlToken}` } }).then(r => r.json())).url,
    };
  } catch (error) { await close(); throw error; }
}

const [mode, candidateRoot, evidenceRoot] = process.argv.slice(2);
if (mode === "--run") await runAcceptance({ candidateRoot, evidenceRoot });
if (mode === "--faults") await runAcceptance({ candidateRoot, evidenceRoot, faultsOnly: true });
if (mode === "--serve") {
  const f = await createIntegratedHost({ candidateRoot, evidenceRoot }); await f.configure();
  const control = http.createServer(async (req, res) => {
    try {
      let value;
      if (req.url === "/restart") await f.restart();
      else if (req.url === "/crash") await f.restart({ crash: true });
      else if (req.url === "/writer") await f.configureWrite();
      else if (req.url.startsWith("/scenario/")) f.selectScenario(req.url.slice(10));
      else if (req.url === "/receipt") value = await f.receipt();
      else if (req.url === "/kill-worker") { const run = (await f.mcp({ type: "status" })).runs.at(-1); process.kill(run.ownerPid, "SIGKILL"); }
      else if (req.url === "/file") value = await fs.readFile(path.join(f.project, "README.md"), "utf8");
      else if (req.url !== "/pair") throw new Error("UNKNOWN_CONTROL");
      value ??= { origin: f.host.origin, pairingUrl: await f.pairing(), projectId: f.projectId, project: f.project, config: f.config };
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value));
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.code ?? error.message })); }
  });
  await new Promise(resolve => control.listen(0, "127.0.0.1", resolve));
  await fs.writeFile(path.join(evidenceRoot, "browser-control.json"), JSON.stringify({ control: `http://127.0.0.1:${control.address().port}`, origin: f.host.origin, pairingUrl: await f.pairing(), projectId: f.projectId, project: f.project, config: f.config }), { mode: 0o600 });
  console.log(JSON.stringify({ ready: true, origin: f.host.origin, stackId: f.stack.stackId }));
  process.once("SIGTERM", async () => { await fs.writeFile(path.join(evidenceRoot, "browser-final-receipt.json"), JSON.stringify(await f.receipt(), null, 2)); await f.close(); await new Promise(resolve => control.close(resolve)); });
}

export { fullCode, imageDigest, imageCode, classificationCode, terminal, until, digest };

async function runAcceptance({ candidateRoot, evidenceRoot, faultsOnly = false }) {
  const f = await createIntegratedHost({ candidateRoot, evidenceRoot });
  const checks = [], tasks = [];
  const save = async () => {
    let receipt;
    try { receipt = await f.receipt(); }
    catch (error) { receipt = { ...(await f.receipt(true)), hostReadbackError: error.code ?? error.message }; }
    await fs.writeFile(path.join(evidenceRoot, "receipt.json"), JSON.stringify({ ...receipt, checks, tasks }, null, 2));
  };
  const check = async (name, execute) => {
    const startedAt = new Date().toISOString();
    try { const evidence = await execute(); checks.push({ name, status: "PASS", startedAt, endedAt: new Date().toISOString(), evidence }); console.log(`PASS ${name}`); }
    catch (error) { checks.push({ name, status: "FAIL", startedAt, endedAt: new Date().toISOString(), error: error.stack }); throw error; }
    finally { await save(); }
  };
  const finish = async (id) => { const task = await until(() => f.task(id), terminal, "integrated task settled", 30000); tasks.push(task); return task; };
  const run = async (scenario, extra) => { f.selectScenario(scenario); const task = await f.start(extra); const done = await f.approve(task.taskId); tasks.push(done); return done; };
  const ledgerTask = async id => (await f.calls()).tasks.find(task => task.taskId === id);
  const session = async task => (await until(() => f.request(`/api/sessions?projectId=${f.projectId}`), value => value.sessions.some(session => session.sessionId === task.sessionId), "session published", 15000)).sessions.find(session => session.sessionId === task.sessionId);
  let complete, original, reference, sessionBytes, sessionFile;
  try {
    await f.configure(); await f.login();
    if (!faultsOnly) {
    await check("verified candidate and public Host CLI", async () => {
      const status = await f.cli(["web", "status", "--json"]); assert.equal(status.status, "HOST_RUNNING");
      const html = await (await fetch(f.host.origin)).text(); assert.equal(html, await fs.readFile(path.join(f.omp, "webui/dist/index.html"), "utf8"));
      const pi = JSON.parse(await fs.readFile(path.join(candidateRoot, "pi/package.json"))); assert.equal(pi.version, "1.1.0");
      return { pid: f.host.pid, epoch: f.host.epoch, sourceCommit: f.stack.distribution.sourceCommit, cliPath: f.cliPath, pi: pi.version };
    });
    await check("ordinary + stdio + HTTP + OAuth + classifier + image in one native script", async () => {
      const start = await f.start();
      await until(() => f.task(start.taskId), task => task.approvals.length, "initial ordinary approval", 30000);
      assert.equal(f.received.length, 0); assert.equal(f.remote.received.filter(entry => entry.rpc === "tools/call").length, 0);
      complete = await f.approve(start.taskId); tasks.push(complete); assert.equal(complete.status, "succeeded", JSON.stringify(complete));
      const parent = complete.toolCalls.find(call => call.name === "codemode"); assert.equal(parent.status, "completed");
      const children = complete.toolCalls.filter(call => call.parentToolCallId === parent.toolCallId);
      assert.deepEqual(children.map(call => [call.name, call.status]), [["read", "completed"], ["mcp__local__read_file", "completed"], ["mcp__http__echo", "completed"], ["mcp__oauth__echo", "completed"]]);
      const reception = await f.reception(); assert.equal(reception.stdio.filter(entry => entry.type === "call").length, 1);
      assert.equal(reception.http.filter(entry => entry.rpc === "tools/call").length, 1); assert.equal(reception.oauth.filter(entry => entry.rpc === "tools/call").length, 1);
      const ledger = await ledgerTask(complete.taskId); assert.deepEqual(ledger.requests.map(request => request.kind), ["classifier", "image"]);
      for (const request of ledger.requests) {
        assert.equal(request.status, "completed"); assert.equal(request.parentToolCallId, parent.toolCallId);
        assert.equal(f.received.filter(entry => entry.requestId === request.requestId && entry.account === request.kind).length, 1);
        assert.equal(request.usage.tokens.input, 12); assert.equal(request.usage.tokens.output, 3); assert.equal(request.usage.estimatedCost, null);
      }
      assert.equal(ledger.requests[1].storage.artifacts[0].sha256, imageDigest);
      const count = f.chat.length; await new Promise(resolve => setTimeout(resolve, 2100)); assert.equal(f.chat.length, count, "idle cache warming must add zero requests");
      original = await session(complete);
      const candidates = await fs.readdir(path.join(f.config, "sessions"), { recursive: true });
      for (const relative of candidates.filter(file => file.endsWith(".jsonl"))) { const file = path.join(f.config, "sessions", relative), bytes = await fs.readFile(file); if (JSON.parse(bytes.toString().split("\n")[0]).id === complete.sessionId) { sessionFile = file; sessionBytes = bytes; break; } }
      assert.ok(sessionFile);
      return { taskId: complete.taskId, sessionId: complete.sessionId, parentToolCallId: parent.toolCallId, children, requests: ledger.requests, sourceFile: sessionFile };
    });
    await check("restart, history and CLI reuse actual image without regeneration", async () => {
      const received = f.received.length, previous = await f.restart(); assert.notEqual(f.host.epoch, previous.epoch);
      assert.equal((await fetch(f.host.origin + "/api/state", { headers: { Cookie: previous.cookie } })).status, 401);
      await session(complete);
      const history = await f.request(`/api/history?sessionKey=${original.sessionKey}`); assert.ok(history.messages.some(message => message.toolName === "codemode"));
      const images = await f.request(`/api/session-images?projectId=${f.projectId}&sessionKey=${original.sessionKey}`); reference = images.images[0];
      assert.equal(reference.state, "available"); assert.equal(reference.artifact.sha256, imageDigest); assert.equal(reference.artifact.sessionId, complete.sessionId);
      const query = new URLSearchParams({ projectId: f.projectId, sessionKey: original.sessionKey, entryId: reference.entryId, requestId: reference.artifact.requestId, index: "0", download: "1" });
      const response = await fetch(f.host.origin + `/api/image-artifact?${query}`, { headers: { Cookie: f.cookie } }); assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /^attachment;/);
      assert.equal(digest(Buffer.from(await response.arrayBuffer())), imageDigest);
      const cli = await f.cli(["image", "history", sessionFile, "--project", f.project]); assert.equal(cli.images[0].artifact.sha256, imageDigest);
      assert.deepEqual(await fs.readFile(sessionFile), sessionBytes); assert.equal(f.received.length, received);
      return { sessionKey: original.sessionKey, artifact: reference.artifact, historyMessages: history.messages.length, receiverDelta: 0 };
    });
    await check("export consent, physical terminal conflict, exact bytes and idempotent commit", async () => {
      const plan = await f.request("/api/image-export", { type: "prepare", projectId: f.projectId, sessionKey: original.sessionKey, entryId: reference.entryId, requestId: reference.artifact.requestId, index: 0, path: "n14.png" });
      const commit = { type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: false };
      await f.request("/api/image-export", { ...commit, codingAuthorized: false }, 403); await assert.rejects(fs.access(path.join(f.project, "n14.png")), { code: "ENOENT" });
      const shell = await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 100, rows: 30 });
      await f.request("/api/command", { type: "writeTerminal", terminalId: shell.terminalId, seq: 1, data: "printf native-terminal > terminal-proof.txt\r" });
      await until(() => fs.readFile(path.join(f.project, "terminal-proof.txt"), "utf8").catch(() => ""), text => text === "native-terminal", "terminal actual file");
      assert.equal((await f.request("/api/image-export", commit, 500)).code, "OWNERSHIP_HELD");
      const blocked = await run("write", { mode: "controlled" }); assert.equal(blocked.error, "OWNERSHIP_HELD");
      assert.equal((await f.request("/api/command", { type: "closeTerminal", terminalId: shell.terminalId })).status, "closed");
      const done = await f.request("/api/image-export", commit); assert.equal(done.status, "completed", JSON.stringify(done));
      const file = path.join(f.project, "n14.png"), before = await fs.stat(file); assert.equal(digest(await fs.readFile(file)), imageDigest);
      assert.equal((await f.request("/api/image-export", commit)).status, "completed"); assert.equal((await fs.stat(file)).ino, before.ino);
      return { export: done, fileSha256: imageDigest, inode: before.ino, terminalId: shell.terminalId, blockedTaskId: blocked.taskId };
    });
    await check("export publication with a lost durable receipt requires explicit reconciliation after Host crash", async () => {
      const source = { type: "prepare", projectId: f.projectId, sessionKey: original.sessionKey, entryId: reference.entryId, requestId: reference.artifact.requestId, index: 0, path: "n14-unknown.png" };
      const prepared = await f.request("/api/image-export", source), directory = path.join(f.config, "only-my-pi/image-exports"), journal = path.join(directory, `${prepared.operationId}.json`);
      const originalMode = (await fs.stat(directory)).mode & 0o777;
      const before = f.received.length;
      const committing = f.request("/api/image-export", { type: "commit", operationId: prepared.operationId, codingAuthorized: true, overwrite: false });
      let worker, result;
      try {
        const deadline = Date.now() + 10000;
        while (!worker) {
          worker = JSON.parse(await fs.readFile(journal, "utf8")).worker;
          assert.ok(Date.now() < deadline, "real export worker must be durably identified before the injected storage fault");
          if (!worker) await new Promise(resolve => setTimeout(resolve, 1));
        }
        await fs.chmod(directory, 0o500);
        result = await committing;
      } finally { await fs.chmod(directory, originalMode); await committing.catch(() => {}); }
      assert.equal(result.status, "unknown", JSON.stringify(result));
      const bytes = await fs.readFile(path.join(f.project, source.path)), published = await fs.stat(path.join(f.project, source.path));
      assert.equal(digest(bytes), imageDigest);
      const durable = JSON.parse(await fs.readFile(journal, "utf8")); assert.equal(durable.status, "dispatched"); assert.ok(durable.worker.pid);
      const previous = await f.restart({ crash: true });
      assert.equal((await f.request("/api/image-export", source, 409)).code, "IMAGE_EXPORT_RECONCILIATION_REQUIRED");
      assert.equal((await f.request("/api/image-export", { type: "commit", operationId: prepared.operationId, codingAuthorized: true, overwrite: false }, 409)).code, "IMAGE_EXPORT_RECONCILIATION_REQUIRED");
      assert.equal((await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 100, rows: 30 }, 500)).code, "OWNER_RECONCILIATION_REQUIRED");
      const reconciled = await f.request("/api/image-export", { type: "reconcile", operationId: prepared.operationId });
      assert.equal(reconciled.status, "completed"); assert.equal(reconciled.reconciled, true);
      assert.equal((await fs.stat(path.join(f.project, source.path))).ino, published.ino); assert.deepEqual(await fs.readFile(path.join(f.project, source.path)), bytes);
      assert.equal(f.received.length, before);
      const shell = await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 100, rows: 30 });
      assert.equal((await f.request("/api/command", { type: "closeTerminal", terminalId: shell.terminalId })).status, "closed");
      return { operationId: prepared.operationId, worker, oldHostPid: previous.pid, responseStatus: result.status, durableStatus: durable.status, reconciled: true, sha256: imageDigest, inode: published.ino, receiverDelta: 0 };
    });
    await check("native store resume appends new work while an explicit branch preserves source bytes and requests fresh authority", async () => {
      const received = f.received.length, done = await run("restore", { resumeSessionKey: original.sessionKey });
      assert.equal(done.status, "succeeded", JSON.stringify(done)); assert.match(done.toolCalls.find(call => call.name === "codemode").result, /integrated/);
      assert.equal(done.sessionId, complete.sessionId);
      const resumed = await fs.readFile(sessionFile);
      assert.deepEqual(resumed.subarray(0, sessionBytes.length), sessionBytes, "a valid resume must retain every original entry while appending new work");
      assert.ok(resumed.length > sessionBytes.length);
      const sdk = await import(pathToFileURL(path.join(candidateRoot, "pi/dist/index.js")));
      const { SessionAdmissions } = await import(pathToFileURL(path.join(f.omp, "packages/direct-agent/session-admission.mjs")));
      const source = sdk.SessionManager.open(sessionFile), stored = source.getEntries().find(entry => entry.type === "custom" && entry.customType === "codemode-store"); assert.ok(stored);
      const admissions = new SessionAdmissions(f.config, { loadSdk: async () => sdk });
      let branch;
      try { branch = await admissions.create(f.project, path.dirname(sessionFile), { sourceFile: sessionFile, leafId: stored.id }); }
      finally { await admissions.close(); }
      const branched = await session({ sessionId: branch.getSessionId() });
      f.selectScenario("restore-read"); const started = await f.start({ resumeSessionKey: branched.sessionKey });
      const waiting = await until(() => f.task(started.taskId), task => task.approvals.length || terminal(task), "branched history must request fresh ordinary authority", 30000);
      assert.equal(waiting.approvals.length, 1); assert.match(waiting.approvals[0].title, /Codemode · read/);
      assert.equal(f.received.length, received);
      const final = await f.approve(started.taskId); tasks.push(final); assert.equal(final.status, "succeeded"); assert.notEqual(final.sessionId, complete.sessionId);
      assert.match(final.toolCalls.find(call => call.name === "codemode").result, /integrated/);
      assert.deepEqual(await fs.readFile(sessionFile), resumed, "branch execution must not rewrite its source"); assert.equal(f.received.length, received);
      assert.equal((await ledgerTask(final.taskId)).requests.length, 0);
      return { resumedTaskId: done.taskId, branchTaskId: final.taskId, branchSessionId: final.sessionId, sourcePrefixSha256: digest(sessionBytes), sourceSha256: digest(resumed), freshApproval: waiting.approvals[0].approvalId, receiverDelta: 0 };
    });
    await check("native edited context and future-reader rejection preserve original bytes", async () => {
      const { SessionManager } = await import(pathToFileURL(path.join(candidateRoot, "pi/dist/index.js")));
      const manager = SessionManager.create(f.project, path.join(f.config, "sessions"));
      const user = manager.appendMessage({ role: "user", content: "original N14 input", timestamp: 1 });
      const assistant = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "original N14 answer" }], timestamp: 2 });
      manager.appendContextEdit(user, { content: "edited N14 input" }); manager.appendContextEdit(assistant, null);
      manager.appendUsage("cache_warm", "fixture", "one", { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
      const file = manager.getSessionFile(), bytes = await fs.readFile(file), selected = await session({ sessionId: manager.getSessionId() });
      const history = await f.request(`/api/history?sessionKey=${selected.sessionKey}`);
      assert.deepEqual(history.messages.map(message => message.text), ["original N14 input", "original N14 answer"]);
      assert.deepEqual(history.context.messages.map(message => message.text), ["edited N14 input"]); assert.equal(history.context.minimumReader, "1.1.0"); assert.equal(history.context.usage[0].kind, "cache_warm");
      assert.deepEqual(await fs.readFile(file), bytes);
      await fs.appendFile(file, JSON.stringify({ type: "future_entry", id: "future", parentId: assistant }) + "\n"); const future = await fs.readFile(file);
      const chats = f.chat.length, received = f.received.length;
      assert.equal((await f.request(`/api/history?sessionKey=${selected.sessionKey}`, undefined, 500)).code, "SESSION_READER_UPGRADE_REQUIRED");
      const rejected = await f.request("/api/command", { type: "startTask", requestId: randomUUID(), projectId: f.projectId, accountId: "cli-readonly", model: "fixture/one", prompt: "future history must be refused", resumeSessionKey: selected.sessionKey }, 500); assert.equal(rejected.code, "SESSION_READER_UPGRADE_REQUIRED");
      assert.equal(f.chat.length, chats); assert.equal(f.received.length, received); assert.deepEqual(await fs.readFile(file), future);
      return { sessionKey: selected.sessionKey, minimumReader: history.context.minimumReader, futureRefusal: rejected.code, receiverDelta: 0, syntheticUsageEntry: true };
    });
    for (const scenario of ["parallel", "class-parallel"]) await check(`${scenario} shares request and concurrency reservations`, async () => {
      const received = f.received.length, done = await run(scenario); assert.equal(f.received.length - received, 1);
      assert.match(done.toolCalls.find(call => call.name === "codemode").result, /MODEL_BUDGET_EXHAUSTED/);
      const ledger = await ledgerTask(done.taskId); assert.equal(ledger.requests.length, 1); assert.equal(ledger.requests[0].status, "completed");
      return { taskId: done.taskId, requests: ledger.requests, receiverDelta: 1 };
    });
    await check("CLI configuration affects later work while a pending native task keeps its account snapshot", async () => {
      const before = (await f.calls()).config, selected = { accountId: before.image.accountId, model: before.image.model, budget: before.image.budget };
      const account = (await f.request("/api/accounts", { name: "N14 image B", providerId: "fixtureimage", authType: "api_key" }, 201)).account;
      const old = { baseUrl: f.modelOrigin + "/v1", api: "openrouter-images", models: [{ type: "image", id: "checkerboard", name: "N14 image B", contextWindow: 8192, input: ["text"], output: ["image", "text"] }] };
      await f.request("/api/account-action", { accountId: account.accountId, action: { type: "configure", config: old } });
      await f.request("/api/account-action", { accountId: account.accountId, action: { type: "apiKey", key: "image-synthetic-b" } });
      f.selectScenario("image"); const received = f.received.length, first = await f.start();
      await until(() => f.task(first.taskId), task => task.approvals.length, "old account pending consent", 30000);
      const file = path.join(f.root, "next-image-config.json"); await fs.writeFile(file, JSON.stringify({ revision: before.revision, image: { ...selected, accountId: account.accountId } }));
      await f.cli(["image", "apply", file, "--project", f.project]); const done = await f.approve(first.taskId); tasks.push(done);
      const next = await run("image");
      const a = await ledgerTask(first.taskId), b = await ledgerTask(next.taskId);
      assert.equal(a.snapshot.image.accountId, selected.accountId); assert.equal(b.snapshot.image.accountId, account.accountId); assert.equal(a.snapshot.revision, before.revision); assert.equal(b.snapshot.revision, before.revision + 1);
      assert.deepEqual(f.received.slice(received).map(entry => entry.account), ["image", "image-B"]);
      await f.request("/api/model-calls", { type: "save", projectId: f.projectId, revision: (await f.calls()).config.revision, image: selected });
      return { firstTaskId: first.taskId, nextTaskId: next.taskId, snapshots: [a.snapshot, b.snapshot], receiverDelta: 2 };
    });
    await check("revoke pending model permission invalidates approval and sends zero requests", async () => {
      f.selectScenario("image"); const received = f.received.length, start = await f.start();
      const waiting = await until(() => f.task(start.taskId), task => task.approvals.length, "image pending revocation", 30000);
      await f.request("/api/command", { type: "revokeTask", taskId: start.taskId });
      await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务，按其他额度运行" }, 409);
      await f.request("/api/command", { type: "cancelTask", taskId: start.taskId }, 202); await finish(start.taskId);
      assert.equal(f.received.length, received); return { taskId: start.taskId, receiverDelta: 0 };
    });
    for (const mode of ["fullscreen", "regular"]) await check(`actual CLI ${mode} keyboard approval, resize, zero warm requests and PTY restoration`, async () => {
      f.selectScenario("ordinary");
      const { spawn } = createRequire(path.join(f.omp, "package.json"))("node-pty");
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      const args = [f.stack.nodePath, f.cliPath, "--model", "fixture/one", "--no-session", ...(mode === "regular" ? ["--tui-mode", "regular"] : [])];
      const script = `printf 'N14_STTY_BEFORE='; stty -g; ${args.map(quote).join(" ")}; code=$?; printf '\\nN14_EXIT_CODE=%s\\nN14_STTY_AFTER=' "$code"; stty -g; printf 'N14_SHELL_READY\\n'; read -r answer`;
      const tty = spawn("/bin/sh", ["-c", script], { cwd: f.project, env: f.env, cols: 120, rows: 40 });
      let output = "", exited; tty.onData(data => { output += data; }); tty.onExit(value => { exited = value; });
      const before = f.chat.length;
      try {
        await until(() => output, text => text.includes("Inspect") || text.includes("N14_SHELL_READY"), "candidate TUI ready", 30000);
        assert.ok(output.includes("Inspect"), output); assert.equal(output.includes("\x1b[?1049h"), mode === "fullscreen"); assert.equal(f.chat.length, before);
        tty.resize(132, 42); tty.write("N14 keyboard read\r");
        await until(() => output, text => text.includes("仅本次"), "native ordinary child consent", 15000); assert.equal(f.chat.length, before + 1);
        tty.write("\x1b[B\r"); await until(() => f.chat.length, count => count === before + 2, "native CLI tool result", 15000);
        await until(() => output, text => text.includes("MCP fixture completed"), "native CLI completed text", 15000);
        await new Promise(resolve => setTimeout(resolve, 2100)); assert.equal(f.chat.length, before + 2);
        tty.write("\x04"); await until(() => output, text => text.includes("N14_SHELL_READY"), "same PTY restored", 15000);
        assert.match(output, /N14_EXIT_CODE=0/);
        assert.equal(output.match(/N14_STTY_BEFORE=([^\r\n]+)/)?.[1], output.match(/N14_STTY_AFTER=([^\r\n]+)/)?.[1]);
        if (mode === "fullscreen") assert.ok(output.includes("\x1b[?1049l"));
        tty.write("done\r"); await until(() => exited, Boolean, "PTY child exited"); assert.equal(exited.exitCode, 0);
        assert.equal(JSON.parse(await fs.readFile(path.join(f.config, "settings.json"))).tuiMode, "regular");
        return { args, receiveDelta: 2, warmReceiveDelta: 0, exitCode: exited.exitCode, resizedTo: [132, 42], attributesRestored: true };
      } finally {
        if (!exited) { tty.kill("SIGTERM"); await until(() => exited, Boolean, "owned TUI cleanup", 5000); }
        await fs.writeFile(path.join(evidenceRoot, `tui-${mode}.txt`), output);
      }
    });
    await check("nested ordinary and descriptor writes keep separate grants and one project writer", async () => {
      await f.configureWrite(); f.selectScenario("write"); const start = await f.start({ mode: "controlled" });
      await f.authorize(start.taskId); const ordinary = await until(() => f.task(start.taskId), task => task.approvals.some(approval => approval.title.startsWith("Codemode · write")) || terminal(task), "ordinary write pending");
      assert.ok(ordinary.approvals.length); assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "N14 synthetic project\n");
      assert.equal((await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 100, rows: 30 }, 500)).code, "OWNERSHIP_HELD");
      await f.authorize(start.taskId); await until(() => f.task(start.taskId), task => task.approvals.some(approval => approval.title.startsWith("MCP ·")), "descriptor write pending");
      assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "ordinary child bytes\n");
      const before = (await f.reception()).stdio.filter(entry => entry.type === "call" && entry.name === "write_file").length; assert.equal(before, 0);
      const done = await f.approve(start.taskId); tasks.push(done); assert.equal(done.status, "succeeded", JSON.stringify(done));
      assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "N14 descriptor bytes\n");
      const parent = done.toolCalls.find(call => call.name === "codemode"), children = done.toolCalls.filter(call => call.parentToolCallId === parent.toolCallId);
      assert.deepEqual(children.map(call => [call.name, call.status]), [["write", "completed"], ["mcp__writer__write_file", "completed"]]);
      const reception = await f.reception(), receipts = reception.stdio.filter(entry => entry.taskId === done.taskId);
      assert.equal(receipts.filter(entry => entry.type === "effect").length, 1); assert.equal(receipts.find(entry => entry.type === "call").arguments.path, "/dev/fd/3");
      assert.ok(receipts.filter(entry => entry.type === "startup-write").every(entry => ["EPERM", "EACCES"].includes(entry.code)));
      return { taskId: done.taskId, parentToolCallId: parent.toolCallId, children, receipts };
    });
    for (const change of ["target", "definition"]) await check(`${change} change invalidates pending descriptor grant`, async () => {
      if (change === "definition") await f.configureWrite("notification-startup");
      f.selectScenario("write-direct"); const before = (await f.reception()).stdio.filter(entry => entry.type === "call" && entry.name === "write_file").length;
      const sourceBytes = await fs.readFile(path.join(f.project, "README.md"));
      const start = await f.start({ mode: "controlled" }); await f.authorize(start.taskId);
      await until(() => f.task(start.taskId), task => task.approvals.some(approval => approval.title.startsWith("MCP ·")), "write pending change");
      if (change === "target") await fs.writeFile(path.join(f.project, "README.md"), "changed while pending\n");
      else {
        const status = await f.mcp({ type: "discover", taskId: start.taskId, name: "writer" });
        assert.ok(status.runs.find(run => run.taskId === start.taskId).discoveries.find(entry => entry.server === "writer").epoch > 0);
      }
      const done = await f.approve(start.taskId); tasks.push(done);
      const reception = await f.reception();
      assert.equal(reception.stdio.filter(entry => entry.type === "call" && entry.name === "write_file").length, before);
      if (change === "definition") {
        assert.ok(reception.stdio.some(entry => entry.taskId === done.taskId && entry.type === "notification"));
        assert.deepEqual(await fs.readFile(path.join(f.project, "README.md")), sourceBytes);
      }
      return { taskId: done.taskId, calls: reception.runs.find(run => run.taskId === done.taskId).calls, receiverDelta: 0 };
    });
    await f.configureWrite();
    await check("OAuth cancellation and revocation do not revive identity", async () => {
      const before = f.oauth.received.filter(entry => entry.type === "token").length;
      const flow = await f.mcp({ type: "oauthStart", name: "oauth", revision: (await f.mcp({ type: "list" })).revision });
      await f.mcp({ type: "oauthCancel", flowId: flow.flowId });
      const response = await fetch(f.host.origin + `/api/mcp-oauth/open?flowId=${flow.flowId}`, { headers: { Origin: f.host.origin, Cookie: f.cookie }, redirect: "manual" }); assert.equal(response.status, 409);
      assert.equal(f.oauth.received.filter(entry => entry.type === "token").length, before);
      await f.mcp({ type: "revokeCredential", name: "oauth", envName: "MCP_TOKEN", revision: (await f.mcp({ type: "list" })).revision });
      const oauth = (await f.mcp({ type: "list" })).authentication.oauth;
      f.selectScenario("ordinary"); const chats = f.chat.length, denied = await f.start(); await finish(denied.taskId); assert.equal(f.chat.length, chats);
      await f.mcp({ type: "enable", name: "oauth", revision: (await f.mcp({ type: "list" })).revision, enabled: false });
      return { flowId: flow.flowId, tokenExchangeDelta: 0, oauth, blockedTaskId: denied.taskId, chatDelta: 0 };
    });
    await check("HTTP response loss retains unknown action and blocks replay", async () => {
      const count = f.remote.received.filter(entry => entry.rpc === "tools/call").length, done = await run("http-unknown");
      const record = (await f.mcp({ type: "status" })).runs.find(run => run.taskId === done.taskId); assert.equal(record.calls[0].status, "unknown");
      assert.equal(f.remote.received.filter(entry => entry.rpc === "tools/call").length, count + 1);
      await f.restart(); assert.equal((await f.mcp({ type: "status" })).runs.find(run => run.runId === record.runId).calls[0].status, "unknown");
      f.remote.setMode("json"); const next = await f.start(); const denied = await f.approve(next.taskId); tasks.push(denied);
      assert.match(JSON.stringify(denied), /MCP_REMOTE_RECONCILIATION_REQUIRED/); assert.equal(f.remote.received.filter(entry => entry.rpc === "tools/call").length, count + 1);
      return { taskId: done.taskId, runId: record.runId, receiverDelta: 1, laterTaskId: denied.taskId };
    });
    }
    for (const scenario of faultsOnly ? ["image-crash"] : ["image-unknown", "image-cancel", "image-crash"]) await check(`${scenario} retains unknown identity and never replays on restart`, async () => {
      // Isolate model recovery from the independent live-MCP-process gate.
      // Both stdio and HTTP discovery carry durable process/protocol state.
      // The final check below exercises the gate with a surviving stdio fixture.
      const disabled = [];
      if (scenario === "image-crash") {
        for (const server of (await f.mcp({ type: "list" })).servers.filter(server => server.enabled)) {
          await f.mcp({ type: "enable", name: server.name, revision: (await f.mcp({ type: "list" })).revision, enabled: false });
          disabled.push(server.name);
        }
      }
      f.selectScenario(scenario); const received = f.received.length, start = await f.start(); await f.authorize(start.taskId);
      await until(() => f.received.length, count => count === received + 1, "independent image receive", 10000);
      if (scenario === "image-cancel") await f.request("/api/command", { type: "cancelTask", taskId: start.taskId }, 202);
      if (scenario !== "image-crash") await finish(start.taskId);
      const before = (await ledgerTask(start.taskId)).requests[0];
      const previous = await f.restart({ crash: scenario === "image-crash" });
      const recovered = (await ledgerTask(start.taskId)).requests[0]; assert.equal(recovered.status, "unknown"); assert.equal(recovered.requestId, before.requestId); assert.deepEqual(recovered.reservation, before.reservation);
      assert.equal(f.received.length, received + 1); assert.equal((await ledgerTask(start.taskId)).imagePermission, undefined);
      if (scenario === "image-crash") assert.equal((await f.task(start.taskId)).status, "interrupted");
      for (const name of disabled) await f.mcp({ type: "enable", name, revision: (await f.mcp({ type: "list" })).revision, enabled: true });
      return { taskId: start.taskId, oldHostPid: previous.pid, recovered, receiverDelta: 1, temporarilyDisabledMcp: disabled };
    });
    await check("actual descriptor effect followed by service crash remains unknown", async () => {
      await f.configureWrite("crash"); const before = (await f.reception()).stdio.filter(entry => entry.type === "call" && entry.name === "write_file").length;
      const done = await run("write-direct", { mode: "controlled" });
      const status = await f.mcp({ type: "status" }), runRecord = status.runs.find(run => run.taskId === done.taskId), call = runRecord.calls.find(call => call.tool === "write_file" || call.name === "write_file") ?? runRecord.calls[0];
      assert.equal(call.status, "unknown"); assert.equal(call.application, "unknown"); assert.equal(call.observedChange, true);
      assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "N14 descriptor bytes\n");
      await f.restart(); assert.equal((await f.mcp({ type: "status" })).runs.find(run => run.runId === runRecord.runId).calls[0].status, "unknown");
      assert.equal((await f.reception()).stdio.filter(entry => entry.type === "call" && entry.name === "write_file").length, before + 1);
      return { taskId: done.taskId, runId: runRecord.runId, call, receiverDelta: 1 };
    });
    await check("worker crash retains live MCP residue, unknown model identity and ownership; Host replacement stays blocked", async () => {
      await f.configureWrite("orphan");
      f.selectScenario("image-crash"); const received = f.received.length, start = await f.start(); await f.authorize(start.taskId);
      await until(() => f.received.length, count => count === received + 1, "image receiver before real worker crash", 10000);
      const before = (await ledgerTask(start.taskId)).requests[0], run = (await f.mcp({ type: "status" })).runs.find(run => run.taskId === start.taskId);
      process.kill(run.ownerPid, "SIGKILL");
      const failed = await finish(start.taskId); assert.equal(failed.error, "RPC_TERMINATION_UNCONFIRMED");
      const orphan = (await f.mcp({ type: "status" })).runs.find(item => item.runId === run.runId);
      assert.equal(orphan.status, "reconciliation"); assert.ok(orphan.processes.some(entry => entry.alive));
      const unknown = (await ledgerTask(start.taskId)).requests[0]; assert.equal(unknown.status, "unknown"); assert.equal(unknown.requestId, before.requestId); assert.deepEqual(unknown.reservation, before.reservation);
      const tasksFile = path.join(f.config, "only-my-pi/host/tasks.json");
      const persisted = JSON.parse(await fs.readFile(tasksFile, "utf8")).tasks.find(task => task.taskId === start.taskId); assert.equal(persisted.worker.pid, run.ownerPid);
      const locks = path.join(f.config, "only-my-pi/host/locks"), owners = [];
      for (const name of (await fs.readdir(locks)).filter(name => name.startsWith("session-"))) owners.push({ file: path.join(locks, name, "owner.json"), bytes: await fs.readFile(path.join(locks, name, "owner.json")) });
      assert.ok(owners.length);
      await f.host.stop(); await assert.rejects(f.web(["start"]), { code: "MCP_PROCESS_RECONCILIATION_REQUIRED" });
      for (const owner of owners) assert.deepEqual(await fs.readFile(owner.file), owner.bytes);
      const cliStatus = await f.cli(["admin", "mcp", "status", "--project", f.project]); assert.equal(cliStatus.runs.find(item => item.runId === run.runId).status, "reconciliation");
      assert.equal(f.received.length, received + 1);
      return { taskId: start.taskId, runId: run.runId, orphan, unknown, replacement: "MCP_PROCESS_RECONCILIATION_REQUIRED", preservedSessionOwners: owners.length, receiverDelta: 1, recovery: "blocked until explicit process reconciliation; no recovery or journal clearing claimed" };
    });
  } finally { try { await save(); } finally { await f.close(); } }
}
