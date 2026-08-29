#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../packages/config-runtime/index.mjs";
import {
  CONTROLLED_PI_VERSION,
  CONTROLLED_PI_INTEGRITY,
  EMBEDDED_NODE_ARCHIVE_SHA256,
  EMBEDDED_NODE_VERSION,
  PREVIEW_TAG,
  PREVIEW_VERSION,
  PUBLIC_REPOSITORY,
  PUBLIC_STACK_PACKAGES,
  finalizeArtifactLedger,
  finalizeStackManifest,
  finalizeStackState,
  packageTupleDigest,
  sha256,
  validateReleaseIndex,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "a".repeat(40);
const SRI = `sha512-${Buffer.alloc(64).toString("base64")}`;

function digest(label) {
  return sha256(label);
}

function idFor(name) {
  return name.replace(/^@/u, "").replaceAll("/", "-").replaceAll(/[^a-z0-9-]/gu, "-");
}

function registryUrl(name, version) {
  const leaf = name.includes("/") ? name.split("/")[1] : name;
  return `https://registry.npmjs.org/${name.replace("/", "%2f")}/-/${leaf}-${version}.tgz`;
}

function ledger() {
  const packages = [{ name: "@earendil-works/pi-coding-agent", version: CONTROLLED_PI_VERSION }, ...PUBLIC_STACK_PACKAGES];
  return finalizeArtifactLedger({
    $schema: "../../schemas/transitive-artifact-ledger-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-transitive-artifact-ledger",
    sourceCommit: SOURCE,
    artifacts: packages.map(({ name, version }) => ({
      name,
      version,
      tarballUrl: registryUrl(name, version),
      integrity: name === "@earendil-works/pi-coding-agent" ? CONTROLLED_PI_INTEGRITY : SRI,
      sha256: digest(`tarball:${name}@${version}`),
      license: "MIT",
      packageManifestDigest: digest(`manifest:${name}@${version}`),
      lifecycleScripts: [],
      dependencies: [],
      treeDigest: digest(`tree:${name}@${version}`),
      topLevel: true,
    })),
  });
}

function manifest(artifactLedger) {
  return finalizeStackManifest({
    $schema: "../../schemas/stack-manifest-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-stack-manifest",
    sourceCommit: SOURCE,
    onlyMyPi: { version: PREVIEW_VERSION, artifactSha256: digest("only-my-pi.tgz") },
    platform: { os: "darwin", arch: "arm64", minimumMacOS: "14.0" },
    runtime: {
      node: {
        version: EMBEDDED_NODE_VERSION,
        archiveName: "node-v24.19.0-darwin-arm64.tar.gz",
        archiveSha256: EMBEDDED_NODE_ARCHIVE_SHA256,
        license: "MIT",
        treeDigest: digest("node-tree"),
      },
      pi: {
        name: "@earendil-works/pi-coding-agent",
        version: CONTROLLED_PI_VERSION,
        integrity: CONTROLLED_PI_INTEGRITY,
        treeDigest: digest("pi-tree"),
        entry: "dist/bundle/cli.js",
      },
    },
    externalPackages: PUBLIC_STACK_PACKAGES.map(({ name, version }) => ({
      id: idFor(name),
      name,
      version,
      integrity: SRI,
      license: "MIT",
      treeDigest: digest(`external:${name}@${version}`),
      binding: "external",
      owner: "user",
      lifecycleScripts: [],
    })),
    externalTreeDigest: digest("external-npm-tree"),
    transitiveLedgerSha256: artifactLedger.ledgerDigest,
    generationTargetGraphDigest: digest("generation-target-graph"),
    defaultPreset: "daily",
    overlays: { enabled: ["web", "orchestration-readonly", "ui-terminal"], disabled: ["memory", "sync", "mcp", "experimental"] },
    capabilityCeiling: { mode: "READ_ONLY", maxDepth: 1, writer: false, bash: false, mcp: false },
    policy: { lifecycleScriptsDisabled: true, networkDuringApply: false, externalOwner: "user", webConfirmation: "PER_RUN", browserCookies: false },
    removalPolicy: { preservePreexisting: true, removeOnlyVerifiedProvisioned: true, preserveUserData: true },
  });
}

function state(stack) {
  return finalizeStackState({
    $schema: "../../schemas/stack-state-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-stack-state",
    status: "INSTALLED",
    activeStack: stack.stackId,
    lkgStack: digest("lkg-stack"),
    manifestDigest: stack.stackId,
    payloadMode: "thin",
    node: { version: EMBEDDED_NODE_VERSION, digest: stack.runtime.node.treeDigest },
    pi: { version: CONTROLLED_PI_VERSION, digest: stack.runtime.pi.treeDigest },
    onlyMyPi: { version: PREVIEW_VERSION, digest: stack.onlyMyPi.artifactSha256 },
    generation: { version: "generation-v1", digest: digest("installed-generation") },
    cliArtifact: { version: PREVIEW_VERSION, digest: stack.onlyMyPi.artifactSha256 },
    shims: {
      omp: { targetClass: "USER_LOCAL_CONTROLLED_STACK", digest: digest("omp-shim") },
      pi: { targetClass: "USER_LOCAL_CONTROLLED_STACK", digest: digest("pi-shim") },
    },
    externalPackages: stack.externalPackages.map(({ name, version, treeDigest }) => ({ name, version, binding: "external", owner: "user", assetDisposition: "PROVISIONED_FOR_USER", treeDigest })),
    transactionIds: ["00000000-0000-4000-8000-000000000001"],
    removalEligibility: { stack: true, externalTree: true, reasonCodes: [] },
  });
}

function releaseIndex(stack) {
  const names = {
    full: `only-my-pi-${PREVIEW_VERSION}-darwin-arm64-full.tar.gz`,
    thin: `only-my-pi-${PREVIEW_VERSION}-darwin-arm64-thin.tar.gz`,
    sbom: `only-my-pi-${PREVIEW_VERSION}.spdx.json`,
    notices: "THIRD_PARTY_NOTICES.txt",
    checksums: "SHA256SUMS",
    receipt: `only-my-pi-${PREVIEW_VERSION}-protected-receipt.json`,
  };
  const document = {
    $schema: "../../schemas/release-index-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-release-index",
    version: PREVIEW_VERSION,
    channel: "preview",
    tag: PREVIEW_TAG,
    sourceCommit: SOURCE,
    repository: PUBLIC_REPOSITORY,
    platform: { os: "darwin", arch: "arm64", minimumMacOS: "14.0" },
    stackManifestSha256: sha256(canonicalJson(stack)),
    bootstrap: { asset: "install.sh", sha256: digest("install.sh") },
    assets: Object.fromEntries(Object.entries(names).map(([key, name], index) => [key, { name, bytes: index + 1, sha256: digest(`asset:${name}`) }])),
    protectedEvidenceDigest: digest("protected-evidence"),
    supportedStack: { nodeVersion: EMBEDDED_NODE_VERSION, piVersion: CONTROLLED_PI_VERSION, packageTupleDigest: packageTupleDigest() },
    status: "RC",
  };
  return validateReleaseIndex(document);
}

function clone(value) {
  return structuredClone(value);
}

function write(relativePath, value) {
  const target = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

const artifactLedger = ledger();
const stack = manifest(artifactLedger);
const stackState = state(stack);
const index = releaseIndex(stack);

const contracts = [
  ["release-index", "contracts/release/release-index.example.json", index],
  ["stack-manifest", "contracts/release/stack-manifest.example.json", stack],
  ["transitive-artifact-ledger", "contracts/release/transitive-artifact-ledger.example.json", artifactLedger],
  ["stack-state", "contracts/release/stack-state.example.json", stackState],
];

for (const [kind, productionPath, positive] of contracts) {
  write(productionPath, positive);
  write(`verification/fixtures/contracts/${kind}/positive.json`, positive);
}

const releaseUnknown = clone(index); releaseUnknown.latest = true;
const releasePlatform = clone(index); releasePlatform.platform.arch = "x64";
write("verification/fixtures/contracts/release-index/negative-unknown-field.json", releaseUnknown);
write("verification/fixtures/contracts/release-index/negative-platform.json", releasePlatform);

const manifestPayload = clone(stack); manifestPayload.payloadMode = "full";
const manifestOwner = clone(stack); manifestOwner.externalPackages[0].owner = "only-my-pi";
write("verification/fixtures/contracts/stack-manifest/negative-payload-mode.json", manifestPayload);
write("verification/fixtures/contracts/stack-manifest/negative-owner.json", manifestOwner);

const ledgerIntegrity = clone(artifactLedger); delete ledgerIntegrity.artifacts[0].integrity;
const ledgerUrl = clone(artifactLedger); ledgerUrl.artifacts[0].tarballUrl = "https://user:pass@registry.npmjs.org/a.tgz";
write("verification/fixtures/contracts/transitive-artifact-ledger/negative-missing-integrity.json", ledgerIntegrity);
write("verification/fixtures/contracts/transitive-artifact-ledger/negative-credential-url.json", ledgerUrl);

const stateUnknown = clone(stackState); stateUnknown.hostPath = "/private/example";
const stateOwner = clone(stackState); stateOwner.externalPackages[0].owner = "only-my-pi";
write("verification/fixtures/contracts/stack-state/negative-unknown-field.json", stateUnknown);
write("verification/fixtures/contracts/stack-state/negative-owner.json", stateOwner);

process.stdout.write(`${JSON.stringify({ ok: true, stackId: stack.stackId, ledgerDigest: artifactLedger.ledgerDigest }, null, 2)}\n`);
