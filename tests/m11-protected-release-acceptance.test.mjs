import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  M11_PROTECTED_ASSERTION_IDS,
  validateM11ProtectedEvidence,
} from "../scripts/m11-release-gates.mjs";
import {
  createM11ProtectedEvidence,
  executeM11ProtectedAcceptance,
  parseM11ProtectedAcceptanceArgs,
} from "../scripts/m11-protected-release-acceptance.mjs";

const sourceCommit = "a".repeat(40);
const output = path.resolve("verification/protected/m11-q11-test.json");

test("Q11 protected runner is plan-first and separates all live authorities", async () => {
  const plan = parseM11ProtectedAcceptanceArgs(["--plan", "--json"]);
  const result = await executeM11ProtectedAcceptance(plan);
  assert.equal(result.mutation, false);
  assert.equal(result.plan.writes, "ZERO");
  assert.equal(result.plan.providerRequests, "NOT_RUN_BY_POLICY");
  assert.throws(() => parseM11ProtectedAcceptanceArgs(["--run", "--yes", "--release-root", "/tmp/rc", "--source-commit", sourceCommit, "--output", output]), { code: "M11_PROTECTED_CONFIRMATION_REQUIRED" });
  const run = parseM11ProtectedAcceptanceArgs(["--run", "--yes", "--terminate-pi", "--authorize-web", "--release-root", "/tmp/rc", "--source-commit", sourceCommit, "--output", output]);
  assert.equal(run.operation, "run");
  assert.equal(run.terminatePi, true);
  assert.equal(run.authorizeWeb, true);
});

test("Q11 evidence binds the exact twenty low-sensitivity release assertions", () => {
  const values = Object.fromEntries(M11_PROTECTED_ASSERTION_IDS.map((id) => [id, { id, proof: "bounded" }]));
  const document = createM11ProtectedEvidence({ sourceCommit, stackId: `sha256:${"1".repeat(64)}`, usage: { tokens: 123, costUsd: 0, wallSeconds: 45, toolCalls: 4, meteredTerminals: 2 }, values });
  assert.equal(document.assertions.length, 20);
  assert.deepEqual(document.assertions.map((entry) => entry.id).sort(), M11_PROTECTED_ASSERTION_IDS);
  assert.equal(validateM11ProtectedEvidence(document, sourceCommit).evidenceDigest, document.evidenceDigest);
  assert.deepEqual(document.usage, { directlyMeteredTokens: 123, variableCostUsd: 0, wallSeconds: 45, toolCalls: 4, meteredTerminals: 2 });
  const drift = structuredClone(document);
  drift.assertions[0].id = "unexpected";
  assert.throws(() => validateM11ProtectedEvidence(drift, sourceCommit), { code: "M11_PROTECTED_EVIDENCE_INVALID" });
});

test("Q11 source keeps failure rollback and leaves only a successful reinstall active", async () => {
  const source = await fs.readFile(path.resolve("scripts/m11-protected-release-acceptance.mjs"), "utf8");
  assert.match(source, /catch \(error\)[\s\S]*if \(active && bootstrap\)[\s\S]*await removeStack\(bootstrap\)/u);
  assert.match(source, /finalStack: "THIN_REINSTALLED"/u);
  assert.match(source, /live\.usage\.tokens > 75_000/u);
  assert.doesNotMatch(source, /API_KEY|AUTHORIZATION|COOKIE/u);
});
