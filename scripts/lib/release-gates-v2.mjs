import fs from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  loadReleaseGatesManifest,
  releaseGatesDigest,
  repositoryRoot,
  verificationRoot,
} from "./release-gates.mjs";
import { createHash } from "node:crypto";

export const defaultReleaseGatesV2Path = path.join(verificationRoot, "release-gates-v2.json");
export const SUBAGENTS_PROMOTION_CHANNELS = Object.freeze(["preview", "alpha", "beta", "stable"]);
const ALL_CHANNELS = SUBAGENTS_PROMOTION_CHANNELS;
const PREVIEW_AND_LATER = ALL_CHANNELS;
const ALPHA_AND_LATER = Object.freeze(["alpha", "beta", "stable"]);
const BETA_AND_LATER = Object.freeze(["beta", "stable"]);
const STABLE_ONLY = Object.freeze(["stable"]);

export const RELEASE_GATES_V2_EXTENSION = Object.freeze({
  "architecture-owner-check": Object.freeze({ command: "npm", args: Object.freeze(["run", "doctor:subagents-topology"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "public-api-export-check": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-public-api.test.mjs", "tests/subagents-control-facade.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "workflow-v2-schema-and-semantics": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-contract-schemas.test.mjs", "tests/subagents-plan-compiler.test.mjs", "tests/schema-validation.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "v1-v2-migration-check": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-migration.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "run-state-property-test": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-state.test.mjs", "tests/subagents-plan-store.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "journal-crash-recovery-test": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-state.test.mjs", "tests/subagents-run-coordinator.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "late-event-correlation-test": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-backend-adapter.test.mjs", "tests/subagents-state.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "terminal-proof-test": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-backend-adapter.test.mjs", "tests/subagents-domain.test.mjs", "tests/subagents-run-coordinator.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "subagent-security-redteam": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-approval.test.mjs", "tests/subagents-artifact-writer.test.mjs", "tests/subagents-backend-adapter.test.mjs", "tests/subagents-batch-swarm.test.mjs", "tests/subagents-run-coordinator.test.mjs", "tests/subagents-swarm-goal.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "orchestration-eval-offline": Object.freeze({ command: "npm", args: Object.freeze(["run", "eval:subagents"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "worktree-writer-e2e": Object.freeze({ command: null, args: Object.freeze([]), execution: "protected-evidence", channels: BETA_AND_LATER }),
  "resource-leak-check": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-resource-leak.test.mjs"]), execution: "deterministic", channels: STABLE_ONLY }),
  "license-provenance-check": Object.freeze({ command: "node", args: Object.freeze(["--test", "tests/subagents-provenance.test.mjs"]), execution: "deterministic", channels: PREVIEW_AND_LATER }),
  "pi-subagents-live-readonly-smoke": Object.freeze({ command: null, args: Object.freeze([]), execution: "protected-evidence", channels: ALPHA_AND_LATER }),
  "pi-subagents-live-writer-smoke": Object.freeze({ command: null, args: Object.freeze([]), execution: "protected-evidence", channels: BETA_AND_LATER }),
  "compatibility-matrix": Object.freeze({ command: "node", args: Object.freeze(["scripts/subagents-compatibility.mjs", "--requested", "preview", "--json"]), execution: "deterministic", channels: STABLE_ONLY }),
});

export const REQUIRED_RELEASE_GATES_V2_EXTENSION_IDS = Object.freeze(Object.keys(RELEASE_GATES_V2_EXTENSION));

const TOP_LEVEL_KEYS = new Set(["formatVersion", "id", "description", "base", "policy", "gates"]);
const BASE_KEYS = new Set(["path", "digest"]);
const POLICY_KEYS = new Set(["cwd", "deterministicNetwork", "protectedExecution", "shell", "maxGateCount", "maxOutputBytes"]);
const GATE_KEYS = new Set(["id", "description", "command", "args", "cwd", "env", "timeoutMs", "maxOutputBytes", "sensitiveOutput", "required", "execution", "channels", "defaultStatus"]);
const ENV_KEYS = Object.freeze(["CI", "NO_COLOR", "PI_TELEMETRY"]);
const ENV_VALUES = Object.freeze({ CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" });
const GATE_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SHELL_META = /[\0\r\n;&|`$<>]/u;

function fail(message) {
  throw new Error(`release-gates-v2: ${message}`);
}

function plain(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value, label) {
  if (!plain(value)) fail(`${label} must be an object`);
}

function exactKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${label} contains unknown field ${key}`);
}

function equal(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function safeArgs(args, id) {
  if (!Array.isArray(args) || !args.every((entry) => typeof entry === "string")) fail(`gate ${id} args must be strings`);
  for (const arg of args) {
    if (arg.length === 0 || arg.length > 256 || SHELL_META.test(arg) || path.isAbsolute(arg) || arg === ".." || arg.startsWith("../") || arg.includes("/../")) {
      fail(`gate ${id} contains unsafe argv`);
    }
  }
}

function validateEnvironment(env, id) {
  assertObject(env, `gate ${id} env`);
  if (!equal(Object.keys(env).sort(), [...ENV_KEYS].sort())) fail(`gate ${id} env differs from the low-sensitivity key set`);
  for (const key of ENV_KEYS) if (env[key] !== ENV_VALUES[key]) fail(`gate ${id} env.${key} has an unsupported value`);
}

function validateGate(gate, expectedId, policy) {
  assertObject(gate, `gate ${expectedId}`);
  exactKeys(gate, GATE_KEYS, `gate ${expectedId}`);
  if (gate.id !== expectedId || !GATE_ID.test(gate.id)) fail(`gate order/id mismatch; expected ${expectedId}`);
  if (typeof gate.description !== "string" || gate.description.length < 1 || gate.description.length > 240) fail(`gate ${gate.id} description is invalid`);
  const expected = RELEASE_GATES_V2_EXTENSION[gate.id];
  if (gate.execution !== expected.execution) fail(`gate ${gate.id} execution differs from the fixed contract`);
  if (!equal(gate.channels, expected.channels)) fail(`gate ${gate.id} promotion channels differ from the fixed contract`);
  if (gate.cwd !== "repository-root") fail(`gate ${gate.id} cwd must be repository-root`);
  validateEnvironment(gate.env, gate.id);
  if (!Number.isSafeInteger(gate.timeoutMs) || gate.timeoutMs < 1 || gate.timeoutMs > 300_000) fail(`gate ${gate.id} timeoutMs is invalid`);
  if (!Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes < 1024 || gate.maxOutputBytes > policy.maxOutputBytes) fail(`gate ${gate.id} maxOutputBytes is invalid`);
  if (gate.sensitiveOutput !== false || gate.required !== true) fail(`gate ${gate.id} must be required and non-sensitive`);

  if (expected.execution === "deterministic") {
    if (gate.command !== expected.command || !equal(gate.args, expected.args)) fail(`gate ${gate.id} command/argv differs from the fixed contract`);
    safeArgs(gate.args, gate.id);
    if (gate.defaultStatus !== undefined) fail(`deterministic gate ${gate.id} cannot define defaultStatus`);
  } else {
    if (gate.command !== null || !equal(gate.args, []) || gate.defaultStatus !== "NOT_RUN_BY_POLICY") {
      fail(`protected gate ${gate.id} must be evidence-only and default NOT_RUN_BY_POLICY`);
    }
  }
}

function baseManifest(input, rootDir) {
  assertObject(input.base, "base");
  exactKeys(input.base, BASE_KEYS, "base");
  if (input.base.path !== "verification/release-gates-v1.json") fail("base.path must pin release-gates-v1");
  const basePath = path.resolve(rootDir, input.base.path);
  const relative = path.relative(path.resolve(rootDir), basePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("base manifest escapes repository");
  const manifest = loadReleaseGatesManifest(basePath);
  const digest = releaseGatesDigest(manifest);
  if (input.base.digest !== digest) fail("base release-gates-v1 digest drift detected");
  return manifest;
}

export function releaseGatesV2Digest(manifest) {
  return `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
}

export function validateReleaseGatesV2Manifest(input, { rootDir = repositoryRoot } = {}) {
  assertObject(input, "manifest");
  exactKeys(input, TOP_LEVEL_KEYS, "manifest");
  if (input.formatVersion !== 2 || input.id !== "release-gates-v2") fail("unsupported formatVersion or manifest id");
  if (typeof input.description !== "string" || input.description.length < 1 || input.description.length > 360) fail("manifest description is invalid");
  const base = baseManifest(input, rootDir);

  assertObject(input.policy, "policy");
  exactKeys(input.policy, POLICY_KEYS, "policy");
  if (input.policy.cwd !== "repository-root" || input.policy.deterministicNetwork !== "deny" || input.policy.protectedExecution !== "evidence-only" || input.policy.shell !== false || input.policy.maxGateCount !== 32) {
    fail("manifest policy differs from the fixed fail-closed contract");
  }
  if (!Number.isSafeInteger(input.policy.maxOutputBytes) || input.policy.maxOutputBytes < 1024 || input.policy.maxOutputBytes > 8 * 1024 * 1024) fail("policy.maxOutputBytes is invalid");
  if (!Array.isArray(input.gates) || input.gates.length !== REQUIRED_RELEASE_GATES_V2_EXTENSION_IDS.length) fail("manifest must contain the exact v2 extension gate set");
  if (base.gates.length + input.gates.length > input.policy.maxGateCount) fail("resolved gate count exceeds policy.maxGateCount");
  input.gates.forEach((gate, index) => validateGate(gate, REQUIRED_RELEASE_GATES_V2_EXTENSION_IDS[index], input.policy));

  return freeze(JSON.parse(JSON.stringify(input)));
}

function assertedContained(file, root) {
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("manifest path must stay inside verification root");
  return realFile;
}

export function loadReleaseGatesV2Manifest(file = defaultReleaseGatesV2Path, { rootDir = repositoryRoot } = {}) {
  const target = assertedContained(path.resolve(file), path.join(path.resolve(rootDir), "verification"));
  return validateReleaseGatesV2Manifest(JSON.parse(fs.readFileSync(target, "utf8")), { rootDir });
}

export function resolveReleaseGatesV2(manifest, { rootDir = repositoryRoot } = {}) {
  const checked = validateReleaseGatesV2Manifest(manifest, { rootDir });
  const base = loadReleaseGatesManifest(path.resolve(rootDir, checked.base.path));
  const inherited = base.gates.map((gate) => freeze({
    ...gate,
    execution: "deterministic",
    channels: [...ALL_CHANNELS],
  }));
  return freeze([...inherited, ...checked.gates.map((gate) => ({ ...gate }))]);
}

export function resolveReleaseGateV2(manifest, gateId, options = {}) {
  if (typeof gateId !== "string" || !GATE_ID.test(gateId)) fail("invalid gate ID");
  const gate = resolveReleaseGatesV2(manifest, options).find((entry) => entry.id === gateId);
  if (!gate) fail(`unknown gate ID ${gateId}`);
  return gate;
}

export function gatesForPromotion(manifest, promotion, options = {}) {
  if (!SUBAGENTS_PROMOTION_CHANNELS.includes(promotion)) fail(`unknown promotion ${promotion}`);
  return freeze(resolveReleaseGatesV2(manifest, options).filter((gate) => gate.channels.includes(promotion)));
}
