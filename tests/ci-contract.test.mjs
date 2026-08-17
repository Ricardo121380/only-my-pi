import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("CI executes the same manifest-backed verify runner without credentials", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run verify -- --run/);
  assert.match(workflow, /receipt:check/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/u);
  assert.match(workflow, /permissions:\n\s+contents: read/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN|OPENAI_API_KEY|DEEPSEEK_API_KEY|secrets\./u);
});
