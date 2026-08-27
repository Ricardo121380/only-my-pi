import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertPiSubagentsLiveProbeEvidence } from "../packages/subagents/live-probe.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const contractPath = path.join(root, "contracts", "pi-subagents-wire-v1.json");
const evidencePath = path.join(root, "contracts", "subagents", "pi-subagents-live-no-model-evidence.json");
const fixtureRoot = path.join(root, "verification", "fixtures", "pi-subagents-0.45.2");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertRequestId(value) {
  assert.equal(typeof value, "string", "RPC requestId must be a string");
  assert.ok(value.trim(), "RPC requestId must not be empty");
  assert.doesNotMatch(value, /[\r\n]/, "RPC requestId must not contain newlines");
}

function validateWire(candidate) {
  assert.equal(candidate.formatVersion, 1, "unsupported wire-plan version");
  assert.equal(candidate.package, "pi-subagents", "unexpected physical runtime package");
  assert.equal(candidate.version, "0.45.2", "unexpected physical runtime package version");
  assert.equal(candidate.physicalRuntimeOwner, "pi-subagents", "pi-subagents must remain the physical runtime owner");
  for (const specifier of candidate.runtimeImports) {
    assert.doesNotMatch(specifier, /^pi-subagents\/src(?:\/|$)/, "private pi-subagents import is forbidden");
  }
  assert.deepEqual(candidate.runtimeImports, [], "the live event lane requires no package imports");
  assert.equal(candidate.liveLane, "audited-pi-subagents-events-v1", "both live protocols must remain under the one pinned runtime");
  assert.deepEqual(candidate.liveLanes, ["extension-rpc-v1", "structured-delegation-v1"]);
  assert.equal(candidate.delegationReferenceLane, "exported-foreground-runtime");
  assert.equal(candidate.delegationRuntimeActive, true);
  assert.equal(candidate.delegationScope, "read-only-agent-and-batch");
  assert.equal(candidate.secondSubagentToolOwner, false, "a second subagent tool owner is forbidden");
  assert.equal(candidate.secondScheduler, false, "a second scheduler is forbidden");
  assert.equal(candidate.childDispatch, false, "M1 fixtures must not dispatch children");
  return candidate;
}

function validatePing(candidate, contract) {
  assert.equal(candidate.version, contract.rpc.protocolVersion, "unsupported pi-subagents RPC version");
  assertRequestId(candidate.requestId);
  assert.equal(candidate.method, "ping", "capability probe must be ping");
  assert.equal(candidate.success, true, "capability probe must be a successful reply fixture");
  assert.equal(candidate.data.version, contract.rpc.protocolVersion, "ping data version mismatch");
  assert.deepEqual(candidate.data.methods, contract.rpc.methods, "RPC method set mismatch");
  assert.deepEqual(candidate.data.capabilities, contract.rpc.ping.requiredCapabilities, "RPC capability set mismatch");
  assert.deepEqual(candidate.data.events, contract.rpc.events, "RPC event set mismatch");
  return candidate;
}

function validateSpawn(candidate, contract) {
  assert.equal(candidate.version, contract.rpc.protocolVersion, "unsupported pi-subagents RPC version");
  assertRequestId(candidate.requestId);
  assert.equal(candidate.method, "spawn", "compiled execution must use RPC spawn");
  assert.equal(candidate.source?.extension, "only-my-pi", "unexpected workflow compiler owner");
  assert.equal(
    candidate.source?.kind,
    contract.rpc.spawn.sourceKind,
    "workflowScript must come from the schema-validated compiler",
  );
  assert.equal(candidate.source?.schemaValidated, true, "workflow manifest must be schema validated");

  const params = candidate.params;
  assert.ok(params && typeof params === "object" && !Array.isArray(params), "RPC spawn params must be an object");
  assert.equal(params.action, undefined, "RPC spawn cannot contain a management action");
  const direct = contract.rpc.spawn.directExecutionFields.filter((field) => params[field] !== undefined);
  assert.deepEqual(direct, [], "direct execution fields are forbidden");
  const legacy = contract.rpc.spawn.legacyOrchestrationFields.filter((field) => params[field] !== undefined);
  assert.deepEqual(legacy, [], "legacy orchestration fields are forbidden");
  assert.equal(params.clarify, undefined, "RPC spawn cannot open clarify UI");
  assert.equal(params.async, true, "RPC spawn must be detached async");
  assert.equal(typeof params.workflowScript, "string", "compiled workflowScript must be a string");
  assert.ok(params.workflowScript.trim(), "compiled workflowScript must not be empty");
  return candidate;
}

