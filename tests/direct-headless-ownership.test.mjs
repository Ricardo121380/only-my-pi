import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { acquireOwnership } from "../packages/host/ownership.mjs";
import { buildDirectPiInvocation } from "../packages/direct-agent/launcher.mjs";

for (const mode of ["absolute", "relative", "prefix", "id", "continue"]) test(`actual print CLI ${mode} refuses an owned session before model input and leaves its file unchanged`, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-headless-owner-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const configRoot = path.join(root, "config"), sessionRoot = path.join(root, "sessions");
  await fs.mkdir(configRoot); await fs.mkdir(sessionRoot);
  const sessionId = "11111111-1111-4111-8111-111111111111", file = path.join(sessionRoot, "fixture.jsonl");
  const contents = JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: root }) + "\n";
  await fs.writeFile(file, contents);
  let requests = 0;
  const server = http.createServer((_req, res) => { requests++; res.writeHead(500); res.end(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await fs.writeFile(path.join(configRoot, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  await fs.writeFile(path.join(configRoot, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", name: "fixture", contextWindow: 32000, maxTokens: 128 }] } } }));
  const owner = await acquireOwnership(configRoot, "session", sessionId);
  try {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "bundle/cli.js");
  await fs.symlink(path.resolve(path.dirname(cli), "../.."), path.join(root, "pi"));
  const extension = fileURLToPath(new URL("../extensions/omp-direct/index.ts", import.meta.url));
  const selection = mode === "absolute" ? ["--session", file]
    : mode === "relative" ? ["--session", "sessions/fixture.jsonl"]
    : mode === "prefix" ? ["--session", "11111111", "--session-dir", sessionRoot]
    : mode === "id" ? ["--session-id", sessionId, "--session-dir", sessionRoot]
    : ["--continue", "--session-dir", sessionRoot];
  const invocation = buildDirectPiInvocation({
    argv: ["--offline", "--print", ...selection, "--model", "fixture/fixture", "must not reach model"],
    stack: { root, nodePath: process.execPath, piCliPath: cli, ompPackageRoot: fileURLToPath(new URL("../", import.meta.url)), stackId: `sha256:${"a".repeat(64)}` },
    extensionPaths: [extension],
    env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: configRoot, PI_SKIP_VERSION_CHECK: "1" },
  });
  let failure;
  try { const launched = promisify(execFile)(invocation.executable, invocation.argv.slice(1), {
    cwd: root, env: invocation.env, timeout: 10000,
  }); launched.child.stdin.end(); await launched; } catch (error) { failure = error; }
  assert.equal(failure?.code, 1, JSON.stringify({ stderr: failure?.stderr, stdout: failure?.stdout, signal: failure?.signal, requests }));
  assert.match(failure.stderr, /SESSION_OWNERSHIP_UNAVAILABLE/);
  assert.equal(requests, 0);
  assert.equal(await fs.readFile(file, "utf8"), contents);
  } finally { await owner.release(); }
});
