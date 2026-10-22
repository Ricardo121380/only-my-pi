import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createPi110SourceCli } from "./pi110-source-cli.mjs";
import { startHost } from "../../packages/host/server.mjs";

export function providerReply(res, name, args) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const delta = name ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } }] } : { role: "assistant", content: "MCP fixture completed" };
  for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: name ? "tool_calls" : "stop" }]) res.write(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
export async function until(read, accept, label, timeoutMs = 7500) {
  for (let i = 0; i < Math.ceil(timeoutMs / 25); i++) { const value = await read(); if (accept(value)) return value; await delay(25); }
  assert.fail(`Timed out: ${label}`);
}
// HTTP 202 precedes worker readiness. Separate its existing 30s initialization
// contract from the unchanged approval/denial polls that follow it.
export const untilPiInitialized = read => until(read, task => task.status !== "starting", "Pi task initialized", 30000);
export async function slowPiInitialization(sdk, delayMs = 8000) {
  await fs.rename(sdk, path.join(path.dirname(sdk), "index-original.js"));
  // Guarantee a minimum startup duration without adding the real SDK's load
  // time to the injected delay and accidentally exhausting its RPC deadline.
  await fs.writeFile(sdk, `export * from "./index-original.js"; import { createAgentSessionServices as real } from "./index-original.js"; export async function createAgentSessionServices(options) { const services = await real(options); await new Promise(resolve => setTimeout(resolve, Math.max(0, ${delayMs} - process.uptime() * 1000))); return services; }`);
}
export async function mcpReception(run) {
  return (await Promise.all(run.processes.map(async (process) => (await fs.readFile(path.join(process.runtimeDir, "received.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse)))).flat();
}
export async function createMcpHost({ respond = ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "mcp__local__read_file", { path: "README.md" }), assetsRoot, installedExtensions = false, verifyNode = false, root: suppliedRoot } = {}) {
  const root = suppliedRoot ?? await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-host-")));
  const requests = [], sockets = new Set();
  const provider = http.createServer(async (req, res) => { let text = ""; for await (const bytes of req) text += bytes; const request = { body: JSON.parse(text), res }; requests.push(request); await respond(request, requests); });
  provider.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  let host, closing;
  const closeProvider = async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => provider.close(resolve)); };
  try {
    const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
    const f = await createPi110SourceCli(root, { baseUrl: `${providerOrigin}/v1`, installedExtensions, verifyNode });
    if (!assetsRoot) { assetsRoot = path.join(root, "assets"); await fs.mkdir(assetsRoot); await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>MCP fixture</title>"); }
    const stack = { root: f.stack, ompPackageRoot: f.omp, nodePath: path.join(f.stack, "node/bin/node"), piCliPath: path.join(f.stack, "pi/dist/bundle/cli.js"), stackId: `sha256:${"a".repeat(64)}` };
    const open = async () => { host = await startHost({ configRoot: f.config, stack, assetsRoot, allowControlled: true, env: { ...f.env, AMBIENT_SECRET: "must-not-reach-mcp" } }); return host; };
    await open(); let cookie;
    const pair = async () => { const response = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) }); cookie = response.headers.get("set-cookie").split(";")[0]; };
    await pair();
    const request = async (route, input, expected = 200) => { const response = await fetch(host.origin + route, { method: input ? "POST" : "GET", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-mcp-protocol": "1" }, ...(input ? { body: JSON.stringify(input) } : {}) }); assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); return response.json(); };
    const project = await request("/api/command", { type: "addProject", path: f.project });
    const serverFile = fileURLToPath(new URL("./mcp-server.mjs", import.meta.url));
    const server = { name: "local", transport: "stdio", enabled: false, command: process.execPath, args: [serverFile], codePaths: [serverFile], env: {}, credentialRefs: {}, tools: [{ name: "read_file", effect: "read", pathArgument: "path", paths: ["README.md"] }] };
    return { ...f, root, requests, providerOrigin, stack, server, projectId: project.projectId, get host() { return host; }, get cookie() { return cookie; }, request,
      mcp: (input, expected) => request("/api/mcp", { ...input, projectId: project.projectId }, expected),
      start: (extra = {}) => request("/api/command", { type: "startTask", requestId: randomUUID(), projectId: project.projectId, accountId: "cli-readonly", model: "fixture/one", prompt: "read selected file via MCP", ...extra }, 202),
      task: (id) => request(`/api/task?taskId=${id}`),
      restart: async () => { await host.stop(); await open(); await pair(); },
      close: ({ keep = false, unconfirmed = false } = {}) => closing ??= (async () => {
        try {
          try { await host.stop(); } catch (error) { if (!unconfirmed || error.code !== "RPC_TERMINATION_UNCONFIRMED") throw error; }
        } finally {
          await closeProvider();
        }
        if (!keep) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
      })(),
    };
  } catch (error) {
    // A caller cannot register teardown until setup returns. Close every live
    // handle here as well, retaining the failed root for diagnostic inspection.
    try { await host?.stop(); } finally { await closeProvider(); }
    throw error;
  }
}
