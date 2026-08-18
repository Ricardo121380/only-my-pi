import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import {
  assertPlainJson,
  canonicalJson,
  jsonClone,
  sha256,
  withoutKey,
} from "./codec.mjs";
import {
  digestWorkflowValue,
  validateWorkflowPlan,
} from "../workflow/plan-compiler/index.mjs";

const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const REQUEST_ID = /^[a-z0-9][a-z0-9._:-]{0,191}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PLAN_SCHEMA = "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-run-plan-v1.schema.json";
const CANCEL_SCHEMA = "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-cancel-request-v1.schema.json";
const EXECUTION_ENVELOPE_KEYS = Object.freeze([
  "conditions",
  "executionEnvelopeDigest",
  "formatVersion",
  "planDigest",
  "runId",
  "runInputDigest",
  "sourceHash",
  "target",
]);
const EXECUTION_TARGET_KEYS = Object.freeze(["id", "kind"]);
const PLAN_KEYS = Object.freeze([
  "$schema",
  "contractStatus",
  "createdAt",
  "digest",
  "executionEnvelope",
  "executionEnvelopeDigest",
  "formatVersion",
  "inputDigest",
  "inputPolicy",
  "plan",
  "planDigest",
  "runId",
  "sourceHash",
  "updatedAt",
]);
const CANCEL_KEYS = Object.freeze([
  "$schema",
  "createdAt",
  "digest",
  "formatVersion",
  "reason",
  "requestId",
  "runId",
  "status",
  "updatedAt",
]);

export class PlanStoreError extends Error {
  constructor(message, code = "PLAN_STORE_ERROR", details = {}, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PlanStoreError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details, cause) {
  throw new PlanStoreError(message, code, details, cause);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!object(value)) fail(`${label} must be an object`, "PLAN_RECORD_INVALID");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail(`${label} contains unknown or missing fields`, "PLAN_RECORD_INVALID", { actual, expected: wanted });
  }
}

function validateRunId(value) {
  if (typeof value !== "string" || !RUN_ID.test(value)) fail("runId is invalid", "INVALID_RUN_ID");
  return value;
}

function validateRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) fail("cancel requestId is invalid", "INVALID_CANCEL_REQUEST");
  return value;
}

function validateDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} is not a sha256 digest`, "PLAN_RECORD_INVALID");
  return value;
}

function validateInstant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${label} is not an ISO timestamp`, "PLAN_RECORD_INVALID");
  return value;
}

function immutable(value) {
  if (Array.isArray(value)) {
    value.forEach(immutable);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    return Object.freeze(value);
  }
  return value;
}

function clone(value) {
  return value === undefined ? undefined : jsonClone(value);
}

function nowIso(clock) {
  const raw = clock();
  const date = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(date.valueOf())) fail("clock returned an invalid instant", "INVALID_CLOCK");
  return date.toISOString();
}

function generatedId(prefix, idFactory) {
  const candidate = idFactory?.(prefix) ?? `${prefix}-${crypto.randomUUID()}`;
  return validateRequestId(candidate);
}

function digestEnvelope(envelope) {
  if (!object(envelope)) fail("executionEnvelope must be an object", "PLAN_RECORD_INVALID");
  const withoutDigest = withoutKey(envelope, "executionEnvelopeDigest");
  return digestWorkflowValue(withoutDigest);
}

function validateExecutionEnvelope(envelope, { runId, planDigest, inputDigest, sourceHash }) {
  exactKeys(envelope, EXECUTION_ENVELOPE_KEYS, "execution envelope");
  exactKeys(envelope.target, EXECUTION_TARGET_KEYS, "execution target");
  if (envelope.formatVersion !== 1) fail("execution envelope version is invalid", "PLAN_RECORD_INVALID");
  if (envelope.runId !== runId || envelope.planDigest !== planDigest || envelope.runInputDigest !== inputDigest || envelope.sourceHash !== sourceHash) {
    fail("plan record execution envelope is not bound to the plan, run, input, or source", "PLAN_RECORD_DRIFT");
  }
  if (!["workflow", "swarm"].includes(envelope.target.kind)
    || typeof envelope.target.id !== "string"
    || !RUN_ID.test(envelope.target.id)) {
    fail("execution target is invalid", "PLAN_RECORD_INVALID");
  }
  if (!Array.isArray(envelope.conditions) || envelope.conditions.length > 128) {
    fail("execution conditions must be a bounded array", "PLAN_RECORD_INVALID");
  }
  const canonicalConditions = [...envelope.conditions].sort();
  if (new Set(envelope.conditions).size !== envelope.conditions.length
    || canonicalJson(canonicalConditions) !== canonicalJson(envelope.conditions)
    || envelope.conditions.some((condition) => typeof condition !== "string"
      || condition.length < 1
      || condition.length > 256
      || /[\0\r\n]/u.test(condition))) {
    fail("execution conditions must be unique, sorted, and bounded", "PLAN_RECORD_INVALID");
  }
  validateDigest(envelope.executionEnvelopeDigest, "executionEnvelopeDigest");
  if (digestEnvelope(envelope) !== envelope.executionEnvelopeDigest) fail("execution envelope digest is invalid", "PLAN_RECORD_TAMPERED");
  return envelope;
}

