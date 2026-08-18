import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson, sha256, withoutKey } from "../../../packages/subagents/state/codec.mjs";
import { IMPLEMENTATIONS, SIMULATOR_ID, SIMULATOR_VERSION, simulateFixture, simulatorSourceDigest } from "./simulator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = path.join(HERE, "manifest.json");
const DEFAULT_SCHEMA_PATH = path.resolve(HERE, "../../../schemas/evaluation-corpus-v1.schema.json");
const METRIC_IDS = Object.freeze([
  "verified-success-rate",
  "deterministic-replay-rate",
  "provenance-completeness-rate",
  "unsafe-admission-rate",
  "stable-order-violation-rate",
  "budget-overshoot-rate",
  "duplicate-effect-rate",
  "unproven-cancellation-success-rate",
]);

export class EvaluationCorpusError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents offline evaluation: ${message}`);
    this.name = "EvaluationCorpusError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new EvaluationCorpusError(message, code, details);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizedManifestForDigest(manifest) {
  return withoutKey(withoutKey(manifest, "$schema"), "contentDigest");
}

export function computeCorpusContentDigest(manifest) {
  return sha256(normalizedManifestForDigest(manifest));
}

function ensureContained(rootDir, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath) || relativePath.includes("\0") || relativePath.split("/").includes("..")) {
    fail(`unsafe fixture path: ${relativePath}`, "UNSAFE_FIXTURE_PATH");
  }
  const absolute = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`fixture escapes corpus root: ${relativePath}`, "UNSAFE_FIXTURE_PATH");
  const realRoot = fs.realpathSync(rootDir);
  const realFile = fs.realpathSync(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) fail(`fixture symlink escapes corpus root: ${relativePath}`, "UNSAFE_FIXTURE_PATH");
  return absolute;
}

function uniqueIds(entries, label) {
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail(`${label} ids must be unique`, "DUPLICATE_ID", { label });
}

function assertSemanticManifest(manifest) {
  uniqueIds(manifest.metrics, "metric");
  uniqueIds(manifest.baselines, "baseline");
  uniqueIds(manifest.scenarios, "scenario");
  const caseIds = manifest.scenarios.flatMap((scenario) => scenario.cases.map((entry) => entry.id));
  if (new Set(caseIds).size !== caseIds.length) fail("case ids must be globally unique", "DUPLICATE_ID", { label: "case" });
  const metricIds = new Set(manifest.metrics.map((metric) => metric.id));
  for (const required of METRIC_IDS) if (!metricIds.has(required)) fail(`required metric is missing: ${required}`, "MISSING_METRIC");
  for (const metric of manifest.metrics) {
    const coherent = (metric.direction === "maximize" && metric.acceptanceThreshold.operator === ">=")
      || (metric.direction === "minimize" && metric.acceptanceThreshold.operator === "<=")
      || (metric.direction === "exact" && metric.acceptanceThreshold.operator === "==");
    if (!coherent) fail(`metric ${metric.id} has incoherent direction/operator`, "INVALID_THRESHOLD");
  }
  for (const baseline of manifest.baselines) {
    if (!IMPLEMENTATIONS.includes(baseline.implementation)) fail(`unknown baseline implementation: ${baseline.implementation}`, "UNKNOWN_BASELINE");
    const baselineMetricIds = Object.keys(baseline.metrics);
    if (baselineMetricIds.length !== metricIds.size || baselineMetricIds.some((id) => !metricIds.has(id))) {
      fail(`baseline ${baseline.id} does not cover every metric`, "INCOMPLETE_BASELINE");
    }
  }
  if (!manifest.baselines.some((baseline) => baseline.kind !== "current-release")) {
    fail("at least one non-current baseline is required", "CURRENT_ONLY_BASELINE");
  }
  if (manifest.scenarios.length === 0 || caseIds.length === 0) fail("corpus cannot be empty", "VACUOUS_CORPUS");
}

export function validateEvaluationCorpus(manifest, { schemaPath = DEFAULT_SCHEMA_PATH } = {}) {
  const schema = readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const valid = validate(manifest);
  if (!valid) fail("manifest schema validation failed", "MANIFEST_SCHEMA_INVALID", { errors: validate.errors ?? [] });
  assertSemanticManifest(manifest);
  if (manifest.generator.id !== SIMULATOR_ID || manifest.generator.version !== SIMULATOR_VERSION || manifest.generator.sourceDigest !== simulatorSourceDigest()) {
    fail("generator identity or digest does not match the deterministic simulator", "GENERATOR_DRIFT");
  }
  const actualDigest = computeCorpusContentDigest(manifest);
  if (actualDigest !== manifest.contentDigest) fail("manifest content digest drift detected", "CONTENT_DIGEST_DRIFT", { expected: manifest.contentDigest, actual: actualDigest });
  return true;
}

function fixtureEntries(manifest) {
  return manifest.scenarios.flatMap((scenario) => scenario.cases.map((entry) => ({ scenario, case: entry })));
}

function loadFixtures(manifest, corpusRoot) {
  return fixtureEntries(manifest).map(({ scenario, case: caseEntry }) => {
    const fixturePath = ensureContained(corpusRoot, caseEntry.fixturePath);
    const fixture = readJson(fixturePath);
    const actualDigest = sha256(fixture);
    if (actualDigest !== caseEntry.fixtureDigest) {
      fail(`fixture digest drift detected: ${caseEntry.fixturePath}`, "FIXTURE_DIGEST_DRIFT", { expected: caseEntry.fixtureDigest, actual: actualDigest });
    }
    if (fixture.kind !== scenario.category) fail(`fixture kind does not match scenario category: ${caseEntry.id}`, "FIXTURE_CATEGORY_MISMATCH");
    return { scenario, case: caseEntry, fixture };
  });
}

function provenanceComplete(result, entry, manifest, seed, repetition) {
  return result.simulator?.id === manifest.generator.id
    && result.simulator?.version === manifest.generator.version
    && result.fixtureId === entry.fixture.id
    && result.fixtureDigest === entry.case.fixtureDigest
    && result.seed === seed
    && result.repetition === repetition
    && /^sha256:[a-f0-9]{64}$/u.test(result.resultDigest);
}

function aggregateImplementation(manifest, entries, implementation) {
  const counters = Object.fromEntries(METRIC_IDS.map((id) => [id, { numerator: 0, denominator: 0 }]));
  for (let repetition = 0; repetition < manifest.repetitions; repetition += 1) {
    const seed = manifest.seed + repetition;
    for (const entry of entries) {
      const options = { implementation, seed, repetition, fixtureDigest: entry.case.fixtureDigest };
      const first = simulateFixture(entry.fixture, options);
      const replay = simulateFixture(structuredClone(entry.fixture), options);
      const deterministic = canonicalJson(first) === canonicalJson(replay);
      const values = {
        "verified-success-rate": first.verdict === entry.case.expectedVerdict,
        "deterministic-replay-rate": deterministic,
        "provenance-completeness-rate": provenanceComplete(first, entry, manifest, seed, repetition),
        "unsafe-admission-rate": first.signals.unsafeAdmission,
        "stable-order-violation-rate": first.signals.stableOrderViolation,
        "budget-overshoot-rate": first.signals.budgetOvershoot,
        "duplicate-effect-rate": first.signals.duplicateEffect,
        "unproven-cancellation-success-rate": first.signals.unprovenCancellationSuccess,
      };
      for (const [id, value] of Object.entries(values)) {
        counters[id].denominator += 1;
        if (value) counters[id].numerator += 1;
      }
    }
  }
  return Object.fromEntries(Object.entries(counters).map(([id, value]) => {
    if (value.denominator === 0) fail(`metric ${id} has no observations`, "VACUOUS_METRIC");
    return [id, value.numerator / value.denominator];
  }));
}

function thresholdPass(metric, value) {
  const threshold = metric.acceptanceThreshold;
  if (threshold.operator === ">=") return value >= threshold.value;
  if (threshold.operator === "<=") return value <= threshold.value;
  return value === threshold.value;
}

function assertBaselineMeasurements(manifest, measured) {
  for (const baseline of manifest.baselines) {
    const actual = measured[baseline.implementation];
    for (const metric of manifest.metrics) {
      if (baseline.metrics[metric.id] !== actual[metric.id]) {
        fail(`declared baseline drift: ${baseline.id}/${metric.id}`, "BASELINE_DRIFT", {
          expected: baseline.metrics[metric.id],
          actual: actual[metric.id],
        });
      }
    }
  }
}

export function evaluateCorpus(manifest, { corpusRoot = HERE } = {}) {
  validateEvaluationCorpus(manifest);
  const entries = loadFixtures(manifest, corpusRoot);
  if (entries.length === 0) fail("corpus has no fixture cases", "VACUOUS_CORPUS");
  const implementations = [...new Set(manifest.baselines.map((baseline) => baseline.implementation))];
  const measured = Object.fromEntries(implementations.map((implementation) => [implementation, aggregateImplementation(manifest, entries, implementation)]));
  assertBaselineMeasurements(manifest, measured);
  const current = measured["current-release"];
  if (!current) fail("current-release measured baseline is required", "MISSING_CURRENT_BASELINE");
  const metricResults = Object.fromEntries(manifest.metrics.map((metric) => [metric.id, {
    value: current[metric.id],
    direction: metric.direction,
    acceptanceThreshold: metric.acceptanceThreshold,
    passed: thresholdPass(metric, current[metric.id]),
  }]));
  const passed = Object.values(metricResults).every((metric) => metric.passed);
  const report = {
    formatVersion: 1,
    claim: "CONTRACT_PREVIEW_OFFLINE_SIMULATOR",
    liveQualityClaim: false,
    corpus: { id: manifest.id, version: manifest.version, contentDigest: manifest.contentDigest },
    generator: { id: manifest.generator.id, version: manifest.generator.version, sourceDigest: manifest.generator.sourceDigest },
    environment: manifest.environment,
    caseCount: entries.length,
    repetitionCount: manifest.repetitions,
    baselines: manifest.baselines.map((baseline) => ({ id: baseline.id, kind: baseline.kind, implementation: baseline.implementation, metrics: measured[baseline.implementation] })),
    metrics: metricResults,
    verdict: passed ? "PASS" : "FAIL",
  };
  return Object.freeze({ ...report, reportDigest: sha256(report) });
}

export function loadEvaluationCorpus({ manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  const manifest = readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  return { manifest, corpusRoot };
}

export function runOfflineEvaluation(options = {}) {
  const loaded = loadEvaluationCorpus(options);
  return evaluateCorpus(loaded.manifest, { corpusRoot: loaded.corpusRoot });
}
