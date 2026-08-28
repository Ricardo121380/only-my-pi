import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { jsonClone, sha256, withoutKey } from "../subagents/state/codec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "../..");
const DEFAULT_SCHEMA = path.join(DEFAULT_ROOT, "schemas", "upstream-compatibility-v1.schema.json");
const DEFAULT_CONTRACT = path.join(DEFAULT_ROOT, "contracts", "compatibility", "upstream-candidates.json");
const INSTALL_LIFECYCLE = Object.freeze(["preinstall", "install", "postinstall"]);

export const M9_REQUIRED_SCOPES = Object.freeze([
  "artifactAudit",
  "extensionSurface",
  "noModelRpc",
  "delegationContract",
  "capabilityCeiling",
  "sessionRuntimeComposition",
  "fiveExecutorMatrix",
  "backgroundCancelResume",
  "webSafety",
  "planModeBehavior",
  "resourceSoak",
  "fullRegression",
  "liveReadOnlyMatrix",
]);

export const M9_EXPECTED_PACKAGES = Object.freeze([
  Object.freeze({
    id: "agent-extensions", name: "pi-agent-extensions", version: "0.5.4",
    sourceSpec: "pi-agent-extensions@0.5.4",
    integrity: "sha512-sMosSp4VHLldOJUxYvcDIThNgx1y0swtqM0vV7kld8nj7T4a0JgUVfS1ticsDZoBcKVLxD+POHFrzlxQ5gDsGQ==",
    requiredEntrypoints: ["extensions/context/index.ts", "extensions/notify/index.ts", "extensions/review/index.ts", "extensions/sessions/index.ts"],
  }),
  Object.freeze({
    id: "lsp", name: "@narumitw/pi-lsp", version: "0.49.6",
    sourceSpec: "@narumitw/pi-lsp@0.49.6",
    integrity: "sha512-ElqBaVyOCF8U4nkdOAxqvU560DsHZwwCm9Riy7He3bFhTsAzjuuXEGaoMYS0fdZCL16Y8heu2L5O1Cgv8SpDFw==",
    requiredEntrypoints: ["dist/index.ts"],
  }),
  Object.freeze({
    id: "pi", name: "@earendil-works/pi-coding-agent", version: "0.84.3",
    sourceSpec: "@earendil-works/pi-coding-agent@0.84.3",
    integrity: "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==",
    requiredEntrypoints: ["dist/bundle/cli.js", "dist/index.js"],
  }),
  Object.freeze({
    id: "plan-mode", name: "@narumitw/pi-plan-mode", version: "0.55.2",
    sourceSpec: "@narumitw/pi-plan-mode@0.55.2",
    integrity: "sha512-JRovIOp8tYMj4WpqMyLVrNaL9oyvE0hlaTSPjAHF1HUN17fmne3dch854FVyUR5LVe9jVoIpERTrs4ZP5vcUzQ==",
    requiredEntrypoints: ["dist/index.ts"],
  }),
  Object.freeze({
    id: "subagents", name: "pi-subagents", version: "0.57.0",
    sourceSpec: "pi-subagents@0.57.0",
    integrity: "sha512-CvsOBp61dZU+HV3kHdfFc+iBuO9DOI5nvTiGrSaFVpH7XK5/22QbBAdjcrhOjcSzA5Ev3l0Qr/JC1I8VLES9Bw==",
    requiredEntrypoints: ["index.ts", "src/api/agents.ts", "src/api/capability-ceiling.ts", "src/api/delegation.ts", "src/extension/rpc.ts"],
  }),
  Object.freeze({
    id: "usage", name: "@sreetej510/pi-usage", version: "0.7.1",
    sourceSpec: "@sreetej510/pi-usage@0.7.1",
    integrity: "sha512-EtVHgahbFL+LcpFve7Ln+RfR9kbm4Wv9YjQsGtfbz67n1pzPa+gMZ4u88YCZ7Lp04/OuHnZNKdmxlzjlrQ3Jig==",
    requiredEntrypoints: ["dist/index.js"],
  }),
  Object.freeze({
    id: "web-access", name: "pi-web-access", version: "0.25.0",
    sourceSpec: "pi-web-access@0.25.0",
    integrity: "sha512-DYOEIMEPwpC6pHElexBy3XuaYPnfMxH0ZBaGrILFsLNQzhhHJ3kJLrCQU4fnKXYXV6OEwxsLt2pBP76koK4hHg==",
    requiredEntrypoints: ["auth-fetch.ts", "index.ts", "ssrf-protection.ts"],
  }),
]);

