import path from "node:path";
import { canonicalJson, sha256 } from "../config-runtime/index.mjs";
import { hashFile } from "../release-stack/deterministic-archive.mjs";
import { DISTRIBUTION_VERSION, readRegularJson } from "./runtime.mjs";

export const NATIVE_RELEASE_ASSERTIONS = Object.freeze([
  "npm-node22-lifecycle", "npm-node24-lifecycle", "homebrew-lifecycle",
  "full-thin-identity", "dependency-complete-startup", "models-and-inspect",
  "coding-approval", "resume-reapproval", "readonly-headless", "readonly-subagents",
  "managed-clone-writer", "project-gates-and-review", "cancel-and-cleanup",
  "legacy-migration", "path-shadow-detection",
]);
const HASH = /^sha256:[a-f0-9]{64}$/u;
function requireThat(condition, message) { if (!condition) throw new Error(`native release refused: ${message}`); }
export function validateNativeReleaseEvidence(evidence, receipt, buildReceiptDigest) {
  requireThat(evidence && Object.keys(evidence).sort().join() === ["formatVersion", "kind", "status", "version", "sourceCommit", "distributionId",
    "platform", "buildReceiptSha256", "assertions", "evidenceDigest"].sort().join(), "unexpected protected evidence fields");
  requireThat(evidence?.formatVersion === 1 && evidence.kind === "only-my-pi-native-protected-evidence"
    && evidence.status === "PASS", "new native protected evidence is required");
  requireThat(receipt.version === DISTRIBUTION_VERSION && evidence.version === receipt.version
    && evidence.sourceCommit === receipt.sourceCommit && /^[a-f0-9]{40}$/u.test(evidence.sourceCommit)
    && evidence.distributionId === receipt.distributionId && HASH.test(evidence.distributionId)
    && evidence.buildReceiptSha256 === buildReceiptDigest && HASH.test(buildReceiptDigest), "source or candidate identity differs");
  requireThat(evidence.platform === "darwin-arm64", "this publication gate supports phase one only");
  requireThat(Array.isArray(evidence.assertions) && evidence.assertions.length === NATIVE_RELEASE_ASSERTIONS.length
    && new Set(evidence.assertions.map((entry) => entry.id)).size === NATIVE_RELEASE_ASSERTIONS.length,
  "protected assertion set is incomplete");
  for (const id of NATIVE_RELEASE_ASSERTIONS) {
    const assertion = evidence.assertions.find((entry) => entry.id === id);
    requireThat(assertion?.status === "PASS" && HASH.test(assertion.evidenceSha256 ?? "")
      && Object.keys(assertion).sort().join() === "evidenceSha256,id,status", `missing protected assertion: ${id}`);
  }
  const { evidenceDigest, ...unsigned } = evidence;
  requireThat(evidenceDigest === sha256(canonicalJson(unsigned)), "protected evidence checksum differs");
  return evidence;
}

export async function inspectNativeRelease({ candidateDirectory, evidencePath, sourceCommit }) {
  const receiptFile = path.join(candidateDirectory, "build-receipt.json");
  const receipt = await readRegularJson(receiptFile);
  requireThat(receipt.sourceCommit === sourceCommit, "candidate does not belong to the selected source");
  const evidence = validateNativeReleaseEvidence(await readRegularJson(evidencePath), receipt, await hashFile(receiptFile));
  const expected = ["only-my-pi-runtime-darwin-arm64", "only-my-pi"];
  requireThat(Array.isArray(receipt.artifacts) && receipt.artifacts.length === 2, "unexpected npm package set");
  for (const name of expected) {
    const item = receipt.artifacts.find((entry) => entry.name === name);
    requireThat(item?.version === receipt.version && item.filename === `${name}-${receipt.version}.tgz`
      && HASH.test(item.sha256 ?? ""), "unexpected npm artifact");
    requireThat(await hashFile(path.join(candidateDirectory, item.filename)) === item.sha256, "npm artifact bytes changed");
  }
  requireThat(Array.isArray(receipt.archives) && receipt.archives.length === 2, "Full/Thin artifacts are required");
  for (const mode of ["full", "thin"]) {
    const item = receipt.archives.find((entry) => entry.mode === mode);
    requireThat(item?.filename === `only-my-pi-${receipt.version}-darwin-arm64-${mode}.tar.gz`
      && item.distributionId === receipt.distributionId && HASH.test(item.sha256 ?? ""), "archive identity differs");
    requireThat(await hashFile(path.join(candidateDirectory, item.filename)) === item.sha256, "archive bytes changed");
  }
  return { receipt, evidence, packageOrder: expected };
}
