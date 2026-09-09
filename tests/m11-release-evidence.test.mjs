import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { canonicalJson } from "../packages/config-runtime/index.mjs";
import { sha256 } from "../packages/release-stack/index.mjs";
import { extractM11ReleaseEvidence, parseM11ReleaseEvidenceArgs } from "../scripts/m11-release-evidence.mjs";
import { M12_PROTECTED_ASSERTIONS } from "../scripts/m12-direct-coding-gates.mjs";

const execFile = promisify(execFileCallback);

async function git(root, args) {
  const { stdout } = await execFile("git", args, { cwd: root, encoding: "utf8" });
  return stdout.trim();
}

function evidence(sourceCommit) {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-m12-protected-local-evidence",
    status: "PASS",
    sourceCommit,
    productVersion: "0.3.0-preview.1",
    stackId: `sha256:${"1".repeat(64)}`,
    installedGenerationId: `sha256:${"2".repeat(64)}`,
    artifactSha256: `sha256:${"3".repeat(64)}`,
    usage: { directlyMeteredTokens: 100, variableCostUsd: 0, wallSeconds: 10, toolCalls: 2, meteredTerminals: 1 },
    assertions: Object.entries(M12_PROTECTED_ASSERTIONS).flatMap(([gateId, ids]) => ids.map((id) => ({ gateId, id, status: "PASS", evidenceSha256: sha256(`${gateId}:${id}`) }))),
    privacy: { rawPromptsStored: false, rawOutputsStored: false, reasoningStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false, credentialsRead: false },
  };
  document.evidenceDigest = sha256(canonicalJson(document));
  return document;
}

test("release evidence extraction accepts the direct C11/C12 evidence child of source S", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-m11-evidence-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@users.noreply.github.com"]);
  await fs.writeFile(path.join(root, "source.txt"), "source\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.3.0-preview.1" }));
  await git(root, ["add", "source.txt", "package.json"]);
  await git(root, ["commit", "-q", "-m", "source"]);
  const sourceCommit = await git(root, ["rev-parse", "HEAD"]);
  const relative = "verification/protected/coding.json";
  await fs.mkdir(path.join(root, "verification", "protected"), { recursive: true });
  await fs.writeFile(path.join(root, relative), `${JSON.stringify(evidence(sourceCommit), null, 2)}\n`);
  await git(root, ["add", relative]);
  await git(root, ["commit", "-q", "-m", "evidence"]);
  const evidenceCommit = await git(root, ["rev-parse", "HEAD"]);
  await git(root, ["checkout", "-q", sourceCommit]);
  const outputParent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-m11-evidence-output-")));
  t.after(() => fs.rm(outputParent, { recursive: true, force: true }));
  const outputPath = path.join(outputParent, "receipt.json");
  const result = await extractM11ReleaseEvidence({ rootDir: root, sourceCommit, evidenceCommit, evidencePath: relative, outputPath });
  assert.equal(result.status, "M11_RELEASE_EVIDENCE_EXTRACTED");
  assert.equal(result.assertionCount, 26);
  assert.equal(result.productVersion, "0.3.0-preview.1");
  assert.equal(JSON.parse(await fs.readFile(outputPath, "utf8")).sourceCommit, sourceCommit);
  await assert.rejects(extractM11ReleaseEvidence({ rootDir: root, sourceCommit, evidenceCommit, evidencePath: relative, outputPath }), { code: "M11_RELEASE_EVIDENCE_OUTPUT_INVALID" });

  await git(root, ["checkout", "-q", evidenceCommit]);
  const legacy = { ...evidence(sourceCommit), kind: "only-my-pi-m11-protected-release-evidence" };
  delete legacy.evidenceDigest;
  legacy.evidenceDigest = sha256(canonicalJson(legacy));
  await fs.writeFile(path.join(root, relative), JSON.stringify(legacy));
  await git(root, ["add", relative]);
  await git(root, ["commit", "-q", "--amend", "--no-edit"]);
  const legacyCommit = await git(root, ["rev-parse", "HEAD"]);
  await git(root, ["checkout", "-q", sourceCommit]);
  await assert.rejects(extractM11ReleaseEvidence({ rootDir: root, sourceCommit, evidenceCommit: legacyCommit, evidencePath: relative, outputPath: path.join(outputParent, "legacy.json") }), { code: "M12_PROTECTED_EVIDENCE_INVALID" });

  await git(root, ["checkout", "-q", evidenceCommit]);
  await git(root, ["commit", "-q", "--allow-empty", "-m", "indirect child"]);
  const indirectCommit = await git(root, ["rev-parse", "HEAD"]);
  await git(root, ["checkout", "-q", sourceCommit]);
  await assert.rejects(extractM11ReleaseEvidence({ rootDir: root, sourceCommit, evidenceCommit: indirectCommit, evidencePath: relative, outputPath: path.join(outputParent, "indirect.json") }), { code: "M11_RELEASE_EVIDENCE_COMMIT_INVALID" });
  await fs.writeFile(path.join(root, "source.txt"), "dirty\n");
  await assert.rejects(extractM11ReleaseEvidence({ rootDir: root, sourceCommit, evidenceCommit, evidencePath: relative, outputPath: path.join(outputParent, "second.json") }), { code: "M11_RELEASE_EVIDENCE_SOURCE_INVALID" });
});

test("release evidence CLI parser rejects duplicate, unknown and missing values", () => {
  assert.deepEqual(parseM11ReleaseEvidenceArgs(["--source-commit", "a", "--evidence-commit", "b", "--evidence-path", "verification/protected/q11.json", "--output", "/tmp/out", "--json"]), { sourceCommit: "a", evidenceCommit: "b", evidencePath: "verification/protected/q11.json", outputPath: "/tmp/out", json: true });
  assert.throws(() => parseM11ReleaseEvidenceArgs(["--json", "--json"]), { code: "M11_RELEASE_EVIDENCE_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ReleaseEvidenceArgs(["--unknown"]), { code: "M11_RELEASE_EVIDENCE_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ReleaseEvidenceArgs(["--output", "--json"]), { code: "M11_RELEASE_EVIDENCE_ARGUMENT_INVALID" });
});
