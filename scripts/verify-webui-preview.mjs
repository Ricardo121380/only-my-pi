import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { hashFile } from "../packages/release-stack/deterministic-archive.mjs";
import { startMinimalModel } from "../tests/fixtures/minimal-model.mjs";

async function until(read, accept, label, attempts = 1200) {
  for (let i = 0; i < attempts; i++) { const value = await read(); if (accept(value)) return value; await delay(25); }
  throw new Error(`Not reached: ${label}`);
}

export async function verifyWebPreviewArchive(candidate, output) {
  if (!path.isAbsolute(candidate) || !path.isAbsolute(output)) throw new Error("Use absolute candidate and fresh proof directories");
  const receipt = JSON.parse(await fs.readFile(path.join(candidate, "build-receipt.json"), "utf8")), archive = path.join(candidate, receipt.archive);
  assert.equal((await hashFile(archive)).slice(7), receipt.sha256);
  await fs.mkdir(output); const extracted = path.join(output, "extracted"); await fs.mkdir(extracted);
  execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", extracted]);
  const payload = path.join(extracted, "only-my-pi-webui"), app = path.join(payload, "app"), node = path.join(payload, "node/bin/node"), entry = path.join(app, "scripts/webui-preview.mjs");
  await assert.rejects(fs.access(path.join(app, ".git")), { code: "ENOENT" });
  const home = path.join(output, "home"), dataDir = path.join(output, "data"), project = path.join(output, "project"), fakeBin = path.join(output, "fake-bin"), fallback = path.join(output, "fallback-node-used");
  for (const d of [home, project, fakeBin]) await fs.mkdir(d);
  await fs.writeFile(path.join(fakeBin, "node"), '#!/bin/sh\nprintf used > "'+fallback+'"\nexit 91\n', { mode: 0o755 });
  const env = { HOME: home, PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: process.env.TMPDIR ?? "/tmp", LANG: "en_US.UTF-8", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" };
  const check = JSON.parse(execFileSync(node, [entry, "--check"], { cwd: app, env, encoding: "utf8" }));
  assert.equal(check.verified, true); assert.equal(check.sourceCommit, receipt.sourceCommit); assert.equal(check.pi, "1.5.0");
  const { AccountCatalog } = await import(pathToFileURL(path.join(app, "packages/accounts/catalog.mjs")));
  const { groupAlive } = await import(pathToFileURL(path.join(app, "packages/process-runtime/ownership.mjs")));
  const model = await startMinimalModel({ streamDelay: 10 });
  const marker = `webui-archive-${randomUUID()}`; await fs.writeFile(path.join(project, "README.md"), `# Preview fixture\n${marker}\n`);
  const launches = [];
  async function launch(port = 0) {
    const child = spawn(node, [entry, "--data-dir", dataDir, "--port", String(port)], { cwd: app, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", exitCode;
    child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
    const exited = new Promise(resolve => child.once("exit", code => { exitCode = code; resolve(code); }));
    const stop = async () => {
      if (exitCode === undefined) child.kill("SIGTERM");
      assert.equal(await Promise.race([exited, delay(15000, undefined, { ref: false }).then(() => { throw new Error("Preview failed to stop gracefully"); })]), 0);
      assert.match(stdout, /"stopped":true,"workers":0,"dataRetained":true/);
    };
    const launchState = { child, stop, get exitCode() { return exitCode; } }; launches.push(launchState);
    const line = await until(() => { if (exitCode !== undefined) throw new Error(`Preview startup exited ${exitCode}: ${stderr.slice(-1500)}`); return stdout.split("\n").find(line => line.startsWith('{"preview":')); }, Boolean, "unpacked preview ready");
    return { ...JSON.parse(line), ...launchState };
  }
  async function client(host) {
    const origin = host.origin, paired = await fetch(origin + "/pair", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
    assert.equal(paired.status, 200);
    const headers = { origin, cookie: paired.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-host-protocol": "2" };
    const get = async route => { const res = await fetch(origin + route, { headers }); assert.equal(res.status, 200); return res.json(); };
    const command = async body => { const res = await fetch(origin + "/api/command", { method: "POST", headers, body: JSON.stringify(body) }); assert.ok(res.ok, `Host command failed ${res.status}: ${JSON.stringify(await res.clone().json())}`); return res.json(); };
    const task = id => get(`/api/task?taskId=${id}`), settled = id => until(() => task(id), t => ["succeeded", "failed", "cancelled"].includes(t.status), "task terminal");
    return { origin, headers, get, command, task, settled };
  }
  try {
    const first = await launch(), a = await client(first);
    assert.deepEqual((await a.get("/api/models?accountId=cli-readonly")).models, []);
    const accounts = new AccountCatalog(first.configRoot), account = await accounts.create({ providerId: "preview-fixture", name: "Local controlled DeepSeek protocol", authType: "api_key" });
    await accounts.configure(account.accountId, { baseUrl: model.baseUrl, api: "openai-completions", models: [{ id: "deepseek-v4.1-flash", name: "DeepSeek local controlled", contextWindow: 32000, maxTokens: 1024 }] });
    const credential = "preview-local-fixture", paths = await accounts.runtimePaths(account.accountId);
    await fs.writeFile(paths.authPath, JSON.stringify({ "preview-fixture": { type: "api_key", key: credential } }));
    const selectedModel = "preview-fixture/deepseek-v4.1-flash";
    const selected = await a.command({ type: "addProject", path: project });
    const start = (c, prompt, more = {}) => c.command({ type: "startTask", requestId: randomUUID(), projectId: selected.projectId, accountId: account.accountId, model: selectedModel, prompt, ...more });
    const read = await a.settled((await start(a, "read project")).taskId); assert.equal(read.status, "succeeded"); assert.match(JSON.stringify(read.messages), new RegExp(marker));
    const session = await until(async () => (await a.get(`/api/sessions?projectId=${selected.projectId}`)).sessions.find(s => s.sessionId === read.sessionId), Boolean, "native history index");
    const delegated = await a.settled((await start(a, "delegate read")).taskId); assert.equal(delegated.status, "succeeded"); assert.equal(delegated.orchestration.children[0].status, "completed"); assert.match(JSON.stringify(delegated.messages), new RegExp(marker));
    const write = await start(a, "request write", { mode: "controlled" });
    const approval = await until(() => a.task(write.taskId), t => t.approvals?.length, "coding approval");
    await assert.rejects(fs.access(path.join(project, "approved.txt")), { code: "ENOENT" });
    await a.command({ type: "answerApproval", taskId: write.taskId, approvalId: approval.approvals[0].approvalId, value: approval.approvals[0].options[0] });
    assert.equal((await a.settled(write.taskId)).status, "succeeded"); assert.equal(await fs.readFile(path.join(project, "approved.txt"), "utf8"), "approved local write\n");
    const childStop = await start(a, "delegate stop");
    await until(() => model.received.at(-1), r => r?.body.tools?.some(t => t.function?.name === "structured_output") && r.body.messages.some(m => JSON.stringify(m.content).includes("child stop")), "physical child active");
    const ledger = JSON.parse(await fs.readFile(path.join(first.configRoot, "only-my-pi/host/tasks.json"), "utf8")), workerPid = ledger.tasks.find(t => t.taskId === childStop.taskId).worker.pid;
    await a.command({ type: "cancelTask", taskId: childStop.taskId });
    const cancelledChild = await a.settled(childStop.taskId); assert.equal(cancelledChild.status, "cancelled"); assert.ok(cancelledChild.orchestration.children.every(c => c.status !== "running")); assert.equal(groupAlive(workerPid), false);
    const stream = await start(a, "stop stream"); await until(() => a.task(stream.taskId), t => !!t.partial, "actual partial stream");
    await a.command({ type: "cancelTask", taskId: stream.taskId }); assert.equal((await a.settled(stream.taskId)).status, "cancelled");
    const before = await a.get(`/api/history?sessionKey=${session.sessionKey}`); await first.stop();
    const second = await launch(Number(new URL(first.origin).port));
    assert.equal((await fetch(second.origin + "/api/state", { headers: a.headers })).status, 401);
    const b = await client(second); await until(() => b.get("/api/state"), state => !state.indexing, "restart indexing");
    assert.equal((await b.get("/api/state")).tasks.length, 5);
    assert.deepEqual(await b.get(`/api/history?sessionKey=${session.sessionKey}`), before);
    const resumed = await b.settled((await start(b, "continue", { resumeSessionKey: session.sessionKey })).taskId);
    assert.equal(resumed.status, "succeeded"); assert.equal(resumed.sessionId, read.sessionId); assert.equal(resumed.access, "inspect");
    assert.equal((await b.get("/api/state")).tasks.length, 6); await second.stop();
    await assert.rejects(fs.access(fallback), { code: "ENOENT" });
    assert.ok(model.received.every(r => r.body.model === "deepseek-v4.1-flash" && r.authorization === `Bearer ${credential}`));
    const result = { kind: "only-my-pi-webui-archive-acceptance-v1", status: "PASS", sourceCommit: receipt.sourceCommit, archiveSha256: receipt.sha256, version: receipt.version, platform: receipt.platform, node: check.node, pi: check.pi,
      provider: "LOCAL_CONTROLLED", externalProvider: "NOT_RUN_IN_THIS_ARCHIVE_CHECK", tasks: { succeeded: 4, cancelled: 2 }, assertions: { noGitCheckout: true, bundledNodeAndPi: true, noInheritedAccounts: true, actualRead: true, actualReadonlyChild: true, approvalBeforeWrite: true, childProcessGroupStopped: true, streamStopped: true, restartHistoryRetained: true, explicitResumeNoPermissionInheritance: true, noReplay: true, noPathFallbackNode: true, stoppedWithoutWorkers: true } };
    await fs.writeFile(path.join(output, "acceptance.json"), JSON.stringify(result, null, 2) + "\n"); return result;
  } finally {
    for (const launch of launches) if (launch.exitCode === undefined) await launch.stop();
    await model.stop();
    const auth = path.join(dataDir, "config/only-my-pi/host/accounts");
    for (const account of await fs.readdir(auth).catch(() => [])) await fs.rm(path.join(auth, account, "auth.json"), { force: true });
  }
}

if (process.argv[1]?.endsWith("verify-webui-preview.mjs")) {
  try { console.log(JSON.stringify(await verifyWebPreviewArchive(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
