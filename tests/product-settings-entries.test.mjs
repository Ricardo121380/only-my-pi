import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { ProductSettings, taskSettingsSnapshot } from "../packages/product-settings/catalog.mjs";
import { createMcpHost } from "./fixtures/mcp-host.mjs";

// Public CLI subprocess and authenticated HTTP, without starting an Agent task.
async function fixture(t) {
  const f = await createMcpHost();
  t.after(() => f.close());
  const cli = async argv => {
    const result = await promisify(execFile)(process.execPath, [f.cli, "settings", ...argv], { cwd: f.project, env: f.cliEnv ?? f.env });
    return JSON.parse(result.stdout);
  };
  const http = async (input, status = 200, headers = {}) => {
    const response = await fetch(f.host.origin + "/api/settings", { method: "POST", headers: { Origin: f.host.origin, Cookie: f.cookie, "content-type": "application/json", "x-omp-settings-protocol": "1", ...headers }, body: JSON.stringify(input) });
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  };
  return { ...f, cliSettings: cli, httpSettings: http };
}

test("CLI and HTTP settings preserve defaults, canonical project scopes, reset and import results", async t => {
  const f = await fixture(t), project = { projectId: f.projectId };
  const initial = await f.cliSettings(["list"]);
  assert.deepEqual(await f.httpSettings({ type: "list" }), initial);
  assert.equal(initial.projectPath, null); assert.equal(Object.hasOwn(initial, "resourceRevision"), false);
  const changed = await f.cliSettings(["set", "context-doctor", "--revision", "0", "--parameters", '{"label":"shared-default"}']);
  assert.deepEqual(await f.httpSettings({ type: "list" }), changed);
  const overridden = await f.httpSettings({ ...project, type: "set", revision: 1, id: "context-doctor", parameters: { label: "shared-project" } });
  assert.equal(overridden.projectPath, f.project); assert.equal(typeof overridden.resourceRevision, "number");
  assert.deepEqual(await f.cliSettings(["list", "--project", "."]), overridden);
  const alias = path.join(f.root, "project-alias"); await fs.symlink(f.project, alias);
  assert.deepEqual(await f.cliSettings(["list", "--project", alias]), overridden);
  const reset = await f.cliSettings(["reset", "context-doctor", "--revision", "2", "--project", f.project]);
  assert.deepEqual(await f.httpSettings({ ...project, type: "list" }), reset);
  assert.equal(reset.resources.find(resource => resource.id === "context-doctor").source, "default");
  const origin = path.join(f.root, "SKILL.md"), content = "---\nname: shared-entry\ndescription: Entry contract fixture\ncompatibility: pi-1.3.0\n---\nExplicit fixture only.\n";
  await fs.writeFile(origin, content);
  const source = { kind: "local-skill", origin, content };
  const preview = await f.cliSettings(["preview", origin, "--project", f.project]);
  assert.deepEqual(await f.httpSettings({ ...project, type: "previewImport", source }), preview);
  const imported = await f.httpSettings({ ...project, type: "import", source, revision: 3, digest: preview.digest });
  assert.deepEqual(await f.cliSettings(["list", "--project", f.project]), imported);
  assert.equal(imported.resources.find(resource => resource.id === "skill:shared-entry").enabled, false);
  assert.equal(await fs.readFile(origin, "utf8"), content);
  assert.equal(f.requests.length, 0);
});

test("both settings entries track MCP and model revisions without changing the settings revision", async t => {
  const f = await fixture(t), store = new ProductSettings(f.config);
  // Fixture receipt only; actual Pi loading is exercised by product-settings-pi.
  const snapshot = await taskSettingsSnapshot(f.config, f.project, f.omp);
  await store.recordLoad(snapshot.settingsSnapshot, null, "fixture-load");
  const initial = await f.cliSettings(["list", "--project", f.project]);
  assert.equal(initial.resourceRevision, 0); assert.equal(initial.pending, false);
  assert.deepEqual(await f.httpSettings({ type: "list", projectId: f.projectId }), initial);
  await f.mcp({ type: "save", revision: 0, server: f.server });
  const mcpChanged = await f.httpSettings({ type: "list", projectId: f.projectId });
  assert.equal(mcpChanged.revision, 0); assert.equal(mcpChanged.pending, true);
  assert.notEqual(mcpChanged.resourceRevision, initial.resourceRevision);
  assert.deepEqual(await f.cliSettings(["list", "--project", f.project]), mcpChanged);
  await f.request("/api/model-calls", { type: "save", projectId: f.projectId, revision: 0, classifier: null });
  const modelsChanged = await f.cliSettings(["list", "--project", f.project]);
  assert.equal(modelsChanged.revision, 0); assert.equal(modelsChanged.pending, true);
  assert.notEqual(modelsChanged.resourceRevision, mcpChanged.resourceRevision);
  assert.deepEqual(modelsChanged.lastLoaded, initial.lastLoaded);
  assert.deepEqual(await f.httpSettings({ type: "list", projectId: f.projectId }), modelsChanged);
  assert.equal(f.requests.length, 0);
});

