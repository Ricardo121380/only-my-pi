import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const contractPath = path.join(root, "contracts", "execution-state-driver-v1.json");
const fixtureRoot = path.join(root, "verification", "fixtures", "execution-state-driver");

const SURFACE_IDS = [
  "toolCallPolicy",
  "bashSandbox",
  "fileToolPolicy",
  "webEgress",
  "mcpEgress",
  "providerEgress",
  "extensionEgress",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateEvidence(candidate) {
  assert.equal(candidate.formatVersion, 1, "unsupported execution-state evidence version");
  assert.equal(candidate.evidenceKind, "static-package-audit", "unsupported evidence kind");
  assert.equal(candidate.package, "pi-permission-modes", "unexpected execution-state package");
  assert.equal(candidate.version, "2.2.0", "unexpected execution-state package version");
  assert.deepEqual(candidate.publicExports, [], "pi-permission-modes exposes no public package API");

  for (const specifier of candidate.runtimeImports) {
    assert.doesNotMatch(specifier, /^pi-permission-modes\/src(?:\/|$)/, "private package import is forbidden");
  }
  assert.deepEqual(candidate.runtimeImports, [], "runtime package imports are unsupported by the audited public surface");
  assert.deepEqual(candidate.owners, ["pi-permission-modes"], "exactly one execution-state owner is required");
  assert.equal(candidate.canReadState, false, "state-read claim contradicts the public surface");
  assert.equal(candidate.canSwitchAtRuntime, false, "runtime hot-switch claim contradicts the public surface");
  assert.equal(candidate.applyStatus, "RESTART_REQUIRED", "hard policy changes require restart");
  assert.equal(candidate.wholeSessionIsolated, false, "Bash sandbox cannot prove whole-session isolation");

  assert.deepEqual(Object.keys(candidate.surfaceStates).sort(), [...SURFACE_IDS].sort(), "execution surface set mismatch");
  for (const surface of SURFACE_IDS) {
    assert.equal(candidate.surfaceStates[surface], "unknown", "static evidence cannot claim an active runtime surface");
  }
  return candidate;
}

function applyNegativeFixture(base, fixture) {
  const value = structuredClone(base);
  if (fixture.operation === "set") {
    value[fixture.field] = fixture.value;
  } else if (fixture.operation === "append") {
    value[fixture.field].push(fixture.value);
  } else if (fixture.operation === "set-surface") {
    value.surfaceStates[fixture.surface] = fixture.value;
  } else {
    assert.fail(`unsupported fixture operation: ${fixture.operation}`);
  }
  if (fixture.also) {
    for (const [field, patch] of Object.entries(fixture.also)) {
      value[field] = patch && typeof patch === "object" && !Array.isArray(patch)
        ? { ...value[field], ...patch }
        : patch;
    }
  }
  return value;
}

test("execution-state driver records the exact audited pi-permission-modes artifact", () => {
  const contract = readJson(contractPath);
  assert.equal(contract.id, "execution-state-driver-v1");
  assert.deepEqual(contract.upstream, {
    package: "pi-permission-modes",
    version: "2.2.0",
    npmSpec: "npm:pi-permission-modes@2.2.0",
    repository: "https://github.com/wynainfo/pi-permission-modes",
    integrity: "sha512-y4n110DiN99xl2tyLLU7ZyMadZUOYvxm9YKEpoZo2vFF4QJIgV7RKBAI6KztaRayAWPhA+95FdIBcV0He8vyfw==",
    tarballSha256: "e3104a36f6ca1b60a7bd965d6e1ae95181196d8f8fe4b60909625f037400c957",
    packageJsonSha256: "086f81da209daef0b0d0ce60371f47859b8a75b1c5705fc8c1fa15946609614c",
    entrypointSha256: "fd4462a3b7ba986af734c2e17ba8ea7178df56c933e87ed444ba90ba24c2fd5b",
  });
  assert.deepEqual(contract.publicSurface.packageExports, []);
  assert.equal(contract.publicSurface.crossExtensionReadState, false);
  assert.equal(contract.publicSurface.crossExtensionSwitchState, false);
  assert.deepEqual(contract.publicSurface.internalOnlySymbols, ["setMode"]);
});

test("hard execution-policy changes fail closed as RESTART_REQUIRED", () => {
  const contract = readJson(contractPath);
  assert.deepEqual(contract.driverDecision, {
    owner: "pi-permission-modes",
    canReadState: false,
    canSwitchAtRuntime: false,
    hardPolicyApplyStatus: "RESTART_REQUIRED",
    reasonCode: "NO_PUBLIC_CROSS_EXTENSION_STATE_API",
    initialBinding: {
      cliTemplate: ["--perm", "<audited-permission-mode>"],
      environment: "PI_PERMISSION_MODE",
    },
    readFallback: "unknown",
    restoreStrategy: "restart-required",
    sameEnvelopeTaskModeSwitch: "prompt-workflow-only",
  });
  assert.deepEqual(contract.forbidden.runtimeImports, ["pi-permission-modes/src/**"]);
  assert.deepEqual(contract.forbidden.commandSimulation, ["/perm", "alt+m"]);
  assert.equal(contract.verification.liveRuntime, "NOT_RUN_BY_POLICY");
});

test("all seven enforcement surfaces remain explicit and unknown under static evidence", () => {
  const contract = readJson(contractPath);
  assert.deepEqual(contract.enforcementSurfaces.map((surface) => surface.id), SURFACE_IDS);
  assert.ok(contract.enforcementSurfaces.every((surface) => surface.observableState === "unknown"));
  assert.equal(contract.enforcementSurfaces.find((surface) => surface.id === "bashSandbox").scope,
    "eligible replacement Bash subprocesses only; may degrade or be disabled");
  for (const id of ["webEgress", "mcpEgress", "providerEgress", "extensionEgress"]) {
    const surface = contract.enforcementSurfaces.find((item) => item.id === id);
    assert.equal(surface.owner, "none");
    assert.equal(surface.mechanism, "none");
  }
});

test("the positive static evidence validates without claiming a live runtime", () => {
  validateEvidence(readJson(path.join(fixtureRoot, "restart-required.json")));
});

test("execution-state negative fixtures reject unsafe or unsupported claims", async (t) => {
  const base = readJson(path.join(fixtureRoot, "restart-required.json"));
  const negativeRoot = path.join(fixtureRoot, "negative");
  const files = fs.readdirSync(negativeRoot).filter((file) => file.endsWith(".json")).sort();
  assert.equal(files.length, 6);
  for (const file of files) {
    await t.test(file, () => {
      const fixture = readJson(path.join(negativeRoot, file));
      const candidate = applyNegativeFixture(base, fixture);
      assert.throws(
        () => validateEvidence(candidate),
        new RegExp(fixture.expectedError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    });
  }
});
