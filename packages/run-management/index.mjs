import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TERMINAL = new Set(["completed", "failed", "cancelled", "orphaned", "timed-out", "budget-exhausted", "unavailable"]);
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RECORD_SCHEMA = "https://github.com/Ricardo121380/only-my-pi/schemas/run-record-v1.schema.json";

function fail(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); throw error; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest("hex")}`; }
function withoutDigest(value) { const { recordDigest: _recordDigest, ...rest } = value; return rest; }
function nowIso(clock) { const raw = clock(); const value = raw instanceof Date ? raw : new Date(raw); if (!Number.isFinite(value.valueOf())) fail("RUN_RECORD_CLOCK_INVALID", "run record clock is invalid"); return value.toISOString(); }
function contained(root, target) { const relative = path.relative(path.resolve(root), path.resolve(target)); if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("RUN_RECORD_PATH_ESCAPE", "run record path escapes its root"); return path.resolve(target); }
function runId(value) { if (typeof value !== "string" || !RUN_ID.test(value)) fail("RUN_ID_INVALID", "runId is invalid"); return value; }

async function assertNoSymlink(root, target) {
  contained(root, target);
  let current = path.resolve(root);
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    try { const stat = await fs.lstat(current); if (stat.isSymbolicLink()) fail("RUN_RECORD_PATH_UNSAFE", "run record path traverses a symlink"); }
    catch (cause) { if (cause?.code !== "ENOENT") throw cause; break; }
  }
}

async function ensurePrivate(root, directory) {
  await assertNoSymlink(root, directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("RUN_RECORD_PATH_UNSAFE", "run record directory must be real");
  await fs.chmod(directory, 0o700);
}

async function readJson(target) {
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) fail("RUN_RECORD_INVALID", "run record must be a bounded regular file");
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    if (cause instanceof SyntaxError) fail("RUN_RECORD_INVALID", "run record is not valid JSON");
    if (["ELOOP", "EMLINK"].includes(cause?.code)) fail("RUN_RECORD_PATH_UNSAFE", "run record may not be a symlink");
    throw cause;
  } finally { await handle?.close().catch(() => {}); }
}

async function atomicWrite(root, target, value) {
  const directory = path.dirname(target);
  await ensurePrivate(root, directory);
  await assertNoSymlink(root, target);
  const temporary = path.join(directory, `.run-record-${process.pid}-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally { await handle?.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
}

