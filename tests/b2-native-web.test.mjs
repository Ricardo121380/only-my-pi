import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startDevWeb } from "../scripts/dev-web.mjs";

async function until(read, accept, label) {
  for (let i = 0; i < 400; i++) {
    const value = await read();
    if (accept(value)) return value;
    await delay(25);
  }
  assert.fail(`Not reached: ${label}`);
}

test("WebUI assets use the native Host; real Pi reads, approves writes and stops its stream", { timeout: 60000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-b2-core-"));
  const app = await startDevWeb({ frontend: "b2", dataDir, demo: true, watch: false, port: 0 });
  t.after(() => app.stop());
  const origin = app.host.origin;
  const html = await (await fetch(origin)).text();
  assert.match(html, /<title>Only My Pi<\/title>/);
  const script = html.match(/src="([^"]+\.js)"/)[1];
  const bundle = await (await fetch(origin + script)).text();
  assert.match(bundle, /WebUI 会话/);
  assert.doesNotMatch(bundle, /startMockRun|tickMockRun/);
  const dependencies = JSON.parse(await fs.readFile(path.join(dataDir, "assets/dependencies.json"), "utf8"));
  const supplement = dependencies.find(p => p.name === "react-remove-scroll-bar");
  assert.equal(supplement.version, "2.3.8");
  assert.match(supplement.noticeSource, /8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/);
  assert.match(await fs.readFile(path.join(dataDir, "assets/THIRD_PARTY_NOTICES.txt"), "utf8"), /Copyright \(c\) 2025 Anton Korzunov/);

  const paired = await fetch(origin + "/pair", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(app.host.pairingUrl).hash.slice(6) }) });
  assert.equal(paired.status, 200);
  const headers = { origin, cookie: paired.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-host-protocol": "2" };
  const get = async route => { const response = await fetch(origin + route, { headers }); assert.equal(response.status, 200); return response.json(); };
  const command = async body => {
    const response = await fetch(origin + "/api/command", { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, ["startTask", "cancelTask"].includes(body.type) ? 202 : 200); return response.json();
  };
  const project = await command({ type: "addProject", path: app.project });
  const start = (prompt, more = {}) => command({ type: "startTask", requestId: randomUUID(), projectId: project.projectId, accountId: "cli-readonly", model: "fixture/one", prompt, ...more });
  const task = id => get(`/api/task?taskId=${id}`);
  const settled = id => until(() => task(id), t => ["succeeded", "failed", "cancelled"].includes(t.status), "task terminal");
  const read = await start("read project");
  await until(() => task(read.taskId), t => !!t.partial, "native streaming reply");
  assert.equal((await settled(read.taskId)).status, "succeeded");
  const session = (await get(`/api/sessions?projectId=${project.projectId}`)).sessions[0];
  assert.match(JSON.stringify(await get(`/api/history?sessionKey=${session.sessionKey}`)), /minimal-web-evidence/);

  const write = await start("request write", { mode: "controlled", resumeSessionKey: session.sessionKey });
  const awaiting = await until(() => task(write.taskId), t => t.approvals?.length, "native coding approval");
  assert.equal(awaiting.access, "inspect");
  await assert.rejects(fs.access(path.join(app.project, "approved.txt")), { code: "ENOENT" });
  const approval = awaiting.approvals[0];
  await command({ type: "answerApproval", taskId: write.taskId, approvalId: approval.approvalId, value: approval.options[0] });
  assert.equal((await settled(write.taskId)).status, "succeeded");
  assert.equal(await fs.readFile(path.join(app.project, "approved.txt"), "utf8"), "approved local write\n");

  const stop = await start("stop stream", { resumeSessionKey: session.sessionKey });
  await until(() => task(stop.taskId), t => !!t.partial, "stoppable native stream");
  await command({ type: "cancelTask", taskId: stop.taskId });
  assert.equal((await settled(stop.taskId)).status, "cancelled");
  assert.equal(app.host.tasks.workers.size, 0);
  assert.equal(app.provider.received.at(-1).closed, true);
  await app.stop();
  assert.equal(app.host.tasks.workers.size, 0);
});
