// Manual PTY acceptance: node tests/fixtures/direct-resume-pty.mjs select|cancel|occupied
// Enter selects the sole fixture; Escape cancels. Uses only a local model server.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireOwnership } from "../../packages/host/ownership.mjs";

const mode = process.argv[2];
assert.ok(["select", "cancel", "occupied"].includes(mode));
assert.ok(process.stdin.isTTY && process.stdout.isTTY);
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-resume-pty-")));
const config = path.join(root, "config"), file = path.join(root, "fixture.jsonl"), id = "resume-pty";
const contents = JSON.stringify({ type: "session", version: 1, id, cwd: root, timestamp: new Date().toISOString() }) + "\n";
let owner, requests = 0, lockObserved = false;
const server = http.createServer(async (_req, res) => {
  requests++;
  try { const lease = await acquireOwnership(config, "session", id); await lease.release(); }
  catch (error) { lockObserved = error.code === "OWNERSHIP_HELD"; }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end('data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
try {
  await fs.mkdir(config);
  await fs.writeFile(file, contents);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await fs.writeFile(path.join(config, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  await fs.writeFile(path.join(config, "models.json"), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions",
    models: [{ id: "fixture", name: "fixture", contextWindow: 32000, maxTokens: 128 }],
  } } }));
  if (mode === "occupied") owner = await acquireOwnership(config, "session", id);
  const sdkFile = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  // The first-party SDK entry is tested here; full installed extension loading
  // (including the extension-owned --perm flag) is a separate candidate gate.
  const args = [fileURLToPath(new URL("../../packages/direct-agent/session-entry.mjs", import.meta.url)), sdkFile,
    "--offline", "--no-extensions", "--extension", fileURLToPath(new URL("../../extensions/omp-direct/index.ts", import.meta.url)),
    "--tools", "read,grep,find,ls", "-p", "--resume", "--session-dir", root, "--model", "fixture/fixture", "respond ok"];
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit",
    env: { PATH: process.env.PATH, HOME: root, TERM: process.env.TERM ?? "xterm-256color",
      PI_CODING_AGENT_DIR: config, PI_SKIP_VERSION_CHECK: "1", ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "1", ONLY_MY_PI_MODEL_EXPLICIT: "1" } });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, mode === "occupied" ? 1 : 0);
  assert.equal(requests, mode === "select" ? 1 : 0);
  if (mode === "select") {
    assert.equal(lockObserved, true);
    assert.match(await fs.readFile(file, "utf8"), /model_change/);
  } else assert.equal(await fs.readFile(file, "utf8"), contents);
  await owner?.release(); owner = undefined;
  const next = await acquireOwnership(config, "session", id); await next.release();
  process.stdout.write(`\nPTY_${mode.toUpperCase()}_PASS requests=${requests}\n`);
} finally {
  await owner?.release();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