export class UpstreamCompatibilityError extends Error {
  constructor(message, code, details = {}) {
    super(`M9 upstream compatibility: ${message}`);
    this.name = "UpstreamCompatibilityError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new UpstreamCompatibilityError(message, code, details);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function schemaValidator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(readJson(schemaPath));
}

function exactPackageShape(entry) {
  const { installLifecycleScripts: _ignored, ...comparable } = entry;
  return comparable;
}

function safeEvidencePath(rootDir, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath) || relativePath.includes("\0") || relativePath.split("/").includes("..")) {
    fail(`unsafe evidence path: ${relativePath}`, "UNSAFE_EVIDENCE_PATH");
  }
  const root = fs.realpathSync(rootDir);
  const target = fs.realpathSync(path.resolve(root, relativePath));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`evidence path escapes repository: ${relativePath}`, "UNSAFE_EVIDENCE_PATH");
  return target;
}

function contained(root, target) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) fail("candidate package path escapes installation root", "PACKAGE_ROOT_ESCAPE", { target });
  return target;
}

function regularFile(file, root) {
  const canonicalRoot = fs.realpathSync(root);
  const target = path.resolve(file);
  contained(canonicalRoot, target);
  let current = target;
  while (current !== canonicalRoot) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail("candidate entrypoint ancestry must not contain a symlink", "ENTRYPOINT_UNSAFE", { file });
    current = path.dirname(current);
    if (current === path.dirname(current)) fail("candidate entrypoint ancestry escapes installation root", "ENTRYPOINT_UNSAFE", { file });
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) fail("candidate entrypoint must be a regular non-symlink file", "ENTRYPOINT_UNSAFE", { file });
  const realTarget = fs.realpathSync(target);
  contained(canonicalRoot, realTarget);
  if (realTarget !== target) fail("candidate entrypoint realpath differs from its audited path", "ENTRYPOINT_UNSAFE", { file });
  return target;
}

function packageLockEntry(lock, relativeRoot) {
  if (lock.packages[relativeRoot]) return lock.packages[relativeRoot];
  const suffix = `/${relativeRoot}`;
  const matches = Object.entries(lock.packages).filter(([key]) => key.endsWith(suffix));
  if (matches.length !== 1) fail("candidate package-lock does not identify one exact package entry", "CANDIDATE_LOCK_DRIFT", {
    relativeRoot,
    matchCount: matches.length,
  });
  return matches[0][1];
}

export function upstreamCompatibilityDigest(document) {
  return sha256(withoutKey(withoutKey(document, "$schema"), "contractDigest"));
}

export function validateUpstreamCompatibility(document, {
  rootDir = DEFAULT_ROOT,
  schemaPath = DEFAULT_SCHEMA,
  verifyEvidencePaths = false,
} = {}) {
  const validate = schemaValidator(schemaPath);
  if (!validate(document)) fail("JSON schema validation failed", "UPSTREAM_COMPATIBILITY_SCHEMA_INVALID", { errors: validate.errors ?? [] });
  if (document.contractDigest !== upstreamCompatibilityDigest(document)) fail("contract digest drift detected", "UPSTREAM_COMPATIBILITY_DIGEST_DRIFT");
  if (document.baseline.piVersion !== "0.84.1" || document.baseline.subagentsVersion !== "0.45.2") {
    fail("M9 must preserve the verified Stable baseline", "STABLE_BASELINE_DRIFT");
  }
  if (document.candidate.piVersion !== "0.84.3" || document.candidate.subagentsVersion !== "0.57.0") {
    fail("candidate runtime identity differs from the audited M9 target", "CANDIDATE_RUNTIME_DRIFT");
  }
  const actualPackages = document.candidate.packages;
  const ids = actualPackages.map((entry) => entry.id);
  if (JSON.stringify(ids) !== JSON.stringify(M9_EXPECTED_PACKAGES.map((entry) => entry.id))) {
    fail("candidate packages must use the complete canonical audited order", "CANDIDATE_PACKAGE_SET_DRIFT", { ids });
  }
  for (const [index, expected] of M9_EXPECTED_PACKAGES.entries()) {
    const actual = actualPackages[index];
    if (sha256(exactPackageShape(actual)) !== sha256(expected) || actual.installLifecycleScripts.length !== 0) {
      fail(`candidate package ${expected.id} differs from its exact audit`, "CANDIDATE_PACKAGE_DRIFT", { id: expected.id });
    }
  }
  for (const scopeId of M9_REQUIRED_SCOPES) {
    const scope = document.scopes[scopeId];
    if (verifyEvidencePaths) for (const evidence of scope.evidence) safeEvidencePath(path.resolve(rootDir), evidence);
  }
  const allPass = M9_REQUIRED_SCOPES.every((scopeId) => document.scopes[scopeId].status === "PASS");
  const baselineDefaults = document.decision.defaultPiVersion === document.baseline.piVersion
    && document.decision.defaultSubagentsVersion === document.baseline.subagentsVersion;
  const candidateDefaults = document.decision.defaultPiVersion === document.candidate.piVersion
    && document.decision.defaultSubagentsVersion === document.candidate.subagentsVersion;
  if (document.decision.state === "PROMOTE" && (!allPass || !candidateDefaults)) {
    fail("PROMOTE requires every M9 scope PASS and candidate defaults", "PREMATURE_UPSTREAM_PROMOTION");
  }
  if (document.decision.state !== "PROMOTE" && !baselineDefaults) {
    fail("HOLD or REJECT must retain the Stable default versions", "UNVERIFIED_DEFAULT_VERSION_CHANGE");
  }
  return Object.freeze(jsonClone(document));
}

