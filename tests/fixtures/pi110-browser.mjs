import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createPi110SourceCli } from "./pi110-source-cli.mjs";
import { startHost } from "../../packages/host/server.mjs";

// Development-source B/P acceptance, not a candidate install or Full gate.
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-browser-")));
const requests = [], sockets = new Set();
const provider = http.createServer(async (req, res) => {
  let text = ""; for await (const bytes of req) text += bytes;
  const request = { key: req.headers.authorization, body: JSON.parse(text), closed: false };
  res.once("close", () => { request.closed = true; }); requests.push(request);
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end('data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"browser fixture response"},"finish_reason":null}]}\n\ndata: {"id":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
provider.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, installedExtensions: true });
const host = await startHost({ configRoot: f.config, stack: { root: f.stack, ompPackageRoot: f.omp, nodePath: path.join(f.stack, "node/bin/node"), piCliPath: path.join(f.stack, "pi/dist/bundle/cli.js"), stackId: `sha256:${"a".repeat(64)}` },
  assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), allowControlled: true, env: { PATH: process.env.PATH, HOME: f.home } });
console.log(JSON.stringify({ pairingUrl: host.pairingUrl, origin: host.origin, project: f.project, configRoot: f.config, cli: f.cli, node: path.join(f.stack, "node/bin/node"), pid: process.pid, evidence: "source C/P/B; I/L NOT_RUN" }));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await host.stop(); for (const socket of sockets) socket.destroy(); await new Promise((resolve) => provider.close(resolve));
  console.log(JSON.stringify({ stopped: true, requests, rawSettings: JSON.parse(await fs.readFile(path.join(f.config, "settings.json"), "utf8")), terminalState: JSON.parse(await fs.readFile(path.join(f.config, "only-my-pi/host/terminals.json"), "utf8").catch(() => '{"terminals":[]}')) }));
  await fs.rm(root, { recursive: true, force: true });
}
process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
