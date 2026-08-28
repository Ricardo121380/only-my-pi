import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

export const M10_EXACT_PACKAGE_TARGET = Object.freeze([
  Object.freeze({ id: "agent-extensions", name: "pi-agent-extensions", fromVersion: "0.5.2", toVersion: "0.5.4", action: "upgrade", fromIntegrity: "sha512-1WLN9KTlOrOcPK26jctDkxjww6Msm4nNLinJTuRxEaVwWS1SsBMom2Zi2iBEYwdiSWc8kG57jmNuJ+1VcFZp/A==", toIntegrity: "sha512-sMosSp4VHLldOJUxYvcDIThNgx1y0swtqM0vV7kld8nj7T4a0JgUVfS1ticsDZoBcKVLxD+POHFrzlxQ5gDsGQ==", lifecycleScripts: [] }),
  Object.freeze({ id: "git-sync", name: "pi-git-sync", fromVersion: "0.1.3", toVersion: "0.1.3", action: "retain", fromIntegrity: "sha512-/kc/ZyD/St2SP8C4c7RMHPRirbKI/Tm3lx3gjf1L5RfGkmHZ7ww+BZfM7gW8p04fnxK6JLpOQUXMtCgUWXAeAA==", toIntegrity: "sha512-/kc/ZyD/St2SP8C4c7RMHPRirbKI/Tm3lx3gjf1L5RfGkmHZ7ww+BZfM7gW8p04fnxK6JLpOQUXMtCgUWXAeAA==", lifecycleScripts: [] }),
  Object.freeze({ id: "lsp", name: "@narumitw/pi-lsp", fromVersion: "0.49.4", toVersion: "0.49.6", action: "upgrade", fromIntegrity: "sha512-RA0XAVAdck8W2gm2Do67C/IrCRUBJkKWPawZg1QqvlfEH9TMZbrGBYOgvGYcnGuRQ3FyxxFgJSq0fbdpMW8KAQ==", toIntegrity: "sha512-ElqBaVyOCF8U4nkdOAxqvU560DsHZwwCm9Riy7He3bFhTsAzjuuXEGaoMYS0fdZCL16Y8heu2L5O1Cgv8SpDFw==", lifecycleScripts: [] }),
  Object.freeze({ id: "memory", name: "pi-memory", fromVersion: "0.4.1", toVersion: "0.4.1", action: "retain", fromIntegrity: "sha512-p5h32q3LO9wy2g8DM7uQZl+0NnhZfaU+qyDQhEExD1fAYC9tf2tYZ5OQuh756tfaxEw3DONsT5zEHG9xB/Gg+g==", toIntegrity: "sha512-p5h32q3LO9wy2g8DM7uQZl+0NnhZfaU+qyDQhEExD1fAYC9tf2tYZ5OQuh756tfaxEw3DONsT5zEHG9xB/Gg+g==", lifecycleScripts: [{ name: "postinstall", commandSha256: "sha256:9fb2978bb4dfeb2719e77a68d657788c06408485f81390b06d29dcb33176994f", necessity: "not-required" }] }),
  Object.freeze({ id: "permission-modes", name: "pi-permission-modes", fromVersion: "2.2.0", toVersion: "2.2.0", action: "retain", fromIntegrity: "sha512-y4n110DiN99xl2tyLLU7ZyMadZUOYvxm9YKEpoZo2vFF4QJIgV7RKBAI6KztaRayAWPhA+95FdIBcV0He8vyfw==", toIntegrity: "sha512-y4n110DiN99xl2tyLLU7ZyMadZUOYvxm9YKEpoZo2vFF4QJIgV7RKBAI6KztaRayAWPhA+95FdIBcV0He8vyfw==", lifecycleScripts: [{ name: "postinstall", commandSha256: "sha256:2339ab6db8e67f0e2c8616f1fb3c57c972942ba15776090acd4fbefce4f33338", necessity: "not-required" }] }),
  Object.freeze({ id: "plan-mode", name: "@narumitw/pi-plan-mode", fromVersion: "0.49.3", toVersion: "0.55.2", action: "upgrade", fromIntegrity: "sha512-6yJoJ2nXsvnXAaEzr1iQlpUMqOFnDX+rMYVRXE/uV6OVmeB1AxFr9jm0H8N+1jr7Q0WebjtVSNE6dTOwaBGurA==", toIntegrity: "sha512-JRovIOp8tYMj4WpqMyLVrNaL9oyvE0hlaTSPjAHF1HUN17fmne3dch854FVyUR5LVe9jVoIpERTrs4ZP5vcUzQ==", lifecycleScripts: [] }),
  Object.freeze({ id: "subagents", name: "pi-subagents", fromVersion: "0.45.2", toVersion: "0.57.0", action: "upgrade", fromIntegrity: "sha512-VEvBF6vrpi+eLEjhgwqutSnaH/aw58+Um9vdJUc6Td1asH22bAKahrgD3AafaRNsROgiaukw4DRdmlRjEhBxQA==", toIntegrity: "sha512-CvsOBp61dZU+HV3kHdfFc+iBuO9DOI5nvTiGrSaFVpH7XK5/22QbBAdjcrhOjcSzA5Ev3l0Qr/JC1I8VLES9Bw==", lifecycleScripts: [] }),
  Object.freeze({ id: "usage", name: "@sreetej510/pi-usage", fromVersion: "0.4.5", toVersion: "0.7.1", action: "upgrade", fromIntegrity: "sha512-D/vmdkfIQeqKOuMEgZtcFQPDc2SZcLIwipByrQHHeGAVw5aOBGmfD9hMzYLAny+7eGuGpuXZxGtAgS3PrKuu/Q==", toIntegrity: "sha512-EtVHgahbFL+LcpFve7Ln+RfR9kbm4Wv9YjQsGtfbz67n1pzPa+gMZ4u88YCZ7Lp04/OuHnZNKdmxlzjlrQ3Jig==", lifecycleScripts: [] }),
  Object.freeze({ id: "web-access", name: "pi-web-access", fromVersion: "0.20.0", toVersion: "0.25.0", action: "upgrade", fromIntegrity: "sha512-jMHiNe6hGQYmblSJsYBA2HdGuEe2sOM1GSVvVRMESwJoPvdfClaln6NlRD0/SOfBo1PiLCD1OUQhSrW4gMF3vQ==", toIntegrity: "sha512-DYOEIMEPwpC6pHElexBy3XuaYPnfMxH0ZBaGrILFsLNQzhhHJ3kJLrCQU4fnKXYXV6OEwxsLt2pBP76koK4hHg==", lifecycleScripts: [] }),
]);

