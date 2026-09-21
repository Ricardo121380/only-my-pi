// Manual Ego Lite acceptance fixture. No real credentials, models, or user projects.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { startHost } from "../../packages/host/server.mjs";
import { loadDistribution } from "../../packages/distribution/runtime.mjs";

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-browser-accounts-")));
const project = path.join(root, "project"); await fs.mkdir(project);
await fs.writeFile(path.join(project, "README.md"), "# Local browser acceptance fixture\n");
let requests = 0;
const model = http.createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  if (req.headers.authorization !== "Bearer fixture-browser") { res.writeHead(401); res.end(); return; }
  requests++;
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const choice of [{ delta: { role: "assistant", content: "本地模拟服务已确认独立账号请求。" }, finish_reason: null }, { delta: {}, finish_reason: "stop" }]) {
    res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const stack = await loadDistribution({ packageRoot: process.env.OMP_TEST_STACK_PACKAGE });
if (!stack) throw Error("Fixture requires an explicit verified installed stack");
const host = await startHost({ stack, configRoot: path.join(root, "config"), assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), env: { PATH: process.env.PATH } });
console.log(JSON.stringify({ pairingUrl: host.pairingUrl, project, baseUrl: `http://127.0.0.1:${model.address().port}/v1` }));
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  await host.stop(); await new Promise((resolve) => model.close(resolve));
  await fs.rm(root, { recursive: true }); console.log(JSON.stringify({ requests, stopped: true }));
}
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
