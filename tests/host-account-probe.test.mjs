import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountCatalog } from "../packages/accounts/catalog.mjs";
import { accountAuth } from "../packages/accounts/authentication.mjs";
import { probeAccount } from "../packages/accounts/probe.mjs";
import { startHost } from "../packages/host/server.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-connection-")));
  const received = [], sockets = new Set();
  const f = { root, received, mode: "success", host: null, credential: "selected-probe-fixture-key" };
  const service = http.createServer(async (req, res) => {
    let raw = ""; for await (const bytes of req) raw += bytes;
    const record = { body: JSON.parse(raw), authorization: req.headers.authorization, closed: false }; received.push(record);
    res.once("close", () => { record.closed = true; });
    if (f.mode === "reject" || f.mode === "rate") {
      res.writeHead(f.mode === "reject" ? 401 : 429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Provider rejected ${req.headers.authorization}`, type: "authentication_error" } })); return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (f.mode === "pending") { res.flushHeaders(); return; }
    res.write(`data: ${JSON.stringify({ id: "probe", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "probe", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  service.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise(resolve => service.listen(0, "127.0.0.1", resolve));
  const pi = path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  await fs.symlink(pi, path.join(root, "pi"));
  f.catalog = new AccountCatalog(root); f.stack = { root, nodePath: process.execPath };
  f.config = { baseUrl: `http://127.0.0.1:${service.address().port}/v1`, api: "openai-completions", models: [
    { id: "one", name: "One", contextWindow: 32000, maxTokens: 512 },
    { id: "two", name: "Two", contextWindow: 64000, maxTokens: 1024, reasoning: true },
  ] };
  f.account = await f.catalog.create({ providerId: "probe-fixture", name: "Selected account", authType: "api_key" });
  await f.catalog.configure(f.account.accountId, f.config);
  await accountAuth({ stack: f.stack, configRoot: root, accounts: f.catalog, accountId: f.account.accountId, input: { type: "apiKey", key: f.credential } });
  f.probe = more => probeAccount({ stack: f.stack, configRoot: root, accounts: f.catalog, accountId: f.account.accountId, model: "probe-fixture/one", ...more });
  t.after(async () => { await f.host?.stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => service.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return f;
}

test("connection probe uses only the selected stored account and one bounded tool-free Pi request", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.catalog.configuration(f.account.accountId)).config, f.config);
  assert.deepEqual(await f.probe({ env: { OPENAI_API_KEY: "must-not-be-used" } }), { status: "connected", model: "probe-fixture/one" });
  assert.equal(f.received.length, 1);
  assert.equal(f.received[0].authorization, `Bearer ${f.credential}`);
  assert.equal(f.received[0].body.max_tokens ?? f.received[0].body.max_completion_tokens, 512);
  assert.equal(f.received[0].body.tools?.length ?? 0, 0);
  await assert.rejects(f.probe({ model: "another-provider/one" }), { code: "ACCOUNT_MODEL_MISMATCH" });
  await assert.rejects(f.probe({ accountId: "cli-readonly" }), { code: "ACCOUNT_READ_ONLY" });
  assert.equal(f.received.length, 1);
});

test("rejected credentials and rate limits stay distinct, sanitized and never automatically retry", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.mode = "reject";
  assert.deepEqual(await f.probe(), { status: "rejected", reason: "authentication", model: "probe-fixture/one" });
  f.mode = "rate";
  assert.deepEqual(await f.probe(), { status: "rejected", reason: "rate_limited", model: "probe-fixture/one" });
  assert.equal(f.received.length, 2);
  assert.equal((await accountAuth({ stack: f.stack, configRoot: f.root, accounts: f.catalog, accountId: f.account.accountId, input: { type: "status" } })).status, "stored");
});

test("configuration readback rejects credential-bearing or unexpected stored fields", async t => {
  const f = await fixture(t), { modelsPath } = await f.catalog.runtimePaths(f.account.accountId);
  for (const config of [{ ...f.config, apiKey: "must-not-cross-browser" }, { ...f.config, baseUrl: "https://user:secret@provider.invalid/v1" }, { ...f.config, baseUrl: "https://provider.invalid/v1?key=secret" }]) {
    await fs.writeFile(modelsPath, JSON.stringify({ providers: { "probe-fixture": config } }));
    await assert.rejects(f.catalog.configuration(f.account.accountId), { code: "ACCOUNT_PROVIDER_INVALID" });
  }
  await fs.writeFile(modelsPath, JSON.stringify({ providers: { "probe-fixture": f.config, other: f.config } }));
  await assert.rejects(f.catalog.configuration(f.account.accountId), { code: "ACCOUNT_PROVIDER_INVALID" });
});

test("cancelling a probe closes its request before releasing account ownership", { timeout: 20000 }, async t => {
  const f = await fixture(t); f.mode = "pending";
  const controller = new AbortController(), pending = f.probe({ signal: controller.signal });
  for (let i = 0; i < 400 && !f.received.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.received.length, 1);
  await assert.rejects(f.catalog.rename(f.account.accountId, "not yet"), { code: "ACCOUNT_BUSY" });
  controller.abort();
  await assert.rejects(pending, { code: "ACCOUNT_PROBE_CANCELLED" });
  await f.catalog.rename(f.account.accountId, "after child exit");
  for (let i = 0; i < 100 && !f.received[0].closed; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.received[0].closed, true);
});

test("minimal Host exposes account configuration and probe with pairing, origin and protocol checks", { timeout: 20000 }, async t => {
  const f = await fixture(t), assetsRoot = path.join(f.root, "assets");
  await fs.mkdir(assetsRoot); await fs.writeFile(path.join(assetsRoot, "minimal.html"), "<html>fixture</html>");
  f.host = await startHost({ configRoot: f.root, stack: f.stack, assetsRoot, minimal: true });
  const origin = f.host.origin;
  const pair = await fetch(origin + "/pair", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(f.host.pairingUrl).hash.slice(6) }) });
  const headers = { origin, cookie: pair.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-account-protocol": "1" };
  const post = (action, more = {}) => fetch(origin + "/api/account-action", { method: "POST", headers: { ...headers, ...more }, body: JSON.stringify({ accountId: f.account.accountId, action }) });
  const config = await post({ type: "configuration" }); assert.equal(config.status, 200); assert.deepEqual(await config.json(), { config: f.config });
  assert.equal((await post({ type: "probe", model: "probe-fixture/one" }, { "x-omp-account-protocol": "0" })).status, 409);
  assert.equal((await post({ type: "probe", model: "probe-fixture/one" }, { origin: "http://foreign.invalid" })).status, 403);
  assert.equal(f.received.length, 0);
  const result = await post({ type: "probe", model: "probe-fixture/one" });
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { status: "connected", model: "probe-fixture/one" });
  assert.equal(f.received.length, 1);
});
