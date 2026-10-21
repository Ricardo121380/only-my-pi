import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { ProjectCatalog } from "../packages/host/catalog.mjs";
import { HostTasks } from "../packages/host/tasks.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

test("resume locks history before worker startup and refuses active or CLI-owned sessions", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-resume-lock-")));
  let tasks;
  // Settled tasks can still have a scheduled checkpoint writing to this root.
  t.after(async () => { await tasks?.stop(); await fs.rm(root, { recursive: true }); });
  const sessionRoot = path.join(root, "sessions"), project = path.join(root, "project");
  await fs.mkdir(sessionRoot); await fs.mkdir(project);
  const file = path.join(sessionRoot, "fixture.jsonl");
  await fs.writeFile(file, JSON.stringify({ type: "session", version: 3, id: "stopped-session", cwd: project }) + "\n");
  const catalog = new ProjectCatalog({ sessionRoot }); await catalog.scan();
  const p = catalog.listProjects()[0], s = catalog.listSessions(p.projectId)[0];
  const accounts = new AccountCatalog(root), account = await accounts.create({ providerId: "fixture", name: "Fixture", authType: "api_key" });
  let worker, starts = 0, onStarted;
  let ready = new Promise((resolve) => { onStarted = resolve; });
  class Worker extends EventEmitter {
    identity = null;
    async start() {
      starts++;
      await assert.rejects(acquireOwnership(root, "session", s.sessionId), { code: "OWNERSHIP_HELD" });
      return { sessionId: s.sessionId };
    }
    async command() { onStarted(); }
    async stop() {}
    async cancel() { this.emit("event", { type: "agent_settled" }); }
  }
  tasks = new HostTasks({ configRoot: root, stack: {}, accounts, catalog,
    models: async () => [{ id: "fixture/model" }], workerFactory: (options) => { assert.equal(options.resumeFile, file); worker = new Worker(); return worker; },
  });
  await tasks.load();
  const input = { projectId: p.projectId, requestId: "resume", resumeSessionKey: s.sessionKey, accountId: account.accountId, model: "fixture/model", prompt: "continue" };
  const first = await tasks.start(input); await ready;
  await assert.rejects(tasks.start({ ...input, requestId: "overlap" }), { code: "SESSION_IN_USE" });
  await assert.rejects(tasks.start({ ...input, resumeSessionKey: undefined }), { code: "REQUEST_ID_CONFLICT" });
  worker.emit("event", { type: "agent_settled" }); await Promise.all([...tasks.running.values()]);
  assert.equal(tasks.tasks.get(first.taskId).status, "succeeded");
  const cli = await acquireOwnership(root, "session", s.sessionId);
  const blocked = await tasks.start({ ...input, requestId: "cli-owned" });
  await Promise.all([...tasks.running.values()]);
  assert.equal(tasks.tasks.get(blocked.taskId).error, "OWNERSHIP_HELD");
  assert.equal(starts, 1);
  await cli.release();
  ready = new Promise((resolve) => { onStarted = resolve; });
  const next = await tasks.start({ ...input, requestId: "released" }); await ready;
  assert.equal(next.sessionId, s.sessionId);
  worker.emit("event", { type: "agent_settled" }); await Promise.all([...tasks.running.values()]);
  assert.equal(starts, 2);
});
