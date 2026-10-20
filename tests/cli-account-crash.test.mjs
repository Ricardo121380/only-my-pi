import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { createAccountOAuthService, installAccountOAuthTransport } from "./fixtures/account-oauth-service.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";
import { processIdentity, groupAlive } from "../packages/host/ownership.mjs";

async function until(read, accept, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail(`Actual crash recovery condition not reached: ${label}`);
}

for (const authType of ["api_key", "oauth"]) test(`formal ${authType} CLI crash retains live users and recovers the same real Pi identity`, { timeout: 120000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-crash-")));
  const children = new Set(), commands = [], workers = [], observations = [];
  const active = new Set(); let hold = false, host;
  const service = await createAccountOAuthService({ respond: ({ res }) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "controlled-crash", choices: [{ index: 0, delta: { role: "assistant", content: "controlled identity after recovery" }, finish_reason: null }] })}\n\n`);
    if (hold) { active.add(res); res.once("close", () => active.delete(res)); }
    else res.end('data: {"id":"controlled-crash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  } });
  const f = await createPi110SourceCli(root, { baseUrl: `${service.origin}/v1`, installedExtensions: true, verifyNode: true });
  if (authType === "oauth") await installAccountOAuthTransport(f, service);
  t.after(async () => {
    for (const child of children) { child.kill("SIGKILL"); await child.closed; }
    for (const worker of workers) if (await processIdentity(worker.pid) === worker.identity) process.kill(worker.pid, "SIGKILL");
    for (const worker of workers) await until(() => processIdentity(worker.pid), value => value === null, "owned auth worker exited");
    if (host) await until(() => groupAlive(host.pid), value => !value, "Host process group gone");
    await service.close();
    await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01A_SOURCE_CRASH_LOCAL_ONLY", authType,
      bindings: f.bindings, nodeRuntime: f.nodeRuntime, commands, workers, observations, received: service.calls, exchanges: service.exchanges,
      activeStreams: active.size, processesConfirmedExited: true });
    await fs.rm(root, { recursive: true });
  });
  const start = (args, input, keepStdin = false) => {
    const child = spawn(process.execPath, [f.cli, ...args], { cwd: f.project, env: f.cliEnv, stdio: ["pipe", "pipe", "pipe"] });
    const record = { pid: child.pid, args, stdout: "", stderr: "", exit: null }; commands.push(record); child.record = record;
    child.stdout.on("data", bytes => { record.stdout += bytes; }); child.stderr.on("data", bytes => { record.stderr += bytes; });
    child.closed = once(child, "close").then(([code, signal]) => { record.exit = { code, signal }; children.delete(child); return record; });
    children.add(child); if (!keepStdin) child.stdin.end(input ?? ""); return child;
  };
  const run = async (args, input, expected = 0) => {
    const record = await start(args, input).closed; assert.equal(record.exit.code, expected, record.stderr); return record;
  };
  const originalAuth = await fs.readFile(path.join(f.config, "auth.json"));
  const identity = `Crash ${authType}`, key = "controlled-crash-api-key";
  if (authType === "api_key") service.keys.set(key, identity);
  const account = JSON.parse((await run(["account", "add", "--provider", "openrouter", "--name", identity, "--auth", authType])).stdout);
  const descriptor = path.join(root, "provider.json");
  await fs.writeFile(descriptor, JSON.stringify({ baseUrl: `${service.origin}/v1`, api: "openai-completions", models: [{ id: "controlled-model", name: "Controlled", contextWindow: 32000, maxTokens: 128 }] }));
  await run(["account", "configure", account.accountId, descriptor]);
  const login = async () => {
    if (authType === "api_key") return run(["account", "login", account.accountId, "--stdin"], `${key}\n`);
    const child = start(["account", "login", account.accountId, "--stdin"], undefined, true);
    const url = await until(() => /Open in your browser: (https:\/\/[^\s]+)/.exec(child.record.stderr)?.[1], Boolean, "native OAuth URL");
    const authorized = await fetch(service.authorizeUrl(url, identity), { redirect: "manual" });
    assert.equal((await fetch(authorized.headers.get("location"))).status, 200);
    const result = await child.closed; assert.equal(result.exit.code, 0, result.stderr); return result;
  };
  await login();
  const args = ["--account", account.accountId, "--model", "openrouter/controlled-model", "-p", "controlled crash and identity recovery"];
  hold = true;
  const using = start(args);
  await until(() => active.size, value => value === 1, "independent model receiver streaming");
  const usingIdentity = await processIdentity(using.pid); assert.ok(usingIdentity);
  using.kill("SIGSTOP");
  for (const action of [["rename", account.accountId, "Must stay busy"], ["remove", account.accountId], ["logout", account.accountId], ["login", account.accountId, "--stdin"]]) {
    const record = await run(["account", ...action], "must-not-replace\n", 1); assert.match(record.stderr, /ACCOUNT_BUSY/);
  }
  assert.equal(await processIdentity(using.pid), usingIdentity); assert.equal(active.size, 1);
  using.kill("SIGKILL"); assert.equal((await using.closed).exit.signal, "SIGKILL");
  await until(() => processIdentity(using.pid), value => value === null, "actual Pi PID exited");
  await until(() => active.size, value => value === 0, "independent upstream connection closed");
  await run(["account", "rename", account.accountId, identity]);
  observations.push({ phase: "Pi crash", pid: using.pid, priorIdentity: usingIdentity, liveBeforeKill: true,
    activeStreamsBefore: 1, activeStreamsAfter: active.size, mutationsBlocked: 4, exit: using.record.exit });
  hold = false;
  const before = service.calls.length;
  assert.match((await run(args)).stdout, /controlled identity after recovery/);
  assert.equal(service.calls.length, before + 1); assert.equal(service.calls.at(-1).identity, identity);

  if (authType === "oauth") {
    const authenticating = start(["account", "login", account.accountId, "--stdin"], undefined, true);
    const providerUrl = await until(() => /Open in your browser: (https:\/\/[^\s]+)/.exec(authenticating.record.stderr)?.[1], Boolean, "second native OAuth interaction");
    const directory = path.join(f.config, "only-my-pi/host/auth-processes");
    const marker = await until(async () => {
      for (const name of await fs.readdir(directory)) {
        const item = JSON.parse(await fs.readFile(path.join(directory, name), "utf8").catch(() => "null"));
        if (item?.parent?.pid === authenticating.pid) return item;
      }
    }, Boolean, "actual authentication subprocess marker");
    assert.equal(await processIdentity(marker.pid), marker.identity); workers.push(marker);
    process.kill(marker.pid, "SIGSTOP"); authenticating.kill("SIGKILL");
    assert.equal((await authenticating.closed).exit.signal, "SIGKILL");
    await until(() => processIdentity(authenticating.pid), value => value === null, "OAuth CLI parent exited");
    assert.equal(await processIdentity(marker.pid), marker.identity, "a stopped but alive auth worker retains the change reservation");
    const deniedUse = await run(args, undefined, 1); assert.match(deniedUse.stderr, /ACCOUNT_BUSY/);
    for (const action of [["rename", account.accountId, "Must stay busy"], ["remove", account.accountId], ["logout", account.accountId], ["login", account.accountId, "--stdin"]]) {
      const record = await run(["account", ...action], "must-not-replace\n", 1); assert.match(record.stderr, /ACCOUNT_BUSY/);
    }
    const exchanges = service.exchanges.length, received = service.calls.length;
    const assets = path.join(root, "recovery-assets"); await fs.mkdir(assets); await fs.writeFile(path.join(assets, "index.html"), "<!doctype html><title>Source recovery fixture</title>");
    host = fork(fileURLToPath(new URL("./fixtures/account-recovery-host.mjs", import.meta.url)), [f.omp, f.stack, f.config, assets],
      { execPath: process.execPath, execArgv: [], detached: true, env: f.env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let hostError = ""; host.stderr.on("data", bytes => { hostError += bytes; });
    host.closed = once(host, "close").then(([code, signal]) => { children.delete(host); return { code, signal }; }); children.add(host);
    const [ready] = await once(host, "message"); assert.equal(ready.ready, true, hostError);
    await until(() => processIdentity(marker.pid), value => value === null, "source Host confirmed orphan worker exit");
    assert.equal(service.calls.length, received); assert.equal(service.exchanges.length, exchanges);
    await assert.rejects(fetch(`${new URL(providerUrl).searchParams.get("callback_url")}?code=late-after-crash`));
    assert.equal(JSON.parse((await run(["account", "status", account.accountId])).stdout).status, "stored");
    await login(); assert.match((await run(args)).stdout, /controlled identity after recovery/);
    assert.equal(service.calls.length, received + 1); assert.equal(service.calls.at(-1).identity, identity);
    host.send({ type: "stop" }); assert.equal((await host.closed).code, 0);
    await until(() => groupAlive(host.pid), value => !value, "normal source Host exit");
    observations.push({ phase: "OAuth parent crash with live worker", parentPid: authenticating.pid, workerPid: marker.pid,
      useAndMutationsBlocked: 5, recoveryHostPid: host.pid, workerConfirmedExited: true, lateCallbackRejected: true,
      noReceptionDuringRecovery: true, recoveredIdentity: service.calls.at(-1).identity });
  }
  assert.deepEqual(await fs.readFile(path.join(f.config, "auth.json")), originalAuth);
  assert.ok(service.calls.every(call => call.valid && call.identity === identity));
});
