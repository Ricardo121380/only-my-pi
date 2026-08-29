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
import { M11_PROTECTED_ASSERTION_IDS } from "../scripts/m11-release-gates.mjs";

const execFile = promisify(execFileCallback);

async function git(root, args) {
  const { stdout } = await execFile("git", args, { cwd: root, encoding: "utf8" });
  return stdout.trim();
}

function evidence(sourceCommit) {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-m11-protected-release-evidence",
    gateId: "Q11",
    evidenceId: "m11-protected-final-release-matrix",
    status: "PASS",
    sourceCommit,
    stackId: `sha256:${"1".repeat(64)}`,
    usage: { directlyMeteredTokens: 100, variableCostUsd: 0, wallSeconds: 10, toolCalls: 2, meteredTerminals: 1 },
    assertions: M11_PROTECTED_ASSERTION_IDS.map((id, index) => ({ id, status: "PASS", evidenceSha256: `sha256:${String(index + 1).padStart(64, "0")}` })),
    privacy: { rawPromptsStored: false, rawOutputsStored: false, reasoningStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false },
  };
  document.evidenceDigest = sha256(canonicalJson(document));
  return document;
}

test("release evidence extraction accepts only one direct evidence child of source S", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-m11-evidence-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@users.noreply.github.com"]);
  await fs.writeFile(path.join(root, "source.txt"), "source\n");
  await git(root, ["add", "source.txt"]);
  await git(root, ["commit", "-q", "-m", "source"]);
  const sourceCommit = await git(root, ["rev-parse", "HEAD"]);
  const relative = "verification/protected/q11.json";
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
  assert.equal(result.assertionCount, 20);
  assert.equal(JSON.parse(await fs.readFile(outputPath, "utf8")).sourceCommit, sourceCommit);
  await fs.writeFile(path.join(root, "source.txt"), "dirty\n");
  await assert.rejects(extractM11ReleaseEvidence({ rootDir: root, sourceCommit, evidenceCommit, evidencePath: relative, outputPath: path.join(outputParent, "second.json") }), { code: "M11_RELEASE_EVIDENCE_SOURCE_INVALID" });
});

test("release evidence CLI parser rejects duplicate, unknown and missing values", () => {
  assert.deepEqual(parseM11ReleaseEvidenceArgs(["--source-commit", "a", "--evidence-commit", "b", "--evidence-path", "verification/protected/q11.json", "--output", "/tmp/out", "--json"]), { sourceCommit: "a", evidenceCommit: "b", evidencePath: "verification/protected/q11.json", outputPath: "/tmp/out", json: true });
  assert.throws(() => parseM11ReleaseEvidenceArgs(["--json", "--json"]), { code: "M11_RELEASE_EVIDENCE_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ReleaseEvidenceArgs(["--unknown"]), { code: "M11_RELEASE_EVIDENCE_ARGUMENT_INVALID" });
  assert.throws(() => parseM11ReleaseEvidenceArgs(["--output", "--json"]), { code: "M11_RELEASE_EVIDENCE_ARGUMENT_INVALID" });
});
