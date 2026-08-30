import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectM11MacosPlatform,
  installM11NoModelPayload,
  parseM11MacosNoModelArgs,
  resolveM11Q10ReleaseRoot,
  runM11MacosNoModelAcceptance,
} from "../scripts/m11-macos-no-model-acceptance.mjs";

const stackId = `sha256:${"1".repeat(64)}`;
const generationId = `sha256:${"2".repeat(64)}`;
const platformIdentity = Object.freeze({ os: "darwin", arch: "arm64", minimumMacOSSatisfied: true, rosetta: false, majorVersion: 14 });

test("Q10 payload control flow installs, verifies, removes and cleans prepared bytes", async (t) => {
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-q10-payload-")));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  let installed = true;
  let cleaned = false;
  let inspectedBundle;
  let doctorCalls = 0;
  let smokeCalls = 0;
  const layout = {
    configRoot: path.join(workspace, "config"),
    binRoot: path.join(workspace, "bin"),
    ompShim: path.join(workspace, "bin", "omp"),
    piShim: path.join(workspace, "bin", "pi"),
    npmRoot: path.join(workspace, "config", "npm"),
  };
  const source = {
    async inspect({ bundle }) { inspectedBundle = bundle; return { payloadMode: "full", stackId, stackManifest: { onlyMyPi: { artifactSha256: `sha256:${"3".repeat(64)}` } } }; },
    async prepare() { return { resolvedRoot: path.join(workspace, "resolved"), async cleanup() { cleaned = true; } }; },
  };
  let engineOptions;
  const engine = { async apply() {
    assert.deepEqual(await engineOptions.doctor(), { ok: true, status: "PASS" });
    assert.deepEqual(await engineOptions.smoke(), { ok: true, status: "NO_MODEL_STARTUP_PASS" });
    return { ok: true, status: "COMMITTED" };
  } };
  const service = {
    async status() { return installed ? { ok: true, status: "INSTALLED", stackId, generationId, externalOwnership: { owner: "user" } } : { ok: true, status: "NOT_INSTALLED" }; },
    async planLifecycle() { return { status: "STACK_REMOVE_PLAN" }; },
    async applyLifecycle() { installed = false; return { status: "REMOVED" }; },
  };
  const result = await installM11NoModelPayload({ releaseRoot: "/tmp/release", payloadMode: "full", platformIdentity, workspace }, {
    createLayout: () => layout,
    createSource: () => source,
    async extract() {},
    createHarness: () => ({ kind: "fixture" }),
    createBootstrap: () => ({ async doctor() { doctorCalls += 1; return { ok: true, status: "PASS" }; } }),
    createSmoke: () => async () => { smokeCalls += 1; return { ok: true, status: "NO_MODEL_STARTUP_PASS" }; },
    createEngine: (options) => { engineOptions = options; return engine; },
    createService: () => service,
    async loadSettings() { return { settings: { onlyMyPi: { managedSettings: {} } } }; },
    async plan() { return { mutation: true }; },
    async missing() { return true; },
  });
  assert.deepEqual(result, { payloadMode: "full", stackId, installStatus: "COMMITTED", installedStatus: "INSTALLED", removeStatus: "REMOVED", externalOwner: "user", generationId });
  assert.equal(doctorCalls, 1);
  assert.equal(smokeCalls, 1);
  assert.equal(cleaned, true);
  assert.equal(inspectedBundle, "/tmp/release/only-my-pi-0.3.0-preview.1-darwin-arm64-full.tar.gz");
});

test("Q10 orchestration requires Full and Thin identity convergence", async () => {
  const operations = {
    platform: () => platformIdentity,
    realReleaseRoot: async () => "/tmp/release",
    install: async ({ payloadMode }) => ({ payloadMode, stackId, generationId, installStatus: "COMMITTED", installedStatus: "INSTALLED", removeStatus: "REMOVED", externalOwner: "user" }),
  };
  const result = await runM11MacosNoModelAcceptance({ releaseRoot: "/tmp/release", operations });
  assert.equal(result.status, "Q10_MACOS_ARM64_NO_MODEL_PASSED");
  assert.equal(result.payloads.length, 2);
  assert.equal(result.providerRequests, 0);

  await assert.rejects(runM11MacosNoModelAcceptance({ releaseRoot: "/tmp/release", operations: { ...operations, install: async ({ payloadMode }) => ({ payloadMode, stackId, generationId: payloadMode === "full" ? generationId : `sha256:${"9".repeat(64)}` }) } }), { code: "Q10_PAYLOAD_CONVERGENCE_FAILED" });
});

test("Q10 admits only native macOS arm64, explicit run arguments and an external real RC root", async (t) => {
  assert.deepEqual(parseM11MacosNoModelArgs(["--run", "--json"]), { json: true });
  assert.throws(() => parseM11MacosNoModelArgs(["--json"]), { code: "Q10_ARGUMENT_INVALID" });
  assert.throws(() => parseM11MacosNoModelArgs(["--run", "--run"]), { code: "Q10_ARGUMENT_INVALID" });
  const platform = inspectM11MacosPlatform();
  assert.equal(platform.os, "darwin");
  assert.equal(platform.arch, "arm64");
  assert.ok(platform.majorVersion >= 14);

  const releaseRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-q10-release-root-")));
  t.after(() => fs.rm(releaseRoot, { recursive: true, force: true }));
  assert.equal(await resolveM11Q10ReleaseRoot(releaseRoot), releaseRoot);
  await assert.rejects(resolveM11Q10ReleaseRoot("relative"), { code: "Q10_RELEASE_ROOT_REQUIRED" });
  await assert.rejects(resolveM11Q10ReleaseRoot(path.join(releaseRoot, "missing")), { code: "Q10_RELEASE_ROOT_UNSAFE" });
});