export function loadUpstreamCompatibility({ rootDir = DEFAULT_ROOT } = {}) {
  const root = path.resolve(rootDir);
  return validateUpstreamCompatibility(readJson(path.join(root, "contracts", "compatibility", "upstream-candidates.json")), { rootDir: root });
}

export function inspectM9CandidateInstallation({ installationRoot, contract } = {}) {
  if (typeof installationRoot !== "string" || !path.isAbsolute(installationRoot) || path.resolve(installationRoot) === path.parse(path.resolve(installationRoot)).root) {
    throw new TypeError("installationRoot must be an explicit absolute non-root directory");
  }
  const checked = validateUpstreamCompatibility(contract ?? readJson(DEFAULT_CONTRACT));
  const root = fs.realpathSync(installationRoot);
  const lockFile = regularFile(path.join(root, "package-lock.json"), root);
  const lock = readJson(lockFile);
  if (![2, 3].includes(lock.lockfileVersion) || typeof lock.packages !== "object" || lock.packages === null) {
    fail("candidate installation lacks a supported package-lock", "CANDIDATE_LOCK_INVALID");
  }
  const packages = [];
  for (const expected of checked.candidate.packages) {
    const relativeRoot = `node_modules/${expected.name}`;
    const packageRoot = contained(root, path.join(root, ...relativeRoot.split("/")));
    const rootStat = fs.lstatSync(packageRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("candidate package root must be a real directory", "PACKAGE_ROOT_UNSAFE", { id: expected.id });
    const realPackageRoot = fs.realpathSync(packageRoot);
    contained(root, realPackageRoot);
    const manifest = readJson(regularFile(path.join(realPackageRoot, "package.json"), root));
    const lockEntry = packageLockEntry(lock, relativeRoot);
    if (manifest.name !== expected.name || manifest.version !== expected.version) fail("candidate disk manifest identity drifted", "CANDIDATE_MANIFEST_DRIFT", { id: expected.id });
    if (lockEntry?.version !== expected.version || lockEntry?.integrity !== expected.integrity || typeof lockEntry?.resolved !== "string" || !lockEntry.resolved.startsWith("https://registry.npmjs.org/")) {
      fail("candidate package-lock provenance drifted", "CANDIDATE_LOCK_DRIFT", { id: expected.id });
    }
    if (lockEntry.hasInstallScript === true) fail("candidate lock marks an install lifecycle script", "CANDIDATE_LIFECYCLE_SCRIPT", { id: expected.id });
    const lifecycleScripts = INSTALL_LIFECYCLE.filter((name) => typeof manifest.scripts?.[name] === "string");
    if (lifecycleScripts.length !== 0) fail("candidate manifest declares an install lifecycle script", "CANDIDATE_LIFECYCLE_SCRIPT", { id: expected.id, lifecycleScripts });
    for (const relativeEntry of expected.requiredEntrypoints) regularFile(path.join(realPackageRoot, ...relativeEntry.split("/")), root);
    packages.push({
      id: expected.id,
      name: expected.name,
      version: expected.version,
      integrity: expected.integrity,
      resolved: lockEntry.resolved,
      requiredEntrypoints: [...expected.requiredEntrypoints],
      installLifecycleScripts: [],
    });
  }
  const result = {
    formatVersion: 1,
    status: "PASS",
    installationRootDigest: sha256(root),
    packages,
  };
  return Object.freeze({ ...result, auditDigest: sha256(result) });
}
