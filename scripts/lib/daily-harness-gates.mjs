import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson, repositoryRoot, verificationRoot } from "./release-gates.mjs";

export const defaultDailyHarnessGatesPath = path.join(verificationRoot, "daily-harness-gates-v1.json");
export const DAILY_HARNESS_GATE_IDS = Object.freeze(Array.from({ length: 15 }, (_, index) => `D${index + 1}`));
export const DAILY_HARNESS_DETERMINISTIC_IDS = Object.freeze(DAILY_HARNESS_GATE_IDS.filter((id) => !["D13", "D14"].includes(id)));
export const DAILY_HARNESS_PROTECTED_IDS = Object.freeze(["D13", "D14"]);
export const DAILY_HARNESS_PROTECTED_EVIDENCE = Object.freeze({
  D13: Object.freeze(["m8-live-model-matrix"]),
  D14: Object.freeze(["m8-real-root-rehearsal"]),
});

export const DAILY_HARNESS_COMMANDS = Object.freeze({
  D1: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/bootstrap-package-bindings.test.mjs", "tests/bootstrap-settings-merge.test.mjs"]) }),
  D2: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/artifact-installer.test.mjs", "tests/bootstrap-service.test.mjs", "tests/bootstrap-transaction-engine.test.mjs"]) }),
  D3: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/daily-config.test.mjs", "tests/daily-control.test.mjs", "tests/omp-cli-parser.test.mjs"]) }),
  D4: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/session-runtime-composer.test.mjs", "tests/session-runtime-components.test.mjs", "tests/omp-control-runtime.test.mjs", "tests/omp-control-runtime-daily.test.mjs"]) }),
  D5: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/session-runtime-composer.test.mjs", "tests/subagents-batch-swarm.test.mjs", "tests/batch-swarm-control.test.mjs"]) }),
  D6: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-run-coordinator.test.mjs", "tests/workflow-core.test.mjs", "tests/subagents-state.test.mjs"]) }),
  D7: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/goal-revision-authority.test.mjs", "tests/subagents-swarm-goal.test.mjs"]) }),
  D8: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-ultra-run.test.mjs", "tests/subagents-s4-control.test.mjs"]) }),
  D9: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/web-policy.test.mjs"]) }),
  D10: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/project-gates.test.mjs"]) }),
  D11: Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/run-management.test.mjs", "tests/subagents-run-coordinator.test.mjs", "tests/subagents-state.test.mjs"]) }),
  D12: Object.freeze({ command: "npm", args: Object.freeze(["run", "test:e2e:daily"]) }),
  D15: Object.freeze({ command: "node", args: Object.freeze(["scripts/m8-deterministic-acceptance.mjs"]) }),
});

