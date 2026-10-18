import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { AccountCatalog } from "../packages/host/accounts.mjs";

test("JSON print child uses its bound account, tool ceiling and prompt files, never CLI auth", { timeout: 20000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-account-child-")));
  t.after(() => fs.rm(root, { recursive: true }));
  await fs.symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))), path.join(root, "pi"));
  const received = [];
  const server = http.createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    received.push({ key: req.headers.authorization, body: JSON.parse(text) });
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of [{ delta: { role: "assistant", content: "done" }, finish_reason: null }, { delta: {}, finish_reason: "stop" }]) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const cli = JSON.stringify({ fixture: { type: "api_key", key: "cli-sentinel" } });
  await fs.writeFile(path.join(root, "auth.json"), cli);
  const catalog = new AccountCatalog(root);
  const promptFile = path.join(root, "task.md"); await fs.writeFile(promptFile, "Task: child prompt fixture");
  const moduleUrl = new URL("../packages/host/account-child.mjs", import.meta.url).href;
  const launch = (accountId, argv) => promisify(execFile)(process.execPath, ["--input-type=module", "-e", `import {runAccountChild} from ${JSON.stringify(moduleUrl)}; process.exitCode=await runAccountChild(${JSON.stringify({ stack: { root }, configRoot: root, accountId, argv, cwd: root })});`], { env: { PATH: process.env.PATH }, timeout: 10000, maxBuffer: 1024 * 1024 });
  for (const key of ["child-a", "child-b"]) {
    const account = await catalog.create({ providerId: "fixture", name: key, authType: "api_key" });
    const paths = await catalog.runtimePaths(account.accountId);
    await fs.writeFile(paths.authPath, JSON.stringify({ fixture: { type: "api_key", key } }));
    await fs.writeFile(paths.modelsPath, JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", contextWindow: 32000, maxTokens: 128 }] } } }));
    const argv = ["--mode", "json", "-p", "--no-session", "--model", "fixture/fixture:off", "--no-extensions", "--no-skills", "--no-context-files", "--tools", "read", `@${promptFile}`];
    const result = await launch(account.accountId, argv);
    assert.ok(result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).some((e) => e.type === "message_end" && e.message.role === "assistant"));
    await fs.unlink(paths.authPath);
    await assert.rejects(launch(account.accountId, argv));
    await assert.rejects(launch(account.accountId, ["--mode", "rpc"]));
  }
  assert.deepEqual(received.map((r) => r.key), ["Bearer child-a", "Bearer child-b"]);
  for (const request of received) {
    assert.deepEqual(request.body.tools.map((t) => t.function.name), ["read"]);
    assert.ok(JSON.stringify(request.body.messages).includes("Task: child prompt fixture"));
  }
  assert.equal(await fs.readFile(path.join(root, "auth.json"), "utf8"), cli);
  await fs.writeFile(path.join(root, "auth.json"), "{}");
  const cliModels = JSON.stringify({ providers: { fixture: { apiKey: "child-cli-configured", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", contextWindow: 32000, maxTokens: 128 }] } } });
  await fs.writeFile(path.join(root, "models.json"), cliModels);
  await launch("cli-readonly", ["--mode", "json", "-p", "--no-session", "--model", "fixture/fixture", "--no-extensions", "--no-skills", "--no-context-files", "--tools", "read", "Say done"]);
  assert.equal(received.at(-1).key, `Bearer ${JSON.parse(cliModels).providers.fixture.apiKey}`);
  assert.equal(await fs.readFile(path.join(root, "auth.json"), "utf8"), "{}");
  await fs.writeFile(path.join(root, "models.json"), cliModels.replace('"apiKey":"child-cli-configured",', ""));
  const count = received.length;
  await assert.rejects(launch("cli-readonly", ["--mode", "json", "-p", "--no-session", "--model", "fixture/fixture", "--no-extensions", "--no-tools", "Say done"]));
  assert.equal(received.length, count);
});
