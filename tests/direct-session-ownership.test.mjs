import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DirectSessionOwnership } from "../packages/direct-agent/ownership.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

test("TUI and Host share canonical project/session locks; uncertain cleanup retains them", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-shared-owner-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const project = path.join(root, "project"), other = path.join(root, "other"), alias = path.join(root, "alias");
  await fs.mkdir(project); await fs.mkdir(other); await fs.symlink(project, alias);
  let active = 1;
  const cli = new DirectSessionOwnership(root, { executionState: () => ({ active, unconfirmed: active > 0 }) });
  await cli.acquire("session", "fixture-session");
  await Promise.all([cli.acquire("project", project), cli.acquire("project", alias)]);
  await assert.rejects(acquireOwnership(root, "project", project), { code: "OWNERSHIP_HELD" });
  await assert.rejects(acquireOwnership(root, "session", "fixture-session"), { code: "OWNERSHIP_HELD" });
  const parallel = await acquireOwnership(root, "project", other); await parallel.release();
  await assert.rejects(cli.close(), { code: "OWNER_TERMINATION_UNCONFIRMED" });
  await assert.rejects(acquireOwnership(root, "project", alias), { code: "OWNERSHIP_HELD" });
  active = 0; await cli.close();
  const released = await acquireOwnership(root, "project", project); await released.release();
  const session = await acquireOwnership(root, "session", "fixture-session"); await session.release();
});
