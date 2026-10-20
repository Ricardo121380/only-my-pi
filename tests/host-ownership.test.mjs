import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { acquireOwnership } from "../packages/host/ownership.mjs";

test("concurrent release callers share one ownership release", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-release-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lease = await acquireOwnership(root, "session", "shared-release");
  await Promise.all([lease.release(), lease.release(), lease.release()]);
  const next = await acquireOwnership(root, "session", "shared-release");
  await next.release();
});

test("separate CLI/GUI processes compete for canonical project and session; crash is fail-closed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-ownership-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project"); await fs.mkdir(project);
  const alias = path.join(root, "alias"); await fs.symlink(project, alias);
  const module = new URL("../packages/host/ownership.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { acquireOwnership } from ${JSON.stringify(module)}; await acquireOwnership(process.argv[1], 'project', process.argv[2]); await acquireOwnership(process.argv[1], 'session', 'shared-session'); process.stdout.write('ready'); setInterval(()=>{},1000);`, root, project], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  await once(child.stdout, "data");
  await assert.rejects(acquireOwnership(root, "project", alias), { code: "OWNERSHIP_HELD" });
  await assert.rejects(acquireOwnership(root, "session", "shared-session"), { code: "OWNERSHIP_HELD" });
  const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
  await assert.rejects(acquireOwnership(root, "project", project), { code: "OWNER_RECONCILIATION_REQUIRED" });
  // Even a reused live PID with a different identity must not be auto-reclaimed.
  const locks = path.join(root, "only-my-pi/host/locks");
  const dir = (await fs.readdir(locks)).find((entry) => entry.startsWith("project-"));
  const ownerPath = path.join(locks, dir, "owner.json");
  const owner = JSON.parse(await fs.readFile(ownerPath, "utf8"));
  await fs.writeFile(ownerPath, JSON.stringify({ ...owner, pid: process.pid, identity: "different-start" }));
  await assert.rejects(acquireOwnership(root, "project", alias), { code: "OWNER_RECONCILIATION_REQUIRED" });
});

for (const field of ["pid", "identity"]) {
  test(`a retained logical token cannot release a different physical owner: ${field}`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-release-identity-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const lease = await acquireOwnership(root, "session", "release-identity");
    const digest = createHash("sha256").update("release-identity").digest("hex");
    const file = path.join(root, "only-my-pi/host/locks", `session-${digest}`, "owner.json");
    const changed = { ...lease.owner, [field]: field === "pid" ? process.pid + 1 : "different-start-identity" };
    await fs.writeFile(file, JSON.stringify(changed));
    await assert.rejects(lease.release(), { code: "OWNERSHIP_LOST" });
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), changed);
    await fs.writeFile(file, JSON.stringify(lease.owner)); await lease.release();
  });
}

test("ordinary explicit dead-owner recovery still rotates its token", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-recovery-token-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const module = new URL("../packages/host/ownership.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { acquireOwnership } from ${JSON.stringify(module)}; const lease = await acquireOwnership(process.argv[1], 'session', 'token-rotation'); process.stdout.write(JSON.stringify(lease.owner)); setInterval(()=>{},1000);`, root], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const [data] = await once(child.stdout, "data"), previous = JSON.parse(data.toString());
  const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
  let recovered;
  const lease = await acquireOwnership(root, "session", "token-rotation", { recover: owner => { recovered = owner; } });
  assert.equal(recovered.token, previous.token); assert.notEqual(lease.owner.token, previous.token);
  assert.equal(lease.owner.pid, process.pid); await lease.release();
});
