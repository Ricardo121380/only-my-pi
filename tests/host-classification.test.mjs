import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClassificationHost } from "./fixtures/classification-host.mjs";
import { until } from "./fixtures/mcp-host.mjs";
const terminal = task => ["succeeded", "failed", "cancelled", "interrupted"].includes(task.status);

test("public configuration fixes a separate classifier account for native Pi and delivers a sourced result", { timeout: 45000 }, async t => {
  const f = await createClassificationHost(); t.after(() => f.close());
  await f.configure();
  const catalog = await f.api(`/api/models?accountId=${f.account.accountId}&type=classifier`);
  assert.deepEqual(catalog.models.map(model => model.id), ["fixtureclass/sentiment"]);
  await f.select();
  assert.equal((await f.calls()).config.classifier.accountId, f.account.accountId);
  const start = await f.start();
  const waiting = await until(() => f.task(start.taskId), task => task.approvals.length || terminal(task), "classification authorization", 15000);
  assert.ok(waiting.approvals.length, JSON.stringify(waiting));
  assert.match(waiting.approvals[0].title, /分类.*费用上限未知/s);
  assert.equal(f.received.length, 0);
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务，按其他额度运行" });
  const done = await until(() => f.task(start.taskId), terminal, "classification result");
  assert.equal(f.received.length, 1, JSON.stringify(done));
  assert.equal(f.received[0].key, "Bearer class-fixture-a");
  assert.equal(f.received[0].body.model, "sentiment");
  assert.equal(f.received[0].body.state.text, "A helpful example");
  const ledger = (await f.calls()).tasks.find(task => task.taskId === start.taskId);
  assert.equal(ledger.requests.length, 1);
  assert.equal(ledger.requests[0].status, "completed");
  assert.equal(f.received[0].requestId, ledger.requests[0].requestId);
  assert.equal(ledger.requests[0].result.answers.sentiment.choice, "positive");
  assert.equal(ledger.requests[0].usage.tokens.input, 12);
  assert.equal(ledger.requests[0].usage.tokens.output, 3);
  assert.equal(ledger.requests[0].parentToolCallId, done.toolCalls.find(call => call.name === "codemode").toolCallId);
});

test("public CLI saves the same project classifier and reports its durable ledger", { timeout: 45000 }, async t => {
  const f = await createClassificationHost(); t.after(() => f.close()); await f.configure();
  const cli = async args => JSON.parse((await promisify(execFile)(f.stack.nodePath, [f.cli, "classifier", ...args, "--project", f.project], { env: f.env, timeout: 15000 })).stdout);
  const choices = await cli(["list", f.account.accountId]);
  assert.equal(choices.models[0].id, "fixtureclass/sentiment");
  const file = path.join(f.root, "selection.json");
  const { classificationBudget } = await import("./fixtures/classification-host.mjs");
  await fs.writeFile(file, JSON.stringify({ revision: 0, classifier: { accountId: f.account.accountId, model: "fixtureclass/sentiment", budget: classificationBudget } }));
  await cli(["apply", file]);
  assert.equal((await f.calls()).config.revision, 1);
  assert.deepEqual((await cli(["status"])).tasks, []);
});

test("active task protects its independent classifier account until worker termination", { timeout: 35000 }, async t => {
  const f = await createClassificationHost(); t.after(() => f.close()); await f.configure(); await f.select();
  const { taskId } = await f.start(); await until(() => f.task(taskId), task => task.approvals.length, "classifier account in use", 15000);
  for (const action of [{ type: "logout" }, { type: "remove" }, { type: "apiKey", key: "synthetic-replacement" }]) {
    const result = await f.api("/api/account-action", { accountId: f.account.accountId, action }, 409);
    assert.equal(result.code, "ACCOUNT_BUSY");
  }
  await authorize(f, taskId, "拒绝"); await done(f, taskId);
  assert.equal(f.received.length, 0); assert.equal((await f.action({ type: "logout" })).status, "missing");
});

