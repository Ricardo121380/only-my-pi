import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import Ajv from "ajv";
import { parse as parseYaml } from "yaml";
import { acquireConfigLock, assertSafeContainedPath, atomicWriteJson, atomicWriteText, canonicalJson, readJsonObject } from "../config-runtime/index.mjs";
import { digest, McpCatalog } from "../mcp/catalog.mjs";
import { ModelCallStore } from "../model-calls/store.mjs";

export const settingsError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const PRODUCT_PI_VERSION = "1.3.0";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const labelSchema = { type: "object", additionalProperties: false, required: ["label"], properties: { label: { type: "string", minLength: 1, maxLength: 32, pattern: "^[A-Za-z0-9 _-]+$" } } };
const builtins = [
  { id: "context-doctor", kind: "tool", version: "0.1.0", origin: "only-my-pi:extensions/context-doctor", enabled: true, parameters: { label: "ctx" }, schema: labelSchema, toolNames: ["context_snapshot"] },
  ...["grep", "find", "ls"].map(id => ({ id, kind: "tool", version: PRODUCT_PI_VERSION, origin: `pi:${id}`, enabled: true, parameters: {}, schema: null, toolNames: [id] })),
  ...["omp-direct", "omp-control", "permission-modes", "session-ownership", "model-budget"].map(id => ({ id, kind: "required", version: "1", origin: "only-my-pi:required", enabled: true, parameters: {}, schema: null, toolNames: [], required: true })),
];
const ajv = new Ajv({ strict: true });
const validLabel = ajv.compile(labelSchema);
const empty = () => ({ version: 1, revision: 0, defaults: {}, projects: {}, skills: {}, revoked: {} });
const moduleRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

