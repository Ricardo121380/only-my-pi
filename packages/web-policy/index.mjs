import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";

const SENSITIVE_HEADER_KEY = /(?:header|authorization|cookie)/iu;
const CONFIG_FORBIDDEN_KEYS = new Set(["authFetch", "chromeProfile", "curatorRemote"]);

function fail(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); throw error; }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function containsForbiddenConfig(value, location = "web-search") {
  if (Array.isArray(value)) return value.flatMap((entry, index) => containsForbiddenConfig(entry, `${location}[${index}]`));
  if (!object(value)) return [];
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    const here = `${location}.${key}`;
    if (SENSITIVE_HEADER_KEY.test(key) && /header/iu.test(key)) findings.push({ code: "CUSTOM_HEADERS_FORBIDDEN", path: here });
    if (CONFIG_FORBIDDEN_KEYS.has(key) && child !== undefined && child !== null && child !== false) findings.push({ code: "WEB_CONFIG_FIELD_FORBIDDEN", path: here });
    findings.push(...containsForbiddenConfig(child, here));
  }
  return findings;
}

async function readConfig(configRoot) {
  const target = path.join(configRoot, "web-search.json");
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) fail("WEB_CONFIG_INVALID", "web-search.json must be a bounded regular file");
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") return {};
    if (cause instanceof SyntaxError) fail("WEB_CONFIG_INVALID", "web-search.json is not valid JSON");
    if (["ELOOP", "EMLINK"].includes(cause?.code)) fail("WEB_CONFIG_UNSAFE", "web-search.json may not be a symlink");
    throw cause;
  } finally { await handle?.close().catch(() => {}); }
}

export async function inspectPublicWebPolicy({ configRoot, environment = process.env } = {}) {
  if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("inspectPublicWebPolicy requires absolute configRoot");
  const config = await readConfig(path.resolve(configRoot));
  if (!object(config)) fail("WEB_CONFIG_INVALID", "web-search.json root must be an object");
  const findings = containsForbiddenConfig(config);
  if (config.allowBrowserCookies === true || environment.PI_ALLOW_BROWSER_COOKIES === "1" || environment.FEYNMAN_ALLOW_BROWSER_COOKIES === "1") findings.push({ code: "BROWSER_COOKIES_FORBIDDEN", path: "allowBrowserCookies" });
  if (config.autoOpenBrowser === true) findings.push({ code: "AUTO_OPEN_BROWSER_FORBIDDEN", path: "autoOpenBrowser" });
  if (config.ssrf?.trustEnvProxy === true) findings.push({ code: "SSRF_PROXY_BYPASS_FORBIDDEN", path: "ssrf.trustEnvProxy" });
  if (Array.isArray(config.ssrf?.allowRanges) && config.ssrf.allowRanges.length > 0) findings.push({ code: "SSRF_ALLOW_RANGES_FORBIDDEN", path: "ssrf.allowRanges" });
  const ok = findings.length === 0;
  return Object.freeze({
    ok,
    status: ok ? "PUBLIC_WEB_SSRF_GUARDED" : "PUBLIC_WEB_POLICY_BLOCKED",
    mutation: false,
    browserCookies: false,
    autoOpenBrowser: false,
    ssrf: { allowRanges: [], trustEnvProxy: false, redirectRevalidation: "dependency-required" },
    findings: Object.freeze(findings),
  });
}

function ipv4Parts(address) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}
function blockedIpv4(address) {
  const p = ipv4Parts(address);
  if (!p) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}
