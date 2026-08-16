import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write", "bash", "web"]);
const MUTATING = new Set(["edit", "write", "bash"]);
const WORKSPACE_RANK = Object.freeze({ none: 0, "read-only": 1, "guarded-write": 2, "worktree-write": 3 });
const EGRESS_RANK = Object.freeze({ deny: 0, "allow-listed": 1, inherit: 2 });
const TOP_KEYS = new Set([
  "$schema", "formatVersion", "contractStatus", "id", "upstreamAgentId", "version", "description", "prompt",
  "tools", "allowedExecutionStates", "requiredCapabilities", "policyCeiling", "modelRole", "inputSchema",
  "outputSchema", "writer", "timeoutSeconds", "continuable", "resumable", "redaction", "gateIds",
]);

export class AgentRegistryError extends Error {
  constructor(message, code = "AGENT_REGISTRY_ERROR", details = {}) {
    super(`agent-registry: ${message}`);
    this.name = "AgentRegistryError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) { throw new AgentRegistryError(message, code, details); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) { return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stable(value))).digest("hex")}`; }
function sorted(values) { return [...new Set(values)].sort(); }
function statIs(stat, name) { return Boolean(stat && (typeof stat[name] === "function" ? stat[name]() : stat[name])); }

function normalizeFs(input) {
  const source = input ?? fsPromises;
  for (const name of ["readdir", "readFile", "lstat"]) if (typeof source[name] !== "function") fail(`filesystem driver lacks ${name}`, "FILESYSTEM_UNAVAILABLE");
  return {
    readdir: (...args) => source.readdir(...args),
    readFile: (...args) => source.readFile(...args),
    lstat: (...args) => source.lstat(...args),
    realpath: typeof source.realpath === "function" ? (...args) => source.realpath(...args) : null,
  };
}

function normalizeRoot(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) fail(`${label} must be an absolute path`, "INVALID_ROOT");
  return path.resolve(value);
}

function contained(root, candidate, code = "PATH_ESCAPE") {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(`path escapes root: ${candidate}`, code);
  return path.resolve(candidate);
}

async function lstatOrNull(fs, target) {
  try { return await fs.lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function assertContained(fs, root, target, { file = false } = {}) {
  const absoluteRoot = normalizeRoot(root, "agent root");
  const absoluteTarget = contained(absoluteRoot, target);
  const rootStat = await lstatOrNull(fs, absoluteRoot);
  if (!rootStat || !statIs(rootStat, "isDirectory") || statIs(rootStat, "isSymbolicLink")) fail(`unsafe agent root: ${absoluteRoot}`, "PATH_ESCAPE");
  const relative = path.relative(absoluteRoot, absoluteTarget);
  let current = absoluteRoot;
  for (const [index, segment] of relative.split(path.sep).entries()) {
    if (!segment) continue;
    current = path.join(current, segment);
    const stat = await lstatOrNull(fs, current);
    if (!stat) fail(`agent resource missing: ${path.relative(absoluteRoot, current)}`, "RESOURCE_MISSING");
    if (statIs(stat, "isSymbolicLink")) fail(`agent resource symlink is not allowed: ${path.relative(absoluteRoot, current)}`, "SYMLINK_ESCAPE");
    if (index < relative.split(path.sep).length - 1 && !statIs(stat, "isDirectory")) fail(`agent resource parent is not a directory`, "RESOURCE_TYPE");
    if (file && index === relative.split(path.sep).length - 1 && !statIs(stat, "isFile")) fail(`agent prompt is not a regular file`, "RESOURCE_TYPE");
  }
  if (fs.realpath) contained(await fs.realpath(absoluteRoot), await fs.realpath(absoluteTarget), "SYMLINK_ESCAPE");
  return absoluteTarget;
}

function schemaError(pathName, message) { return { path: pathName, message }; }

export function validateAgentManifest(manifest, { label = "agent" } = {}) {
  const errors = [];
  if (!isObject(manifest)) return [schemaError("", `${label} must be an object`)];
  for (const key of Object.keys(manifest)) if (!TOP_KEYS.has(key)) errors.push(schemaError(`/${key}`, "unknown field"));
  for (const key of ["$schema", "formatVersion", "contractStatus", "id", "upstreamAgentId", "version", "description", "prompt", "tools", "allowedExecutionStates", "requiredCapabilities", "policyCeiling", "modelRole", "inputSchema", "outputSchema", "writer", "timeoutSeconds", "continuable", "resumable", "redaction", "gateIds"]) if (!Object.hasOwn(manifest, key)) errors.push(schemaError(`/${key}`, "required field is missing"));
  if (manifest.formatVersion !== 1) errors.push(schemaError("/formatVersion", "must be 1"));
  if (!ID.test(manifest.id ?? "")) errors.push(schemaError("/id", "invalid agent id"));
  if (!/^omp-[a-z0-9][a-z0-9-]{0,59}$/.test(manifest.upstreamAgentId ?? "")) errors.push(schemaError("/upstreamAgentId", "must be an omp-* id"));
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) errors.push(schemaError("/version", "invalid version"));
  if (!isObject(manifest.tools) || !Array.isArray(manifest.tools.allow) || !Array.isArray(manifest.tools.deny)) errors.push(schemaError("/tools", "allow and deny arrays are required"));
  else {
    for (const tool of [...manifest.tools.allow, ...manifest.tools.deny]) if (!TOOLS.has(tool)) errors.push(schemaError("/tools", `unknown tool ${tool}`));
    for (const tool of manifest.tools.allow) if (manifest.tools.deny.includes(tool)) errors.push(schemaError("/tools", `tool appears in allow and deny: ${tool}`));
  }
  if (!Array.isArray(manifest.allowedExecutionStates) || manifest.allowedExecutionStates.length === 0) errors.push(schemaError("/allowedExecutionStates", "must be a non-empty array"));
  if (!Array.isArray(manifest.requiredCapabilities)) errors.push(schemaError("/requiredCapabilities", "must be an array"));
  const policy = manifest.policyCeiling;
  if (!isObject(policy)) errors.push(schemaError("/policyCeiling", "must be an object"));
  else {
    if (!Object.hasOwn(WORKSPACE_RANK, policy.workspace)) errors.push(schemaError("/policyCeiling/workspace", "invalid workspace"));
    if (!Object.hasOwn(policy, "mutation") || !["none", "workspace", "isolated-worktree"].includes(policy.mutation)) errors.push(schemaError("/policyCeiling/mutation", "invalid mutation"));
    if (!Object.hasOwn(policy, "approval") || !["deny", "ask", "inherit"].includes(policy.approval)) errors.push(schemaError("/policyCeiling/approval", "invalid approval"));
    if (!isObject(policy.egress)) errors.push(schemaError("/policyCeiling/egress", "must be an object"));
    else for (const key of ["web", "mcp", "provider", "extension"]) if (!Object.hasOwn(EGRESS_RANK, policy.egress[key])) errors.push(schemaError(`/policyCeiling/egress/${key}`, "invalid egress"));
  }
  if (manifest.writer === false && (manifest.tools?.allow ?? []).some((tool) => MUTATING.has(tool))) errors.push(schemaError("/writer", "read-only agent cannot allow mutating tools"));
  if (policy?.mutation === "none" && (manifest.tools?.allow ?? []).some((tool) => MUTATING.has(tool))) errors.push(schemaError("/policyCeiling/mutation", "mutation:none cannot allow mutating tools"));
  if (policy?.workspace === "read-only" && manifest.writer === true) errors.push(schemaError("/writer", "read-only workspace cannot have a writer"));
  if (manifest.policyCeiling?.egress?.web === "deny" && manifest.tools?.allow?.includes("web")) errors.push(schemaError("/tools", "web tool conflicts with denied web egress"));
  if (!isObject(manifest.prompt) || typeof manifest.prompt.file !== "string" || path.isAbsolute(manifest.prompt.file) || manifest.prompt.file.includes("..")) errors.push(schemaError("/prompt/file", "prompt must be a contained relative path"));
  if (!Number.isInteger(manifest.timeoutSeconds) || manifest.timeoutSeconds < 1 || manifest.timeoutSeconds > 3600) errors.push(schemaError("/timeoutSeconds", "invalid timeout"));
  if (!isObject(manifest.redaction) || manifest.redaction.rawPrompts !== "omit" || manifest.redaction.reasoning !== "omit" || manifest.redaction.credentials !== "deny") errors.push(schemaError("/redaction", "redaction must omit prompts/reasoning and deny credentials"));
  if (!Array.isArray(manifest.gateIds) || new Set(manifest.gateIds).size !== manifest.gateIds.length) errors.push(schemaError("/gateIds", "gateIds must be a unique array"));
  return errors;
}

function normalizeSources(options) {
  const rootDir = options.rootDir ? normalizeRoot(options.rootDir, "rootDir") : null;
  if (options.sources) return options.sources.map((source) => ({ ...source, root: normalizeRoot(source.root, "agent source root") }));
  if (options.searchRoots) {
    const roots = Array.isArray(options.searchRoots) ? options.searchRoots : Object.values(options.searchRoots);
    return roots.map((root) => ({ kind: "builtin", root: normalizeRoot(root, "agent search root") }));
  }
  return [{ kind: "builtin", root: path.join(rootDir ?? process.cwd(), "agents") }];
}

function namespace(kind, packageId) {
  if (kind === "user") return "user:";
  if (kind === "trusted-project") return "project:";
  if (kind === "reviewed-package") return `${packageId}/`;
  return "";
}

async function collectJson(fs, root) {
  const result = [];
  const walk = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".")) result.push(target);
    }
  };
  if (await lstatOrNull(fs, root)) await walk(root);
  return result;
}

