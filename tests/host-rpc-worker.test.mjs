import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { RpcWorker } from "../packages/host/rpc-worker.mjs";
import { groupAlive } from "../packages/host/ownership.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { fileURLToPath } from "node:url";

async function fixture(t, malformed = false, uncontrolledExit = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-rpc-wire-"))); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "worker.mjs");
  await fs.mkdir(path.join(root, "pi"));
  await fs.writeFile(path.join(root, "pi/package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.1" }));
  await fs.writeFile(file, `import {createInterface} from "node:readline"; const lines=createInterface({input:process.stdin}); for await(const line of lines){const c=JSON.parse(line); if(${malformed}){process.stdout.write("not-json\\n");continue;} process.stdout.write(JSON.stringify({id:c.id,type:"response",command:c.type,success:true,data:{sessionId:"fixture-session"}})+"\\n");}`);
  const worker = new RpcWorker({ stack: { root, nodePath: process.execPath, piCliPath: file, stackId: `sha256:${"a".repeat(64)}` }, configRoot: root, cwd: root, model: "mock/test", sessionRoot: root,
    ...(uncontrolledExit ? { controlled: true, accountId: "fixture-account" } : {}),
    extensionResolver: async () => ({ extensions: [file] }), spawnImpl: (_node, _argv, options) => spawn(process.execPath, [file], options) });
  t.after(() => uncontrolledExit ? worker.stop().catch((error) => assert.equal(error.code, "RPC_TERMINATION_UNCONFIRMED")) : worker.stop()); return worker;
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
test("a controlled worker exit without cleanup acknowledgement cannot release ownership", async (t) => {
  const worker = await fixture(t, false, true);
  await worker.start();
  await worker.command("prompt", { message: "fixture" });
  await assert.rejects(worker.stop(), { code: "RPC_TERMINATION_UNCONFIRMED" });
  assert.equal(groupAlive(worker.identity.pid), false, "a dead worker group alone is insufficient evidence");
});
test("account switching waits for old process termination before starting a new worker", async (t) => {
  const a = await fixture(t), b = await fixture(t);
  await a.start(); const oldPid = a.identity.pid;
  await a.cancel(); assert.equal(groupAlive(oldPid), false);
  await b.start(); assert.notEqual(b.identity.pid, oldPid); assert.equal(groupAlive(oldPid), false);
  await b.cancel();
});
test("account RPC entry fails closed without stored auth despite ambient and CLI credentials", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-rpc-")));
  t.after(() => fs.rm(root, { recursive: true }));
  await fs.symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))), path.join(root, "pi"));
  const catalog = new AccountCatalog(root);
  const account = await catalog.create({ providerId: "openai", name: "Empty", authType: "api_key" });
  const sentinel = JSON.stringify({ openai: { type: "api_key", key: "cli-sentinel" } });
  await fs.writeFile(path.join(root, "auth.json"), sentinel);
  const extension = path.join(root, "never-loaded.mjs");
  const worker = new RpcWorker({ stack: { root, nodePath: process.execPath, piCliPath: "unused", stackId: `sha256:${"a".repeat(64)}` }, configRoot: root, cwd: root, model: "openai/test", accountId: account.accountId, sessionRoot: path.join(root, "sessions"), env: { PATH: process.env.PATH, OPENAI_API_KEY: "ambient-sentinel" }, extensionResolver: async () => ({ extensions: [extension] }) });
  t.after(() => worker.stop());
  const events = []; worker.on("event", (event) => events.push(event));
  await assert.rejects(worker.start());
  await worker.stop();
  assert.deepEqual(events, [{ type: "extension_error", code: "ACCOUNT_RPC_START_FAILED" }]);
  assert.equal(groupAlive(worker.child.pid), false);
  assert.equal(await fs.readFile(path.join(root, "auth.json"), "utf8"), sentinel);
});