test("both entries verify the selected package, preserve successful writes and skip verification for preview", async t => {
  const f = await fixture(t), store = new ProductSettings(f.config);
  const snapshot = await taskSettingsSnapshot(f.config, f.project, f.omp);
  const receipt = await store.recordLoad(snapshot.settingsSnapshot, null, "fixture-load");
  const file = path.join(f.omp, "extensions/context-doctor/metrics.mjs");
  await fs.rename(file, file + ".saved"); await fs.symlink(file + ".saved", file);
  const first = await f.cliSettings(["set", "context-doctor", "--revision", "0", "--parameters", '{"label":"saved-before-failure"}', "--project", f.project]);
  assert.equal(first.revision, 1); assert.equal(first.lastFailure, null, "the response was read before the new failure receipt");
  const second = await f.httpSettings({ type: "set", projectId: f.projectId, revision: 1, id: "context-doctor", parameters: { label: "http-also-saved" } });
  assert.equal(second.revision, 2);
  for (const result of [first, second]) {
    assert.equal(result.loadError, "RESOURCE_IDENTITY_CHANGED"); assert.equal(result.pending, true);
    assert.equal(Object.hasOwn(result, "resourceRevision"), false);
    assert.deepEqual(result.lastLoaded, receipt.lastLoaded);
  }
  const failed = await store.status(f.project);
  assert.equal(failed.lastFailure.code, "RESOURCE_IDENTITY_CHANGED"); assert.equal(failed.revision, 2);
  const origin = path.join(f.root, "SKILL.md"), content = "---\nname: preview-only\ndescription: Preview without loading\ncompatibility: pi-1.3.0\n---\nFixture.\n";
  await fs.writeFile(origin, content);
  const receiptFile = path.join(f.config, "only-my-pi/product-settings/loads", `${store.key(f.project)}.json`);
  const before = await Promise.all([store.file, receiptFile].map(file => fs.readFile(file, "utf8")));
  const conflict = await f.httpSettings({ type: "set", projectId: f.projectId, revision: 1, id: "context-doctor", enabled: false }, 409);
  assert.equal(conflict.code, "SETTINGS_REVISION_CONFLICT", "action failures are not converted to successful load-error results");
  assert.deepEqual(await Promise.all([store.file, receiptFile].map(file => fs.readFile(file, "utf8"))), before);
  const preview = await f.cliSettings(["preview", origin, "--project", f.project]);
  assert.deepEqual(await f.httpSettings({ type: "previewImport", projectId: f.projectId, source: { kind: "local-skill", origin, content } }), preview);
  for (const key of ["resourceRevision", "pending", "loadError", "lastLoaded"]) assert.equal(Object.hasOwn(preview, key), false);
  assert.deepEqual(await Promise.all([store.file, receiptFile].map(file => fs.readFile(file, "utf8"))), before);
  const defaults = await f.httpSettings({ type: "list" });
  assert.equal(Object.hasOwn(defaults, "loadError"), false); assert.equal(Object.hasOwn(defaults, "resourceRevision"), false);
  assert.equal(f.requests.length, 0);
});

test("Host rejects invalid settings scopes and transport credentials before applying an action", async t => {
  const f = await fixture(t);
  const saved = await f.cliSettings(["set", "context-doctor", "--revision", "0", "--parameters", '{"label":"unchanged"}']);
  const file = path.join(f.config, "only-my-pi/product-settings/config.json"), before = await fs.readFile(file, "utf8");
  const action = { type: "set", revision: saved.revision, id: "context-doctor", enabled: false };
  for (const projectId of [false, 0, "", null, true, {}, []]) assert.equal((await f.httpSettings({ ...action, projectId }, 400)).code, "SETTINGS_PROJECT_REQUIRED");
  assert.equal((await f.httpSettings({ ...action, projectId: "unknown-project" }, 404)).code, "PROJECT_NOT_FOUND");
  for (const protocol of ["", "2"]) assert.equal((await f.httpSettings(action, 409, { "x-omp-settings-protocol": protocol })).code, "SETTINGS_PROTOCOL_MISMATCH");
  assert.equal((await f.httpSettings(action, 403, { Origin: "https://example.invalid" })).code, "HOST_ORIGIN_DENIED");
  assert.equal((await f.httpSettings(action, 401, { Cookie: "" })).code, "AUTH_REQUIRED");
  assert.equal((await f.httpSettings({ ...action, revision: 0 }, 409)).code, "SETTINGS_REVISION_CONFLICT");
  assert.equal(await fs.readFile(file, "utf8"), before);
  assert.deepEqual(await f.cliSettings(["list"]), saved);
  assert.equal(f.requests.length, 0);
});
