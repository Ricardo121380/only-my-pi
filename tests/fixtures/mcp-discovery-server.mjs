import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
const root = process.env.OMP_MCP_RUNTIME_DIR, mode = process.env.F_MODE, name = process.env.F_SERVER_NAME ?? "local";
let phase = 1, lists = 0;
const uri = `mcp://${name}/readme`;
const record = (value) => fs.appendFile(path.join(root, "received.jsonl"), JSON.stringify(value) + "\n");
const output = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const notify = async () => { for (const method of ["notifications/tools/list_changed", "notifications/resources/list_changed"]) { await record({ type: "notification", method }); process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n"); } };
await record({ type: "started", pid: process.pid });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line); if (message.id === undefined) continue;
  await record({ type: "request", method: message.method, uri: message.params?.uri });
  if (message.method === "initialize") output(message.id, { protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: true }, resources: { listChanged: true } }, serverInfo: { name: "controlled-discovery", version: "1" } });
  else if (message.method === "tools/list") {
    const changing = ++lists === 2 && ["notify", "withdraw"].includes(mode); if (changing) phase++;
    output(message.id, { tools: mode === "withdraw" && phase > 1 ? [] : [{ name: "read_file", description: `Read selected file definition ${phase}`, inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } }, additionalProperties: false } }] });
    if (changing) await notify();
  } else if (message.method === "resources/list") output(message.id, { resources: mode === "withdraw" && phase > 1 ? [] : [{ uri, name: "Selected README", mimeType: "text/plain", size: mode === "claimed-large" ? 70000 : 22, description: `resource definition ${phase}` }, { uri: `mcp://${name}/hidden`, name: "unadmitted resource", mimeType: "text/plain" }] });
  else if (message.method === "resources/templates/list") output(message.id, { resourceTemplates: [] });
  else if (message.method === "tools/call") { await record({ type: "call", arguments: message.params.arguments }); output(message.id, { content: [{ type: "text", text: await fs.readFile(message.params.arguments.path, "utf8") }] }); }
  else if (message.method === "resources/read") {
    await record({ type: "resource", uri: message.params.uri });
    if (mode === "crash") process.exit(23);
    if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 15000));
    const text = mode === "large" ? "x".repeat(70000) : await fs.readFile(path.join(process.cwd(), mode === "outside" ? "private.txt" : "README.md"), "utf8");
    const first = { uri: mode === "bad-uri" ? "file:///etc/passwd" : uri, mimeType: mode === "html" ? "text/html" : "text/plain", ...(mode === "blob" ? { blob: Buffer.from(text).toString("base64") } : { text }) };
    output(message.id, { contents: mode === "partial" ? [first, { uri: "file:///etc/passwd", text: "untrusted second part", mimeType: "text/plain" }] : [first] });
  } else output(message.id, {});
}