function validateDelegationReference(candidate, contract) {
  assert.equal(candidate.formatVersion, 1);
  assert.equal(candidate.specifier, contract.exportedDelegationReference.specifier);
  assert.equal(candidate.use, "audited-read-only-foreground-runtime");
  assert.equal(candidate.activeRuntimeAdapter, true);
  assert.deepEqual(candidate.events, contract.exportedDelegationReference.events);
  assert.deepEqual(candidate.requestRequired, contract.exportedDelegationReference.requestRequired);
  return candidate;
}

function setAtPath(target, pathParts, value) {
  let cursor = target;
  for (const part of pathParts.slice(0, -1)) cursor = cursor[part];
  cursor[pathParts.at(-1)] = value;
}

function deleteAtPath(target, pathParts) {
  let cursor = target;
  for (const part of pathParts.slice(0, -1)) cursor = cursor[part];
  delete cursor[pathParts.at(-1)];
}

function applyNegativeFixture(base, fixture) {
  const value = structuredClone(base);
  if (fixture.operation === "set") {
    setAtPath(value, fixture.path, fixture.value);
  } else if (fixture.operation === "delete") {
    deleteAtPath(value, fixture.path);
  } else if (fixture.operation === "append") {
    let cursor = value;
    for (const part of fixture.path) cursor = cursor[part];
    cursor.push(fixture.value);
  } else if (fixture.operation === "merge") {
    let cursor = value;
    for (const part of fixture.path) cursor = cursor[part];
    Object.assign(cursor, fixture.value);
  } else {
    assert.fail(`unsupported fixture operation: ${fixture.operation}`);
  }
  return value;
}

test("pi-subagents wire pins the exact audited npm artifact and public exports", () => {
  const contract = readJson(contractPath);
  assert.equal(contract.id, "pi-subagents-wire-v1");
  assert.deepEqual(contract.upstream, {
    package: "pi-subagents",
    version: "0.45.2",
    npmSpec: "npm:pi-subagents@0.45.2",
    repository: "https://github.com/nicobailon/pi-subagents",
    integrity: "sha512-VEvBF6vrpi+eLEjhgwqutSnaH/aw58+Um9vdJUc6Td1asH22bAKahrgD3AafaRNsROgiaukw4DRdmlRjEhBxQA==",
    tarballSha256: "fb247e0d45f130d0f3f53efb63a95c56e417d8579af5ba2ba2f211b322701374",
    packageJsonSha256: "5ef75c67e2384dc66ccc150ff590d5cea3a09824c40b23b13889e509a8d9bebb",
    rpcSourceSha256: "5c0b683c8e7a59fd5fa730e10039ff8b9e84b465af6202c52405ec5798179a93",
    delegationSourceSha256: "5abfc8b1a59fa86b9b29e133e2f17418b9b3a3ddb9fd7d9a8ee606d8622f461d",
  });
  assert.deepEqual(contract.publicPackageExports, [
    ".",
    "./background-work",
    "./external-runs",
    "./delegation",
    "./capability-ceiling",
    "./preflight",
    "./control-channel",
    "./intercom-bridge",
    "./pi-args",
    "./shared-types",
  ]);
});