function validatePlan(plan) {
  const checked = validateWorkflowPlan(plan);
  if (!checked.valid) fail(checked.errors[0]?.message ?? "WorkflowPlan is invalid", checked.errors[0]?.code ?? "PLAN_RECORD_INVALID");
  return clone(plan);
}

function normalizePlanRecord(input) {
  if (!object(input)) fail("plan record must be an object", "PLAN_RECORD_INVALID");
  exactKeys(input, PLAN_KEYS, "plan record");
  const plan = validatePlan(input.plan);
  const runId = validateRunId(input.runId);
  if (input.formatVersion !== 1 || input.contractStatus !== "contract-preview") fail("plan record version or status is invalid", "PLAN_RECORD_INVALID");
  if (input.$schema !== PLAN_SCHEMA) fail("plan record schema is invalid", "PLAN_RECORD_INVALID");
  if (input.planDigest !== plan.planDigest) fail("plan record planDigest differs from plan", "PLAN_RECORD_DRIFT");
  validateDigest(input.sourceHash, "sourceHash");
  validateDigest(input.inputDigest, "inputDigest");
  validateDigest(input.executionEnvelopeDigest, "executionEnvelopeDigest");
  if (input.inputPolicy !== "caller-must-reprovide") fail("plan record inputPolicy is invalid", "PLAN_RECORD_INVALID");
  const envelope = validateExecutionEnvelope(
    assertPlainJson(input.executionEnvelope, "execution envelope"),
    { runId, planDigest: plan.planDigest, inputDigest: input.inputDigest, sourceHash: input.sourceHash },
  );
  if (envelope.sourceHash !== input.sourceHash || envelope.executionEnvelopeDigest !== input.executionEnvelopeDigest) {
    fail("plan record execution envelope digest or source differs", "PLAN_RECORD_DRIFT");
  }
  validateInstant(input.createdAt, "createdAt");
  validateInstant(input.updatedAt, "updatedAt");
  const withoutDigest = withoutKey(input, "digest");
  if (input.digest !== sha256(withoutDigest)) fail("plan record digest is invalid", "PLAN_RECORD_TAMPERED");
  return immutable({
    $schema: PLAN_SCHEMA,
    contractStatus: "contract-preview",
    createdAt: input.createdAt,
    digest: input.digest,
    executionEnvelope: envelope,
    executionEnvelopeDigest: input.executionEnvelopeDigest,
    formatVersion: 1,
    inputDigest: input.inputDigest,
    inputPolicy: "caller-must-reprovide",
    plan,
    planDigest: input.planDigest,
    runId,
    sourceHash: input.sourceHash,
    updatedAt: input.updatedAt,
  });
}

function samePlanBinding(left, right) {
  return left?.runId === right?.runId
    && left?.planDigest === right?.planDigest
    && left?.sourceHash === right?.sourceHash
    && left?.inputDigest === right?.inputDigest
    && left?.executionEnvelopeDigest === right?.executionEnvelopeDigest;
}

function normalizeCancelRequest(input) {
  if (!object(input)) fail("cancel request must be an object", "CANCEL_REQUEST_INVALID");
  exactKeys(input, CANCEL_KEYS, "cancel request");
  if (input.$schema !== CANCEL_SCHEMA || input.formatVersion !== 1 || input.status !== "PENDING") fail("cancel request version or status is invalid", "CANCEL_REQUEST_INVALID");
  validateRunId(input.runId);
  validateRequestId(input.requestId);
  if (typeof input.reason !== "string" || input.reason.length < 1 || input.reason.length > 512 || /[\0\r\n]/u.test(input.reason)) fail("cancel request reason is invalid", "CANCEL_REQUEST_INVALID");
  validateInstant(input.createdAt, "cancel request createdAt");
  validateInstant(input.updatedAt, "cancel request updatedAt");
  if (input.digest !== sha256(withoutKey(input, "digest"))) fail("cancel request digest is invalid", "CANCEL_REQUEST_TAMPERED");
  return immutable(jsonClone(input));
}

