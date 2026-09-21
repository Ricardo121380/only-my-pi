import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { accountWorkerEnvironment, listModels } from "../packages/host/models.mjs";

test("account child receives operational environment but no ambient identity or Node preload", () => {
  assert.deepEqual(accountWorkerEnvironment({ PATH: "/usr/bin", HTTPS_PROXY: "http://localhost:1234", OPENAI_API_KEY: "secret", AWS_PROFILE: "default", GOOGLE_APPLICATION_CREDENTIALS: "/private/key", NODE_OPTIONS: "--import evil", CUSTOM_PROVIDER_TOKEN: "secret" }), { PATH: "/usr/bin", HTTPS_PROXY: "http://localhost:1234" });
});
test("real catalog child rejects unknown binding and does not borrow CLI credentials", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-model-binding-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  await fs.symlink(packageRoot, path.join(root, "pi"));
  const configRoot = path.join(root, "config"), catalog = new AccountCatalog(configRoot);
  const account = await catalog.create({ providerId: "openai", name: "Unauthenticated", authType: "api_key" });
  const cliAuth = JSON.stringify({ openai: { type: "api_key", key: "cli-fixture-not-for-use" } });
  await fs.writeFile(path.join(configRoot, "auth.json"), cliAuth);
  const options = { stack: { root, nodePath: process.execPath }, configRoot, env: { PATH: process.env.PATH, OPENAI_API_KEY: "ambient-fixture" } };
  assert.deepEqual(await listModels({ ...options, accountId: account.accountId }), []);
  await assert.rejects(listModels({ ...options, accountId: "missing" }), { code: "MODEL_CATALOG_UNAVAILABLE" });
  assert.equal(await fs.readFile(path.join(configRoot, "auth.json"), "utf8"), cliAuth);
  assert.ok((await listModels({ ...options, accountId: "cli-readonly" })).every((model) => model.provider === "openai"));
  await fs.writeFile(path.join(configRoot, "auth.json"), "{}");
  assert.deepEqual(await listModels({ ...options, accountId: "cli-readonly" }), [], "explicit CLI reference still cannot silently use ambient-only credentials");
});