test("RPC and structured delegation stay under one pinned physical runtime", () => {
  const contract = readJson(contractPath);
  validateWire(readJson(path.join(fixtureRoot, "wire-plan.json")));
  assert.equal(contract.topology.liveDiscovery, "ping-capability-handshake");
  assert.equal(contract.topology.liveExecution, "spawn-with-compiled-workflowScript");
  assert.deepEqual(contract.rpc.managementTargetField, {
    status: "runId",
    steer: "runId",
    interrupt: "runId",
    stop: "runId",
    resume: "runId",
  });
  assert.equal(contract.exportedDelegationReference.activeRuntimeAdapter, true);
  assert.equal(contract.verification.liveRuntime, "LIVE_NO_MODEL_CAPABILITY_PASS");
  assert.equal(contract.verification.liveRuntimeMilestone, "S1");
  assert.equal(contract.forbidden.childDispatchDuringM1, true);
});

test("checked-in no-model live evidence is digest-bound and preserves the authorization boundary", () => {
  const contract = readJson(contractPath);
  const evidence = assertPiSubagentsLiveProbeEvidence(readJson(evidencePath));
  assert.equal(contract.verification.liveEvidence.path, path.relative(root, evidencePath));
  assert.equal(contract.verification.liveEvidence.evidenceDigest, evidence.evidenceDigest);
  assert.equal(evidence.promptSubmitted, false);
  assert.equal(evidence.providerRequest, "NOT_RUN_BY_POLICY");
  assert.equal(evidence.childDispatch, "NOT_REQUESTED");
  assert.equal(evidence.realPiHome, "NOT_TOUCHED");
  assert.deepEqual(evidence.visibility.onlyMyPiModelTools, []);
  assert.equal(evidence.visibility.primaryToolOwner, "pi-subagents");
});

test("the capability fixture exactly matches RPC v1 ping", () => {
  const contract = readJson(contractPath);
  validatePing(readJson(path.join(fixtureRoot, "ping-reply.json")), contract);
  assert.equal(contract.rpc.ping.requiredCapabilities.processTerminalProof.lifecycleArtifactVersion, 3);
});

test("the spawn fixture accepts compiler output only and remains non-executing", () => {
  const contract = readJson(contractPath);
  validateSpawn(readJson(path.join(fixtureRoot, "compiled-workflow-request.json")), contract);
  assert.equal(contract.rpc.spawn.rawUserWorkflowScriptAllowed, false);
  assert.equal(contract.rpc.spawn.managementActionAllowed, false);
  assert.equal(contract.rpc.spawn.asyncOnly, true);
});

test("the exported delegation contract is the audited read-only foreground lane", () => {
  const contract = readJson(contractPath);
  validateDelegationReference(readJson(path.join(fixtureRoot, "delegation-reference.json")), contract);
});

test("pi-subagents negative fixtures reject alternate lanes and unsafe spawn input", async (t) => {
  const contract = readJson(contractPath);
  const bases = {
    ping: readJson(path.join(fixtureRoot, "ping-reply.json")),
    spawn: readJson(path.join(fixtureRoot, "compiled-workflow-request.json")),
    wire: readJson(path.join(fixtureRoot, "wire-plan.json")),
  };
  const validators = {
    ping: (candidate) => validatePing(candidate, contract),
    spawn: (candidate) => validateSpawn(candidate, contract),
    wire: validateWire,
  };
  const negativeRoot = path.join(fixtureRoot, "negative");
  const files = fs.readdirSync(negativeRoot).filter((file) => file.endsWith(".json")).sort();
  assert.equal(files.length, 8);
  for (const file of files) {
    await t.test(file, () => {
      const fixture = readJson(path.join(negativeRoot, file));
      const candidate = applyNegativeFixture(bases[fixture.target], fixture);
      assert.throws(
        () => validators[fixture.target](candidate),
        new RegExp(fixture.expectedError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    });
  }
});