function profileProjection(profile) {
  if (!profile) return null;
  return {
    capabilities: new Set(profile.capabilityIds ?? profile.capabilities ?? []),
    policy: profile.policy ?? {},
  };
}

function assertProfileCeiling(manifest, profile) {
  const projection = profileProjection(profile);
  if (!projection) return;
  for (const capability of manifest.requiredCapabilities ?? []) if (!projection.capabilities.has(capability)) fail(`agent ${manifest.id} requires unavailable capability ${capability}`, "PROFILE_CAPABILITY_MISSING", { capability });
  const profileWorkspace = profile.policy?.workspace ?? "worktree-write";
  if (WORKSPACE_RANK[manifest.policyCeiling.workspace] > WORKSPACE_RANK[profileWorkspace] && profileWorkspace !== "inherit") fail(`agent ${manifest.id} exceeds profile workspace ceiling`, "PROFILE_POLICY_EXCEEDED");
  if (profile.policy?.network?.startsWith("deny") && manifest.policyCeiling.egress.web !== "deny") fail(`agent ${manifest.id} exceeds profile web egress ceiling`, "PROFILE_POLICY_EXCEEDED");
}

export function createAgentReceipt(agent) {
  if (!agent?.manifest || !agent?.sourceHash || !SHA256.test(agent.sourceHash)) fail("cannot receipt an unresolved agent", "INVALID_AGENT_RECEIPT");
  return Object.freeze({
    formatVersion: 1,
    agentId: agent.id,
    manifestHash: digest(agent.manifest),
    sourceHash: agent.sourceHash,
    writer: agent.manifest.writer,
    tools: clone(agent.manifest.tools),
    policyCeiling: clone(agent.manifest.policyCeiling),
    gateIds: sorted(agent.manifest.gateIds),
  });
}

