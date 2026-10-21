import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWriteJson, readJsonObject, withConfigLock } from "../config-runtime/index.mjs";
import { isMcpOAuthActive, isMcpOAuthBlocked } from "./contracts.mjs";
import { processIdentity } from "../host/ownership.mjs";

export const MCP_PROTOCOL = 1;
export const MCP_LIMITS = Object.freeze({ inputBytes: 16384, outputBytes: 65536, serverFileBytes: 65536, storageBytes: 8388608, calls: 32, timeoutMs: 10000, tools: 32, resources: 32, discoveries: 32, discoveryStreamMs: 60000, concurrency: 1 });
export const mcpError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const digest = (value) => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const id = (value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value) && !value.includes("__");
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value, max = 4096) => typeof value === "string" && value.length <= max && !/[\0\r\n]/u.test(value);
const scopePath = (value) => bounded(value, 512) && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/u).some((part) => ["..", ".git", ".pi", ".env", ""].includes(part)) && !value.startsWith("~");
const safeEnv = (key) => /^[A-Z][A-Z0-9_]{0,63}$/u.test(key) && !/(?:KEY|TOKEN|SECRET|PASS|AUTH|HOME|PATH|NODE|DYLD|LD_|PI_|OMP_|BASH|SHELL|ZDOTDIR)/u.test(key) && !["ENV", "IFS"].includes(key);
export const mcpToolName = (server, tool) => `mcp__${server}__${tool}`;
export const mcpToolEnabled = (tool) => tool.active !== false && tool.exposure !== "hidden";
export const MCP_HELPERS = Object.freeze(["mcp_tool_search", "mcp_list_resources", "mcp_read_resource"]);
export const mcpToolNames = (snapshot) => {
  const selected = snapshot?.servers.filter((server) => server.enabled) ?? [];
  return selected.flatMap((server) => server.tools.filter(mcpToolEnabled).map((tool) => mcpToolName(server.name, tool.name))).concat(selected.length ? MCP_HELPERS : []);
};
const validExposure = (tool) => (tool.exposure === undefined || ["direct", "deferred", "codemode", "hidden"].includes(tool.exposure)) && (tool.active === undefined || typeof tool.active === "boolean");
export function resourceUri(uri, server) {
  if (!bounded(uri, 2048)) throw mcpError("MCP_RESOURCE_NOT_ADMITTED");
  let url; try { url = new URL(uri); } catch { throw mcpError("MCP_RESOURCE_NOT_ADMITTED"); }
  if (url.protocol !== "mcp:" || url.hostname !== server || url.username || url.password || url.port || url.search || url.hash || url.href !== uri) throw mcpError("MCP_RESOURCE_NOT_ADMITTED");
  return uri;
}
function resourcePolicies(server) {
  if (server.resources === undefined) return;
  if (!Array.isArray(server.resources) || server.resources.length > MCP_LIMITS.resources) throw mcpError("MCP_RESOURCE_SCOPE_INVALID");
  const names = new Set();
  for (const resource of server.resources) {
    if (!plain(resource) || Object.keys(resource).some((key) => !["uri", "mimeTypes", "paths", "active"].includes(key)) || names.has(resource.uri) || resource.active !== undefined && typeof resource.active !== "boolean"
      || !Array.isArray(resource.mimeTypes) || !resource.mimeTypes.length || resource.mimeTypes.some((mime) => !["text/plain", "text/markdown", "application/json", "application/octet-stream"].includes(mime))
      || resource.paths !== undefined && (server.transport !== "stdio" || !Array.isArray(resource.paths) || resource.paths.length > 16 || resource.paths.some((entry) => !scopePath(entry)))) throw mcpError("MCP_RESOURCE_SCOPE_INVALID");
    resourceUri(resource.uri, server.name); names.add(resource.uri);
  }
}
function withdrawn(previous, next) {
  return previous?.tools.some((old) => mcpToolEnabled(old) && !next.tools.some((tool) => mcpToolEnabled(tool) && tool.name === old.name && tool.effect === old.effect && digest(tool.paths ?? []) === digest(old.paths ?? []) && tool.pathArgument === old.pathArgument && tool.writeMode === old.writeMode))
    || previous?.resources?.some((old) => old.active !== false && !next.resources?.some((item) => item.active !== false && item.uri === old.uri && old.mimeTypes.every((mime) => item.mimeTypes.includes(mime)) && digest(item.paths ?? []) === digest(old.paths ?? [])));
}
export function httpTarget(value) {
  if (!bounded(value, 2048)) throw mcpError("MCP_HTTP_TARGET_INVALID");
  let url; try { url = new URL(value); } catch { throw mcpError("MCP_HTTP_TARGET_INVALID"); }
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)
    || url.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) throw mcpError("MCP_HTTP_TARGET_INVALID");
  return url.href;
}
export function validateServer(value) {
  resourcePolicies(value ?? {});
  if (value?.transport === "streamable-http") {
    if (!plain(value) || Object.keys(value).some((key) => !["name", "transport", "url", "credentialRefs", "tools", "resources", "enabled"].includes(key)) || !id(value.name) || typeof value.enabled !== "boolean") throw mcpError("MCP_CONFIG_INVALID");
    const url = httpTarget(value.url);
    if (!plain(value.credentialRefs) || Object.keys(value.credentialRefs).some((key) => key !== "MCP_TOKEN") || Object.values(value.credentialRefs).some((ref) => !id(ref))) throw mcpError("MCP_CREDENTIAL_REF_INVALID");
    const names = new Set();
    if (!Array.isArray(value.tools) || value.tools.length > MCP_LIMITS.tools) throw mcpError("MCP_TOOL_SCOPE_INVALID");
    for (const tool of value.tools) {
      if (!plain(tool) || Object.keys(tool).some((key) => !["name", "effect", "exposure", "active"].includes(key)) || !validExposure(tool) || !id(tool.name) || names.has(tool.name) || tool.effect !== "remote") throw mcpError("MCP_HTTP_LOCAL_WRITE_NOT_ADMITTED");
      names.add(tool.name);
    }
    return structuredClone({ ...value, url });
  }
  if (!plain(value) || Object.keys(value).some((key) => !["name", "transport", "command", "args", "codePaths", "cwd", "env", "credentialRefs", "tools", "resources", "enabled"].includes(key)) || !id(value.name) || value.transport !== "stdio"
    || !bounded(value.command) || !path.isAbsolute(value.command) || typeof value.enabled !== "boolean") throw mcpError("MCP_CONFIG_INVALID");
  for (const [key, max] of [["args", 64], ["codePaths", 16], ["tools", MCP_LIMITS.tools]]) if (!Array.isArray(value[key]) || value[key].length > max) throw mcpError("MCP_CONFIG_INVALID");
  if (value.args.some((arg) => !bounded(arg)) || value.codePaths.some((entry) => !bounded(entry) || !path.isAbsolute(entry))) throw mcpError("MCP_CONFIG_INVALID");
  if (value.cwd !== undefined && value.cwd !== "." && !scopePath(value.cwd)) throw mcpError("MCP_CWD_NOT_ADMITTED");
  if (!plain(value.env) || Object.keys(value.env).length > 16 || Object.entries(value.env).some(([key, val]) => !safeEnv(key) || !bounded(val, 1024) || /[!$`]/u.test(val))) throw mcpError("MCP_ENV_NOT_ADMITTED");
  if (!plain(value.credentialRefs) || Object.keys(value.credentialRefs).length > 8 || Object.entries(value.credentialRefs).some(([key, val]) => !/^MCP_[A-Z0-9_]{1,48}$/u.test(key) || !id(val))) throw mcpError("MCP_CREDENTIAL_REF_INVALID");
  const names = new Set();
  for (const tool of value.tools) {
    if (!plain(tool) || Object.keys(tool).some((key) => !["name", "effect", "pathArgument", "paths", "writeMode", "exposure", "active"].includes(key)) || !validExposure(tool) || !id(tool.name) || names.has(tool.name) || !["read", "write"].includes(tool.effect) || (tool.effect === "write" ? tool.writeMode !== "descriptor" : tool.writeMode !== undefined) || !id(tool.pathArgument)
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
    const flows = await this.oauthFlows(), authentication = {};
    for (const server of Object.values(entries)) {
      if (server.transport !== "streamable-http") continue;
      const ref = server.credentialRefs.MCP_TOKEN ?? null, target = targetDigest(server);
      const flow = flows[this.key(projectPath, server.name)];
      const ownFlow = flow?.targetDigest === target && flow.ref === ref ? flow : null;
      let status = "not_connected";
      if (ref) {
        try {
          const credential = await this.boundCredential(server, projectPath, state);
          status = credential.oauth ? credential.oauth.tokensExpireAt !== undefined && credential.oauth.tokensExpireAt <= Date.now() || state.invalidCredentials?.[ref] || await this.oauthInvalidated(server, projectPath) ? "expired" : "connected" : "token";
        } catch { status = state.revokedCredentials?.[ref] ? "revoked" : "binding_changed"; }
      }
      if (isMcpOAuthBlocked(ownFlow) && !["revoked", "binding_changed"].includes(status)) status = "refresh_required";
      authentication[server.name] = { state: status, ref, ...(ownFlow ? { flow: ownFlow } : {}) };
    }
    return { protocol: MCP_PROTOCOL, revision: state.revision, projectPath: projectPath ?? null, limits: MCP_LIMITS,
      authentication,
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
  async mutate(revision, update, options) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw mcpError("MCP_REVISION_INVALID");
    return withConfigLock(this.configRoot, "mcp-config", async () => {
      const state = await this.read(); if (state.revision !== revision) throw mcpError("MCP_REVISION_CONFLICT", 409);
      await update(state); state.revision++;
      try { await atomicWriteJson(this.configRoot, this.file, state, options); }
      catch (error) { if (error.atomicPublication === "PUBLISHED_NOT_CONFIRMED_DURABLE") error.mcpConfigPublished = true; throw error; }
      return state.revision;
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
        const server = validateServer(input.server), previous = scoped[server.name] ?? state.defaults[server.name]; scoped[server.name] = server;
        if (!server.enabled || withdrawn(previous, server)) {
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
      } else if (input.type === "reset") { if (!projectKey || !id(input.name)) throw mcpError("MCP_COMMAND_INVALID"); delete scoped[input.name]; const key = this.key(projectPath, input.name); state.revoked[key] = (state.revoked[key] ?? 0) + 1; }
      else throw mcpError("MCP_COMMAND_INVALID");
    });
    return this.snapshot(projectPath);
  }
  async current(server) { const state = await this.read(); return Object.entries(server.revocations).every(([key, epoch]) => (state.revoked[key] ?? 0) === epoch); }
  async oauthFlows() {
    return (await readJsonObject(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/oauth-status.json"), { allowMissing: true }))?.flows ?? {};
  }
  async updateOAuthFlows(update) {
    // Retry only the short metadata transaction, never an OAuth request or a
    // live flow. Independent CLI/Host processes share this same status ledger.
    for (let attempt = 0; ; attempt++) {
      try {
        return await withConfigLock(this.configRoot, { lockDirectory: path.join(this.configRoot, "only-my-pi/locks/mcp-oauth-status.lock"), staleAfterMs: 1 }, async () => {
          const flows = await this.oauthFlows(); await update(flows);
          // Active admissions, including unknown legacy owners, cannot be
          // discarded to make room for newer terminal status records.
          const entries = Object.entries(flows).sort((a, b) => Number(isMcpOAuthActive(b[1].status)) - Number(isMcpOAuthActive(a[1].status))
            || b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(0, 32);
          await atomicWriteJson(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/oauth-status.json"), { version: 1, flows: Object.fromEntries(entries) });
        });
      } catch (error) {
        if (!["LOCK_HELD", "LOCK_RECLAIMING"].includes(error.code) || attempt >= 99) throw error;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
  }
  async recoverOAuthOwners(flows) {
    for (const flow of Object.values(flows)) {
      if (!isMcpOAuthActive(flow.status) || !Number.isSafeInteger(flow.ownerPid) || flow.ownerPid < 1 || typeof flow.ownerIdentity !== "string") continue;
      if (await processIdentity(flow.ownerPid) === flow.ownerIdentity) continue;
      // This listener and its native OAuth requests live in the owner process;
      // recovery cannot terminate, replace or cancel another live owner.
      flow.status = "interrupted"; flow.code = "MCP_OAUTH_INTERRUPTED"; flow.updatedAt = new Date().toISOString();
      flow.events = [...flow.events, { status: flow.status, at: flow.updatedAt }].slice(-16);
    }
  }
  async recoverOAuthFlows() { await this.updateOAuthFlows(flows => this.recoverOAuthOwners(flows)); }
  async claimOAuthFlow(flow) {
    await this.updateOAuthFlows(async flows => {
      await this.recoverOAuthOwners(flows);
      const key = this.key(flow.projectPath, flow.name);
      if (isMcpOAuthActive(flows[key]?.status)) throw mcpError("MCP_OAUTH_BUSY", 409);
      if (Object.values(flows).filter(value => isMcpOAuthActive(value.status)).length >= 8) throw mcpError("MCP_OAUTH_LIMIT", 429);
      flows[key] = flow;
    });
  }
  async saveOAuthFlow(flow) {
    await this.updateOAuthFlows(flows => {
      const key = this.key(flow.projectPath, flow.name);
      if (flows[key]?.flowId !== flow.flowId) throw mcpError("MCP_OAUTH_FLOW_EXPIRED", 409);
      flows[key] = flow;
    });
  }
  async boundCredential(server, projectPath, state, ref = server.credentialRefs.MCP_TOKEN) {
    state ??= await this.read();
    const credential = await readJsonObject(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/credentials", `${ref}.json`));
    if (state.revokedCredentials?.[ref] || credential.version !== 1 || credential.projectPath !== projectPath || credential.name !== server.name || credential.targetDigest !== (server.targetDigest ?? targetDigest(server)) || typeof credential.value !== "string") throw mcpError("MCP_CREDENTIAL_BINDING_CHANGED", 409);
    return credential;
  }
  async storeOAuth(binding, oauth, signal) {
    if (Buffer.byteLength(JSON.stringify(oauth)) > MCP_LIMITS.outputBytes || !bounded(oauth.tokens?.access_token, 8192) || !oauth.tokens.access_token || oauth.tokens.token_type.toLowerCase() !== "bearer"
      || oauth.tokens.refresh_token !== undefined && !bounded(oauth.tokens.refresh_token, 8192) || oauth.clientInformation?.registration_access_token !== undefined && !bounded(oauth.clientInformation.registration_access_token, 8192)
      || oauth.tokensExpireAt !== undefined && (!Number.isFinite(oauth.tokensExpireAt) || oauth.tokensExpireAt <= Date.now())) throw mcpError("MCP_OAUTH_TOKEN_INVALID");
    const ref = `c_${randomUUID().replaceAll("-", "")}`, check = () => { if (signal.aborted) throw mcpError("MCP_OAUTH_CANCELLED"); };
    try { await this.mutate(binding.revision, async (state) => {
      check(); const key = digest(binding.projectPath), server = state.projects[key]?.[binding.name] ?? state.defaults[binding.name];
      if (!server || targetDigest(server) !== binding.targetDigest || (server.credentialRefs.MCP_TOKEN ?? null) !== binding.ref) throw mcpError("MCP_CREDENTIAL_BINDING_CHANGED", 409);
      const privateState = structuredClone(oauth); delete privateState.codeVerifier; delete privateState.oauthState;
      await atomicWriteJson(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/credentials", `${ref}.json`), { version: 1, projectPath: binding.projectPath, name: binding.name, targetDigest: binding.targetDigest, value: oauth.tokens.access_token, oauth: privateState });
      check(); state.revokedCredentials ??= {}; if (binding.ref) state.revokedCredentials[binding.ref] = true;
      state.projects[key] ??= {}; state.projects[key][binding.name] = { ...server, credentialRefs: { MCP_TOKEN: ref } };
    }, { beforeRename: check }); }
    catch (error) {
      if (!error.mcpConfigPublished) throw error;
      const state = await this.read().catch(() => null), current = state?.projects[digest(binding.projectPath)]?.[binding.name] ?? state?.defaults[binding.name];
      const bindingConfirmed = Boolean(current && current.credentialRefs.MCP_TOKEN === ref && targetDigest(current) === binding.targetDigest && await this.boundCredential(current, binding.projectPath, state).then(() => true, () => false));
      return { ref, durable: false, bindingConfirmed };
    }
    return { ref, durable: true };
  }
  async invalidateOAuth(server, projectPath) {
    const ref = server.credentialRefs?.MCP_TOKEN ?? server.ref; if (!ref) return;
    const state = await this.read(); if (state.revokedCredentials?.[ref]) return;
    const credential = await this.boundCredential(server, projectPath, state, ref);
    if (!credential.oauth) return;
    // A reference is immutable. Its invalidation only moves forward and must
    // survive configuration changes and writer contention. The rejection belongs
    // to the request's captured binding, even if another target is now selected.
    const receipt = { version: 1, projectPath, name: server.name, targetDigest: server.targetDigest ?? targetDigest(server), ref };
    try { await atomicWriteJson(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/credentials", `${ref}.invalid.json`), receipt, { exclusive: true }); }
    catch (error) {
      if (error.code === "EEXIST" && await this.oauthInvalidated(server, projectPath, ref).catch(() => false)) return;
      throw mcpError("MCP_OAUTH_INVALIDATION_UNCONFIRMED", 409);
    }
  }
  async oauthInvalidated(server, projectPath, ref = server.credentialRefs.MCP_TOKEN) {
    const receipt = await readJsonObject(this.configRoot, path.join(this.configRoot, "only-my-pi/mcp/credentials", `${ref}.invalid.json`), { allowMissing: true }).catch(() => { throw mcpError("MCP_OAUTH_INVALIDATION_INVALID", 409); });
    if (!receipt) return false;
    if (receipt.version !== 1 || receipt.ref !== ref || receipt.projectPath !== projectPath || receipt.name !== server.name || receipt.targetDigest !== (server.targetDigest ?? targetDigest(server))) throw mcpError("MCP_OAUTH_INVALIDATION_INVALID", 409);
    return true;
  }
  async credentials(server, projectPath) {
    const env = {}, secrets = [], state = await this.read();
    for (const [key, ref] of Object.entries(server.credentialRefs)) {
      const credential = await this.boundCredential(server, projectPath, state, ref);
      if (credential.oauth) {
        const flow = (await this.oauthFlows())[this.key(projectPath, server.name)];
        if (state.invalidCredentials?.[ref] || await this.oauthInvalidated(server, projectPath, ref) || credential.oauth.tokensExpireAt !== undefined && credential.oauth.tokensExpireAt <= Date.now()
          || flow?.ref === ref && flow.targetDigest === server.targetDigest && isMcpOAuthBlocked(flow)) throw mcpError("MCP_OAUTH_LOGIN_REQUIRED", 409);
        secrets.push(...[credential.oauth.tokens?.refresh_token, credential.oauth.tokens?.id_token, credential.oauth.clientInformation?.client_secret, credential.oauth.clientInformation?.registration_access_token].filter(Boolean));
      }
      env[key] = credential.value; secrets.push(credential.value);
    }
    return { env, secrets };
  }
}
