import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./state/codec.mjs";
import { assertPiSubagentsLiveProbeEvidence } from "./live-probe.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PHYSICAL_OWNER = "subagents";
const FIRST_PARTY_OWNER = "only-my-pi-subagent-orchestration";
const PHYSICAL_PACKAGE_ID = "subagents";
const FIRST_PARTY_RESOURCE_ID = "omp-subagents-v2-runtime";
const PUBLIC_SUBAGENT_COMMAND = "subagent";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(rootDir, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

export function loadSubagentsTopologyDocuments(rootDir = DEFAULT_ROOT) {
  const root = path.resolve(rootDir);
  const wire = readJson(root, "contracts/pi-subagents-wire-v1.json");
  const evidencePath = wire?.verification?.liveEvidence?.path;
  let liveEvidence = null;
  if (typeof evidencePath === "string") {
    const absoluteEvidence = path.resolve(root, evidencePath);
    const relative = path.relative(root, absoluteEvidence);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("subagents live evidence path escapes the repository root");
    }
    liveEvidence = JSON.parse(fs.readFileSync(absoluteEvidence, "utf8"));
  }
  return Object.freeze({
    rootDir: root,
    wire,
    liveEvidence,
    packages: readJson(root, "inventory/packages.lock.json"),
    resources: readJson(root, "inventory/resources.lock.json"),
    owners: readJson(root, "policies/owners.v1.json"),
    commandOwners: readJson(root, "policies/command-owners.v1.json"),
  });
}

function check(report, id, ok, message, details = {}) {
  report.checks.push({ id, status: ok ? "PASS" : "FAIL", message, ...details });
  if (!ok) report.findings.push({ code: id, message, ...details });
}

function exactOwnerIds(entries, capability) {
  return (entries ?? [])
    .filter((entry) => Array.isArray(entry.capabilities) && entry.capabilities.includes(capability))
    .map((entry) => entry.id)
    .sort();
}

function exactPackageEntries(document, id) {
  return (document?.packages ?? []).filter((entry) => entry?.id === id);
}

function exactResourceEntries(document, id) {
  return (document?.resources ?? []).filter((entry) => entry?.id === id);
}

/**
 * Inspect the static ownership topology for the subagents runtime.
 *
 * This deliberately does not start Pi, load a Provider, inspect ~/.pi, or
 * dispatch a child. It proves repository ownership and validates the separate
 * checked-in, low-sensitivity no-model evidence receipt; producing fresh live
 * evidence remains an explicitly authorized operation.
 */