function artifactSummary(ref) {
  if (!ref || ref.kind !== "artifact-ref" || !RUN_ID.test(ref.id ?? "") || !DIGEST.test(ref.digest ?? "") || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0 || typeof ref.storage?.relativePath !== "string") fail("RUN_RECORD_ARTIFACT_INVALID", "projection contains an invalid ArtifactRef");
  return { id: ref.id, digest: ref.digest, relativePath: ref.storage.relativePath, byteLength: ref.byteLength };
}
function artifactsFromProjection(projection) {
  const byId = new Map();
  for (const node of Object.values(projection?.nodes ?? {})) for (const ref of node.artifacts ?? []) byId.set(ref.id, artifactSummary(ref));
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
function normalizedRecord(input) {
  const value = { ...input, recordDigest: digest(withoutDigest(input)) };
  if (input.recordDigest !== undefined && input.recordDigest !== value.recordDigest) fail("RUN_RECORD_TAMPERED", "run record digest is invalid");
  return Object.freeze(value);
}

export function createRunRecordStore({ managedRoot, clock = Date.now, retentionMs = RETENTION_MS } = {}) {
  if (typeof managedRoot !== "string" || !path.isAbsolute(managedRoot)) throw new TypeError("createRunRecordStore requires absolute managedRoot");
  if (typeof clock !== "function") throw new TypeError("createRunRecordStore requires clock()");
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 1) throw new TypeError("retentionMs must be positive");
  const root = path.resolve(managedRoot);
  const runsRoot = path.join(root, "runs");
  const pathFor = (id) => path.join(runsRoot, runId(id), "run-record.json");

  async function get(id) {
    const raw = await readJson(pathFor(id));
    return raw === null ? null : normalizedRecord(raw);
  }
  async function save(value) { const record = normalizedRecord(value); await atomicWrite(root, pathFor(record.runId), record); return record; }
  async function begin({ id, sessionId, repository, configurationDigest, planDigest, executionEnvelopeDigest, input, inputDigest }) {
    const existing = await get(id);
    if (existing) {
      if (existing.planDigest !== planDigest || existing.executionEnvelopeDigest !== executionEnvelopeDigest || existing.inputDigest !== inputDigest) fail("RUN_RECORD_CONFLICT", "run record binding differs from the requested execution");
      return existing;
    }
    const timestamp = nowIso(clock);
    return save({
      $schema: RECORD_SCHEMA, formatVersion: 1, kind: "private-run-record", runId: runId(id), createdAt: timestamp, updatedAt: timestamp,
      sessionId, repository, configurationDigest, planDigest, executionEnvelopeDigest, inputDigest, input: canonical(input), inputRetained: true,
      status: "planned", terminalAt: null, artifacts: [], artifactsRetained: true, receiptDigest: null,
    });
  }
  async function update(id, patch = {}) {
    const existing = await get(id);
    if (!existing) fail("RUN_RECORD_NOT_FOUND", `run record not found: ${id}`);
    const status = patch.status ?? existing.status;
    const timestamp = nowIso(clock);
    const terminalAt = TERMINAL.has(status) ? (existing.terminalAt ?? timestamp) : null;
    return save({ ...withoutDigest(existing), ...patch, runId: existing.runId, createdAt: existing.createdAt, updatedAt: timestamp, status, terminalAt });
  }
  async function updateProjection(id, projection) {
    return update(id, { status: projection.status, artifacts: artifactsFromProjection(projection), artifactsRetained: true, receiptDigest: projection.terminal ? digest(projection.terminal) : null });
  }
  async function list() {
    let entries;
    try { entries = await fs.readdir(runsRoot, { withFileTypes: true }); } catch (cause) { if (cause?.code === "ENOENT") return []; throw cause; }
    if (entries.length > 10_000) fail("RUN_RECORD_CAPACITY_EXCEEDED", "run record directory exceeds 10,000 entries");
    const records = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink?.() || !RUN_ID.test(entry.name)) continue;
      const record = await get(entry.name);
      if (record) records.push(record);
    }
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async function gcPlan() {
    const now = Number(clock());
    const candidates = (await list()).filter((record) => TERMINAL.has(record.status) && record.terminalAt !== null && now - Date.parse(record.terminalAt) >= retentionMs && (record.inputRetained || record.artifactsRetained));
    const projection = candidates.map((record) => ({ runId: record.runId, recordDigest: record.recordDigest, terminalAt: record.terminalAt, inputBytes: record.inputRetained ? Buffer.byteLength(JSON.stringify(record.input)) : 0, artifacts: record.artifactsRetained ? record.artifacts : [] }));
    return Object.freeze({ ok: true, status: "RUN_GC_PLAN", mutation: false, retentionDays: retentionMs / 86_400_000, candidates: Object.freeze(projection), planDigest: digest(projection) });
  }
  async function gcApply(plan) {
    const current = await gcPlan();
    if (current.planDigest !== plan?.planDigest) fail("RUN_GC_PLAN_STALE", "run GC candidates changed after planning");
    const deleted = [];
    for (const candidate of current.candidates) {
      const record = await get(candidate.runId);
      if (!record || record.recordDigest !== candidate.recordDigest || !TERMINAL.has(record.status)) fail("RUN_GC_PLAN_STALE", `run ${candidate.runId} changed before GC`);
      for (const artifact of record.artifacts) {
        const target = contained(root, path.resolve(root, artifact.relativePath));
        await assertNoSymlink(root, target);
        const bytes = await fs.readFile(target);
        if (bytes.byteLength !== artifact.byteLength || digest(bytes) !== artifact.digest) fail("RUN_ARTIFACT_DRIFT", `artifact ${artifact.id} drifted before GC`);
        await fs.unlink(target);
      }
      const updated = await update(record.runId, { input: null, inputRetained: false, artifactsRetained: false });
      deleted.push({ runId: record.runId, inputDeleted: record.inputRetained, artifactCount: record.artifacts.length, retainedReceiptDigest: updated.receiptDigest, recordDigest: updated.recordDigest });
    }
    return Object.freeze({ ok: true, status: "RUN_GC_APPLIED", mutation: deleted.length > 0, deleted: Object.freeze(deleted), planDigest: current.planDigest });
  }
  return Object.freeze({ managedRoot: root, runsRoot, retentionMs, get, require: async (id) => { const record = await get(id); if (!record) fail("RUN_RECORD_NOT_FOUND", `run record not found: ${id}`); return record; }, begin, update, updateProjection, list, gcPlan, gcApply });
}

