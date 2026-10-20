import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ModelCallStore, IMAGE_BUDGET } from "../packages/model-calls/store.mjs";
import { canonicalJson } from "../packages/config-runtime/index.mjs";
import { digest } from "../packages/mcp/catalog.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-image-ledger-")); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ModelCallStore(root), definition = { type: "image", provider: "synthetic", id: "image" };
  const choice = { id: "synthetic/image", supported: true, definition, definitionDigest: digest(canonicalJson(definition)), price: null };
  await store.save("/synthetic/project", 0, { accountId: "synthetic", model: choice.id, budget: IMAGE_BUDGET }, async () => [choice], "image");
  await store.begin("task", "/synthetic/project", await store.config("/synthetic/project")); await store.authorize("task", "synthetic-session", "image");
  return { store, root };
}
test("image data requires its versioned reader and corrupt source metadata is rejected without resetting the ledger", async t => {
  const f = await fixture(t), request = await f.store.reserve("task", "parent", { input: [{ type: "text", text: "draw" }] }, "image");
  const state = JSON.parse(await fs.readFile(f.store.file, "utf8")); assert.equal(state.version, 2);
  const old = { ...state, version: 1 }; await fs.writeFile(f.store.file, JSON.stringify(old));
  await assert.rejects(f.store.status("/synthetic/project"), error => error.code === "MODEL_LEDGER_INVALID");
  assert.equal(JSON.parse(await fs.readFile(f.store.file, "utf8")).version, 1);
  state.tasks[0].requests[0].storage = { status: "saved", bytes: 1, artifacts: [{ requestId: request.requestId, index: 0, projectPath: "/another/project" }] };
  await fs.writeFile(f.store.file, JSON.stringify(state)); await assert.rejects(f.store.read(), error => error.code === "MODEL_LEDGER_INVALID");
});
