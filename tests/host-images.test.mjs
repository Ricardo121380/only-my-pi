import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createImageHost, imageDigest, imageReply, imageCode, imageContext, imageBudget, authorizeImage as authorize, imageDone as done } from "./fixtures/image-host.mjs";
import { until } from "./fixtures/mcp-host.mjs";
import { ModelCallStore } from "../packages/model-calls/store.mjs";

test("native Pi image generation uses an independent binding and atomically publishes actual session image bytes", { timeout: 45000 }, async t => {
  const f = await createImageHost(); t.after(() => f.close()); await f.configure();
  const catalog = await f.api(`/api/models?accountId=${f.account.accountId}&type=image`);
  assert.equal(catalog.models[0].id, "fixtureimage/checkerboard"); await f.select();
  const start = await f.start(); await until(() => f.task(start.taskId), task => task.approvals.length, "image waiting", 15000);
  assert.equal(f.received.length, 0); await authorize(f, start.taskId); const final = await done(f, start.taskId);
  assert.equal(f.received.length, 1, JSON.stringify(final));
  assert.equal(f.received[0].url, "/v1/chat/completions"); assert.equal(f.received[0].key, "Bearer image-fixture-a");
  assert.equal(f.received[0].body.model, "checkerboard"); assert.deepEqual(f.received[0].body.modalities, ["image", "text"]);
  const task = (await f.calls()).tasks.find(task => task.taskId === start.taskId), record = task.requests[0];
  assert.equal(record.kind, "image"); assert.equal(record.status, "completed"); assert.equal(record.requestId, f.received[0].requestId);
  assert.equal(record.storage.status, "saved"); assert.equal(record.storage.artifacts[0].sha256, imageDigest);
  assert.equal(record.storage.artifacts[0].sessionId, final.sessionId); assert.equal(record.storage.artifacts[0].accountId, f.account.accountId);
  const preview = await fetch(f.host.origin + `/api/image-artifact?projectId=${f.projectId}&requestId=${record.requestId}&index=0`, { headers: { Cookie: f.cookie } });
  assert.equal(preview.status, 200); assert.equal(preview.headers.get("content-type"), "image/png");
  assert.equal(createHash("sha256").update(Buffer.from(await preview.arrayBuffer())).digest("hex"), imageDigest);
  assert.equal((await f.api(`/api/image-artifact?projectId=${f.projectId}&requestId=${record.requestId}`, undefined, 400)).code, "IMAGE_ARTIFACT_ID_INVALID");
  assert.deepEqual(record.usage.coverage, { input: 12, output: 3 });
  assert.deepEqual(await fs.readdir(f.project), ["README.md"]);
});

test("Host does not expose a successful terminal state before the image outcome read completes", { timeout: 35000 }, async t => {
  const reply = structuredClone(imageReply); reply.choices[0].message.images = [];
  const f = await createImageHost({ response: ({ res }) => res.end(JSON.stringify(reply)) }); t.after(() => f.close()); await f.configure(); await f.select();
  let entered = false, release; const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const original = ModelCallStore.prototype.status;
  t.mock.method(ModelCallStore.prototype, "status", async function (...args) {
    const result = await original.apply(this, args);
    if (!entered && result.tasks.some(task => task.requests.some(request => request.kind === "image" && request.error))) { entered = true; await gate; }
    return result;
  });
  const { taskId } = await f.start(); await authorize(f, taskId); await until(() => entered, Boolean, "Host outcome read pending", 15000);
  assert.equal((await f.task(taskId)).status, "running", "public terminal state must wait for the durable result");
  release(); const final = await done(f, taskId); assert.equal(final.status, "failed"); assert.equal(final.error, "IMAGE_OUTPUT_UNAVAILABLE"); assert.equal(f.received.length, 1);
});

