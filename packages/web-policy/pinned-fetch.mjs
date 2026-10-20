import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { assertPublicWebUrl } from "./index.mjs";

const redirects = new Set([301, 302, 303, 307, 308]);
const defaultLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });
function responseAt(url, body, options) {
  const response = new Response(body, options);
  Object.defineProperty(response, "url", { value: url.href });
  return response;
}

// One-hop transport. No env proxy, global fetch shim, connection pool or second
// DNS lookup may replace the addresses validated here. TLS still verifies the
// original hostname (URL/Host/SNI are not rewritten to the selected IP).
export async function pinnedRequest(input, init = {}, { lookup = defaultLookup, request } = {}) {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (init.__proxy) throw Object.assign(new Error("public web transport does not allow an unvalidated proxy"), { code: "PUBLIC_WEB_PROXY_FORBIDDEN" });
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname);
  assertPublicWebUrl(url, { addresses: addresses.map((entry) => entry.address) });
  const pinned = addresses.map(({ address }) => ({ address, family: net.isIP(address) }));
  const pinnedLookup = (_host, options, callback) => {
    if (_host !== hostname) return callback(new Error("unexpected transport hostname"));
    if (typeof options === "function") { callback = options; options = {}; }
    const choices = options.family ? pinned.filter((entry) => entry.family === options.family) : pinned;
    if (!choices.length) return callback(new Error("no validated address for requested family"));
    return options.all ? callback(null, choices) : callback(null, choices[0].address, choices[0].family);
  };
  const headers = new Headers(init.headers);
  headers.delete("host"); // caller cannot override the validated origin
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
  const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(init.signal ? [init.signal] : [])]);
  signal.throwIfAborted();
  if (init.body != null && typeof init.body !== "string" && !(init.body instanceof Uint8Array) && !(init.body instanceof URLSearchParams)) throw new TypeError("unsupported public web request body");
  return new Promise((resolve, reject) => {
    const req = (request ?? (url.protocol === "https:" ? https.request : http.request))(url, {
      method: init.method ?? "GET", headers: Object.fromEntries(headers), signal, agent: false, lookup: pinnedLookup,
    }, (res) => {
      const responseHeaders = new Headers();
      for (let i = 0; i < res.rawHeaders.length; i += 2) responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      const status = res.statusCode;
      if (init.method?.toUpperCase() === "HEAD" || [204, 205, 304].includes(status)) { res.resume(); resolve(responseAt(url, null, { status, headers: responseHeaders })); return; }
      const encoding = responseHeaders.get("content-encoding")?.toLowerCase();
      const decode = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
      if (decode) { res.on("error", (error) => decode.destroy(error)); decode.on("close", () => res.destroy()); res.pipe(decode); responseHeaders.delete("content-encoding"); responseHeaders.delete("content-length"); }
      resolve(responseAt(url, Readable.toWeb(decode ?? res), { status, statusText: res.statusMessage, headers: responseHeaders }));
    });
    req.once("error", reject);
    req.end(init.body instanceof URLSearchParams ? init.body.toString() : init.body ?? undefined);
  });
}

export async function publicWebFetch(input, init = {}, transport = {}) {
  let current = new URL(input), requestInit = { ...init };
  for (let hop = 0; ; hop++) {
    const response = await pinnedRequest(current, requestInit, transport);
    if (!redirects.has(response.status) || !response.headers.get("location") || init.redirect === "manual") return response;
    await response.body?.cancel();
    if (init.redirect === "error" || hop >= 5) throw new Error("public web redirect limit or policy");
    const next = new URL(response.headers.get("location"), current), headers = new Headers(requestInit.headers);
    if (next.origin !== current.origin) for (const name of ["authorization", "cookie", "proxy-authorization", "x-api-key", "api-key"]) headers.delete(name);
    if (response.status === 303 || ([301, 302].includes(response.status) && requestInit.method?.toUpperCase() === "POST")) {
      delete requestInit.body; requestInit.method = "GET"; headers.delete("content-type"); headers.delete("content-length");
    }
    requestInit.headers = headers; current = next;
  }
}
