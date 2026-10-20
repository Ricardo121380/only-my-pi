import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

// The server is the controlled provider. The client remains Pi 1.3.0's actual
// OpenRouter PKCE/login/callback/store implementation, without a faux runtime.
export async function createAccountOAuthService({ respond } = {}) {
  const codes = new Map(), keys = new Map(), revoked = new Set();
  const exchanges = [], calls = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/authorize") {
      const callback = new URL(url.searchParams.get("callback_url"));
      if (callback.hostname !== "127.0.0.1" || !callback.pathname.startsWith("/oauth/callback/") || url.searchParams.get("code_challenge_method") !== "S256") { res.writeHead(400); res.end(); return; }
      const code = randomUUID();
      codes.set(code, { challenge: url.searchParams.get("code_challenge"), identity: url.searchParams.get("identity") ?? "controlled-oauth", expires: Date.now() + 10000 });
      callback.searchParams.set("code", code);
      res.writeHead(302, { location: callback.href }); res.end(); return;
    }
    let raw = ""; for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw || "{}");
    if (url.pathname === "/token") {
      const authorization = codes.get(body.code); codes.delete(body.code);
      const valid = authorization && authorization.expires > Date.now() && createHash("sha256").update(body.code_verifier ?? "").digest("base64url") === authorization.challenge;
      exchanges.push({ valid: Boolean(valid), identity: authorization?.identity ?? null });
      if (!valid) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"invalid_or_expired_code"}'); return; }
      const key = `controlled-oauth-${randomUUID()}`; keys.set(key, authorization.identity);
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ key })); return;
    }
    if (url.pathname === "/v1/chat/completions") {
      const key = req.headers.authorization?.replace(/^Bearer /, ""), identity = keys.get(key);
      calls.push({ identity: identity ?? null, valid: Boolean(identity) && !revoked.has(identity), model: body.model, tools: body.tools?.map(tool => tool.function.name), body });
      if (!identity || revoked.has(identity)) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":{"message":"controlled credential revoked"}}'); return; }
      if (respond) { await respond({ body, res, identity }); return; }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const choice of [{ delta: { role: "assistant", content: "controlled OAuth account completed" }, finish_reason: null }, { delta: {}, finish_reason: "stop" }]) res.write(`data: ${JSON.stringify({ id: "controlled-oauth", choices: [{ index: 0, ...choice }] })}\n\n`);
      res.end("data: [DONE]\n\n"); return;
    }
    res.writeHead(404); res.end();
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, exchanges, calls, revoked, keys,
    authorizeUrl(providerUrl, identity) { const url = new URL(providerUrl); url.protocol = "http:"; url.host = new URL(origin).host; url.pathname = "/authorize"; url.searchParams.set("identity", identity); return url.href; },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}

export async function installAccountOAuthTransport(fixture, service) {
  const original = path.join(path.dirname(fixture.sdk), "index-real.js");
  await fs.rename(fixture.sdk, original);
  // This test-only network adapter changes the destination of the builtin
  // token exchange and denies every other external fetch. It does not provide
  // credentials or replace ModelRuntime, OAuth handlers, callbacks or storage.
  await fs.writeFile(fixture.sdk, `export * from "./index-real.js";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.href === "https://openrouter.ai/api/v1/auth/keys") return nativeFetch(${JSON.stringify(`${service.origin}/token`)}, options);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw Error("CONTROLLED_EXTERNAL_NETWORK_DENIED");
  return nativeFetch(input, options);
};
`);
}
