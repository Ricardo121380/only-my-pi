import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWriteJson, readJsonObject, withConfigLock } from "../config-runtime/index.mjs";

export const MCP_PROTOCOL = 1;
export const MCP_LIMITS = Object.freeze({ inputBytes: 16384, outputBytes: 65536, serverFileBytes: 65536, storageBytes: 8388608, calls: 32, timeoutMs: 10000, tools: 32, concurrency: 1 });
export const mcpError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const digest = (value) => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const id = (value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value) && !value.includes("__");
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value, max = 4096) => typeof value === "string" && value.length <= max && !/[\0\r\n]/u.test(value);
const scopePath = (value) => bounded(value, 512) && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/u).some((part) => ["..", ".git", ".pi", ".env", ""].includes(part)) && !value.startsWith("~");
const safeEnv = (key) => /^[A-Z][A-Z0-9_]{0,63}$/u.test(key) && !/(?:KEY|TOKEN|SECRET|PASS|AUTH|HOME|PATH|NODE|DYLD|LD_|PI_|OMP_|BASH|SHELL|ZDOTDIR)/u.test(key) && !["ENV", "IFS"].includes(key);
export const mcpToolName = (server, tool) => `mcp__${server}__${tool}`;
export const mcpToolNames = (snapshot) => snapshot?.servers.filter((server) => server.enabled).flatMap((server) => server.tools.map((tool) => mcpToolName(server.name, tool.name))) ?? [];
export function httpTarget(value) {
  if (!bounded(value, 2048)) throw mcpError("MCP_HTTP_TARGET_INVALID");
  let url; try { url = new URL(value); } catch { throw mcpError("MCP_HTTP_TARGET_INVALID"); }
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)
    || url.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) throw mcpError("MCP_HTTP_TARGET_INVALID");
  return url.href;
}
export function validateServer(value) {
  if (value?.transport === "streamable-http") {
    if (!plain(value) || Object.keys(value).some((key) => !["name", "transport", "url", "credentialRefs", "tools", "enabled"].includes(key)) || !id(value.name) || typeof value.enabled !== "boolean") throw mcpError("MCP_CONFIG_INVALID");
    const url = httpTarget(value.url);
    if (!plain(value.credentialRefs) || Object.keys(value.credentialRefs).some((key) => key !== "MCP_TOKEN") || Object.values(value.credentialRefs).some((ref) => !id(ref))) throw mcpError("MCP_CREDENTIAL_REF_INVALID");
    const names = new Set();
    if (!Array.isArray(value.tools) || value.tools.length > MCP_LIMITS.tools) throw mcpError("MCP_TOOL_SCOPE_INVALID");
    for (const tool of value.tools) {
      if (!plain(tool) || Object.keys(tool).some((key) => !["name", "effect"].includes(key)) || !id(tool.name) || names.has(tool.name) || tool.effect !== "remote") throw mcpError("MCP_HTTP_LOCAL_WRITE_NOT_ADMITTED");
      names.add(tool.name);
    }
    return structuredClone({ ...value, url });
  }
  if (!plain(value) || Object.keys(value).some((key) => !["name", "transport", "command", "args", "codePaths", "cwd", "env", "credentialRefs", "tools", "enabled"].includes(key)) || !id(value.name) || value.transport !== "stdio"
    || !bounded(value.command) || !path.isAbsolute(value.command) || typeof value.enabled !== "boolean") throw mcpError("MCP_CONFIG_INVALID");
  for (const [key, max] of [["args", 64], ["codePaths", 16], ["tools", MCP_LIMITS.tools]]) if (!Array.isArray(value[key]) || value[key].length > max) throw mcpError("MCP_CONFIG_INVALID");
  if (value.args.some((arg) => !bounded(arg)) || value.codePaths.some((entry) => !bounded(entry) || !path.isAbsolute(entry))) throw mcpError("MCP_CONFIG_INVALID");
  if (value.cwd !== undefined && value.cwd !== "." && !scopePath(value.cwd)) throw mcpError("MCP_CWD_NOT_ADMITTED");
  if (!plain(value.env) || Object.keys(value.env).length > 16 || Object.entries(value.env).some(([key, val]) => !safeEnv(key) || !bounded(val, 1024) || /[!$`]/u.test(val))) throw mcpError("MCP_ENV_NOT_ADMITTED");
  if (!plain(value.credentialRefs) || Object.keys(value.credentialRefs).length > 8 || Object.entries(value.credentialRefs).some(([key, val]) => !/^MCP_[A-Z0-9_]{1,48}$/u.test(key) || !id(val))) throw mcpError("MCP_CREDENTIAL_REF_INVALID");
  const names = new Set();
  for (const tool of value.tools) {
    if (!plain(tool) || Object.keys(tool).some((key) => !["name", "effect", "pathArgument", "paths", "writeMode"].includes(key)) || !id(tool.name) || names.has(tool.name) || !["read", "write"].includes(tool.effect) || (tool.effect === "write" ? tool.writeMode !== "descriptor" : tool.writeMode !== undefined) || !id(tool.pathArgument)
      || !Array.isArray(tool.paths) || !tool.paths.length || tool.paths.length > 16 || tool.paths.some((entry) => !scopePath(entry))) throw mcpError("MCP_TOOL_SCOPE_INVALID");
    names.add(tool.name);
  }
  return structuredClone(value);
}
export const targetDigest = (server) => server.transport === "streamable-http" ? digest([server.transport, server.url]) : digest([server.command, server.args, server.codePaths, server.cwd ?? ".", server.env]);
const empty = () => ({ version: 1, revision: 0, defaults: {}, projects: {}, revoked: {}, revokedCredentials: {} });

// OMP owns this store; raw Pi configuration is never written or executed.
export class McpCatalog {
  constructor(configRoot) { this.configRoot = configRoot; this.file = path.join(configRoot, "only-my-pi/mcp/config.json"); }
  async read() {
    const state = await readJsonObject(this.configRoot, this.file).catch((error) => { if (error.code === "ENOENT") return empty(); throw error; });
    if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !plain(state.defaults) || !plain(state.projects) || !plain(state.revoked)) throw mcpError("MCP_STATE_INVALID", 409);
    for (const entries of [state.defaults, ...Object.values(state.projects)]) {
      if (!plain(entries) || Object.keys(entries).length > 16) throw mcpError("MCP_STATE_INVALID", 409);
      for (const [name, server] of Object.entries(entries)) if (validateServer(server).name !== name) throw mcpError("MCP_STATE_INVALID", 409);
    }
    return state;
  }
  key(projectPath, name) { return `${projectPath ? digest(projectPath) : "default"}:${name}`; }
  async snapshot(projectPath) {
    const state = await this.read(), key = projectPath ? digest(projectPath) : null, project = key ? state.projects[key] ?? {} : {};
    const entries = { ...state.defaults, ...project };
    return { protocol: MCP_PROTOCOL, revision: state.revision, projectPath: projectPath ?? null, limits: MCP_LIMITS,
      servers: Object.values(entries).map((server) => ({ ...server, source: Object.hasOwn(project, server.name) ? "project" : "default",
        revocations: Object.fromEntries((Object.hasOwn(project, server.name) ? [this.key(projectPath, server.name)] : [this.key(null, server.name), this.key(projectPath, server.name)]).map((key) => [key, state.revoked[key] ?? 0])), targetDigest: targetDigest(server) })) };
  }
  parseImport(source) {
    if (typeof source !== "string" || Buffer.byteLength(source) > 65536) throw mcpError("MCP_IMPORT_INVALID");
    let raw; try { raw = JSON.parse(source); } catch { throw mcpError("MCP_IMPORT_INVALID"); }
    if (!plain(raw) || !plain(raw.mcpServers) || Object.keys(raw.mcpServers).length > 16) throw mcpError("MCP_IMPORT_INVALID");
    return Object.entries(raw.mcpServers).map(([name, entry]) => {
      if (entry?.url !== undefined) {
        if (!plain(entry) || Object.keys(entry).some((key) => !["url", "enabled", "transport", "type"].includes(key)) || entry.transport && !["http", "streamable-http"].includes(entry.transport) || entry.type && !["http", "streamable-http"].includes(entry.type)) throw mcpError("MCP_IMPORT_NOT_ADMITTED");
        return validateServer({ name, transport: "streamable-http", url: entry.url, credentialRefs: {}, tools: [], enabled: false });
      }
      if (!plain(entry) || Object.keys(entry).some((key) => !["command", "args", "cwd", "env", "enabled", "transport", "type"].includes(key))) throw mcpError("MCP_IMPORT_NOT_ADMITTED");
      if (entry.transport && entry.transport !== "stdio" || entry.type && entry.type !== "stdio") throw mcpError("MCP_IMPORT_NOT_ADMITTED");
      return validateServer({ name, transport: "stdio", command: entry.command, args: entry.args ?? [], codePaths: [], cwd: entry.cwd ?? ".", env: entry.env ?? {}, credentialRefs: {}, tools: [], enabled: false });
    });
  }
  async preview(source, projectPath) {
    const servers = this.parseImport(source), current = await this.snapshot(projectPath);
    return { protocol: MCP_PROTOCOL, revision: current.revision, digest: digest(source), servers,
      differences: servers.map((server) => ({ name: server.name, status: current.servers.some((old) => old.name === server.name) ? "existing" : "new" })) };
  }
  async mutate(revision, update) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw mcpError("MCP_REVISION_INVALID");
    return withConfigLock(this.configRoot, "mcp-config", async () => {
      const state = await this.read(); if (state.revision !== revision) throw mcpError("MCP_REVISION_CONFLICT", 409);
      await update(state); state.revision++;
      await atomicWriteJson(this.configRoot, this.file, state); return state.revision;
    });
  }
  async action(input, projectPath) {
    if (!plain(input) || Object.keys(input).some((key) => !["type", "projectId", "source", "revision", "digest", "server", "name", "enabled", "envName", "value", "ref"].includes(key))) throw mcpError("MCP_COMMAND_INVALID");
    if (input.type === "list") return this.snapshot(projectPath);
    if (input.type === "previewImport") return this.preview(input.source, projectPath);
    const projectKey = projectPath ? digest(projectPath) : null;
    const entries = (state) => projectKey ? state.projects[projectKey] ??= {} : state.defaults;
    if (input.type === "credential") {
      if (!projectPath || !id(input.name) || !/^MCP_[A-Z0-9_]{1,48}$/u.test(input.envName ?? "") || !bounded(input.value, 8192) || !input.value) throw mcpError("MCP_CREDENTIAL_INVALID");
      const snapshot = await this.snapshot(projectPath), server = snapshot.servers.find((entry) => entry.name === input.name);
      if (!server) throw mcpError("MCP_SERVER_NOT_FOUND", 404);
      if (server.transport === "streamable-http" && input.envName !== "MCP_TOKEN") throw mcpError("MCP_CREDENTIAL_REF_INVALID");
      const ref = `c_${randomUUID().replaceAll("-", "")}`;
      await this.mutate(input.revision, async (state) => {
        state.revokedCredentials ??= {};
        if (server.credentialRefs[input.envName]) state.revokedCredentials[server.credentialRefs[input.envName]] = true;
        await atomicWriteJson(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/credentials", `${ref}.json`), { version: 1, projectPath, name: server.name, targetDigest: server.targetDigest, value: input.value });
        entries(state)[server.name] = validateServer({ ...Object.fromEntries(Object.entries(server).filter(([key]) => !["source", "revocations", "targetDigest"].includes(key))), credentialRefs: { ...server.credentialRefs, [input.envName]: ref } });
      });
      return this.snapshot(projectPath);
    }
    await this.mutate(input.revision, async (state) => {
      const scoped = entries(state);
      if (input.type === "import") {
        if (input.digest !== digest(input.source)) throw mcpError("MCP_IMPORT_CHANGED", 409);
        for (const server of this.parseImport(input.source)) {
          if (Object.hasOwn(scoped, server.name) || projectKey && Object.hasOwn(state.defaults, server.name)) throw mcpError("MCP_NAME_CONFLICT", 409);
          scoped[server.name] = server;
        }
      } else if (input.type === "save") {
        const server = validateServer(input.server); scoped[server.name] = server;
        if (!server.enabled) {
          const key = this.key(projectPath, server.name); state.revoked[key] = (state.revoked[key] ?? 0) + 1;
        }
      }
      else if (input.type === "revokeCredential") {
        const server = scoped[input.name] ?? state.defaults[input.name], ref = server?.credentialRefs[input.envName];
        if (!projectPath || !ref) throw mcpError("MCP_CREDENTIAL_REF_INVALID");
        const credential = await readJsonObject(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/credentials", `${ref}.json`));
        if (credential.projectPath !== projectPath || credential.name !== input.name) throw mcpError("MCP_CREDENTIAL_BINDING_CHANGED");
        state.revokedCredentials ??= {}; state.revokedCredentials[ref] = true;
      }
      else if (input.type === "enable") {
        if (!id(input.name) || typeof input.enabled !== "boolean") throw mcpError("MCP_COMMAND_INVALID");
        const server = scoped[input.name] ?? state.defaults[input.name]; if (!server) throw mcpError("MCP_SERVER_NOT_FOUND", 404);
        scoped[input.name] = { ...server, enabled: input.enabled };
        if (!input.enabled) {
          // Revocation is separate from revisions; current snapshots never change target.
          const key = this.key(projectPath, input.name); state.revoked[key] = (state.revoked[key] ?? 0) + 1;
        }
      } else if (input.type === "reset") { if (!projectKey || !id(input.name)) throw mcpError("MCP_COMMAND_INVALID"); delete scoped[input.name]; }
      else throw mcpError("MCP_COMMAND_INVALID");
    });
    return this.snapshot(projectPath);
  }
  async current(server) { const state = await this.read(); return Object.entries(server.revocations).every(([key, epoch]) => (state.revoked[key] ?? 0) === epoch); }
  async credentials(server, projectPath) {
    const env = {}, secrets = [], state = await this.read();
    for (const [key, ref] of Object.entries(server.credentialRefs)) {
      const credential = await readJsonObject(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/credentials", `${ref}.json`));
      if (state.revokedCredentials?.[ref] || credential.version !== 1 || credential.projectPath !== projectPath || credential.name !== server.name || credential.targetDigest !== server.targetDigest || typeof credential.value !== "string") throw mcpError("MCP_CREDENTIAL_BINDING_CHANGED", 409);
      env[key] = credential.value; secrets.push(credential.value);
    }
    return { env, secrets };
  }
}
