import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { startDevWeb } from "../scripts/dev-web.mjs";
import { AccountCatalog } from "../packages/accounts/catalog.mjs";
import { groupAlive } from "../packages/process-runtime/ownership.mjs";

async function until(read, accept, label) {
  for (let i = 0; i < 1200; i++) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(`Timed out: ${label}`);
}

test("B2 native read-only children keep the selected account/model, return proof and stop with their parent", { timeout: 90000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-b2-readonly-"));
  const app = await startDevWeb({ frontend: "b2", dataDir, demo: true, watch: false, port: 0 });
  t.after(async () => { await app.stop(); await fs.rm(dataDir, { recursive: true }); });
  const accounts = new AccountCatalog(app.configRoot), account = await accounts.create({ providerId: "fixture", name: "Bound parent and child", authType: "api_key" });
  const paths = await accounts.runtimePaths(account.accountId);
  await fs.writeFile(paths.modelsPath, await fs.readFile(path.join(app.configRoot, "models.json")));
  await fs.writeFile(paths.authPath, JSON.stringify({ fixture: { type: "api_key", key: "bound-account-fixture" } }));
  const origin = app.host.origin;
  const paired = await fetch(origin + "/pair", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(app.host.pairingUrl).hash.slice(6) }) });
  const headers = { origin, cookie: paired.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-host-protocol": "2" };
  const command = async body => { const response = await fetch(origin + "/api/command", { method: "POST", headers, body: JSON.stringify(body) }); assert.equal(response.status, ["startTask", "cancelTask"].includes(body.type) ? 202 : 200); return response.json(); };
  const task = async id => (await fetch(`${origin}/api/task?taskId=${id}`, { headers })).json();
  const project = await command({ type: "addProject", path: app.project });
  const start = prompt => command({ type: "startTask", requestId: randomUUID(), projectId: project.projectId, accountId: account.accountId, model: "fixture/one", prompt });
  const first = await start("delegate read");
  const completed = await until(() => task(first.taskId), value => ["succeeded", "failed"].includes(value.status), "real child completion");
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.ok(completed.orchestration?.children?.length, JSON.stringify(completed));
  assert.equal(completed.orchestration.children[0].status, "completed", JSON.stringify(completed));
  assert.equal(completed.orchestration.children[0].model, "fixture/one");
  assert.equal(completed.orchestration.children[0].accountId, account.accountId);
  assert.match(JSON.stringify(completed.messages), /minimal-web-evidence/);
  assert.match(JSON.stringify(completed.messages), /authoritative/);
  assert.ok(app.provider.received.every(record => record.authorization === "Bearer bound-account-fixture" && record.body.model === "one"));
  const childRequests = app.provider.received.filter(record => record.body.tools?.some(tool => tool.function?.name === "structured_output"));
  assert.ok(childRequests.length >= 2);
  for (const { body } of childRequests) assert.deepEqual(body.tools.map(tool => tool.function.name).sort(), ["find", "grep", "ls", "read", "structured_output"]);
  const policyDir = path.join(app.project, ".pi"); await fs.mkdir(policyDir);
  const policyFile = path.join(policyDir, "permission-mode.json");
  await fs.writeFile(policyFile, JSON.stringify({ modes: { plan: { permission: { tool: { delegate_readonly_agent: "deny" } } } } }));
  const beforeDeny = app.provider.received.length, denied = await start("delegate read");
  const deniedTask = await until(() => task(denied.taskId), value => ["succeeded", "failed"].includes(value.status), "project-level denial");
  assert.equal(deniedTask.orchestration.totalChildren, 0);
  assert.equal(deniedTask.toolCalls[0].status, "failed");
  assert.equal(app.provider.received.slice(beforeDeny).some(record => record.body.tools?.some(tool => tool.function?.name === "structured_output")), false);
  await fs.unlink(policyFile); await fs.rmdir(policyDir);
  const stopped = await start("delegate stop");
  await until(() => app.provider.received.at(-1), record => record.body.tools?.some(tool => tool.function?.name === "structured_output") && record.body.messages.some(message => JSON.stringify(message.content).includes("child stop")), "running physical child");
  const worker = app.host.tasks.workers.get(stopped.taskId), pid = worker.identity.pid;
  await command({ type: "cancelTask", taskId: stopped.taskId });
  const cancelled = await until(() => task(stopped.taskId), value => ["cancelled", "failed"].includes(value.status), "parent and child cancellation");
  assert.equal(cancelled.status, "cancelled", JSON.stringify(cancelled));
  assert.equal(groupAlive(pid), false); assert.equal(app.host.tasks.workers.size, 0);
  assert.equal(app.provider.received.at(-1).closed, true);
  assert.equal(app.host.tasks.accountReleases.size, 0);
});
