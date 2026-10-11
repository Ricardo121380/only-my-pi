import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createMcpHost, providerReply } from "./mcp-host.mjs";

export const classificationContext = { state: { text: "A helpful example" }, questions: { sentiment: { type: "choice", instructions: "Choose the sentiment", criteria: { positive: "helpful", negative: "unhelpful" } } } };
export const classificationCode = `const model = await models.getModelOfType("classifier", "fixtureclass", "sentiment"); text(await models.classify(model, ${JSON.stringify(classificationContext)}));`;
export const classificationBudget = { requests: 4, concurrency: 1, maxInputBytes: 8192, maxOutputBytes: 8192, inputBytes: 32768, outputBytes: 32768, timeoutMs: 5000 };
export const classificationReply = { answers: { sentiment: { type: "choice", choice: "positive", probabilities: { positive: 0.9, negative: 0.1 }, confidence: 0.9 } }, usage: { input_tokens: 12, output_tokens: 3 } };
export async function createClassificationHost({ code = classificationCode, scripts, response, api = "typesafe-system-one", assetsRoot, installedExtensions = process.env.OMP_CLASSIFIER_LOCAL_ACCEPTANCE === "1" } = {}) {
  const received = [], sockets = new Set();
  const service = http.createServer(async (req, res) => {
    let raw = ""; for await (const bytes of req) raw += bytes;
    const entry = { url: req.url, requestId: req.headers["x-omp-model-request-id"], key: req.headers.authorization, body: JSON.parse(raw) }; received.push(entry);
    if (response) return response({ req, res, entry, received });
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(classificationReply));
  });
  service.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise(resolve => service.listen(0, "127.0.0.1", resolve));
  const f = await createMcpHost({ assetsRoot, installedExtensions, respond: ({ body, res }) => {
    const count = body.messages.filter(m => m.role === "tool").length;
    const source = scripts ? scripts[count] : count ? null : typeof code === "function" ? code(body) : code;
    providerReply(res, source ? "codemode" : null, { code: source });
  } });
  const request = async (route, input, status = 200) => {
    const res = await fetch(f.host.origin + route, { method: input ? "POST" : "GET", headers: { Origin: f.host.origin, Cookie: f.cookie, "content-type": "application/json", "x-omp-account-protocol": "1", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const data = await res.json(); assert.equal(res.status, status, JSON.stringify(data)); return data;
  };
  const account = (await request("/api/accounts", { name: "分类账号 A", providerId: "fixtureclass", authType: "api_key" }, 201)).account;
  const action = action => request("/api/account-action", { accountId: account.accountId, action });
  const receipt = async () => {
    const files = ["packages/model-calls/commands.mjs", "packages/model-calls/models.mjs", "packages/model-calls/runtime.mjs", "packages/model-calls/store.mjs", "packages/direct-agent/codemode.mjs", "packages/host/rpc-worker.mjs", "bin/omp.mjs"];
    const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await fs.readFile(path.join(f.omp, file))).digest("hex")])));
    const pi = JSON.parse(await fs.readFile(path.join(f.stack.root, "pi/package.json"), "utf8"));
    const ledger = await fs.readFile(path.join(f.config, "only-my-pi/model-calls/state.json"), "utf8").then(JSON.parse).catch(() => null);
    for (const task of ledger?.tasks ?? []) delete task.permission;
    return { scope: "LOCAL_CONTROLLED_SOURCE_HARNESS", node: process.version, pi: pi.version, nodeSha256: createHash("sha256").update(await fs.readFile(f.stack.nodePath)).digest("hex"), sources,
      sdkSha256: createHash("sha256").update(await fs.readFile(f.sdk)).digest("hex"), bindings: f.bindings, ledger,
      received: received.map(entry => ({ url: entry.url, requestId: entry.requestId, account: entry.key === "Bearer classification-fixture-a" ? "synthetic-A" : entry.key === "Bearer classification-fixture-b" ? "synthetic-B" : "unexpected", body: entry.body })), receivedCount: received.length };
  };
  return { ...f, get host() { return f.host; }, received, account, action, api: request,
    receipt, classifierOrigin: `http://127.0.0.1:${service.address().port}`,
    configure: async () => { await action({ type: "configure", config: { baseUrl: `http://127.0.0.1:${service.address().port}`, api, models: [{ type: "classifier", id: "sentiment", name: "Sentiment", contextWindow: 8192 }] } }); await action({ type: "apiKey", key: "classification-fixture-a" }); },
    select: (budget = classificationBudget, revision = 0) => request("/api/model-calls", { type: "save", projectId: f.projectId, revision, classifier: { accountId: account.accountId, model: "fixtureclass/sentiment", budget } }),
    calls: () => request(`/api/model-calls?projectId=${f.projectId}`),
    close: async (options) => {
      try {
        if (process.env.OMP_CLASSIFIER_EVIDENCE_DIR) await fs.writeFile(path.join(process.env.OMP_CLASSIFIER_EVIDENCE_DIR, `${path.basename(f.root)}.json`), JSON.stringify(await receipt(), null, 2));
        await f.close(options);
      } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => service.close(resolve)); }
    },
  };
}