export function inspectSubagentsTopology({
  wire,
  liveEvidence,
  packages,
  resources,
  owners,
  commandOwners,
} = {}) {
  const report = {
    formatVersion: 1,
    status: "STATIC_TOPOLOGY_PASS",
    liveRuntime: wire?.verification?.liveRuntime ?? "NOT_RUN_BY_POLICY",
    physicalRuntimeOwner: PHYSICAL_OWNER,
    firstPartyOrchestrationOwner: FIRST_PARTY_OWNER,
    checks: [],
    findings: [],
  };

  const physicalRuntimeOwners = exactOwnerIds(owners?.owners, "subagent-runtime");
  check(
    report,
    "single-physical-runtime-owner",
    physicalRuntimeOwners.length === 1 && physicalRuntimeOwners[0] === PHYSICAL_OWNER,
    "exactly one owner must provide the physical subagent runtime",
    { owners: physicalRuntimeOwners, expected: [PHYSICAL_OWNER] },
  );

  const rpcOwners = exactOwnerIds(owners?.owners, "subagent-rpc-v1");
  check(
    report,
    "single-rpc-owner",
    rpcOwners.length === 1 && rpcOwners[0] === PHYSICAL_OWNER,
    "exactly one owner must provide the pi-subagents RPC lane",
    { owners: rpcOwners, expected: [PHYSICAL_OWNER] },
  );

  const physicalPackageEntries = exactPackageEntries(packages, PHYSICAL_PACKAGE_ID);
  check(
    report,
    "one-pinned-physical-package",
    physicalPackageEntries.length === 1
      && physicalPackageEntries[0]?.spec === "npm:pi-subagents@0.45.2"
      && physicalPackageEntries[0]?.installed === true
      && Array.isArray(physicalPackageEntries[0]?.owners)
      && physicalPackageEntries[0].owners.length === 1
      && physicalPackageEntries[0].owners[0] === PHYSICAL_OWNER,
    "the physical runtime must be one exact installed pi-subagents package",
    {
      packageIds: physicalPackageEntries.map((entry) => entry.id),
      specs: physicalPackageEntries.map((entry) => entry.spec),
    },
  );

  const packagesOwnedByPhysicalRuntime = (packages?.packages ?? [])
    .filter((entry) => Array.isArray(entry?.owners) && entry.owners.includes(PHYSICAL_OWNER))
    .map((entry) => entry.id)
    .sort();
  check(
    report,
    "no-second-physical-package",
    packagesOwnedByPhysicalRuntime.length === 1 && packagesOwnedByPhysicalRuntime[0] === PHYSICAL_PACKAGE_ID,
    "no second package may claim the physical subagent owner",
    { packageIds: packagesOwnedByPhysicalRuntime, expected: [PHYSICAL_PACKAGE_ID] },
  );

  const firstPartyOwner = (owners?.owners ?? []).find((entry) => entry?.id === FIRST_PARTY_OWNER);
  check(
    report,
    "logical-owner-separated",
    isObject(firstPartyOwner)
      && !(firstPartyOwner.capabilities ?? []).includes("subagent-runtime")
      && !(firstPartyOwner.capabilities ?? []).includes("subagent-rpc-v1")
      && (firstPartyOwner.resourceIds ?? []).includes(FIRST_PARTY_RESOURCE_ID),
    "first-party orchestration may own logical semantics but never the physical runtime",
    {
      capabilities: firstPartyOwner?.capabilities ?? [],
      resourceIds: firstPartyOwner?.resourceIds ?? [],
    },
  );

  const publicSubagentCommands = (commandOwners?.commands ?? [])
    .filter((entry) => entry?.id === PUBLIC_SUBAGENT_COMMAND || entry?.id === `/${PUBLIC_SUBAGENT_COMMAND}`);
  check(
    report,
    "single-public-subagent-command-owner",
    publicSubagentCommands.length === 1 && publicSubagentCommands[0]?.owner === PHYSICAL_OWNER,
    "the model-facing subagent command must have one upstream owner",
    { commands: publicSubagentCommands.map((entry) => ({ id: entry.id, owner: entry.owner, status: entry.status })) },
  );

  const competingCommands = (commandOwners?.commands ?? [])
    .filter((entry) => entry?.status === "implemented")
    .filter((entry) => /(^|[/_-])subagents?(?:[/_-]|$)/u.test(entry?.id ?? ""))
    .filter((entry) => entry.owner !== PHYSICAL_OWNER)
    .map((entry) => ({ id: entry.id, owner: entry.owner }));
  check(
    report,
    "no-first-party-subagent-command-owner",
    competingCommands.length === 0,
    "first-party orchestration must not register a competing model-facing subagent command",
    { commands: competingCommands },
  );

  const firstPartyResources = exactResourceEntries(resources, FIRST_PARTY_RESOURCE_ID);
  check(
    report,
    "logical-runtime-resource-owned",
    firstPartyResources.length === 1
      && (firstPartyResources[0]?.owners ?? []).length === 1
      && firstPartyResources[0].owners[0] === FIRST_PARTY_OWNER
      && firstPartyResources[0]?.type === "library",
    "the packaged first-party runtime resource must be uniquely owned and library-scoped",
    {
      count: firstPartyResources.length,
      owners: firstPartyResources[0]?.owners ?? [],
      type: firstPartyResources[0]?.type,
    },
  );

  const topology = wire?.topology ?? {};
  check(
    report,
    "wire-single-lane",
    topology.physicalRuntimeOwner === "pi-subagents"
      && topology.liveLane === "extension-rpc-v1"
      && topology.delegationRuntimeActive === false
      && topology.secondSubagentToolOwner === false
      && topology.secondScheduler === false
      && Array.isArray(topology.runtimeImports)
      && topology.runtimeImports.length === 0,
    "the pinned wire contract must expose one RPC lane and no second runtime",
    {
      liveLane: topology.liveLane,
      runtimeImports: topology.runtimeImports,
      delegationRuntimeActive: topology.delegationRuntimeActive,
      secondSubagentToolOwner: topology.secondSubagentToolOwner,
      secondScheduler: topology.secondScheduler,
    },
  );

  const evidenceReference = wire?.verification?.liveEvidence;
  let liveEvidenceValid = false;
  let liveEvidenceCode = null;
  try {
    const validated = assertPiSubagentsLiveProbeEvidence(liveEvidence);
    liveEvidenceValid = wire?.verification?.liveRuntime === validated.status
      && evidenceReference?.evidenceDigest === validated.evidenceDigest
      && evidenceReference?.boundary === validated.boundary
      && evidenceReference?.provider === validated.providerRequest
      && evidenceReference?.childDispatch === validated.childDispatch;
  } catch (error) {
    liveEvidenceCode = error?.code ?? "INVALID_LIVE_EVIDENCE";
  }
  check(
    report,
    "live-no-model-evidence",
    liveEvidenceValid,
    "checked-in no-model evidence must validate and match the pinned wire reference",
    {
      liveStatus: wire?.verification?.liveRuntime ?? null,
      evidenceDigest: evidenceReference?.evidenceDigest ?? null,
      errorCode: liveEvidenceCode,
    },
  );

  const spawn = wire?.rpc?.spawn ?? {};
  check(
    report,
    "wire-spawn-boundary",
    wire?.rpc?.protocolVersion === 1
      && spawn.asyncOnly === true
      && spawn.rawUserWorkflowScriptAllowed === false
      && spawn.managementActionAllowed === false
      && spawn.sourceKind === "schema-validated-workflow-compiler",
    "physical dispatch must remain async, compiler-owned, and management-action free",
    {
      protocolVersion: wire?.rpc?.protocolVersion,
      asyncOnly: spawn.asyncOnly,
      rawUserWorkflowScriptAllowed: spawn.rawUserWorkflowScriptAllowed,
      managementActionAllowed: spawn.managementActionAllowed,
    },
  );

  if (report.findings.length > 0) report.status = "STATIC_TOPOLOGY_FAIL";
  const digestInput = { ...report };
  delete digestInput.findings;
  report.digest = sha256(digestInput);
  return Object.freeze(report);
}

export function assertSubagentsTopology(input) {
  const report = inspectSubagentsTopology(input);
  if (report.status !== "STATIC_TOPOLOGY_PASS") {
    const error = new Error("subagents static ownership topology is invalid");
    error.name = "SubagentsTopologyError";
    error.code = "SUBAGENTS_TOPOLOGY_INVALID";
    error.findings = report.findings;
    error.report = report;
    throw error;
  }
  return report;
}

export const SUBAGENTS_TOPOLOGY_VERSION = 1;
