import fs from "node:fs/promises";
import path from "node:path";

import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { canonicalJson } from "../config-runtime/index.mjs";
import { buildArtifactLedger } from "./artifact-ledger.mjs";
import {
  CONTROLLED_PI_VERSION,
  EMBEDDED_NODE_ARCHIVE_SHA256,
  EMBEDDED_NODE_VERSION,
  PREVIEW_VERSION,
  PUBLIC_STACK_PACKAGES,
  finalizeArtifactLedger,
  finalizeStackManifest,
  sha256,
} from "./contracts.mjs";
import { hashFile } from "./deterministic-archive.mjs";
import { createSpdxSbom, renderThirdPartyNotices } from "./sbom.mjs";

const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PI_NAME = "@earendil-works/pi-coding-agent";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function realDirectory(target, code) {
  const stat = await fs.lstat(target).catch(() => null);
  const real = stat ? await fs.realpath(target).catch(() => null) : null;
  if (!stat?.isDirectory() || stat.isSymbolicLink() || real !== path.resolve(target)) fail(code, `payload assembly directory is unsafe: ${path.basename(target)}`);
  return real;
}

async function digestTree(root, relative) {
  return `sha256:${await hashResourcePath({ artifactRoot: root, relativePath: relative, allowContainedSymlinks: true })}`;
}

function idFor(name) {
  return name.replace(/^@/u, "").replaceAll("/", "-").replaceAll(/[^a-z0-9-]/gu, "-");
}

function mergeLedgers(sourceCommit, ledgers) {
  const entries = new Map();
  for (const ledger of ledgers) {
    for (const artifact of ledger.artifacts) {
      const identity = `${artifact.name}@${artifact.version}`;
      const prior = entries.get(identity);
      if (!prior) { entries.set(identity, structuredClone(artifact)); continue; }
      const left = { ...prior, dependencies: [], topLevel: false };
      const right = { ...artifact, dependencies: [], topLevel: false };
      if (canonicalJson(left) !== canonicalJson(right)) fail("LEDGER_DUPLICATE_IDENTITY_DRIFT", `duplicate artifact evidence differs: ${identity}`);
      prior.dependencies = [...new Set([...prior.dependencies, ...artifact.dependencies])].sort();
      prior.topLevel ||= artifact.topLevel;
    }
  }
  return finalizeArtifactLedger({
    $schema: "../../schemas/transitive-artifact-ledger-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-transitive-artifact-ledger",
    sourceCommit,
    artifacts: [...entries.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)),
  });
}

