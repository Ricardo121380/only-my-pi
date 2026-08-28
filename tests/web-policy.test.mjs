import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertPublicRedirect, assertPublicWebUrl, createWebRunAuthorizer, inspectPublicWebPolicy } from "../packages/web-policy/index.mjs";

async function root(t, document) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-web-policy-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  if (document !== undefined) await fs.writeFile(path.join(configRoot, "web-search.json"), `${JSON.stringify(document)}\n`);
  return configRoot;
}

test("safe missing or explicit Web config resolves PUBLIC_WEB_SSRF_GUARDED", async (t) => {
  const configRoot = await root(t, { allowBrowserCookies: false, autoOpenBrowser: false, workflow: "none", ssrf: { allowRanges: [], trustEnvProxy: false } });
  const result = await inspectPublicWebPolicy({ configRoot, environment: {} });
  assert.equal(result.ok, true);
  assert.equal(result.status, "PUBLIC_WEB_SSRF_GUARDED");
});

test("cookies, authFetch, browser launch, proxy bypass, allow ranges and custom headers block Web runs", async (t) => {
  const configRoot = await root(t, { allowBrowserCookies: true, authFetch: { docs: ["docs.example.com"] }, autoOpenBrowser: true, ssrf: { allowRanges: ["198.18.0.0/15"], trustEnvProxy: true }, searxngHeaders: { Authorization: "secret" } });
  const result = await inspectPublicWebPolicy({ configRoot, environment: {} });
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.findings.map((finding) => finding.code)), new Set(["BROWSER_COOKIES_FORBIDDEN", "WEB_CONFIG_FIELD_FORBIDDEN", "AUTO_OPEN_BROWSER_FORBIDDEN", "SSRF_PROXY_BYPASS_FORBIDDEN", "SSRF_ALLOW_RANGES_FORBIDDEN", "CUSTOM_HEADERS_FORBIDDEN"]));
  assert.ok(result.findings.some((finding) => finding.path === "web-search.authFetch"));
});

test("public URL guard blocks loopback private link-local metadata and redirect-to-private", () => {
  assert.equal(assertPublicWebUrl("https://example.com/page", { addresses: ["93.184.216.34"] }).hostname, "example.com");
  for (const url of ["http://127.0.0.1", "http://10.0.0.1", "http://169.254.169.254", "http://192.168.1.2", "http://[::1]", "http://metadata.google.internal"]) {
    assert.throws(() => assertPublicWebUrl(url), { code: "PUBLIC_WEB_SSRF_BLOCKED" });
  }
  assert.throws(() => assertPublicWebUrl("file:///etc/passwd"), { code: "PUBLIC_WEB_URL_FORBIDDEN" });
  assert.throws(() => assertPublicRedirect("https://example.com", "http://127.0.0.1/admin", { from: { addresses: ["93.184.216.34"] } }), { code: "PUBLIC_WEB_SSRF_BLOCKED" });
});

test("Web authorization is bound to session, run, roles, objective and budget", async (t) => {
  const configRoot = await root(t, { allowBrowserCookies: false, autoOpenBrowser: false, ssrf: { allowRanges: [], trustEnvProxy: false } });
  let sessionId = "web-session-one";
  const authorizer = createWebRunAuthorizer({ configRoot, getSessionId: () => sessionId });
  const plan = await authorizer.plan({ runId: "goal-run", roles: ["source-verifier", "researcher"], objectiveDigest: "sha256:" + "a".repeat(64), budget: { maxCostUsd: 0.25 }, providerIds: ["opencode-go"] });
  assert.equal(plan.status, "PUBLIC_WEB_CONFIRMATION_REQUIRED");
  assert.deepEqual(plan.roles, ["researcher", "source-verifier"]);
  assert.throws(() => authorizer.require("goal-run:r0", "researcher"), { code: "PUBLIC_WEB_AUTHORIZATION_REQUIRED" });
  assert.equal((await authorizer.grant(plan)).status, "PUBLIC_WEB_AUTHORIZED");
  assert.equal(authorizer.require("goal-run:r0", "researcher").authorizationDigest, plan.authorizationDigest);
  assert.equal(authorizer.require("goal-run:r0:r1", "source-verifier").authorizationDigest, plan.authorizationDigest);
  assert.throws(() => authorizer.require("goal-run:r0", "reviewer"), { code: "PUBLIC_WEB_AUTHORIZATION_REQUIRED" });
  sessionId = "web-session-two";
  assert.throws(() => authorizer.require("goal-run", "researcher"), { code: "PUBLIC_WEB_AUTHORIZATION_REQUIRED" });
});
