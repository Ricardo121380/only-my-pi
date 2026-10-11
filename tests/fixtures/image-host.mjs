import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createMcpHost, providerReply, until } from "./mcp-host.mjs";

const terminal = task => ["succeeded", "failed", "cancelled", "interrupted"].includes(task.status);
export async function authorizeImage(f, id, decision = "本任务，按其他额度运行") {
  const waiting = await until(() => f.task(id), task => task.approvals.length || terminal(task), "image consent", 15000);
  assert.equal(waiting.approvals.length, 1, JSON.stringify(waiting));
  await f.request("/api/command", { type: "answerApproval", taskId: id, approvalId: waiting.approvals[0].approvalId, value: decision });
}
export const imageDone = (f, id) => until(() => f.task(id), terminal, "image task terminal", 15000);

// Frozen 64 x 64 RGBA checkerboard, independent of the production validator.
export const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAxElEQVR4nO3QQQ1CQRDA0BWDFYwgDhmIwgA4+LfJG0IPPTZpet7P++eK2+N1ya/7RwdovwE6QPsN0AHab4AO0P7ZHjjtN0AHaL8BOkD7DdAB2m/A9sBpvwE6QPsN0AHab4AO0H4DtgdO+w3QAdpvgA7QfgN0gPYbsD1w2m+ADtB+A3SA9hugA7TfgO2B034DdID2G6ADtN8AHaD9BmwPnPYboAO03wAdoP0G6ADtN2B74LTfAB2g/QboAO03QAdo/+8HfAGV7/pZqR99uQAAAABJRU5ErkJggg==";
export const imageDigest = "e61ccede3be4b0179bfbfdf678991b58e81103a49f2c7ed7887f779450cd95d9";
export const imageContext = { input: [{ type: "text", text: "Generate a synthetic blue and orange checkerboard" }] };
export const imageCode = `const model = await models.getModelOfType("image", "fixtureimage", "checkerboard"); const result = await models.generateImages(model, ${JSON.stringify(imageContext)}); for (const block of result.output) if (block.type === "image") image(block); text({stopReason:result.stopReason, artifacts:result.artifacts, accounting:result.accounting, errorMessage:result.errorMessage});`;
export const imageBudget = { requests: 4, concurrency: 1, maxInputBytes: 8192, maxOutputBytes: 1048576, inputBytes: 32768, outputBytes: 4194304, timeoutMs: 5000, maxImagesPerRequest: 1, images: 4, maxStorageBytes: 1048576, storageBytes: 4194304 };
export const imageReply = { id: "synthetic-image-response", choices: [{ message: { content: "A checkerboard", images: [{ image_url: { url: `data:image/png;base64,${imageBase64}` } }] }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } };
export async function createImageHost({ code = imageCode, scripts, response, assetsRoot, installedExtensions = process.env.OMP_IMAGE_LOCAL_ACCEPTANCE === "1" } = {}) {
  const received = [], sockets = new Set();
  const service = http.createServer(async (req, res) => {
    let raw = ""; for await (const bytes of req) raw += bytes;
    const entry = { url: req.url, requestId: req.headers["x-omp-model-request-id"], key: req.headers.authorization, body: JSON.parse(raw) }; received.push(entry);
    if (response) return response({ req, res, entry, received });
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(imageReply));
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
  const account = (await request("/api/accounts", { name: "生图账号 A", providerId: "fixtureimage", authType: "api_key" }, 201)).account;
  const action = action => request("/api/account-action", { accountId: account.accountId, action });
  const origin = `http://127.0.0.1:${service.address().port}/v1`;
  const receipt = async () => {
    const files = ["packages/model-calls/models.mjs", "packages/model-calls/runtime.mjs", "packages/model-calls/store.mjs", "packages/model-calls/artifacts.mjs", "packages/direct-agent/codemode.mjs", "packages/host/tasks.mjs", "packages/host/server.mjs"];
    const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await fs.readFile(path.join(f.omp, file))).digest("hex")])));
    const ledger = await request(`/api/model-calls?projectId=${f.projectId}`);
    return { scope: "LOCAL_CONTROLLED_SOURCE_HARNESS", node: process.version, pi: "1.1.0", sources, bindings: f.bindings, ledger, sdkSha256: createHash("sha256").update(await fs.readFile(f.sdk)).digest("hex"), nodeSha256: createHash("sha256").update(await fs.readFile(f.stack.nodePath)).digest("hex"), received: received.map(entry => ({ url: entry.url, requestId: entry.requestId, account: entry.key === "Bearer image-fixture-a" ? "synthetic-A" : entry.key === "Bearer image-fixture-b" ? "synthetic-B" : "unexpected", body: entry.body })), receivedCount: received.length, imageDigest };
  };
  return { ...f, get host() { return f.host; }, received, account, action, api: request, receipt, imageOrigin: origin,
    configure: async () => { await action({ type: "configure", config: { baseUrl: origin, api: "openrouter-images", models: [{ type: "image", id: "checkerboard", name: "Synthetic checkerboard", contextWindow: 8192, input: ["text"], output: ["image", "text"] }] } }); await action({ type: "apiKey", key: "image-fixture-a" }); },
    select: (budget = imageBudget, revision = 0) => request("/api/model-calls", { type: "save", projectId: f.projectId, revision, image: { accountId: account.accountId, model: "fixtureimage/checkerboard", budget } }),
    calls: () => request(`/api/model-calls?projectId=${f.projectId}`),
    close: async options => {
      try {
        if (process.env.OMP_IMAGE_EVIDENCE_DIR) { await fs.mkdir(process.env.OMP_IMAGE_EVIDENCE_DIR, { recursive: true }); await fs.writeFile(path.join(process.env.OMP_IMAGE_EVIDENCE_DIR, `${path.basename(f.root)}.json`), JSON.stringify(await receipt(), null, 2)); }
      } finally {
        try { await f.close(options); }
        finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => service.close(resolve)); }
      }
    },
  };
}
