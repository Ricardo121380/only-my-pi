import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCandidateBoundGraphPlan,
  buildCandidateGenerationPlan,
  createCandidateTargetResolver,
  M10_EXACT_PACKAGE_TARGET,
} from "../packages/upstream-migration/index.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (character) => `sha256:${character.repeat(64)}`;

function manifestTarget() {
  return {
    externalPackages: M10_EXACT_PACKAGE_TARGET.map((entry, index) => ({
      ...entry,
      toResolvedUrlDigest: digest(String((index + 1) % 10)),
      toTreeDigest: digest(String((index + 2) % 10)),
    })),
  };
}

test("M10 candidate graph uses the exact future Stable package target without changing HOLD inventory", async () => {
  const plan = await buildCandidateGenerationPlan({ rootDir });
  assert.equal(plan.runtime.pi, "0.84.3");
  assert.equal(plan.packages.length, 7);
  assert.equal(plan.packages.find((entry) => entry.id === "subagents").source.version, "0.57.0");
  assert.equal(plan.packages.find((entry) => entry.id === "permission-modes").source.version, "2.2.0");

  const bound = await buildCandidateBoundGraphPlan({ rootDir, manifest: manifestTarget() });
  assert.equal(bound.packages.length, 0);
  assert.equal(bound.packageBindings.length, 7);
  assert.ok(bound.packageBindings.every((entry) => entry.binding === "external" && entry.owner === "user"));
  assert.match(bound.graphDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("candidate target rejects unsupported profile, package evidence drift, and graph drift", async () => {
  await assert.rejects(buildCandidateGenerationPlan({ rootDir, profileId: "coding" }), TypeError);
  const drifted = manifestTarget();
  drifted.externalPackages.find((entry) => entry.id === "subagents").toVersion = "0.57.1";
  await assert.rejects(buildCandidateBoundGraphPlan({ rootDir, manifest: drifted }), { code: "CANDIDATE_BINDING_DRIFT" });
  const resolver = createCandidateTargetResolver({ rootDir });
  await assert.rejects(resolver.inspect({ manifest: { ...manifestTarget(), candidateGraphDigest: digest("f") } }), { code: "CANDIDATE_GRAPH_DIGEST_DRIFT" });
  await assert.rejects(resolver.alignInstalled({ profileId: "coding" }), TypeError);
});
