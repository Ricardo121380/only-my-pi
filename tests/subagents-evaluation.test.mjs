import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeCorpusContentDigest,
  evaluateCorpus,
  loadEvaluationCorpus,
  runOfflineEvaluation,
  validateEvaluationCorpus,
} from "../verification/evaluation/subagents-v1/evaluator.mjs";

function clonedManifest() {
  return structuredClone(loadEvaluationCorpus().manifest);
}

test("offline subagents corpus is non-vacuous, deterministic, provenance-bound, and makes no live claim", () => {
  const first = runOfflineEvaluation();
  const second = runOfflineEvaluation();
  assert.deepEqual(first, second);
  assert.equal(first.verdict, "PASS");
  assert.equal(first.claim, "CONTRACT_PREVIEW_OFFLINE_SIMULATOR");
  assert.equal(first.liveQualityClaim, false);
  assert.equal(first.caseCount, 15);
  assert.equal(first.repetitionCount, 3);
  assert.equal(first.metrics["verified-success-rate"].value, 1);
  assert.equal(first.metrics["unsafe-admission-rate"].value, 0);
  assert.equal(first.baselines.find((entry) => entry.kind === "v1").metrics["verified-success-rate"], 0.6);
});

test("manifest digest, generator identity, required metrics, and thresholds fail closed", () => {
  const drifted = clonedManifest();
  drifted.seed += 1;
  assert.throws(() => validateEvaluationCorpus(drifted), { code: "CONTENT_DIGEST_DRIFT" });

  const generator = clonedManifest();
  generator.generator.version = "9.9.9";
  generator.contentDigest = computeCorpusContentDigest(generator);
  assert.throws(() => validateEvaluationCorpus(generator), { code: "GENERATOR_DRIFT" });

  const missingMetric = clonedManifest();
  missingMetric.metrics = missingMetric.metrics.filter((entry) => entry.id !== "budget-overshoot-rate");
  for (const baseline of missingMetric.baselines) delete baseline.metrics["budget-overshoot-rate"];
  missingMetric.contentDigest = computeCorpusContentDigest(missingMetric);
  assert.throws(() => validateEvaluationCorpus(missingMetric), { code: "MISSING_METRIC" });

  const incoherent = clonedManifest();
  incoherent.metrics[0].acceptanceThreshold.operator = "<=";
  incoherent.contentDigest = computeCorpusContentDigest(incoherent);
  assert.throws(() => validateEvaluationCorpus(incoherent), { code: "INVALID_THRESHOLD" });
});

test("fixture bytes are digest-bound and a changed baseline cannot silently pass", (t) => {
  const source = path.resolve("verification/evaluation/subagents-v1");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-subagents-eval-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(source, root, { recursive: true });
  const manifestPath = path.join(root, "manifest.json");
  const fixturePath = path.join(root, "fixtures", "agent-correlated.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  fixture.input.observed.childId = "tampered-child";
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  assert.throws(() => runOfflineEvaluation({ manifestPath }), { code: "FIXTURE_DIGEST_DRIFT" });

  const loaded = loadEvaluationCorpus();
  const baselineDrift = structuredClone(loaded.manifest);
  baselineDrift.baselines.find((entry) => entry.kind === "current-release").metrics["verified-success-rate"] = 0.5;
  baselineDrift.contentDigest = computeCorpusContentDigest(baselineDrift);
  assert.throws(() => evaluateCorpus(baselineDrift, { corpusRoot: loaded.corpusRoot }), { code: "BASELINE_DRIFT" });
});