export class AgentRegistry {
  constructor(options = {}) {
    this.rootDir = options.rootDir ? normalizeRoot(options.rootDir, "rootDir") : null;
    this.fs = normalizeFs(options.fs);
    this.sources = normalizeSources(options);
    this.profile = options.profile ?? null;
    this.catalogs = options.catalogs ?? {};
    this.state = null;
  }

  async discover() {
    const entries = [];
    for (const source of this.sources) {
      const sourceRoot = normalizeRoot(source.root, "agent source root");
      const files = await collectJson(this.fs, sourceRoot);
      for (const file of files) {
        await assertContained(this.fs, sourceRoot, file, { file: true });
        let manifest;
        try { manifest = JSON.parse(await this.fs.readFile(file, "utf8")); } catch (error) { fail(`cannot parse ${file}: ${error.message}`, "INVALID_AGENT_MANIFEST"); }
        const errors = validateAgentManifest(manifest, { label: file });
        if (errors.length) fail(`invalid agent ${file}: ${errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`, "INVALID_AGENT_MANIFEST", { errors });
        const promptPath = await assertContained(this.fs, this.rootDir ?? sourceRoot, path.resolve(this.rootDir ?? sourceRoot, manifest.prompt.file), { file: true });
        const prompt = await this.fs.readFile(promptPath, "utf8");
        if (Buffer.byteLength(prompt, "utf8") > 256 * 1024) fail(`prompt too large: ${manifest.id}`, "RESOURCE_TOO_LARGE");
        const id = `${namespace(source.kind ?? "builtin", source.packageId)}${manifest.id}`;
        if (entries.some((entry) => entry.id === id)) fail(`duplicate agent id: ${id}`, "DUPLICATE_AGENT_ID");
        entries.push(Object.freeze({
          id,
          rawId: manifest.id,
          source: { kind: source.kind ?? "builtin", packageId: source.packageId ?? null, file: path.relative(this.rootDir ?? sourceRoot, file).split(path.sep).join("/") },
          manifest: clone(manifest),
          prompt: { path: path.relative(this.rootDir ?? sourceRoot, promptPath).split(path.sep).join("/"), content: prompt, hash: digest(prompt) },
          sourceHash: digest({ manifest: digest(manifest), prompt: digest(prompt) }),
        }));
      }
    }
    entries.sort((left, right) => left.id.localeCompare(right.id));
    this.state = { entries: new Map(entries.map((entry) => [entry.id, entry])), raw: new Map(entries.map((entry) => [entry.rawId, entries.filter((candidate) => candidate.rawId === entry.rawId)])) };
    return Object.freeze({ formatVersion: 1, agents: Object.freeze(entries.map((entry) => ({ id: entry.id, rawId: entry.rawId, source: clone(entry.source), sourceHash: entry.sourceHash, manifest: clone(entry.manifest) }))) });
  }

