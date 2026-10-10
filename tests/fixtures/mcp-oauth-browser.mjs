import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createMcpHost, providerReply } from "./mcp-host.mjs";
import { createOAuthMcpServer } from "./mcp-oauth-server.mjs";
import { McpCatalog } from "../../packages/mcp/catalog.mjs";
import { McpRuns } from "../../packages/mcp/runs.mjs";

const evidence = process.env.OMP_MCP_EVIDENCE_DIR;
if (!path.isAbsolute(evidence ?? "")) throw new Error("evidence directory required");
const service = await createOAuthMcpServer();
const f = await createMcpHost({ assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), installedExtensions: true,
  respond: ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: "browser OAuth approved input" }) });
const server = { name: "remote", transport: "streamable-http", url: service.url, enabled: false, credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }] };
const raw = JSON.stringify({ mcpServers: { remote: { type: "http", url: service.url } } }); await fs.writeFile(path.join(f.config, "mcp.json"), raw);
const identities = {};
for (const [name, file] of [["node", f.stack.nodePath], ["piSdk", f.sdk], ["nativeOAuth", fileURLToPath(import.meta.resolve("@earendil-works/pi-mcp/oauth"))], ["oauthService", fileURLToPath(new URL("./mcp-oauth-server.mjs", import.meta.url))], ["ompOAuth", path.join(f.omp, "packages/mcp/oauth.mjs")], ["ompCatalog", path.join(f.omp, "packages/mcp/catalog.mjs")], ["host", path.join(f.omp, "packages/host/server.mjs")]]) identities[name] = { path: file, sha256: createHash("sha256").update(await fs.readFile(file)).digest("hex") };
await fs.writeFile(path.join(evidence, "69-browser-input.json"), JSON.stringify({ origin: f.host.origin, project: f.project, projectId: f.projectId, server, raw, identities, bindings: f.bindings }, null, 2));
const pair = async () => fetch(`${f.host.origin}/internal/pair`, { method: "POST", headers: { Origin: f.host.origin, Authorization: `Bearer ${f.host.controlToken}` } }).then((response) => response.json());
console.log(JSON.stringify({ pairingUrl: (await pair()).url, origin: f.host.origin, pid: process.pid }));
let stopping;
const stop = () => stopping ??= (async () => {
  await f.close({ keep: true }); await service.close();
  await fs.writeFile(path.join(evidence, "69-browser-runtime.json"), JSON.stringify({ authentication: (await new McpCatalog(f.config).snapshot(f.project)).authentication,
    runs: await new McpRuns(f.config).status(f.project), received: service.received, providerRequests: f.requests.length,
    rawBytesPreserved: await fs.readFile(path.join(f.config, "mcp.json"), "utf8") === raw, identities, bindings: f.bindings,
    node: process.version, realPi: "1.1.0", realMcp: "1.1.0", sourceCandidate: true, installedExtensionCopies: true, I: "NOT_RUN", L: "NOT_RUN" }, null, 2));
})();
const control = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.headers.origin !== controlOrigin || !["/mode", "/revoke", "/restart", "/stop"].includes(req.url)) { res.writeHead(403).end(); return; }
  try {
    if (req.url === "/mode") { let body = ""; for await (const bytes of req) body += bytes; service.setMode(JSON.parse(body).mode); }
    if (req.url === "/revoke") service.revoke();
    if (req.url === "/restart") { await f.restart(); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ origin: f.host.origin, pairingUrl: (await pair()).url })); return; }
    if (req.url === "/stop") { res.once("finish", () => { control.close(); control.closeAllConnections(); }); await stop(); }
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  } catch { res.writeHead(500).end('{"code":"FIXTURE_FAILED"}'); }
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve)); const controlOrigin = `http://127.0.0.1:${control.address().port}`;
await fs.writeFile(path.join(evidence, "69-browser-control.json"), JSON.stringify({ origin: controlOrigin })); console.log(JSON.stringify({ fixtureControl: controlOrigin }));
