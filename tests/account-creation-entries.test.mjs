import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { startHost } from "../packages/host/server.mjs";
import { AccountCatalog } from "../packages/accounts/catalog.mjs";
import { AccountOAuth } from "../packages/accounts/oauth.mjs";

const execFile = promisify(execFileCallback);
test("offline CLI metadata and HTTP OAuth discovery preserve their distinct creation checks", async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-create-")));
  const configRoot = path.join(root, "config"), sdk = path.join(root, "pi/dist/index.js"), marker = path.join(root, "discovery.jsonl"), assetsRoot = path.join(root, "assets");
  await fs.mkdir(path.dirname(sdk), { recursive: true }); await fs.mkdir(assetsRoot);
  await fs.writeFile(path.join(root, "pi/package.json"), '{"type":"module"}');
  await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>owned fixture</title>");
  await fs.writeFile(sdk, `import { appendFile } from "node:fs/promises";
    export class ModelRuntime {
      static async create() { await appendFile(${JSON.stringify(marker)}, JSON.stringify({type:"discovery",pid:process.pid})+"\\n"); return new ModelRuntime(); }
      getProviders() { return [{id:"fixture",auth:{oauth:{name:"Fixture OAuth"}}}]; }
      async login() { await appendFile(${JSON.stringify(marker)}, '{"type":"login"}\\n'); throw Error("unexpected login"); }
    }`);
  const stack = { root, nodePath: process.execPath, stackId: `sha256:${"a".repeat(64)}` };
  const host = await startHost({ configRoot, stack, assetsRoot, modelsProvider: async () => [] });
  t.after(async () => { try { await host.stop(); } finally { await fs.rm(root, { recursive: true, force: true }); } });
  const cli = new URL("../bin/omp.mjs", import.meta.url).pathname;
  const result = await execFile(process.execPath, [cli, "account", "add", "--provider", "offline_only", "--name", "Offline", "--auth", "oauth"], { env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: configRoot } });
  const offline = JSON.parse(result.stdout);
  assert.equal(offline.providerId, "offline_only");
  await assert.rejects(fs.access(marker), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(configRoot, "auth.json")), { code: "ENOENT" });
  const paired = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  assert.equal(paired.status, 200); const cookie = paired.headers.get("set-cookie").split(";")[0];
  const input = { providerId: "fixture", name: "Online", authType: "oauth" };
  const create = (value, extra = {}) => fetch(host.origin + "/api/accounts", { method: "POST", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-account-protocol": "1", ...extra }, body: JSON.stringify(value) });
  for (const [extra, status] of [[{ Cookie: "" }, 401], [{ Origin: "https://invalid.example" }, 403], [{ "x-omp-account-protocol": "0" }, 409]]) assert.equal((await create(input, extra)).status, status);
  await assert.rejects(fs.access(marker), { code: "ENOENT" });
  const unsupported = await create({ ...input, providerId: "offline_only" });
  assert.equal(unsupported.status, 400); assert.deepEqual(await unsupported.json(), { code: "ACCOUNT_PROVIDER_UNSUPPORTED" });
  const accounts = new AccountCatalog(configRoot);
  assert.deepEqual((await accounts.list()).map(a => a.accountId), [offline.accountId]);
  const providers = await fetch(host.origin + "/api/oauth-providers", { headers: { Origin: host.origin, Cookie: cookie } });
  assert.deepEqual(await providers.json(), { providers: [{ providerId: "fixture", name: "Fixture OAuth" }] });
  const supported = await create(input);
  assert.equal(supported.status, 201); assert.equal((await supported.json()).authentication, "not_connected");
  const invalid = await create({ ...input, name: " " });
  assert.equal(invalid.status, 400); assert.deepEqual(await invalid.json(), { code: "ACCOUNT_INPUT_INVALID" });
  const oauth = new AccountOAuth({ stack, configRoot, accounts, env: {} });
  try { const flow = await oauth.start(offline.accountId); await oauth.running; assert.equal(oauth.snapshot(flow.flowId).status, "failed"); }
  finally { await oauth.stop(); }
  assert.equal((await fs.readFile(marker, "utf8")).includes('"type":"login"'), false, "unsupported metadata never invokes Provider login");
  for (let i = 0; i < 100; i++) {
    const pending = await fs.readdir(path.join(configRoot, "only-my-pi/host/auth-processes"));
    if (!pending.length) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(await fs.readdir(path.join(configRoot, "only-my-pi/host/auth-processes")), []);
  await fs.writeFile(sdk, 'throw Error("owned discovery failure");');
  const before = await accounts.list();
  const unavailable = await create(input);
  assert.equal(unavailable.status, 503); assert.deepEqual(await unavailable.json(), { code: "ACCOUNT_PROVIDER_DISCOVERY_FAILED" });
  assert.deepEqual(await accounts.list(), before);
  assert.equal((await create({ providerId: "offline_only", name: "API key metadata", authType: "api_key" })).status, 201);
});
