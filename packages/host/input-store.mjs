// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicWriteJson, canonicalJson, readJsonObject } from "../config-runtime/atomic-file.mjs";
import { assertSafeContainedPath, ensureConfigDirectory, normalizeConfigRoot } from "../config-runtime/paths.mjs";
import { acquireOwnership } from "./ownership.mjs";
import { INPUT_LIMITS, inputDigest, inputError, validateInputContent, validateInputScope, validateInputShard } from "./input-contracts.mjs";

/** @typedef {import('./contracts.d.ts').InputScopeV1} Scope */
/** @typedef {import('./contracts.d.ts').InputContentV1} Content */
/** @typedef {import('./contracts.d.ts').InputRecordV1} RecordV1 */
/** @typedef {import('./contracts.d.ts').InputShardV1} Shard */
/** @typedef {import('./contracts.d.ts').DraftShardV1} Draft */
/** @typedef {import('./contracts.d.ts').QueueShardV1} Queue */
/** @typedef {import('./contracts.d.ts').InputRevision} Revision */
/** @typedef {import('./contracts.d.ts').InputItemRevision} ItemRevision */
/** @typedef {import('./contracts.d.ts').InputTransition} Transition */
/** @typedef {{ failAtPhase?: string, onPhase?: (phase: string, context: { target: string; temporary: string; configRoot: string }) => void | Promise<void> }} AtomicOptions */

/** @type {Record<string, readonly string[]>} */
const transitions = Object.freeze({ queued: ["dispatching", "paused", "removed"], paused: ["queued", "removed"], dispatching: ["accepted", "consumed", "unknown"], accepted: ["consumed", "unknown"], unknown: ["consumed"], consumed: [], removed: [] });
/** @param {Scope} scope */
const scopeKey = (scope) => createHash("sha256").update(canonicalJson(scope)).digest("hex");
/** @param {number} value */
function nextRevision(value) {
  if (value >= Number.MAX_SAFE_INTEGER) throw inputError("INPUT_REVISION_EXHAUSTED");
  return value + 1;
}

/** Owns only private input files, never workers, execution grants or Pi history.
 * One cooperative storage owner plus a serial admission section makes CAS and
 * state changes indivisible. Every mutation reloads the published shard.
 */