for (const scenario of ["partial-usage", "no-usage", "empty", "corrupt", "partial-output", "save-failure", "provider-error"]) test(`native image ${scenario} retains remote accounting independently from local storage`, { timeout: 35000 }, async t => {
  let f;
  f = await createImageHost({ response: async ({ res }) => {
    let reply = structuredClone(imageReply);
    if (scenario === "partial-usage") reply.usage = { prompt_tokens: 12 };
    if (scenario === "no-usage") delete reply.usage;
    if (scenario === "empty") reply.choices[0].message.images = [];
    if (scenario === "corrupt") reply.choices[0].message.images[0].image_url.url = "data:image/png;base64,aW52YWxpZA==";
    if (scenario === "partial-output") reply.choices[0].finish_reason = "length";
    if (scenario === "save-failure") await fs.writeFile(path.join(f.config, "only-my-pi/model-calls/artifacts"), "blocked directory");
    if (scenario === "provider-error") { res.writeHead(429); res.end(JSON.stringify({ error: { message: "synthetic denial" } })); return; }
    res.end(JSON.stringify(reply));
  } });
  t.after(() => f.close()); await f.configure(); await f.select();
  const { taskId } = await f.start(); await authorize(f, taskId); const final = await done(f, taskId);
  const request = (await f.calls()).tasks.at(-1).requests[0];
  assert.equal(f.received.length, 1); assert.equal(request.status, scenario === "provider-error" ? "failed" : "completed");
  assert.equal(request.reservation.images, 1); assert.equal(request.reservation.storageBytes, imageBudget.maxStorageBytes);
  if (["partial-usage", "no-usage"].includes(scenario)) {
    assert.equal(request.storage.status, "saved"); assert.equal(request.usage.tokens, null); assert.equal(request.usage.estimatedCost, null);
    assert.deepEqual(request.usage.coverage, { input: scenario === "partial-usage" ? 12 : null, output: null });
  } else if (scenario !== "provider-error") {
    assert.deepEqual(request.usage.coverage, { input: 12, output: 3 });
    assert.equal(request.storage.status, scenario === "save-failure" ? "failed" : scenario === "partial-output" ? "partial" : "invalid");
    assert.equal(final.status, "failed");
  }
  await f.restart(); assert.equal(f.received.length, 1); assert.deepEqual((await f.calls()).tasks.at(-1).requests[0], request);
  assert.deepEqual(await fs.readdir(f.project), ["README.md"]);
});

test("image binding changes affect the next task and busy image accounts cannot be replaced", { timeout: 45000 }, async t => {
  const f = await createImageHost(); t.after(() => f.close()); await f.configure(); await f.select();
  const second = (await f.api("/api/accounts", { name: "生图账号 B", providerId: "fixtureimage", authType: "api_key" }, 201)).account;
  await f.api("/api/account-action", { accountId: second.accountId, action: { type: "configure", config: { baseUrl: f.imageOrigin, api: "openrouter-images", models: [{ type: "image", id: "checkerboard", name: "Checkerboard", contextWindow: 8192, input: ["text"], output: ["image", "text"] }] } } });
  await f.api("/api/account-action", { accountId: second.accountId, action: { type: "apiKey", key: "image-fixture-b" } });
  const first = await f.start(); await until(() => f.task(first.taskId), task => task.approvals.length, "image binding A", 15000);
  for (const action of [{ type: "logout" }, { type: "remove" }, { type: "apiKey", key: "synthetic-replacement" }]) assert.equal((await f.api("/api/account-action", { accountId: f.account.accountId, action }, 409)).code, "ACCOUNT_BUSY");
  await f.api("/api/model-calls", { type: "save", projectId: f.projectId, revision: 1, image: { accountId: second.accountId, model: "fixtureimage/checkerboard", budget: imageBudget } });
  await authorize(f, first.taskId); await done(f, first.taskId);
  assert.equal(f.received[0].key, "Bearer image-fixture-a");
  const next = await f.start(); await authorize(f, next.taskId); await done(f, next.taskId);
  assert.equal(f.received[1].key, "Bearer image-fixture-b");
  assert.deepEqual((await f.calls()).tasks.map(task => task.snapshot.image.accountId), [f.account.accountId, second.accountId]);
});

