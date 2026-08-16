import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPackageGovernance, loadGovernance } from "../scripts/package-doctor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function clonedGovernance() {
  return structuredClone(loadGovernance(root));
}

function profile(governance, id) {
  return governance.profiles.find((record) => record.document.id === id).document;
}

function codes(result) {
  return result.findings.map((finding) => finding.code);
}

test("all production profiles satisfy package, provider, owner, and capability semantics", () => {
  const result = auditPackageGovernance(loadGovernance(root));
  assert.equal(result.errors, 0, JSON.stringify(result.findings, null, 2));
  assert.equal(result.ok, true);
  assert.equal(result.profiles.length, 6);
  assert.equal(result.counts.enforcementSurfaces, 7);
});

test("research stays single-agent and orchestration explicitly selects the sole subagent runtime", () => {
  const governance = loadGovernance(root);
  const research = profile(governance, "research");
  const orchestration = profile(governance, "orchestration");

  assert.equal(research.policy.subagents.enabled, false);
  assert.equal(research.packageIds.includes("subagents"), false);
  assert.equal(research.capabilityIds.includes("subagent-runtime"), false);
  assert.equal(orchestration.policy.subagents.enabled, true);
  assert.equal(orchestration.packageIds.filter((id) => id === "subagents").length, 1);
  assert.ok(orchestration.capabilityIds.includes("subagent-runtime"));
  assert.ok(orchestration.capabilityIds.includes("subagent-rpc-v1"));
});

test("workspace-read is an explicit Pi-host capability in every profile", () => {
  const governance = loadGovernance(root);
  const capability = governance.capabilities.capabilities.find((entry) => entry.id === "workspace-read");
  assert.deepEqual(capability.providedBy, ["pi-host-runtime"]);
  assert.deepEqual(capability.surfaces, ["fileToolPolicy"]);
  for (const record of governance.profiles) {
    assert.ok(record.document.capabilityIds.includes("workspace-read"), record.document.id);
  }
});
test("M3 mode catalog distinguishes the runtime-ready inspect mode from planned Labs", () => {
  const governance = loadGovernance(root);
  assert.ok(governance.capabilities.capabilities.every((capability) => capability.runtimeEvidenceRequired === true));
  const inspect = governance.resources.resources.find((entry) => entry.id === "inspect-mode");
  assert.equal(inspect.lifecycle, "stable");
  assert.equal(inspect.defaultLoaded, false);
  for (const resourceId of ["scout-agent", "single-agent-safe-workflow"]) {
    const resource = governance.resources.resources.find((entry) => entry.id === resourceId);
    assert.equal(resource.lifecycle, "planned");
    assert.equal(resource.defaultLoaded, false);
  }
  const synthesis = governance.resources.resources.find((entry) => entry.id === "research-synthesis-recipe");
  assert.equal(synthesis.lifecycle, "stable");
  assert.equal(synthesis.defaultLoaded, false);
  const result = auditPackageGovernance(governance);
  assert.equal(result.runtimeEvidence, "not-evaluated");
});

test("unknown profile capability fails closed", () => {
  const governance = clonedGovernance();
  profile(governance, "minimal").capabilityIds.push("ghost-capability");
  assert.ok(codes(auditPackageGovernance(governance)).includes("unknown-capability"));
});

test("subagent policy without package and capability fails closed", () => {
  const governance = clonedGovernance();
  const research = profile(governance, "research");
  research.policy.subagents.enabled = true;
  research.policy.subagents.maxConcurrency = 2;
  assert.ok(codes(auditPackageGovernance(governance)).includes("policy-package-mismatch"));
});

test("capability declaration with inactive provider fails closed", () => {
  const governance = clonedGovernance();
  profile(governance, "research").capabilityIds.push("subagent-runtime");
  assert.ok(codes(auditPackageGovernance(governance)).includes("inactive-capability-provider"));
});

test("omitting a capability exposed by an active package fails closed", () => {
  const governance = clonedGovernance();
  const coding = profile(governance, "coding");
  coding.capabilityIds = coding.capabilityIds.filter((id) => id !== "usage-observability");
  assert.ok(codes(auditPackageGovernance(governance)).includes("missing-profile-capability"));
});

test("duplicate capability owner fails closed", () => {
  const governance = clonedGovernance();
  const planning = governance.owners.owners.find((owner) => owner.id === "planning");
  planning.capabilities.push("workspace-read");
  assert.ok(codes(auditPackageGovernance(governance)).includes("duplicate-capability-owner"));
});

test("command alias collision fails closed on the same command surface", () => {
  const governance = clonedGovernance();
  governance.commandOwners.commands.find((command) => command.id === "perm").aliases.push("omp-context");
  assert.ok(codes(auditPackageGovernance(governance)).includes("duplicate-command-name"));
});

test("enforcement owner mismatch fails closed", () => {
  const governance = clonedGovernance();
  governance.enforcement.surfaces.find((surface) => surface.id === "webEgress").owner = "mcp";
  assert.ok(codes(auditPackageGovernance(governance)).includes("surface-owner-mismatch"));
});

test("resource eligibility cannot exceed a profile capability ceiling", () => {
  const governance = clonedGovernance();
  governance.resources.resources
    .find((resource) => resource.id === "research-synthesis-recipe")
    .profileEligibility.push("research");
  assert.ok(codes(auditPackageGovernance(governance)).includes("resource-profile-capability-mismatch"));
});

test("public command ownership is unique and implementation status is truthful", () => {
  const governance = loadGovernance(root);
  const commands = new Map(governance.commandOwners.commands.map((command) => [command.id, command]));
  assert.deepEqual(
    { owner: commands.get("omp").owner, status: commands.get("omp").status },
    { owner: "only-my-pi-control", status: "implemented" },
  );
  assert.deepEqual(
    { owner: commands.get("/omp").owner, status: commands.get("/omp").status },
    { owner: "only-my-pi-control", status: "implemented" },
  );
  assert.deepEqual(
    { owner: commands.get("subagent").owner, status: commands.get("subagent").status },
    { owner: "subagents", status: "upstream" },
  );
});

test("each enforcement surface has one concrete owner and mandatory observable states", () => {
  const governance = loadGovernance(root);
  const ownerAssignments = new Map();
  for (const owner of governance.owners.owners) {
    for (const surface of owner.surfaces) {
      const assignments = ownerAssignments.get(surface) ?? [];
      assignments.push(owner.id);
      ownerAssignments.set(surface, assignments);
    }
  }
  for (const surface of governance.enforcement.surfaces) {
    assert.deepEqual(ownerAssignments.get(surface.id), [surface.owner]);
    assert.equal(surface.failClosed, true);
    for (const state of ["active", "degraded", "unavailable", "unknown"]) {
      assert.ok(surface.observableStates.includes(state), `${surface.id}:${state}`);
    }
  }
});