const TOP_LEVEL_KEYS = new Set(["formatVersion", "id", "description", "baseStableReceipt", "policy", "gates"]);
const POLICY_KEYS = new Set(["cwd", "network", "shell", "protectedExecution", "maxGateCount", "maxOutputBytes"]);
const GATE_KEYS = new Set(["id", "description", "command", "args", "cwd", "env", "timeoutMs", "maxOutputBytes", "sensitiveOutput", "required", "execution", "defaultStatus", "evidenceIds"]);
const ENV_KEYS = Object.freeze(["CI", "NO_COLOR", "PI_TELEMETRY"]);
const ENV_VALUES = Object.freeze({ CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" });
const SHELL_META = /[\0\r\n;&|`$<>]/u;
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PROTECTED_KEYS = new Set(["formatVersion", "kind", "gateId", "evidenceId", "sourceCommit", "status", "createdAt", "assertions", "privacy", "authorization", "evidenceDigest"]);
const ASSERTION_KEYS = new Set(["id", "status", "digest"]);
const PRIVACY_KEYS = new Set(["rawOutputStored", "hostPathsStored", "secretsStored"]);
const AUTHORIZATION_KEYS = new Set(["providerRequests", "realPiHome", "credentials", "writer"]);

function fail(message) {
  throw new Error(`daily-harness-gates-v1: ${message}`);
}

function plain(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value, label) {
  if (!plain(value)) fail(`${label} must be an object`);
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function equal(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateEnvironment(value, gateId) {
  assertObject(value, `gate ${gateId} env`);
  if (!equal(Object.keys(value).sort(), [...ENV_KEYS].sort())) fail(`gate ${gateId} env differs from the fixed low-sensitivity set`);
  for (const key of ENV_KEYS) if (value[key] !== ENV_VALUES[key]) fail(`gate ${gateId} env.${key} is invalid`);
}

function validateArgs(args, gateId) {
  if (!Array.isArray(args) || args.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.length > 256)) fail(`gate ${gateId} argv is invalid`);
  for (const entry of args) {
    if (SHELL_META.test(entry) || path.isAbsolute(entry) || entry === ".." || entry.startsWith("../") || entry.includes("/../")) {
      fail(`gate ${gateId} contains unsafe argv`);
    }
  }
}

function validateGate(gate, id, policy) {
  assertObject(gate, `gate ${id}`);
  exactKeys(gate, GATE_KEYS, `gate ${id}`);
  if (gate.id !== id) fail(`gate order/id mismatch; expected ${id}`);
  if (typeof gate.description !== "string" || gate.description.length < 1 || gate.description.length > 240) fail(`gate ${id} description is invalid`);
  if (gate.cwd !== "repository-root") fail(`gate ${id} cwd is invalid`);
  validateEnvironment(gate.env, id);
  if (!Number.isSafeInteger(gate.timeoutMs) || gate.timeoutMs < 1 || gate.timeoutMs > 300_000) fail(`gate ${id} timeoutMs is invalid`);
  if (!Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes < 1024 || gate.maxOutputBytes > policy.maxOutputBytes) fail(`gate ${id} maxOutputBytes is invalid`);
  if (gate.sensitiveOutput !== false || gate.required !== true) fail(`gate ${id} must be required and non-sensitive`);
  if (DAILY_HARNESS_DETERMINISTIC_IDS.includes(id)) {
    const expected = DAILY_HARNESS_COMMANDS[id];
    if (gate.execution !== "deterministic" || gate.command !== expected.command || !equal(gate.args, expected.args)) fail(`gate ${id} executable contract drifted`);
    validateArgs(gate.args, id);
    if (gate.defaultStatus !== undefined || gate.evidenceIds !== undefined) fail(`deterministic gate ${id} cannot declare protected evidence`);
    return;
  }
  if (
    gate.execution !== "protected-evidence"
    || gate.command !== null
    || !equal(gate.args, [])
    || gate.defaultStatus !== "NOT_RUN_BY_POLICY"
    || !equal(gate.evidenceIds, DAILY_HARNESS_PROTECTED_EVIDENCE[id])
  ) fail(`protected gate ${id} must remain evidence-only`);
}

export function dailyHarnessGatesDigest(manifest) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
}

export function validateDailyHarnessGatesManifest(input, { rootDir = repositoryRoot } = {}) {
  assertObject(input, "manifest");
  exactKeys(input, TOP_LEVEL_KEYS, "manifest");
  if (input.formatVersion !== 1 || input.id !== "daily-harness-gates-v1") fail("manifest identity is invalid");
  if (typeof input.description !== "string" || input.description.length < 1 || input.description.length > 360) fail("manifest description is invalid");
  if (input.baseStableReceipt !== "verification/receipts/2026-08-27-subagents-stable.json") fail("base Stable receipt is not pinned");
  const receipt = path.resolve(rootDir, input.baseStableReceipt);
  const relativeReceipt = path.relative(path.resolve(rootDir), receipt);
  if (relativeReceipt.startsWith("..") || path.isAbsolute(relativeReceipt) || !fs.statSync(receipt).isFile()) fail("base Stable receipt is unavailable");
  assertObject(input.policy, "policy");
  exactKeys(input.policy, POLICY_KEYS, "policy");
  if (input.policy.cwd !== "repository-root" || input.policy.network !== "deny" || input.policy.shell !== false || input.policy.protectedExecution !== "evidence-only" || input.policy.maxGateCount !== 15) fail("manifest policy drifted");
  if (!Number.isSafeInteger(input.policy.maxOutputBytes) || input.policy.maxOutputBytes < 1024 || input.policy.maxOutputBytes > 8 * 1024 * 1024) fail("manifest output policy is invalid");
  if (!Array.isArray(input.gates) || input.gates.length !== DAILY_HARNESS_GATE_IDS.length) fail("manifest must contain D1-D15 exactly once");
  input.gates.forEach((gate, index) => validateGate(gate, DAILY_HARNESS_GATE_IDS[index], input.policy));
  return deepFreeze(JSON.parse(JSON.stringify(input)));
}

function containedManifest(file, allowedRoot) {
  const root = fs.realpathSync(allowedRoot);
  const target = fs.realpathSync(file);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("manifest path escapes verification root");
  return target;
}

export function loadDailyHarnessGatesManifest(file = defaultDailyHarnessGatesPath, { rootDir = repositoryRoot } = {}) {
  const target = containedManifest(path.resolve(file), path.join(path.resolve(rootDir), "verification"));
  let value;
  try {
    value = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (cause) {
    fail(`manifest cannot be parsed: ${cause.message}`);
  }
  return validateDailyHarnessGatesManifest(value, { rootDir });
}

export function resolveDailyHarnessGate(manifest, gateId, { rootDir = repositoryRoot } = {}) {
  if (!DAILY_HARNESS_GATE_IDS.includes(gateId)) fail(`unknown gate ${gateId}`);
  return validateDailyHarnessGatesManifest(manifest, { rootDir }).gates.find((gate) => gate.id === gateId);
}

function forbiddenEvidenceShape(value, pointer = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => forbiddenEvidenceShape(entry, `${pointer}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:api.?key|token|secret|password|cookie|authorization.?header|raw.?output|host.?path)$/iu.test(key)) fail(`protected evidence contains forbidden field ${pointer}.${key}`);
    forbiddenEvidenceShape(child, `${pointer}.${key}`);
  }
}

