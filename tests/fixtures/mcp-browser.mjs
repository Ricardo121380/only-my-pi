import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import http from "node:http";
import { createMcpHost, mcpReception } from "./mcp-host.mjs";

// Real source/installed-extension B/P harness, with isolated synthetic account
// and project. It neither copies user auth nor changes the daily installation.
const evidence = process.env.OMP_MCP_EVIDENCE_DIR;
if (!path.isAbsolute(evidence ?? "")) throw new Error("evidence directory required");
const f = await createMcpHost({ assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), installedExtensions: true });
const raw = JSON.stringify({ mcpServers: { local: { command: f.server.command, args: f.server.args, env: {} } } });
await fs.writeFile(path.join(f.config, "mcp.json"), raw);
const identities = {};
for (const [name, file] of [["node", f.stack.nodePath], ["piSdk", f.sdk], ["stdioService", f.server.args[0]], ["ompMcp", path.join(f.omp, "packages/mcp/extension.mjs")]]) identities[name] = { path: file, sha256: createHash("sha256").update(await fs.readFile(file)).digest("hex") };
await fs.writeFile(path.join(evidence, "66-browser-input.json"), JSON.stringify({ origin: f.host.origin, projectId: f.projectId, project: f.project, configRoot: f.config, raw, server: f.server, identities, bindings: f.bindings }, null, 2));
const browserPair = await fetch(f.host.origin + "/internal/pair", { method: "POST", headers: { Origin: f.host.origin, Authorization: `Bearer ${f.host.controlToken}` } }).then((response) => response.json());
console.log(JSON.stringify({ pairingUrl: browserPair.url, origin: f.host.origin, project: f.project, pid: process.pid }));
let stopping;
async function stop() {
  if (stopping) return; stopping = true;
  const runs = await f.mcp({ type: "status" });
  const reception = await Promise.all(runs.runs.map(async (run) => ({ runId: run.runId, taskId: run.taskId, received: await mcpReception(run) })));
  await f.close({ keep: true });
  await fs.writeFile(path.join(evidence, "66-browser-runtime.json"), JSON.stringify({ runs, reception, providerRequests: f.requests.length, rawBytesPreserved: await fs.readFile(path.join(f.config, "mcp.json"), "utf8") === raw, identities, realPi: "1.1.0", realMcpClient: "1.1.0", node: process.version, installedExtensionCopies: true, sourceCandidate: true, I: "NOT_RUN", L: "NOT_RUN" }, null, 2));
  console.log(JSON.stringify({ stopped: true, runs: runs.runs.length, receptions: reception.map((entry) => entry.received.filter((item) => item.type === "call").length) }));
}
process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
// SDK global signal handlers may be replaced. This fixture-owned endpoint is
// independent of signals and only accepts its own Origin from the local runner.
const control = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !["/stop", "/restart"].includes(req.url) || req.headers.origin !== controlOrigin) { res.writeHead(403).end(); return; }
  if (req.url === "/restart") {
    await f.restart();
    const pair = await fetch(f.host.origin + "/internal/pair", { method: "POST", headers: { Origin: f.host.origin, Authorization: `Bearer ${f.host.controlToken}` } }).then((response) => response.json());
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pairingUrl: pair.url, origin: f.host.origin })); return;
  }
  res.once("finish", () => { control.close(); control.closeAllConnections(); });
  try { await stop(); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ stopped: true })); }
  catch { res.writeHead(500).end(); }
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
const controlOrigin = `http://127.0.0.1:${control.address().port}`;
await fs.writeFile(path.join(evidence, "66-browser-control.json"), JSON.stringify({ origin: controlOrigin }));
console.log(JSON.stringify({ fixtureControl: controlOrigin }));
