import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/config-runtime/index.mjs";
import { MODEL_BUDGET, IMAGE_BUDGET, MODEL_BUDGET_LIMITS, IMAGE_BUDGET_LIMITS } from "../packages/model-calls/budgets.mjs";
import { ModelCallStore } from "../packages/model-calls/store.mjs";

for (const [kind, defaults, limits] of [["classifier", MODEL_BUDGET, MODEL_BUDGET_LIMITS], ["image", IMAGE_BUDGET, IMAGE_BUDGET_LIMITS]]) {
  test(`${kind} budget validates every shared field at its limits without admitting invalid values`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-budget-contract-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = new ModelCallStore(root), project = path.join(root, "project");
    const definition = { type: kind, provider: "fixture", id: "native" };
    const choice = { id: "fixture/native", supported: true, price: null, definition, definitionDigest: createHash("sha256").update(canonicalJson(definition)).digest("hex") };
    let revision = 0, lookups = 0;
    const models = async () => { lookups++; return [choice]; };
    assert.ok(Object.isFrozen(defaults)); assert.ok(Object.isFrozen(limits));
    assert.deepEqual(Object.keys(defaults), Object.keys(limits));
    for (const [key, maximum] of Object.entries(limits)) {
      for (const value of [1, maximum]) {
        const budget = { ...defaults, [key]: value };
        const saved = await store.save(project, revision, { accountId: "fixture", model: choice.id, budget }, models, kind);
        revision = saved.revision;
        assert.deepEqual((await store.config(project))[kind].budget, budget);
      }
      for (const value of [0, -1, 1.5, maximum + 1, Infinity, "1", undefined]) {
        const budget = { ...defaults, [key]: value }, before = lookups;
        await assert.rejects(store.save(project, revision, { accountId: "fixture", model: choice.id, budget }, models, kind), error => error.code === `${kind === "image" ? "IMAGE" : "CLASSIFIER"}_CONFIG_INVALID` && error.status === 400);
        assert.equal(lookups, before, "invalid budgets are rejected before model lookup or persistence");
      }
    }
    await assert.rejects(store.save(project, revision, { accountId: "fixture", model: choice.id, budget: { ...defaults, extra: 1 } }, models, kind), { code: `${kind === "image" ? "IMAGE" : "CLASSIFIER"}_CONFIG_INVALID` });
    assert.equal((await store.config(project)).revision, revision);
  });
}
