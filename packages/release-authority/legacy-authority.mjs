import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson } from "../config-runtime/index.mjs";
import { protectedEvidenceDigest } from "../subagents/release/protected-evidence.mjs";

export const LEGACY_AUTHORITY_PATH = "verification/legacy-authority-v1.json";
export const LEGACY_SNAPSHOT_COMMIT = "f182760aa968057266c8d001b9a28d876da8f0c2";

const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const LEGACY_PREFIXES = Object.freeze([
  "verification/evidence/",
  "verification/protected/",
  "verification/receipts/",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function digestDocument(document) {
  if (document?.$schema && document?.attestation) return protectedEvidenceDigest(document);
  const unsigned = { ...document };
  delete unsigned.evidenceDigest;
  return sha256(canonicalJson(unsigned));
}

function internalDigest(document) {
  if (!SHA256.test(document?.evidenceDigest ?? "")) {
    return Object.freeze({ status: "NOT_APPLICABLE", field: null, declared: null });
  }
  const computed = digestDocument(document);
  return Object.freeze({
    status: computed === document.evidenceDigest ? "PASS" : "FAIL",
    field: "evidenceDigest",
    declared: document.evidenceDigest,
  });
}

function git(rootDir, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function legacyPaths(rootDir, snapshotCommit) {
  const output = git(rootDir, ["ls-tree", "-r", "--name-only", snapshotCommit, "--", ...LEGACY_PREFIXES]);
  return output.split("\n")
    .filter((entry) => entry.endsWith(".json") && LEGACY_PREFIXES.some((prefix) => entry.startsWith(prefix)))
    .sort();
}

function claimType(relativePath) {
  if (relativePath.startsWith("verification/protected/")) return "PROTECTED_EVIDENCE";
  if (relativePath.startsWith("verification/evidence/")) return "DETERMINISTIC_EVIDENCE";
  return "COMPLETION_RECEIPT";
}

function snapshotEntry(rootDir, snapshotCommit, relativePath) {
  const bytes = git(rootDir, ["show", `${snapshotCommit}:${relativePath}`], "buffer");
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { fail("LEGACY_DOCUMENT_INVALID", `legacy document is not JSON: ${relativePath}`); }
  const digest = internalDigest(document);
  if (digest.status === "FAIL") fail("LEGACY_INTERNAL_DIGEST_INVALID", `legacy internal digest no longer validates: ${relativePath}`);
  return Object.freeze({
    path: relativePath,
    fileSha256: sha256(bytes),
    originalClaimType: claimType(relativePath),
    originalSourceCommit: FULL_SHA.test(document.sourceCommit ?? "") ? document.sourceCommit : null,
    originalEvidenceCommit: FULL_SHA.test(document.evidenceCommit ?? "") ? document.evidenceCommit : null,
    originalStatus: typeof document.status === "string"
      ? document.status
      : document.passed === true
        ? "PASS"
        : document.passed === false
          ? "FAIL"
          : "UNSPECIFIED",
    internalDigest: digest,
    gitAuthority: Object.freeze({
      directChildStatus: "UNAVAILABLE_AFTER_REWRITE",
      reason: "SOURCE_COMMIT_REWRITTEN_FOR_EMAIL_PRIVACY",
    }),
    currentReleaseAuthority: false,
  });
}

function registryDigest(document) {
  const unsigned = { ...document };
  delete unsigned.$schema;
  delete unsigned.registryDigest;
  return sha256(canonicalJson(unsigned));
}

export function buildLegacyAuthorityRegistry({ rootDir, snapshotCommit = LEGACY_SNAPSHOT_COMMIT } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("buildLegacyAuthorityRegistry requires an absolute rootDir");
  if (!FULL_SHA.test(snapshotCommit)) fail("LEGACY_SNAPSHOT_INVALID", "legacy snapshot commit must be a full SHA");
  try { git(rootDir, ["cat-file", "-e", `${snapshotCommit}^{commit}`]); }
  catch { fail("LEGACY_SNAPSHOT_INVALID", "legacy snapshot commit is unavailable"); }
  const entries = legacyPaths(rootDir, snapshotCommit).map((relativePath) => snapshotEntry(rootDir, snapshotCommit, relativePath));
  if (entries.length === 0) fail("LEGACY_REGISTRY_EMPTY", "legacy authority registry cannot be empty");
  const registry = {
    $schema: "../schemas/legacy-authority-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-legacy-authority",
    authorityClass: "LEGACY_PRIVATE_HISTORY",
    currentReleaseAuthority: false,
    retirementReason: "SOURCE_COMMIT_REWRITTEN_FOR_EMAIL_PRIVACY",
    replacementAuthority: "public-baseline-v1",
    legacySnapshotCommit: snapshotCommit,
    legacySnapshotTree: git(rootDir, ["rev-parse", `${snapshotCommit}^{tree}`]).trim(),
    entries,
  };
  registry.registryDigest = registryDigest(registry);
  return Object.freeze(registry);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    fail("LEGACY_REGISTRY_SCHEMA_INVALID", `${label} has an unexpected field set`);
  }
}

export function validateLegacyAuthorityRegistry(input, { rootDir } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("validateLegacyAuthorityRegistry requires an absolute rootDir");
  exactKeys(input, ["$schema", "formatVersion", "kind", "authorityClass", "currentReleaseAuthority", "retirementReason", "replacementAuthority", "legacySnapshotCommit", "legacySnapshotTree", "entries", "registryDigest"], "legacy registry");
  if (input.$schema !== "../schemas/legacy-authority-v1.schema.json" || input.formatVersion !== 1 || input.kind !== "only-my-pi-legacy-authority"
    || input.authorityClass !== "LEGACY_PRIVATE_HISTORY" || input.currentReleaseAuthority !== false
    || input.retirementReason !== "SOURCE_COMMIT_REWRITTEN_FOR_EMAIL_PRIVACY" || input.replacementAuthority !== "public-baseline-v1"
    || input.legacySnapshotCommit !== LEGACY_SNAPSHOT_COMMIT || !FULL_SHA.test(input.legacySnapshotTree ?? "")
    || !SHA256.test(input.registryDigest ?? "") || input.registryDigest !== registryDigest(input)) {
    fail("LEGACY_REGISTRY_IDENTITY_INVALID", "legacy registry identity or digest is invalid");
  }
  const expected = buildLegacyAuthorityRegistry({ rootDir, snapshotCommit: input.legacySnapshotCommit });
  if (canonicalJson(expected) !== canonicalJson(input)) fail("LEGACY_REGISTRY_DRIFT", "legacy registry differs from the immutable snapshot");
  const paths = new Set();
  for (const entry of input.entries) {
    if (paths.has(entry.path)) fail("LEGACY_REGISTRY_DUPLICATE", `duplicate legacy path: ${entry.path}`);
    paths.add(entry.path);
    const target = path.resolve(rootDir, entry.path);
    const relative = path.relative(path.resolve(rootDir), target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) fail("LEGACY_PATH_UNSAFE", `legacy path escapes repository: ${entry.path}`);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) fail("LEGACY_PATH_UNSAFE", `legacy path is not a bounded regular file: ${entry.path}`);
    if (sha256(fs.readFileSync(target)) !== entry.fileSha256) fail("LEGACY_FILE_DRIFT", `legacy file bytes changed: ${entry.path}`);
  }
  const internalDigestPassed = input.entries.filter((entry) => entry.internalDigest.status === "PASS").length;
  return Object.freeze({
    ok: true,
    status: "LEGACY_PASS_NOT_CURRENT_AUTHORITY",
    authorityClass: input.authorityClass,
    currentReleaseAuthority: false,
    entryCount: input.entries.length,
    internalDigestPassed,
    internalDigestNotApplicable: input.entries.length - internalDigestPassed,
    registryDigest: input.registryDigest,
  });
}

export function inspectLegacyAuthority({ rootDir } = {}) {
  const target = path.resolve(rootDir, LEGACY_AUTHORITY_PATH);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail("LEGACY_REGISTRY_PATH_UNSAFE", "legacy registry must be a bounded regular file");
  return validateLegacyAuthorityRegistry(JSON.parse(fs.readFileSync(target, "utf8")), { rootDir });
}
