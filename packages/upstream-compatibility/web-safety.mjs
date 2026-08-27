import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { sha256, withoutKey } from "../subagents/state/codec.mjs";
import {
  inspectM9CandidateInstallation,
  loadUpstreamCompatibility,
  M9_EXPECTED_PACKAGES,
  UpstreamCompatibilityError,
} from "./index.mjs";

const WEB_PACKAGE = M9_EXPECTED_PACKAGES.find((entry) => entry.id === "web-access");

function fail(message, code, details) {
  throw new UpstreamCompatibilityError(message, code, details);
}

async function expectBlocked(operation, id) {
  try {
    await operation();
  } catch (error) {
    if (typeof error?.message !== "string" || error.message.length === 0) fail(`candidate Web case ${id} failed without a bounded error`, "M9_WEB_PROBE_INVALID");
    return { id, status: "PASS" };
  }
  fail(`candidate Web case ${id} was not blocked`, "M9_WEB_SSRF_BYPASS", { id });
}

async function defaultModuleLoader(installationRoot) {
  const root = fs.realpathSync(installationRoot);
  const require = createRequire(path.join(root, "package.json"));
  let createJiti;
  try {
    ({ createJiti } = require("jiti"));
  } catch (cause) {
    fail("candidate installation cannot load TypeScript entrypoints", "M9_WEB_LOADER_UNAVAILABLE", { causeName: cause?.name ?? "Error" });
  }
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti.import(path.join(root, "node_modules", "pi-web-access", "ssrf-protection.ts"));
}

export function m9WebSafetyEvidenceDigest(evidence) {
  return sha256(withoutKey(evidence, "evidenceDigest"));
}

export function assertM9WebSafetyEvidence(evidence) {
  const expectedCaseIds = [
    "file-protocol",
    "ipv6-loopback",
    "link-local-metadata",
    "localhost",
    "metadata-hostname",
    "private-10",
    "private-172",
    "private-192",
    "redirect-to-private",
  ];
  if (evidence?.formatVersion !== 1 || evidence?.status !== "PASS" || evidence?.boundary !== "PI_WEB_ACCESS_NO_NETWORK_SSRF_BLACK_BOX") {
    fail("candidate Web evidence shape is invalid", "M9_WEB_EVIDENCE_INVALID");
  }
  if (evidence.artifact?.name !== WEB_PACKAGE.name
    || evidence.artifact?.version !== WEB_PACKAGE.version
    || evidence.artifact?.integrity !== WEB_PACKAGE.integrity) {
    fail("candidate Web evidence artifact identity drifted", "M9_WEB_EVIDENCE_ARTIFACT_DRIFT");
  }
  if (evidence.externalNetworkRequests !== 0
    || evidence.fakeFetchCalls !== 1
    || evidence.policy?.allowBrowserCookies !== false
    || evidence.policy?.authFetch !== false
    || evidence.policy?.trustEnvProxy !== false
    || !Array.isArray(evidence.policy?.allowRanges)
    || evidence.policy.allowRanges.length !== 0) {
    fail("candidate Web evidence boundary drifted", "M9_WEB_EVIDENCE_BOUNDARY_DRIFT");
  }
  const actualCaseIds = evidence.cases?.map((entry) => entry.id).sort();
  if (JSON.stringify(actualCaseIds) !== JSON.stringify(expectedCaseIds)
    || evidence.cases.some((entry) => entry.status !== "PASS")
    || evidence.publicUrl !== "PASS") {
    fail("candidate Web evidence cases are incomplete", "M9_WEB_EVIDENCE_CASE_DRIFT");
  }
  if (typeof evidence.observedAt !== "string" || new Date(evidence.observedAt).toISOString() !== evidence.observedAt) {
    fail("candidate Web evidence timestamp is invalid", "M9_WEB_EVIDENCE_TIME_INVALID");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(evidence.evidenceDigest ?? "") || evidence.evidenceDigest !== m9WebSafetyEvidenceDigest(evidence)) {
    fail("candidate Web evidence digest drifted", "M9_WEB_EVIDENCE_DIGEST_DRIFT");
  }
  return Object.freeze(structuredClone(evidence));
}

export async function runM9WebSafetyProbe({
  installationRoot,
  contract = loadUpstreamCompatibility(),
  moduleLoader = defaultModuleLoader,
  clock = () => new Date(),
} = {}) {
  inspectM9CandidateInstallation({ installationRoot, contract });
  const upstream = await moduleLoader(installationRoot);
  if (typeof upstream?.validateRemoteUrl !== "function" || typeof upstream?.fetchRemoteUrl !== "function") {
    fail("candidate Web SSRF exports are unavailable", "M9_WEB_API_UNAVAILABLE");
  }
  const lookup = async (hostname) => [{
    address: hostname === "internal.example" || hostname === "metadata.google.internal" ? "169.254.169.254" : "93.184.216.34",
    family: 4,
  }];
  const publicUrl = await upstream.validateRemoteUrl("https://example.com/research", {
    lookup,
    allowRanges: [],
    trustEnvProxy: false,
  });
  if (publicUrl.hostname !== "example.com") fail("candidate Web rejected the public control URL", "M9_WEB_PUBLIC_CONTROL_FAILED");
  const cases = [];
  for (const [id, url] of [
    ["file-protocol", "file:///etc/passwd"],
    ["ipv6-loopback", "http://[::1]/"],
    ["link-local-metadata", "http://169.254.169.254/latest/meta-data"],
    ["localhost", "http://localhost/"],
    ["metadata-hostname", "http://metadata.google.internal/"],
    ["private-10", "http://10.0.0.1/"],
    ["private-172", "http://172.16.0.1/"],
    ["private-192", "http://192.168.1.1/"],
  ]) {
    cases.push(await expectBlocked(() => upstream.validateRemoteUrl(url, {
      lookup,
      allowRanges: [],
      trustEnvProxy: false,
    }), id));
  }
  let fakeFetchCalls = 0;
  cases.push(await expectBlocked(() => upstream.fetchRemoteUrl("https://example.com/redirect", {}, {
    lookup,
    allowRanges: [],
    trustEnvProxy: false,
    fetch: async () => {
      fakeFetchCalls += 1;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    },
  }), "redirect-to-private"));
  const result = {
    formatVersion: 1,
    status: "PASS",
    boundary: "PI_WEB_ACCESS_NO_NETWORK_SSRF_BLACK_BOX",
    observedAt: clock().toISOString(),
    artifact: { name: WEB_PACKAGE.name, version: WEB_PACKAGE.version, integrity: WEB_PACKAGE.integrity },
    policy: { allowBrowserCookies: false, authFetch: false, allowRanges: [], trustEnvProxy: false },
    publicUrl: "PASS",
    cases: cases.sort((left, right) => left.id.localeCompare(right.id)),
    fakeFetchCalls,
    externalNetworkRequests: 0,
  };
  return assertM9WebSafetyEvidence({ ...result, evidenceDigest: m9WebSafetyEvidenceDigest(result) });
}
