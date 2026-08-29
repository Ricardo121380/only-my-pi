import crypto from "node:crypto";

import { canonicalJson } from "../config-runtime/index.mjs";

export const PREVIEW_VERSION = "0.2.0-preview.1";
export const PREVIEW_TAG = `v${PREVIEW_VERSION}`;
export const PUBLIC_REPOSITORY = "Ricardo121380/only-my-pi";
export const EMBEDDED_NODE_VERSION = "24.19.0";
export const EMBEDDED_NODE_ARCHIVE_SHA256 = "sha256:8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d";
export const CONTROLLED_PI_VERSION = "0.84.3";

export const PUBLIC_STACK_PACKAGES = Object.freeze([
  ["@narumitw/pi-plan-mode", "0.55.2"],
  ["pi-agent-extensions", "0.5.4"],
  ["pi-web-access", "0.25.0"],
  ["pi-subagents", "0.57.0"],
  ["pi-permission-modes", "2.2.0"],
  ["@narumitw/pi-lsp", "0.49.6"],
  ["@sreetej510/pi-usage", "0.7.1"],
  ["pi-memory", "0.4.1"],
  ["pi-git-sync", "0.1.3"],
].map(([name, version]) => Object.freeze({ name, version })));

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)$/u;
const DISPOSITIONS = new Set(["PREEXISTING_EXTERNAL", "PROVISIONED_FOR_USER"]);
const LIFECYCLE_NAMES = new Set(["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "prepack", "postpack"]);
const FORBIDDEN_KEYS = /^(?:api.?key|token|secret|password|cookie|authorization|authorization.?header|raw.?prompt|raw.?output|reasoning|host.?path|pid|command.?line|absolute.?path)$/iu;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, expected, label, code = "RELEASE_CONTRACT_SCHEMA_INVALID") {
  if (!plain(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    fail(code, `${label} has an unexpected field set`);
  }
}

function rejectSensitiveShape(value, pointer = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveShape(entry, `${pointer}[${index}]`));
    return;
  }
  if (!plain(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail("RELEASE_CONTRACT_SENSITIVE_FIELD", `forbidden field ${pointer}.${key}`);
    rejectSensitiveShape(child, `${pointer}.${key}`);
  }
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function digestWithout(document, keys) {
  const copy = structuredClone(document);
  for (const key of keys) delete copy[key];
  return sha256(canonicalJson(copy));
}

export function packageTupleDigest(packages = PUBLIC_STACK_PACKAGES) {
  return sha256(canonicalJson(packages.map(({ name, version }) => `${name}@${version}`).sort()));
}

export function stackManifestDigest(document) {
  return digestWithout(document, ["$schema", "stackId"]);
}

export function artifactLedgerDigest(document) {
  return digestWithout(document, ["$schema", "ledgerDigest"]);
}

export function stackStateDigest(document) {
  return digestWithout(document, ["$schema", "stateDigest"]);
}

function assertPackageTuple(packages, { code = "STACK_MANIFEST_PACKAGE_TUPLE_INVALID", requireEvidence = true } = {}) {
  if (!Array.isArray(packages) || packages.length !== PUBLIC_STACK_PACKAGES.length) fail(code, "public stack must contain exactly nine top-level packages");
  const seen = new Set();
  for (const entry of packages) {
    if (!plain(entry) || !PACKAGE_NAME.test(entry.name ?? "") || typeof entry.version !== "string") fail(code, "package identity is invalid");
    const identity = `${entry.name}@${entry.version}`;
    if (seen.has(identity) || [...seen].some((candidate) => candidate.startsWith(`${entry.name}@`))) fail(code, `duplicate package identity: ${entry.name}`);
    seen.add(identity);
    const lifecycleNames = new Set();
    const lifecycleValid = Array.isArray(entry.lifecycleScripts) && entry.lifecycleScripts.every((script) => {
      const valid = plain(script) && canonicalJson(Object.keys(script).sort()) === canonicalJson(["commandSha256", "executed", "name"])
        && LIFECYCLE_NAMES.has(script.name) && SHA256.test(script.commandSha256 ?? "") && script.executed === false && !lifecycleNames.has(script.name);
      lifecycleNames.add(script?.name);
      return valid;
    });
    if (requireEvidence && (!SRI.test(entry.integrity ?? "") || !SHA256.test(entry.treeDigest ?? "") || entry.binding !== "external" || entry.owner !== "user" || !lifecycleValid)) {
      fail(code, `package evidence or ownership is invalid: ${entry.name}`);
    }
  }
  const actual = [...seen].sort();
  const expected = PUBLIC_STACK_PACKAGES.map(({ name, version }) => `${name}@${version}`).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(code, "package tuple does not match the promoted M10 stack");
}

export function validateStackManifest(input) {
  rejectSensitiveShape(input);
  exactKeys(input, ["$schema", "formatVersion", "kind", "stackId", "sourceCommit", "onlyMyPi", "platform", "runtime", "externalPackages", "externalTreeDigest", "transitiveLedgerSha256", "generationTargetGraphDigest", "defaultPreset", "overlays", "capabilityCeiling", "policy", "removalPolicy"], "stack manifest", "STACK_MANIFEST_SCHEMA_INVALID");
  if (input.$schema !== "../../schemas/stack-manifest-v1.schema.json" || input.formatVersion !== 1 || input.kind !== "only-my-pi-stack-manifest") fail("STACK_MANIFEST_IDENTITY_INVALID", "stack manifest identity is invalid");
  if (!COMMIT.test(input.sourceCommit ?? "") || !SHA256.test(input.stackId ?? "") || input.stackId !== stackManifestDigest(input)) fail("STACK_MANIFEST_DIGEST_INVALID", "stack manifest digest is invalid");
  exactKeys(input.onlyMyPi, ["version", "artifactSha256"], "only-my-pi identity", "STACK_MANIFEST_SCHEMA_INVALID");
  if (input.onlyMyPi.version !== PREVIEW_VERSION || !SHA256.test(input.onlyMyPi.artifactSha256 ?? "")) fail("STACK_MANIFEST_OMP_INVALID", "only-my-pi artifact identity is invalid");
  exactKeys(input.platform, ["os", "arch", "minimumMacOS"], "platform", "STACK_MANIFEST_SCHEMA_INVALID");
  if (input.platform.os !== "darwin" || input.platform.arch !== "arm64" || input.platform.minimumMacOS !== "14.0") fail("STACK_PLATFORM_UNSUPPORTED", "stack supports only macOS 14+ arm64");
  exactKeys(input.runtime, ["node", "pi"], "runtime", "STACK_MANIFEST_SCHEMA_INVALID");
  exactKeys(input.runtime.node, ["version", "archiveName", "archiveSha256", "license", "treeDigest"], "Node runtime", "STACK_MANIFEST_SCHEMA_INVALID");
  if (input.runtime.node.version !== EMBEDDED_NODE_VERSION || input.runtime.node.archiveName !== "node-v24.19.0-darwin-arm64.tar.gz" || input.runtime.node.archiveSha256 !== EMBEDDED_NODE_ARCHIVE_SHA256 || input.runtime.node.license !== "MIT" || !SHA256.test(input.runtime.node.treeDigest ?? "")) fail("STACK_NODE_IDENTITY_INVALID", "embedded Node identity is invalid");
  exactKeys(input.runtime.pi, ["name", "version", "integrity", "treeDigest", "entry"], "Pi runtime", "STACK_MANIFEST_SCHEMA_INVALID");
  if (input.runtime.pi.name !== "@earendil-works/pi-coding-agent" || input.runtime.pi.version !== CONTROLLED_PI_VERSION || !SRI.test(input.runtime.pi.integrity ?? "") || !SHA256.test(input.runtime.pi.treeDigest ?? "") || input.runtime.pi.entry !== "dist/bundle/cli.js") fail("STACK_PI_IDENTITY_INVALID", "controlled Pi identity is invalid");
  assertPackageTuple(input.externalPackages);
  if (![input.externalTreeDigest, input.transitiveLedgerSha256, input.generationTargetGraphDigest].every((value) => SHA256.test(value ?? ""))) fail("STACK_MANIFEST_EVIDENCE_INVALID", "stack manifest evidence digest is invalid");
  if (input.defaultPreset !== "daily" || canonicalJson(input.overlays) !== canonicalJson({ enabled: ["web", "orchestration-readonly", "ui-terminal"], disabled: ["memory", "sync", "mcp", "experimental"] })) fail("STACK_PROFILE_INVALID", "public stack profile or overlays drifted");
  if (canonicalJson(input.capabilityCeiling) !== canonicalJson({ mode: "READ_ONLY", maxDepth: 1, writer: false, bash: false, mcp: false })) fail("STACK_CAPABILITY_INVALID", "public stack is not read-only");
  if (canonicalJson(input.policy) !== canonicalJson({ lifecycleScriptsDisabled: true, networkDuringApply: false, externalOwner: "user", webConfirmation: "PER_RUN", browserCookies: false })) fail("STACK_POLICY_INVALID", "stack security policy drifted");
  if (canonicalJson(input.removalPolicy) !== canonicalJson({ preservePreexisting: true, removeOnlyVerifiedProvisioned: true, preserveUserData: true })) fail("STACK_REMOVAL_POLICY_INVALID", "stack removal policy drifted");
  rejectSensitiveShape(input);
  return Object.freeze(structuredClone(input));
}

export function finalizeStackManifest(input) {
  const document = { ...structuredClone(input), stackId: "sha256:" + "0".repeat(64) };
  document.stackId = stackManifestDigest(document);
  return validateStackManifest(document);
}

function validateRegistryUrl(raw) {
  let url;
  try { url = new URL(raw); }
  catch { fail("LEDGER_URL_INVALID", "artifact tarball URL is invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.username || url.password || url.hash || url.search || !url.pathname.endsWith(".tgz")) {
    fail("LEDGER_URL_INVALID", "artifact tarball URL must be credential-free registry.npmjs.org HTTPS");
  }
}

export function validateArtifactLedger(input) {
  rejectSensitiveShape(input);
  exactKeys(input, ["$schema", "formatVersion", "kind", "sourceCommit", "artifacts", "ledgerDigest"], "artifact ledger", "LEDGER_SCHEMA_INVALID");
  if (input.$schema !== "../../schemas/transitive-artifact-ledger-v1.schema.json" || input.formatVersion !== 1 || input.kind !== "only-my-pi-transitive-artifact-ledger" || !COMMIT.test(input.sourceCommit ?? "")) fail("LEDGER_IDENTITY_INVALID", "artifact ledger identity is invalid");
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0 || input.artifacts.length > 4096) fail("LEDGER_ARTIFACTS_INVALID", "artifact ledger must be bounded and non-empty");
  const identities = new Set();
  for (const entry of input.artifacts) {
    exactKeys(entry, ["name", "version", "tarballUrl", "integrity", "sha256", "license", "packageManifestDigest", "lifecycleScripts", "dependencies", "treeDigest", "topLevel"], "ledger artifact", "LEDGER_SCHEMA_INVALID");
    const identity = `${entry.name}@${entry.version}`;
    if (!PACKAGE_NAME.test(entry.name ?? "") || identities.has(identity)) fail("LEDGER_ARTIFACT_IDENTITY_INVALID", `invalid or duplicate ledger artifact: ${identity}`);
    identities.add(identity);
    validateRegistryUrl(entry.tarballUrl);
    if (!SRI.test(entry.integrity ?? "") || ![entry.sha256, entry.packageManifestDigest, entry.treeDigest].every((value) => SHA256.test(value ?? ""))) fail("LEDGER_ARTIFACT_EVIDENCE_INVALID", `artifact evidence is incomplete: ${identity}`);
    if (typeof entry.license !== "string" || entry.license.trim() === "" || entry.license === "NOASSERTION") fail("LEDGER_LICENSE_INVALID", `artifact license is unresolved: ${identity}`);
    if (!Array.isArray(entry.lifecycleScripts) || entry.lifecycleScripts.some((script) => script?.executed !== false || !SHA256.test(script?.commandSha256 ?? ""))) fail("LEDGER_LIFECYCLE_INVALID", `artifact lifecycle audit is invalid: ${identity}`);
    if (!Array.isArray(entry.dependencies) || new Set(entry.dependencies).size !== entry.dependencies.length) fail("LEDGER_DEPENDENCIES_INVALID", `artifact dependencies are invalid: ${identity}`);
  }
  for (const entry of input.artifacts) for (const dependency of entry.dependencies) if (!identities.has(dependency)) fail("LEDGER_DEPENDENCY_MISSING", `missing transitive artifact: ${dependency}`);
  if (!SHA256.test(input.ledgerDigest ?? "") || input.ledgerDigest !== artifactLedgerDigest(input)) fail("LEDGER_DIGEST_INVALID", "artifact ledger digest is invalid");
  rejectSensitiveShape(input);
  return Object.freeze(structuredClone(input));
}

export function finalizeArtifactLedger(input) {
  const document = { ...structuredClone(input), ledgerDigest: "sha256:" + "0".repeat(64) };
  document.ledgerDigest = artifactLedgerDigest(document);
  return validateArtifactLedger(document);
}

export function validateReleaseIndex(input) {
  rejectSensitiveShape(input);
  exactKeys(input, ["$schema", "formatVersion", "kind", "version", "channel", "tag", "sourceCommit", "repository", "platform", "stackManifestSha256", "bootstrap", "assets", "protectedEvidenceDigest", "supportedStack", "status"], "release index", "RELEASE_INDEX_SCHEMA_INVALID");
  if (input.$schema !== "../../schemas/release-index-v1.schema.json" || input.formatVersion !== 1 || input.kind !== "only-my-pi-release-index" || input.version !== PREVIEW_VERSION || input.tag !== PREVIEW_TAG || input.channel !== "preview" || input.repository !== PUBLIC_REPOSITORY || !COMMIT.test(input.sourceCommit ?? "")) fail("RELEASE_INDEX_IDENTITY_INVALID", "release index identity is invalid");
  if (canonicalJson(input.platform) !== canonicalJson({ os: "darwin", arch: "arm64", minimumMacOS: "14.0" })) fail("RELEASE_PLATFORM_INVALID", "release platform is invalid");
  if (!SHA256.test(input.stackManifestSha256 ?? "") || !SHA256.test(input.protectedEvidenceDigest ?? "") || input.bootstrap?.asset !== "install.sh" || !SHA256.test(input.bootstrap?.sha256 ?? "")) fail("RELEASE_INDEX_EVIDENCE_INVALID", "release index evidence is incomplete");
  const assets = Object.values(input.assets ?? {});
  if (assets.length !== 6 || new Set(assets.map((entry) => entry?.name)).size !== 6 || assets.some((entry) => !Number.isSafeInteger(entry?.bytes) || entry.bytes < 1 || entry.bytes > 2_147_483_648 || !SHA256.test(entry?.sha256 ?? ""))) fail("RELEASE_ASSETS_INVALID", "release assets are invalid or duplicated");
  if (input.supportedStack?.nodeVersion !== EMBEDDED_NODE_VERSION || input.supportedStack?.piVersion !== CONTROLLED_PI_VERSION || input.supportedStack?.packageTupleDigest !== packageTupleDigest()) fail("RELEASE_STACK_TUPLE_INVALID", "release stack tuple is invalid");
  if (!["RC", "PUBLISHED"].includes(input.status)) fail("RELEASE_STATUS_INVALID", "release status is invalid");
  rejectSensitiveShape(input);
  return Object.freeze(structuredClone(input));
}

export function validateStackState(input) {
  rejectSensitiveShape(input);
  exactKeys(input, ["$schema", "formatVersion", "kind", "status", "activeStack", "lkgStack", "manifestDigest", "payloadMode", "node", "pi", "onlyMyPi", "generation", "cliArtifact", "shims", "externalPackages", "transactionIds", "removalEligibility", "stateDigest"], "stack state", "STACK_STATE_SCHEMA_INVALID");
  if (input.$schema !== "../../schemas/stack-state-v1.schema.json" || input.formatVersion !== 1 || input.kind !== "only-my-pi-stack-state" || !["INSTALLED", "INTERRUPTED", "REMOVED"].includes(input.status) || !["full", "thin"].includes(input.payloadMode)) fail("STACK_STATE_IDENTITY_INVALID", "stack state identity is invalid");
  if (input.status !== "REMOVED" && ![input.activeStack, input.manifestDigest].every((value) => SHA256.test(value ?? ""))) fail("STACK_STATE_ACTIVE_INVALID", "active stack identity is missing");
  if (input.status === "REMOVED" && input.activeStack !== null) fail("STACK_STATE_REMOVED_INVALID", "removed state cannot retain an active stack");
  for (const key of ["node", "pi", "onlyMyPi", "generation", "cliArtifact"]) if (typeof input[key]?.version !== "string" || !SHA256.test(input[key]?.digest ?? "")) fail("STACK_STATE_ASSET_INVALID", `stack state ${key} identity is invalid`);
  assertPackageTuple(input.externalPackages, { code: "STACK_STATE_PACKAGE_TUPLE_INVALID", requireEvidence: false });
  for (const entry of input.externalPackages) if (entry.binding !== "external" || entry.owner !== "user" || !DISPOSITIONS.has(entry.assetDisposition) || !SHA256.test(entry.treeDigest ?? "")) fail("STACK_STATE_OWNERSHIP_INVALID", `stack state ownership is invalid: ${entry.name}`);
  if (!SHA256.test(input.stateDigest ?? "") || input.stateDigest !== stackStateDigest(input)) fail("STACK_STATE_DIGEST_INVALID", "stack state digest is invalid");
  rejectSensitiveShape(input);
  return Object.freeze(structuredClone(input));
}

export function finalizeStackState(input) {
  const document = { ...structuredClone(input), stateDigest: "sha256:" + "0".repeat(64) };
  document.stateDigest = stackStateDigest(document);
  return validateStackState(document);
}