for (const partial of [true, false]) test(`priced classifier ${partial ? "partial" : "complete"} usage has one sourced accounting record and no parent SDK charge`, { timeout: 35000 }, async t => {
  const { classificationCode, classificationReply } = await import("./fixtures/classification-host.mjs");
  const code = classificationCode.replace("text(await models.classify(model,", "const result = await models.classify(model,").replace(/\)\);$/u, '); text({nativeUsage: result.usage ?? null, accounting: result.accounting ?? null});');
  const f = await createClassificationHost({ code, response: ({ res }) => res.end(JSON.stringify({ ...classificationReply, usage: partial ? { input_tokens: 12 } : classificationReply.usage })) });
  t.after(() => f.close()); await f.configure();
  const file = path.join(f.config, "only-my-pi/host/accounts", f.account.accountId, "classifiers.json");
  const config = JSON.parse(await fs.readFile(file, "utf8"));
  config.providers.fixtureclass.models[0].cost = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
  await fs.writeFile(file, JSON.stringify(config)); await f.select();
  const { taskId } = await f.start(); await authorize(f, taskId); const final = await done(f, taskId);
  assert.equal(f.received.length, 1);
  const record = (await f.calls()).tasks.at(-1).requests[0];
  assert.ok(record.priceSnapshot.value);
  assert.equal(record.usage.status, partial ? "unknown" : "reported");
  assert.deepEqual(record.usage.coverage, { input: 12, output: partial ? null : 3 });
  assert.equal(record.usage.estimatedCost === null, partial);
  const text = final.toolCalls.find(call => call.name === "codemode").result;
  assert.match(text, /^Script completed/u);
  const output = JSON.parse(text.slice(text.indexOf("{")));
  assert.equal(output.nativeUsage, null, "native codemode must not charge classification again");
  assert.equal(output.accounting.requestId, record.requestId);
  assert.deepEqual(output.accounting.usage, record.usage);
  assert.deepEqual(output.accounting.priceSnapshot, record.priceSnapshot);
});

async function authorize(f, id, decision = "本任务，按其他额度运行") {
  const waiting = await until(() => f.task(id), task => task.approvals.length || terminal(task), "task classification consent", 15000);
  assert.equal(waiting.approvals.length, 1, JSON.stringify(waiting));
  await f.request("/api/command", { type: "answerApproval", taskId: id, approvalId: waiting.approvals[0].approvalId, value: decision });
}
const done = (f, id) => until(() => f.task(id), terminal, "task terminal", 15000);

for (const denial of ["rejected", "revoked", "missing-credential", "input-limit", "wrong-model"]) test(`native preflight ${denial} receives zero classification requests`, { timeout: 35000 }, async t => {
  const { classificationCode, classificationBudget } = await import("./fixtures/classification-host.mjs");
  const code = denial === "wrong-model" ? 'text(await models.classify({type:"classifier",provider:"fixtureclass",id:"unselected"},{state:{},questions:{}}));' : classificationCode;
  const f = await createClassificationHost({ code }); t.after(() => f.close()); await f.configure();
  await f.select(denial === "input-limit" ? { ...classificationBudget, maxInputBytes: 1 } : classificationBudget);
  if (denial === "missing-credential") await f.action({ type: "logout" });
  const { taskId } = await f.start();
  if (denial !== "wrong-model") {
    await until(() => f.task(taskId), task => task.approvals.length, "approval", 15000);
    if (denial === "revoked") await f.api("/api/model-calls", { type: "save", projectId: f.projectId, revision: 1, classifier: null });
    await authorize(f, taskId, denial === "rejected" ? "拒绝" : undefined);
  }
  const final = await done(f, taskId);
  assert.equal(f.received.length, 0);
  assert.equal(final.toolCalls.find(call => call.name === "codemode").status, "failed", JSON.stringify(final));
  assert.equal((await f.calls()).tasks.at(-1).requests.length, 0);
});

test("concurrent classifier calls reserve atomically and share limits across parent scripts", { timeout: 35000 }, async t => {
  const { classificationCode, classificationContext, classificationBudget } = await import("./fixtures/classification-host.mjs");
  const code = `const model = await models.getModelOfType("classifier","fixtureclass","sentiment"); text(await Promise.allSettled([models.classify(model,${JSON.stringify(classificationContext)}),models.classify(model,${JSON.stringify(classificationContext)})]));`;
  const f = await createClassificationHost({ scripts: [code, classificationCode] }); t.after(() => f.close()); await f.configure(); await f.select({ ...classificationBudget, requests: 1 });
  const { taskId } = await f.start(); await authorize(f, taskId); const final = await done(f, taskId);
  assert.equal(f.received.length, 1);
  assert.equal(final.toolCalls.filter(call => call.name === "codemode").length, 2);
  assert.match(final.toolCalls.at(-1).result, /MODEL_BUDGET_EXHAUSTED/);
  const task = (await f.calls()).tasks.at(-1);
  assert.equal(task.requests.length, 1); assert.equal(task.requests[0].status, "completed");
  assert.equal(final.usage.reported, 0, "classification usage is not charged again as a chat response");
});