  async list() { if (!this.state) await this.discover(); return [...this.state.entries.values()]; }

  async resolve(id, { profile = this.profile } = {}) {
    if (!this.state) await this.discover();
    const direct = this.state.entries.get(id);
    const candidates = this.state.raw.get(id) ?? [];
    const entry = direct ?? (candidates.length === 1 ? candidates[0] : null);
    if (!entry) fail(candidates.length > 1 ? `agent id is ambiguous: ${id}` : `unknown agent: ${id}`, candidates.length > 1 ? "AMBIGUOUS_AGENT_ID" : "UNKNOWN_AGENT");
    assertProfileCeiling(entry.manifest, profile);
    return Object.freeze({ ...entry, receipt: createAgentReceipt(entry) });
  }

  async doctor() {
    try { const result = await this.discover(); return Object.freeze({ ok: true, status: "AGENT_DOCTOR_PASS", count: result.agents.length, errors: [] }); }
    catch (error) { if (error instanceof AgentRegistryError) return Object.freeze({ ok: false, status: "AGENT_DOCTOR_FAIL", code: error.code, message: error.message, errors: error.details?.errors ?? [] }); throw error; }
  }
}

export function createAgentRegistry(options = {}) { return new AgentRegistry(options); }
export async function listAgents(options = {}) { return createAgentRegistry(options).list(); }
export async function resolveAgent(registryOrOptions, id, options = {}) {
  const registry = registryOrOptions instanceof AgentRegistry ? registryOrOptions : createAgentRegistry(registryOrOptions ?? {});
  return registry.resolve(id, options);
}
