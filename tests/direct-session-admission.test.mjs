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
import { acquireExplicitSession } from "../packages/direct-agent/session-admission.mjs";

async function fixture(t, version = 3) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-admission-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, "config"), file = path.join(root, "session.jsonl");
  await fs.mkdir(config);
  const id = "11111111-1111-4111-8111-111111111111";
  const contents = JSON.stringify({ type: "session", version, id, cwd: root, timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(file, contents);
  return { root, config, file, id, contents };
}

async function permissionFlags(root) {
  const file = path.join(root, "permission-flags.ts");
  await fs.writeFile(file, 'export default pi => pi.registerFlag("perm", { type: "string" });');
  return file;
}

test("admission keeps the shared lock until explicit release", async (t) => {
  const f = await fixture(t);
  const lease = await acquireExplicitSession(f.config, f.file);
  try {
    assert.equal(lease.id, f.id);
    await assert.rejects(acquireOwnership(f.config, "session", f.id), { code: "OWNERSHIP_HELD" });
    assert.equal(await fs.readFile(f.file, "utf8"), f.contents);
  } finally { await lease.release(); }
  const next = await acquireOwnership(f.config, "session", f.id); await next.release();
});

test("concurrent admissions have exactly one winner", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([acquireExplicitSession(f.config, f.file), acquireExplicitSession(f.config, f.file)]);
  try { assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); }
  finally { for (const r of results) if (r.status === "fulfilled") await r.value.release(); }
});

test("invalid headers and hard links are refused without modifying history", async (t) => {
  const f = await fixture(t);
  await fs.link(f.file, path.join(f.root, "alias.jsonl"));
  await assert.rejects(acquireExplicitSession(f.config, f.file), { code: "SESSION_TARGET_INVALID" });
  await fs.unlink(path.join(f.root, "alias.jsonl"));
  await fs.writeFile(f.file, "invalid\n");
  await assert.rejects(acquireExplicitSession(f.config, f.file), { code: "SESSION_HEADER_INVALID" });
  assert.equal(await fs.readFile(f.file, "utf8"), "invalid\n");
});

for (const version of [1, 3]) test(`real admission entry refuses occupied v${version} before migration or metadata writes`, async (t) => {
  const f = await fixture(t, version);
  const owner = await acquireOwnership(f.config, "session", f.id);
  try {
  const entry = fileURLToPath(new URL("../packages/direct-agent/admission-probe.mjs", import.meta.url));
  const launched = promisify(execFile)(process.execPath, [entry, f.file, "fixture/fixture", "must not run"], {
    cwd: f.root, env: { PATH: process.env.PATH, HOME: f.root, PI_CODING_AGENT_DIR: f.config }, timeout: 10000,
  });
  launched.child.stdin.end();
  await assert.rejects(launched, (error) => error.code === 1 && /SESSION_OWNERSHIP_UNAVAILABLE/.test(error.stderr));
  assert.equal(await fs.readFile(f.file, "utf8"), f.contents);
  } finally { await owner.release(); }
});

