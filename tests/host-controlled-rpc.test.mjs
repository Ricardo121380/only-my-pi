import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { RpcWorker } from "../packages/host/rpc-worker.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { loadDistribution } from "../packages/distribution/runtime.mjs";

for (const scenario of ["approve", "revoke", "late", "ordinary", "scout", "writer"]) test(`production SDK entry and direct extension: ${scenario}`, { timeout: 30000, skip: ["scout", "writer"].includes(scenario) && !process.env.OMP_TEST_STACK_PACKAGE }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-controlled-rpc-")));
  t.after(() => fs.rm(root, { recursive: true }));
  let call = 0, beforeWrite;
  const received = [], childResults = [];
  const request = { taskSummary: "Write fixture", complexity: "simple", scope: ["proof.txt"], riskFlags: [], verification: ["read proof.txt"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
  const project = scenario === "writer" ? path.join(root, "project") : root;
  if (scenario === "writer") {
    await fs.mkdir(path.join(project, ".pi"), { recursive: true });
    await fs.writeFile(path.join(project, "proof.txt"), "before\n");
    await fs.writeFile(path.join(project, ".pi/only-my-pi-gates.json"), JSON.stringify({ $schema: "project-gates-v1.schema.json", formatVersion: 1, id: "fixture", gates: [{ id: "proof", description: "Check exact fixture bytes", command: "node", args: ["-e", "require('node:assert/strict').equal(require('node:fs').readFileSync('proof.txt','utf8'),'controlled\\n')"], cwd: ".", timeoutSeconds: 10, env: {} }] }));
    for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]]) await promisify(execFile)("git", args, { cwd: project });
    Object.assign(request, { complexity: "complex", plan: "Implement proof.txt in a managed clone; verify exact bytes; fresh review; apply and verify again.", orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: true, useFreshReviewer: true } });
  }
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    received.push({ key: req.headers.authorization, body: JSON.parse(body) });
    const step = call++;
    if (step === 1) await beforeWrite?.();
    let tool = scenario === "scout" ? { name: "delegate_readonly_agent", arguments: JSON.stringify({ agent: "omp-scout", task: "Reply done without tools." }) } : step === 0 ? { name: "request_coding_access", arguments: JSON.stringify(request) } : { name: "write", arguments: JSON.stringify({ path: "proof.txt", content: "controlled\n" }) };
    if (scenario === "writer") {
      if (step === 1) tool = { name: "delegate_managed_writer", arguments: "{}" };
      if (step === 3) tool = { name: "structured_output", arguments: JSON.stringify({ value: { status: "completed", changedPaths: ["proof.txt"], summary: "Updated proof", verification: [], followUp: [] } }) };
      if (step === 4) tool = { name: "structured_output", arguments: JSON.stringify({ value: { verdict: "pass", findings: [], tested: ["fixture bytes"], unverified: [] } }) };
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const toolTurn = step < (scenario === "scout" ? 1 : scenario === "writer" ? 5 : 2);
    const delta = toolTurn ? { role: "assistant", tool_calls: [{ index: 0, id: `tool-${step}`, type: "function", function: tool }] } : { role: "assistant", content: "done" };
    for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: toolTurn ? "tool_calls" : "stop" }]) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }, choices: [{ index: 0, ...choice }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await fs.symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))), path.join(root, "pi"));
  const extension = path.join(root, "fixture.mjs");
  await fs.writeFile(extension, 'export default function(pi) { pi.registerFlag("perm", {description:"Fixture", type:"string"}); }');
  const catalog = new AccountCatalog(root), account = await catalog.create({ providerId: "fixture", name: "Fixture", authType: "api_key" });
  const installedStack = process.env.OMP_TEST_STACK_PACKAGE ? await loadDistribution({ packageRoot: process.env.OMP_TEST_STACK_PACKAGE }) : null;
  if (process.env.OMP_TEST_STACK_PACKAGE) assert.ok(installedStack);
  const paths = await catalog.runtimePaths(account.accountId);
  await fs.writeFile(paths.authPath, JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  await fs.writeFile(paths.modelsPath, JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 128 }] } } }));
  const worker = new RpcWorker({ stack: installedStack ?? { root, nodePath: process.execPath, piCliPath: "unused", stackId: `sha256:${"a".repeat(64)}` }, configRoot: root, cwd: project, model: "fixture/fixture", accountId: account.accountId, controlled: scenario !== "ordinary", sessionRoot: path.join(root, "sessions"), env: { PATH: process.env.PATH }, ...(installedStack ? {} : { extensionResolver: async () => ({ extensions: [extension, fileURLToPath(new URL("../extensions/omp-direct/index.ts", import.meta.url))] }) }) });
  t.after(() => worker.stop());
  const errors = [], answers = [];
  let answerWork = Promise.resolve();
  worker.on("event", (event) => { if (event.type === "extension_error") errors.push(event); if (event.type === "tool_execution_end" && ["delegate_readonly_agent", "delegate_managed_writer"].includes(event.toolName)) childResults.push(event.result); });
  worker.on("approvals", (values) => {
    if (!values.length) return;
    const approval = values[0]; answers.push(approval);
    answerWork = (async () => {
      if (scenario === "late") {
        await worker.revoke();
        assert.throws(() => worker.answerApproval(approval.approvalId, approval.options[0]), { code: "APPROVAL_EXPIRED" });
      } else worker.answerApproval(approval.approvalId, approval.kind === "confirm" ? true : approval.options[0]);
    })();
  });
  if (scenario === "revoke") beforeWrite = () => worker.revoke();
  await worker.start();
  const settled = new Promise((resolve) => worker.on("event", (e) => { if (e.type === "agent_settled") resolve(); }));
  await worker.command("prompt", { message: "Write the fixture after approval." }); await settled; await answerWork;
  await worker.stop();
  assert.deepEqual(errors, []);
  if (scenario === "writer") {
    assert.equal(childResults[0]?.details?.status, "WRITER_PATCH_VERIFIED", JSON.stringify(childResults));
    assert.equal(childResults[0].details.verificationReceipt.status, "PASS");
    assert.equal(childResults[0].details.realVerificationReceipt.phase, "real-workspace");
    assert.equal(childResults[0].details.realVerificationReceipt.status, "PASS");
    assert.equal(received.length, 6, "parent, writer, fresh reviewer and continuation complete without a retry");
    assert.equal(answers.length, 3, "coding, clone verification, and real-worktree verification need separate approvals");
    assert.equal(await fs.readFile(path.join(project, "proof.txt"), "utf8"), "controlled\n");
    assert.ok(received.every((r) => r.key === "Bearer fixture"));
    return;
  }
  assert.equal(answers.length, ["ordinary", "scout"].includes(scenario) ? 0 : 1);
  if (scenario === "scout") {
    assert.equal(childResults[0]?.details?.status, "DIRECT_CHILD_COMPLETED", JSON.stringify(childResults));
    assert.equal(received.length, 3, "parent, real child, then parent continuation must reach the model");
    assert.ok(received.every((r) => r.key === "Bearer fixture"));
  }
  if (scenario === "approve") assert.equal(await fs.readFile(path.join(root, "proof.txt"), "utf8"), "controlled\n");
  else await assert.rejects(fs.access(path.join(root, "proof.txt")), { code: "ENOENT" });
});
