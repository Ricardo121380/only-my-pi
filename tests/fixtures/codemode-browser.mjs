import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createMcpHost, mcpReception, providerReply } from "./mcp-host.mjs";

const evidence = process.env.OMP_MCP_EVIDENCE_DIR;
if (!path.isAbsolute(evidence ?? "")) throw new Error("evidence directory required");
const prefix = process.env.OMP_CODEMODE_EVIDENCE_LABEL ?? "70-browser";
if (!/^[a-z0-9-]+$/u.test(prefix)) throw new Error("invalid evidence label");
const code = 'text(await tools.read({path:"README.md"})); try { text(await tools.mcp__local__read_file({path:"README.md"})); } catch(e) { text(e.message); } text("partial result retained; classifier/image disabled");';
const f = await createMcpHost({ assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), installedExtensions: true,
  respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }),
});
await f.mcp({ type: "save", revision: 0, server: { ...f.server, enabled: true } });
const hashes = {};
for (const file of ["packages/direct-agent/codemode.mjs", "packages/direct-agent/launcher.mjs", "packages/mcp/extension.mjs", "packages/mcp/process.mjs", "packages/host/tasks.mjs", "packages/host/rpc-worker.mjs", "packages/host/account-rpc-entry.mjs", "extensions/omp-direct/index.ts", "extensions/omp-direct/runtime.mjs"]) hashes[file] = createHash("sha256").update(await fs.readFile(path.join(f.omp, file))).digest("hex");
await fs.writeFile(path.join(evidence, `${prefix}-input.json`), JSON.stringify({ root: f.root, projectId: f.projectId, project: f.project, code, server: f.server, hashes, node: process.version, pi: "1.1.0", quickjs: "quickjs-wasi@3.6.2", installedExtensionCopies: true }, null, 2));
const pair = () => fetch(f.host.origin + "/internal/pair", { method: "POST", headers: { Origin: f.host.origin, Authorization: `Bearer ${f.host.controlToken}` } }).then((response) => response.json());
const control = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.headers.origin !== controlOrigin || !["/pair", "/restart", "/stop"].includes(req.url)) { res.writeHead(403).end(); return; }
  try {
    let data;
    if (req.url === "/restart") { await f.restart(); data = await pair(); }
    else if (req.url === "/pair") data = await pair();
    else {
      await f.close({ keep: true });
      const { McpRuns } = await import("../../packages/mcp/runs.mjs");
      const runs = await new McpRuns(f.config).status(f.project);
      const reception = await Promise.all(runs.runs.map(async (run) => ({ runId: run.runId, taskId: run.taskId, received: await mcpReception(run) })));
      const tasks = [...f.host.tasks.tasks.values()].map((task) => f.host.tasks.public(task));
      await fs.writeFile(path.join(evidence, `${prefix}-runtime.json`), JSON.stringify({ runs, reception, tasks, providerRequests: f.requests.length, hashes, pi: "1.1.0", node: process.version, I: "NOT_RUN", L: "NOT_RUN" }, null, 2));
      data = { stopped: true, tasks: tasks.length, receptions: reception.map((run) => run.received.filter((item) => item.type === "call").length) };
      res.once("finish", () => { control.close(); control.closeAllConnections(); });
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
  } catch (error) { res.writeHead(500).end(JSON.stringify({ code: error.code ?? "FIXTURE_CONTROL_FAILED" })); }
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
const controlOrigin = `http://127.0.0.1:${control.address().port}`;
await fs.writeFile(path.join(evidence, `${prefix}-control.json`), JSON.stringify({ origin: controlOrigin, hostOrigin: f.host.origin, pairingUrl: (await pair()).url }), { mode: 0o600 });
console.log(JSON.stringify({ fixtureControl: controlOrigin, project: f.project, pid: process.pid }));
