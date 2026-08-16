import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_RELEASE_GATE_IDS,
  loadReleaseGatesManifest,
  releaseGatesDigest,
  resolveReleaseGate,
  validateReleaseGateIdSet,
  validateReleaseGatesManifest,
} from "../scripts/lib/release-gates.mjs";
import { inspectReleaseGates, parseReleaseGateArgs } from "../scripts/release-gates.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifestPath = path.join(root, "verification", "release-gates-v1.json");
const fixtureRoot = path.join(root, "verification", "fixtures", "release-gates");
const packageManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mutateManifest(base, fixture) {
  const value = structuredClone(base);
  if (fixture.operation === "set-gate-field") {
    const gate = value.gates.find((item) => item.id === fixture.gateId);
    assert.ok(gate, `fixture gate missing: ${fixture.gateId}`);
    gate[fixture.field] = fixture.value;
  } else if (fixture.operation === "set-policy-field") {
    value.policy[fixture.field] = fixture.value;
  } else if (fixture.operation === "duplicate-gate") {
    const gate = value.gates.find((item) => item.id === fixture.gateId);
    value.gates.push(structuredClone(gate));
  } else if (fixture.operation === "remove-gate") {
    value.gates = value.gates.filter((item) => item.id !== fixture.gateId);
  } else if (fixture.operation === "add-top-level-field") {
    value[fixture.field] = fixture.value;
  } else {
    assert.fail(`unsupported fixture operation: ${fixture.operation}`);
  }
  return value;
}

test("release-gates-v1 fixes the required gate IDs and exact command tuples", () => {
  const manifest = loadReleaseGatesManifest(manifestPath);
  const expected = readJson(path.join(fixtureRoot, "expected.json"));
  assert.equal(manifest.id, expected.manifestId);
  assert.deepEqual(manifest.gates.map((gate) => gate.id), expected.requiredGateIds);
  assert.deepEqual([...REQUIRED_RELEASE_GATE_IDS], expected.requiredGateIds);
  assert.equal(expected.receiptRunnerIsGate, false);
  assert.equal(manifest.gates.some((gate) => gate.command === "npm" && gate.args[0] === "run" && gate.args[1] === "verify"), false);
  assert.match(releaseGatesDigest(manifest), /^sha256:[a-f0-9]{64}$/);
});

test("the public verify script is the non-executing v1 inspector", () => {
  const manifest = loadReleaseGatesManifest(manifestPath);
  assert.equal(packageManifest.scripts.verify, "node scripts/release-gates.mjs --json");
  assert.equal(packageManifest.scripts["receipt:check"], "node scripts/release-receipt-check.mjs");
  assert.match(manifest.description, /Local verification and CI both execute/);
  assert.match(manifest.description, /not itself a gate/);
});

test("resolved gates are immutable and expose no argv override", () => {
  const manifest = loadReleaseGatesManifest(manifestPath);
  const gate = resolveReleaseGate(manifest, "schema-check");
  assert.deepEqual(gate.args, ["run", "schema:check"]);
  assert.equal(gate.cwd, "repository-root");
  assert.equal(Object.isFrozen(gate), true);
  assert.equal(Object.isFrozen(gate.args), true);
  assert.throws(() => gate.args.push("--unsafe"), TypeError);
  assert.throws(() => resolveReleaseGate(manifest, "../../shell"), /invalid gate ID/);
  assert.throws(() => resolveReleaseGate(manifest, "unknown-gate"), /unknown gate ID/);
});

test("release gate ID set rejects duplicate, missing, and unknown IDs", () => {
  assert.deepEqual(validateReleaseGateIdSet([...REQUIRED_RELEASE_GATE_IDS]), [...REQUIRED_RELEASE_GATE_IDS]);
  assert.throws(() => validateReleaseGateIdSet([...REQUIRED_RELEASE_GATE_IDS, "lint"]), /duplicates/);
  assert.throws(() => validateReleaseGateIdSet(REQUIRED_RELEASE_GATE_IDS.slice(1)), /gate ID set mismatch/);
  assert.throws(() => validateReleaseGateIdSet([...REQUIRED_RELEASE_GATE_IDS.slice(1), "unknown"]), /gate ID set mismatch/);
});

test("release gate negative fixtures fail closed", async (t) => {
  const base = readJson(manifestPath);
  const negatives = fs.readdirSync(path.join(fixtureRoot, "negative")).filter((file) => file.endsWith(".json")).sort();
  assert.ok(negatives.length >= 8);
  for (const file of negatives) {
    await t.test(file, () => {
      const fixture = readJson(path.join(fixtureRoot, "negative", file));
      const candidate = mutateManifest(base, fixture);
      assert.throws(() => validateReleaseGatesManifest(candidate), new RegExp(fixture.expectedError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  }
});

test("release gate CLI parser rejects overrides and path escape", () => {
  assert.throws(() => parseReleaseGateArgs(["--gate", "lint", "--gate", "typecheck"]), /duplicate --gate/);
  assert.deepEqual(parseReleaseGateArgs(["--run"]), {
    manifest: manifestPath,
    gate: null,
    json: false,
    help: false,
    run: true,
    output: null,
  });
  assert.throws(() => parseReleaseGateArgs(["--output", "verification/receipts/x.json"]), /requires --run/);
  assert.throws(() => parseReleaseGateArgs(["--manifest"]), /requires a path/);
  assert.throws(
    () => inspectReleaseGates(["--manifest", "package.json"]),
    /manifest path must stay inside the verification root/,
  );
  const result = inspectReleaseGates(["--gate", "diff-check", "--json"]);
  assert.equal(result.executable, false);
  assert.deepEqual(result.gate.args, ["diff", "--check"]);
});
