import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(here, "../..");
export const verificationRoot = path.join(repositoryRoot, "verification");
export const defaultReleaseGatesPath = path.join(verificationRoot, "release-gates-v1.json");

export const RELEASE_GATE_COMMANDS = Object.freeze({
  lint: Object.freeze({ command: "npm", args: Object.freeze(["run", "lint"]) }),
  typecheck: Object.freeze({ command: "npm", args: Object.freeze(["run", "typecheck"]) }),
  "schema-check": Object.freeze({ command: "npm", args: Object.freeze(["run", "schema:check"]) }),
  doctor: Object.freeze({ command: "npm", args: Object.freeze(["run", "doctor"]) }),
  "doctor-profiles": Object.freeze({ command: "npm", args: Object.freeze(["run", "doctor:profiles"]) }),
  "doctor-modes": Object.freeze({ command: "npm", args: Object.freeze(["run", "doctor:modes"]) }),
  "test-unit": Object.freeze({ command: "npm", args: Object.freeze(["run", "test:unit"]) }),
  "test-contract": Object.freeze({ command: "npm", args: Object.freeze(["run", "test:contract"]) }),
  "test-integration": Object.freeze({ command: "npm", args: Object.freeze(["run", "test:integration"]) }),
  "test-e2e": Object.freeze({ command: "npm", args: Object.freeze(["run", "test:e2e"]) }),
  "full-tests": Object.freeze({ command: "npm", args: Object.freeze(["test"]) }),
  "pack-check": Object.freeze({ command: "npm", args: Object.freeze(["run", "pack:check"]) }),
  "secret-scan": Object.freeze({ command: "npm", args: Object.freeze(["run", "secret:scan"]) }),
  "diff-check": Object.freeze({ command: "git", args: Object.freeze(["diff", "--check"]) }),
});

export const REQUIRED_RELEASE_GATE_IDS = Object.freeze(Object.keys(RELEASE_GATE_COMMANDS));

