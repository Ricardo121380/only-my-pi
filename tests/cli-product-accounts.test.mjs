import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const cli = new URL("../bin/omp.mjs", import.meta.url).pathname;

test("public CLI creates, configures and lists separate product identities without a Host or Pi HOME", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-cli-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const env = { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: path.join(root, "config") };
  const run = async args => JSON.parse((await execFile(process.execPath, [cli, "account", ...args], { env })).stdout);
  const empty = await run(["list"]);
  assert.equal(empty.accounts.length, 1);
  assert.equal(empty.accounts[0].accountId, "cli-readonly");
  assert.equal(empty.accounts[0].source, "original_pi");
  const first = await run(["add", "--provider", "openai", "--name", "First", "--auth", "api_key"]);
  const second = await run(["add", "--provider", "openai", "--name", "Second", "--auth", "oauth"]);
  assert.notEqual(first.accountId, second.accountId);
  assert.deepEqual((await run(["list"])).accounts.slice(1).map(a => a.accountId), [first.accountId, second.accountId]);
  await assert.rejects(fs.access(path.join(env.PI_CODING_AGENT_DIR, "auth.json")), { code: "ENOENT" });
  await assert.rejects(execFile(process.execPath, [cli, "account", "add", "--provider", "openai", "--name", "Bad", "--auth", "api_key", "--key", "argv-must-not-be-accepted"], { env }), error => {
    assert.equal(error.stdout.includes("argv-must-not-be-accepted") || error.stderr.includes("argv-must-not-be-accepted"), false);
    return true;
  });
});
