import { randomUUID } from "node:crypto";
import { ModelCallStore } from "./store.mjs";
import { classifierRuntime } from "./models.mjs";
import { hostError } from "../host/contracts.mjs";
import { ImageArtifacts, validateImage } from "./artifacts.mjs";

const fail = code => hostError(code, 409);
const boundedProbability = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
function validateAnswers(answers, questions) {
  if (!answers || Object.keys(answers).sort().join() !== Object.keys(questions).sort().join()) throw fail("CLASSIFIER_RESULT_INVALID");
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (answer?.type !== question.type) throw fail("CLASSIFIER_RESULT_INVALID");
    if (question.type === "choice" && (!Object.hasOwn(question.criteria, answer.choice) || !boundedProbability(answer.confidence) || !answer.probabilities || Object.keys(answer.probabilities).some(key => !Object.hasOwn(question.criteria, key)) || !Object.values(answer.probabilities).every(boundedProbability))) throw fail("CLASSIFIER_RESULT_INVALID");
    if (question.type === "bool" && !boundedProbability(answer.probability)) throw fail("CLASSIFIER_RESULT_INVALID");
    if (question.type === "score" && (typeof answer.score !== "number" || !Number.isFinite(answer.score) || !boundedProbability(answer.confidence))) throw fail("CLASSIFIER_RESULT_INVALID");
  }
}
function projectUsage(result, receipt, price, kind = "classifier") {
  const wire = receipt?.usage;
  // Pi treats malformed/missing token fields as zero; preserve that coverage gap
  // instead of upgrading the SDK's fallback zeros to reported provider facts.
  const reported = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const coverage = { input: reported(kind === "image" ? wire?.prompt_tokens : wire?.input_tokens), output: reported(kind === "image" ? wire?.completion_tokens : wire?.output_tokens) };
  const complete = coverage.input !== null && coverage.output !== null;
  const tokens = complete ? { ...coverage, totalTokens: coverage.input + coverage.output } : null;
  return { status: complete ? "reported" : "unknown", tokens, coverage, estimatedCost: complete && price && Number.isFinite(result.usage?.cost?.total) ? result.usage.cost.total : null, source: "provider receipt", costSource: "Pi SDK catalog estimate", bill: false };
}

