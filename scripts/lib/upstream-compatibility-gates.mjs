import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson, repositoryRoot, verificationRoot } from "./release-gates.mjs";

export const defaultUpstreamCompatibilityGatesPath = path.join(
  verificationRoot,
  "upstream-compatibility-gates-v1.json",
);

export const UPSTREAM_COMPATIBILITY_GATE_IDS = Object.freeze(
  Array.from({ length: 9 }, (_, index) => `U${index + 1}`),
);
export const UPSTREAM_COMPATIBILITY_DETERMINISTIC_IDS = Object.freeze(
  UPSTREAM_COMPATIBILITY_GATE_IDS.filter((id) => id !== "U9"),
);
export const UPSTREAM_COMPATIBILITY_PROTECTED_IDS = Object.freeze(["U9"]);
export const UPSTREAM_COMPATIBILITY_PROTECTED_EVIDENCE = Object.freeze({
  U9: Object.freeze(["m9-candidate-live-readonly-matrix"]),
});
export const UPSTREAM_COMPATIBILITY_U9_ASSERTION_IDS = Object.freeze([
  "agent-terminal", "artifact-identity", "batch-swarm-terminal", "budget-boundary",
  "cancellation", "candidate-artifact-audit", "candidate-runtime-identity", "public-web",
  "resume-across-session", "resume-prepared", "swarm-goal-replan", "ultra-agent-route",
  "ultra-workflow-route", "usage-metering", "workflow-artifact-flow", "writer-denial",
].sort());

export const UPSTREAM_COMPATIBILITY_COMMANDS = Object.freeze({
  U1: Object.freeze({
    command: "node",
    args: Object.freeze([
      "--test",
      "tests/upstream-compatibility.test.mjs",
      "tests/m9-upstream-compatibility-cli.test.mjs",
    ]),
  }),
  U2: Object.freeze({
    command: "node",
    args: Object.freeze([
      "--test",
      "tests/subagents-live-probe.test.mjs",
      "tests/subagents-backend-adapter.test.mjs",
      "tests/subagents-delegation-adapter.test.mjs",
    ]),
  }),
  U3: Object.freeze({
    command: "node",
    args: Object.freeze(["--test", "tests/session-runtime-composer.test.mjs"]),
  }),
  U4: Object.freeze({
    command: "node",
    args: Object.freeze([
      "--test",
      "tests/subagents-backend-adapter.test.mjs",
      "tests/subagents-run-coordinator.test.mjs",
    ]),
  }),
  U5: Object.freeze({
    command: "node",
    args: Object.freeze([
      "--test",
      "tests/upstream-compatibility.test.mjs",
      "tests/web-policy.test.mjs",
      "tests/project-gates.test.mjs",
    ]),
  }),
  U6: Object.freeze({
    command: "node",
    args: Object.freeze(["--test", "tests/subagents-resource-leak.test.mjs"]),
  }),
  U7: Object.freeze({
    command: "node",
    args: Object.freeze([
      "--test",
      "tests/pack-content.test.mjs",
      "tests/docs-links.test.mjs",
      "tests/ci-contract.test.mjs",
      "tests/schema-validation.test.mjs",
    ]),
  }),
  U8: Object.freeze({ command: "npm", args: Object.freeze(["test"]) }),
});

