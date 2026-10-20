import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountCatalog } from "../packages/host/accounts.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-accounts-"));
  t.after(() => fs.rm(root, { recursive: true }));
  return { root, catalog: new AccountCatalog(root) };
}
const input = { providerId: "anthropic", name: "Primary", authType: "api_key" };
test("same provider gets separate persisted identities without changing CLI auth", async (t) => {
  const { root, catalog } = await fixture(t);
  await fs.writeFile(path.join(root, "auth.json"), "CLI sentinel");
  assert.deepEqual(await catalog.list(), []);
  const a = await catalog.create(input), b = await catalog.create({ ...input, name: "Second" });
  assert.notEqual(a.accountId, b.accountId);
  assert.deepEqual(await new AccountCatalog(root).list(), [a, b]);
  assert.equal(await fs.readFile(path.join(root, "auth.json"), "utf8"), "CLI sentinel");
  assert.equal((await fs.stat(catalog.file)).mode & 0o777, 0o600);
  await assert.rejects(catalog.get("../../auth.json"), { code: "ACCOUNT_NOT_FOUND" });
});
test("rejects secrets, client paths, invalid names and auth types", async (t) => {
  const { catalog } = await fixture(t);
  for (const change of [{ apiKey: "secret" }, { authPath: "/tmp/key" }, { accountId: "chosen" }, { providerId: "../escape" }, { name: "  " }, { authType: "shell" }]) {
    await assert.rejects(catalog.create({ ...input, ...change }), { code: "ACCOUNT_INPUT_INVALID" });
  }
  assert.deepEqual(await catalog.list(), []);
});
test("concurrent catalog instances never lose a successful write", async (t) => {
  const { root, catalog } = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => new AccountCatalog(root).create(input)));
  const successful = results.filter((r) => r.status === "fulfilled");
  assert.ok(successful.length > 0);
  assert.equal((await catalog.list()).length, successful.length);
  for (const r of results.filter((r) => r.status === "rejected")) assert.equal(r.reason.code, "LOCK_HELD");
  await catalog.create(input);
  assert.equal((await catalog.list()).length, successful.length + 1);
});
test("corrupt store fails closed and lock is released for recovery", async (t) => {
  const { catalog } = await fixture(t);
  await catalog.create(input);
  await fs.writeFile(catalog.file, "broken");
  await assert.rejects(catalog.create(input), { code: "ACCOUNT_STORE_UNREADABLE" });
  assert.equal(await fs.readFile(catalog.file, "utf8"), "broken");
  await fs.writeFile(catalog.file, JSON.stringify({ version: 1, accounts: [] }));
  await catalog.create(input);
  assert.equal((await catalog.list()).length, 1);
});
test("symlinked catalog cannot expose or overwrite another file", async (t) => {
  const { root, catalog } = await fixture(t);
  await catalog.create(input);
  const outside = path.join(root, "cli-sentinel.json");
  await fs.writeFile(outside, "private sentinel");
  await fs.unlink(catalog.file);
  await fs.symlink(outside, catalog.file);
  await assert.rejects(catalog.list(), { code: "ACCOUNT_STORE_UNREADABLE" });
  await assert.rejects(catalog.create(input), { code: "ACCOUNT_STORE_UNREADABLE" });
  assert.equal(await fs.readFile(outside, "utf8"), "private sentinel");
});
test("unknown persisted fields and duplicate identities fail validation", async (t) => {
  const { catalog } = await fixture(t);
  const account = await catalog.create(input);
  for (const accounts of [[{ ...account, token: "must-not-return" }], [account, account]]) {
    await fs.writeFile(catalog.file, JSON.stringify({ version: 1, accounts }));
    await assert.rejects(catalog.list(), { code: "ACCOUNT_STORE_INVALID" });
  }
});
test("runtime paths are independent, private and reject credential symlinks", async (t) => {
  const { root, catalog } = await fixture(t);
  const a = await catalog.create(input), b = await catalog.create(input);
  const first = await catalog.runtimePaths(a.accountId), second = await catalog.runtimePaths(b.accountId);
  for (const key of ["authPath", "modelsPath", "modelsStorePath"]) assert.notEqual(first[key], second[key]);
  assert.equal((await fs.stat(path.dirname(first.authPath))).mode & 0o777, 0o700);
  await assert.rejects(catalog.runtimePaths("../../outside"), { code: "ACCOUNT_NOT_FOUND" });
  await fs.symlink(path.join(root, "auth.json"), first.authPath);
  await assert.rejects(catalog.runtimePaths(a.accountId), { code: "SYMLINK_ESCAPE" });
});
test("shared use blocks account changes until every user releases; changing blocks new use", async (t) => {
  const { catalog } = await fixture(t);
  const a = await catalog.create(input);
  const one = await catalog.beginUse(a.accountId), two = await catalog.beginUse(a.accountId);
  await assert.rejects(catalog.change(a.accountId, async () => {}), { code: "ACCOUNT_BUSY" });
  await one(); await one();
  await assert.rejects(catalog.change(a.accountId, async () => {}), { code: "ACCOUNT_BUSY" });
  await two();
  let finish, ready;
  const barrier = new Promise((resolve) => { finish = resolve; });
  const entered = new Promise(resolve => { ready = resolve; });
  const changing = catalog.change(a.accountId, async () => { ready(); return barrier; });
  await entered;
  await assert.rejects(catalog.beginUse(a.accountId), { code: "ACCOUNT_BUSY" });
  finish(); await changing;
  await assert.rejects(catalog.change(a.accountId, async () => { throw new Error("fixture"); }));
  await (await catalog.beginUse(a.accountId))();
});
test("static provider and lifecycle operations reject commands and occupied accounts", async (t) => {
  const { catalog } = await fixture(t), account = await catalog.create(input);
  const config = { baseUrl: "https://example.invalid/v1", api: "openai-completions", models: [{ id: "test", name: "Test", contextWindow: 32000, maxTokens: 128 }] };
  for (const bad of [{ ...config, apiKey: "!command" }, { ...config, headers: { Authorization: "secret" } }, { ...config, baseUrl: "https://user:password@example.invalid" }, { ...config, baseUrl: "http://remote.invalid" }]) await assert.rejects(catalog.configure(account.accountId, bad), { code: "ACCOUNT_PROVIDER_INVALID" });
  await catalog.configure(account.accountId, config);
  const paths = await catalog.runtimePaths(account.accountId);
  assert.deepEqual(JSON.parse(await fs.readFile(paths.modelsPath, "utf8")), { providers: { anthropic: config } });
  const release = await catalog.beginUse(account.accountId);
  await assert.rejects(catalog.remove(account.accountId), { code: "ACCOUNT_BUSY" });
  await assert.rejects(catalog.rename(account.accountId, "New"), { code: "ACCOUNT_BUSY" });
  await release();
  assert.equal((await catalog.rename(account.accountId, "New")).name, "New");
  await catalog.remove(account.accountId);
  assert.deepEqual(await catalog.list(), []);
  await assert.rejects(fs.access(paths.modelsPath), { code: "ENOENT" });
});
