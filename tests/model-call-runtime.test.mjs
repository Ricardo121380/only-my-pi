import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as sdk from "@earendil-works/pi-coding-agent";
import { createClassificationControl } from "../packages/model-calls/runtime.mjs";
import { classificationContext, createClassificationHost } from "./fixtures/classification-host.mjs";
import { createImageHost, imageBase64, imageContext, imageDigest } from "./fixtures/image-host.mjs";

// Exercise the repository module through Pi's real extension loader, lifecycle
// dispatcher and context. The account store, native adapters and independent
// loopback receivers are real; only the user's UI selection is controlled.
async function controlFixture(t, f) {
  let session, control, decision = "拒绝";
  const prompts = [], errors = [];
  t.after(async () => {
    try {
      if (session) {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        session.dispose();
      }
    } finally { await f.close(); }
  });
  await f.configure(); await f.select();
  sdk.initTheme("dark", false);
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: path.join(f.config, "auth.json"),
    modelsPath: path.join(f.config, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  const services = await sdk.createAgentSessionServices({ cwd: f.project, agentDir: f.config, modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({}),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      extensionFactories: [pi => { control = createClassificationControl(pi, {
        sdkFile: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")), configRoot: f.config }); }] } });
  const sessionManager = sdk.SessionManager.inMemory(f.project);
  ({ session } = await sdk.createAgentSessionFromServices({ services, sessionManager,
    model: modelRuntime.getModelOfType("text", "fixture", "one"), noTools: true }));
  await session.bindExtensions({ mode: "tui", onError: error => errors.push(error),
    uiContext: { select: async (title, options) => { prompts.push({ title, options }); return decision; } } });
  const runner = session.extensionRunner;
  await runner.emit({ type: "agent_start" });
  const registry = await control.registry(runner.createContext(), "parent-fixture-tool", new AbortController().signal, () => {});
  assert.deepEqual(errors, []);
  return { control, registry, runner, prompts, sessionManager,
    approve: () => { decision = "本任务，按其他额度运行"; },
    assertNoErrors: () => assert.deepEqual(errors, []) };
}

test("native classifier requires task consent, records the real request and revokes retained handles at agent end", { timeout: 45000 }, async t => {
  const f = await createClassificationHost(), c = await controlFixture(t, f);
  const model = c.registry.getModelOfType("classifier", "fixtureclass", "sentiment");
  assert.ok(model);
  assert.deepEqual(await c.registry.getAvailableOfType("classifier"), [model]);
  assert.deepEqual(c.registry.getModelsOfType("image"), []);
  assert.deepEqual(c.registry.getModelsOfType("classifier", "other"), []);
  await assert.rejects(c.registry.classify({ ...model, id: "other" }, classificationContext), { code: "CLASSIFIER_MODEL_NOT_BOUND" });
  await assert.rejects(c.registry.classify(model, { ...classificationContext, images: [{}] }), { code: "CLASSIFIER_IMAGE_INPUT_UNAVAILABLE" });
  await assert.rejects(c.registry.classify(model, classificationContext), { code: "CLASSIFIER_CALL_DENIED" });
  assert.equal(f.received.length, 0);
  assert.equal((await f.calls()).tasks.at(-1).requests.length, 0);
  assert.deepEqual(c.prompts[0].options, ["拒绝", "本任务，按其他额度运行"]);
  c.approve();
  const result = await c.registry.classify(model, classificationContext);
  assert.equal(result.answers.sentiment.choice, "positive");
  assert.equal(Object.hasOwn(result, "usage"), false, "the parent must not charge native usage a second time");
  assert.equal(f.received.length, 1);
  assert.equal(f.received[0].body.model, "sentiment");
  assert.equal(f.received[0].url, "/systemone");
  assert.equal(f.received[0].key, "Bearer class-fixture-a");
  const task = (await f.calls()).tasks.at(-1), request = task.requests[0];
  assert.equal(request.parentToolCallId, "parent-fixture-tool");
  assert.equal(request.status, "completed");
  assert.equal(request.requestId, f.received[0].requestId);
  assert.equal(result.accounting.requestId, request.requestId);
  assert.deepEqual(request.usage.tokens, { input: 12, output: 3, totalTokens: 15 });
  assert.equal(request.usage.bill, false);
  await c.runner.emit({ type: "agent_end", messages: [] });
  await assert.rejects(c.registry.classify(model, classificationContext), { code: "CLASSIFIER_NOT_CONFIGURED" });
  assert.equal(f.received.length, 1);
  assert.equal((await f.calls()).tasks.at(-1).status, "stopped");
  c.assertNoErrors();
});

test("native image output is admitted only after real request storage and retains its session reference", { timeout: 45000 }, async t => {
  const f = await createImageHost(), c = await controlFixture(t, f);
  const model = c.registry.getModelOfType("image", "fixtureimage", "checkerboard");
  const image = { type: "image", mimeType: "image/png", data: imageBase64 };
  await assert.rejects(c.control.output([image]), { code: "CODEMODE_OUTPUT_LIMIT" });
  await assert.rejects(c.control.output([{ type: "file", path: "unadmitted" }]), { code: "CODEMODE_OUTPUT_LIMIT" });
  await assert.rejects(c.registry.generateImages(model, { input: [] }), { code: "IMAGE_INPUT_INVALID" });
  await assert.rejects(c.registry.generateImages(model, { input: [image] }), { code: "IMAGE_INPUT_UNSUPPORTED" });
  await assert.rejects(c.registry.generateImages(model, { input: [{ type: "text", text: " " }] }), { code: "IMAGE_INPUT_INVALID" });
  assert.equal(f.received.length, 0);
  c.approve();
  const result = await c.registry.generateImages(model, imageContext);
  assert.equal(f.received.length, 1);
  assert.equal(f.received[0].url, "/v1/chat/completions");
  assert.equal(result.stopReason, "stop");
  assert.equal(result.storage.status, "saved");
  assert.deepEqual(result.output, [image]);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].sha256, imageDigest);
  assert.deepEqual(await c.control.output(result.output), result.output);
  const projected = await c.control.output([{ type: "text", text: "[Image saved to /synthetic/private.png]" }]);
  assert.equal(projected[0].text, "[图片已保存为 OMP 会话产物]");
  const request = (await f.calls()).tasks.at(-1).requests[0];
  assert.equal(request.requestId, f.received[0].requestId);
  assert.deepEqual(request.storage.artifacts, result.artifacts);
  const association = c.sessionManager.getEntries().find(entry => entry.type === "custom" && entry.customType === "omp-image-artifacts");
  assert.equal(association.data.requestId, request.requestId);
  assert.deepEqual(association.data.artifacts, result.artifacts);
  assert.deepEqual(await fs.readdir(f.project), ["README.md"], "generation must not write the project");
  await c.runner.emit({ type: "session_shutdown", reason: "quit" });
  await assert.rejects(c.registry.generateImages(model, imageContext), { code: "IMAGE_NOT_CONFIGURED" });
  assert.equal(f.received.length, 1);
  assert.equal((await f.calls()).tasks.at(-1).status, "stopped");
  c.assertNoErrors();
});
