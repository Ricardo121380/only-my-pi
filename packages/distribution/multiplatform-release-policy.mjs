import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "../config-runtime/index.mjs";
import { hashFile } from "../release-stack/deterministic-archive.mjs";
import { homebrewFormula } from "./homebrew.mjs";

export const RELEASE_PLATFORMS = Object.freeze(["darwin-arm64", "linux-arm64", "linux-x64"]);
export const MULTIPLATFORM_ASSERTIONS = Object.freeze([
  "npm-node22-lifecycle", "npm-node24-lifecycle", "full-thin-identity", "dependency-complete-startup",
  "models-and-inspect", "coding-approval", "resume-reapproval", "readonly-headless", "readonly-subagents",
  "managed-clone-writer", "project-gates-and-review", "cancel-and-cleanup", "legacy-migration",
  "path-shadow-detection", "unknown-files-preserved",
]);
const HASH = /^sha256:[a-f0-9]{64}$/u;
const requireThat = (condition, message) => { if (!condition) throw new Error(`multiplatform release refused: ${message}`); };
const exact = (object, keys) => object && !Array.isArray(object) && Object.keys(object).sort().join() === [...keys].sort().join();

export function validateMultiplatformEvidence(evidence, receipt, buildReceiptDigest) {
  requireThat(receipt?.status === "MULTIPLATFORM_CANDIDATE_NOT_PUBLISHED" && receipt.version === "0.4.0-preview.2"
    && /^[a-f0-9]{40}$/u.test(receipt.sourceCommit ?? "") && exact(receipt.platforms, RELEASE_PLATFORMS), "complete combined candidate required");
  requireThat(exact(evidence, ["formatVersion", "kind", "status", "version", "sourceCommit", "buildReceiptSha256", "platforms", "evidenceDigest"])
    && evidence.formatVersion === 1 && evidence.kind === "only-my-pi-multiplatform-protected-evidence"
    && evidence.status === "PASS", "new complete protected evidence required");
  requireThat(evidence.version === receipt.version && evidence.sourceCommit === receipt.sourceCommit
    && evidence.buildReceiptSha256 === buildReceiptDigest && HASH.test(buildReceiptDigest), "source or candidate identity differs");
  requireThat(exact(evidence.platforms, RELEASE_PLATFORMS), "all three platform acceptances required");
  for (const platform of RELEASE_PLATFORMS) {
    const item = evidence.platforms[platform];
    requireThat(exact(item, ["distributionId", "assertions"]) && HASH.test(item.distributionId ?? "")
      && item.distributionId === receipt.platforms[platform].distributionId, `${platform} runtime identity differs`);
    const expected = [...MULTIPLATFORM_ASSERTIONS, ...(platform === "darwin-arm64" ? ["homebrew-lifecycle"] : ["strong-sandbox-isolation"])];
    requireThat(Array.isArray(item.assertions) && item.assertions.length === expected.length
      && new Set(item.assertions.map((entry) => entry.id)).size === expected.length, `${platform} assertion set incomplete`);
    for (const id of expected) {
      const assertion = item.assertions.find((entry) => entry.id === id);
      requireThat(exact(assertion, ["id", "status", "evidenceSha256"]) && assertion.status === "PASS"
        && HASH.test(assertion.evidenceSha256 ?? ""), `${platform} missing protected assertion: ${id}`);
    }
  }
  const { evidenceDigest, ...unsigned } = evidence;
  requireThat(evidenceDigest === sha256(canonicalJson(unsigned)), "protected evidence checksum differs");
  return evidence;
}

export async function inspectMultiplatformRelease({ candidateDirectory, receipt, evidence, buildReceiptDigest }) {
  validateMultiplatformEvidence(evidence, receipt, buildReceiptDigest);
  const packageOrder = [...RELEASE_PLATFORMS.map((platform) => `only-my-pi-runtime-${platform}`), "only-my-pi"];
  requireThat(Array.isArray(receipt.artifacts) && receipt.artifacts.length === packageOrder.length, "unexpected npm artifact set");
  for (const name of packageOrder) {
    const items = receipt.artifacts.filter((entry) => entry.name === name);
    const item = items[0];
    requireThat(items.length === 1 && item.version === receipt.version && item.filename === `${name}-${receipt.version}.tgz`
      && HASH.test(item.sha256 ?? ""), "unexpected npm artifact identity");
    requireThat(await hashFile(path.join(candidateDirectory, item.filename)) === item.sha256, "npm artifact bytes differ");
  }
  requireThat(Array.isArray(receipt.archives) && receipt.archives.length === 6, "six Full/Thin archives required");
  for (const platform of RELEASE_PLATFORMS) for (const mode of ["full", "thin"]) {
    const items = receipt.archives.filter((entry) => entry.platform === platform && entry.mode === mode);
    const item = items[0];
    requireThat(items.length === 1 && item.filename === `only-my-pi-${receipt.version}-${platform}-${mode}.tar.gz`
      && item.distributionId === receipt.platforms[platform].distributionId && HASH.test(item.sha256 ?? ""), "archive identity differs");
    requireThat(await hashFile(path.join(candidateDirectory, item.filename)) === item.sha256, "archive bytes differ");
  }
  requireThat(receipt.homebrew?.filename === "only-my-pi.rb" && HASH.test(receipt.homebrew.sha256 ?? ""), "identified Homebrew formula required");
  const formula = path.join(candidateDirectory, "only-my-pi.rb");
  requireThat(await hashFile(formula) === receipt.homebrew.sha256 && await fs.readFile(formula, "utf8") === homebrewFormula(receipt), "Homebrew formula differs");
  return { receipt, evidence, packageOrder };
}
