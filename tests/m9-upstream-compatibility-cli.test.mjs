import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createM9CompatibilityPlan,
  parseM9CompatibilityArgs,
  runM9Compatibility,
} from "../scripts/m9-upstream-compatibility.mjs";

test("M9 CLI plan is non-mutating and reports the later M10 promotion", async () => {
  const args = parseM9CompatibilityArgs(["--plan", "--json"]);
  const result = await runM9Compatibility(args);
  assert.equal(result.status, "PLAN_ONLY");
  assert.equal(result.action, "VALIDATE_CONTRACT");
  assert.equal(result.realPiHome, "NOT_TOUCHED");
  assert.equal(result.promptSubmitted, false);
  assert.equal(result.decision.state, "PROMOTE");
  assert.equal(result.decision.reasonCode, "M10_REAL_ROOT_AND_LIVE_ACCEPTANCE_PASSED");
  assert.equal(result.decision.defaultPiVersion, "0.84.3");
  assert.equal(result.decision.defaultSubagentsVersion, "0.57.0");
});

test("M9 CLI requires explicit disposable roots and rejects ambiguous probe input", () => {
  assert.throws(() => parseM9CompatibilityArgs(["--probe"]), /--installation-root/u);
  assert.throws(() => parseM9CompatibilityArgs(["--probe", "--installation-root", "/tmp/m9"]), /--config-root/u);
  assert.throws(() => parseM9CompatibilityArgs(["--config-root", "/tmp/m9"]), /only valid with --probe/u);
  assert.throws(() => parseM9CompatibilityArgs(["--probe", "--plan"]), /mutually exclusive/u);
  assert.throws(() => parseM9CompatibilityArgs(["--installation-root", "relative"]), /absolute non-root/u);
  assert.throws(() => parseM9CompatibilityArgs(["--probe", "--installation-root", "/tmp/m9", "--config-root", "/tmp/config", "--pi-command", "pi"]), /absolute executable/u);
  const args = parseM9CompatibilityArgs([
    "--probe",
    "--installation-root", "/tmp/m9",
    "--config-root", "/tmp/config",
    "--pi-command", "/tmp/m9/node_modules/.bin/pi",
    "--only-my-pi-root", "/tmp/only-my-pi",
    "--json",
  ]);
  assert.equal(args.probe, true);
  assert.equal(args.installationRoot, path.resolve("/tmp/m9"));
  assert.equal(createM9CompatibilityPlan(args).action, "AUDIT_AND_NO_MODEL_PROBE");
});

test("M9 CLI delegates only to the injected no-model probe after contract planning", async () => {
  const args = parseM9CompatibilityArgs(["--plan"]);
  let called = false;
  const result = await runM9Compatibility(args, {
    probeFactory() {
      called = true;
      throw new Error("plan must not construct a probe");
    },
  });
  assert.equal(called, false);
  assert.equal(result.providerRequest, "NOT_RUN_BY_POLICY");
  assert.equal(result.childDispatch, "NOT_REQUESTED");
});