export function createClassificationControl(pi, { sdkFile, configRoot }) {
  const store = new ModelCallStore(configRoot);
  const artifacts = new ImageArtifacts(configRoot);
  let snapshot, taskId, ended = true, approved = new Set(), approvalPending = new Map(), starting;
  const finish = async () => { if (!ended && taskId) { ended = true; approved.clear(); await store.end(taskId); } };
  const start = async ctx => {
    await finish();
    snapshot = process.env.OMP_HOST_CLASSIFIER_SNAPSHOT ? JSON.parse(process.env.OMP_HOST_CLASSIFIER_SNAPSHOT) : await store.config(ctx.cwd);
    taskId = process.env.OMP_HOST_INPUT_TASK_ID ?? `cli_${randomUUID()}`;
    if (snapshot.projectPath !== ctx.cwd) throw fail("CLASSIFIER_PROJECT_MISMATCH");
    if (snapshot.classifier || snapshot.image) { await store.begin(taskId, ctx.cwd, snapshot); ended = false; }
  };
  // sendCustomMessage(triggerTurn), used by durable WebUI input, bypasses
  // before_agent_start. Both that path and prompt emit the public agent_start.
  pi.on("agent_start", (_event, ctx) => { starting = start(ctx); return starting; });
  pi.on("agent_end", finish);
  pi.on("session_shutdown", finish);
  return {
    async output(content) {
      const images = content.filter(block => block.type === "image");
      if (images.length) {
        if (!snapshot?.image || images.length > snapshot.image.budget.images) throw fail("CODEMODE_OUTPUT_LIMIT");
        const task = (await store.status(snapshot.projectPath)).tasks.find(item => item.taskId === taskId);
        const allowed = new Set(task?.requests.flatMap(request => request.storage?.artifacts.map(artifact => artifact.sha256) ?? []) ?? []);
        for (const image of images) if (!allowed.has(validateImage(image, snapshot.image.budget.maxStorageBytes).sha256)) throw fail("CODEMODE_OUTPUT_LIMIT");
      }
      if (content.some(block => !["text", "image"].includes(block.type))) throw fail("CODEMODE_OUTPUT_LIMIT");
      return content.map(block => block.type === "text" ? { ...block, text: block.text.replace(/\[Image saved to [^\n]+\]/gu, "[图片已保存为 OMP 会话产物]") } : block);
    },
    async registry(ctx, parentToolCallId, signal, check) {
      await starting;
      const models = (type, provider) => {
        const selected = ["classifier", "image"].includes(type) ? snapshot?.[type]?.choice.definition : null;
        return selected && (!provider || provider === selected.provider) ? [selected] : [];
      };
      const call = async (kind, model, context, options) => {
          const binding = snapshot?.[kind], selected = binding?.choice.definition, prefix = kind === "image" ? "IMAGE" : "CLASSIFIER";
          if (!binding || ended) throw fail(`${prefix}_NOT_CONFIGURED`);
          check();
          if (model.provider !== selected.provider || model.id !== selected.id) throw fail(`${prefix}_MODEL_NOT_BOUND`);
          if (kind === "classifier" && context.images?.length) throw fail("CLASSIFIER_IMAGE_INPUT_UNAVAILABLE");
          if (kind === "image") {
            if (Object.keys(context).join() !== "input" || !Array.isArray(context.input) || !context.input.length || context.input.length > 10) throw fail("IMAGE_INPUT_INVALID");
            if (Buffer.byteLength(JSON.stringify(context)) > binding.budget.maxInputBytes) throw fail("MODEL_INPUT_LIMIT");
            for (const block of context.input) {
              if (!selected.input.includes(block.type)) throw fail("IMAGE_INPUT_UNSUPPORTED");
              if (block.type === "image") validateImage(block, binding.budget.maxInputBytes);
              else if (block.type !== "text" || typeof block.text !== "string" || !block.text.trim()) throw fail("IMAGE_INPUT_INVALID");
            }
          }
          if (!approved.has(kind)) {
            if (!approvalPending.has(kind)) approvalPending.set(kind, (async () => {
              if (!ctx.hasUI) throw fail(`${prefix}_APPROVAL_REQUIRED`);
              const budget = binding.budget;
              const decision = await ctx.ui.select(`Codemode · ${kind === "image" ? "生图" : "分类"}\n项目 ${ctx.cwd}\n账号 ${binding.accountId} · 模型 ${binding.model}\n任务 ${taskId}\n次数 ${budget.requests} · 并发 ${budget.concurrency}\n输入 ${budget.inputBytes} 字节 · 输出 ${budget.outputBytes} 字节${kind === "image" ? `\n图片 ${budget.images} 张 · 单次最多 ${budget.maxImagesPerRequest} 张 · 存储 ${budget.storageBytes} 字节；仅保存会话产物，不写项目。` : ""}\n费用上限未知；仅按其他额度运行，SDK 估算不是账单。未知结果继续占额，不自动重试。`, ["拒绝", "本任务，按其他额度运行"]);
              check();
              if (decision !== "本任务，按其他额度运行") throw fail(`${prefix}_CALL_DENIED`);
              await store.authorize(taskId, ctx.sessionManager.getSessionId(), kind); approved.add(kind);
            })());
            try { await approvalPending.get(kind); } finally { approvalPending.delete(kind); }
          }
          check();
          const current = await classifierRuntime({ configRoot, sdkFile, accountId: binding.accountId, modelId: binding.model, kind });
          if (current.choice.definitionDigest !== binding.choice.definitionDigest) throw fail(`${prefix}_DEFINITION_CHANGED`);
          const request = await store.reserve(taskId, parentToolCallId, context, kind);
          let dispatched = false, receipt, responseComplete = false, responseStatus, usage;
          const budget = binding.budget, deadline = AbortSignal.timeout(budget.timeoutMs), boundedSignal = AbortSignal.any([signal, options?.signal, deadline].filter(Boolean));
          try {
            const auth = await current.runtime.getAuth(current.model, { env: {} });
            if (!auth?.auth?.apiKey) throw fail(`${prefix}_CREDENTIAL_MISSING`);
            // Pi's native usage parser requires a cost object. This placeholder
            // never becomes a catalog price or a reported provider bill.
            const nativeModel = current.model.cost ? current.model : { ...current.model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
            const operation = kind === "image" ? "generateImages" : "classify";
            const result = await current.runtime[operation](nativeModel, context, { signal: boundedSignal, env: {}, apiKey: auth.auth.apiKey, maxRetries: 0, timeoutMs: budget.timeoutMs,
              fetch: async (url, options) => {
                check(); boundedSignal.throwIfAborted();
                if (dispatched) throw fail("MODEL_RETRY_DENIED");
                const target = new URL(url), base = new URL(current.model.baseUrl);
                const endpoint = { "typesafe-system-one": "systemone", "openai-decisions": "decisions", "cloudflare-workers-ai-system-one": "run", "openrouter-images": "chat/completions" }[current.model.api];
                if (target.href !== new URL(endpoint, `${base.href.replace(/\/+$/u, "")}/`).href || target.username || target.password || target.search || target.hash) throw fail(`${prefix}_TARGET_CHANGED`);
                const inputBytes = Buffer.byteLength(typeof options?.body === "string" ? options.body : "");
                if (!inputBytes || inputBytes > budget.maxInputBytes) throw fail("MODEL_INPUT_LIMIT");
                const live = await classifierRuntime({ configRoot, sdkFile, accountId: binding.accountId, modelId: binding.model, kind });
                if (live.choice.definitionDigest !== binding.choice.definitionDigest) throw fail(`${prefix}_DEFINITION_CHANGED`);
                const liveAuth = await live.runtime.getAuth(live.model, { env: {} });
                if (liveAuth?.auth?.apiKey !== auth.auth.apiKey) throw fail(`${prefix}_CREDENTIAL_CHANGED`);
                let responsePending;
                const headers = new Headers(options.headers);
                if (headers.get("authorization") !== `Bearer ${auth.auth.apiKey}`) throw fail(`${prefix}_CREDENTIAL_CHANGED`);
                headers.set("x-omp-model-request-id", request.requestId);
                await store.dispatch(taskId, request.requestId, { inputBytes }, () => {
                  check(); boundedSignal.throwIfAborted(); dispatched = true;
                  responsePending = fetch(url, { ...options, headers, signal: boundedSignal, redirect: "error" });
                  responsePending.catch(() => {});
                });
                const response = await responsePending;
                const reader = response.body?.getReader(); let count = 0; const chunks = [];
                if (!reader) throw fail(`${prefix}_RESPONSE_MISSING`);
                try { for (;;) { const item = await reader.read(); if (item.done) break; count += item.value.byteLength; if (count > budget.maxOutputBytes) throw fail("MODEL_OUTPUT_LIMIT"); chunks.push(Buffer.from(item.value)); } }
                finally { await reader.cancel().catch(() => {}); }
                const bytes = Buffer.concat(chunks); responseComplete = true; responseStatus = response.status;
                try { const raw = JSON.parse(bytes.toString("utf8")); receipt = raw.result?.result ?? raw.result ?? raw; } catch { /* Native parser reports a safe failure. */ }
                return new Response(bytes, { status: response.status, headers: { "content-type": "application/json" } });
              },
            });
            usage = projectUsage(result, receipt, binding.choice.price, kind);
            if (kind === "classifier" && result.stopReason === "stop") validateAnswers(result.answers, context.questions);
            const status = result.stopReason === "stop" ? "completed" : !dispatched ? "not_sent" : !responseComplete ? "unknown" : "failed";
            const safeResult = { api: result.api, provider: result.provider, model: result.model, stopReason: result.stopReason, timestamp: result.timestamp, ...(kind === "classifier" ? { answers: result.answers } : { responseId: result.responseId ?? null }) };
            let storage, output = [], error;
            if (kind === "image" && responseComplete && responseStatus >= 200 && responseStatus < 300) {
              const rawImages = receipt?.choices?.[0]?.message?.images;
              const valid = [], rejected = [];
              if (!Array.isArray(rawImages) || !rawImages.length) rejected.push("IMAGE_OUTPUT_MISSING");
              else if (rawImages.length > budget.maxImagesPerRequest) rejected.push("IMAGE_COUNT_LIMIT");
              else for (const item of rawImages) {
                const url = typeof item?.image_url === "string" ? item.image_url : item?.image_url?.url;
                const match = typeof url === "string" && /^data:([^;]+);base64,(.+)$/u.exec(url);
                try { if (!match) throw fail("IMAGE_CONTENT_INVALID"); valid.push(validateImage({ type: "image", mimeType: match[1], data: match[2] }, budget.maxStorageBytes)); }
                catch (cause) { rejected.push(cause.code ?? "IMAGE_CONTENT_INVALID"); }
              }
              if (valid.length) {
                try {
                  storage = await artifacts.save({ projectPath: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(), taskId, request, images: valid, budget });
                  error = storage.error;
                  output = valid.map(image => ({ type: "image", mimeType: "image/png", data: image.bytes.toString("base64") }));
                } catch (cause) { error = cause.code ?? "IMAGE_SAVE_FAILED"; storage = { status: error === "IMAGE_SAVE_UNKNOWN" ? "unknown" : "failed", error, artifacts: [], bytes: 0 }; }
                if (storage.artifacts.length) {
                  // Keep a confirmed publication even if session association
                  // fails: the provider request must never be regenerated.
                  try { pi.appendEntry("omp-image-artifacts", { version: 1, requestId: request.requestId, artifacts: storage.artifacts }); }
                  catch { error = "IMAGE_SESSION_SAVE_FAILED"; storage.sessionError = error; }
                }
              } else storage = { status: "invalid", artifacts: [], bytes: 0 };
              const partial = rejected.length > 0 || result.stopReason !== "stop" || receipt?.choices?.[0]?.finish_reason !== "stop";
              if (partial && storage.status === "saved") storage.status = "partial";
              error ??= rejected[0] ?? (partial ? "IMAGE_OUTPUT_PARTIAL" : undefined);
              if (rejected.length) storage.rejected = rejected;
            }
            error ??= status === "completed" ? undefined : status === "unknown" ? "MODEL_RESULT_UNKNOWN" : `${prefix}_REQUEST_FAILED`;
            await store.update(taskId, request.requestId, { status, result: safeResult, usage, ...(storage ? { storage } : {}), ...(error ? { error } : {}) });
            // The request ledger owns usage; the native parent must not charge
            // result.usage a second time. Images remain associated with it.
            return { ...safeResult, ...(kind === "image" ? { output, artifacts: storage?.artifacts ?? [], storage, ...(error ? { stopReason: "error" } : {}) } : {}), accounting: { requestId: request.requestId, usage, priceSnapshot: request.priceSnapshot }, ...(error ? { errorMessage: error } : {}) };
          } catch (error) {
            const failure = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : `${prefix}_REQUEST_FAILED`;
            await store.update(taskId, request.requestId, { status: dispatched && !responseComplete ? "unknown" : dispatched ? "failed" : "not_sent", error: failure, ...(usage ? { usage } : {}) });
            throw fail(failure);
          }
      };
      return {
        getModelsOfType: models, getAvailableOfType: async (type, provider) => models(type, provider),
        getModelOfType: (type, provider, id) => models(type, provider).find(model => model.id === id),
        generateImages: (model, context, options) => call("image", model, context, options),
        classify: (model, context, options) => call("classifier", model, context, options),
      };
    },
  };
}