export function createManagedCoordinator({ coordinator, recordStore, contextProvider } = {}) {
  if (!coordinator || ["execute", "inspect", "cancel", "resume"].some((method) => typeof coordinator[method] !== "function")) throw new TypeError("managed coordinator requires a RunCoordinator");
  if (!recordStore || typeof recordStore.begin !== "function") throw new TypeError("managed coordinator requires a run record store");
  if (typeof contextProvider !== "function") throw new TypeError("managed coordinator requires contextProvider()");
  const active = new Set();
  async function boundContext() {
    const context = await contextProvider();
    if (!context?.repository || !DIGEST.test(context.configurationDigest ?? "")) fail("RUN_CONTEXT_UNAVAILABLE", "run context is unavailable");
    return context;
  }
  async function execute(plan, options = {}) {
    const context = await boundContext();
    const run = options.runId;
    await recordStore.begin({ id: run, sessionId: context.sessionId, repository: context.repository, configurationDigest: context.configurationDigest, planDigest: plan.planDigest, executionEnvelopeDigest: options.executionEnvelope?.executionEnvelopeDigest ?? digest({ run, plan: plan.planDigest, input: options.input ?? {} }), input: options.input ?? {}, inputDigest: digest(options.input ?? {}) });
    await recordStore.update(run, { status: "running" });
    active.add(run);
    try {
      const projection = await coordinator.execute(plan, options);
      await recordStore.updateProjection(run, projection);
      return projection;
    } catch (cause) {
      await recordStore.update(run, { status: "interrupted" }).catch(() => {});
      throw cause;
    } finally { active.delete(run); }
  }
  async function inspect(id, plan) {
    const result = await coordinator.inspect(id, plan);
    await recordStore.updateProjection(id, result.projection).catch(() => {});
    return result;
  }
  async function cancel(id, options) { const result = await coordinator.cancel(id, options); await recordStore.update(id, { status: result.status === "RUN_ALREADY_TERMINAL" ? (await recordStore.require(id)).status : "interrupted" }).catch(() => {}); return result; }
  async function resume(id, options = {}) {
    const record = await recordStore.require(id);
    const context = await boundContext();
    if (record.repository.rootDigest !== context.repository.rootDigest || record.repository.head !== context.repository.head) fail("RUN_REPOSITORY_DRIFT", "repository identity changed since the run was created");
    if (record.configurationDigest !== context.configurationDigest) fail("RUN_CONFIGURATION_DRIFT", "only-my-pi configuration changed since the run was created");
    const input = options.input ?? (record.inputRetained ? record.input : undefined);
    if (input === undefined) fail("RUN_INPUT_REQUIRED_FOR_RESUME", "raw task was collected; resume requires the original input again");
    await recordStore.update(id, { status: "recovering" });
    active.add(id);
    try { const projection = await coordinator.resume(id, { ...options, input }); await recordStore.updateProjection(id, projection); return projection; }
    catch (cause) { await recordStore.update(id, { status: "interrupted" }).catch(() => {}); throw cause; }
    finally { active.delete(id); }
  }
  async function shutdown() {
    const interrupted = [];
    for (const id of [...active]) { await coordinator.pause?.(id).catch(() => {}); await recordStore.update(id, { status: "interrupted" }).catch(() => {}); interrupted.push(id); }
    return Object.freeze({ status: "SESSION_RUNS_INTERRUPTED", runIds: Object.freeze(interrupted) });
  }
  return Object.freeze({ execute, inspect, cancel, resume, pause: (id) => coordinator.pause?.(id), shutdown, active: () => Object.freeze([...active]) });
}

async function beginExternalRecord(recordStore, contextProvider, { runId: id, planDigest, executionEnvelopeDigest, input }) {
  const context = await contextProvider();
  await recordStore.begin({ id, sessionId: context.sessionId, repository: context.repository, configurationDigest: context.configurationDigest, planDigest, executionEnvelopeDigest, input, inputDigest: digest(input ?? {}) });
  await recordStore.update(id, { status: "running" });
}

