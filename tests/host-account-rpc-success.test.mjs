import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { RpcWorker } from "../packages/host/rpc-worker.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { loadDistribution } from "../packages/distribution/runtime.mjs";
import { listModels } from "../packages/host/models.mjs";
import { usesNativePiTools } from "../packages/upstream-compatibility/native-pi.mjs";

test("real account RPC requests keep two stored identities and readonly tool registry", { timeout: 30000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-rpc-accounts-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const received = [];
  let rejectAuth = false;
  let requestWrite = false;
  let requestCodemodeWrite = false;
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    received.push({ key: req.headers.authorization, body: JSON.parse(body) });
    if (rejectAuth) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "fixture credential revoked", type: "authentication_error" } })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const target = path.join(root, "forbidden.txt");
    const choices = requestWrite || requestCodemodeWrite ? [
      { delta: { role: "assistant", tool_calls: [{ index: 0, id: requestCodemodeWrite ? "codemode-write-attempt" : "write-attempt", type: "function", function: { name: requestCodemodeWrite ? "codemode" : "write", arguments: JSON.stringify(requestCodemodeWrite ? { code: `await tools.write(${JSON.stringify({ path: target, content: "must not exist" })});` } : { path: target, content: "must not exist" }) } }] }, finish_reason: null },
      { delta: {}, finish_reason: "tool_calls" },
    ] : [{ delta: { role: "assistant", content: "fixture done" }, finish_reason: null }, { delta: {}, finish_reason: "stop" }];
    requestWrite = false;
    requestCodemodeWrite = false;
    for (const choice of choices) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30 } } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await fs.symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))), path.join(root, "pi"));
  const extension = path.join(root, "fixture.mjs");
  await fs.writeFile(extension, 'export default function(pi) { pi.registerFlag("perm", {description:"Fixture flag", type:"string"}); }');
  const catalog = new AccountCatalog(root);
  const installedStack = process.env.OMP_TEST_STACK_PACKAGE ? await loadDistribution({ packageRoot: process.env.OMP_TEST_STACK_PACKAGE }) : null;
  if (process.env.OMP_TEST_STACK_PACKAGE) assert.ok(installedStack, "explicit installed stack must resolve");
  const nativeCodemode = installedStack && usesNativePiTools(JSON.parse(await fs.readFile(path.join(installedStack.root, "pi/package.json"), "utf8")).version);
  for (const key of ["fixture-a", "fixture-b", "fixture-cli", "fixture-cli-configured"]) {
    const configuredKey = key === "fixture-cli-configured", cli = key.startsWith("fixture-cli");
    const account = cli ? { accountId: "cli-readonly" } : await catalog.create({ providerId: "fixture", name: key, authType: "api_key" });
    const paths = cli ? { authPath: path.join(root, "auth.json"), modelsPath: path.join(root, "models.json") } : await catalog.runtimePaths(account.accountId);
    const auth = JSON.stringify(configuredKey ? {} : { fixture: { type: "api_key", key } });
    await fs.writeFile(paths.authPath, auth);
    const models = JSON.stringify({ providers: { fixture: { ...(configuredKey ? { apiKey: key } : {}), baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", name: "Fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }] } } });
    await fs.writeFile(paths.modelsPath, models);
    const workerOptions = { stack: installedStack ?? { root, nodePath: process.execPath, piCliPath: "unused", stackId: `sha256:${"a".repeat(64)}` }, configRoot: root, cwd: root, model: "fixture/fixture", accountId: account.accountId, sessionRoot: path.join(root, "sessions"), env: { PATH: process.env.PATH }, ...(installedStack ? {} : { extensionResolver: async () => ({ extensions: [extension] }) }) };
    const worker = new RpcWorker(workerOptions);
    const extensionErrors = [];
    worker.on("event", (event) => { if (event.type === "extension_error") extensionErrors.push(event.code ?? event.event ?? "extension_error"); });
    t.after(() => worker.stop());
    const state = await worker.start(); assert.equal(state.model.provider, "fixture");
    if (key === "fixture-a") {
      const catalogModels = await listModels({ stack: workerOptions.stack, configRoot: root, accountId: account.accountId, env: { PATH: process.env.PATH } });
      assert.ok(catalogModels.find((m) => m.id === "fixture/fixture").thinkingLevels.includes("low"));
      await worker.command("set_thinking_level", { level: "low" });
      assert.equal((await worker.command("get_state")).thinkingLevel, "low", "RPC must report the applied thinking level");
    }
    const prompt = async () => {
      const messages = [];
      let onEvent;
      const settled = new Promise((resolve) => {
        onEvent = (event) => { if (event.type === "message_end") messages.push(event.message); if (event.type === "agent_settled") resolve(); };
        worker.on("event", onEvent);
      });
      try { await worker.command("prompt", { message: "Say done" }); await settled; return messages; }
      finally { worker.off("event", onEvent); }
    };
    const first = (await prompt()).find((m) => m.role === "assistant" && m.stopReason === "stop");
    assert.ok(first);
    assert.equal(first.usage.totalTokens, 120);
    assert.equal(first.usage.output, 20);
    assert.equal(first.usage.cacheRead, 30);
    if (key === "fixture-a") assert.equal(received.at(-1).body.reasoning_effort, "low", "Provider must receive the selected effort");
    rejectAuth = true;
    const denied = await prompt();
    assert.ok(denied.some((m) => m.role === "assistant" && m.stopReason === "error"));
    rejectAuth = false;
    requestWrite = true;
    const writeAttempt = await prompt();
    assert.ok(writeAttempt.some((m) => m.role === "toolResult" && m.isError === true));
    await assert.rejects(fs.access(path.join(root, "forbidden.txt")), { code: "ENOENT" });
    if (nativeCodemode && key === "fixture-a") {
      requestCodemodeWrite = true;
      const nestedWrite = await prompt();
      assert.ok(nestedWrite.some((m) => m.role === "toolResult" && m.toolName === "codemode" && m.isError === true), "the native wrapper must not grant readonly accounts a nested write");
      await assert.rejects(fs.access(path.join(root, "forbidden.txt")), { code: "ENOENT" });
    }
    const beforeRemoval = received.length;
    if (!configuredKey) {
      await fs.unlink(paths.authPath);
      const removed = await prompt();
      assert.ok(removed.some((m) => m.role === "assistant" && m.stopReason === "error"));
      assert.equal(received.length, beforeRemoval, "removed credentials must prevent another HTTP request");
    } else {
      assert.equal(await fs.readFile(paths.authPath, "utf8"), auth, "CLI static key is never copied to auth storage");
      assert.equal(await fs.readFile(paths.modelsPath, "utf8"), models);
    }
    await worker.stop();
    assert.deepEqual(extensionErrors, [], "every audited extension must initialize, not just the model stream");
    const files = await fs.readdir(path.join(root, "sessions"));
    const session = files.find((file) => file.endsWith(`${state.sessionId}.jsonl`));
    assert.ok(session, "the bound session must be persisted");
    const entries = (await fs.readFile(path.join(root, "sessions", session), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(entries.some((entry) => entry.customType === "omp-account-binding" && entry.data.accountId === account.accountId));
    await fs.writeFile(paths.authPath, auth);
    const resumed = new RpcWorker({ ...workerOptions, resumeFile: path.join(root, "sessions", session) });
    t.after(() => resumed.stop());
    const resumedState = await resumed.start();
    assert.equal(resumedState.sessionId, state.sessionId);
    if (key === "fixture-a") assert.equal(resumedState.thinkingLevel, "low", "resume keeps transcript thinking without changing global defaults");
    const resumedDone = new Promise((resolve) => resumed.on("event", (event) => { if (event.type === "agent_settled") resolve(); }));
    await resumed.command("prompt", { message: "Continue the stopped fixture session" }); await resumedDone; await resumed.stop();
    assert.ok(received.at(-1).body.messages.some((message) => message.role === "assistant" && JSON.stringify(message.content).includes("fixture done")), "the real SDK must load prior history, not silently create a new session");
    if (configuredKey) {
      await fs.writeFile(paths.modelsPath, models.replace(`"apiKey":"${key}",`, ""));
      const removed = new RpcWorker(workerOptions); t.after(() => removed.stop());
      const count = received.length;
      await assert.rejects(removed.start()); await removed.stop();
      assert.equal(received.length, count, "new worker must reject removed configured identity");
    }
  }
  assert.deepEqual(received.map((r) => r.key), ["fixture-a", "fixture-b", "fixture-cli", "fixture-cli-configured"].flatMap((key) => Array(nativeCodemode && key === "fixture-a" ? 7 : 5).fill(`Bearer ${key}`)));
  for (const request of received) {
    const tools = request.body.tools.map((tool) => tool.function.name).sort();
    assert.deepEqual(tools, nativeCodemode ? ["codemode", "find", "grep", "ls", "read"] : ["find", "grep", "ls", "read"]);
  }
});
