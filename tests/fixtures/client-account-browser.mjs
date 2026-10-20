// Opt-in Ego acceptance harness. Real CLI, Pi, Host and production WebUI;
// all credentials, projects, model and OAuth traffic are local controlled data.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPi110SourceCli } from "./pi110-source-cli.mjs";
import { createAccountOAuthService, installAccountOAuthTransport } from "./account-oauth-service.mjs";
import { startHost } from "../../packages/host/server.mjs";
import { AccountCatalog } from "../../packages/host/accounts.mjs";
import { writePiEvidence } from "./pi-runtime-evidence.mjs";

const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw Error("EXPLICIT_ARTIFACT_ROOT_REQUIRED");
await fs.mkdir(root, { recursive: false });
const children = new Map(), commands = [], held = new Set();
let hold = false, stopping = false;
const service = await createAccountOAuthService({ respond: ({ res }) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ id: "browser-controlled", choices: [{ index: 0, delta: { role: "assistant", content: hold ? "controlled stream awaiting cancellation" : "controlled browser account completed" }, finish_reason: null }] })}\n\n`);
  if (hold) { held.add(res); res.once("close", () => held.delete(res)); }
  else res.end('data: {"id":"browser-controlled","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
} });
const f = await createPi110SourceCli(root, { baseUrl: `${service.origin}/v1`, installedExtensions: true, verifyNode: true });
await installAccountOAuthTransport(f, service);
const originalAuth = await fs.readFile(path.join(f.config, "auth.json"));
const sentinel = path.join(f.config, "sessions", "existing-history.txt");
await fs.mkdir(path.dirname(sentinel), { recursive: true }); await fs.writeFile(sentinel, "existing history sentinel\n");
const descriptor = path.join(root, "provider.json");
await fs.writeFile(descriptor, JSON.stringify({ baseUrl: `${service.origin}/v1`, api: "openai-completions", models: [{ id: "controlled-model", name: "Controlled account model", contextWindow: 32000, maxTokens: 128 }] }));
function start(args, { input, keepStdin = false } = {}) {
  const child = spawn(process.execPath, [f.cli, ...args], { cwd: f.project, env: f.env, stdio: ["pipe", "pipe", "pipe"] });
  const record = { pid: child.pid, args, stdout: "", stderr: "", exit: null };
  commands.push(record); children.set(child.pid, child);
  child.stdout.on("data", bytes => { record.stdout += bytes; }); child.stderr.on("data", bytes => { record.stderr += bytes; });
  child.closed = once(child, "close").then(([code, signal]) => { record.exit = { code, signal }; children.delete(child.pid); return record; });
  child.record = record;
  if (!keepStdin) child.stdin.end(input ?? "");
  return child;
}
async function run(args, input) { const record = await start(args, { input }).closed; if (record.exit.code !== 0) throw Error(`CONTROLLED_CLI_FAILED_${record.exit.code}`); return JSON.parse(record.stdout); }
async function create(name, authType, key) {
  const account = await run(["account", "add", "--provider", "openrouter", "--name", name, "--auth", authType]);
  await run(["account", "configure", account.accountId, descriptor]);
  if (key) { service.keys.set(key, name); await run(["account", "login", account.accountId, "--stdin"], `${key}\n`); }
  return account;
}
const apiAccount = await create("CLI API account", "api_key", "controlled-browser-cli-api");
const oauthAccount = await create("CLI OAuth account", "oauth");
service.keys.set("controlled-browser-gui-api", "GUI API account");
const login = start(["account", "login", oauthAccount.accountId, "--stdin"], { keepStdin: true });
let providerUrl;
for (let i = 0; i < 400; i++) {
  providerUrl = /Open in your browser: (https:\/\/[^\s]+)/.exec(login.record.stderr)?.[1];
  if (providerUrl || login.record.exit) break;
  await new Promise(resolve => setTimeout(resolve, 25));
}
if (!providerUrl) throw Error("CONTROLLED_LOGIN_NOT_READY");
const stack = { root: f.stack, ompPackageRoot: f.omp, nodePath: path.join(f.stack, "node/bin/node"), piCliPath: path.join(f.stack, "pi/dist/bundle/cli.js"), stackId: `sha256:${"a".repeat(64)}` };
const assetsRoot = fileURLToPath(new URL("../../webui/dist", import.meta.url));
// This startup must preserve the still-active independent CLI OAuth worker.
const host = await startHost({ stack, configRoot: f.config, assetsRoot, allowControlled: true, env: f.env });
const catalog = new AccountCatalog(f.config);
const control = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let value;
    if (req.method === "GET" && url.pathname === "/status") value = {
      accounts: await catalog.list(), commands, calls: service.calls.map(({ identity, valid, model, tools }) => ({ identity, valid, model, tools })), exchanges: service.exchanges,
      activeStreams: held.size, login: login.record, hostTasks: host.tasks?.snapshot?.() ?? null,
      originalAuthPreserved: originalAuth.equals(await fs.readFile(path.join(f.config, "auth.json"))),
      existingHistoryPreserved: await fs.readFile(sentinel, "utf8") === "existing history sentinel\n",
    };
    else if (req.method === "POST" && url.pathname === "/cli") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      const child = start(input.args, { input: input.input, keepStdin: input.keepStdin === true });
      value = input.background ? { pid: child.pid } : await child.closed;
    } else if (req.method === "POST" && url.pathname === "/hold") {
      let raw = ""; for await (const chunk of req) raw += chunk; hold = JSON.parse(raw).hold === true; value = { hold };
    } else if (req.method === "POST" && url.pathname === "/signal") {
      let raw = ""; for await (const chunk of req) raw += chunk; const input = JSON.parse(raw);
      const child = children.get(input.pid); if (!child || !["SIGINT", "SIGTERM", "SIGKILL"].includes(input.signal)) throw Error("CONTROLLED_PROCESS_NOT_FOUND");
      child.kill(input.signal); value = await child.closed;
    } else if (req.method === "POST" && url.pathname === "/stop") { value = { stopping: true }; setImmediate(() => void stop()); }
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value));
  } catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"code":"CONTROLLED_ACTION_FAILED"}'); }
});
await new Promise(resolve => control.listen(0, "127.0.0.1", resolve));
const hash = async file => createHash("sha256").update(await fs.readFile(file)).digest("hex");
const ready = { scope: "CLIENT-01A_SOURCE_BROWSER_LOCAL_ONLY", hostPid: process.pid, cliLoginPid: login.pid, root,
  pairingUrl: host.pairingUrl, controlOrigin: `http://127.0.0.1:${control.address().port}`, serviceOrigin: service.origin,
  oauthAuthorizeUrl: service.authorizeUrl(providerUrl, "CLI OAuth account"), apiAccount, oauthAccount, project: f.project,
  config: f.config, cli: f.cli, node: process.execPath, sdk: f.sdk, descriptor,
  nodeVersion: process.version, nodeSha256: await hash(process.execPath), packageLockSha256: await hash(path.join(f.omp, "package-lock.json")),
  webIndexSha256: await hash(path.join(assetsRoot, "index.html")), cliSha256: await hash(f.cli), originalSdkSha256: await hash(path.join(path.dirname(f.sdk), "index-real.js")),
};
await fs.writeFile(path.join(root, "ready.json"), JSON.stringify(ready, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ready: path.join(root, "ready.json"), hostPid: process.pid, cliLoginPid: login.pid }));
async function stop() {
  if (stopping) return; stopping = true;
  await host.stop();
  for (const child of children.values()) { child.kill("SIGKILL"); await child.closed; }
  const preserved = originalAuth.equals(await fs.readFile(path.join(f.config, "auth.json"))) && await fs.readFile(sentinel, "utf8") === "existing history sentinel\n";
  await writePiEvidence("Ego CLI/GUI account interoperability", { sdk: f.sdk, scope: ready.scope, ready, commands,
    received: service.calls, exchanges: service.exchanges, originalStatePreserved: preserved, activeStreams: held.size, hostStopped: true });
  await service.close(); await new Promise(resolve => control.close(resolve));
  await fs.writeFile(path.join(root, "stopped.json"), JSON.stringify({ preserved, commands, activeStreams: held.size, hostStopped: true }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ stopped: true, preserved }));
}
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
