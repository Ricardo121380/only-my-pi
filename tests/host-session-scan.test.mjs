import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startHost } from "../packages/host/server.mjs";

for (const failScan of [false, true]) {
  test(`HTTP history remains available during ${failScan ? "a failed" : "a successful"} rescan`, async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-scan-")));
    const project = path.join(root, "project"), sessionRoot = path.join(root, "sessions"), assetsRoot = path.join(root, "assets");
    await fs.mkdir(project); await fs.mkdir(sessionRoot); await fs.mkdir(assetsRoot);
    await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>fixture</title>");
    const file = path.join(sessionRoot, "history.jsonl");
    const bytes = JSON.stringify({ type: "session", version: 3, id: "retained", cwd: project }) + "\n";
    await fs.writeFile(file, bytes);
    const host = await startHost({ configRoot: path.join(root, "config"), assetsRoot, sessionRoot, stack: { stackId: `sha256:${"a".repeat(64)}` }, modelsProvider: async () => [] });
    t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }); });
    await host.catalog.scan();
    const paired = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
    assert.equal(paired.status, 200);
    const cookie = paired.headers.get("set-cookie").split(";")[0];
    const projectId = host.catalog.listProjects()[0].projectId;
    const listing = async () => {
      const response = await fetch(`${host.origin}/api/sessions?projectId=${projectId}`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200); return (await response.json()).sessions;
    };
    const before = await listing();
    assert.equal(before[0].sessionId, "retained");
    let release, reached;
    const gate = new Promise(resolve => { release = resolve; });
    const scanning = new Promise(resolve => { reached = resolve; });
    const readdir = fs.readdir;
    t.mock.method(fs, "readdir", async (...args) => {
      if (args[0] === sessionRoot) {
        reached(); await gate;
        if (failScan) throw Object.assign(new Error("fixture read failure"), { code: "EIO" });
      }
      return readdir(...args);
    });
    const scan = host.catalog.scan();
    const settled = scan.then(() => null, error => error);
    try {
      await scanning;
      assert.deepEqual(await listing(), before, "an in-flight scan must not publish an empty or partial history");
    } finally { release(); await settled; }
    assert.equal((await settled)?.code, failScan ? "EIO" : undefined);
    assert.deepEqual(await listing(), before);
    assert.equal(await fs.readFile(file, "utf8"), bytes);
  });
}
