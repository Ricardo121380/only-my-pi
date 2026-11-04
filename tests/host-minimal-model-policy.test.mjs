import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "../packages/host/server.mjs";
import { AccountCatalog } from "../packages/accounts/catalog.mjs";
import { runAccountChild } from "../packages/direct-agent/account-child.mjs";

test("DeepSeek-only Host filters the catalog and rejects other models before task/probe execution", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-deepseek-policy-"));
  const assetsRoot = path.join(root, "assets"), project = path.join(root, "project"), configRoot = path.join(root, "config");
  await fs.mkdir(assetsRoot); await fs.mkdir(project); await fs.writeFile(path.join(assetsRoot, "minimal.html"), "<title>Local policy check</title>");
  let workerStarts = 0;
  const ds = "commandcode/deepseek/deepseek-v4.1-flash", other = "commandcode/gpt-6.1-terra";
  const host = await startHost({ configRoot, assetsRoot, stack: { root, nodePath: process.execPath, stackId: `sha256:${"a".repeat(64)}` }, minimal: true, deepseekOnly: true,
    modelsProvider: () => [ds, other].map(id => ({ id, name: id, thinkingLevels: [] })), workerFactory: () => { workerStarts++; throw new Error("Must not spawn"); } });
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true }); });
  const accounts = new AccountCatalog(configRoot), account = await accounts.create({ providerId: "commandcode", name: "Policy fixture", authType: "api_key" });
  const origin = host.origin;
  const paired = await fetch(origin + "/pair", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  const headers = { origin, cookie: paired.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-account-protocol": "1" };
  const post = (route, body) => fetch(origin + route, { method: "POST", headers, body: JSON.stringify(body) });
  const added = await (await post("/api/command", { type: "addProject", path: project })).json();
  const listed = await (await fetch(`${origin}/api/models?accountId=${account.accountId}`, { headers })).json();
  assert.deepEqual(listed.models.map(model => model.id), [ds]);
  for (const [route, body] of [
    ["/api/command", { type: "startTask", requestId: "rejected", projectId: added.projectId, accountId: account.accountId, model: other, prompt: "Must not execute" }],
    ["/api/account-action", { accountId: account.accountId, action: { type: "probe", model: other } }],
  ]) {
    const response = await post(route, body);
    assert.equal(response.status, 409); assert.equal((await response.json()).code, "DEEPSEEK_MODEL_REQUIRED");
  }
  assert.equal(workerStarts, 0); assert.equal(host.tasks.tasks.size, 0); assert.equal(host.tasks.accountReleases.size, 0);
});

test("read-only child rejects tools, model overrides and non-DeepSeek identities before reading credentials", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-child-policy-"));
  t.after(() => fs.rm(root, { recursive: true }));
  await fs.symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))), path.join(root, "pi"));
  const ds = "commandcode/deepseek/deepseek-v4.1-flash";
  const run = (model, tools, modelId = ds) => runAccountChild({ stack: { root }, configRoot: path.join(root, "missing-config"), accountId: "missing-account", readonly: true, deepseekOnly: true, modelId,
    argv: ["--mode", "json", "-p", "--no-session", "--no-extensions", "--model", model, "--tools", tools, "Never execute"] });
  await assert.rejects(run(ds, "write"), /CHILD_READONLY_TOOLS_REQUIRED/);
  await assert.rejects(run(ds, "delegate_readonly_agent"), /CHILD_READONLY_TOOLS_REQUIRED/);
  await assert.rejects(run("commandcode/deepseek/deepseek-v4-pro", "read"), /CHILD_ACCOUNT_MODEL_MISMATCH/);
  await assert.rejects(run("commandcode/gpt-6.1-terra", "read", "commandcode/gpt-6.1-terra"), /DEEPSEEK_MODEL_REQUIRED/);
  await assert.rejects(fs.access(path.join(root, "missing-config")), { code: "ENOENT" });
});
