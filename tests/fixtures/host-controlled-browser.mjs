// Real Host + SDK, local scripted model; never uses user credentials or projects.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { startHost } from "../../packages/host/server.mjs";
import { AccountCatalog } from "../../packages/host/accounts.mjs";
import { loadDistribution } from "../../packages/distribution/runtime.mjs";

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-browser-control-")));
const configRoot = path.join(root, "config"), project = path.join(root, "project");
await fs.mkdir(project);
await fs.writeFile(path.join(project, "README.md"), "# Editor fixture\n\nOnly temporary project data.\n");
await fs.writeFile(path.join(project, "example.ts"), "export const message = 'hello';\n");
let requests = 0;
const model = http.createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  if (req.headers.authorization !== "Bearer fixture-control") { res.writeHead(401); res.end(); return; }
  const step = requests++;
  const tools = [
    { name: "request_coding_access", arguments: JSON.stringify({ taskSummary: "Browser approval fixture", complexity: "simple", scope: ["proof.txt"], riskFlags: [], verification: ["read proof.txt"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } }) },
    { name: "write", arguments: JSON.stringify({ path: "proof.txt", content: "browser approved\n" }) },
  ];
  const delta = tools[step] ? { role: "assistant", tool_calls: [{ index: 0, id: `fixture-${step}`, type: "function", function: tools[step] }] } : { role: "assistant", content: "本地审批测试结束。写入与否请以实际文件为准。" };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: tools[step] ? "tool_calls" : "stop" }]) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const accounts = new AccountCatalog(configRoot);
const account = await accounts.create({ providerId: "fixture", name: "Local control fixture", authType: "api_key" });
const paths = await accounts.runtimePaths(account.accountId);
await fs.writeFile(paths.authPath, JSON.stringify({ fixture: { type: "api_key", key: "fixture-control" } }));
await fs.writeFile(paths.modelsPath, JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 128 }] } } }));
const stack = await loadDistribution({ packageRoot: process.env.OMP_TEST_STACK_PACKAGE });
if (!stack) throw Error("An explicit verified stack is required");
if (process.env.OMP_TEST_CLI === "1") {
  await fs.copyFile(paths.authPath, path.join(configRoot, "auth.json"));
  await fs.copyFile(paths.modelsPath, path.join(configRoot, "models.json"));
}
const host = await startHost({ stack, configRoot, assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), allowControlled: true, env: { PATH: process.env.PATH } });
const paired = await fetch(`${host.origin}/pair`, { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
const cookie = paired.headers.get("set-cookie").split(";")[0];
async function command(input) {
  const result = await fetch(`${host.origin}/api/command`, { method: "POST", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2" }, body: JSON.stringify(input) });
  if (!result.ok) throw Error(`Fixture command failed: ${result.status}`);
  return result.json();
}
const added = await command({ type: "addProject", path: project });
const task = process.env.OMP_TEST_CLI === "1" ? null : await command({ type: "startTask", requestId: "browser-control", projectId: added.projectId, accountId: account.accountId, model: "fixture/fixture", mode: "controlled", prompt: "浏览器审批验收：仅写入临时 proof.txt" });
const pair = await fetch(`${host.origin}/internal/pair`, { method: "POST", headers: { Authorization: `Bearer ${host.controlToken}` } });
console.log(JSON.stringify({ pairingUrl: (await pair.json()).url, project, configRoot, projectId: added.projectId, accountId: account.accountId, taskId: task?.taskId ?? null }));
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  await host.stop(); await new Promise((resolve) => model.close(resolve));
  const proof = await fs.readFile(path.join(project, "proof.txt"), "utf8").catch(() => null);
  await fs.rm(root, { recursive: true }); console.log(JSON.stringify({ requests, proof, stopped: true }));
}
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