function blockedIpv6(address) {
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export function assertPublicWebUrl(rawUrl, { addresses = [] } = {}) {
  let url;
  try { url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl); } catch { fail("PUBLIC_WEB_URL_INVALID", "Web URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("PUBLIC_WEB_URL_FORBIDDEN", "only credential-free HTTP(S) URLs are allowed");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") fail("PUBLIC_WEB_SSRF_BLOCKED", `blocked internal hostname ${hostname}`);
  const values = net.isIP(hostname) ? [hostname] : addresses;
  if (!net.isIP(hostname) && (!Array.isArray(values) || values.length === 0)) fail("PUBLIC_WEB_DNS_EVIDENCE_REQUIRED", "resolved address evidence is required before public Web access");
  for (const address of values) {
    const family = net.isIP(address);
    if (family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true) fail("PUBLIC_WEB_SSRF_BLOCKED", `blocked private or reserved address ${address}`);
  }
  return url;
}

export function assertPublicRedirect(fromUrl, toUrl, options = {}) {
  assertPublicWebUrl(fromUrl, options.from ?? options);
  return assertPublicWebUrl(new URL(toUrl, fromUrl), options.to ?? options);
}

function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`; }
function rootRunId(runId) { return String(runId).replace(/(?::r\d+|:planner:\d+|:verifier:\d+)+$/u, ""); }

export class WebRunAuthorizer {
  constructor({ configRoot, getSessionId } = {}) {
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("WebRunAuthorizer requires absolute configRoot");
    if (typeof getSessionId !== "function") throw new TypeError("WebRunAuthorizer requires getSessionId()");
    this.configRoot = path.resolve(configRoot);
    this.getSessionId = getSessionId;
    this.grants = new Map();
  }
  async plan({ runId, roles, objectiveDigest, budget, providerIds = [] } = {}) {
    const sessionId = this.getSessionId();
    if (typeof sessionId !== "string" || !sessionId) fail("PI_SESSION_ID_UNAVAILABLE", "Web run authorization requires a Pi session id");
    if (typeof runId !== "string" || !runId) fail("WEB_RUN_ID_INVALID", "Web run id is required");
    if (!Array.isArray(roles) || roles.length < 1 || roles.some((role) => !["researcher", "source-verifier"].includes(role))) fail("WEB_ROLE_INVALID", "Web authority may be granted only to researcher or source-verifier");
    const policy = await inspectPublicWebPolicy({ configRoot: this.configRoot });
    if (!policy.ok) fail("PUBLIC_WEB_POLICY_BLOCKED", "Web configuration violates only-my-pi public Web policy", { findings: policy.findings });
    const payload = {
      formatVersion: 1,
      sessionId,
      runId: rootRunId(runId),
      objectiveDigest,
      roles: [...new Set(roles)].sort(),
      providerIds: [...new Set(providerIds)].sort(),
      budget: canonical(budget ?? {}),
      policyStatus: policy.status,
      cookies: false,
    };
    return Object.freeze({ ok: true, status: "PUBLIC_WEB_CONFIRMATION_REQUIRED", mutation: false, ...payload, authorizationDigest: digest(payload), warning: "Task text will be sent to public internet providers; cookies and private destinations remain blocked." });
  }
  async grant(plan) {
    const current = await this.plan(plan);
    if (current.authorizationDigest !== plan?.authorizationDigest) fail("WEB_AUTHORIZATION_DRIFT", "Web authorization plan changed before confirmation");
    this.grants.set(`${current.sessionId}:${current.runId}`, current);
    return Object.freeze({ ok: true, status: "PUBLIC_WEB_AUTHORIZED", mutation: true, runId: current.runId, authorizationDigest: current.authorizationDigest, expires: "run-or-session" });
  }
  require(runId, role) {
    const sessionId = this.getSessionId();
    const grant = this.grants.get(`${sessionId}:${rootRunId(runId)}`);
    if (!grant || !grant.roles.includes(role)) fail("PUBLIC_WEB_AUTHORIZATION_REQUIRED", `Web role ${role} is not authorized for run ${rootRunId(runId)}`);
    return grant;
  }
  reset(runId = null) {
    const sessionId = this.getSessionId();
    if (runId !== null) return this.grants.delete(`${sessionId}:${rootRunId(runId)}`);
    let removed = false;
    for (const key of [...this.grants.keys()]) if (key.startsWith(`${sessionId}:`)) { this.grants.delete(key); removed = true; }
    return removed;
  }
  dispose() { this.grants.clear(); }
}

export function createWebRunAuthorizer(options = {}) { return new WebRunAuthorizer(options); }
