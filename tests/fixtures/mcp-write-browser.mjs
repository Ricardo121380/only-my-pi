import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import http from "node:http";
import { createWriteHost } from "./mcp-write-host.mjs";
import { mcpReception } from "./mcp-host.mjs";
const evidence = process.env.OMP_MCP_EVIDENCE_DIR;
if (!path.isAbsolute(evidence ?? "")) throw new Error("evidence directory required");
const f = await createWriteHost({ assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)) });
await f.mcp({ type: "save", revision: 1, server: f.server });
const raw = JSON.stringify({ mcpServers: { local: { command: f.server.command, args: f.server.args, env: {} } } });
await fs.writeFile(path.join(f.config, "mcp.json"), raw);
const hashes = {};
for (const file of ["packages/mcp/extension.mjs", "packages/mcp/write-target.mjs", "packages/mcp/process.mjs", "packages/mcp/catalog.mjs", "packages/host/tasks.mjs", "packages/host/ownership.mjs", "packages/host/project-authority.mjs", "packages/host/account-rpc-entry.mjs", "extensions/omp-direct/index.ts", "extensions/omp-direct/runtime.mjs"]) hashes[file] = createHash("sha256").update(await fs.readFile(path.join(f.omp, file))).digest("hex");
await fs.writeFile(path.join(evidence, "67-browser-input.json"), JSON.stringify({ origin: f.host.origin, projectId: f.projectId, project: f.project, configRoot: f.config, root: f.root, raw, server: f.server, runtimeSourceHashes: hashes, node: process.version, realPi: f.piVersion, realMcpClient: f.piVersion, installedExtensionCopies: true }, null, 2));
const pair = () => fetch(f.host.origin + "/internal/pair", { method: "POST", headers: { Origin: f.host.origin, Authorization: `Bearer ${f.host.controlToken}` } }).then((response) => response.json());
let stopping;
async function stop() {
  if (stopping) return; stopping = true;
  await f.close({ keep: true });
  const { McpRuns } = await import("../../packages/mcp/runs.mjs");
  const runs = await new McpRuns(f.config).status(f.project);
  const reception = await Promise.all(runs.runs.map(async (run) => ({ runId: run.runId, taskId: run.taskId, received: await mcpReception(run) })));
  await fs.writeFile(path.join(evidence, "67-browser-runtime.json"), JSON.stringify({ runs, reception, fileBytes: await fs.readFile(path.join(f.project, "README.md"), "utf8"), providerRequests: f.requests.length, rawBytesPreserved: await fs.readFile(path.join(f.config, "mcp.json"), "utf8") === raw, runtimeSourceHashes: hashes, realPi: f.piVersion, realMcpClient: f.piVersion, node: process.version, installedExtensionCopies: true, I: "NOT_RUN", L: "NOT_RUN" }, null, 2));
  console.log(JSON.stringify({ stopped: true, runs: runs.runs.length, receptions: reception.map((entry) => entry.received.filter((item) => item.type === "call").length) }));
}
const control = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.headers.origin !== controlOrigin || !["/pair", "/restart", "/stop", "/file"].includes(req.url)) { res.writeHead(403).end(); return; }
  try {
    let data;
    if (req.url === "/restart") { await f.restart(); data = await pair(); }
    else if (req.url === "/pair") data = await pair();
    else if (req.url === "/file") data = { bytes: await fs.readFile(path.join(f.project, "README.md"), "utf8") };
    else { await stop(); data = { stopped: true }; res.once("finish", () => { control.close(); control.closeAllConnections(); }); }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
  } catch { res.writeHead(500).end(); }
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
const controlOrigin = `http://127.0.0.1:${control.address().port}`;
await fs.writeFile(path.join(evidence, "67-browser-control.json"), JSON.stringify({ origin: controlOrigin }));
console.log(JSON.stringify({ fixtureControl: controlOrigin, project: f.project, pid: process.pid }));
