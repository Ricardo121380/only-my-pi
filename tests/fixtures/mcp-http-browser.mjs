import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import http from "node:http";
import { createMcpHost, providerReply } from "./mcp-host.mjs";
import { createHttpMcpServer } from "./mcp-http-server.mjs";
import { McpRuns } from "../../packages/mcp/runs.mjs";

const evidence = process.env.OMP_MCP_EVIDENCE_DIR;
if (!path.isAbsolute(evidence ?? "")) throw new Error("evidence directory required");
const prefix = process.env.OMP_MCP_EVIDENCE_PREFIX ?? "68-browser";
if (!/^[a-z0-9-]{1,64}$/u.test(prefix)) throw new Error("invalid evidence prefix");
const service = await createHttpMcpServer({ mode: process.env.OMP_MCP_HTTP_MODE ?? "json" });
const f = await createMcpHost({ assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), installedExtensions: true,
  respond: ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: "browser approved input" }) });
const raw = JSON.stringify({ mcpServers: { remote: { type: "http", url: service.url } } });
await fs.writeFile(path.join(f.config, "mcp.json"), raw);
const server = { name: "remote", transport: "streamable-http", url: service.url, tools: [{ name: "echo", effect: "remote" }], credentialRefs: {}, enabled: false };
const identities = {};
for (const [name, file] of [["node", f.stack.nodePath], ["piSdk", f.sdk], ["httpService", fileURLToPath(new URL("./mcp-http-server.mjs", import.meta.url))], ["ompMcp", path.join(f.omp, "packages/mcp/extension.mjs")], ["httpTransport", path.join(f.omp, "packages/mcp/http.mjs")]]) identities[name] = { path: file, sha256: createHash("sha256").update(await fs.readFile(file)).digest("hex") };
await fs.writeFile(path.join(evidence, `${prefix}-input.json`), JSON.stringify({ origin: f.host.origin, projectId: f.projectId, project: f.project, raw, server, identities, bindings: f.bindings }, null, 2));
const pair = async () => fetch(f.host.origin + "/internal/pair", { method: "POST", headers: { Origin: f.host.origin, Authorization: `Bearer ${f.host.controlToken}` } }).then((response) => response.json());
console.log(JSON.stringify({ pairingUrl: (await pair()).url, origin: f.host.origin, project: f.project, pid: process.pid }));
let stopping;
async function stop() {
  if (stopping) return stopping;
  return stopping = (async () => {
    await f.close({ keep: true }); await service.close();
    const runs = await new McpRuns(f.config).status(f.project);
    await fs.writeFile(path.join(evidence, `${prefix}-runtime.json`), JSON.stringify({ runs, received: service.received, providerRequests: f.requests.length,
      rawBytesPreserved: await fs.readFile(path.join(f.config, "mcp.json"), "utf8") === raw, identities, bindings: f.bindings, realPi: "1.1.0", realMcpClient: "1.1.0", node: process.version, installedExtensionCopies: true, sourceCandidate: true, I: "NOT_RUN", L: "NOT_RUN" }, null, 2));
    console.log(JSON.stringify({ stopped: true, receptions: service.received.filter((entry) => entry.rpc === "tools/call").length }));
  })();
}
const control = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !["/stop", "/restart", "/mode"].includes(req.url) || req.headers.origin !== controlOrigin) { res.writeHead(403).end(); return; }
  try {
    if (req.url === "/mode") { let body = ""; for await (const bytes of req) body += bytes; service.setMode(JSON.parse(body).mode); res.writeHead(200).end("{}"); return; }
    if (req.url === "/restart") { await f.restart(); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pairingUrl: (await pair()).url, origin: f.host.origin })); return; }
    res.once("finish", () => { control.close(); control.closeAllConnections(); });
    await stop(); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ stopped: true }));
  } catch (error) { res.writeHead(500).end(JSON.stringify({ code: error.code ?? "FIXTURE_FAILED" })); }
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
const controlOrigin = `http://127.0.0.1:${control.address().port}`;
await fs.writeFile(path.join(evidence, `${prefix}-control.json`), JSON.stringify({ origin: controlOrigin }));
console.log(JSON.stringify({ fixtureControl: controlOrigin }));
