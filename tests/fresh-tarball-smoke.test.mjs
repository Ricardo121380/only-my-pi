import assert from "node:assert/strict";
import test from "node:test";

import { verifyFreshDoctor } from "../scripts/fresh-tarball-smoke.mjs";

function doctor(profileId) {
  return {
    ok: profileId !== "daily",
    status: profileId === "daily" ? "FAIL" : "PASS",
    repository: { ok: true },
    runtime: { status: "INSTALLED", incompleteTransactions: [] },
    generation: { status: "VERIFIED", alignment: "MATCH", errorCode: null },
    ...(profileId === "daily" ? {
      code: "OMP_CONTROLLED_STACK_UNAVAILABLE",
      directAgent: { ok: false, status: "DIRECT_AGENT_UPDATE_REQUIRED", code: "OMP_CONTROLLED_STACK_UNAVAILABLE" },
    } : {}),
  };
}

test("fresh Harness smoke verifies minimal readiness and the daily missing-stack guard", () => {
  assert.equal(verifyFreshDoctor(doctor("minimal"), "minimal"), "PASS");
  assert.equal(verifyFreshDoctor(doctor("daily"), "daily"), "CONTROLLED_STACK_REQUIRED");
  assert.throws(() => verifyFreshDoctor(doctor("minimal"), "daily"), { code: "FRESH_DOCTOR_FAILED" });
  assert.throws(() => verifyFreshDoctor(doctor("daily"), "minimal"), { code: "FRESH_DOCTOR_FAILED" });
});

test("an expected missing stack never hides repository, generation or transaction failure", () => {
  for (const mutate of [
    (value) => { value.repository.ok = false; },
    (value) => { value.generation.alignment = "UPDATE_AVAILABLE"; },
    (value) => { value.generation.errorCode = "GENERATION_DRIFT"; },
    (value) => { value.runtime.incompleteTransactions.push({ status: "INTERRUPTED" }); },
    (value) => { value.directAgent.code = "WRITER_UPDATE_REQUIRED"; },
  ]) {
    const value = doctor("daily");
    mutate(value);
    assert.throws(() => verifyFreshDoctor(value, "daily"), { code: "FRESH_DOCTOR_FAILED" });
  }
});