const TOP_LEVEL_KEYS = new Set(["formatVersion", "id", "description", "baseline", "candidate", "policy", "gates"]);
const RUNTIME_KEYS = new Set(["piVersion", "subagentsVersion"]);
const POLICY_KEYS = new Set(["cwd", "network", "shell", "protectedExecution", "maxGateCount", "maxOutputBytes"]);
const GATE_KEYS = new Set([
  "id", "description", "command", "args", "cwd", "env", "timeoutMs",
  "maxOutputBytes", "sensitiveOutput", "required", "execution", "defaultStatus", "evidenceIds",
]);
const ENV_KEYS = Object.freeze(["CI", "NO_COLOR", "PI_TELEMETRY"]);
const ENV_VALUES = Object.freeze({ CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" });
const SHELL_META = /[\0\r\n;&|`$<>]/u;
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/u;
const PROTECTED_KEYS = new Set([
  "formatVersion", "kind", "gateId", "evidenceId", "sourceCommit", "status", "createdAt",
  "candidate", "artifacts", "assertions", "usage", "privacy", "authorization", "evidenceDigest",
]);
const CANDIDATE_KEYS = new Set(["piVersion", "subagentsVersion", "webAccessVersion", "provider", "model"]);
const ARTIFACT_KEYS = new Set(["sourceArtifactSha256", "candidateAuditDigest", "contractDigest"]);
const ASSERTION_KEYS = new Set(["id", "status", "digest"]);
const USAGE_KEYS = new Set(["tokens", "costUsd", "toolCalls", "meteredTerminals"]);
const PRIVACY_KEYS = new Set(["rawOutputStored", "hostPathsStored", "secretsStored"]);
const AUTHORIZATION_KEYS = new Set(["providerRequests", "realPiHome", "credentials", "writer"]);

function fail(message) {
  throw new Error(`upstream-compatibility-gates-v1: ${message}`);
}

function plain(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, label) {
  if (!plain(value)) fail(`${label} must be an object`);
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function equal(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateRuntime(value, expected, label) {
  object(value, label);
  exactKeys(value, RUNTIME_KEYS, label);
  if (value.piVersion !== expected.piVersion || value.subagentsVersion !== expected.subagentsVersion) {
    fail(`${label} identity drifted`);
  }
}

function validateEnvironment(value, gateId) {
  object(value, `gate ${gateId} env`);
  if (!equal(Object.keys(value).sort(), [...ENV_KEYS].sort())) fail(`gate ${gateId} env differs from the fixed low-sensitivity set`);
  for (const key of ENV_KEYS) if (value[key] !== ENV_VALUES[key]) fail(`gate ${gateId} env.${key} is invalid`);
}

function validateArgs(args, gateId) {
  if (!Array.isArray(args) || args.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 256)) {
    fail(`gate ${gateId} argv is invalid`);
  }
  for (const entry of args) {
    if (SHELL_META.test(entry) || path.isAbsolute(entry) || entry === ".." || entry.startsWith("../") || entry.includes("/../")) {
      fail(`gate ${gateId} contains unsafe argv`);
    }
  }
}

function validateGate(gate, id, policy) {
  object(gate, `gate ${id}`);
  exactKeys(gate, GATE_KEYS, `gate ${id}`);
  if (gate.id !== id) fail(`gate order/id mismatch; expected ${id}`);
  if (typeof gate.description !== "string" || gate.description.length < 1 || gate.description.length > 240) fail(`gate ${id} description is invalid`);
  if (gate.cwd !== "repository-root") fail(`gate ${id} cwd is invalid`);
  validateEnvironment(gate.env, id);
  if (!Number.isSafeInteger(gate.timeoutMs) || gate.timeoutMs < 1 || gate.timeoutMs > 600_000) fail(`gate ${id} timeoutMs is invalid`);
  if (!Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes < 1024 || gate.maxOutputBytes > policy.maxOutputBytes) fail(`gate ${id} maxOutputBytes is invalid`);
  if (gate.sensitiveOutput !== false || gate.required !== true) fail(`gate ${id} must be required and non-sensitive`);

  if (UPSTREAM_COMPATIBILITY_DETERMINISTIC_IDS.includes(id)) {
    const expected = UPSTREAM_COMPATIBILITY_COMMANDS[id];
    if (gate.execution !== "deterministic" || gate.command !== expected.command || !equal(gate.args, expected.args)) {
      fail(`gate ${id} executable contract drifted`);
    }
    validateArgs(gate.args, id);
    if (gate.defaultStatus !== undefined || gate.evidenceIds !== undefined) fail(`deterministic gate ${id} cannot declare protected evidence`);
    return;
  }

  if (
    gate.execution !== "protected-evidence"
    || gate.command !== null
    || !equal(gate.args, [])
    || gate.defaultStatus !== "NOT_RUN_BY_POLICY"
    || !equal(gate.evidenceIds, ["m9-candidate-live-readonly-matrix"])
  ) fail("U9 must remain protected evidence-only");
}

export function upstreamCompatibilityGatesDigest(manifest) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
}

export function validateUpstreamCompatibilityGatesManifest(input) {
  object(input, "manifest");
  exactKeys(input, TOP_LEVEL_KEYS, "manifest");
  if (input.formatVersion !== 1 || input.id !== "upstream-compatibility-gates-v1") fail("manifest identity is invalid");
  if (typeof input.description !== "string" || input.description.length < 1 || input.description.length > 360) fail("manifest description is invalid");
  validateRuntime(input.baseline, { piVersion: "0.84.1", subagentsVersion: "0.45.2" }, "baseline");
  validateRuntime(input.candidate, { piVersion: "0.84.3", subagentsVersion: "0.57.0" }, "candidate");
  object(input.policy, "policy");
  exactKeys(input.policy, POLICY_KEYS, "policy");
  if (
    input.policy.cwd !== "repository-root"
    || input.policy.network !== "deny"
    || input.policy.shell !== false
    || input.policy.protectedExecution !== "evidence-only"
    || input.policy.maxGateCount !== 9
  ) fail("manifest policy drifted");
  if (!Number.isSafeInteger(input.policy.maxOutputBytes) || input.policy.maxOutputBytes < 1024 || input.policy.maxOutputBytes > 8 * 1024 * 1024) fail("manifest output policy is invalid");
  if (!Array.isArray(input.gates) || input.gates.length !== UPSTREAM_COMPATIBILITY_GATE_IDS.length) fail("manifest must contain U1-U9 exactly once");
  input.gates.forEach((gate, index) => validateGate(gate, UPSTREAM_COMPATIBILITY_GATE_IDS[index], input.policy));
  return deepFreeze(JSON.parse(JSON.stringify(input)));
}

function containedManifest(file, allowedRoot) {
  const root = fs.realpathSync(allowedRoot);
  const target = fs.realpathSync(file);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("manifest path escapes verification root");
  return target;
}

export function loadUpstreamCompatibilityGatesManifest(
  file = defaultUpstreamCompatibilityGatesPath,
  { rootDir = repositoryRoot } = {},
) {
  const target = containedManifest(path.resolve(file), path.join(path.resolve(rootDir), "verification"));
  let value;
  try {
    value = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (cause) {
    fail(`manifest cannot be parsed: ${cause.message}`);
  }
  return validateUpstreamCompatibilityGatesManifest(value);
}

export function resolveUpstreamCompatibilityGate(manifest, gateId) {
  if (!UPSTREAM_COMPATIBILITY_GATE_IDS.includes(gateId)) fail(`unknown gate ${gateId}`);
  return validateUpstreamCompatibilityGatesManifest(manifest).gates.find((gate) => gate.id === gateId);
}

function forbiddenEvidenceShape(value, pointer = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => forbiddenEvidenceShape(entry, `${pointer}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:api.?key|token|secret|password|cookie|authorization.?header|raw.?output|host.?path)$/iu.test(key)) {
      fail(`protected evidence contains forbidden field ${pointer}.${key}`);
    }
    forbiddenEvidenceShape(child, `${pointer}.${key}`);
  }
}