for (const mode of ["probe", "direct", "json", "text", "relative", "id", "continue", "new-id", "fork"]) test(`real Pi ${mode} print runs while admission is held and releases after normal completion`, async (t) => {
  const f = await fixture(t);
  const createsTarget = mode === "new-id" || mode === "fork";
  const flags = await permissionFlags(f.root);
  const expectedId = createsTarget ? "new-reserved" : f.id;
  let requests = 0, lockObserved = false;
  const server = http.createServer(async (_req, res) => {
    requests++;
    try { const lease = await acquireOwnership(f.config, "session", expectedId); await lease.release(); }
    catch (error) { lockObserved = error.code === "OWNERSHIP_HELD"; }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end('data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await fs.writeFile(path.join(f.config, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  await fs.writeFile(path.join(f.config, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", name: "fixture", contextWindow: 32000, maxTokens: 128 }] } } }));
  const entry = fileURLToPath(new URL(`../packages/direct-agent/${mode === "probe" ? "admission-probe" : "session-entry"}.mjs`, import.meta.url));
  const selection = mode === "relative" ? ["--session", "session.jsonl"]
    : mode === "fork" ? ["--fork", f.file, "--session-id", expectedId, "--session-dir", f.root]
    : mode === "id" || mode === "new-id" ? ["--session-id", expectedId, "--session-dir", f.root]
    : mode === "continue" ? ["-c", "--session-dir", f.root] : ["--session", f.file];
  const args = mode === "probe" ? [entry, f.file, "fixture/fixture", "respond ok"] : [entry,
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    "--offline", "--no-extensions", "--extension", flags, "--extension", fileURLToPath(new URL("../extensions/omp-direct/index.ts", import.meta.url)),
    "--extension", fileURLToPath(new URL("../extensions/context-doctor/index.ts", import.meta.url)),
    "--tools", "read,grep,find,ls,context_snapshot", "--perm", "plan", ...(mode === "json" ? ["--mode", "json"] : mode === "text" ? ["--print", "--mode", "text"] : ["--print"]), ...selection, "--model", "fixture/fixture", "respond ok"];
  const launched = promisify(execFile)(process.execPath, args, {
    cwd: f.root, env: { PATH: process.env.PATH, HOME: f.root, PI_CODING_AGENT_DIR: f.config, PI_SKIP_VERSION_CHECK: "1", ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "1", ONLY_MY_PI_MODEL_EXPLICIT: "1" }, timeout: 15000,
  });
  launched.child.stdin.end();
  const result = await launched;
  assert.match(result.stdout, /ok/);
  assert.equal(requests, 1); assert.equal(lockObserved, true);
  const outputFile = createsTarget ? path.join(f.root, (await fs.readdir(f.root)).find((name) => name.endsWith(`_${expectedId}.jsonl`))) : f.file;
  assert.match(await fs.readFile(outputFile, "utf8"), /model_change/);
  if (createsTarget) assert.equal(await fs.readFile(f.file, "utf8"), f.contents);
  const next = await acquireOwnership(f.config, "session", expectedId); await next.release();
});

test("Pi hard startup exit retains its lease for reconciliation", async (t) => {
  const f = await fixture(t);
  const entry = fileURLToPath(new URL("../packages/direct-agent/session-entry.mjs", import.meta.url));
  // The public SDK now reports missing models by throwing rather than exiting
  // inside main(). Inject a genuine hard exit in Pi's extension loader instead:
  // admission must already be held, and no finally block may release it.
  const extension = path.join(f.root, "hard-exit.ts");
  await fs.writeFile(extension, 'export default function () { process.stderr.write("fixture model not found\\n"); process.exit(1); }');
  const launched = promisify(execFile)(process.execPath, [entry,
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    "--offline", "--no-extensions", "--extension", extension, "--tools", "read,grep,find,ls", "--perm", "plan",
    "--print", "--session", f.file, "--model", "nonexistent/model", "must not run"], {
    cwd: f.root, env: { PATH: process.env.PATH, HOME: f.root, PI_CODING_AGENT_DIR: f.config, PI_SKIP_VERSION_CHECK: "1" }, timeout: 10000,
  });
  launched.child.stdin.end();
  await assert.rejects(launched, (error) => error.code === 1 && /No models available|No models found|not found/i.test(error.stderr));
  await assert.rejects(acquireOwnership(f.config, "session", f.id), { code: "OWNER_RECONCILIATION_REQUIRED" });
});

test("real resume entry with piped input fails before changing history or reserving a session", async (t) => {
  const f = await fixture(t, 1);
  const entry = fileURLToPath(new URL("../packages/direct-agent/session-entry.mjs", import.meta.url));
  const launched = promisify(execFile)(process.execPath, [entry,
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    "--offline", "--no-extensions", "--extension", fileURLToPath(new URL("../extensions/omp-direct/index.ts", import.meta.url)),
    "--tools", "read,grep,find,ls", "--perm", "plan", "--print", "--resume", "--session-dir", f.root], {
    cwd: f.root, env: { PATH: process.env.PATH, HOME: f.root, PI_CODING_AGENT_DIR: f.config }, timeout: 10000,
  });
  launched.child.stdin.end();
  await assert.rejects(launched, (error) => error.code === 1 && /SESSION_PICKER_TTY_REQUIRED/.test(error.stderr));
  assert.equal(await fs.readFile(f.file, "utf8"), f.contents);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ["config", "session.jsonl"]);
  const next = await acquireOwnership(f.config, "session", f.id); await next.release();
});

test("controlled print rejects a missing explicit model without falling back or changing history", async t => {
  const f = await fixture(t);
  const flags = await permissionFlags(f.root);
  const entry = fileURLToPath(new URL("../packages/direct-agent/session-entry.mjs", import.meta.url));
  const launched = promisify(execFile)(process.execPath, [entry,
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    "--offline", "--no-extensions", "--extension", flags, "--extension", fileURLToPath(new URL("../extensions/omp-direct/index.ts", import.meta.url)),
    "--tools", "read,grep,find,ls", "--perm", "plan", "--print", "--session", f.file, "--model", "nonexistent/model", "must not run"], {
    cwd: f.root, env: { PATH: process.env.PATH, HOME: f.root, PI_CODING_AGENT_DIR: f.config }, timeout: 10000,
  });
  launched.child.stdin.end();
  await assert.rejects(launched, error => error.code === 1 && /TUI_MODEL_NOT_FOUND/.test(error.stderr));
  assert.equal(await fs.readFile(f.file, "utf8"), f.contents);
  const next = await acquireOwnership(f.config, "session", f.id); await next.release();
});
