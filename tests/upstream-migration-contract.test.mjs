import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createUpstreamMigrationService,
  createMigrationManifest,
  inspectMigrationBundle,
  M10_ARTIFACT_NAMES,
  M10_EXACT_PACKAGE_TARGET,
  validateMigrationManifest,
} from "../packages/upstream-migration/index.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (character) => `sha256:${character.repeat(64)}`;
const digest = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

function manifest(artifactDigests = Object.fromEntries(M10_ARTIFACT_NAMES.map((name, index) => [name, hash(String(index + 1))]))) {
  return createMigrationManifest({
    formatVersion: 1,
    kind: "only-my-pi-upstream-migration",
    id: "m10-pi-0-84-3",
    sourceCommit: "a".repeat(40),
    candidateGraphDigest: hash("a"),
    onlyMyPiArtifact: { sha256: artifactDigests["only-my-pi.tgz"] },
    piArtifact: {
      name: "@earendil-works/pi-coding-agent",
      version: "0.84.3",
      integrity: "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==",
      sha256: artifactDigests["pi-candidate.tgz"],
      treeDigest: hash("b"),
    },
    from: { piVersion: "0.84.1", subagentsVersion: "0.45.2" },
    to: { piVersion: "0.84.3", subagentsVersion: "0.57.0" },
    externalPackages: M10_EXACT_PACKAGE_TARGET.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      fromVersion: entry.fromVersion,
      toVersion: entry.toVersion,
      sourceSpec: `npm:${entry.name}@${entry.toVersion}`,
      fromIntegrity: entry.fromIntegrity,
      toIntegrity: entry.toIntegrity,
      fromResolvedUrlDigest: hash(index % 10 === 0 ? "a" : String(index)),
      toResolvedUrlDigest: hash(index % 10 === 0 ? "b" : String(index)),
      fromTreeDigest: hash(index % 10 === 0 ? "c" : String(index)),
      toTreeDigest: hash(index % 10 === 0 ? "d" : String(index)),
      binding: "external",
      owner: "user",
      action: entry.action,
      lifecycleScripts: entry.lifecycleScripts,
    })),
    artifacts: artifactDigests,
    policy: {
      ignoreScripts: true,
      allowLifecycleScripts: false,
      requirePiStopped: true,
      preserveExternalOwnership: true,
      networkDuringApply: false,
    },
  });
}