const TOP_LEVEL_KEYS = new Set(["formatVersion", "id", "description", "policy", "gates"]);
const POLICY_KEYS = new Set(["cwd", "network", "shell", "maxGateCount", "maxOutputBytes"]);
const GATE_KEYS = new Set([
  "id",
  "description",
  "command",
  "args",
  "cwd",
  "env",
  "timeoutMs",
  "maxOutputBytes",
  "sensitiveOutput",
  "required",
]);
const ENV_KEYS = Object.freeze(["CI", "NO_COLOR", "PI_TELEMETRY"]);
const ENV_VALUES = Object.freeze({ CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" });
const GATE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SHELL_META = /[\0\r\n;&|`$<>]/;

function fail(message) {
  throw new Error(`release-gates-v1: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unknown field ${key}`);
  }
}

function equalStringArrays(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function releaseGatesDigest(manifest) {
  return `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
}

function validatePolicy(policy) {
  assertPlainObject(policy, "policy");
  assertExactKeys(policy, POLICY_KEYS, "policy");
  if (policy.cwd !== "repository-root") fail("policy.cwd must be repository-root");
  if (policy.network !== "deny") fail("policy.network must be deny");
  if (policy.shell !== false) fail("policy.shell must be false");
  if (policy.maxGateCount !== 32) fail("policy.maxGateCount must be 32");
  if (!Number.isInteger(policy.maxOutputBytes) || policy.maxOutputBytes < 1024 || policy.maxOutputBytes > 8 * 1024 * 1024) {
    fail("policy.maxOutputBytes is outside the supported range");
  }
}

function validateEnvironment(env, gateId) {
  assertPlainObject(env, `gate ${gateId} env`);
  const keys = Object.keys(env).sort();
  if (!equalStringArrays(keys, [...ENV_KEYS].sort())) fail(`gate ${gateId} env must use the fixed low-sensitivity key set`);
  for (const key of ENV_KEYS) {
    if (env[key] !== ENV_VALUES[key]) fail(`gate ${gateId} env.${key} has an unsupported value`);
  }
}

function validateGate(gate, expectedId, policy) {
  assertPlainObject(gate, `gate ${expectedId}`);
  assertExactKeys(gate, GATE_KEYS, `gate ${expectedId}`);
  if (gate.id !== expectedId || !GATE_ID.test(gate.id)) fail(`gate order/id mismatch; expected ${expectedId}`);
  if (typeof gate.description !== "string" || gate.description.length < 1 || gate.description.length > 240) {
    fail(`gate ${gate.id} description is invalid`);
  }
  const expected = RELEASE_GATE_COMMANDS[gate.id];
  if (typeof gate.command !== "string" || !Array.isArray(gate.args) || !gate.args.every((arg) => typeof arg === "string")) {
    fail(`gate ${gate.id} command/argv must be strings`);
  }
  if (gate.command === "npm" && gate.args[0] === "run" && gate.args[1] === "verify") {
    fail(`gate ${gate.id} recursively invokes the verification receipt runner`);
  }
  for (const arg of gate.args) {
    if (typeof arg !== "string" || arg.length === 0 || arg.length > 256 || SHELL_META.test(arg)) {
      fail(`gate ${gate.id} contains an unsafe argv value`);
    }
    if (path.isAbsolute(arg) || arg === ".." || arg.startsWith("../") || arg.includes("/../")) {
      fail(`gate ${gate.id} argv escapes the repository contract`);
    }
  }
  if (gate.command !== expected.command || !equalStringArrays(gate.args, expected.args)) {
    fail(`gate ${gate.id} command/argv differs from the fixed contract`);
  }
  if (gate.cwd !== "repository-root") fail(`gate ${gate.id} cwd must be repository-root`);
  validateEnvironment(gate.env, gate.id);
  if (!Number.isInteger(gate.timeoutMs) || gate.timeoutMs < 1 || gate.timeoutMs > 300000) {
    fail(`gate ${gate.id} timeoutMs is invalid`);
  }
  if (!Number.isInteger(gate.maxOutputBytes) || gate.maxOutputBytes < 1024 || gate.maxOutputBytes > policy.maxOutputBytes) {
    fail(`gate ${gate.id} maxOutputBytes is invalid`);
  }
  if (gate.sensitiveOutput !== false) fail(`gate ${gate.id} must declare sensitiveOutput false`);
  if (gate.required !== true) fail(`gate ${gate.id} must be required`);
}

export function validateReleaseGateIdSet(ids) {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) fail("gate ID set must be an array of strings");
  if (new Set(ids).size !== ids.length) fail("gate ID set contains duplicates");
  const expected = [...REQUIRED_RELEASE_GATE_IDS].sort();
  const actual = [...ids].sort();
  if (!equalStringArrays(actual, expected)) {
    const missing = expected.filter((id) => !actual.includes(id));
    const unknown = actual.filter((id) => !expected.includes(id));
    fail(`gate ID set mismatch (missing: ${missing.join(",") || "none"}; unknown: ${unknown.join(",") || "none"})`);
  }
  return Object.freeze([...ids]);
}

export function validateReleaseGatesManifest(input) {
  assertPlainObject(input, "manifest");
  assertExactKeys(input, TOP_LEVEL_KEYS, "manifest");
  if (input.formatVersion !== 1) fail("unsupported formatVersion");
  if (input.id !== "release-gates-v1") fail("manifest id must be release-gates-v1");
  if (typeof input.description !== "string" || input.description.length < 1 || input.description.length > 320) {
    fail("manifest description is invalid");
  }
  validatePolicy(input.policy);
  if (!Array.isArray(input.gates)) fail("gates must be an array");
  if (input.gates.length > input.policy.maxGateCount) fail("gate count exceeds policy.maxGateCount");
  validateReleaseGateIdSet(input.gates.map((gate) => gate?.id));
  if (input.gates.length !== REQUIRED_RELEASE_GATE_IDS.length) fail("manifest must contain the exact release gate set");
  input.gates.forEach((gate, index) => validateGate(gate, REQUIRED_RELEASE_GATE_IDS[index], input.policy));

  const copy = JSON.parse(JSON.stringify(input));
  return deepFreeze(copy);
}

function assertContainedFile(file, allowedRoot) {
  const realRoot = fs.realpathSync(allowedRoot);
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("manifest path must stay inside the verification root");
  }
  return realFile;
}

export function loadReleaseGatesManifest(file = defaultReleaseGatesPath, options = {}) {
  const allowedRoot = options.allowedRoot ?? verificationRoot;
  const realFile = assertContainedFile(path.resolve(file), path.resolve(allowedRoot));
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(realFile, "utf8"));
  } catch (error) {
    fail(`cannot parse manifest: ${error.message}`);
  }
  return validateReleaseGatesManifest(parsed);
}

export function resolveReleaseGate(manifest, gateId) {
  if (typeof gateId !== "string" || !GATE_ID.test(gateId)) fail("invalid gate ID");
  const validated = validateReleaseGatesManifest(manifest);
  const gate = validated.gates.find((item) => item.id === gateId);
  if (!gate) fail(`unknown gate ID ${gateId}`);
  return gate;
}