async function writeMetadata(root, { stack, ledger, sbom, notices, installScriptPath, licensesRoot }) {
  await Promise.all([
    fs.writeFile(path.join(root, "stack-manifest.json"), `${JSON.stringify(stack, null, 2)}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(root, "transitive-artifact-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(root, "sbom.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 }),
    fs.writeFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), notices, { mode: 0o600 }),
    fs.copyFile(installScriptPath, path.join(root, "install.sh")),
    fs.cp(licensesRoot, path.join(root, "LICENSES"), { recursive: true, errorOnExist: true, force: false }),
  ]);
  await fs.chmod(path.join(root, "install.sh"), 0o755);
}

export async function assembleReleasePayloads({
  resolvedRoot,
  outputRoot,
  sourceCommit,
  generationTargetGraphDigest,
  piIntegrity,
  artifactBytes,
  artifactTreeRoots,
  integrityOverrides = {},
  installScriptPath,
  licensesRoot,
  licenseOverrides = {},
} = {}) {
  if (![resolvedRoot, outputRoot, installScriptPath, licensesRoot].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new TypeError("payload assembler paths must be absolute");
  if (!COMMIT.test(sourceCommit ?? "") || !DIGEST.test(generationTargetGraphDigest ?? "")) fail("PAYLOAD_ASSEMBLY_IDENTITY_INVALID", "payload assembly source or generation identity is invalid");
  const resolved = await realDirectory(resolvedRoot, "PAYLOAD_ASSEMBLY_ROOT_UNSAFE");
  await Promise.all(["node", "pi", "external-npm"].map((relative) => realDirectory(path.join(resolved, relative), "PAYLOAD_ASSEMBLY_ROOT_UNSAFE")));
  await realDirectory(licensesRoot, "PAYLOAD_LICENSES_UNSAFE");
  if (await fs.lstat(outputRoot).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("PAYLOAD_ASSEMBLY_OUTPUT_EXISTS", "payload assembly output already exists");
  const piLock = await fs.lstat(path.join(resolved, "pi", "npm-shrinkwrap.json")).then(() => path.join(resolved, "pi", "npm-shrinkwrap.json"), () => path.join(resolved, "pi", "package-lock.json"));
  const common = { sourceCommit, artifactBytes, artifactTreeRoots, integrityOverrides, licenseOverrides };
  const [externalLedger, piLedger] = await Promise.all([
    buildArtifactLedger({ ...common, npmRoot: path.join(resolved, "external-npm"), topLevelNames: PUBLIC_STACK_PACKAGES.map((entry) => entry.name) }),
    buildArtifactLedger({
      ...common,
      npmRoot: path.join(resolved, "pi"),
      lockPath: piLock,
      topLevelNames: [PI_NAME],
      rootArtifact: { version: CONTROLLED_PI_VERSION, tarballUrl: `https://registry.npmjs.org/${PI_NAME}/-/pi-coding-agent-${CONTROLLED_PI_VERSION}.tgz`, integrity: piIntegrity },
    }),
  ]);
  const ledger = mergeLedgers(sourceCommit, [externalLedger, piLedger]);
  const byIdentity = new Map(ledger.artifacts.map((entry) => [`${entry.name}@${entry.version}`, entry]));
  const externalPackages = [];
  for (const { name, version } of PUBLIC_STACK_PACKAGES) {
    const artifact = byIdentity.get(`${name}@${version}`);
    if (!artifact) fail("PAYLOAD_ASSEMBLY_ARTIFACT_MISSING", `ledger is missing direct external package: ${name}`);
    externalPackages.push({ id: idFor(name), name, version, integrity: artifact.integrity, license: artifact.license, treeDigest: artifact.treeDigest, binding: "external", owner: "user", lifecycleScripts: artifact.lifecycleScripts });
  }
  const piArtifact = byIdentity.get(`${PI_NAME}@${CONTROLLED_PI_VERSION}`);
  if (!piArtifact || piArtifact.integrity !== piIntegrity) fail("PAYLOAD_ASSEMBLY_PI_MISSING", "ledger is missing the exact controlled Pi artifact");
  const stack = finalizeStackManifest({
    $schema: "../../schemas/stack-manifest-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-stack-manifest",
    sourceCommit,
    onlyMyPi: { version: PREVIEW_VERSION, artifactSha256: await hashFile(path.join(resolved, "only-my-pi.tgz")) },
    platform: { os: "darwin", arch: "arm64", minimumMacOS: "14.0" },
    runtime: {
      node: { version: EMBEDDED_NODE_VERSION, archiveName: `node-v${EMBEDDED_NODE_VERSION}-darwin-arm64.tar.gz`, archiveSha256: EMBEDDED_NODE_ARCHIVE_SHA256, license: "MIT", treeDigest: await digestTree(resolved, "node") },
      pi: { name: PI_NAME, version: CONTROLLED_PI_VERSION, integrity: piIntegrity, treeDigest: await digestTree(resolved, "pi"), entry: "dist/bundle/cli.js" },
    },
    externalPackages,
    externalTreeDigest: await digestTree(resolved, "external-npm"),
    transitiveLedgerSha256: ledger.ledgerDigest,
    generationTargetGraphDigest,
    defaultPreset: "daily",
    overlays: { enabled: ["web", "orchestration-readonly", "ui-terminal"], disabled: ["memory", "sync", "mcp", "experimental"] },
    capabilityCeiling: { mode: "READ_ONLY", maxDepth: 1, writer: false, bash: false, mcp: false },
    policy: { lifecycleScriptsDisabled: true, networkDuringApply: false, externalOwner: "user", webConfirmation: "PER_RUN", browserCookies: false },
    removalPolicy: { preservePreexisting: true, removeOnlyVerifiedProvisioned: true, preserveUserData: true },
  });
  const sbom = createSpdxSbom({ stackManifest: stack, ledger });
  const notices = renderThirdPartyNotices({ stackManifest: stack, ledger });
  const full = path.join(outputRoot, "full");
  const thin = path.join(outputRoot, "thin");
  await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 });
  await fs.cp(resolved, full, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  await fs.mkdir(path.join(thin, "resolution", "external"), { recursive: true, mode: 0o700 });
  await Promise.all([
    fs.copyFile(path.join(resolved, "only-my-pi.tgz"), path.join(thin, "only-my-pi.tgz")),
    fs.copyFile(path.join(resolved, "external-npm", "package.json"), path.join(thin, "resolution", "external", "package.json")),
    fs.copyFile(path.join(resolved, "external-npm", "package-lock.json"), path.join(thin, "resolution", "external", "package-lock.json")),
  ]);
  await Promise.all([full, thin].map((root) => writeMetadata(root, { stack, ledger, sbom, notices, installScriptPath, licensesRoot })));
  return Object.freeze({ ok: true, status: "RELEASE_PAYLOADS_ASSEMBLED", sourceCommit, stackId: stack.stackId, ledgerDigest: ledger.ledgerDigest, fullPayloadRoot: full, thinPayloadRoot: thin, thinResolvedRoot: resolved });
}
