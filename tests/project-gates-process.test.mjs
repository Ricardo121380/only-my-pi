import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createNodeExecAdapter, projectExecutionState } from "../packages/project-gates/index.mjs";

test("a gate cancelled before admission never spawns a process", async () => {
  let spawns = 0;
  const exec = createNodeExecAdapter({ spawnImpl: () => {
    spawns++;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    return child;
  } });
  const result = await Promise.race([
    exec("unused", [], { signal: AbortSignal.abort() }),
    new Promise((resolve) => setTimeout(() => resolve("unsettled"), 100)),
  ]);
  assert.notEqual(result, "unsettled");
  assert.equal(spawns, 0);
  assert.equal(result.killed, true);
});

test("a gate ignoring SIGTERM is forcibly stopped within a bound", { timeout: 5000 }, async () => {
  const abort = new AbortController();
  const exec = createNodeExecAdapter();
  const running = exec(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); process.stdout.write('ready\\n'); setInterval(()=>{},1000)"], { signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  let timer;
  const result = await Promise.race([
    running,
    new Promise((resolve) => { timer = setTimeout(() => resolve("unsettled"), 3000); }),
  ]);
  clearTimeout(timer);
  assert.notEqual(result, "unsettled");
  assert.equal(result.killed, true);
  assert.notEqual(result.code, 0);
});

test("a gate whose descendant holds output pipes is stopped as one owned group", { timeout: 5000 }, async () => {
  const exec = createNodeExecAdapter();
  const code = "const {spawn}=require('node:child_process'); spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']}); process.exit(0)";
  let timer;
  const result = await Promise.race([
    exec(process.execPath, ["-e", code], { timeout: 2000 }),
    new Promise((resolve) => { timer = setTimeout(() => resolve("unsettled"), 3000); }),
  ]);
  clearTimeout(timer);
  assert.notEqual(result, "unsettled");
  assert.equal(result.killed, true);
  assert.equal(result.reason, "descendant-active");
  assert.equal(result.terminationUnconfirmed, undefined);
});

test("a detached-output descendant cannot survive a completed gate leader", { timeout: 5000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gate-group-"));
  const marker = path.join(root, "heartbeat");
  let descendantPid = null;
  t.after(async () => {
    if (descendantPid) { try { process.kill(descendantPid, "SIGKILL"); } catch { /* already stopped */ } }
    await fs.rm(root, { recursive: true, force: true });
  });
  const childCode = `const fs=require('node:fs'); const p=${JSON.stringify(marker)}; process.on('SIGTERM',()=>{}); fs.writeFileSync(p,'ready'); let n=0; setInterval(()=>fs.writeFileSync(p,String(++n)),20);`;
  const parentCode = `const fs=require('node:fs'); const {spawn}=require('node:child_process'); const p=${JSON.stringify(marker)}; const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}); const wait=()=>fs.existsSync(p)?(process.stdout.write(String(c.pid)),process.exit(0)):setTimeout(wait,10); wait();`;
  const result = await createNodeExecAdapter()(process.execPath, ["-e", parentCode], { timeout: 1000 });
  descendantPid = Number(result.stdout.trim());
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  assert.equal(result.killed, true);
  assert.equal(result.terminationUnconfirmed, undefined);
  const before = await fs.readFile(marker, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await fs.readFile(marker, "utf8"), before);
});

test("spawn failures and output-limit stops have explicit failed results", async () => {
  const failed = createNodeExecAdapter({ spawnImpl: () => { throw new Error("fixture spawn failed"); } });
  assert.equal((await failed("unused", [])).reason, "spawn-failed");
  const limited = createNodeExecAdapter({ maxOutputBytes: 16 });
  const result = await limited(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024)); setInterval(()=>{},1000)"], {});
  assert.equal(result.outputLimitExceeded, true);
  assert.equal(result.reason, "output-limit");
  assert.notEqual(result.code, 0);
});

test("shared process supervision preserves binary output and an explicit environment", async () => {
  const exec = createNodeExecAdapter();
  const result = await exec(process.execPath, ["-e", "process.stdout.write(Buffer.from([0,65,10])); process.stderr.write(process.env.OMP_FIXTURE_ONLY ?? '')"], { encoding: "buffer", env: { PATH: process.env.PATH ?? "", OMP_FIXTURE_ONLY: "fixture" } });
  assert.equal(result.code, 0);
  assert.equal(result.started, true);
  assert.deepEqual([...result.stdout], [0, 65, 10]);
  assert.equal(result.stderr.toString("utf8"), "fixture");
});

test("execution lifecycle projection stays occupied until confirmed exit", async () => {
  assert.deepEqual(projectExecutionState(), { active: 0, unconfirmed: false });
  const running = createNodeExecAdapter()(process.execPath, ["-e", "setTimeout(()=>{},100)"], {});
  assert.equal(projectExecutionState().active, 1);
  await running;
  assert.deepEqual(projectExecutionState(), { active: 0, unconfirmed: false });
});
