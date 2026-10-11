import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mcpReception, providerReply } from "./mcp-host.mjs";
import { createResourceHost } from "./mcp-resource-host.mjs";
import { McpRuns } from "../../packages/mcp/runs.mjs";
const evidence = process.env.OMP_MCP_EVIDENCE_DIR, prefix = process.env.OMP_DISCOVERY_EVIDENCE_LABEL;
if (!path.isAbsolute(evidence ?? "") || !/^[a-z0-9-]+$/u.test(prefix ?? "")) throw new Error("bounded evidence destination required");
const resourceCode = 'try { text(await tools.mcp_read_resource({server:"remote",uri:"mcp://remote/readme"})); } catch(e) { text(e.message); }';
const combinedCode = 'text(searchTools("read_file echo")); text(await tools.mcp_list_resources({server:"local"})); text(await tools.mcp_list_resources({server:"remote"})); for (const [name,args] of [["mcp__local__read_file",{path:"README.md"}],["mcp__remote__echo",{value:"browser approved"}],["mcp_read_resource",{server:"local",uri:"mcp://local/readme"}],["mcp_read_resource",{server:"remote",uri:"mcp://remote/readme"}]]) { try { text(await tools[name](args)); } catch(e) { text(e.message); } }';
const fixture = await createResourceHost({ assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), respond: ({ body, res }) => {
  const prompt = JSON.stringify(body.messages.find((message) => message.role === "user")?.content ?? "");
  providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code: /hot|fresh|deny|cancel/u.test(prompt) ? resourceCode : combinedCode });
} });
const { f, service } = fixture;
const serverFile = fileURLToPath(new URL("./mcp-discovery-server.mjs", import.meta.url));
let state = await f.mcp({ type: "list" });
await f.mcp({ type: "save", revision: state.revision, server: { ...f.server, enabled: true, args: [serverFile], codePaths: [serverFile], tools: f.server.tools.map((tool) => ({ ...tool, exposure: "deferred" })), resources: [{ uri: "mcp://local/readme", mimeTypes: ["text/plain"], paths: ["README.md"] }] } });
const hashes = {};
for (const file of ["packages/mcp/catalog.mjs", "packages/mcp/discovery.mjs", "packages/mcp/extension.mjs", "packages/mcp/http.mjs", "packages/mcp/runs.mjs", "packages/direct-agent/codemode.mjs", "packages/host/server.mjs", "packages/host/rpc-worker.mjs", "packages/host/tasks.mjs"]) hashes[file] = createHash("sha256").update(await fs.readFile(path.join(f.omp, file))).digest("hex");
await fs.writeFile(path.join(evidence, `${prefix}-input.json`), JSON.stringify({ root: f.root, projectId: f.projectId, project: f.project, combinedCode, resourceCode, hashes, node: process.version, pi: "1.1.0", installedExtensionCopies: true }, null, 2));
const pair = () => fetch(f.host.origin + "/internal/pair", { method: "POST", headers: { Origin: f.host.origin, Authorization: `Bearer ${f.host.controlToken}` } }).then((response) => response.json());
const control = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.headers.origin !== controlOrigin || !["/pair", "/change", "/withdraw", "/hide", "/show", "/delay", "/restart", "/stop"].includes(req.url)) { res.writeHead(403).end(); return; }
  try {
    let data = { changed: true };
    if (req.url === "/pair") data = await pair();
    else if (req.url === "/restart") { await f.restart(); data = await pair(); }
    else if (req.url === "/change") service.changeSchema();
    else if (req.url === "/withdraw") service.withdraw();
    else if (req.url === "/delay") service.setResourceMode("delay");
    else if (["/hide", "/show"].includes(req.url)) {
      const hide = req.url === "/hide"; state = await f.mcp({ type: "list" });
      for (const server of state.servers) {
        const { source: _source, targetDigest: _target, revocations: _revocations, ...copy } = server;
        copy.tools = copy.tools.map((tool) => ({ ...tool, exposure: hide ? "hidden" : "deferred" })); copy.resources = copy.resources?.map((resource) => ({ ...resource, active: !hide }));
        state = await f.mcp({ type: "save", revision: state.revision, server: copy });
      }
    } else {
      await fixture.close({ keep: true }); const runs = await new McpRuns(f.config).status(f.project);
      const reception = await Promise.all(runs.runs.map(async (run) => ({ taskId: run.taskId, received: await mcpReception({ ...run, processes: run.processes.filter((item) => item.transport === "stdio") }) })));
      const tasks = [...f.host.tasks.tasks.values()].map((task) => f.host.tasks.public(task));
      await fs.writeFile(path.join(evidence, `${prefix}-runtime.json`), JSON.stringify({ tasks, runs, stdioReception: reception, httpReception: service.received, hashes, pi: "1.1.0", node: process.version, I: "NOT_RUN", L: "NOT_RUN" }, null, 2));
      data = { stopped: true, tasks: tasks.length, stdioCalls: reception.map((item) => item.received.filter((entry) => ["call", "resource"].includes(entry.type)).length), httpCalls: service.received.filter((item) => ["tools/call", "resources/read"].includes(item.rpc)).length };
      res.once("finish", () => { control.close(); control.closeAllConnections(); });
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
  } catch (error) { res.writeHead(500).end(JSON.stringify({ code: error.code ?? "FIXTURE_CONTROL_FAILED" })); }
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
const controlOrigin = `http://127.0.0.1:${control.address().port}`;
await fs.writeFile(path.join(evidence, `${prefix}-control.json`), JSON.stringify({ origin: controlOrigin, hostOrigin: f.host.origin, pairingUrl: (await pair()).url }), { mode: 0o600 });
console.log(JSON.stringify({ fixtureControl: controlOrigin, project: f.project, pid: process.pid }));