export function createRecordedGoalController({ controller, recordStore, contextProvider } = {}) {
  if (!controller || typeof controller.run !== "function" || typeof controller.inspect !== "function") throw new TypeError("recorded Goal controller requires run/inspect");
  return Object.freeze({
    async run(goal, options = {}) {
      const id = runId(options.runId);
      const planDigest = digest(goal);
      const envelopeDigest = options.authorization?.authorizationDigest ?? digest({ id, planDigest, input: options.input ?? {} });
      await beginExternalRecord(recordStore, contextProvider, { runId: id, planDigest, executionEnvelopeDigest: envelopeDigest, input: options.input ?? {} });
      try {
        const projection = await controller.run(goal, options);
        await recordStore.update(id, { status: projection.status, receiptDigest: projection.terminal ? digest(projection.terminal) : null });
        return projection;
      } catch (cause) { await recordStore.update(id, { status: "interrupted" }).catch(() => {}); throw cause; }
    },
    async inspect(id) { const projection = await controller.inspect(id); await recordStore.update(id, { status: projection.status, receiptDigest: projection.terminal ? digest(projection.terminal) : null }).catch(() => {}); return projection; },
  });
}

export function createRecordedUltraRouter({ router, recordStore, contextProvider } = {}) {
  if (!router || typeof router.plan !== "function" || typeof router.run !== "function") throw new TypeError("recorded Ultra router requires plan/run");
  return Object.freeze({
    plan: (...args) => router.plan(...args),
    async run(definition, request, options = {}) {
      const plan = router.plan(definition, request);
      const id = runId(plan.request.id);
      await beginExternalRecord(recordStore, contextProvider, { runId: id, planDigest: plan.planDigest, executionEnvelopeDigest: options.authorization?.authorizationDigest ?? plan.planDigest, input: options.input ?? {} });
      try {
        const result = await router.run(definition, request, options);
        await recordStore.update(id, { status: result.result.status, receiptDigest: digest({ planDigest: result.plan.planDigest, result: result.result }) });
        return result;
      } catch (cause) { await recordStore.update(id, { status: "interrupted" }).catch(() => {}); throw cause; }
    },
  });
}

export class RunManagementService {
  constructor({ recordStore, coordinator = null } = {}) { if (!recordStore) throw new TypeError("RunManagementService requires recordStore"); this.records = recordStore; this.coordinator = coordinator; }
  async list() { const records = await this.records.list(); return { ok: true, status: "RUN_LIST", mutation: false, runs: records.map((record) => ({ runId: record.runId, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, terminalAt: record.terminalAt, inputRetained: record.inputRetained, artifactsRetained: record.artifactsRetained, artifactCount: record.artifacts.length, receiptDigest: record.receiptDigest })) }; }
  async show(id, { includeRaw = false } = {}) { const record = await this.records.require(id); return { ok: true, status: "RUN_SHOW", mutation: false, run: includeRaw ? record : { ...record, input: record.inputRetained ? "[private-raw-retained]" : null } }; }
  async cancel(id) { if (!this.coordinator) return { ok: false, status: "RUN_CANCEL_UNAVAILABLE", code: "PI_SESSION_REQUIRED", mutation: false }; return { ok: true, status: "RUN_CANCEL", mutation: true, result: await this.coordinator.cancel(id) }; }
  async resume(id, options) { if (!this.coordinator) return { ok: false, status: "RUN_RESUME_UNAVAILABLE", code: "PI_SESSION_REQUIRED", mutation: false }; const projection = await this.coordinator.resume(id, options); return { ok: projection.status === "completed", status: `RUN_${projection.status.toUpperCase().replaceAll("-", "_")}`, mutation: true, projection }; }
  gcPlan() { return this.records.gcPlan(); }
  gcApply(plan) { return this.records.gcApply(plan); }
}

export function createRunManagementService(options = {}) { return new RunManagementService(options); }
export { RETENTION_MS as RUN_RAW_RETENTION_MS, TERMINAL as TERMINAL_RUN_RECORD_STATUSES, digest as runRecordDigest };
