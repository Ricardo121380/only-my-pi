import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { createAccountOAuthService, installAccountOAuthTransport } from "./fixtures/account-oauth-service.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";

async function until(read, accept) {
  for (let i = 0; i < 400; i++) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail("controlled OAuth condition was not reached");
}

test("formal CLI and unmodified Pi OAuth complete local PKCE, callbacks, stored identity and real model calls", { timeout: 90000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-oauth-")));
  const service = await createAccountOAuthService();
  const children = new Set();
  const exits = [];
  let f;
  t.after(async () => { for (const child of children) { child.kill("SIGKILL"); await child.closed; } await service.close();
    if (f) await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01A_SOURCE_NATIVE_OAUTH_LOCAL_ONLY", bindings: f.bindings, received: service.calls, exchanges: service.exchanges, exits });
    await fs.rm(root, { recursive: true }); });
  f = await createPi110SourceCli(root, { baseUrl: `${service.origin}/v1` });
  await installAccountOAuthTransport(f, service);
  const originalAuth = await fs.readFile(path.join(f.config, "auth.json"));
  const start = args => {
    const child = spawn(process.execPath, [f.cli, ...args], { cwd: f.project, env: { ...f.env, OPENROUTER_API_KEY: "ambient-wrong-identity" }, stdio: ["pipe", "pipe", "pipe"] });
    child.out = ""; child.err = "";
    child.stdout.on("data", chunk => { child.out += chunk; }); child.stderr.on("data", chunk => { child.err += chunk; });
    child.closed = once(child, "close").then(([code, signal]) => { children.delete(child); exits.push({ args, code, signal, out: child.out, err: child.err }); return { code, signal }; });
    children.add(child); return child;
  };
  const run = async (args, expected = 0) => {
    const child = start(args); child.stdin.end();
    assert.equal((await child.closed).code, expected, child.out + child.err);
    return child.out ? JSON.parse(child.out) : {};
  };
  const descriptor = path.join(root, "openrouter.json");
  await fs.writeFile(descriptor, JSON.stringify({ baseUrl: `${service.origin}/v1`, api: "openai-completions", models: [{ id: "controlled-model", name: "Controlled OAuth", contextWindow: 32000, maxTokens: 128 }] }));
  const accounts = [];
  for (const identity of ["OAuth A", "OAuth B"]) {
    const account = await run(["account", "add", "--provider", "openrouter", "--name", identity, "--auth", "oauth"]); accounts.push(account);
    await run(["account", "configure", account.accountId, descriptor]);
    const login = start(["account", "login", account.accountId, "--stdin"]);
    const providerUrl = await until(() => /Open in your browser: (https:\/\/[^\s]+)/.exec(login.err)?.[1], Boolean);
    await run(["account", "rename", account.accountId, "Must wait"], 1);
    const authorized = await fetch(service.authorizeUrl(providerUrl, identity), { redirect: "manual" });
    const callback = authorized.headers.get("location");
    const callbackResponse = await fetch(callback);
    assert.equal(callbackResponse.status, 200);
    const duplicate = await fetch(callback).then(response => response.status, () => "closed");
    assert.ok([409, "closed"].includes(duplicate));
    assert.equal((await login.closed).code, 0, login.out + login.err);
    assert.equal(JSON.parse(login.out).status, "stored");
    assert.equal((await run(["account", "status", account.accountId])).status, "stored");
    const before = service.calls.length;
    const request = start(["--account", account.accountId, "--model", "openrouter/controlled-model", "-p", "inspect controlled project"]); request.stdin.end();
    assert.equal((await request.closed).code, 0, request.out + request.err);
    assert.match(request.out, /controlled OAuth account completed/);
    assert.equal(service.calls.length, before + 1); assert.equal(service.calls.at(-1).identity, identity);
    assert.ok(!service.calls.at(-1).tools.some(name => ["write", "edit", "bash"].includes(name)));
    for (const key of service.keys.keys()) assert.equal((request.out + request.err + login.out + login.err + JSON.stringify(service.calls)).includes(key), false);
  }
  assert.equal(service.exchanges.length, 2); assert.ok(service.exchanges.every(exchange => exchange.valid));
  const timed = start(["account", "login", accounts[0].accountId, "--stdin", "--timeout-ms", "1500"]);
  await until(() => /Open in your browser: (https:\/\/[^\s]+)/.exec(timed.err)?.[1], Boolean);
  assert.equal((await timed.closed).code, 1); assert.equal(JSON.parse(timed.out).status, "timed_out");
  const cancelled = start(["account", "login", accounts[0].accountId, "--stdin"]);
  const cancelledUrl = await until(() => /Open in your browser: (https:\/\/[^\s]+)/.exec(cancelled.err)?.[1], Boolean);
  cancelled.kill("SIGINT"); assert.equal((await cancelled.closed).code, 1);
  const late = new URL(cancelledUrl).searchParams.get("callback_url");
  await assert.rejects(fetch(`${late}?code=expired`));
  assert.equal(service.exchanges.length, 2, "cancelled, timed out and repeated callbacks never exchange a second identity");
  service.revoked.add("OAuth A");
  const rejected = start(["--account", accounts[0].accountId, "--model", "openrouter/controlled-model", "-p", "reject revoked identity"]); rejected.stdin.end();
  assert.equal((await rejected.closed).code, 1);
  assert.equal(service.calls.at(-1).identity, "OAuth A"); assert.equal(service.calls.at(-1).valid, false);
  const before = service.calls.length;
  await run(["account", "logout", accounts[0].accountId]);
  const missing = start(["--account", accounts[0].accountId, "--model", "openrouter/controlled-model", "-p", "reject missing identity"]); missing.stdin.end();
  assert.equal((await missing.closed).code, 1); assert.equal(service.calls.length, before);
  assert.deepEqual(await fs.readFile(path.join(f.config, "auth.json")), originalAuth);
});
