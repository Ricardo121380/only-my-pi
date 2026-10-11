import { randomUUID } from "node:crypto";
import { ModelCallStore } from "./store.mjs";
import { classifierRuntime } from "./models.mjs";
import { hostError } from "../host/contracts.mjs";

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
function projectUsage(result, receipt, price) {
  const wire = receipt?.usage;
  // Pi treats malformed/missing token fields as zero; preserve that coverage gap
  // instead of upgrading the SDK's fallback zeros to reported provider facts.
  const reported = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const coverage = { input: reported(wire?.input_tokens), output: reported(wire?.output_tokens) };
  const complete = coverage.input !== null && coverage.output !== null;
  const tokens = complete ? { ...coverage, totalTokens: coverage.input + coverage.output } : null;
  return { status: complete ? "reported" : "unknown", tokens, coverage, estimatedCost: complete && price && Number.isFinite(result.usage?.cost?.total) ? result.usage.cost.total : null, source: "provider receipt", costSource: "Pi SDK catalog estimate", bill: false };
}

export function createClassificationControl(pi, { sdkFile, configRoot }) {
  const store = new ModelCallStore(configRoot);
  let snapshot, taskId, ended = true, approved = false, approvalPending, starting;
  const finish = async () => { if (!ended && taskId) { ended = true; approved = false; await store.end(taskId); } };
  const start = async ctx => {
    await finish();
    snapshot = process.env.OMP_HOST_CLASSIFIER_SNAPSHOT ? JSON.parse(process.env.OMP_HOST_CLASSIFIER_SNAPSHOT) : await store.config(ctx.cwd);
    taskId = process.env.OMP_HOST_INPUT_TASK_ID ?? `cli_${randomUUID()}`;
    if (snapshot.projectPath !== ctx.cwd) throw fail("CLASSIFIER_PROJECT_MISMATCH");
    if (snapshot.classifier) { await store.begin(taskId, ctx.cwd, snapshot); ended = false; }
  };
  // sendCustomMessage(triggerTurn), used by durable WebUI input, bypasses
  // before_agent_start. Both that path and prompt emit the public agent_start.
  pi.on("agent_start", (_event, ctx) => { starting = start(ctx); return starting; });
  pi.on("agent_end", finish);
  pi.on("session_shutdown", finish);
  return {
    async registry(ctx, parentToolCallId, signal, check) {
      await starting;
      const binding = snapshot?.classifier;
      const selected = binding?.choice.definition;
      const models = (type, provider) => type === "classifier" && selected && (!provider || provider === selected.provider) ? [selected] : [];
      return {
        getModelsOfType: models, getAvailableOfType: async (type, provider) => models(type, provider),
        getModelOfType: (type, provider, id) => models(type, provider).find(model => model.id === id),
        generateImages: async () => { throw fail("IMAGE_MODEL_DISABLED"); },
        async classify(model, context, options) {
          if (!binding || ended) throw fail("CLASSIFIER_NOT_CONFIGURED");
          check();
          if (model.provider !== selected.provider || model.id !== selected.id) throw fail("CLASSIFIER_MODEL_NOT_BOUND");
          if (context.images?.length) throw fail("CLASSIFIER_IMAGE_INPUT_UNAVAILABLE");
          if (!approved) {
            approvalPending ??= (async () => {
              if (!ctx.hasUI) throw fail("CLASSIFIER_APPROVAL_REQUIRED");
              const budget = binding.budget;
              const decision = await ctx.ui.select(`Codemode · 分类\n项目 ${ctx.cwd}\n账号 ${binding.accountId} · 模型 ${binding.model}\n任务 ${taskId}\n次数 ${budget.requests} · 并发 ${budget.concurrency}\n输入 ${budget.inputBytes} 字节 · 输出 ${budget.outputBytes} 字节\n费用上限未知；仅按其他额度运行，SDK 估算不是账单。未知结果继续占额，不自动重试。`, ["拒绝", "本任务，按其他额度运行"]);
              check();
              if (decision !== "本任务，按其他额度运行") throw fail("CLASSIFIER_CALL_DENIED");
              await store.authorize(taskId, ctx.sessionManager.getSessionId()); approved = true;
            })();
            try { await approvalPending; } finally { approvalPending = undefined; }
          }
          check();
          const current = await classifierRuntime({ configRoot, sdkFile, accountId: binding.accountId, modelId: binding.model });
          if (current.choice.definitionDigest !== binding.choice.definitionDigest) throw fail("CLASSIFIER_DEFINITION_CHANGED");
          const request = await store.reserve(taskId, parentToolCallId, context);
          let dispatched = false, receipt, responseComplete = false, failure;
          const budget = binding.budget, deadline = AbortSignal.timeout(budget.timeoutMs), boundedSignal = AbortSignal.any([signal, options?.signal, deadline].filter(Boolean));
          try {
            const auth = await current.runtime.getAuth(current.model, { env: {} });
            if (!auth?.auth?.apiKey) throw fail("CLASSIFIER_CREDENTIAL_MISSING");
            // Pi 1.1.0's usage parser needs a cost object even when the catalog
            // omits prices. This parsing placeholder never becomes a price or bill.
            const nativeModel = current.model.cost ? current.model : { ...current.model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
            const result = await current.runtime.classify(nativeModel, context, { signal: boundedSignal, env: {}, apiKey: auth.auth.apiKey, maxRetries: 0, timeoutMs: budget.timeoutMs,
              fetch: async (url, options) => {
                check(); boundedSignal.throwIfAborted();
                if (dispatched) throw fail("MODEL_RETRY_DENIED");
                const target = new URL(url), base = new URL(current.model.baseUrl);
                const endpoint = { "typesafe-system-one": "systemone", "openai-decisions": "decisions", "cloudflare-workers-ai-system-one": "run" }[current.model.api];
                if (target.href !== new URL(endpoint, `${base.href.replace(/\/+$/u, "")}/`).href || target.username || target.password || target.search || target.hash) throw fail("CLASSIFIER_TARGET_CHANGED");
                const inputBytes = Buffer.byteLength(typeof options?.body === "string" ? options.body : "");
                if (!inputBytes || inputBytes > budget.maxInputBytes) throw fail("MODEL_INPUT_LIMIT");
                // Recheck persisted credentials and definition immediately before
                // the durable dispatch marker; no environment/account fallback.
                const live = await classifierRuntime({ configRoot, sdkFile, accountId: binding.accountId, modelId: binding.model });
                if (live.choice.definitionDigest !== binding.choice.definitionDigest) throw fail("CLASSIFIER_DEFINITION_CHANGED");
                const liveAuth = await live.runtime.getAuth(live.model, { env: {} });
                if (liveAuth?.auth?.apiKey !== auth.auth.apiKey) throw fail("CLASSIFIER_CREDENTIAL_CHANGED");
                let responsePending;
                const headers = new Headers(options.headers);
                if (headers.get("authorization") !== `Bearer ${auth.auth.apiKey}`) throw fail("CLASSIFIER_CREDENTIAL_CHANGED");
                headers.set("x-omp-model-request-id", request.requestId);
                await store.dispatch(taskId, request.requestId, { inputBytes }, () => {
                  check(); boundedSignal.throwIfAborted(); dispatched = true;
                  responsePending = fetch(url, { ...options, headers, signal: boundedSignal, redirect: "error" });
                  responsePending.catch(() => {}); // Observed after the durable transaction releases its lock.
                });
                const response = await responsePending;
                const reader = response.body?.getReader(); let count = 0; const chunks = [];
                if (!reader) throw fail("CLASSIFIER_RESPONSE_MISSING");
                try { for (;;) { const item = await reader.read(); if (item.done) break; count += item.value.byteLength; if (count > budget.maxOutputBytes) throw fail("MODEL_OUTPUT_LIMIT"); chunks.push(Buffer.from(item.value)); } }
                finally { await reader.cancel().catch(() => {}); }
                const bytes = Buffer.concat(chunks); responseComplete = true;
                try { const raw = JSON.parse(bytes.toString("utf8")); receipt = raw.result?.result ?? raw.result ?? raw; } catch { /* Native parser supplies the error; no raw body enters diagnostics. */ }
                return new Response(bytes, { status: response.status, headers: { "content-type": "application/json" } });
              },
            });
            if (result.stopReason === "stop") validateAnswers(result.answers, context.questions);
            const status = result.stopReason === "stop" ? "completed" : !dispatched ? "not_sent" : !responseComplete ? "unknown" : "failed";
            const safeResult = { api: result.api, provider: result.provider, model: result.model, answers: result.answers, stopReason: result.stopReason, timestamp: result.timestamp };
            const usage = projectUsage(result, receipt, binding.choice.price);
            await store.update(taskId, request.requestId, { status, result: safeResult, usage, ...(status === "completed" ? {} : { error: status === "unknown" ? "MODEL_RESULT_UNKNOWN" : "CLASSIFIER_REQUEST_FAILED" }) });
            // Native codemode sums result.usage into the parent tool. Keep the
            // single ledger charge and expose its sourced, possibly partial facts.
            return { ...safeResult, accounting: { requestId: request.requestId, usage, priceSnapshot: request.priceSnapshot }, ...(status === "completed" ? {} : { errorMessage: status === "unknown" ? "MODEL_RESULT_UNKNOWN" : "CLASSIFIER_REQUEST_FAILED" }) };
          } catch (error) {
            failure = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "CLASSIFIER_REQUEST_FAILED";
            await store.update(taskId, request.requestId, { status: dispatched ? "unknown" : "not_sent", error: failure });
            throw fail(failure);
          }
        },
      };
    },
  };
}
