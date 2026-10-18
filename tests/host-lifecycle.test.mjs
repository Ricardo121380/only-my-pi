import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fork } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { hostEndpoint, hostControl } from "../packages/host/cli.mjs";
import { classifyOmpInvocation } from "../packages/direct-agent/launcher.mjs";
import { runOmpEntrypoint } from "../bin/omp.mjs";

test("web routing is explicit and double dash preserves the ordinary task text", async () => {
  assert.equal(classifyOmpInvocation(["web", "status"]).kind, "web");
  assert.deepEqual(classifyOmpInvocation(["--", "web"]).argv, ["web"]);
  assert.equal(classifyOmpInvocation(["--", "web"]).kind, "agent");
  let handled = false;
  assert.equal(await runOmpEntrypoint({ argv: ["web", "status"], stdout: { write() {} }, webCommand: async ({ argv }) => { handled = true; assert.deepEqual(argv, ["status"]); return { ok: true, status: "HOST_NOT_RUNNING" }; } }), 0);
  assert.equal(handled, true);
});
test("a crashed Host restarts with interrupted tasks, invalid cookies, and no replay", { timeout: 15000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-host-lifecycle-")));
  const config = path.join(root, "config"), assets = path.join(root, "assets"), project = path.join(root, "project");
  await fs.mkdir(assets); await fs.mkdir(project); await fs.writeFile(path.join(assets, "index.html"), "fixture");
  await fs.mkdir(path.join(root, "pi"));
  await fs.writeFile(path.join(root, "pi/package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.1" }));
  const worker = path.join(root, "rpc.mjs");
  await fs.writeFile(worker, `import {createInterface} from "node:readline";for await(const line of createInterface({input:process.stdin})){const r=JSON.parse(line);process.stdout.write(JSON.stringify({type:"response",id:r.id,command:r.type,success:true,data:{sessionId:"persisted-session"}})+"\\n");}`);
  const file = path.join(root, "host.mjs");
  await fs.writeFile(file, `import {startHost} from ${JSON.stringify(new URL("../packages/host/server.mjs", import.meta.url).href)};
import {RpcWorker} from ${JSON.stringify(new URL("../packages/host/rpc-worker.mjs", import.meta.url).href)};
import {spawn} from "node:child_process";
try { const host=await startHost({configRoot:${JSON.stringify(config)},assetsRoot:${JSON.stringify(assets)},stack:{root:${JSON.stringify(root)},stackId:"sha256:${"a".repeat(64)}",nodePath:process.execPath,piCliPath:${JSON.stringify(worker)}},modelsProvider:async()=>[{id:"mock/test",name:"Mock",provider:"mock"}],workerFactory:(options)=>new RpcWorker({...options,extensionResolver:async()=>({extensions:[${JSON.stringify(worker)}]}),spawnImpl:(_node,_args,opts)=>spawn(process.execPath,[${JSON.stringify(worker)}],opts)})});process.send({ready:true});process.on("SIGTERM",()=>host.stop().then(()=>process.exit(0),()=>process.exit(1))); }catch(e){process.send({code:e.code});process.exitCode=1;}process.disconnect();`);
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await fs.rm(root, { recursive: true, force: true });
  });
  async function start() { const child = fork(file, [], { stdio: ["ignore", "ignore", "inherit", "ipc"] }); children.push(child); const [message] = await once(child, "message"); return { child, message }; }
  const first = await start(); assert.equal(first.message.ready, true);
  const endpoint = await hostEndpoint(config); const paired = await hostControl(endpoint, "pair", "POST");
  const pair = await fetch(endpoint.origin + "/pair", { method: "POST", headers: { Origin: endpoint.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(paired.url).hash.slice(6) }) });
  const cookie = pair.headers.get("set-cookie").split(";")[0];
  const request = (body) => fetch(endpoint.origin + "/api/command", { method: "POST", headers: { Origin: endpoint.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2" }, body: JSON.stringify(body) }).then((r) => r.json());
  const p = await request({ type: "addProject", path: project });
  const task = await request({ type: "startTask", projectId: p.projectId, accountId: "cli-readonly", requestId: "never-replay", model: "mock/test", prompt: "read only" });
  for (let n = 0; n < 100; n++) {
    const state = JSON.parse(await fs.readFile(path.join(config, "only-my-pi/host/tasks.json"), "utf8"));
    if (state.tasks[0]?.worker && state.tasks[0]?.sessionId) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  first.child.kill("SIGKILL"); await once(first.child, "exit");
  const second = await start(); assert.equal(second.message.ready, true);
  const next = await hostEndpoint(config); assert.notEqual(next.epoch, endpoint.epoch);
  const state = await hostControl(next, "status"); assert.equal(state.tasks.find((x) => x.taskId === task.taskId).status, "interrupted");
  assert.equal((await fetch(next.origin + "/api/state", { headers: { Cookie: cookie } })).status, 401);
  const competing = await start(); assert.equal(competing.message.code, "OWNERSHIP_HELD");
  await hostControl(next, "stop", "POST"); await once(second.child, "exit");
});
