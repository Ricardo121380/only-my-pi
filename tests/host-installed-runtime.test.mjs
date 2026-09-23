import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

test("installed Host serves packaged UI and owns a real PTY through cleanup", { skip: !process.env.OMP_TEST_STACK_PACKAGE, timeout: 30000 }, async (t) => {
  const packageRoot = await fs.realpath(process.env.OMP_TEST_STACK_PACKAGE);
  const { loadDistribution } = await import(pathToFileURL(path.join(packageRoot, "packages/distribution/runtime.mjs")));
  const stack = await loadDistribution({ packageRoot });
  assert.ok(stack);
  const { startHost } = await import(pathToFileURL(path.join(packageRoot, "packages/host/server.mjs")));
  const { acquireOwnership } = await import(pathToFileURL(path.join(packageRoot, "packages/host/ownership.mjs")));
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-installed-host-")));
  let host;
  t.after(async () => {
    await host?.stop();
    await fs.rm(root, { recursive: true });
  });
  const project = path.join(root, "project"), configRoot = path.join(root, "config");
  await fs.mkdir(project);
  const assetsRoot = path.join(packageRoot, "webui/dist");
  const startedAt = performance.now();
  host = await startHost({ stack, configRoot, assetsRoot, allowControlled: true, env: { PATH: "/usr/bin:/bin" } });
  const hostStartMs = performance.now() - startedAt;
  assert.equal(await (await fetch(host.origin)).text(), await fs.readFile(path.join(assetsRoot, "index.html"), "utf8"));
  const pair = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  assert.equal(pair.status, 200);
  const headers = { Origin: host.origin, Cookie: pair.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-host-protocol": "2" };
  async function command(body) {
    const response = await fetch(host.origin + "/api/command", { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  }
  const { projectId } = await command({ type: "addProject", path: project });
  const terminal = await command({ type: "openTerminal", projectId, cols: 100, rows: 30 });
  assert.equal(terminal.status, "running");
  await assert.rejects(acquireOwnership(configRoot, "project", project), { code: "OWNERSHIP_HELD" });
  await command({ type: "writeTerminal", terminalId: terminal.terminalId, seq: 1, data: "printf installed-pty > proof.txt\r" });
  const deadline = Date.now() + 5000;
  while (await fs.readFile(path.join(project, "proof.txt"), "utf8").catch(() => "") !== "installed-pty") {
    assert.ok(Date.now() < deadline, "installed PTY must execute actual shell input");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (process.platform === "darwin") {
    const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss=,comm="], { encoding: "utf8" }).trim().split("\n").map((line) => {
      const [, pid, ppid, rss, executable] = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      return { pid: Number(pid), ppid: Number(ppid), rssBytes: Number(rss) * 1024, executable };
    });
    const ids = new Set([process.pid]);
    let changed;
    do { changed = false; for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } } while (changed);
    const processes = rows.filter((row) => ids.has(row.pid) && row.executable !== "/bin/ps");
    t.diagnostic(JSON.stringify({ scope: "installed Host plus PTY tree; includes test harness, excludes browser and model worker", hostStartMs, rssBytes: processes.reduce((sum, row) => sum + row.rssBytes, 0), processes }));
  }
  const closeAt = performance.now();
  assert.equal((await command({ type: "closeTerminal", terminalId: terminal.terminalId })).status, "closed");
  t.diagnostic(JSON.stringify({ scope: "idle terminal close through clean receipt", closeMs: performance.now() - closeAt }));
  const lease = await acquireOwnership(configRoot, "project", project); await lease.release();
});
