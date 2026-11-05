import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const name of ["store", "models", "runtime", "artifacts", "history"]) {
  test(`model-calls ${name} loads without Host command schemas or MCP catalogs`, () => {
    const entry = new URL(`../packages/model-calls/${name}.mjs`, import.meta.url).href;
    const script = `import { registerHooks } from "node:module";
      const loaded = [];
      registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context); } });
      await import(${JSON.stringify(entry)});
      process.stdout.write(JSON.stringify(loaded.filter(url => /\\/packages\\/(host|mcp)\\//u.test(url))));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
  });
}

test("model-call errors preserve the public code and status shape", async () => {
  const { modelCallError } = await import("../packages/model-calls/contracts.mjs");
  const error = modelCallError("MODEL_LEDGER_INVALID", 409);
  assert.ok(error instanceof Error);
  assert.equal(error.message, "MODEL_LEDGER_INVALID");
  assert.deepEqual({ ...error }, { code: "MODEL_LEDGER_INVALID", status: 409 });
  assert.equal(modelCallError("CLASSIFIER_CONFIG_INVALID").status, 400);
});