async function readJson(filesystem, filename) {
  try {
    const text = await filesystem.readFile(filename, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) fail("stored JSON is invalid", "PLAN_STORE_CORRUPT", { filename }, error);
    throw error;
  }
}

async function fsyncDirectory(filesystem, directory) {
  if (typeof filesystem.open !== "function") return;
  const handle = await filesystem.open(directory, "r");
  try { await handle.sync?.(); } finally { await handle.close?.(); }
}

let tempCounter = 0;

async function assertNoSymlink(filesystem, rootDir, target) {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteTarget = path.resolve(target);
  try {
    const rootStat = await filesystem.lstat(absoluteRoot);
    if (rootStat.isSymbolicLink()) fail("plan store root must not be a symlink", "PLAN_STORE_SYMLINK");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("plan store path escapes root", "PLAN_STORE_PATH_ESCAPE");
  const segments = relative.split(path.sep).filter(Boolean);
  let current = absoluteRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await filesystem.lstat(current);
      if (stat.isSymbolicLink()) fail("plan store refuses symlinked state path", "PLAN_STORE_SYMLINK");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      break;
    }
  }
}

async function ensureDirectory(filesystem, rootDir, directory) {
  await assertNoSymlink(filesystem, rootDir, directory);
  await filesystem.mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNoSymlink(filesystem, rootDir, directory);
}