export function upstreamProtectedEvidenceDigest(document) {
  const unsigned = { ...document };
  delete unsigned.evidenceDigest;
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(unsigned)).digest("hex")}`;
}

export function validateUpstreamCompatibilityProtectedEvidence(input, { expectedSourceCommit } = {}) {
  object(input, "protected evidence");
  exactKeys(input, PROTECTED_KEYS, "protected evidence");
  if (input.formatVersion !== 1
    || input.kind !== "only-my-pi-upstream-compatibility-protected-evidence"
    || input.gateId !== "U9"
    || input.evidenceId !== UPSTREAM_COMPATIBILITY_PROTECTED_EVIDENCE.U9[0]) {
    fail("protected evidence identity is invalid");
  }
  if (!FULL_SHA.test(input.sourceCommit ?? "")
    || (expectedSourceCommit !== undefined && input.sourceCommit !== expectedSourceCommit)) {
    fail("protected evidence source commit is invalid");
  }
  if (input.status !== "PASS" || !Number.isFinite(Date.parse(input.createdAt))) fail("protected evidence status or timestamp is invalid");

  object(input.candidate, "protected evidence candidate");
  exactKeys(input.candidate, CANDIDATE_KEYS, "protected evidence candidate");
  if (input.candidate.piVersion !== "0.84.3"
    || input.candidate.subagentsVersion !== "0.57.0"
    || input.candidate.webAccessVersion !== "0.25.0"
    || !SAFE_MODEL.test(input.candidate.provider ?? "")
    || !SAFE_MODEL.test(input.candidate.model ?? "")) {
    fail("protected evidence candidate identity is invalid");
  }

  object(input.artifacts, "protected evidence artifacts");
  exactKeys(input.artifacts, ARTIFACT_KEYS, "protected evidence artifacts");
  for (const [key, value] of Object.entries(input.artifacts)) if (!SHA256.test(value ?? "")) fail(`protected evidence artifacts.${key} is invalid`);

  if (!Array.isArray(input.assertions) || input.assertions.length !== UPSTREAM_COMPATIBILITY_U9_ASSERTION_IDS.length) fail("protected evidence assertions are invalid");
  const ids = new Set();
  for (const assertion of input.assertions) {
    object(assertion, "protected evidence assertion");
    exactKeys(assertion, ASSERTION_KEYS, "protected evidence assertion");
    if (typeof assertion.id !== "string"
      || !/^[a-z][a-z0-9-]{0,63}$/u.test(assertion.id)
      || ids.has(assertion.id)
      || assertion.status !== "PASS"
      || !SHA256.test(assertion.digest ?? "")) {
      fail("protected evidence assertion is invalid");
    }
    ids.add(assertion.id);
  }
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(UPSTREAM_COMPATIBILITY_U9_ASSERTION_IDS)) fail("protected evidence assertion set is incomplete or unexpected");

  object(input.usage, "protected evidence usage");
  exactKeys(input.usage, USAGE_KEYS, "protected evidence usage");
  for (const key of ["tokens", "toolCalls", "meteredTerminals"]) if (!Number.isSafeInteger(input.usage[key]) || input.usage[key] < 0) fail(`protected evidence usage.${key} is invalid`);
  if (typeof input.usage.costUsd !== "number" || !Number.isFinite(input.usage.costUsd) || input.usage.costUsd < 0 || input.usage.costUsd > 1) fail("protected evidence usage.costUsd is invalid");

  object(input.privacy, "protected evidence privacy");
  exactKeys(input.privacy, PRIVACY_KEYS, "protected evidence privacy");
  if (input.privacy.rawOutputStored !== false || input.privacy.hostPathsStored !== false || input.privacy.secretsStored !== false) fail("protected evidence privacy boundary is invalid");
  object(input.authorization, "protected evidence authorization");
  exactKeys(input.authorization, AUTHORIZATION_KEYS, "protected evidence authorization");
  if (input.authorization.providerRequests !== "AUTHORIZED"
    || input.authorization.realPiHome !== "AUTH_AND_PRIVATE_RUN_STATE_ONLY"
    || input.authorization.credentials !== "PI_RUNTIME_ONLY"
    || input.authorization.writer !== "DENIED") {
    fail("protected evidence authorization boundary is invalid");
  }
  if (!SHA256.test(input.evidenceDigest ?? "") || input.evidenceDigest !== upstreamProtectedEvidenceDigest(input)) fail("protected evidence digest is invalid");
  forbiddenEvidenceShape(input);
  const serialized = JSON.stringify(input);
  if (/\/Users\/[^/\s]+\//u.test(serialized) || /\/home\/[^/\s]+\//u.test(serialized)) fail("protected evidence contains a host home path");
  return deepFreeze(JSON.parse(JSON.stringify(input)));
}

export function loadUpstreamCompatibilityProtectedEvidence(file, { rootDir = repositoryRoot, expectedSourceCommit } = {}) {
  const protectedRoot = path.join(path.resolve(rootDir), "verification", "protected");
  const target = containedManifest(path.resolve(file), protectedRoot);
  return validateUpstreamCompatibilityProtectedEvidence(JSON.parse(fs.readFileSync(target, "utf8")), { expectedSourceCommit });
}
