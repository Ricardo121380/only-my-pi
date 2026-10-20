import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runFreshTarballSmoke, verifyFreshDoctor } from "../scripts/fresh-tarball-smoke.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

test("fresh tarball installs the exact locked Pi and rolls back its isolated first installation", { timeout: 300000 }, async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const evidence = await runFreshTarballSmoke({ rootDir, profileId: "minimal" });
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.formatVersion, 2);
  assert.equal(evidence.sourceCommit, execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim());
  assert.equal(evidence.piVersion, manifest.devDependencies["@earendil-works/pi-coding-agent"]);
  assert.equal(evidence.tarball.version, manifest.version);
  assert.match(evidence.tarball.sha256, /^[a-f0-9]{64}$/u);
  assert.match(evidence.tarball.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  assert.ok(evidence.tarball.files > 0);
  assert.deepEqual(evidence.install, { scripts: "disabled", offline: true, global: false,
    checkoutRuntime: false, dependencySeed: "repository-lockfile-local-tarball" });
  assert.equal(evidence.subagentsTopology.liveRuntime, "LIVE_NO_MODEL_CAPABILITY_PASS");
  assert.deepEqual(evidence.bootstrap, { profileId: "minimal", dryRun: "PLAN_READY_ZERO_WRITE", firstApply: "COMMITTED",
    secondApply: "NO_CHANGES", doctor: "PASS", safe: "PASS", rollback: "COMMITTED", finalStatus: "NOT_INSTALLED",
    piNoModelStartup: "NO_MODEL_STARTUP_PASS" });
  assert.equal(evidence.provider, "NOT_RUN_BY_POLICY");
  assert.equal(evidence.credentials, "NOT_READ");
  assert.equal(evidence.realPiHome, "NOT_TOUCHED");
});

test("fresh smoke rejects invalid profiles before accessing the source", async () => {
  await assert.rejects(runFreshTarballSmoke({ rootDir: "/missing-source", profileId: "../daily" }), { code: "FRESH_PROFILE_INVALID" });
});

test("a failed real pack reports bounded fingerprints and leaves its source untouched", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fresh-pack-failure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "fixture"], { cwd: root });
  await assert.rejects(runFreshTarballSmoke({ rootDir: root }), error => {
    assert.equal(error.code, "FRESH_COMMAND_FAILED");
    assert.notEqual(error.exitCode, 0);
    assert.match(error.stdoutDigest, /^[a-f0-9]{64}$/u);
    assert.match(error.stderrDigest, /^[a-f0-9]{64}$/u);
    for (const summary of [error.stdoutSummary, error.stderrSummary]) {
      assert.ok(summary.length <= 400);
      assert.equal(summary.includes(root), false);
    }
    return true;
  });
  assert.deepEqual(await fs.readdir(root), [".git"]);
});

function doctor(profileId) {
  return {
    ok: profileId !== "daily",
    status: profileId === "daily" ? "FAIL" : "PASS",
    repository: { ok: true },
    runtime: { status: "INSTALLED", incompleteTransactions: [] },
    generation: { status: "VERIFIED", alignment: "MATCH", errorCode: null },
    ...(profileId === "daily" ? {
      code: "OMP_CONTROLLED_STACK_UNAVAILABLE",
      directAgent: { ok: false, status: "DIRECT_AGENT_UPDATE_REQUIRED", code: "OMP_CONTROLLED_STACK_UNAVAILABLE" },
    } : {}),
  };
}

test("fresh Harness smoke verifies minimal readiness and the daily missing-stack guard", () => {
  assert.equal(verifyFreshDoctor(doctor("minimal"), "minimal"), "PASS");
  assert.equal(verifyFreshDoctor(doctor("daily"), "daily"), "CONTROLLED_STACK_REQUIRED");
  assert.throws(() => verifyFreshDoctor(doctor("minimal"), "daily"), { code: "FRESH_DOCTOR_FAILED" });
  assert.throws(() => verifyFreshDoctor(doctor("daily"), "minimal"), { code: "FRESH_DOCTOR_FAILED" });
});

test("an expected missing stack never hides repository, generation or transaction failure", () => {
  for (const mutate of [
    (value) => { value.repository.ok = false; },
    (value) => { value.generation.alignment = "UPDATE_AVAILABLE"; },
    (value) => { value.generation.errorCode = "GENERATION_DRIFT"; },
    (value) => { value.runtime.incompleteTransactions.push({ status: "INTERRUPTED" }); },
    (value) => { value.directAgent.code = "WRITER_UPDATE_REQUIRED"; },
  ]) {
    const value = doctor("daily");
    mutate(value);
    assert.throws(() => verifyFreshDoctor(value, "daily"), { code: "FRESH_DOCTOR_FAILED" });
  }
});