test("missing usage stays unknown and all request reservations survive completed task and Host restart", { timeout: 35000 }, async t => {
  const { classificationReply } = await import("./fixtures/classification-host.mjs");
  const f = await createClassificationHost({ response: ({ res }) => res.end(JSON.stringify({ answers: classificationReply.answers })) });
  t.after(() => f.close()); await f.configure(); await f.select();
  const { taskId } = await f.start(); await authorize(f, taskId); await done(f, taskId);
  const before = (await f.calls()).tasks.at(-1).requests[0];
  assert.equal(before.status, "completed"); assert.equal(before.usage.status, "unknown"); assert.equal(before.usage.tokens, null); assert.equal(before.usage.estimatedCost, null);
  await f.restart();
  assert.deepEqual((await f.calls()).tasks.at(-1).requests[0], before); assert.equal(f.received.length, 1);
});

test("lost response keeps concurrency and budget occupied across scripts and restart without native retries", { timeout: 35000 }, async t => {
  const { classificationCode, classificationBudget } = await import("./fixtures/classification-host.mjs");
  const f = await createClassificationHost({ scripts: [classificationCode, classificationCode], response: ({ req }) => req.socket.destroy() });
  t.after(() => f.close()); await f.configure(); await f.select({ ...classificationBudget, timeoutMs: 1000 });
  const { taskId } = await f.start(); await authorize(f, taskId); const final = await done(f, taskId);
  assert.equal(f.received.length, 1, "native maxRetries=0");
  assert.equal(final.status, "failed", "unknown classification must pause the Host input queue");
  assert.equal(final.error, "MODEL_RESULT_RECONCILIATION_REQUIRED");
  const before = (await f.calls()).tasks.at(-1).requests[0];
  assert.equal(before.status, "unknown"); assert.match(final.toolCalls.at(-1).result, /MODEL_RESULT_RECONCILIATION_REQUIRED/);
  await f.restart();
  const after = (await f.calls()).tasks.at(-1).requests[0];
  assert.equal(after.requestId, before.requestId); assert.deepEqual(after.reservation, before.reservation); assert.equal(after.status, "unknown"); assert.equal(f.received.length, 1);
});

test("killed real Pi worker leaves stable unknown request identity and no restored grant or replay", { timeout: 35000 }, async t => {
  const f = await createClassificationHost({ response: () => {} }); t.after(() => f.close()); await f.configure(); await f.select();
  const { taskId } = await f.start(); await authorize(f, taskId); await until(() => f.received.length, n => n === 1, "classification received");
  const ledger = JSON.parse(await fs.readFile(path.join(f.config, "only-my-pi/model-calls/state.json"), "utf8")), task = ledger.tasks.at(-1);
  process.kill(task.ownerPid, "SIGKILL"); await done(f, taskId); await f.restart();
  const recovered = (await f.calls()).tasks.at(-1);
  assert.equal(recovered.status, "interrupted"); assert.equal(recovered.requests[0].status, "unknown"); assert.equal(recovered.requests[0].requestId, task.requests[0].requestId);
  assert.equal(recovered.permission, undefined); assert.equal(f.received.length, 1);
  await f.calls(); assert.equal(f.received.length, 1);
});

test("corrupt persisted quota is rejected rather than widened or reset", { timeout: 25000 }, async t => {
  const f = await createClassificationHost(); t.after(() => f.close()); await f.configure(); await f.select();
  const file = path.join(f.config, "only-my-pi/model-calls/state.json"), state = JSON.parse(await fs.readFile(file, "utf8"));
  state.projects[0].classifier.budget.requests = 999999;
  await fs.writeFile(file, JSON.stringify(state));
  const result = await f.api(`/api/model-calls?projectId=${f.projectId}`, undefined, 409);
  assert.equal(result.code, "MODEL_LEDGER_INVALID"); assert.equal(f.received.length, 0);
});

test("project changes bind only the next task while the active task retains its classifier account", { timeout: 45000 }, async t => {
  const f = await createClassificationHost(); t.after(() => f.close()); await f.configure(); await f.select();
  const second = (await f.api("/api/accounts", { name: "分类账号 B", providerId: "fixtureclass", authType: "api_key" }, 201)).account;
  const configureB = action => f.api("/api/account-action", { accountId: second.accountId, action });
  await configureB({ type: "configure", config: { baseUrl: f.classifierOrigin, api: "typesafe-system-one", models: [{ type: "classifier", id: "sentiment", name: "Sentiment", contextWindow: 8192 }] } });
  await configureB({ type: "apiKey", key: "class-fixture-b" });
  const first = await f.start(); await until(() => f.task(first.taskId), task => task.approvals.length, "original binding approval", 15000);
  const { classificationBudget } = await import("./fixtures/classification-host.mjs");
  await f.api("/api/model-calls", { type: "save", projectId: f.projectId, revision: 1, classifier: { accountId: second.accountId, model: "fixtureclass/sentiment", budget: classificationBudget } });
  await authorize(f, first.taskId); await done(f, first.taskId);
  assert.equal(f.received[0].key, "Bearer class-fixture-a");
  const next = await f.start(); await authorize(f, next.taskId); await done(f, next.taskId);
  assert.equal(f.received[1].key, "Bearer class-fixture-b");
  const tasks = (await f.calls()).tasks;
  assert.deepEqual(tasks.map(task => task.snapshot.revision), [1, 2]);
  assert.deepEqual(tasks.map(task => task.snapshot.classifier.accountId), [f.account.accountId, second.accountId]);
});

