import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { ProductSettings } from "../packages/product-settings/catalog.mjs";
import { createProductSessionServices } from "../packages/product-settings/runtime.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-product-services-")));
  const store = new ProductSettings(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store };
}

// Fault injection at the public SDK boundary; real ProductSettings persistence.
const healthyServices = () => ({ diagnostics: [], resourceLoader: { getExtensions: () => ({ errors: [] }) } });
const failures = {
  rejection: async () => { throw new Error("private SDK failure details"); },
  diagnostics: async () => ({ ...healthyServices(), diagnostics: [{ type: "error", message: "invalid provider registration" }] }),
  extension: async () => ({ diagnostics: [], resourceLoader: { getExtensions: () => ({ errors: [{ error: "invalid extension" }] }) } }),
};

for (const taskId of [undefined, "host-task"]) for (const [failure, createAgentSessionServices] of Object.entries(failures)) {
  test(`${failure} preserves the successful load and records ${taskId ?? "Direct"} failure identity`, async t => {
    const { root, store } = await fixture(t);
    const prior = { ...await store.snapshot(root), resourceRevision: 0 };
    const loaded = await store.recordLoad(prior, null, "previous-success");
    const snapshot = { ...prior, revision: 1, resourceRevision: 27 };
    await assert.rejects(createProductSessionServices({ sdk: { createAgentSessionServices }, configRoot: root, snapshot, taskId }),
      { code: "RESOURCE_LOAD_FAILED", status: 409, message: "RESOURCE_LOAD_FAILED" });
    const status = await store.status(root);
    assert.deepEqual(status.lastLoaded, loaded.lastLoaded);
    assert.equal(status.lastFailure.code, "RESOURCE_LOAD_FAILED");
    assert.equal(status.lastFailure.taskId, taskId ?? null);
    assert.equal(status.lastFailure.revision, snapshot.revision);
    assert.equal(status.lastFailure.resourceRevision, snapshot.resourceRevision);
    assert.equal(status.pending, true);
  });
}

test("generic services retain caller resources and normalize failures without product receipts", async t => {
  const { root } = await fixture(t), services = healthyServices();
  const resourceLoaderOptions = { noSkills: false, skillsOverride: () => "caller-owned" };
  const result = await createProductSessionServices({ configRoot: root, resourceLoaderOptions, sdk: {
    async createAgentSessionServices(options) {
      assert.deepEqual(options.resourceLoaderOptions, resourceLoaderOptions);
      return services;
    },
  } });
  assert.equal(result, services);
  for (const createAgentSessionServices of Object.values(failures)) {
    await assert.rejects(createProductSessionServices({ configRoot: root, sdk: { createAgentSessionServices } }), { code: "RESOURCE_LOAD_FAILED", status: 409 });
  }
  await assert.rejects(fs.stat(path.join(root, "only-my-pi/product-settings")), { code: "ENOENT" });
});

test("product services retain Pi options and load dynamic or fixed skills without confirming a session", async t => {
  const { root, store } = await fixture(t), services = healthyServices();
  services.diagnostics.push({ type: "warning", message: "non-fatal service diagnostic" });
  const initial = await store.snapshot(root);
  let current = initial, loader;
  const eventBus = {}, extensionFactories = [() => {}, () => {}], modelRuntime = {}, settingsManager = {};
  const flags = new Map([["perm", "build"]]), signal = new AbortController().signal;
  const sdk = { loadSkills, async createAgentSessionServices(options) {
    assert.equal(options.modelRuntime, modelRuntime); assert.equal(options.settingsManager, settingsManager);
    assert.equal(options.extensionFlagValues, flags); assert.equal(options.modelRuntimeSignal, signal);
    loader = options.resourceLoaderOptions;
    assert.equal(loader.eventBus, eventBus); assert.equal(loader.extensionFactories, extensionFactories);
    assert.equal(loader.noExtensions, true); assert.deepEqual(loader.additionalExtensionPaths, ["/selected/extension.ts"]);
    assert.equal(loader.noSkills, true);
    return services;
  } };
  const options = { sdk, configRoot: root, snapshot: initial, cwd: root, agentDir: root, modelRuntime, settingsManager,
    modelRuntimeSignal: signal, extensionFlagValues: flags,
    resourceLoaderOptions: { eventBus, extensionFactories, noExtensions: true, additionalExtensionPaths: ["/selected/extension.ts"] } };
  assert.equal(await createProductSessionServices({ ...options, getSnapshot: () => current }), services);
  const dynamicLoader = loader;
  assert.deepEqual(dynamicLoader.skillsOverride().skills, []);
  const source = { kind: "local-skill", origin: "fixture:later-skill", content: "---\nname: later-skill\ndescription: Dynamic skill fixture\ncompatibility: pi-1.3.0\n---\nLater skill body.\n" };
  const preview = await store.preview(source, root);
  await store.action({ type: "import", source, digest: preview.digest, revision: 0 }, root);
  await store.action({ type: "set", id: "skill:later-skill", enabled: true, revision: 1 }, root);
  current = await store.snapshot(root);
  const skills = dynamicLoader.skillsOverride();
  assert.deepEqual(skills.diagnostics, []);
  assert.deepEqual(skills.skills.map(skill => skill.name), ["later-skill"]);
  assert.equal(await createProductSessionServices(options), services);
  assert.deepEqual(loader.skillsOverride().skills, [], "Host-style fixed snapshots do not follow later settings");
  await assert.rejects(fs.stat(path.join(root, "only-my-pi/product-settings/loads")), { code: "ENOENT" });
});