export function protectedEvidenceDigest(document) {
  const unsigned = { ...document };
  delete unsigned.evidenceDigest;
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(unsigned)).digest("hex")}`;
}

export function validateDailyHarnessProtectedEvidence(input, { gateId, expectedSourceCommit } = {}) {
  assertObject(input, "protected evidence");
  exactKeys(input, PROTECTED_KEYS, "protected evidence");
  if (!DAILY_HARNESS_PROTECTED_IDS.includes(gateId) || input.gateId !== gateId) fail("protected evidence gate identity is invalid");
  const expectedId = DAILY_HARNESS_PROTECTED_EVIDENCE[gateId][0];
  if (input.formatVersion !== 1 || input.kind !== "only-my-pi-daily-harness-protected-evidence" || input.evidenceId !== expectedId) fail("protected evidence identity is invalid");
  if (!FULL_SHA.test(input.sourceCommit ?? "") || (expectedSourceCommit !== undefined && input.sourceCommit !== expectedSourceCommit)) fail("protected evidence source commit is invalid");
  if (input.status !== "PASS" || !Number.isFinite(Date.parse(input.createdAt))) fail("protected evidence status or timestamp is invalid");
  if (!Array.isArray(input.assertions) || input.assertions.length < 1 || input.assertions.length > 64) fail("protected evidence assertions are invalid");
  const ids = new Set();
  for (const assertion of input.assertions) {
    assertObject(assertion, "protected evidence assertion");
    exactKeys(assertion, ASSERTION_KEYS, "protected evidence assertion");
    if (typeof assertion.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(assertion.id) || ids.has(assertion.id) || assertion.status !== "PASS" || !SHA256.test(assertion.digest ?? "")) fail("protected evidence assertion is invalid");
    ids.add(assertion.id);
  }
  assertObject(input.privacy, "protected evidence privacy");
  exactKeys(input.privacy, PRIVACY_KEYS, "protected evidence privacy");
  if (input.privacy.rawOutputStored !== false || input.privacy.hostPathsStored !== false || input.privacy.secretsStored !== false) fail("protected evidence privacy boundary is invalid");
  assertObject(input.authorization, "protected evidence authorization");
  exactKeys(input.authorization, AUTHORIZATION_KEYS, "protected evidence authorization");
  if (!["AUTHORIZED", "NOT_RUN_BY_POLICY"].includes(input.authorization.providerRequests)
    || !["AUTHORIZED", "NOT_TOUCHED"].includes(input.authorization.realPiHome)
    || !["PI_RUNTIME_ONLY", "NOT_READ"].includes(input.authorization.credentials)
    || !["DENIED", "NOT_RUN_BY_POLICY"].includes(input.authorization.writer)) fail("protected evidence authorization boundary is invalid");
  if (gateId === "D13" && (input.authorization.providerRequests !== "AUTHORIZED" || input.authorization.credentials !== "PI_RUNTIME_ONLY" || input.authorization.writer !== "DENIED")) fail("D13 authorization evidence is incomplete");
  if (gateId === "D14" && (input.authorization.providerRequests !== "NOT_RUN_BY_POLICY" || input.authorization.realPiHome !== "AUTHORIZED" || input.authorization.credentials !== "NOT_READ")) fail("D14 authorization evidence is incomplete");
  if (!SHA256.test(input.evidenceDigest ?? "") || input.evidenceDigest !== protectedEvidenceDigest(input)) fail("protected evidence digest is invalid");
  forbiddenEvidenceShape(input);
  const serialized = JSON.stringify(input);
  if (/\/Users\/[^/\s]+\//u.test(serialized) || /\/home\/[^/\s]+\//u.test(serialized)) fail("protected evidence contains a host home path");
  return deepFreeze(JSON.parse(JSON.stringify(input)));
}

export function loadDailyHarnessProtectedEvidence(file, { rootDir = repositoryRoot, gateId, expectedSourceCommit } = {}) {
  const protectedRoot = path.join(path.resolve(rootDir), "verification", "protected");
  const target = containedManifest(path.resolve(file), protectedRoot);
  return validateDailyHarnessProtectedEvidence(JSON.parse(fs.readFileSync(target, "utf8")), { gateId, expectedSourceCommit });
}
