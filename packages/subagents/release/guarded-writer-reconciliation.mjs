import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { jsonClone, sha256, withoutKey } from "../state/codec.mjs";

const SCHEMA = "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-guarded-writer-reconciliation-v1.schema.json";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = path.resolve(HERE, "../../../schemas/subagents-guarded-writer-reconciliation-v1.schema.json");
const RUNTIME_PREFIX = path.join("only-my-pi", "subagents-guarded-writer");
const MAX_REQUEST_BYTES = 256 * 1024;
const AUTHORIZATION_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;

const COMPONENTS = Object.freeze([
  Object.freeze({ id: "agent-root", relativePath: "agent", expectedType: "directory" }),
  Object.freeze({ id: "session-root", relativePath: "agent/sessions", expectedType: "directory" }),
  Object.freeze({ id: "artifact-root", relativePath: "agent/sessions/subagent-artifacts", expectedType: "directory" }),
  Object.freeze({ id: "fixture-repository", relativePath: "fixture-repo", expectedType: "directory" }),
  Object.freeze({ id: "worktree-root", relativePath: "worktrees", expectedType: "directory" }),
]);

export class GuardedWriterReconciliationError extends Error {
  constructor(message, code, details = {}) {
    super(`guarded writer reconciliation: ${message}`);
    this.name = "GuardedWriterReconciliationError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new GuardedWriterReconciliationError(message, code, details);
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realLeafDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    fail(`${label} must be an absolute directory`, "RECONCILIATION_PATH_INVALID", { label });
  }
  const absolute = path.resolve(value);
  if (absolute === path.parse(absolute).root) fail(`${label} cannot be a filesystem root`, "RECONCILIATION_PATH_INVALID", { label });
  let stat;
  try { stat = await fsPromises.lstat(absolute); } catch { stat = null; }
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be an existing non-symlink directory`, "RECONCILIATION_PATH_INVALID", { label });
  }
  return fsPromises.realpath(absolute);
}

async function inspectEntry(runtimeRoot, descriptor) {
  const target = path.join(runtimeRoot, descriptor.relativePath);
  if (!inside(runtimeRoot, target)) fail("component escaped the runtime root", "RECONCILIATION_PATH_ESCAPE");
  let stat;
  try { stat = await fsPromises.lstat(target); } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ ...descriptor, state: "MISSING" });
    return Object.freeze({ ...descriptor, state: "UNREADABLE" });
  }
  if (stat.isSymbolicLink()) return Object.freeze({ ...descriptor, state: "SYMLINK" });
  const actualType = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
  return Object.freeze({
    ...descriptor,
    state: actualType === descriptor.expectedType ? "PRESENT" : "TYPE_MISMATCH",
  });
}

async function inspectRequest(runtimeRoot, expected) {
  const requestPath = path.join(runtimeRoot, "agent", "guarded-writer-request.json");
  let stat;
  try { stat = await fsPromises.lstat(requestPath); } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ state: "MISSING", digest: null, findings: ["REQUEST_MISSING"] });
    return Object.freeze({ state: "INVALID", digest: null, findings: ["REQUEST_UNREADABLE"] });
  }
  if (stat.isSymbolicLink()) return Object.freeze({ state: "UNSAFE", digest: null, findings: ["REQUEST_SYMLINK"] });
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    return Object.freeze({ state: "INVALID", digest: null, findings: ["REQUEST_SIZE_INVALID"] });
  }
  let request;
  let bytes;
  try {
    bytes = await fsPromises.readFile(requestPath);
    request = JSON.parse(bytes.toString("utf8"));
  } catch {
    return Object.freeze({ state: "INVALID", digest: bytes ? sha256(bytes) : null, findings: ["REQUEST_JSON_INVALID"] });
  }
  const findings = [];
  if (request?.authorizationDigest !== expected.authorizationDigest) findings.push("AUTHORIZATION_BINDING_DRIFT");
  if (request?.sourceCommit !== expected.sourceCommit) findings.push("SOURCE_BINDING_DRIFT");
  const expectedPaths = {
    runtimeRoot,
    agentRoot: path.join(runtimeRoot, "agent"),
    fixtureRoot: path.join(runtimeRoot, "fixture-repo"),
    artifactRoot: path.join(runtimeRoot, "agent", "sessions", "subagent-artifacts"),
    worktreeRoot: path.join(runtimeRoot, "worktrees"),
  };
  for (const [field, expectedPath] of Object.entries(expectedPaths)) {
    if (typeof request?.[field] !== "string" || path.resolve(request[field]) !== expectedPath) findings.push("REQUEST_PATH_BINDING_DRIFT");
  }
  if (!FULL_COMMIT.test(request?.baseCommit ?? "")) findings.push("REQUEST_BASE_COMMIT_INVALID");
  return Object.freeze({
    state: findings.length === 0 ? "VALID" : "INVALID",
    digest: sha256(bytes),
    findings: Object.freeze([...new Set(findings)].sort()),
  });
}

export function guardedWriterReconciliationPlanDigest(plan) {
  return sha256(withoutKey(withoutKey(plan, "$schema"), "planDigest"));
}

let defaultSchemaValidator;

function reconciliationSchemaValidator(schemaPath = DEFAULT_SCHEMA_PATH) {
  if (schemaPath === DEFAULT_SCHEMA_PATH && defaultSchemaValidator) return defaultSchemaValidator;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const compiled = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
  if (schemaPath === DEFAULT_SCHEMA_PATH) defaultSchemaValidator = compiled;
  return compiled;
}

export function validateGuardedWriterReconciliationPlan(plan, {
  expectedAuthorizationDigest,
  expectedSourceCommit,
  schemaPath = DEFAULT_SCHEMA_PATH,
} = {}) {
  if (plan?.cleanup?.automatic !== false || plan?.cleanup?.deleteAuthorized !== false
    || plan?.cleanup?.applyAvailable !== false || plan?.cleanup?.applyCommand !== null
    || !["NO_TARGET", "RETAIN_FOR_REVIEW"].includes(plan?.cleanup?.disposition)) {
    fail("plan attempts to authorize mutation", "RECONCILIATION_MUTATION_FORBIDDEN");
  }
  const validate = reconciliationSchemaValidator(schemaPath);
  if (!validate(plan)) fail("plan shape is invalid", "RECONCILIATION_PLAN_INVALID", { errors: validate.errors ?? [] });
  if (expectedAuthorizationDigest !== undefined && plan.authorizationDigest !== expectedAuthorizationDigest) {
    fail("plan authorization binding drifted", "RECONCILIATION_PLAN_BINDING_DRIFT");
  }
  if (expectedSourceCommit !== undefined && plan.sourceCommit !== expectedSourceCommit) {
    fail("plan source binding drifted", "RECONCILIATION_PLAN_BINDING_DRIFT");
  }
  if (plan.planDigest !== guardedWriterReconciliationPlanDigest(plan)) {
    fail("plan digest drift detected", "RECONCILIATION_PLAN_DIGEST_DRIFT");
  }
  return Object.freeze(jsonClone(plan));
}

export async function createGuardedWriterReconciliationPlan({
  configRoot,
  repositoryRoot,
  authorizationId,
  authorizationDigest,
  sourceCommit,
  homedir = os.homedir,
  now = () => Date.now(),
} = {}) {
  if (!AUTHORIZATION_ID.test(authorizationId ?? "") || !SHA256.test(authorizationDigest ?? "")
    || !FULL_COMMIT.test(sourceCommit ?? "")) {
    fail("authorization/source bindings are invalid", "RECONCILIATION_BINDING_INVALID");
  }
  const resolvedConfigRoot = await realLeafDirectory(configRoot, "configRoot");
  const resolvedRepositoryRoot = await realLeafDirectory(repositoryRoot, "repositoryRoot");
  const resolvedHome = await fsPromises.realpath(path.resolve(homedir())).catch(() => path.resolve(homedir()));
  if (inside(path.join(resolvedHome, ".pi"), resolvedConfigRoot)) {
    fail("the real Pi home cannot be reconciled", "RECONCILIATION_REAL_PI_HOME_FORBIDDEN");
  }
  if (inside(resolvedConfigRoot, resolvedRepositoryRoot) || inside(resolvedRepositoryRoot, resolvedConfigRoot)) {
    fail("source and disposable config roots must be disjoint", "RECONCILIATION_ROOT_OVERLAP");
  }
  const runtimeRelativePath = path.posix.join("only-my-pi", "subagents-guarded-writer", authorizationId);
  const runtimeRoot = path.join(resolvedConfigRoot, RUNTIME_PREFIX, authorizationId);
  let runtimeStat;
  try { runtimeStat = await fsPromises.lstat(runtimeRoot); } catch (error) {
    if (error?.code !== "ENOENT") fail("runtime target cannot be inspected", "RECONCILIATION_RUNTIME_UNREADABLE");
    runtimeStat = null;
  }

  let runtimeState = "NOT_FOUND";
  let request = Object.freeze({ state: "MISSING", digest: null, findings: Object.freeze(["REQUEST_MISSING"]) });
  let components = Object.freeze(COMPONENTS.map((entry) => Object.freeze({ ...entry, state: "MISSING" })));
  const blockers = [];
  if (runtimeStat !== null) {
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) {
      runtimeState = "UNSAFE";
      blockers.push("UNSAFE_PATH_TOPOLOGY");
    } else {
      const realRuntime = await fsPromises.realpath(runtimeRoot).catch(() => null);
      if (realRuntime !== runtimeRoot || !inside(resolvedConfigRoot, realRuntime ?? path.parse(resolvedConfigRoot).root)) {
        runtimeState = "UNSAFE";
        blockers.push("UNSAFE_PATH_TOPOLOGY");
      } else {
        components = Object.freeze(await Promise.all(COMPONENTS.map((entry) => inspectEntry(runtimeRoot, entry))));
        request = await inspectRequest(runtimeRoot, { authorizationDigest, sourceCommit });
        if (components.some((entry) => ["SYMLINK", "TYPE_MISMATCH", "UNREADABLE"].includes(entry.state))
          || request.state === "UNSAFE" || request.findings.includes("REQUEST_PATH_BINDING_DRIFT")) {
          runtimeState = "UNSAFE";
          blockers.push("UNSAFE_PATH_TOPOLOGY");
        } else if (components.some((entry) => entry.state === "MISSING") || request.state !== "VALID") {
          runtimeState = "PARTIAL";
          blockers.push("RUNTIME_PARTIAL");
        } else {
          runtimeState = "READY_FOR_REVIEW";
        }
        blockers.push(...request.findings);
      }
    }
  } else {
    blockers.push("RUNTIME_NOT_FOUND");
  }
  if (runtimeState !== "NOT_FOUND") {
    blockers.push("ACTIVE_PROCESS_STATUS_UNVERIFIED", "EVIDENCE_STAGING_STATUS_UNVERIFIED", "OPERATOR_REVIEW_REQUIRED");
  }
  const componentSummary = components.map(({ id, expectedType, state }) => ({ id, expectedType, state }));
  const targetDigest = sha256({
    configRootFingerprint: sha256(resolvedConfigRoot),
    runtimeRelativePath,
    authorizationDigest,
    sourceCommit,
    requestDigest: request.digest,
    components: componentSummary,
  });
  const plan = {
    $schema: SCHEMA,
    formatVersion: 1,
    contractStatus: "review-only",
    operation: "guarded-writer-reconciliation-plan",
    authorizationId,
    authorizationDigest,
    sourceCommit,
    observedAt: new Date(now()).toISOString(),
    configRootFingerprint: sha256(resolvedConfigRoot),
    runtimeRelativePath,
    runtimeState,
    request: {
      state: request.state,
      digest: request.digest,
      findings: [...request.findings],
    },
    components: componentSummary,
    blockers: [...new Set(blockers)].sort(),
    cleanup: {
      disposition: runtimeState === "NOT_FOUND" ? "NO_TARGET" : "RETAIN_FOR_REVIEW",
      automatic: false,
      deleteAuthorized: false,
      applyAvailable: false,
      applyCommand: null,
      exactTargetDigest: targetDigest,
    },
  };
  plan.planDigest = guardedWriterReconciliationPlanDigest(plan);
  return validateGuardedWriterReconciliationPlan(plan, { expectedAuthorizationDigest: authorizationDigest, expectedSourceCommit: sourceCommit });
}

export const SUBAGENTS_GUARDED_WRITER_RECONCILIATION_SCHEMA = SCHEMA;
export const SUBAGENTS_GUARDED_WRITER_RUNTIME_PREFIX = RUNTIME_PREFIX;
