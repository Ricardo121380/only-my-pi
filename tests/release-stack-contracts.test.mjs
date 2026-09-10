import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactLedgerDigest,
  finalizeStackManifest,
  packageTupleDigest,
  stackManifestDigest,
  validateArtifactLedger,
  validateReleaseIndex,
  validateStackManifest,
  validateStackState,
} from "../packages/release-stack/index.mjs";
import {
  DIRECT_AGENT_CAPABILITY_CEILING,
  DIRECT_AGENT_OVERLAYS,
  DIRECT_AGENT_VERSION,
} from "../packages/direct-agent/product-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

test("release contracts validate the canonical Preview identities", () => {
  const release = validateReleaseIndex(read("contracts/release/release-index.example.json"));
  const manifest = validateStackManifest(read("contracts/release/stack-manifest.example.json"));
  const ledger = validateArtifactLedger(read("contracts/release/transitive-artifact-ledger.example.json"));
  const state = validateStackState(read("contracts/release/stack-state.example.json"));

  assert.equal(release.version, "0.2.0-preview.1");
  assert.equal(release.supportedStack.packageTupleDigest, packageTupleDigest());
  assert.equal(manifest.stackId, stackManifestDigest(manifest));
  assert.equal(ledger.ledgerDigest, artifactLedgerDigest(ledger));
  assert.equal(state.activeStack, manifest.stackId);
  assert.equal(state.payloadMode, "thin");
});

test("stack identity is independent from Full or Thin acquisition", () => {
  const manifest = read("contracts/release/stack-manifest.example.json");
  const unsigned = clone(manifest);
  delete unsigned.stackId;
  const full = finalizeStackManifest(unsigned);
  const thin = finalizeStackManifest(clone(unsigned));
  assert.equal(full.stackId, thin.stackId);
  assert.equal(Object.hasOwn(full, "payloadMode"), false);
});

test("M12 uses a guarded coding stack while retaining read-only M11 validation", () => {
  const legacy = validateStackManifest(read("contracts/release/stack-manifest.example.json"));
  assert.equal(legacy.onlyMyPi.version, "0.2.0-preview.1");
  assert.equal(legacy.capabilityCeiling.mode, "READ_ONLY");

  const current = clone(legacy);
  delete current.stackId;
  current.onlyMyPi.version = DIRECT_AGENT_VERSION;
  current.overlays = structuredClone(DIRECT_AGENT_OVERLAYS);
  current.capabilityCeiling = structuredClone(DIRECT_AGENT_CAPABILITY_CEILING);
  const finalized = finalizeStackManifest(current);
  assert.equal(finalized.onlyMyPi.version, "0.3.0-preview.1");
  assert.equal(finalized.capabilityCeiling.mode, "GUARDED_PROJECT_CODING");
  assert.equal(finalized.capabilityCeiling.writer, true);
  assert.ok(finalized.overlays.enabled.includes("writer"));

  const mismatched = clone(finalized);
  mismatched.capabilityCeiling = clone(legacy.capabilityCeiling);
  mismatched.stackId = stackManifestDigest(mismatched);
  assert.throws(() => validateStackManifest(mismatched), { code: "STACK_CAPABILITY_INVALID" });
});

test("stack manifest fails closed on ownership, tuple, and digest drift", () => {
  const owner = read("contracts/release/stack-manifest.example.json");
  owner.externalPackages[0].owner = "only-my-pi";
  assert.throws(() => validateStackManifest(owner), { code: "STACK_MANIFEST_DIGEST_INVALID" });

  const tuple = read("contracts/release/stack-manifest.example.json");
  tuple.externalPackages[0].version = "9.9.9";
  tuple.stackId = stackManifestDigest(tuple);
  assert.throws(() => validateStackManifest(tuple), { code: "STACK_MANIFEST_PACKAGE_TUPLE_INVALID" });

  const unknown = read("contracts/release/stack-manifest.example.json");
  unknown.payloadMode = "thin";
  assert.throws(() => validateStackManifest(unknown), { code: "STACK_MANIFEST_SCHEMA_INVALID" });
});

test("transitive ledger rejects credentialed URLs and unresolved graph edges", () => {
  const credential = read("contracts/release/transitive-artifact-ledger.example.json");
  credential.artifacts[0].tarballUrl = "https://user:password@registry.npmjs.org/a.tgz";
  credential.ledgerDigest = artifactLedgerDigest(credential);
  assert.throws(() => validateArtifactLedger(credential), { code: "LEDGER_URL_INVALID" });

  const missing = read("contracts/release/transitive-artifact-ledger.example.json");
  missing.artifacts[0].dependencies = ["not-present@1.0.0"];
  missing.ledgerDigest = artifactLedgerDigest(missing);
  assert.throws(() => validateArtifactLedger(missing), { code: "LEDGER_DEPENDENCY_MISSING" });
});

test("transitive ledger refuses missing SRI and direct NOASSERTION licenses", () => {
  const integrity = read("contracts/release/transitive-artifact-ledger.example.json");
  integrity.artifacts[0].integrity = null;
  integrity.ledgerDigest = artifactLedgerDigest(integrity);
  assert.throws(() => validateArtifactLedger(integrity), { code: "LEDGER_ARTIFACT_EVIDENCE_INVALID" });

  const license = read("contracts/release/transitive-artifact-ledger.example.json");
  license.artifacts[0].license = "NOASSERTION";
  license.ledgerDigest = artifactLedgerDigest(license);
  assert.throws(() => validateArtifactLedger(license), { code: "LEDGER_LICENSE_INVALID" });
});

test("release index binds exact tag, channel, repository, and distinct assets", () => {
  const tag = read("contracts/release/release-index.example.json");
  tag.tag = "v0.2.0-preview.2";
  assert.throws(() => validateReleaseIndex(tag), { code: "RELEASE_INDEX_IDENTITY_INVALID" });

  const duplicate = read("contracts/release/release-index.example.json");
  duplicate.assets.thin.name = duplicate.assets.full.name;
  assert.throws(() => validateReleaseIndex(duplicate), { code: "RELEASE_ASSETS_INVALID" });
});

test("stack state preserves user ownership for provisioned external packages", () => {
  const state = read("contracts/release/stack-state.example.json");
  assert.ok(state.externalPackages.every((entry) => entry.binding === "external" && entry.owner === "user"));
  assert.ok(state.externalPackages.every((entry) => entry.assetDisposition === "PROVISIONED_FOR_USER"));

  state.externalPackages[0].assetDisposition = "ONLY_MY_PI_OWNED";
  assert.throws(() => validateStackState(state), { code: "STACK_STATE_OWNERSHIP_INVALID" });
});

test("stack state records whether the external tree is canonical or borrowed", () => {
  const state = read("contracts/release/stack-state.example.json");
  assert.equal(state.externalTree.verificationBasis, "CANONICAL_RELEASE_TREE");
  state.externalTree.verificationBasis = "UNVERIFIED";
  assert.throws(() => validateStackState(state), { code: "STACK_STATE_EXTERNAL_TREE_INVALID" });
});

test("release contracts reject sensitive field names before publication", () => {
  const release = read("contracts/release/release-index.example.json");
  release.assets.full.token = "redacted";
  assert.throws(() => validateReleaseIndex(release), { code: "RELEASE_CONTRACT_SENSITIVE_FIELD" });

  const manifest = read("contracts/release/stack-manifest.example.json");
  manifest.onlyMyPi.secret = "redacted";
  assert.throws(() => validateStackManifest(manifest), { code: "RELEASE_CONTRACT_SENSITIVE_FIELD" });
});
