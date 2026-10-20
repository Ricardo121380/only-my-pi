import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";

test("formal CLI sets up API key accounts from an empty product catalog and real Pi uses only the explicitly selected identity", { timeout: 60000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-pi-")));
  const received = [];
  const exits = [];
  let f;
  const server = http.createServer(async (req, res) => {
    let bytes = ""; for await (const chunk of req) bytes += chunk;
    received.push({ authorization: req.headers.authorization, body: JSON.parse(bytes) });
    if (!["Bearer controlled-First", "Bearer controlled-Second"].includes(req.headers.authorization)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `invalid credential ${req.headers.authorization}` } })); return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of [{ delta: { role: "assistant", content: "controlled account completed" }, finish_reason: null }, { delta: {}, finish_reason: "stop" }])
      res.write(`data: ${JSON.stringify({ id: "controlled", choices: [{ index: 0, ...choice }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (f) await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01A_SOURCE_API_KEY_LOCAL_ONLY", bindings: f.bindings, received, exits });
    await fs.rm(root, { recursive: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  f = await createPi110SourceCli(root, { baseUrl });
  const originalAuth = await fs.readFile(path.join(f.config, "auth.json"));
  const run = async (args, input = "", expected = 0) => {
    const child = spawn(process.execPath, [f.cli, ...args], { cwd: f.project, env: { ...f.env, OPENAI_API_KEY: "ambient-must-not-be-used" }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += chunk; }); child.stderr.on("data", chunk => { err += chunk; });
    const closed = once(child, "close"); child.stdin.end(input);
    const [code] = await closed;
    exits.push({ args, code, expected, out, err });
    assert.equal(code, expected, `${args[0]}: ${out}\n${err}`);
    return { out, err };
  };
  const accounts = [];
  const configFile = path.join(root, "provider.json");
  await fs.writeFile(configFile, JSON.stringify({ baseUrl, api: "openai-completions", models: [{ id: "one", name: "Controlled", contextWindow: 32000, maxTokens: 128 }] }));
  for (const name of ["First", "Second"]) {
    const account = JSON.parse((await run(["account", "add", "--provider", "fixture", "--name", name, "--auth", "api_key"])).out);
    accounts.push(account);
    await run(["account", "configure", account.accountId, configFile]);
    const login = await run(["account", "login", account.accountId, "--stdin"], `controlled-${name}\n`);
    assert.equal(JSON.parse(login.out).status, "stored");
    assert.equal((login.out + login.err).includes(`controlled-${name}`), false);
    assert.equal(JSON.parse((await run(["account", "status", account.accountId])).out).status, "stored");
    const before = received.length;
    const result = await run(["--account", account.accountId, "--model", "fixture/one", "-p", "inspect fixture"]);
    assert.match(result.out, /controlled account completed/);
    assert.equal(received.length, before + 1);
    assert.equal(received.at(-1).authorization, `Bearer controlled-${name}`);
    assert.equal(JSON.stringify(received.at(-1).body).includes(`controlled-${name}`), false);
    assert.ok(!received.at(-1).body.tools.some(tool => ["write", "edit", "bash"].includes(tool.function.name)), "login does not authorize coding");
  }
  const before = received.length;
  await run(["--account", "00000000-0000-4000-8000-000000000000", "--model", "fixture/one", "-p", "reject"], "", 1);
  await run(["--account", accounts[0].accountId, "--model", "other/wrong", "-p", "reject"], "", 1);
  for (const model of ["fixture/not-configured", "fixture/on"]) {
    const denied = await run(["--account", accounts[0].accountId, "--model", model, "-p", "reject undeclared model"], "", 1);
    assert.match(denied.err, /ACCOUNT_MODEL_NOT_FOUND/);
    assert.equal(received.length, before, "unknown and fuzzy model IDs must be rejected before a physical request");
  }
  const invalidKey = "controlled-invalid-key-must-stay-private";
  await run(["account", "login", accounts[0].accountId, "--stdin"], `${invalidKey}\n`);
  const invalid = await run(["--account", accounts[0].accountId, "--model", "fixture/one", "-p", "reject invalid identity"], "", 1);
  assert.equal(received.length, before + 1, "invalid credentials do not trigger account fallback or automatic retries");
  assert.equal((invalid.out + invalid.err).includes(invalidKey), false, "provider errors cannot echo credentials into terminal logs");
  await run(["account", "logout", accounts[0].accountId]);
  await run(["--account", accounts[0].accountId, "--model", "fixture/one", "-p", "reject"], "", 1);
  assert.equal(received.length, before + 1, "wrong or missing identity never falls back to original Pi or environment credentials");
  assert.deepEqual(await fs.readFile(path.join(f.config, "auth.json")), originalAuth);
  const sessionFiles = (await fs.readdir(path.join(f.config, "sessions"), { recursive: true })).filter(file => file.endsWith(".jsonl"));
  const history = (await Promise.all(sessionFiles.map(file => fs.readFile(path.join(f.config, "sessions", file), "utf8")))).join("\n");
  for (const account of accounts) assert.ok(history.includes(account.accountId));
  assert.equal(history.includes("controlled-First") || history.includes("controlled-Second") || history.includes(invalidKey), false);
  const productHistory = (await Promise.all(sessionFiles.map(async file => ({ file: path.join(f.config, "sessions", file), text: await fs.readFile(path.join(f.config, "sessions", file), "utf8") })))).find(item => item.text.includes(accounts[0].accountId));
  const implicit = await run(["--session", productHistory.file, "--model", "fixture/one", "-p", "reject implicit account change"], "", 1);
  assert.match(implicit.err, /ACCOUNT_SELECTION_REQUIRED/);
  assert.equal(received.length, before + 1, "resuming product-account history cannot silently use the original CLI identity");
});
