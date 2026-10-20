import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnAuthProcess, recoverAuthProcesses } from "../packages/host/auth-process.mjs";
import { atomicWriteJson } from "../packages/config-runtime/index.mjs";

test("authentication subprocess identity is durable before begin; recovery confirms its exit", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-auth-process-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const child = await spawnAuthProcess(root, process.execPath, ["-e", "process.on('message',()=>{});setInterval(()=>{},1000)"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => child.kill("SIGKILL"));
  const directory = path.join(root, "only-my-pi/host/auth-processes");
  const names = await fs.readdir(directory); assert.equal(names.length, 1);
  const record = JSON.parse(await fs.readFile(path.join(directory, names[0]), "utf8"));
  assert.equal(record.pid, child.pid); assert.match(record.identity, /^[a-f0-9]{64}$/);
  await recoverAuthProcesses(root);
  assert.equal(process.kill(child.pid, 0), true, "a live independent authentication owner is preserved");
  assert.equal((await fs.readdir(directory)).length, 1);
  // Legacy orphan records have no live parent ownership and remain recoverable.
  await atomicWriteJson(root, path.join(directory, names[0]), { pid: record.pid, identity: record.identity });
  await recoverAuthProcesses(root);
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  assert.deepEqual(await fs.readdir(directory), []);
  const reused = path.join(directory, "aaaa.json");
  await atomicWriteJson(root, reused, { pid: process.pid, identity: "different-owner" });
  await assert.rejects(recoverAuthProcesses(root), { code: "AUTH_PROCESS_RECONCILIATION_REQUIRED" });
  assert.equal(process.kill(process.pid, 0), true);
});