// Only OMP-owned resource settings live here. MCP and model bindings retain
// their existing stores; taskSnapshot composes their revisions without copies.
export class ProductSettings {
  constructor(configRoot) { this.root = configRoot; this.file = path.join(configRoot, "only-my-pi/product-settings/config.json"); }
  async read() {
    const stat = await fs.lstat(this.file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576)) throw settingsError("SETTINGS_STATE_INVALID", 409);
    const state = await readJsonObject(this.root, this.file).catch(error => { if (error.code === "ENOENT") return empty(); throw error; });
    if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || ![state.defaults, state.projects, state.skills, state.revoked].every(object)
      || Object.keys(state.skills).length > 64 || Object.keys(state.projects).length > 1000) throw settingsError("SETTINGS_STATE_INVALID", 409);
    for (const [id, skill] of Object.entries(state.skills)) {
      if (!object(skill) || typeof skill.name !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(skill.name) || id !== `skill:${skill.name}` || skill.id !== id || skill.kind !== "skill"
        || skill.piVersion !== PRODUCT_PI_VERSION || !/^[a-f0-9]{64}$/u.test(skill.contentDigest ?? "") || skill.version !== skill.contentDigest
        || typeof skill.description !== "string" || !skill.description || skill.description.length > 1024 || typeof skill.origin !== "string" || !skill.origin || skill.origin.length > 1024
        || skill.enabled !== false || skill.schema !== null || !object(skill.parameters) || Object.keys(skill.parameters).length || !Array.isArray(skill.toolNames) || skill.toolNames.length
        || Object.keys(skill).some(key => !["id", "name", "description", "kind", "version", "origin", "piVersion", "contentDigest", "enabled", "parameters", "schema", "toolNames"].includes(key))) throw settingsError("SETTINGS_STATE_INVALID", 409);
    }
    if (Object.values(state.revoked).some(value => !Number.isSafeInteger(value) || value < 0)) throw settingsError("SETTINGS_STATE_INVALID", 409);
    for (const values of [state.defaults, ...Object.values(state.projects)]) {
      if (!object(values)) throw settingsError("SETTINGS_STATE_INVALID", 409);
      for (const [id, value] of Object.entries(values)) this.validate(id, value, state);
    }
    return state;
  }
  definitions(state) { return [...builtins, ...Object.values(state.skills)]; }
  validate(id, value, state) {
    const definition = this.definitions(state).find(item => item.id === id);
    if (!definition) throw settingsError("RESOURCE_SOURCE_UNKNOWN");
    if (!object(value) || Object.keys(value).some(key => !["enabled", "parameters"].includes(key)) || typeof value.enabled !== "boolean" || !object(value.parameters)) throw settingsError("SETTINGS_VALUE_INVALID");
    if (definition.required && !value.enabled) throw settingsError("RESOURCE_REQUIRED");
    if (definition.schema === null && Object.keys(value.parameters).length) throw settingsError("RESOURCE_SCHEMA_UNAVAILABLE");
    if (definition.id === "context-doctor" && !validLabel(value.parameters)) throw settingsError("RESOURCE_PARAMETERS_INVALID");
    return value;
  }
  key(projectPath) { return projectPath ? digest(projectPath) : "default"; }
  effective(state, projectPath) {
    const project = state.projects[this.key(projectPath)] ?? {};
    return this.definitions(state).map(definition => ({ ...definition, ...(state.defaults[definition.id] ?? {}), ...(projectPath ? project[definition.id] ?? {} : {}), source: projectPath && Object.hasOwn(project, definition.id) ? "project" : "default",
      revocations: Object.fromEntries((projectPath && Object.hasOwn(project, definition.id) ? [`${this.key(projectPath)}:${definition.id}`] : [`default:${definition.id}`, ...(projectPath ? [`${this.key(projectPath)}:${definition.id}`] : [])]).map(key => [key, state.revoked[key] ?? 0])) }));
  }
  async snapshot(projectPath) { const state = await this.read(); return { protocol: 1, revision: state.revision, projectPath: projectPath ?? null, resources: this.effective(state, projectPath) }; }
  async status(projectPath) {
    const snapshot = await this.snapshot(projectPath);
    const receipt = await readJsonObject(this.root, path.join(this.root, "only-my-pi/product-settings/loads", `${this.key(projectPath)}.json`)).catch(error => { if (error.code === "ENOENT") return { lastLoaded: null, lastFailure: null }; throw error; });
    return { ...snapshot, ...receipt, pending: Boolean(receipt.lastFailure) || !receipt.lastLoaded || receipt.lastLoaded.revision !== snapshot.revision };
  }
  async lock(update) {
    let lock;
    for (let i = 0; !lock; i++) {
      try { lock = await acquireConfigLock(this.root, { lockDirectory: path.join(this.root, "only-my-pi/locks/product-settings.lock") }); }
      catch (error) { if (!["LOCK_HELD", "LOCK_RECLAIMING"].includes(error.code) || i >= 99) throw error; await delay(20); }
    }
    try { return await update(); } finally { await lock.release(); }
  }
  async recordLoad(snapshot, error = null, taskId = null) {
    return this.lock(async () => {
      const file = path.join(this.root, "only-my-pi/product-settings/loads", `${this.key(snapshot.projectPath)}.json`);
      const prior = await readJsonObject(this.root, file).catch(cause => { if (cause.code === "ENOENT") return { lastLoaded: null, lastFailure: null }; throw cause; });
      const receipt = { revision: snapshot.revision, resourceRevision: snapshot.resourceRevision, taskId, at: new Date().toISOString() };
      if (error) prior.lastFailure = { ...receipt, code: /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "RESOURCE_LOAD_FAILED" };
      else { prior.lastLoaded = { ...receipt, resources: snapshot.resources }; prior.lastFailure = null; }
      await atomicWriteJson(this.root, file, prior);
      return prior;
    });
  }
  async preview(source, projectPath) {
    if (!object(source) || Object.keys(source).some(key => !["kind", "origin", "content"].includes(key)) || source.kind !== "local-skill" || typeof source.origin !== "string" || !source.origin || source.origin.length > 1024 || /[\0\r\n]/u.test(source.origin)
      || typeof source.content !== "string" || Buffer.byteLength(source.content) > 131072 || source.content.includes("\0")) throw settingsError("RESOURCE_SOURCE_UNKNOWN");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source.content);
    let metadata; try { metadata = match ? parseYaml(match[1]) : null; } catch { throw settingsError("SKILL_DECLARATION_INVALID"); }
    if (!object(metadata) || typeof metadata.name !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(metadata.name) || typeof metadata.description !== "string" || !metadata.description || metadata.description.length > 1024) throw settingsError("SKILL_DECLARATION_INVALID");
    if (metadata.compatibility !== `pi-${PRODUCT_PI_VERSION}`) throw settingsError("RESOURCE_INCOMPATIBLE");
    if (metadata.schema !== undefined || metadata.parameters !== undefined) throw settingsError("RESOURCE_SCHEMA_UNAVAILABLE");
    const state = await this.read(), id = `skill:${metadata.name}`, contentDigest = digest(source.content);
    const resource = { id, name: metadata.name, description: metadata.description, kind: "skill", version: contentDigest, origin: source.origin, piVersion: PRODUCT_PI_VERSION, contentDigest, enabled: false, parameters: {}, schema: null, toolNames: [] };
    return { protocol: 1, revision: state.revision, digest: digest(canonicalJson(source)), source: { kind: source.kind, origin: source.origin, contentDigest }, differences: [{ id, before: this.effective(state, projectPath).find(r => r.id === id) ?? null, after: resource }], resource };
  }
  async action(input, projectPath) {
    if (!object(input) || Object.keys(input).some(key => !["type", "projectId", "revision", "id", "enabled", "parameters", "source", "digest"].includes(key))) throw settingsError("SETTINGS_COMMAND_INVALID");
    if (input.type === "list") return this.status(projectPath);
    if (input.type === "previewImport") return this.preview(input.source, projectPath);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw settingsError("SETTINGS_REVISION_INVALID");
    await this.lock(async () => {
      const state = await this.read(); if (state.revision !== input.revision) throw settingsError("SETTINGS_REVISION_CONFLICT", 409);
      const key = this.key(projectPath), scoped = projectPath ? state.projects[key] ??= {} : state.defaults;
      if (input.type === "import") {
        if (Object.keys(state.skills).length >= 64) throw settingsError("SETTINGS_CAPACITY", 409);
        const preview = await this.preview(input.source, projectPath);
        if (preview.digest !== input.digest) throw settingsError("SETTINGS_IMPORT_CHANGED", 409);
        if (state.skills[preview.resource.id]) throw settingsError("RESOURCE_NAME_CONFLICT", 409);
        state.skills[preview.resource.id] = preview.resource;
        const file = this.skillPath(preview.resource);
        await atomicWriteText(this.root, file, input.source.content, { exclusive: true });
        scoped[preview.resource.id] = { enabled: false, parameters: {} };
      } else {
        const resource = this.effective(state, projectPath).find(item => item.id === input.id);
        if (!resource) throw settingsError("RESOURCE_SOURCE_UNKNOWN");
        if (input.type === "reset") {
          if (!projectPath) throw settingsError("SETTINGS_PROJECT_REQUIRED");
          delete scoped[input.id];
        } else if (input.type === "set") {
          if (Object.hasOwn(input, "enabled") && typeof input.enabled !== "boolean" || Object.hasOwn(input, "parameters") && !object(input.parameters)) throw settingsError("SETTINGS_VALUE_INVALID");
          const value = { enabled: input.enabled ?? resource.enabled, parameters: input.parameters ?? resource.parameters };
          this.validate(input.id, value, state); scoped[input.id] = value;
        } else throw settingsError("SETTINGS_COMMAND_INVALID");
        const next = this.effective(state, projectPath).find(item => item.id === input.id);
        if (resource.enabled && !next.enabled) { const revokeKey = `${key}:${input.id}`; state.revoked[revokeKey] = (state.revoked[revokeKey] ?? 0) + 1; }
      }
      state.revision++; await atomicWriteJson(this.root, this.file, state);
    });
    return this.status(projectPath);
  }
  skillPath(resource) { if (!/^[a-f0-9]{64}$/u.test(resource.contentDigest ?? "")) throw settingsError("RESOURCE_IDENTITY_CHANGED", 409); return path.join(this.root, "only-my-pi/product-settings/skills", resource.contentDigest, "SKILL.md"); }
  async verify(snapshot, packageRoot = moduleRoot) {
    for (const resource of snapshot.resources.filter(r => r.enabled)) {
      if (resource.kind === "skill") {
        const file = this.skillPath(resource); await assertSafeContainedPath(this.root, file, { leafType: "file" });
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072 || digest(await fs.readFile(file)) !== resource.contentDigest) throw settingsError("RESOURCE_IDENTITY_CHANGED", 409);
      } else if (resource.id === "context-doctor") {
        const files = ["index.ts", "metrics.mjs"], identity = [];
        for (const file of files) { const p = path.join(packageRoot, "extensions/context-doctor", file), stat = await fs.lstat(p); if (!stat.isFile() || stat.isSymbolicLink()) throw settingsError("RESOURCE_IDENTITY_CHANGED", 409); identity.push(digest(await fs.readFile(p))); }
        const fingerprint = digest(identity);
        if (resource.identity && resource.identity !== fingerprint) throw settingsError("RESOURCE_IDENTITY_CHANGED", 409);
        resource.identity = fingerprint;
      }
    }
    return snapshot;
  }
  async current(resource) {
    const state = await this.read();
    return Object.entries(resource.revocations).every(([key, epoch]) => (state.revoked[key] ?? 0) === epoch);
  }
}

