import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { startHost } from "../packages/host/server.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

test("manual HTTP requires pairing, protocol, origin and a lease; restart never restores it", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-manual-http-")));
  const configRoot = path.join(root, "config"), project = path.join(root, "project"), assetsRoot = path.join(root, "assets");
  await fs.mkdir(project); await fs.mkdir(assetsRoot); await fs.writeFile(path.join(assetsRoot, "index.html"), "fixture");
  await fs.writeFile(path.join(project, "test.txt"), "initial");
  const options = { configRoot, assetsRoot, stack: { stackId: "fixture" }, allowControlled: true, modelsProvider: async () => [] };
  let host = await startHost(options);
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true }); });
  async function pair() {
    const result = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
    return result.headers.get("set-cookie").split(";")[0];
  }
  let cookie = await pair();
  const command = (input, extra = {}) => fetch(host.origin + "/api/command", { method: "POST", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2", ...extra }, body: JSON.stringify(input) });
  const { projectId } = await (await command({ type: "addProject", path: project })).json();
  const enter = { type: "enterManual", projectId };
  assert.equal((await command(enter, { Cookie: "" })).status, 401);
  assert.equal((await command(enter, { Origin: "https://invalid.test" })).status, 403);
  assert.equal((await command(enter, { "x-omp-host-protocol": "1" })).status, 409);
  const { manualId } = await (await command(enter)).json();
  await assert.rejects(acquireOwnership(configRoot, "project", project), { code: "OWNERSHIP_HELD" });
  const data = await (await fetch(host.origin + `/api/file?projectId=${projectId}&path=test.txt`, { headers: { Cookie: cookie } })).json();
  const save = { type: "saveFile", projectId, manualId, path: "test.txt", version: data.version, text: "文本".repeat(40000) };
  assert.equal((await command({ ...save, manualId: "wrong" })).status, 409);
  assert.equal((await command(save)).status, 200);
  assert.equal(await fs.readFile(path.join(project, "test.txt"), "utf8"), save.text);
  assert.equal((await command(save)).status, 409);
  await host.stop(); host = await startHost(options); cookie = await pair();
  assert.equal((await command(save)).status, 409);
  assert.deepEqual((await (await fetch(host.origin + "/api/manual", { headers: { Cookie: cookie } })).json()).workspaces, []);
  const next = await acquireOwnership(configRoot, "project", project); await next.release();
  await host.stop(); host = await startHost({ ...options, allowControlled: false }); cookie = await pair();
  assert.equal((await command(enter)).status, 409);
});