export class HostInputStore {
  /** @type {Promise<void>} */ #saving = Promise.resolve();
  /** @type {Awaited<ReturnType<typeof acquireOwnership>> | undefined} */ #lease;
  /** @type {Map<string, string>} */ #identities = new Map();
  /** @type {Set<string>} */ #files = new Set();
  #loaded = false;
  #loading = false;
  #closing = false;
  #uncertain = false;
  /** @type {Promise<void> | undefined} */ #closed;
  /** @type {Promise<{ paused: number; unknown: number }> | undefined} */ #initializing;
  /** @param {{ configRoot: string; now?: () => string; atomic?: AtomicOptions }} options */
  constructor({ configRoot, now = () => new Date().toISOString(), atomic = {} }) {
    this.configRoot = normalizeConfigRoot(configRoot);
    this.root = path.join(this.configRoot, "only-my-pi/host/inputs");
    this.now = now;
    this.atomic = atomic;
  }
  /** @param {'draft'|'queue'} kind @param {Scope} scope */
  file(kind, scope) {
    validateInputScope(scope);
    if (!["draft", "queue"].includes(kind)) throw inputError("INPUT_KIND_INVALID", 400);
    return path.join(this.root, kind === "draft" ? "drafts" : "queues", `${scopeKey(scope)}.json`);
  }
  /** @param {Shard} shard */
  #register(shard) {
    for (const item of shard.kind === "draft" ? shard.draft ? [shard.draft] : [] : shard.items) {
      this.#checkIdentity(shard.scope, item.inputId);
      this.#identities.set(item.inputId, scopeKey(shard.scope));
    }
  }
  /** @param {Scope} scope @param {string} inputId */
  #checkIdentity(scope, inputId) {
    const prior = this.#identities.get(inputId);
    if (prior !== undefined && prior !== scopeKey(scope)) throw inputError("INPUT_ID_CONFLICT");
    if (prior === undefined && this.#identities.size >= INPUT_LIMITS.identities) throw inputError("INPUT_CATALOG_LIMIT", 429);
  }
  /** @param {string} file @returns {Promise<Shard | null>} */
  async #readFile(file) {
    await assertSafeContainedPath(this.configRoot, file, { leafType: "file" });
    const stat = await fs.lstat(file).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) return null;
    if (!stat.isFile() || (stat.mode & 0o077)) throw inputError("INPUT_FILE_UNSAFE");
    if (stat.size > INPUT_LIMITS.shardBytes) throw inputError("INPUT_SHARD_LIMIT", 413);
    const shard = validateInputShard(await readJsonObject(this.configRoot, file));
    if (this.file(shard.kind, shard.scope) !== file) throw inputError("INPUT_SCOPE_CONFLICT");
    if (!this.#files.has(file) && this.#files.size >= INPUT_LIMITS.shards) throw inputError("INPUT_SHARD_COUNT_LIMIT", 429);
    this.#files.add(file);
    return shard;
  }
  /** @param {'draft'|'queue'} kind @param {Scope} scope @returns {Promise<Shard>} */
  async #read(kind, scope) {
    const value = await this.#readFile(this.file(kind, scope));
    if (value) { this.#register(value); return value; }
    return kind === "draft" ? { schemaVersion: 1, kind, revision: 0, scope, draft: null } : { schemaVersion: 1, kind, revision: 0, scope, items: [] };
  }
  /** @param {Shard} shard */
  async #write(shard) {
    validateInputShard(shard);
    if (Buffer.byteLength(canonicalJson(shard)) > INPUT_LIMITS.shardBytes) throw inputError("INPUT_SHARD_LIMIT", 413);
    const file = this.file(shard.kind, shard.scope);
    if (!this.#files.has(file) && this.#files.size >= INPUT_LIMITS.shards) throw inputError("INPUT_SHARD_COUNT_LIMIT", 429);
    try { await atomicWriteJson(this.configRoot, file, shard, { ...this.atomic, pretty: false }); }
    catch (cause) {
      const publication = cause && typeof cause === "object" && "atomicPublication" in cause ? cause.atomicPublication : "NOT_PUBLISHED";
      if (publication === "PUBLISHED_NOT_CONFIRMED_DURABLE") this.#uncertain = true;
      throw Object.assign(inputError(this.#uncertain ? "INPUT_STORAGE_RECONCILIATION_REQUIRED" : "INPUT_STORAGE_FAILED", 503), { cause, atomicPublication: publication });
    }
    this.#files.add(file); this.#register(shard);
  }
  /** @template T @param {() => Promise<T>} operation @returns {Promise<T>} */
  #serial(operation) {
    const result = this.#saving.then(() => {
      if (!this.#loaded || this.#closing) throw inputError("INPUT_STORE_UNAVAILABLE", 503);
      if (this.#uncertain) throw inputError("INPUT_STORAGE_RECONCILIATION_REQUIRED", 503);
      return operation();
    });
    // A pre-publication failure must not poison later, explicitly retried edits.
    this.#saving = result.then(() => {}, () => {});
    return result;
  }
  /** Validate all authoritative files before recovering any queue. */
  load() {
    if (this.#loading || this.#loaded || this.#closing) throw inputError("INPUT_STORE_UNAVAILABLE", 503);
    this.#loading = true;
    this.#initializing = this.#initialize();
    return this.#initializing;
  }
  async #initialize() {
    try {
      // This owner performs no execution and spawns no children. Once its
      // process is dead there is no input-file writer to reconcile. Host worker
      // reconciliation is separately enforced by the outer Host singleton.
      this.#lease = await acquireOwnership(this.configRoot, "host", "input-store", { recover: async () => {} });
      /** @type {string[]} */ const queues = [];
      let files = 0;
      for (const directory of ["drafts", "queues"]) {
        const root = await ensureConfigDirectory(this.configRoot, `only-my-pi/host/inputs/${directory}`);
        for (const own of [this.root, root]) if ((await fs.stat(own)).mode & 0o077) throw inputError("INPUT_DIRECTORY_UNSAFE");
        for (const entry of await fs.readdir(root, { withFileTypes: true })) {
          // A crash before rename can leave an unpublished atomic temporary.
          // Ignore only the helper's exact name family; preserve it on disk.
          if (/^\.[a-f0-9]{64}\.json\.[1-9][0-9]*\.[a-f0-9]{16}\.tmp$/u.test(entry.name) && entry.isFile()) continue;
          if (!/^[a-f0-9]{64}\.json$/u.test(entry.name) || !entry.isFile() || ++files > INPUT_LIMITS.shards) throw inputError("INPUT_LAYOUT_INVALID");
          const value = await this.#readFile(path.join(root, entry.name));
          if (!value) throw inputError("INPUT_STATE_CHANGED");
          this.#register(value);
          if (value.kind === "queue") queues.push(path.join(root, entry.name));
        }
      }
      let paused = 0, unknown = 0;
      for (const file of queues) {
        const shard = await this.#readFile(file);
        if (!shard || shard.kind !== "queue") throw inputError("INPUT_STATE_CHANGED");
        let changed = false;
        for (const item of shard.items) {
          if (!["queued", "dispatching", "accepted"].includes(item.state)) continue;
          if (item.state === "queued") { item.state = "paused"; paused++; }
          else { item.state = "unknown"; unknown++; }
          item.pauseReason = "HOST_RESTARTED"; item.revision = nextRevision(item.revision); item.updatedAt = this.now(); changed = true;
        }
        if (changed) { shard.revision = nextRevision(shard.revision); await this.#write(shard); }
      }
      this.#loaded = true;
      return { paused, unknown };
    } catch (error) {
      this.#closing = true;
      await this.#lease?.release(); this.#lease = undefined;
      throw error;
    } finally { this.#loading = false; }
  }
  /** @param {Scope} scope @returns {Promise<Draft>} */
  readDraft(scope) {
    const target = structuredClone(validateInputScope(scope));
    return this.#serial(async () => /** @type {Draft} */ (await this.#read("draft", target)));
  }
  /** @param {Scope} scope @returns {Promise<Queue>} */
  readQueue(scope) {
    const target = structuredClone(validateInputScope(scope));
    return this.#serial(async () => /** @type {Queue} */ (await this.#read("queue", target)));
  }
  /** @param {Shard} shard @param {Revision} options @param {RecordV1} [item] */
  #compare(shard, options, item) {
    if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw inputError("INPUT_REVISION_INVALID", 400);
    if (shard.revision !== options.expectedRevision) throw inputError("INPUT_REVISION_CONFLICT");
    if (item) {
      const value = /** @type {ItemRevision} */ (options).expectedInputRevision;
      if (!Number.isSafeInteger(value) || value < 1) throw inputError("INPUT_REVISION_INVALID", 400);
      if (item.revision !== value) throw inputError("INPUT_REVISION_CONFLICT");
    }
  }
  /** @param {Scope} scope @param {Content} input @param {'draft'|'queued'} state @returns {RecordV1} */
  #record(scope, input, state) {
    if (scope.sessionId === null && (state !== "draft" || input.delivery !== "prompt")) throw inputError("INPUT_SESSION_REQUIRED");
    const time = this.now();
    return { ...input, ...scope, schemaVersion: 1, revision: 1, taskId: null, contentDigest: inputDigest(scope, input), state, consumedEntryId: null, pauseReason: null, createdAt: time, updatedAt: time };
  }
  /** @param {Scope} scope @param {Content} input @param {Revision} options @returns {Promise<Draft>} */
  saveDraft(scope, input, options) {
    const target = structuredClone(validateInputScope(scope)), content = structuredClone(validateInputContent(input)), cas = { ...options };
    return this.#serial(async () => {
      const shard = /** @type {Draft} */ (await this.#read("draft", target));
      this.#compare(shard, cas); this.#checkIdentity(target, content.inputId);
      const queue = /** @type {Queue} */ (await this.#read("queue", target));
      if (queue.items.some((item) => item.inputId === content.inputId)) throw inputError("INPUT_ALREADY_QUEUED");
      const record = this.#record(target, content, "draft");
      if (shard.draft?.inputId === content.inputId) { record.revision = nextRevision(shard.draft.revision); record.createdAt = shard.draft.createdAt; }
      shard.draft = record; shard.revision = nextRevision(shard.revision);
      await this.#write(shard); return shard;
    });
  }
  /** Clearing a draft never deletes submitted input or project files.
   * @param {Scope} scope @param {Revision} options @returns {Promise<Draft>} */
  clearDraft(scope, options) {
    const target = structuredClone(validateInputScope(scope)), cas = { ...options };
    return this.#serial(async () => {
      const shard = /** @type {Draft} */ (await this.#read("draft", target)); this.#compare(shard, cas);
      if (shard.draft) { shard.draft = null; shard.revision = nextRevision(shard.revision); await this.#write(shard); }
      return shard;
    });
  }
  /** @param {Scope} scope @param {Content} input @param {Revision} options @returns {Promise<Queue>} */
  enqueue(scope, input, options) {
    const target = structuredClone(validateInputScope(scope)), content = structuredClone(validateInputContent(input)), cas = { ...options };
    return this.#serial(async () => {
      const shard = /** @type {Queue} */ (await this.#read("queue", target)); this.#checkIdentity(target, content.inputId);
      const prior = shard.items.find((item) => item.inputId === content.inputId);
      // A lost response can be queried/repeated with the same effective content,
      // even if its CAS version is now stale. It never constitutes another write.
      if (prior) { if (prior.contentDigest !== inputDigest(target, content)) throw inputError("INPUT_ID_CONFLICT"); return shard; }
      this.#compare(shard, cas);
      if (!content.text.trim() && !content.materialSnapshotIds.length) throw inputError("INPUT_EMPTY", 400);
      if (shard.items.length >= INPUT_LIMITS.records) throw inputError("INPUT_QUEUE_LIMIT", 429);
      shard.items.push(this.#record(target, content, "queued")); shard.revision = nextRevision(shard.revision);
      await this.#write(shard); return shard;
    });
  }
  /** @param {Scope} scope @param {Content} input @param {ItemRevision} options @returns {Promise<Queue>} */
  editQueued(scope, input, options) {
    const target = structuredClone(validateInputScope(scope)), content = structuredClone(validateInputContent(input)), cas = { ...options };
    return this.#serial(async () => {
      const shard = /** @type {Queue} */ (await this.#read("queue", target)), item = shard.items.find((value) => value.inputId === content.inputId);
      if (!item) throw inputError("INPUT_NOT_FOUND", 404);
      this.#compare(shard, cas, item);
      if (!["queued", "paused"].includes(item.state)) throw inputError("INPUT_NOT_EDITABLE");
      if (content.delivery !== item.delivery) throw inputError("INPUT_DELIVERY_CONFLICT");
      if (!content.text.trim() && !content.materialSnapshotIds.length) throw inputError("INPUT_EMPTY", 400);
      Object.assign(item, content, { revision: nextRevision(item.revision), updatedAt: this.now(), contentDigest: inputDigest(target, content) });
      shard.revision = nextRevision(shard.revision); await this.#write(shard); return shard;
    });
  }
  /** Only the trusted controller may advance delivery using runtime evidence.
   * This is not a browser command, scheduler or execution authorization.
   * @param {Scope} scope @param {string} inputId @param {Transition} options @returns {Promise<Queue>} */
  transition(scope, inputId, options) {
    const target = structuredClone(validateInputScope(scope)), change = { ...options };
    return this.#serial(async () => {
      const shard = /** @type {Queue} */ (await this.#read("queue", target)), item = shard.items.find((value) => value.inputId === inputId);
      if (!item) throw inputError("INPUT_NOT_FOUND", 404);
      this.#compare(shard, change, item);
      if (!transitions[item.state]?.includes(change.state)) throw inputError("INPUT_TRANSITION_INVALID");
      if (change.taskId && item.taskId && item.taskId !== change.taskId) throw inputError("INPUT_TASK_CONFLICT");
      item.state = change.state; item.taskId = change.taskId ?? item.taskId;
      item.consumedEntryId = change.consumedEntryId ?? null;
      item.pauseReason = ["paused", "unknown"].includes(item.state) ? change.pauseReason ?? null : null;
      item.revision = nextRevision(item.revision); item.updatedAt = this.now(); shard.revision = nextRevision(shard.revision);
      await this.#write(shard); return shard;
    });
  }
  close() {
    this.#closing = true;
    this.#closed ??= (async () => {
      await this.#initializing?.catch(() => {});
      await this.#saving;
      await this.#lease?.release(); this.#lease = undefined;
    })();
    return this.#closed;
  }
}
