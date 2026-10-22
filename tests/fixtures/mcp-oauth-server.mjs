import http from "node:http";
import { randomUUID, createHash } from "node:crypto";

// Real HTTP/OAuth/PKCE endpoints. The ledger stores grant identities, never
// authorization URLs, codes, state, verifiers or token values.
export async function createOAuthMcpServer({ expiresIn = 3600, beforeRequest } = {}) {
  const clients = new Map(), codes = new Map(), tokens = new Map(), refresh = new Map(), management = new Map(), sockets = new Set(), unauthorized = new Set(), received = [];
  let origin, mode = "normal", lastCallback;
  const json = (res, status, value) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin); let text = ""; for await (const bytes of req) text += bytes;
      await beforeRequest?.({ path: url.pathname, response: res });
      if (res.destroyed) return;
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["tools", "offline_access"] });
      if (url.pathname === "/.well-known/oauth-authorization-server") return json(res, 200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true });
      if (url.pathname === "/register" && req.method === "POST") {
        const input = JSON.parse(text), client = `client_${randomUUID()}`;
        clients.set(client, input); management.set(client, `registration_${randomUUID()}`); received.push({ type: "registration", client });
        return json(res, 201, { client_id: client, redirect_uris: input.redirect_uris, token_endpoint_auth_method: "none", registration_access_token: management.get(client) });
      }
      if (url.pathname === "/authorize") {
        if (req.method === "GET") {
          received.push({ type: "authorization_page", client: url.searchParams.get("client_id") });
          res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store", "referrer-policy": "no-referrer" });
          return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>受控 MCP 授权</title><h1>受控 MCP 授权</h1><p>允许 OMP 使用当前合成身份调用此 MCP 服务。</p><form method="post"><button name="decision" value="allow">允许受控身份</button><button name="decision" value="deny">拒绝授权</button></form></html>');
        }
        const client = url.searchParams.get("client_id"), registered = clients.get(client), redirect = url.searchParams.get("redirect_uri");
        if (!registered?.redirect_uris.includes(redirect) || url.searchParams.get("code_challenge_method") !== "S256" || url.searchParams.get("resource") !== `${origin}/mcp`) return json(res, 400, { error: "invalid_request" });
        const callback = new URL(redirect), grant = `grant_${randomUUID()}`, code = randomUUID();
        callback.searchParams.set("state", mode === "bad_state" ? "wrong-state" : url.searchParams.get("state"));
        callback.searchParams.set("iss", mode === "bad_issuer" ? `${origin}/other` : origin);
        if (mode === "wrong_path") callback.pathname = "/wrong-callback";
        if (new URLSearchParams(text).get("decision") === "deny") callback.searchParams.set("error", "access_denied");
        else if (mode !== "missing_code") {
          codes.set(code, { client, redirect, grant, challenge: url.searchParams.get("code_challenge") }); callback.searchParams.set("code", code);
        }
        received.push({ type: "authorization", client, grant, mode }); lastCallback = callback.href;
        res.writeHead(303, { location: callback.href, "cache-control": "no-store", "referrer-policy": "no-referrer" }); return res.end();
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const input = new URLSearchParams(text), kind = input.get("grant_type"), client = input.get("client_id");
        const source = kind === "authorization_code" ? codes.get(input.get("code")) : refresh.get(input.get("refresh_token"));
        const valid = source && source.client === client && input.get("resource") === `${origin}/mcp`
          && (kind !== "authorization_code" || source.redirect === input.get("redirect_uri") && source.challenge === createHash("sha256").update(input.get("code_verifier") ?? "").digest("base64url"));
        received.push({ type: "token", kind, client, grant: source?.grant ?? null, valid: Boolean(valid), mode });
        if (mode === "refresh_delay" && kind === "refresh_token") await new Promise((resolve) => { const timer = setTimeout(resolve, 15000); res.once("close", () => { clearTimeout(timer); resolve(); }); });
        if (res.destroyed) return;
        if (!valid || kind === "refresh_token" && mode === "refresh_fail") return json(res, 400, { error: "invalid_grant", error_description: "private error must not escape" });
        if (kind === "authorization_code") codes.delete(input.get("code")); else refresh.delete(input.get("refresh_token"));
        const access = `access_${randomUUID()}`, refreshToken = `refresh_${randomUUID()}`;
        tokens.set(access, { ...source, revoked: false }); refresh.set(refreshToken, source);
        return json(res, 200, { access_token: access, refresh_token: refreshToken, token_type: "Bearer", expires_in: expiresIn, scope: "tools offline_access" });
      }
      if (url.pathname === "/mcp") {
        const identity = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /u, "")), message = text ? JSON.parse(text) : null;
        received.push({ type: "mcp", rpc: message?.method ?? null, grant: identity?.grant ?? null, valid: Boolean(identity && !identity.revoked), args: message?.params?.arguments });
        if (!identity || identity.revoked) {
          if (mode === "unauthorized_pause") await new Promise((resolve) => { unauthorized.add(resolve); res.once("close", () => { unauthorized.delete(resolve); resolve(); }); });
          if (!res.destroyed) return json(res, 401, { error: "invalid_token" });
          return;
        }
        if (req.method === "DELETE") { res.writeHead(204).end(); return; }
        if (req.method === "GET") { res.writeHead(405, { allow: "POST, DELETE" }).end(); return; }
        if (!message?.id) { res.writeHead(202).end(); return; }
        let result;
        if (message.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "controlled-oauth", version: "1" } };
        else if (message.method === "tools/list") result = { tools: [{ name: "echo", description: "Controlled OAuth remote action", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } }] };
        else if (message.method === "tools/call") result = { content: [{ type: "text", text: mode === "registration_secret_echo" ? management.get(identity.client) : `OAuth result: ${message.params.arguments.value}` }] };
        else return json(res, 400, { error: "unsupported_method" });
        return json(res, 200, { jsonrpc: "2.0", id: message.id, result });
      }
      return json(res, 404, { error: "not_found" });
    } catch { if (!res.headersSent) json(res, 500, { error: "fixture_failed" }); else res.destroy(); }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  return { url: `${origin}/mcp`, received, setMode: (value) => { mode = value; },
    setExpiresIn: (value) => { expiresIn = value; }, revoke: () => { for (const identity of tokens.values()) identity.revoked = true; },
    releaseUnauthorized: () => { for (const resolve of unauthorized) resolve(); unauthorized.clear(); },
    // Private helpers are used only to drive protocol negatives, never output.
    get lastCallback() { return lastCallback; }, get privateValues() { return [...codes.keys(), ...tokens.keys(), ...refresh.keys(), ...management.values()]; },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); } };
}
