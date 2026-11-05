import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDoctorService } from "../packages/bootstrap/doctor-service.mjs";
import { planOwnedGraph } from "../packages/bootstrap/graph-plan.mjs";
import { acquireOwnership } from "../packages/process-runtime/ownership.mjs";
import { AccountCatalog } from "../packages/accounts/catalog.mjs";
import { inspectPack, validatePackEntries } from "../scripts/pack-check.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../verification/manifests/pack-content-v1.json", import.meta.url), "utf8"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pack allowlist rejects receipts, fixtures, tests, traversal, and unlisted files", () => {
  for (const file of [
    "verification/receipts/private.json",
    "extensions/example/fixtures/input.json",
    "extensions/example/index.test.mjs",
    "../outside.txt",
    "docs/research/report.md",
    "node_modules/unlisted-package/index.js",
    "node_modules/ajv/node_modules/unlisted-package/index.js",
    "node_modules/yaml/node_modules/unlisted-package/index.js",
    "node_modules/node-pty/node_modules/unlisted-package/index.js",
    "contracts/release/external/node_modules/pi-permission-modes/src/index.ts",
  ]) {
    const result = validatePackEntries([...manifest.required, file], manifest);
    assert.equal(result.ok, false, file);
  }
});

test("pack allowlist accepts only the exact bundled runtime dependency roots", () => {
  const result = validatePackEntries([...manifest.required, "node_modules/ajv/dist/ajv.js", "node_modules/yaml/util.js", "node_modules/minipass/dist/commonjs/index.js", "node_modules/node-pty/prebuilds/darwin-arm64/pty.node", "node_modules/node-addon-api/napi.h"], manifest);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("npm pack content is constrained by the positive allowlist", () => {
  const result = inspectPack();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.files.includes("package.json"));
  assert.ok(!result.files.some((file) => file.startsWith("verification/")));
  assert.ok(!result.files.some((file) => file.startsWith("codex/")));
  assert.ok(result.files.some((file) => file.startsWith("node_modules/ajv/")));
  assert.ok(!result.files.some((file) => file.startsWith("node_modules/@earendil-works/")));
});

test("the packaged static doctor accepts excluded source evidence but requires every packaged resource", async (t) => {
  const packed = inspectPack();
  assert.equal(packed.ok, true);
  const artifactRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-packed-doctor-"));
  t.after(() => fsp.rm(artifactRoot, { recursive: true, force: true }));

  for (const relativePath of packed.files) {
    const source = path.join(root, relativePath);
    const target = path.join(artifactRoot, relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
  }

  const passing = createDoctorService({ rootDir: artifactRoot }).static({ profileId: "minimal" });
  assert.equal(passing.ok, true, JSON.stringify(passing.findings));
  assert.equal(passing.scope, "packaged-static-declarations-only");
  assert.equal(await fsp.stat(path.join(artifactRoot, "package-lock.json")).then(() => true, () => false), false);
  assert.equal(await fsp.stat(path.join(artifactRoot, "tests")).then(() => true, () => false), false);

  // Exercise the copied package, not the source checkout's module graph.
  const packagedOwnership = await import(pathToFileURL(path.join(artifactRoot, "packages/process-runtime/ownership.mjs")));
  const { accountWorkerEnvironment } = await import(pathToFileURL(path.join(artifactRoot, "packages/process-runtime/account-environment.mjs")));
  assert.deepEqual(accountWorkerEnvironment({ PATH: "/usr/bin", NODE_OPTIONS: "--import unwanted", OPENAI_API_KEY: "synthetic" }), { PATH: "/usr/bin" });
  const configRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-packed-ownership-"));
  t.after(() => fsp.rm(configRoot, { recursive: true, force: true }));
  const packagedCli = await import(pathToFileURL(path.join(artifactRoot, "bin/omp.mjs")));
  const control = packagedCli.createProductionControlService({ configRoot });
  assert.equal(typeof control.dispatch, "function");
  assert.equal(control.then, undefined);
  assert.equal(control.rootDir, await fsp.realpath(artifactRoot), "factory defaults must resolve the copied package root");
  let help = "";
  assert.equal(await packagedCli.runOmpCli({ argv: ["help"], stdout: { write: text => { help += text; } } }), 0);
  assert.match(help, /only-my-pi control CLI/);
  assert.deepEqual(await fsp.readdir(configRoot), [], "factory and help must not create configuration");
  const budgets = await import(pathToFileURL(path.join(artifactRoot, "packages/model-calls/budgets.mjs")));
  const { ModelCallStore, IMAGE_BUDGET } = await import(pathToFileURL(path.join(artifactRoot, "packages/model-calls/store.mjs")));
  const { modelCallError } = await import(pathToFileURL(path.join(artifactRoot, "packages/model-calls/contracts.mjs")));
  assert.equal(IMAGE_BUDGET, budgets.IMAGE_BUDGET);
  assert.ok(Object.isFrozen(budgets.MODEL_BUDGET_LIMITS));
  assert.equal(modelCallError("MODEL_LEDGER_INVALID", 409).status, 409);
  assert.deepEqual(await new ModelCallStore(configRoot).read(), { version: 1, projects: [], tasks: [] });
  const lease = await acquireOwnership(configRoot, "session", "shared-package-identity");
  try {
    await assert.rejects(packagedOwnership.acquireOwnership(configRoot, "session", "shared-package-identity"), { code: "OWNERSHIP_HELD" });
  } finally { await lease.release(); }
  const next = await packagedOwnership.acquireOwnership(configRoot, "session", "shared-package-identity");
  await next.release();

  // The packaged account CLI and workers use their copied dependencies and the
  // test's installed Pi SDK. This is not a Full stack installation receipt.
  const { runAccountCli } = await import(pathToFileURL(path.join(artifactRoot, "packages/accounts/commands.mjs")));
  const { AccountCatalog: PackagedCatalog } = await import(pathToFileURL(path.join(artifactRoot, "packages/accounts/catalog.mjs")));
  const { accountAuth } = await import(pathToFileURL(path.join(artifactRoot, "packages/accounts/authentication.mjs")));
  const { AccountOAuth } = await import(pathToFileURL(path.join(artifactRoot, "packages/accounts/oauth.mjs")));
  await fsp.symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))), path.join(configRoot, "pi"));
  const stack = { root: configRoot, nodePath: process.execPath };
  const cli = argv => runAccountCli({ argv, configRoot, resolveStack: async () => stack, env: { PATH: process.env.PATH } });
  const account = await cli(["add", "--provider", "openai", "--name", "Packaged", "--auth", "api_key"]);
  const sourceCatalog = new AccountCatalog(configRoot), accounts = new PackagedCatalog(configRoot);
  assert.deepEqual(await sourceCatalog.get(account.accountId), account);
  assert.deepEqual(await cli(["status", account.accountId]), { status: "missing" });
  assert.deepEqual(await cli(["models", account.accountId]), { models: [] });
  assert.deepEqual(await accountAuth({ stack, configRoot, accounts, accountId: account.accountId, input: { type: "apiKey", key: "packaged-synthetic-not-real" }, env: {} }), { status: "stored" });
  assert.deepEqual(await cli(["status", account.accountId]), { status: "stored" });
  const use = await sourceCatalog.beginUse(account.accountId);
  try { await assert.rejects(cli(["logout", account.accountId]), { code: "ACCOUNT_BUSY", status: 409 }); }
  finally { await use(); }
  assert.deepEqual(await cli(["logout", account.accountId]), { status: "missing" });
  const oauth = new AccountOAuth({ stack, configRoot, accounts, env: {} });
  try { assert.ok((await oauth.providers()).some(provider => provider.providerId === "openrouter")); }
  finally { await oauth.stop(); }

  const readPacked = file => JSON.parse(fs.readFileSync(path.join(artifactRoot, file), "utf8"));
  const plan = await planOwnedGraph({
    artifactRoot,
    packageInventory: readPacked("inventory/packages.lock.json"),
    resourceInventory: readPacked("inventory/resources.lock.json"),
    profile: readPacked("profiles/daily.json"),
  });
  assert.ok(plan.resources.some(resource => resource.path === "packages/process-runtime"));
  assert.ok(plan.resources.some(resource => resource.path === "packages/accounts"));
  assert.ok(plan.resources.some(resource => resource.path === "packages/control-service/secret-input.mjs"));
  assert.ok(!plan.resources.some(resource => resource.path === "packages/host/ownership.mjs"));

  await fsp.rm(path.join(artifactRoot, "extensions", "context-doctor", "metrics.mjs"));
  const missingRuntime = createDoctorService({ rootDir: artifactRoot }).static({ profileId: "minimal" });
  assert.equal(missingRuntime.ok, false);
  assert.ok(missingRuntime.findings.some((finding) => (
    finding.code === "invalid-resource-path" && finding.resourceId === "context-doctor-runtime"
  )));
});