export const M10_ARTIFACT_NAMES = Object.freeze([
  "bundle-receipt.json",
  "external-npm-tree.tgz",
  "external-package-lock.json",
  "only-my-pi.tgz",
  "pi-candidate.tgz",
]);

export class UpstreamMigrationError extends Error {
  constructor(message, code, details = {}) {
    super(`M10 upstream migration: ${message}`);
    this.name = "UpstreamMigrationError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new UpstreamMigrationError(message, code, details);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function migrationDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function bytesDigest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function manifestDigest(manifest) {
  const unsigned = structuredClone(manifest);
  delete unsigned.manifestDigest;
  return migrationDigest(unsigned);
}

function schemaValidator(schema) {
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

export async function loadMigrationSchema(rootDir) {
  const target = path.join(path.resolve(rootDir), "schemas", "upstream-migration-v1.schema.json");
  return JSON.parse(await fs.readFile(target, "utf8"));
}

function assertExactTarget(manifest) {
  if (manifest.from.piVersion !== "0.84.1" || manifest.from.subagentsVersion !== "0.45.2"
    || manifest.to.piVersion !== "0.84.3" || manifest.to.subagentsVersion !== "0.57.0") {
    fail("runtime versions differ from the audited M9 tuple", "MIGRATION_RUNTIME_DRIFT");
  }
  if (manifest.piArtifact.name !== "@earendil-works/pi-coding-agent" || manifest.piArtifact.version !== "0.84.3"
    || manifest.piArtifact.integrity !== "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==") {
    fail("Pi artifact differs from the audited M9 candidate", "MIGRATION_PI_ARTIFACT_DRIFT");
  }
  if (manifest.onlyMyPiArtifact.sha256 !== manifest.artifacts["only-my-pi.tgz"]
    || manifest.piArtifact.sha256 !== manifest.artifacts["pi-candidate.tgz"]) {
    fail("primary artifact references differ from the canonical bundle entries", "MIGRATION_BUNDLE_ARTIFACT_DRIFT");
  }
  const actualIds = manifest.externalPackages.map((entry) => entry.id);
  const expectedIds = M10_EXACT_PACKAGE_TARGET.map((entry) => entry.id);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) fail("external package target must use the canonical complete order", "MIGRATION_PACKAGE_SET_DRIFT");
  for (const [index, expected] of M10_EXACT_PACKAGE_TARGET.entries()) {
    const actual = manifest.externalPackages[index];
    if (actual.name !== expected.name || actual.fromVersion !== expected.fromVersion || actual.toVersion !== expected.toVersion
      || actual.action !== expected.action || actual.fromIntegrity !== expected.fromIntegrity || actual.toIntegrity !== expected.toIntegrity
      || actual.sourceSpec !== `npm:${expected.name}@${expected.toVersion}`
      || actual.binding !== "external" || actual.owner !== "user"
      || JSON.stringify(actual.lifecycleScripts) !== JSON.stringify(expected.lifecycleScripts)) {
      fail(`external package ${expected.id} differs from the exact M10 target`, "MIGRATION_PACKAGE_DRIFT", { id: expected.id });
    }
  }
  if (manifest.policy.ignoreScripts !== true || manifest.policy.allowLifecycleScripts !== false
    || manifest.policy.requirePiStopped !== true || manifest.policy.preserveExternalOwnership !== true
    || manifest.policy.networkDuringApply !== false) {
    fail("migration policy widened the approved authority", "MIGRATION_POLICY_DRIFT");
  }
}

export async function validateMigrationManifest(manifest, { rootDir } = {}) {
  const schema = await loadMigrationSchema(rootDir);
  const validate = schemaValidator(schema);
  if (!validate(manifest)) fail("manifest JSON schema validation failed", "MIGRATION_SCHEMA_INVALID", { errors: validate.errors ?? [] });
  if (!FULL_SHA.test(manifest.sourceCommit) || !SHA256.test(manifest.candidateGraphDigest)) fail("manifest source or graph identity is invalid", "MIGRATION_IDENTITY_INVALID");
  if (manifest.manifestDigest !== manifestDigest(manifest)) fail("manifest digest drifted", "MIGRATION_MANIFEST_DIGEST_DRIFT");
  assertExactTarget(manifest);
  return Object.freeze(structuredClone(manifest));
}

async function readBundleFile(bundlePath, maximum) {
  if (typeof bundlePath !== "string" || !path.isAbsolute(bundlePath) || path.resolve(bundlePath) === path.parse(path.resolve(bundlePath)).root) {
    throw new TypeError("bundlePath must be an explicit absolute non-root path");
  }
  let handle;
  try {
    handle = await fs.open(path.resolve(bundlePath), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(maximum)) fail("bundle must be a bounded regular file", "MIGRATION_BUNDLE_FILE_INVALID");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || BigInt(bytes.length) !== after.size) {
      fail("bundle changed while being read", "MIGRATION_BUNDLE_CHANGED");
    }
    return { bytes, sha256: bytesDigest(bytes), size: bytes.length };
  } catch (error) {
    if (error?.code === "ELOOP") fail("bundle path may not be a symlink", "MIGRATION_BUNDLE_SYMLINK");
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function inspectMigrationBundle({ bundlePath, rootDir, maxBundleBytes = MAX_BUNDLE_BYTES } = {}) {
  const file = await readBundleFile(bundlePath, maxBundleBytes);
  let bundle;
  try { bundle = JSON.parse(file.bytes.toString("utf8")); } catch (cause) { fail("bundle is not valid JSON", "MIGRATION_BUNDLE_INVALID", { cause }); }
  if (bundle?.formatVersion !== 1 || bundle.kind !== "only-my-pi-upstream-migration-bundle" || !Array.isArray(bundle.artifacts)
    || JSON.stringify(Object.keys(bundle).sort()) !== JSON.stringify(["artifacts", "formatVersion", "kind", "manifest"])) {
    fail("bundle envelope is invalid", "MIGRATION_BUNDLE_INVALID");
  }
  const manifest = await validateMigrationManifest(bundle.manifest, { rootDir });
  const names = bundle.artifacts.map((entry) => entry.name);
  if (JSON.stringify(names) !== JSON.stringify(M10_ARTIFACT_NAMES)) fail("bundle artifact set differs from the complete canonical set", "MIGRATION_BUNDLE_ARTIFACT_SET_DRIFT");
  const artifacts = [];
  for (const entry of bundle.artifacts) {
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["base64", "bytes", "name", "sha256"])
      || typeof entry.base64 !== "string" || !SHA256.test(entry.sha256 ?? "") || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) {
      fail(`bundle artifact ${entry.name} metadata is invalid`, "MIGRATION_BUNDLE_ARTIFACT_INVALID");
    }
    const bytes = Buffer.from(entry.base64, "base64");
    if (bytes.toString("base64") !== entry.base64 || bytes.length !== entry.bytes || bytesDigest(bytes) !== entry.sha256) fail(`bundle artifact ${entry.name} digest drifted`, "MIGRATION_BUNDLE_ARTIFACT_DRIFT");
    if (manifest.artifacts[entry.name] !== entry.sha256) fail(`manifest does not bind bundle artifact ${entry.name}`, "MIGRATION_BUNDLE_ARTIFACT_DRIFT");
    artifacts.push(Object.freeze({ name: entry.name, bytes: entry.bytes, sha256: entry.sha256 }));
  }
  return Object.freeze({
    formatVersion: 1,
    status: "MIGRATION_BUNDLE_VERIFIED",
    bundle: Object.freeze({ path: path.resolve(bundlePath), bytes: file.size, sha256: file.sha256 }),
    manifest,
    artifacts: Object.freeze(artifacts),
    zeroWriteEvidence: Object.freeze({ writes: 0, subprocesses: 0, providerRequests: 0 }),
  });
}

export function createMigrationManifest(input) {
  const manifest = structuredClone(input);
  delete manifest.manifestDigest;
  manifest.manifestDigest = manifestDigest(manifest);
  return manifest;
}
