import { randomUUID } from "node:crypto";
import { loadNativeMcp } from "./native.mjs";
import { httpTarget, mcpError, MCP_LIMITS } from "./catalog.mjs";

const active = (status) => ["starting", "waiting", "refreshing", "cancelling"].includes(status);
const endpoint = (input, authorization = false) => {
  const url = new URL(String(input));
  if (authorization) {
    if (url.href.length > 8192 || [...url.searchParams.keys()].some((key) => !["response_type", "client_id", "code_challenge", "code_challenge_method", "redirect_uri", "state", "scope", "resource", "prompt"].includes(key))) throw mcpError("MCP_OAUTH_ENDPOINT_INVALID");
    url.search = "";
  }
  httpTarget(url.href); return new URL(String(input));
};
const code = (error) => /^MCP_[A-Z_]+$/u.test(error?.code ?? "") ? error.code : "MCP_OAUTH_FAILED";
const callbackPage = ({ ok }) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>MCP 登录回调</title><script>history.replaceState(null,"",location.pathname)</script><h1>${ok ? "授权响应已收到" : "授权响应无效"}</h1><p>请返回 OMP 查看身份保存结果。此页面不会显示授权代码或错误原文。</p></html>`;

// Native Pi owns OAuth discovery, PKCE, parsing and the callback listener. OMP
// owns explicit intent, bounded physical requests, exact binding and publication.
export class McpOAuth {
  constructor({ catalog, sdkFile, timeoutMs = 120000 }) { Object.assign(this, { catalog, sdkFile, timeoutMs }); this.flows = new Map(); }
  async initialize() {
    for (const flow of Object.values(await this.catalog.oauthFlows())) if (active(flow.status)) await this.catalog.saveOAuthFlow({ ...flow, status: "interrupted", code: "MCP_OAUTH_INTERRUPTED", updatedAt: new Date().toISOString() });
  }
  public(flow) { return structuredClone(flow.visible ?? flow.data); }
  save(flow, status, errorCode) {
    flow.data.status = status; flow.data.updatedAt = new Date().toISOString();
    if (errorCode) flow.data.code = errorCode;
    flow.data.events = [...flow.data.events, { status, at: flow.data.updatedAt }].slice(-16);
    const value = structuredClone(flow.data);
    const write = (this.saved ?? Promise.resolve()).then(async () => { await this.catalog.saveOAuthFlow(value); flow.visible = value; });
    this.saved = write.catch(() => {}); return write;
  }
  async binding(name, projectPath, revision) {
    if (!projectPath || typeof name !== "string") throw mcpError("MCP_OAUTH_PROJECT_REQUIRED");
    const snapshot = await this.catalog.snapshot(projectPath), server = snapshot.servers.find((entry) => entry.name === name);
    if (snapshot.revision !== revision) throw mcpError("MCP_REVISION_CONFLICT", 409);
    if (server?.transport !== "streamable-http") throw mcpError("MCP_OAUTH_HTTP_REQUIRED");
    return { name, projectPath, revision, url: server.url, targetDigest: server.targetDigest, ref: server.credentialRefs.MCP_TOKEN ?? null };
  }
  async fetch(flow, input, init = {}) {
    await this.assertBinding(flow);
    const url = endpoint(input); if (init.body && Buffer.byteLength(String(init.body)) > MCP_LIMITS.inputBytes) throw mcpError("MCP_OAUTH_INPUT_LIMIT");
    const signal = AbortSignal.any([flow.abort.signal, init.signal, AbortSignal.timeout(MCP_LIMITS.timeoutMs)].filter(Boolean));
    let reader;
    const chunks = []; let bytes = 0;
    try {
      const response = await fetch(url, { ...init, redirect: "manual", signal }); reader = response.body?.getReader();
      if (response.status >= 300 && response.status < 400) throw mcpError("MCP_OAUTH_REDIRECT_DENIED");
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MCP_LIMITS.outputBytes) throw mcpError("MCP_OAUTH_OUTPUT_LIMIT"); chunks.push(part.value); }
      return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), { status: response.status, headers: response.headers });
    } catch (error) {
      if (/^MCP_[A-Z_]+$/u.test(error.code ?? "")) throw error;
      throw mcpError(signal.aborted ? flow.abort.signal.aborted ? "MCP_OAUTH_CANCELLED" : "MCP_OAUTH_REQUEST_TIMED_OUT" : "MCP_OAUTH_REQUEST_FAILED");
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  }
  async assertBinding(flow) {
    const binding = await this.binding(flow.data.name, flow.data.projectPath, flow.binding.revision);
    if (binding.targetDigest !== flow.binding.targetDigest || binding.ref !== flow.binding.ref) throw mcpError("MCP_CREDENTIAL_BINDING_CHANGED", 409);
  }
  async start(name, projectPath, revision, kind = "login") {
    if (this.closing) throw mcpError("MCP_OAUTH_STOPPING", 503);
    const binding = await this.binding(name, projectPath, revision), flowId = randomUUID();
    if (this.closing) throw mcpError("MCP_OAUTH_STOPPING", 503);
    if ([...this.flows.values()].some((flow) => active(flow.data.status) && flow.data.projectPath === projectPath && flow.data.name === name)) throw mcpError("MCP_OAUTH_BUSY", 409);
    if ([...this.flows.values()].filter((flow) => active(flow.data.status)).length >= 8) throw mcpError("MCP_OAUTH_LIMIT", 429);
    let readyResolve; const ready = new Promise((resolve) => { readyResolve = resolve; });
    const flow = { binding, abort: new AbortController(), ready: readyResolve,
      data: { flowId, name, projectPath, targetDigest: binding.targetDigest, ref: binding.ref, kind, status: "starting", events: [], updatedAt: new Date().toISOString() } };
    this.flows.set(flowId, flow);
    for (const [id, old] of this.flows) if (this.flows.size > 32 && !active(old.data.status)) this.flows.delete(id);
    flow.done = this.run(flow); flow.done.catch(() => {});
    await ready; return this.public(flow);
  }
  async closeCallback(flow) { if (flow.callback) await (flow.callbackClosed ??= flow.callback.close()); }
  async run(flow) {
    const timer = setTimeout(() => { flow.timedOut = true; flow.abort.abort(); void this.closeCallback(flow).catch(() => {}); }, this.timeoutMs);
    try {
      await this.save(flow, "starting");
      const native = await loadNativeMcp(this.sdkFile, "./oauth"), binding = flow.binding;
      let privateState;
      if (flow.data.kind === "refresh") {
        const snapshot = await this.catalog.snapshot(binding.projectPath), server = snapshot.servers.find((entry) => entry.name === binding.name);
        const credential = await this.catalog.boundCredential(server, binding.projectPath);
        privateState = credential.oauth;
        if (!privateState?.tokens?.refresh_token) throw mcpError("MCP_OAUTH_REFRESH_UNAVAILABLE");
      } else flow.callback = await native.OAuthCallbackServer.listen({ path: `/mcp-callback/${flow.data.flowId}`, timeoutMs: this.timeoutMs, renderPage: callbackPage });
      const provider = new native.McpOAuthProvider({ serverUrl: binding.url, redirectUrl: flow.callback?.redirectUrl ?? "http://127.0.0.1/callback",
        clientMetadata: { client_name: "only-my-pi MCP", scope: "tools offline_access" },
        store: { load: () => privateState, save: (value) => { privateState = value; } },
        onRedirect: (url) => { flow.authorizationUrl = endpoint(url, true).href; flow.data.authorizationOrigin = new URL(flow.authorizationUrl).origin; } });
      const options = { serverUrl: binding.url, fetch: (input, init) => this.fetch(flow, input, init), signal: flow.abort.signal };
      if (flow.data.kind === "refresh") {
        await this.save(flow, "refreshing"); flow.ready();
        const discovery = privateState.discovery;
        if (!discovery?.authorizationServerMetadata) throw mcpError("MCP_OAUTH_METADATA_REQUIRED");
        const tokens = await native.refreshAuthorization(discovery.authorizationServerUrl, { metadata: discovery.authorizationServerMetadata, clientInformation: privateState.clientInformation,
          resource: native.selectResource(binding.url, discovery.resourceMetadata), refreshToken: privateState.tokens.refresh_token, fetch: options.fetch, signal: options.signal });
        await provider.saveTokens(tokens);
      } else {
        if (await native.authorizeMcp(provider, { ...options, skipRefresh: true }) !== "REDIRECT") throw mcpError("MCP_OAUTH_REDIRECT_REQUIRED");
        const callback = flow.callback.waitForCallback(await provider.state(), new URL(flow.callback.redirectUrl).pathname); callback.catch(() => {});
        await this.save(flow, "waiting"); flow.ready();
        const reply = await callback, discovery = privateState.discovery, metadata = discovery?.authorizationServerMetadata;
        if (!metadata) throw mcpError("MCP_OAUTH_METADATA_REQUIRED");
        if ((reply.iss !== undefined || metadata.authorization_response_iss_parameter_supported) && reply.iss !== metadata.issuer) throw mcpError("MCP_OAUTH_ISSUER_MISMATCH");
        const tokens = await native.exchangeAuthorizationCode(discovery.authorizationServerUrl, { metadata, clientInformation: await provider.clientInformation(),
          resource: native.selectResource(binding.url, discovery.resourceMetadata), code: reply.code, codeVerifier: await provider.codeVerifier(), redirectUrl: provider.redirectUrl, fetch: options.fetch, signal: options.signal });
        await provider.saveTokens(tokens);
      }
      flow.data.ref = await this.catalog.storeOAuth(binding, await provider.load(), flow.abort.signal);
      await this.save(flow, "stored");
    } catch (error) {
      if (flow.data.kind === "refresh") await this.catalog.invalidateOAuth(flow.binding, flow.binding.projectPath).catch(() => {});
      await this.save(flow, flow.failureCode ? "failed" : flow.timedOut ? "timed_out" : flow.abort.signal.aborted ? "cancelled" : "failed", flow.failureCode ?? (flow.timedOut ? "MCP_OAUTH_TIMED_OUT" : flow.abort.signal.aborted ? "MCP_OAUTH_CANCELLED" : code(error)));
    } finally {
      clearTimeout(timer); flow.authorizationUrl = null;
      await this.closeCallback(flow).catch(() => {}); flow.ready();
    }
  }
  own(flowId, projectPath) {
    const flow = this.flows.get(flowId); if (!flow || flow.data.projectPath !== projectPath) throw mcpError("MCP_OAUTH_FLOW_EXPIRED", 404); return flow;
  }
  async open(flowId) {
    const flow = this.flows.get(flowId);
    if (!flow || flow.data.status !== "waiting" || flow.opened || !flow.authorizationUrl) throw mcpError("MCP_OAUTH_FLOW_EXPIRED", 409);
    try {
      await this.assertBinding(flow);
    } catch (error) { flow.failureCode = code(error); flow.abort.abort(); await this.closeCallback(flow); await flow.done; throw error; }
    flow.opened = true; flow.data.opened = true; await this.save(flow, "waiting"); return flow.authorizationUrl;
  }
  async action(input, projectPath) {
    const keys = Object.keys(input).filter((key) => key !== "projectId").sort().join();
    if (["oauthStart", "oauthRefresh"].includes(input.type) && keys === "name,revision,type") return this.start(input.name, projectPath, input.revision, input.type === "oauthRefresh" ? "refresh" : "login");
    if (keys !== "flowId,type" || !["oauthCancel", "oauthStatus"].includes(input.type)) throw mcpError("MCP_COMMAND_INVALID");
    const flow = this.own(input.flowId, projectPath);
    if (input.type === "oauthCancel" && active(flow.data.status)) { await this.save(flow, "cancelling"); flow.abort.abort(); await this.closeCallback(flow); await flow.done; }
    else if (input.type === "oauthCancel") await flow.done;
    return this.public(flow);
  }
  async stop() {
    this.closing = true;
    await Promise.all([...this.flows.values()].filter((flow) => active(flow.data.status)).map((flow) => this.action({ type: "oauthCancel", flowId: flow.data.flowId }, flow.data.projectPath)));
    await Promise.allSettled([...this.flows.values()].map((flow) => flow.done));
  }
}