for (const failure of ["429", "timeout", "output-limit", "cancel"]) test(`native ${failure} does not retry or refund the request`, { timeout: 35000 }, async t => {
  const { classificationBudget } = await import("./fixtures/classification-host.mjs");
  const f = await createClassificationHost({ response: ({ res }) => { if (failure === "429") { res.writeHead(429); res.end("rate limited"); } else if (failure === "output-limit") res.end("x".repeat(512)); } });
  t.after(() => f.close()); await f.configure(); await f.select({ ...classificationBudget, timeoutMs: 1000, ...(failure === "output-limit" ? { maxOutputBytes: 64 } : {}) });
  const { taskId } = await f.start(); await authorize(f, taskId);
  await until(() => f.received.length, n => n === 1, "provider received");
  if (failure === "cancel") await f.request("/api/command", { type: "cancelTask", taskId }, 202);
  await done(f, taskId);
  const request = (await f.calls()).tasks.at(-1).requests[0];
  assert.equal(f.received.length, 1); assert.equal(request.status, failure === "429" ? "failed" : "unknown");
  assert.equal(request.reservation.requests, 1); assert.equal(request.usage.estimatedCost, null);
});

test("WebUI saved-draft submission initializes the same classifier binding through native custom-message delivery", { timeout: 35000 }, async t => {
  const f = await createClassificationHost(); t.after(() => f.close()); await f.configure(); await f.select();
  const target = { projectId: f.projectId, sessionKey: null };
  const input = { inputId: "classification-web-draft", delivery: "prompt", text: "classify via saved draft", materialSnapshotIds: [], binding: { accountId: "cli-readonly", modelId: "fixture/one", thinking: "off", mode: "readonly", resourceRevision: 0 } };
  const draft = await f.api("/api/input-command", { type: "saveDraft", target, input, expectedRevision: 0 });
  const submitted = { type: "submitPrompt", target, requestId: "classification-web-submit", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision };
  const task = await f.api("/api/input-command", submitted);
  await authorize(f, task.taskId); await done(f, task.taskId);
  assert.equal(f.received.length, 1);
  const duplicate = await f.api("/api/input-command", submitted); assert.equal(duplicate.taskId, task.taskId); assert.equal(f.received.length, 1);
  assert.equal((await f.calls()).tasks.at(-1).requests[0].status, "completed");
});

test("unknown result blocks further model dispatch even when concurrency slots remain", { timeout: 35000 }, async t => {
  const { classificationCode, classificationBudget } = await import("./fixtures/classification-host.mjs");
  const f = await createClassificationHost({ scripts: [classificationCode, classificationCode], response: ({ req }) => req.socket.destroy() });
  t.after(() => f.close()); await f.configure(); await f.select({ ...classificationBudget, concurrency: 4 });
  const { taskId } = await f.start(); await authorize(f, taskId); const final = await done(f, taskId);
  assert.equal(f.received.length, 1);
  assert.match(final.toolCalls.at(-1).result, /MODEL_RESULT_RECONCILIATION_REQUIRED/);
});

for (const api of ["openai-decisions", "cloudflare-workers-ai-system-one"]) test(`native ${api} maps its real protocol and receipt`, { timeout: 35000 }, async t => {
  const { classificationReply } = await import("./fixtures/classification-host.mjs");
  const f = await createClassificationHost({ api, response: ({ res }) => res.end(JSON.stringify(api === "openai-decisions"
    ? { answers: [{ ...classificationReply.answers.sentiment, name: "sentiment", probabilities: [{ value: "positive", probability: 0.9 }, { value: "negative", probability: 0.1 }] }], usage: classificationReply.usage }
    : { success: true, result: { state: "Completed", result: classificationReply } })) });
  t.after(() => f.close()); await f.configure(); await f.select(); const { taskId } = await f.start(); await authorize(f, taskId); await done(f, taskId);
  assert.equal(f.received.length, 1); assert.equal(f.received[0].url, api === "openai-decisions" ? "/decisions" : "/run");
  assert.equal(f.received[0].body.model, "sentiment");
  assert.equal(api === "openai-decisions" ? JSON.parse(f.received[0].body.input).text : f.received[0].body.input.state.text, "A helpful example");
  const request = (await f.calls()).tasks.at(-1).requests[0]; assert.equal(request.status, "completed"); assert.equal(request.usage.tokens.input, 12);
});
