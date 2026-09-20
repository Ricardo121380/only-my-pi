import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { RpcWorker } from "../packages/host/rpc-worker.mjs";
import { groupAlive } from "../packages/host/ownership.mjs";

async function fixture(t, malformed = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-rpc-wire-"))); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "worker.mjs");
  await fs.writeFile(file, `import {createInterface} from "node:readline"; const lines=createInterface({input:process.stdin}); for await(const line of lines){const c=JSON.parse(line); if(${malformed}){process.stdout.write("not-json\\n");continue;} process.stdout.write(JSON.stringify({id:c.id,type:"response",command:c.type,success:true,data:{sessionId:"fixture-session"}})+"\\n");}`);
  const worker = new RpcWorker({ stack: { nodePath: process.execPath, piCliPath: file, stackId: `sha256:${"a".repeat(64)}` }, configRoot: root, cwd: root, model: "mock/test", sessionRoot: root,
    extensionResolver: async () => ({ extensions: [file] }), spawnImpl: (_node, _argv, options) => spawn(process.execPath, [file], options) });
  t.after(() => worker.stop()); return worker;
}
test("RPC worker correlates JSONL responses, denies raw commands and confirms process exit", async (t) => {
  const worker = await fixture(t); assert.equal((await worker.start()).sessionId, "fixture-session");
  const pid = worker.identity.pid; await assert.rejects(worker.command("bash"), { code: "RPC_COMMAND_DENIED" });
  await worker.cancel(); assert.equal(groupAlive(pid), false);
});
test("malformed worker output fails closed without retaining a process", async (t) => {
  const worker = await fixture(t, true); const faults = []; worker.on("fault", (e) => faults.push(e.code));
  await assert.rejects(worker.start()); await worker.stop(); assert.ok(faults.includes("RPC_FRAME_INVALID")); assert.equal(groupAlive(worker.child.pid), false);
});
test("a worker cancelled before launch never spawns", async (t) => {
  const worker = await fixture(t); await worker.stop(); await assert.rejects(worker.start(), { code: "RPC_CANCELLED_BEFORE_START" }); assert.equal(worker.child, null);
});
test("account switching waits for old process termination before starting a new worker", async (t) => {
  const a = await fixture(t), b = await fixture(t);
  await a.start(); const oldPid = a.identity.pid;
  await a.cancel(); assert.equal(groupAlive(oldPid), false);
  await b.start(); assert.notEqual(b.identity.pid, oldPid); assert.equal(groupAlive(oldPid), false);
  await b.cancel();
});
