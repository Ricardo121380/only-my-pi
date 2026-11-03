import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { runOmpEntrypoint } from "../bin/omp.mjs";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";

test("public account entry uses injected stdin, keeps secrets out of output and releases input ownership", { timeout: 30000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-entry-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const f = await createPi110SourceCli(root, { baseUrl: "http://127.0.0.1:1/v1" });
  const original = await fs.readFile(path.join(f.config, "auth.json"));
  const invoke = async (args, input = Readable.from([])) => {
    let stdout = "", stderr = "";
    const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const code = await runOmpEntrypoint({ argv: ["account", ...args], rootDir: f.omp, stackRoot: f.stack,
      env: f.cliEnv, homedir: () => f.home, stdin: input,
      stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } });
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], signals);
    assert.equal(input.listenerCount("data"), 0);
    return { code, stdout, stderr };
  };
  const account = JSON.parse((await invoke(["add", "--provider", "openai", "--name", "Injected input", "--auth", "api_key"])).stdout);
  const secret = "synthetic-entry-key-must-not-echo";
  const login = await invoke(["login", account.accountId, "--stdin", "--timeout-ms", "5000"], Readable.from([`${secret}\n`]));
  assert.equal(login.code, 0, login.stderr);
  assert.equal(JSON.parse(login.stdout).status, "stored");
  assert.equal((login.stdout + login.stderr).includes(secret), false);
  assert.equal(JSON.parse((await invoke(["status", account.accountId])).stdout).status, "stored");
  const missing = await invoke(["login", account.accountId, "--stdin"]);
  assert.equal(missing.code, 1); assert.match(missing.stderr, /ACCOUNT_INPUT_INVALID/);
  const nonTerminal = await invoke(["login", account.accountId]);
  assert.equal(nonTerminal.code, 1); assert.match(nonTerminal.stderr, /ACCOUNT_SECRET_TTY_OR_STDIN_REQUIRED/);
  assert.equal((await invoke(["rename", account.accountId, "Released"])).code, 0);
  assert.deepEqual(await fs.readFile(path.join(f.config, "auth.json")), original);
});