for (const limit of ["images", "storageBytes", "concurrency"]) test(`image ${limit} reservations are shared across concurrent scripts`, { timeout: 35000 }, async t => {
  const parallel = `const model = await models.getModelOfType("image","fixtureimage","checkerboard"); text((await Promise.allSettled([models.generateImages(model,${JSON.stringify(imageContext)}),models.generateImages(model,${JSON.stringify(imageContext)})])).map(r => r.status === "rejected" ? {status:r.status,error:String(r.reason)} : {status:r.status,artifacts:r.value.artifacts}));`;
  const f = await createImageHost({ scripts: [parallel, imageCode] }); t.after(() => f.close()); await f.configure();
  await f.select({ ...imageBudget, ...(limit === "images" ? { images: 1 } : limit === "storageBytes" ? { storageBytes: imageBudget.maxStorageBytes } : {}) });
  const { taskId } = await f.start(); await authorize(f, taskId); const final = await done(f, taskId);
  assert.equal(f.received.length, limit === "concurrency" ? 2 : 1);
  assert.match(final.toolCalls[0].result, /MODEL_BUDGET_EXHAUSTED/);
  if (limit !== "concurrency") assert.match(final.toolCalls.at(-1).result, /MODEL_BUDGET_EXHAUSTED/);
  assert.equal((await f.calls()).tasks.at(-1).requests.length, f.received.length);
});

for (const scenario of ["lost-response", "cancel", "worker-death"]) test(`image ${scenario} keeps its identity and reservation without replay after restart`, { timeout: 35000 }, async t => {
  const f = await createImageHost({ scripts: [imageCode, imageCode], response: scenario === "lost-response" ? ({ req }) => req.socket.destroy() : () => {} });
  t.after(() => f.close()); await f.configure(); await f.select({ ...imageBudget, timeoutMs: 1000 });
  const { taskId } = await f.start(); await authorize(f, taskId); await until(() => f.received.length, n => n === 1, "image received");
  if (scenario === "cancel") await f.request("/api/command", { type: "cancelTask", taskId }, 202);
  if (scenario === "worker-death") { const state = JSON.parse(await fs.readFile(path.join(f.config, "only-my-pi/model-calls/state.json"), "utf8")); process.kill(state.tasks.at(-1).ownerPid, "SIGKILL"); }
  await done(f, taskId); const before = (await f.calls()).tasks.at(-1).requests[0];
  assert.equal(before.status, "unknown"); await f.restart(); const recovered = (await f.calls()).tasks.at(-1);
  assert.equal(recovered.requests[0].requestId, before.requestId); assert.deepEqual(recovered.requests[0].reservation, before.reservation);
  assert.equal(recovered.requests[0].status, "unknown"); assert.equal(recovered.imagePermission, undefined); assert.equal(f.received.length, 1);
});

for (const scenario of ["rejected", "revoked", "missing-credential", "input-limit", "wrong-model", "unsupported-params"]) test(`image preflight ${scenario} receives zero requests`, { timeout: 35000 }, async t => {
  const code = scenario === "wrong-model" ? `text(await models.generateImages({type:"image",provider:"fixtureimage",id:"unbound"},${JSON.stringify(imageContext)}));` : scenario === "unsupported-params" ? imageCode.replace(JSON.stringify(imageContext), JSON.stringify({ ...imageContext, size: "1024x1024" })) : imageCode;
  const f = await createImageHost({ code }); t.after(() => f.close()); await f.configure(); await f.select({ ...imageBudget, ...(scenario === "input-limit" ? { maxInputBytes: 1 } : {}) });
  if (scenario === "missing-credential") await f.action({ type: "logout" });
  const { taskId } = await f.start();
  if (!["wrong-model", "input-limit", "unsupported-params"].includes(scenario)) {
    await until(() => f.task(taskId), task => task.approvals.length, "image consent", 15000);
    if (scenario === "revoked") await f.api("/api/model-calls", { type: "save", projectId: f.projectId, revision: 1, image: null });
    await authorize(f, taskId, scenario === "rejected" ? "拒绝" : undefined);
  }
  const final = await done(f, taskId); assert.equal(final.toolCalls.find(call => call.name === "codemode").status, "failed");
  assert.equal(f.received.length, 0); assert.equal((await f.calls()).tasks.at(-1).requests.length, 0);
});