// A coherent, immutable task loadout. Re-read monotonic versions across the
// three authorities, so interleaved writers never produce a mixed snapshot.
export async function taskSettingsSnapshot(configRoot, projectPath, packageRoot = moduleRoot) {
  const resources = new ProductSettings(configRoot), mcp = new McpCatalog(configRoot), models = new ModelCallStore(configRoot);
  for (let attempt = 0; attempt < 4; attempt++) {
    const settings = await resources.snapshot(projectPath), mcpSnapshot = await mcp.snapshot(projectPath), classifierSnapshot = await models.config(projectPath);
    const revisions = [settings.revision, mcpSnapshot.revision, classifierSnapshot.revision];
    const latest = [(await resources.read()).revision, (await mcp.read()).revision, (await models.config(projectPath)).revision];
    if (revisions.some((revision, index) => revision !== latest[index])) continue;
    const resourceRevision = revisions.every(value => value === 0) ? 0 : parseInt(digest(revisions).slice(0, 12), 16);
    const snapshot = { ...settings, resourceRevision, versions: { resources: revisions[0], mcp: revisions[1], models: revisions[2] } };
    try { await resources.verify(snapshot, packageRoot); }
    catch (error) { await resources.recordLoad(snapshot, error); throw error; }
    return { settingsSnapshot: snapshot, mcpSnapshot, classifierSnapshot, resourceRevision };
  }
  throw settingsError("SETTINGS_CHANGED_DURING_ADMISSION", 409);
}