async function atomicCreate(filesystem, rootDir, filename, text) {
  const directory = path.dirname(filename);
  await ensureDirectory(filesystem, rootDir, directory);
  await assertNoSymlink(filesystem, rootDir, filename);
  const temporary = `${filename}.tmp-${process.pid}-${++tempCounter}`;
  let handle;
  let published = false;
  try {
    handle = await filesystem.open(temporary, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync?.();
    await handle.close?.();
    handle = undefined;
    await assertNoSymlink(filesystem, rootDir, directory);
    // A hard link is the create-if-absent atomic publication primitive.  Do
    // not fall back to directly writing the target: a crash could expose a
    // partial record that blocks deterministic recovery.
    await filesystem.link(temporary, filename);
    published = true;
    await filesystem.unlink(temporary);
    await fsyncDirectory(filesystem, directory);
  } catch (cause) {
    await handle?.close?.().catch?.(() => {});
    if (!published) await filesystem.unlink(temporary).catch((error) => { if (error?.code !== "ENOENT") throw error; });
    if (cause?.code === "EEXIST") {
      throw new PlanStoreError("immutable plan record already exists", "PLAN_STORE_EXISTS", { filename }, cause);
    }
    const error = new PlanStoreError("atomic plan store create failed", "PLAN_STORE_WRITE_FAILED", { filename }, cause);
    error.publication = published ? "PUBLISHED_NOT_CONFIRMED_DURABLE" : "NOT_PUBLISHED";
    throw error;
  }
}

function pathsFor(rootDir, runId) {
  return Object.freeze({
    runDir: path.join(rootDir, runId),
    plan: path.join(rootDir, runId, "plan.json"),
    cancel: path.join(rootDir, runId, "cancel-request.json"),
  });
}

/**
 * Durable metadata sidecar for the unified RunCoordinator.
 *
 * The event journal remains the source of truth for execution state. This
 * store only preserves the immutable plan/envelope needed to re-project a
 * run after a process restart, plus an intent file for cross-process cancel.
 * Raw input is deliberately never persisted; resume must receive it again and
 * its digest must match the stored envelope.
 */
export function createPlanStore({
  rootDir,
  filesystem = fs,
  clock = () => Date.now(),
  idFactory,
} = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("createPlanStore requires an absolute rootDir");
  if (!filesystem || typeof filesystem.readFile !== "function" || typeof filesystem.open !== "function" || typeof filesystem.lstat !== "function" || typeof filesystem.link !== "function") {
    throw new TypeError("createPlanStore requires an injected filesystem with readFile/open/lstat/link");
  }
  if (typeof clock !== "function") throw new TypeError("createPlanStore requires a clock function");

  async function get(runId) {
    const id = validateRunId(runId);
    const paths = pathsFor(rootDir, id);
    const raw = await readJson(filesystem, paths.plan);
    if (raw === null) return null;
    try {
      return normalizePlanRecord(raw);
    } catch (cause) {
      if (cause instanceof PlanStoreError) {
        cause.filename = paths.plan;
        throw cause;
      }
      throw new PlanStoreError("stored plan could not be validated", "PLAN_RECORD_CORRUPT", { filename: paths.plan }, cause);
    }
  }

  async function put(input = {}) {
    const runId = validateRunId(input.runId);
    const plan = validatePlan(input.plan);
    const executionEnvelope = assertPlainJson(input.executionEnvelope, "execution envelope");
    const inputDigest = validateDigest(input.inputDigest ?? executionEnvelope.runInputDigest, "inputDigest");
    const sourceHash = validateDigest(input.sourceHash ?? executionEnvelope.sourceHash, "sourceHash");
    const executionEnvelopeDigest = validateDigest(input.executionEnvelopeDigest ?? executionEnvelope.executionEnvelopeDigest, "executionEnvelopeDigest");
    const paths = pathsFor(rootDir, runId);
    const existing = await get(runId);
    const timestamp = nowIso(clock);
    const recordWithoutDigest = {
      $schema: PLAN_SCHEMA,
      contractStatus: "contract-preview",
      createdAt: existing?.createdAt ?? timestamp,
      executionEnvelope,
      executionEnvelopeDigest,
      formatVersion: 1,
      inputDigest,
      inputPolicy: "caller-must-reprovide",
      plan,
      planDigest: plan.planDigest,
      runId,
      sourceHash,
      updatedAt: existing?.updatedAt ?? timestamp,
    };
    const record = normalizePlanRecord({ ...recordWithoutDigest, digest: sha256(recordWithoutDigest) });
    if (existing !== null) {
      if (existing.digest !== record.digest) fail("a different immutable plan is already bound to this run", "PLAN_STORE_CONFLICT", { runId, existingDigest: existing.digest, requestedDigest: record.digest });
      return Object.freeze({ status: "DUPLICATE", record: existing });
    }
    try {
      await atomicCreate(filesystem, rootDir, paths.plan, `${canonicalJson(record)}\n`);
    } catch (cause) {
      if (cause?.code !== "PLAN_STORE_EXISTS") throw cause;
      const raced = await get(runId);
      if (raced?.digest === record.digest || samePlanBinding(raced, record)) return Object.freeze({ status: "DUPLICATE", record: raced });
      fail("a different immutable plan won the race for this run", "PLAN_STORE_CONFLICT", { runId, requestedDigest: record.digest, existingDigest: raced?.digest ?? null });
    }
    return Object.freeze({ status: "CREATED", record });
  }

  async function requestCancel(runId, { reason = "cancel-requested", requestId } = {}) {
    const id = validateRunId(runId);
    if (typeof reason !== "string" || reason.length < 1 || reason.length > 512 || /[\0\r\n]/u.test(reason)) fail("cancel request reason is invalid", "INVALID_CANCEL_REQUEST");
    const paths = pathsFor(rootDir, id);
    const existingRaw = await readJson(filesystem, paths.cancel);
    if (existingRaw !== null) {
      const existing = normalizeCancelRequest(existingRaw);
      return Object.freeze({ status: "DUPLICATE", request: existing });
    }
    const timestamp = nowIso(clock);
    const request = {
      $schema: CANCEL_SCHEMA,
      createdAt: timestamp,
      formatVersion: 1,
      reason,
      requestId: validateRequestId(requestId ?? generatedId("cancel-request", idFactory)),
      runId: id,
      status: "PENDING",
      updatedAt: timestamp,
    };
    const complete = normalizeCancelRequest({ ...request, digest: sha256(request) });
    try {
      await atomicCreate(filesystem, rootDir, paths.cancel, `${canonicalJson(complete)}\n`);
    } catch (cause) {
      if (cause?.code !== "PLAN_STORE_EXISTS") throw cause;
      const raced = await getCancelRequest(id);
      return Object.freeze({ status: "DUPLICATE", request: raced });
    }
    return Object.freeze({ status: "CREATED", request: complete });
  }

  async function getCancelRequest(runId) {
    const id = validateRunId(runId);
    const paths = pathsFor(rootDir, id);
    const raw = await readJson(filesystem, paths.cancel);
    if (raw === null) return null;
    return normalizeCancelRequest(raw);
  }

  return Object.freeze({
    rootDir,
    paths: pathsFor,
    get,
    require: async (runId) => {
      const record = await get(runId);
      if (record === null) fail("no durable plan is bound to this run", "PLAN_NOT_FOUND", { runId });
      return record;
    },
    put,
    save: put,
    requestCancel,
    getCancelRequest,
  });
}

export { PLAN_SCHEMA as WORKFLOW_RUN_PLAN_SCHEMA, CANCEL_SCHEMA as WORKFLOW_CANCEL_REQUEST_SCHEMA };
