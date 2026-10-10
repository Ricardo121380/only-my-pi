import { digest, httpTarget, mcpError, MCP_LIMITS } from "./catalog.mjs";
import { containsSecret } from "./process.mjs";

const safeError = (error) => mcpError(/^[A-Z_]+$/u.test(error?.code ?? "") ? error.code : "MCP_HTTP_FAILED");

// Pi owns Streamable HTTP protocol semantics. OMP fixes the exact target,
// credential binding and physical request bounds, and never retries a POST.
export class ControlledHttpTransport {
  constructor({ NativeTransport, server, env, secrets, record, save, authorize, signal }) {
    Object.assign(this, { server, secrets, record, save, authorize, signal });
    this.credentialDigest = digest(env); this.errors = new Set(); this.abort = new AbortController();
    this.native = new NativeTransport({ url: server.url, headers: env.MCP_TOKEN ? { Authorization: `Bearer ${env.MCP_TOKEN}` } : {},
      fetch: (input, init) => this.fetch(input, init), openGetStream: false, reconnect: { maxRetries: 0 }, maxMessageBytes: MCP_LIMITS.outputBytes });
  }
  onMessage(listener) {
    return this.native.onMessage((message) => {
      try {
        if (containsSecret(message, this.secrets)) throw mcpError("MCP_SECRET_OUTPUT_REJECTED");
        if (message.result?.tools && (message.result.tools.length > MCP_LIMITS.tools || message.result.nextCursor !== undefined)) throw mcpError("MCP_TOOL_LIMIT");
        listener(message);
      } catch (error) { for (const handler of this.errors) handler(safeError(error)); void this.close().catch(() => {}); }
    });
  }
  onError(listener) { this.errors.add(listener); const off = this.native.onError((error) => listener(safeError(error))); return () => { this.errors.delete(listener); off(); }; }
  onClose(listener) { return this.native.onClose(listener); }
  setProtocolVersion(value) { this.native.setProtocolVersion(value); }
  async start() { await this.native.start(); this.record.status = "running"; this.record.remoteState = "unconfirmed"; await this.save(); }
  async send(message) {
    try { if (message.method === "tools/call") await this.beforeToolCall?.(message); await this.native.send(message); }
    catch (error) { throw safeError(error); }
  }
  async fetch(input, init = {}) {
    const target = httpTarget(String(input));
    if (target !== this.server.url || !["POST", "GET", "DELETE"].includes(init.method)) throw mcpError("MCP_HTTP_TARGET_CHANGED");
    if (this.closed && init.method !== "DELETE") throw mcpError("MCP_CONNECTION_CLOSED");
    await this.authorize(this.credentialDigest);
    if (init.body && (typeof init.body !== "string" || Buffer.byteLength(init.body) > MCP_LIMITS.inputBytes)) throw mcpError("MCP_INPUT_LIMIT");
    const signal = AbortSignal.any([this.abort.signal, this.signal, init.signal, AbortSignal.timeout(MCP_LIMITS.timeoutMs)].filter(Boolean));
    if (signal.aborted) throw mcpError("MCP_CALL_CANCELLED");
    let response;
    try {
      response = await fetch(target, { ...init, redirect: "manual", signal });
      if (response.status >= 300 && response.status < 400) throw mcpError("MCP_HTTP_REDIRECT_DENIED");
      if (response.status === 401 || response.status === 403) throw mcpError("MCP_HTTP_AUTH_REQUIRED");
      const session = response.headers.get("mcp-session-id");
      if (session && (session.length > 512 || /[\0\r\n]/u.test(session))) throw mcpError("MCP_HTTP_SESSION_INVALID");
      const reader = response.body?.getReader(), chunks = []; let bytes = 0;
      if (reader) {
        try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > MCP_LIMITS.outputBytes) throw mcpError("MCP_OUTPUT_LIMIT"); chunks.push(next.value); } }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      const body = Buffer.concat(chunks), text = body.toString("utf8");
      if (containsSecret(text, this.secrets)) throw mcpError("MCP_SECRET_OUTPUT_REJECTED");
      return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
    } catch (error) { await response?.body?.cancel().catch(() => {}); throw safeError(error); }
  }
  close() {
    this.closed = true;
    return this.closing ??= (async () => { try { await this.native.close(); } finally { this.abort.abort(); this.record.status = "stopped"; this.record.remoteState = "unconfirmed"; await this.save(); } })();
  }
}
