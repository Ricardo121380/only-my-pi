import http from "node:http";
import { randomUUID } from "node:crypto";

// A real Streamable HTTP service. Its reception ledger is independent of OMP.
export async function createHttpMcpServer({ token = "fixture-http-identity", mode = "json", delayMs = 15000, maxInputLength = 100 } = {}) {
  const received = [], sockets = new Set(), sessions = new Set();
  let schema = { type: "object", properties: { value: { type: "string", maxLength: maxInputLength } }, required: ["value"], additionalProperties: false };
  const server = http.createServer(async (req, res) => {
    const identity = req.headers.authorization === `Bearer ${token}`;
    let text = ""; for await (const bytes of req) text += bytes;
    const message = text ? JSON.parse(text) : null;
    received.push({ path: req.url, method: req.method, identity, rpc: message?.method ?? null, args: message?.params?.arguments, session: Boolean(req.headers["mcp-session-id"]) });
    if (!identity) { res.writeHead(401, { "www-authenticate": "Bearer" }); res.end(); return; }
    if (req.url !== "/mcp") { res.writeHead(404); res.end(); return; }
    if (req.method === "DELETE") { sessions.delete(req.headers["mcp-session-id"]); res.writeHead(204); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    if (mode === "redirect") { res.writeHead(307, { location: "/wrong-target" }); res.end(); return; }
    if (!message?.id) { res.writeHead(202); res.end(); return; }
    let result;
    if (message.method === "initialize") { const session = randomUUID(); sessions.add(session); res.setHeader("mcp-session-id", session); result = { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "controlled-http", version: "1" } }; }
    else if (message.method === "tools/list") result = { tools: [{ name: "echo", description: "Controlled remote action", inputSchema: schema, annotations: { readOnlyHint: true } }] };
    else if (message.method === "tools/call") {
      if (mode === "disconnect") { req.socket.destroy(); return; }
      if (mode === "delay") { await new Promise((resolve) => { const timer = setTimeout(resolve, delayMs); res.once("close", () => { clearTimeout(timer); resolve(); }); }); if (res.destroyed) return; }
      result = { content: [{ type: "text", text: mode === "secret" ? JSON.stringify({ value: token }).replace(/./gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) : mode === "oversized" ? "x".repeat(70000) : `remote result: ${message.params.arguments.value}` }] };
    } else { res.writeHead(400); res.end(); return; }
    const reply = { jsonrpc: "2.0", id: message.id, result };
    if (mode === "sse" && message.method === "tools/call") { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`); }
    else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, token, received, sessions,
    setMode: (value) => { mode = value; }, changeSchema: () => { schema = { ...schema, description: "new definition" }; },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); } };
}
