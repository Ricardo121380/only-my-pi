import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startHost } from "../packages/host/server.mjs";

test("terminal HTTP authenticates, validates input and coordinates manual ownership", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-terminal-http-")));
  const project = path.join(root, "project"), assetsRoot = path.join(root, "assets");
  await fs.mkdir(project); await fs.mkdir(assetsRoot); await fs.writeFile(path.join(assetsRoot, "index.html"), "fixture");
  const options = { configRoot: path.join(root, "config"), assetsRoot, stack: { stackId: "fixture" }, modelsProvider: async () => [], allowControlled: true };
  let host = await startHost(options), cookie;
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true }); });
  async function pair() {
    const res = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
    cookie = res.headers.get("set-cookie").split(";")[0];
  }
  await pair();
  const cmd = (input, extra = {}) => fetch(host.origin + "/api/command", { method: "POST", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2", ...extra }, body: JSON.stringify(input) });
  const { projectId } = await (await cmd({ type: "addProject", path: project })).json();
  const open = { type: "openTerminal", projectId, cols: 90, rows: 24 };
  assert.equal((await cmd(open, { Cookie: "" })).status, 401);
  assert.equal((await cmd(open, { Origin: "https://example.com" })).status, 403);
  assert.equal((await cmd(open, { "x-omp-host-protocol": "1" })).status, 409);
  assert.equal((await cmd({ ...open, shell: "/bin/sh" })).status, 400);
  assert.equal((await cmd({ ...open, cols: 0 })).status, 400);
  const { terminalId } = await (await cmd(open)).json();
  assert.ok(terminalId);
  assert.equal((await (await cmd(open)).json()).terminalId, terminalId);
  assert.equal((await cmd({ type: "enterManual", projectId })).status, 500);
  assert.equal((await cmd({ type: "writeTerminal", terminalId, seq: 2, data: "wrong\r" })).status, 409);
  assert.equal((await cmd({ type: "writeTerminal", terminalId, seq: 1, data: "a".repeat(16385) })).status, 400);
  assert.equal((await fetch(host.origin + "/api/terminal?terminalId=" + terminalId)).status, 401);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const output = await (await fetch(host.origin + "/api/terminal?terminalId=" + terminalId, { headers: { Cookie: cookie } })).json();
    if (output.output?.includes("%")) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal((await (await cmd({ type: "closeTerminal", terminalId })).json()).status, "closed");
  assert.equal((await cmd({ type: "enterManual", projectId })).status, 200);
  await host.stop(); host = await startHost({ ...options, allowControlled: false }); await pair();
  assert.equal((await cmd(open)).status, 409);
});