async function bundleFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-migration-bundle-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const artifacts = M10_ARTIFACT_NAMES.map((name) => {
    const bytes = Buffer.from(`fixture:${name}\n`);
    return { name, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") };
  });
  const artifactDigests = Object.fromEntries(artifacts.map((entry) => [entry.name, entry.sha256]));
  const bundle = { formatVersion: 1, kind: "only-my-pi-upstream-migration-bundle", manifest: manifest(artifactDigests), artifacts };
  const target = path.join(directory, "migration.bundle.json");
  await fs.writeFile(target, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
  return { target, bundle };
}

test("migration manifest accepts only the exact M9 candidate and nine external packages", async () => {
  const checked = await validateMigrationManifest(manifest(), { rootDir });
  assert.equal(checked.externalPackages.length, 9);
  assert.equal(checked.externalPackages.filter((entry) => entry.action === "upgrade").length, 6);
  assert.equal(checked.externalPackages.filter((entry) => entry.action === "retain").length, 3);
  for (const id of ["lsp", "plan-mode"]) {
    assert.deepEqual(checked.externalPackages.find((entry) => entry.id === id).lifecycleScripts, [{
      name: "prepack",
      commandSha256: "sha256:16c0e4305ac213dff39fc82b69b6e08aeeb8758e33cd72d7c409752a70e9f054",
      necessity: "not-required",
    }]);
  }
  const drift = structuredClone(checked);
  drift.externalPackages[0].toVersion = "9.9.9";
  drift.manifestDigest = createMigrationManifest(drift).manifestDigest;
  await assert.rejects(validateMigrationManifest(drift, { rootDir }), { code: "MIGRATION_PACKAGE_DRIFT" });
});

test("migration bundle inspection is a zero-write zero-subprocess digest check", async (t) => {
  const value = await bundleFixture(t);
  const before = (await fs.stat(value.target)).mtimeMs;
  const result = await inspectMigrationBundle({ bundlePath: value.target, rootDir });
  assert.equal(result.status, "MIGRATION_BUNDLE_VERIFIED");
  assert.deepEqual(result.zeroWriteEvidence, { writes: 0, subprocesses: 0, providerRequests: 0 });
  assert.equal(result.artifacts.length, 5);
  assert.equal((await fs.stat(value.target)).mtimeMs, before);
});

test("migration bundle rejects artifact, manifest and envelope authority drift", async (t) => {
  const value = await bundleFixture(t);
  const artifactDrift = structuredClone(value.bundle);
  artifactDrift.artifacts[0].base64 = Buffer.from("different").toString("base64");
  await fs.writeFile(value.target, JSON.stringify(artifactDrift));
  await assert.rejects(inspectMigrationBundle({ bundlePath: value.target, rootDir }), { code: "MIGRATION_BUNDLE_ARTIFACT_DRIFT" });

  const extraAuthority = structuredClone(value.bundle);
  extraAuthority.command = "touch /tmp/forbidden";
  await fs.writeFile(value.target, JSON.stringify(extraAuthority));
  await assert.rejects(inspectMigrationBundle({ bundlePath: value.target, rootDir }), { code: "MIGRATION_BUNDLE_INVALID" });
});

test("upstream service binds apply to the exact reviewed immutable plan", async (t) => {
  const value = await bundleFixture(t);
  const calls = [];
  const service = createUpstreamMigrationService({
    rootDir,
    configRoot: "/tmp/omp-config",
    engine: {
      apply: async (request) => { calls.push(request); return { ok: true, status: "COMMITTED" }; },
      status: async ({ transactionId }) => ({ ok: true, status: "TRANSACTION_STATUS", transactionId }),
      rollback: async ({ transactionId }) => ({ ok: true, status: "ROLLED_BACK", transactionId }),
    },
  });
  const plan = await service.plan({ bundle: value.target });
  assert.equal(plan.status, "UPSTREAM_MIGRATION_PLAN");
  assert.equal(plan.mutation, false);
  assert.deepEqual(plan.zeroWriteEvidence, { writes: 0, subprocesses: 0, providerRequests: 0 });
  assert.equal(plan.packages.length, 9);

  const applied = await service.apply({ bundle: value.target, plan, yes: true });
  assert.equal(applied.status, "COMMITTED");
  assert.equal(calls.length, 1);
  assert.equal((await service.status("tx-1")).transactionId, "tx-1");
  assert.equal((await service.rollback({ transactionId: "tx-1", yes: true })).status, "ROLLED_BACK");

  const tampered = { ...plan, sourceCommit: "b".repeat(40) };
  await assert.rejects(service.apply({ bundle: value.target, plan: tampered, yes: true }), { code: "MIGRATION_PLAN_INVALID" });
});

test("manifest rejects runtime, Pi artifact, package set, policy and digest drift independently", async () => {
  const cases = [
    ["MIGRATION_RUNTIME_DRIFT", (value) => { value.to.piVersion = "0.84.4"; }],
    ["MIGRATION_PI_ARTIFACT_DRIFT", (value) => { value.piArtifact.version = "0.84.4"; }],
    ["MIGRATION_BUNDLE_ARTIFACT_DRIFT", (value) => { value.piArtifact.sha256 = hash("e"); }],
    ["MIGRATION_PACKAGE_SET_DRIFT", (value) => { value.externalPackages.reverse(); }],
    ["MIGRATION_SCHEMA_INVALID", (value) => { value.externalPackages[0].owner = "only-my-pi"; }],
    ["MIGRATION_SCHEMA_INVALID", (value) => { value.policy.networkDuringApply = true; }],
  ];
  for (const [code, mutate] of cases) {
    const value = manifest();
    mutate(value);
    value.manifestDigest = createMigrationManifest(value).manifestDigest;
    await assert.rejects(validateMigrationManifest(value, { rootDir }), { code });
  }
  const badDigest = manifest();
  badDigest.manifestDigest = hash("f");
  await assert.rejects(validateMigrationManifest(badDigest, { rootDir }), { code: "MIGRATION_MANIFEST_DIGEST_DRIFT" });
});

test("upstream service fails closed when the transaction engine is absent", async (t) => {
  const value = await bundleFixture(t);
  const service = createUpstreamMigrationService({ rootDir, configRoot: "/tmp/omp-config" });
  const plan = await service.plan({ bundle: value.target });
  await assert.rejects(service.apply({ bundle: value.target, plan }), { code: "UPSTREAM_TRANSACTION_ENGINE_UNAVAILABLE" });
  await assert.rejects(service.rollback({ transactionId: "tx-1" }), { code: "UPSTREAM_TRANSACTION_ENGINE_UNAVAILABLE" });
  assert.equal((await service.status()).status, "UPSTREAM_TRANSACTION_ENGINE_UNAVAILABLE");
  assert.deepEqual(await service.recoverPending(), []);
});

test("upstream service invokes every optional authority and detects post-plan bundle replacement", async (t) => {
  assert.throws(() => createUpstreamMigrationService({ rootDir: "relative", configRoot: "/tmp/omp-config" }), TypeError);
  assert.throws(() => createUpstreamMigrationService({ rootDir, configRoot: "relative" }), TypeError);
  const first = await bundleFixture(t);
  const second = await bundleFixture(t);
  await fs.appendFile(second.target, "\n");
  const calls = [];
  const service = createUpstreamMigrationService({
    rootDir,
    configRoot: "/tmp/omp-config",
    planner: { inspect: async () => { calls.push("planner"); return { status: "PREFLIGHT" }; } },
    candidateTarget: { inspect: async () => { calls.push("candidate"); return { graphDigest: hash("a") }; } },
    processAdmission: { plan: async () => { calls.push("processes"); return [{ pid: 1 }]; } },
    engine: {
      apply: async () => ({ status: "COMMITTED" }),
      status: async () => ({ status: "STATUS" }),
      rollback: async () => ({ status: "ROLLED_BACK" }),
      recoverPending: async () => [{ status: "ROLLED_BACK" }],
    },
  });
  const plan = await service.plan({ bundle: first.target });
  assert.deepEqual(calls.sort(), ["candidate", "planner", "processes"]);
  assert.equal(plan.piProcesses.length, 1);
  assert.equal((await service.status()).status, "STATUS");
  assert.equal((await service.recoverPending())[0].status, "ROLLED_BACK");
  await assert.rejects(service.apply({ bundle: second.target, plan }), { code: "MIGRATION_BUNDLE_CHANGED_AFTER_PLAN" });
});
