import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { WebSocketServer } from "ws";
import { StringDecoder } from "node:string_decoder";
import { atomicWriteJson, ensureConfigDirectory, readJsonObject } from "../config-runtime/index.mjs";
import { acquireOwnership, processIdentity, groupAlive } from "./ownership.mjs";
import { ProjectCatalog } from "./catalog.mjs";
import { HostTasks } from "./tasks.mjs";
import { AccountCatalog } from "./accounts.mjs";
import { accountAuth } from "./account-auth.mjs";
import { AccountOAuth } from "./account-oauth.mjs";
import { recoverAuthProcesses } from "./auth-process.mjs";
import { listModels } from "./models.mjs";
import { listFiles, readFile, gitDiff } from "./inspector.mjs";
import { ManualWorkspaces } from "./manual-workspaces.mjs";
import { HostTerminals } from "./terminals.mjs";
import { HOST_PROTOCOL, HOST_VERSION, CLI_ACCOUNT_ID, hostError, validateCommand, terminal } from "./contracts.mjs";
import { projectRunRecord } from "../direct-agent/contracts.mjs";
import { createRunRecordStore } from "../run-management/index.mjs";

const secret = () => randomBytes(32).toString("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function body(request, limit = 65536) {
  if (request.headers["content-type"] !== "application/json") throw hostError("CONTENT_TYPE_REQUIRED", 415);
  let bytes = 0, text = ""; const decoder = new StringDecoder("utf8");
  for await (const chunk of request) { bytes += chunk.length; if (bytes > limit) throw hostError("REQUEST_TOO_LARGE", 413); text += decoder.write(chunk); }
  text += decoder.end();
  try { return JSON.parse(text); } catch { throw hostError("JSON_INVALID"); }
}
async function recoverWorkers(configRoot, previous) {
  const state = await readJsonObject(configRoot, path.join(configRoot, "only-my-pi/host/tasks.json")).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  for (const task of state?.tasks ?? []) {
    if (terminal(task.status) && !task.worker) continue;
    const worker = task.worker;
    if (worker) {
      const identity = await processIdentity(worker.pid);
      if (identity === worker.start) {
        try { process.kill(-worker.pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") throw e; }
        for (let attempt = 0; attempt < 20 && groupAlive(worker.pid); attempt++) await pause(50);
        if (groupAlive(worker.pid) && await processIdentity(worker.pid) === worker.start) process.kill(-worker.pid, "SIGKILL");
        for (let attempt = 0; attempt < 20 && groupAlive(worker.pid); attempt++) await pause(50);
      }
      if (groupAlive(worker.pid)) throw hostError("ORPHAN_WORKER_REQUIRES_RECONCILIATION", 409);
      // A controlled worker may have owned independent execution groups. Its
      // death is not a cleanup receipt; preserve both project and session locks.
      if (task.mode === "controlled") throw hostError("CONTROLLED_ORPHAN_REQUIRES_RECONCILIATION", 409);
    }
    if (task.sessionId) {
      const digest = createHash("sha256").update(String(task.sessionId)).digest("hex");
      const directory = path.join(configRoot, "only-my-pi/host/locks", `session-${digest}`);
      const owner = await readJsonObject(configRoot, path.join(directory, "owner.json")).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
      if (owner?.pid === previous.pid && owner.identity === previous.identity) { await fs.unlink(path.join(directory, "owner.json")); await fs.rmdir(directory); }
    }
  }
}

export async function startHost({ configRoot, stack, assetsRoot, sessionRoot = path.join(configRoot, "sessions"), workerFactory, modelsProvider, allowControlled = false, env = process.env }) {
  if (![configRoot, sessionRoot, assetsRoot].every((p) => typeof p === "string" && path.isAbsolute(p))) throw hostError("HOST_PATH_INVALID");
  await fs.access(path.join(assetsRoot, "index.html"));
  await ensureConfigDirectory(configRoot, "only-my-pi/host");
  const lock = await acquireOwnership(configRoot, "host", "singleton", { recover: (old) => recoverWorkers(configRoot, old) });
  try { await recoverAuthProcesses(configRoot); } catch (error) { await lock.release(); throw error; }
  const root = path.join(configRoot, "only-my-pi/host"), endpointFile = path.join(root, "endpoint.json");
  const epoch = randomUUID(), controlToken = secret(), cookieName = `omp_${epoch.replaceAll("-", "")}`;
  const sessions = new Set(), pairs = new Map(), clients = new Set();
  let seq = 0, origin, stopping = false, scanRunning = false, closed, scanTimer, flushTimer;
  const updates = new Map();
  const projectsFile = path.join(root, "projects.json");
  const previous = await readJsonObject(configRoot, projectsFile).catch(async (e) => { if (e.code === "ENOENT") return null; await lock.release(); throw e; });
  const catalog = new ProjectCatalog({ sessionRoot, projects: previous?.projects ?? [] });
  const manual = new ManualWorkspaces({ configRoot, catalog });
  const terminals = new HostTerminals({ configRoot, catalog, env });
  try { await terminals.load(); } catch (error) { await lock.release(); throw error; }
  const accounts = new AccountCatalog(configRoot);
  const oauth = new AccountOAuth({ stack, configRoot, accounts, env });
  let modelCache, modelTime = 0;
  const modelAbort = new AbortController();
  const authAbort = new AbortController(), authOperations = new Set();
  const modelList = () => {
    if (!modelCache || Date.now() - modelTime > 10000) { modelTime = Date.now(); modelCache = Promise.resolve().then(() => modelsProvider ? modelsProvider() : listModels({ stack, configRoot, accountId: CLI_ACCOUNT_ID, env, signal: modelAbort.signal })).catch((error) => { modelCache = null; throw error; }); }
    return modelCache;
  };
  const accountModels = async (accountId) => {
    if (accountId === CLI_ACCOUNT_ID) return modelList();
    const release = accounts.beginUse(accountId);
    try {
      await accounts.get(accountId);
      return await (modelsProvider ? modelsProvider(accountId) : listModels({ stack, configRoot, accountId, env, signal: modelAbort.signal }));
    } finally { release(); }
  };
  const tasks = new HostTasks({ configRoot, stack, catalog, accounts, workerFactory, models: accountModels, allowControlled, env });
  try { await tasks.load(); } catch (error) { await lock.release(); throw error; }
  const snapshot = () => ({ protocol: HOST_PROTOCOL, version: HOST_VERSION, epoch, seq, indexing: scanRunning, capabilities: { controlled: allowControlled },
    runtime: { stackId: stack.stackId, sourceCommit: stack.distribution?.sourceCommit ?? null }, projects: catalog.listProjects(), tasks: tasks.snapshot(), diagnostics: catalog.diagnostics });
  const send = (client, value) => { if (client.readyState !== 1) return; if (client.bufferedAmount > 1024 * 1024) client.close(1013, "Reconnect for snapshot"); else client.send(JSON.stringify(value)); };
  const publish = (type, data) => { const event = { type, epoch, seq: ++seq, data }; for (const client of clients) send(client, event); };
  tasks.on("change", (task) => {
    updates.set(task.taskId, task);
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; for (const task of updates.values()) publish("task", task); updates.clear(); }, 40);
  });
  const authenticated = (request) => {
    const cookies = (request.headers.cookie ?? "").split(";").map((p) => p.trim().split("="));
    return cookies.some(([name, value]) => name === cookieName && sessions.has(value));
  };
  const controlled = (request) => equal(request.headers.authorization, `Bearer ${controlToken}`);
  const safeOrigin = (request, required = true) => request.headers.host === new URL(origin).host && (request.headers.origin === origin || (!required && request.headers.origin === undefined));
  const response = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(data)); };
  async function scan() {
    if (scanRunning || stopping) return;
    scanRunning = true;
    try { await catalog.scan(); await atomicWriteJson(configRoot, projectsFile, { projects: catalog.listProjects() }); publish("projects", catalog.listProjects()); }
    catch { catalog.diagnostics = [{ code: "SESSION_INDEX_UNAVAILABLE" }]; }
    finally { scanRunning = false; }
  }
  const issuePair = () => { for (const [value, expires] of pairs) if (expires < Date.now()) pairs.delete(value); if (pairs.size >= 16) throw hostError("PAIR_LIMIT", 429); const token = secret(); pairs.set(token, Date.now() + 120000); return `${origin}/#pair=${token}`; };
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    requests++;
    try {
      if (requests > 16) throw hostError("HOST_BUSY", 429);
      if (!safeOrigin(req, false)) throw hostError("HOST_ORIGIN_DENIED", 403);
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith("/internal/")) {
        if (!controlled(req)) throw hostError("CONTROL_DENIED", 403);
        if (req.method === "GET" && url.pathname === "/internal/status") return response(res, 200, snapshot());
        if (req.method === "POST" && url.pathname === "/internal/pair") return response(res, 200, { url: issuePair() });
        if (req.method === "POST" && url.pathname === "/internal/stop") { response(res, 202, { status: "stopping" }); void stop(); return; }
        throw hostError("NOT_FOUND", 404);
      }
      if (req.method === "POST" && url.pathname === "/pair") {
        if (!safeOrigin(req)) throw hostError("HOST_ORIGIN_DENIED", 403);
        const input = await body(req);
        if (!input || Object.keys(input).join() !== "token" || typeof input.token !== "string" || (pairs.get(input.token) ?? 0) < Date.now()) throw hostError("PAIR_EXPIRED", 403);
        pairs.delete(input.token);
        if (sessions.size >= 32) throw hostError("SESSION_LIMIT", 429);
        const token = secret(); sessions.add(token);
        res.setHeader("set-cookie", `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
        return response(res, 200, { protocol: HOST_PROTOCOL });
      }
      if (url.pathname.startsWith("/api/")) {
        if (stopping) throw hostError("HOST_STOPPING", 503);
        if (!authenticated(req)) throw hostError("AUTH_REQUIRED", 401);
        if (url.pathname === "/api/accounts") {
          if (req.method === "GET") return response(res, 200, { protocol: 1, authentication: "api_key", cliReference: { accountId: CLI_ACCOUNT_ID, name: "CLI 配置（只读引用）", readOnly: true }, accounts: await accounts.list() });
          if (req.method !== "POST") throw hostError("METHOD_DENIED", 405);
          if (!safeOrigin(req)) throw hostError("HOST_ORIGIN_DENIED", 403);
          if (req.headers["x-omp-account-protocol"] !== "1") throw hostError("ACCOUNT_PROTOCOL_MISMATCH", 409);
          const input = await body(req);
          if (input?.authType === "oauth" && !(await oauth.providers()).some((p) => p.providerId === input.providerId)) throw hostError("ACCOUNT_PROVIDER_UNSUPPORTED", 400);
          return response(res, 201, { protocol: 1, authentication: "not_connected", account: await accounts.create(input) });
        }
        if (url.pathname === "/api/account-action") {
          if (req.method !== "POST") throw hostError("METHOD_DENIED", 405);
          if (!safeOrigin(req)) throw hostError("HOST_ORIGIN_DENIED", 403);
          if (req.headers["x-omp-account-protocol"] !== "1") throw hostError("ACCOUNT_PROTOCOL_MISMATCH", 409);
          const input = await body(req);
          if (!input || typeof input.accountId !== "string" || Object.keys(input).some((key) => !["accountId", "action"].includes(key)) || !input.action || typeof input.action !== "object") throw hostError("ACCOUNT_INPUT_INVALID");
          const { accountId, action } = input;
          if (action.type === "oauthStart" && Object.keys(action).join() === "type") return response(res, 202, await oauth.start(accountId));
          if (["oauthAnswer", "oauthCancel"].includes(action.type)) {
            const keys = Object.keys(action).sort().join();
            if ((action.type === "oauthAnswer" && keys !== "flowId,promptId,type,value") || (action.type === "oauthCancel" && keys !== "flowId,type")) throw hostError("ACCOUNT_INPUT_INVALID");
            if (oauth.snapshot(action.flowId).accountId !== accountId) throw hostError("ACCOUNT_AUTH_FLOW_EXPIRED", 409);
            return response(res, 200, action.type === "oauthCancel" ? await oauth.cancel(action.flowId) : oauth.answer(action.flowId, action.promptId, action.value));
          }
          if (action.type === "configure" && Object.keys(action).sort().join() === "config,type") return response(res, 200, await accounts.configure(accountId, action.config));
          if (action.type === "rename" && Object.keys(action).sort().join() === "name,type") return response(res, 200, await accounts.rename(accountId, action.name));
          if (action.type === "remove" && Object.keys(action).join() === "type") return response(res, 200, await accounts.remove(accountId));
          const operation = accountAuth({ stack, configRoot, accounts, accountId, input: action, env, signal: authAbort.signal });
          authOperations.add(operation);
          try { return response(res, 200, await operation); }
          finally { authOperations.delete(operation); }
        }
        if (req.method === "POST" && url.pathname === "/api/command") {
          if (!safeOrigin(req)) throw hostError("HOST_ORIGIN_DENIED", 403);
          if (req.headers["x-omp-host-protocol"] !== String(HOST_PROTOCOL)) throw hostError("PROTOCOL_MISMATCH", 409);
          const command = validateCommand(await body(req, 4 * 1024 * 1024));
          if (["openTerminal", "writeTerminal", "resizeTerminal", "closeTerminal"].includes(command.type)) {
            if (!allowControlled) throw hostError("CONTROLLED_MODE_UNAVAILABLE", 409);
            const result = command.type === "openTerminal" ? await terminals.open(command.projectId, command.cols, command.rows)
              : command.type === "writeTerminal" ? terminals.write(command.terminalId, command.seq, command.data)
              : command.type === "resizeTerminal" ? terminals.resize(command.terminalId, command.cols, command.rows)
              : await terminals.close(command.terminalId);
            return response(res, 200, result);
          }
          if (["enterManual", "leaveManual", "saveFile"].includes(command.type)) {
            if (!allowControlled) throw hostError("CONTROLLED_MODE_UNAVAILABLE", 409);
            const result = command.type === "enterManual" ? await manual.enter(command.projectId) : command.type === "leaveManual" ? await manual.leave(command.projectId, command.manualId) : await manual.save(command);
            return response(res, 200, result);
          }
          if (command.type === "addProject") { const project = await catalog.add(command.path); await atomicWriteJson(configRoot, projectsFile, { projects: catalog.listProjects() }); publish("projects", catalog.listProjects()); return response(res, 200, project); }
          if (command.type === "startTask") return response(res, 202, await tasks.start(command));
          if (command.type === "answerApproval") return response(res, 200, await tasks.answerApproval(command.taskId, command.approvalId, command.value));
          if (command.type === "revokeTask") return response(res, 200, await tasks.revoke(command.taskId));
          return response(res, 202, await tasks.cancel(command.taskId));
        }
        if (req.method !== "GET") throw hostError("METHOD_DENIED", 405);
        if (url.pathname === "/api/state") return response(res, 200, snapshot());
        if (url.pathname === "/api/manual") return response(res, 200, { workspaces: manual.snapshot(), available: allowControlled });
        if (url.pathname === "/api/terminals") return response(res, 200, { terminals: terminals.snapshot(), available: allowControlled });
        if (url.pathname === "/api/terminal") return response(res, 200, terminals.read(url.searchParams.get("terminalId"), Number(url.searchParams.get("offset") ?? 0)));
        if (url.pathname === "/api/oauth-providers") return response(res, 200, { providers: await oauth.providers() });
        if (url.pathname === "/api/oauth-flow") return response(res, 200, oauth.snapshot(url.searchParams.get("flowId")));
        if (url.pathname === "/api/models") {
          const accountId = url.searchParams.get("accountId");
          if (!accountId) throw hostError("ACCOUNT_BINDING_REQUIRED", 409);
          return response(res, 200, { accountId, models: await accountModels(accountId) });
        }
        if (url.pathname === "/api/sessions") return response(res, 200, { sessions: catalog.listSessions(url.searchParams.get("projectId")) });
        if (url.pathname === "/api/history") return response(res, 200, await catalog.history(url.searchParams.get("sessionKey"), Number(url.searchParams.get("offset") ?? 0)));
        if (url.pathname === "/api/tool-output") return response(res, 200, await catalog.toolOutput(url.searchParams.get("sessionKey"), url.searchParams.get("entryId"), Number(url.searchParams.get("offset") ?? 0)));
        if (url.pathname === "/api/task") { const task = tasks.tasks.get(url.searchParams.get("taskId")); if (!task) throw hostError("TASK_NOT_FOUND", 404); return response(res, 200, tasks.public(task)); }
        const project = catalog.project(url.searchParams.get("projectId"));
        if (url.pathname === "/api/files") return response(res, 200, await listFiles(project, url.searchParams.get("path") ?? ""));
        if (url.pathname === "/api/file") return response(res, 200, await readFile(project, url.searchParams.get("path")));
        if (url.pathname === "/api/diff") return response(res, 200, await gitDiff(project));
        if (url.pathname === "/api/runs") {
          const records = await createRunRecordStore({ managedRoot: path.join(configRoot, "only-my-pi") }).list();
          const sessionId = url.searchParams.get("sessionId");
          return response(res, 200, { runs: records.filter((r) => r.repository.root === project.path && r.sessionId === sessionId).slice(-50).map(projectRunRecord) });
        }
        throw hostError("NOT_FOUND", 404);
      }
      if (req.method !== "GET") throw hostError("METHOD_DENIED", 405);
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      if (!relative || relative.split("/").includes("..") || /[\\\0]/u.test(relative)) throw hostError("ASSET_DENIED", 403);
      const realRoot = await fs.realpath(assetsRoot), file = await fs.realpath(path.join(realRoot, relative));
      if (!file.startsWith(realRoot + path.sep)) throw hostError("ASSET_DENIED", 403);
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw hostError("ASSET_DENIED", 403);
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" }[path.extname(file)];
      if (!mime) throw hostError("ASSET_DENIED", 403);
      res.writeHead(200, { "content-type": `${mime}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      res.end(await fs.readFile(file));
    } catch (error) { if (!res.headersSent) response(res, error.status ?? (error.code === "ENOENT" ? 404 : 500), { code: /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "HOST_REQUEST_FAILED" }); else res.destroy(); }
    finally { requests--; }
  });
  server.headersTimeout = 5000; server.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, origin);
    if (!safeOrigin(req) || !authenticated(req) || url.pathname !== "/events" || url.searchParams.get("protocol") !== String(HOST_PROTOCOL) || clients.size >= 32) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    wss.handleUpgrade(req, socket, head, (client) => {
      clients.add(client); client.on("close", () => clients.delete(client)); client.on("error", () => client.terminate());
      client.on("message", () => client.close(1008, "Use typed HTTP commands"));
      send(client, { type: "snapshot", ...snapshot() });
    });
  });
  async function stop() {
    if (closed) return closed;
    stopping = true;
    closed = (async () => {
      clearInterval(scanTimer); clearTimeout(flushTimer); modelAbort.abort();
      authAbort.abort();
      await Promise.allSettled([...authOperations, oauth.stop()]);
      try {
        const results = await Promise.allSettled([tasks.stop(), manual.stop(), terminals.stop()]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      }
      finally {
        while (scanRunning) await pause(10);
        for (const client of clients) client.terminate(); wss.close();
        server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
        await fs.unlink(endpointFile).catch((e) => { if (e.code !== "ENOENT") throw e; });
        // Keep ownership when worker termination is uncertain. The CLI process exits;
        // the next Host must perform the fail-closed orphan reconciliation.
      }
      await lock.release();
    })(); return closed;
  }
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    await atomicWriteJson(configRoot, endpointFile, { protocol: HOST_PROTOCOL, version: HOST_VERSION, epoch, origin, pid: process.pid, identity: lock.owner.identity, controlToken });
    void scan(); scanTimer = setInterval(() => void scan(), 10000); scanTimer.unref();
    return { origin, epoch, controlToken, pairingUrl: issuePair(), tasks, catalog, snapshot, scan, stop };
  } catch (error) { server.close(); await lock.release(); throw error; }
}
