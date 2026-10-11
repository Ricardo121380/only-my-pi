import http from "node:http";
import { randomUUID } from "node:crypto";

// A real Streamable HTTP service. Its reception ledger is independent of OMP.
export async function createHttpMcpServer({ token = "fixture-http-identity", additionalTokens = [], mode = "json", delayMs = 15000, maxInputLength = 100, discovery = false } = {}) {
  const received = [], sockets = new Set(), sessions = new Set();
  const streams = new Set(); let version = 1, withdrawnTool = false, withdrawnResource = false, resourceMode = "text";
  const uri = "mcp://remote/readme";
  const notify = (method) => { received.push({ type: "notification", rpc: method }); for (const stream of streams) stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method })}\n\n`); };
  let schema = { type: "object", properties: { value: { type: "string", maxLength: maxInputLength } }, required: ["value"], additionalProperties: false };
  const server = http.createServer(async (req, res) => {
    const identityIndex = [token, ...additionalTokens].findIndex((value) => req.headers.authorization === `Bearer ${value}`), identity = identityIndex !== -1;
    let text = ""; for await (const bytes of req) text += bytes;
    const message = text ? JSON.parse(text) : null;
    received.push({ path: req.url, method: req.method, identity, identityIndex, rpc: message?.method ?? null, args: message?.params?.arguments, uri: message?.params?.uri, session: Boolean(req.headers["mcp-session-id"]) });
    if (!identity) { res.writeHead(401, { "www-authenticate": "Bearer" }); res.end(); return; }
    if (req.url !== "/mcp") { res.writeHead(404); res.end(); return; }
    if (req.method === "DELETE") { sessions.delete(req.headers["mcp-session-id"]); res.writeHead(204); res.end(); return; }
    if (discovery && req.method === "GET") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": connected\n\n"); streams.add(res); res.once("close", () => streams.delete(res)); return; }
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    if (mode === "redirect") { res.writeHead(307, { location: "/wrong-target" }); res.end(); return; }
    if (!message?.id) { res.writeHead(202); res.end(); return; }
    let result;
    if (message.method === "initialize") { const session = randomUUID(); sessions.add(session); res.setHeader("mcp-session-id", session); result = { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: true }, ...(discovery ? { resources: { listChanged: true } } : {}) }, serverInfo: { name: "controlled-http", version: "1" } }; }
    else if (message.method === "tools/list") result = { tools: withdrawnTool ? [] : [{ name: "echo", description: "Controlled remote action", inputSchema: schema, annotations: { readOnlyHint: true } }] };
    else if (discovery && message.method === "resources/list") result = { resources: withdrawnResource ? [] : [{ uri, name: "Remote README", mimeType: resourceMode === "binary-secret" ? "application/octet-stream" : "text/plain", size: 24, description: `resource definition ${version}` }] };
    else if (discovery && message.method === "resources/templates/list") result = { resourceTemplates: [] };
    else if (discovery && message.method === "resources/read") {
      if (resourceMode === "disconnect") { req.socket.destroy(); return; }
      if (resourceMode === "delay") { await new Promise((resolve) => { const timer = setTimeout(resolve, delayMs); res.once("close", () => { clearTimeout(timer); resolve(); }); }); if (res.destroyed) return; }
      const text = resourceMode === "oversized" ? "x".repeat(70000) : ["secret-blob", "binary-secret"].includes(resourceMode) ? token : "controlled remote README";
      const first = { uri: resourceMode === "bad-uri" ? "file:///etc/passwd" : uri, mimeType: resourceMode === "html" ? "text/html" : resourceMode === "binary-secret" ? "application/octet-stream" : "text/plain", ...(["blob", "secret-blob", "binary-secret"].includes(resourceMode) ? { blob: Buffer.from(text).toString("base64") } : { text }) };
      result = { contents: resourceMode === "partial" ? [first, { uri: "file:///etc/passwd", mimeType: "text/plain", text: "untrusted second part" }] : [first] };
    }
    else if (message.method === "tools/call") {
      if (mode === "disconnect") { req.socket.destroy(); return; }
      if (mode === "delay") { await new Promise((resolve) => { const timer = setTimeout(resolve, delayMs); res.once("close", () => { clearTimeout(timer); resolve(); }); }); if (res.destroyed) return; }
      result = { content: [{ type: "text", text: ["secret", "sse-secret"].includes(mode) ? JSON.stringify({ value: token }).replace(/./gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) : ["oversized", "sse-oversized"].includes(mode) ? "x".repeat(70000) : `remote result: ${message.params.arguments.value}` }] };
    } else { res.writeHead(400); res.end(); return; }
    const reply = { jsonrpc: "2.0", id: message.id, result };
    if (["sse", "sse-open", "sse-secret", "sse-oversized"].includes(mode) && message.method === "tools/call") {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      if (mode === "sse-open") await new Promise((resolve) => { const timer = setTimeout(resolve, delayMs); res.once("close", () => { clearTimeout(timer); resolve(); }); });
      if (!res.destroyed) res.end();
    }
    else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, token, received, sessions,
    setMode: (value) => { mode = value; }, setResourceMode: (value) => { resourceMode = value; },
    dropNotifications: (oversized = false) => { received.push({ type: "notification-channel", outcome: oversized ? "oversized" : "eof" }); for (const stream of streams) { if (oversized) stream.write(`: ${"x".repeat(70000)}\n\n`); else stream.end(); } },
    changeSchema: () => { schema = { ...schema, description: `new definition ${++version}` }; if (discovery) { notify("notifications/tools/list_changed"); notify("notifications/resources/list_changed"); } },
    withdraw: () => { withdrawnTool = true; withdrawnResource = true; notify("notifications/tools/list_changed"); notify("notifications/resources/list_changed"); },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); } };
}
