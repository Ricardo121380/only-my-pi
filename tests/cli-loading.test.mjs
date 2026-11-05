import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/cli-loaded-modules.mjs", import.meta.url));
const managementModule = file => file === "packages/control-service/production.mjs"
  || file === "packages/bootstrap/bootstrap-service.mjs"
  || file === "packages/bootstrap/transaction-engine.mjs"
  || file.startsWith("packages/upstream-migration/")
  || file === "packages/release-stack/stack-transaction.mjs";

for (const scenario of ["import", "agent-help", "admin-help", "agent", "web", "account-list", "injected-admin", "factory"]) {
  test(`CLI ${scenario} loads management assembly only when constructing production services`, async t => {
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-loading-"));
    t.after(() => fs.rm(isolated, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [fixture, scenario, isolated], {
      cwd: isolated, env: { HOME: isolated, PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    if (scenario === "factory") {
      assert.ok(observed.loaded.includes("packages/control-service/production.mjs"));
      assert.ok(observed.loaded.includes("packages/bootstrap/bootstrap-service.mjs"));
      assert.ok(observed.loaded.includes("packages/upstream-migration/transaction-engine.mjs"));
    } else assert.deepEqual(observed.loaded.filter(managementModule), []);
    assert.deepEqual(await fs.readdir(isolated), [], "routing and construction must not write to the isolated home");
  });
}
