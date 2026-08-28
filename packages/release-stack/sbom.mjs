import { canonicalJson } from "../config-runtime/index.mjs";
import { PREVIEW_TAG, PUBLIC_REPOSITORY, sha256, validateArtifactLedger, validateStackManifest } from "./contracts.mjs";

const SPDX_ID = /^SPDXRef-[A-Za-z0-9.-]+$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function spdxId(name, version) {
  const suffix = `${name}-${version}`.replaceAll(/[^A-Za-z0-9.-]/gu, "-").replaceAll(/-+/gu, "-");
  return `SPDXRef-Package-${suffix}`;
}

function shaHex(value) {
  return value.replace(/^sha256:/u, "");
}

function sriHex(value) {
  return Buffer.from(value.slice("sha512-".length), "base64").toString("hex");
}

export function createSpdxSbom({ stackManifest, ledger, createdAt = "1970-01-01T00:00:00.000Z" } = {}) {
  const stack = validateStackManifest(stackManifest);
  const artifacts = validateArtifactLedger(ledger);
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) fail("SBOM_CREATED_AT_INVALID", "SBOM creation time must be canonical UTC");
  const packages = artifacts.artifacts.map((entry) => ({
    name: entry.name,
    SPDXID: spdxId(entry.name, entry.version),
    versionInfo: entry.version,
    downloadLocation: entry.tarballUrl,
    filesAnalyzed: false,
    checksums: [
      { algorithm: "SHA256", checksumValue: shaHex(entry.sha256) },
      { algorithm: "SHA512", checksumValue: sriHex(entry.integrity) },
    ],
    licenseConcluded: entry.license,
    licenseDeclared: entry.license,
    copyrightText: "NOASSERTION",
    externalRefs: [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: `pkg:npm/${encodeURIComponent(entry.name).replaceAll("%2F", "/")}@${entry.version}`,
    }],
    primaryPackagePurpose: "LIBRARY",
    comment: `treeDigest=${entry.treeDigest}; manifestDigest=${entry.packageManifestDigest}; lifecycleScriptsExecuted=false`,
  }));
  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `only-my-pi-${stack.onlyMyPi.version}-darwin-arm64`,
    documentNamespace: `https://github.com/${PUBLIC_REPOSITORY}/releases/download/${PREVIEW_TAG}/sbom-${stack.sourceCommit}`,
    creationInfo: {
      created: createdAt,
      creators: ["Tool: only-my-pi-sbom-generator-1"],
      licenseListVersion: "3.26",
    },
    documentDescribes: packages.filter((entry) => artifacts.artifacts.find((artifact) => artifact.name === entry.name && artifact.version === entry.versionInfo)?.topLevel).map((entry) => entry.SPDXID),
    packages,
    relationships: packages.map((entry) => ({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: entry.SPDXID })),
    annotations: [{
      annotationDate: createdAt,
      annotationType: "OTHER",
      annotator: "Tool: only-my-pi-sbom-generator-1",
      comment: `stackId=${stack.stackId}; ledgerDigest=${artifacts.ledgerDigest}`,
    }],
  };
  validateSpdxSbom(document, { stackManifest: stack, ledger: artifacts });
  return Object.freeze(document);
}

export function validateSpdxSbom(input, { stackManifest, ledger } = {}) {
  const stack = validateStackManifest(stackManifest);
  const artifacts = validateArtifactLedger(ledger);
  if (input?.spdxVersion !== "SPDX-2.3" || input.dataLicense !== "CC0-1.0" || input.SPDXID !== "SPDXRef-DOCUMENT") fail("SBOM_IDENTITY_INVALID", "SPDX document identity is invalid");
  if (input.name !== `only-my-pi-${stack.onlyMyPi.version}-darwin-arm64` || !input.documentNamespace.endsWith(`/sbom-${stack.sourceCommit}`)) fail("SBOM_STACK_BINDING_INVALID", "SPDX document is not bound to the stack source");
  if (!Array.isArray(input.packages) || input.packages.length !== artifacts.artifacts.length) fail("SBOM_PACKAGE_COUNT_INVALID", "SPDX package count differs from the artifact ledger");
  const ids = new Set();
  for (const entry of input.packages) {
    if (!SPDX_ID.test(entry?.SPDXID ?? "") || ids.has(entry.SPDXID)) fail("SBOM_PACKAGE_ID_INVALID", "SPDX package IDs must be unique");
    ids.add(entry.SPDXID);
    const artifact = artifacts.artifacts.find((candidate) => candidate.name === entry.name && candidate.version === entry.versionInfo);
    if (!artifact || entry.downloadLocation !== artifact.tarballUrl || entry.filesAnalyzed !== false || entry.licenseDeclared !== artifact.license || entry.licenseConcluded !== artifact.license || entry.licenseConcluded === "NOASSERTION") fail("SBOM_PACKAGE_EVIDENCE_INVALID", `SPDX package evidence drifted: ${entry?.name}`);
    const checksum = Object.fromEntries((entry.checksums ?? []).map((item) => [item.algorithm, item.checksumValue]));
    if (!SHA256_HEX.test(checksum.SHA256 ?? "") || checksum.SHA256 !== shaHex(artifact.sha256) || checksum.SHA512 !== sriHex(artifact.integrity)) fail("SBOM_CHECKSUM_INVALID", `SPDX checksums drifted: ${entry.name}`);
  }
  if (!Array.isArray(input.documentDescribes) || input.documentDescribes.some((id) => !ids.has(id))) fail("SBOM_DESCRIBES_INVALID", "SPDX documentDescribes is invalid");
  if (!Array.isArray(input.relationships) || input.relationships.length !== input.packages.length) fail("SBOM_RELATIONSHIPS_INVALID", "SPDX relationships are incomplete");
  return Object.freeze(structuredClone(input));
}

export function sbomDigest(sbom) {
  return sha256(canonicalJson(sbom));
}

export function renderThirdPartyNotices({ stackManifest, ledger } = {}) {
  const stack = validateStackManifest(stackManifest);
  const artifacts = validateArtifactLedger(ledger);
  const lines = [
    `only-my-pi ${stack.onlyMyPi.version} third-party notices`,
    "",
    "only-my-pi is an independent project and is not affiliated with or endorsed by the Pi or extension authors.",
    "Lifecycle scripts were not executed while constructing this distribution.",
    "The corresponding license texts are shipped in the release LICENSES directory.",
    "",
    `Embedded Node.js ${stack.runtime.node.version} — ${stack.runtime.node.license}`,
    "",
    "Registry artifacts:",
  ];
  for (const entry of artifacts.artifacts) lines.push(`- ${entry.name}@${entry.version} — ${entry.license} — ${entry.sha256}`);
  lines.push("", `Stack identity: ${stack.stackId}`, `Artifact ledger: ${artifacts.ledgerDigest}`, "");
  return lines.join("\n");
}
