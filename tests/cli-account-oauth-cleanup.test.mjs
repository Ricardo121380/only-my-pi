import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { saveRegressionEvidence } from "./fixtures/regression-evidence.mjs";

for (const phase of ["add", "login"]) test(`a real OAuth CLI ${phase} launch failure closes the fixture service and removes its stopped root`, { timeout: 15000 }, async t => {
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-oauth-cleanup-")), file = path.join(probeRoot, "probe.json");
  let probe;
  t.after(async () => {
    if (probe?.root) await fs.rm(probe.root, { recursive: true, force: true });
    await fs.rm(probeRoot, { recursive: true, force: true });
  });
  const env = { ...process.env, OMP_OAUTH_START_FAILURE_PROBE: file, OMP_OAUTH_START_FAILURE_PHASE: phase };
  delete env.NODE_TEST_CONTEXT; // The nested command is an independent test runner.
  const result = await promisify(execFile)(process.execPath, ["--test", "--experimental-test-isolation=none", "--import",
    fileURLToPath(new URL("./fixtures/account-oauth-start-failure.mjs", import.meta.url)),
    fileURLToPath(new URL("./cli-account-oauth.test.mjs", import.meta.url))], {
    env, timeout: 10000, maxBuffer: 1048576,
  }).then(() => assert.fail("the launch error must remain a failure"), error => error);
  probe = JSON.parse(await fs.readFile(file, "utf8"));
  const rootExists = await fs.stat(probe.root).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
  await saveRegressionEvidence("oauth-start-failure", { probe, code: result.code, signal: result.signal, killed: result.killed, rootExists, stdout: result.stdout, stderr: result.stderr });
  assert.equal(probe.injected, true);
  assert.match(result.stdout + result.stderr, /ENOENT/u);
  assert.equal(result.killed, false, "the failed fixture must exit without the outer deadline killing it");
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(rootExists, false);
  await assert.rejects(fetch(probe.origin));
});
