#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createReleaseBuildController, createReleasePayloadStager, createThinPayloadResolver, hashFile, sha256 } from "../packages/release-stack/index.mjs";
import { runM11MacosNoModelAcceptance } from "./m11-macos-no-model-acceptance.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function sourceCommit(rootDir) {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }),
    execFile("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: rootDir, encoding: "utf8" }),
  ]);
  const commit = head.trim();
  if (!COMMIT.test(commit) || status.trim() !== "") fail("Q10_CI_SOURCE_NOT_CLEAN", "Q10 CI requires a clean exact source commit");
  return commit;
}

export async function runM11Q10Ci({
  rootDir = ROOT,
  workParent = os.tmpdir(),
  inspectSource = sourceCommit,
  stager = createReleasePayloadStager({ rootDir }),
  thinResolver = createThinPayloadResolver(),
  controller = createReleaseBuildController({ rootDir }),
  acceptance = runM11MacosNoModelAcceptance,
} = {}) {
  const commit = await inspectSource(rootDir);
  const parent = await fs.realpath(workParent);
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(parent, "only-my-pi-q10-ci-")));
  await fs.chmod(workspace, 0o700);
  try {
    const stageRoot = path.join(workspace, "stage");
    const stageOptions = { sourceCommit: commit, outputRoot: stageRoot };
    const stagePlan = await stager.plan(stageOptions);
    const staged = await stager.apply(stageOptions, stagePlan);
    const [stackManifest, ledger] = await Promise.all([
      fs.readFile(path.join(staged.thinPayloadRoot, "stack-manifest.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(staged.thinPayloadRoot, "transitive-artifact-ledger.json"), "utf8").then(JSON.parse),
    ]);
    const thinResolvedRoot = await thinResolver({ payloadRoot: staged.thinPayloadRoot, cacheRoot: workspace, inspection: { stackManifest }, metadata: { ledger } });
    const receiptPath = path.join(workspace, "q10-ci-receipt.json");
    const rehearsalReceipt = { formatVersion: 1, kind: "only-my-pi-q10-ci-build-receipt", status: "Q10_CI_BUILD_NOT_RELEASE_AUTHORITY", sourceCommit: commit, stackId: staged.stackId, claims: { protectedLiveMatrix: false, publicationAuthority: false } };
    await fs.writeFile(receiptPath, `${JSON.stringify(rehearsalReceipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    const releaseRoot = path.join(workspace, "release");
    const buildOptions = { fullPayloadRoot: staged.fullPayloadRoot, thinPayloadRoot: staged.thinPayloadRoot, thinResolvedRoot, protectedReceiptPath: receiptPath, protectedEvidenceDigest: await hashFile(receiptPath), outputRoot: releaseRoot, sourceCommit: commit, status: "RC" };
    const buildPlan = await controller.plan(buildOptions);
    const built = await controller.apply(buildOptions, buildPlan);
    const accepted = await acceptance({ releaseRoot });
    if (accepted.status !== "Q10_MACOS_ARM64_NO_MODEL_PASSED" || accepted.stackId !== staged.stackId || built.stackId !== staged.stackId) fail("Q10_CI_IDENTITY_MISMATCH", "Q10 CI staging, build and clean-home identities differ");
    return Object.freeze({ formatVersion: 1, ok: true, status: "Q10_CI_PASSED", sourceCommit: commit, stackId: staged.stackId, reproducible: built.reproducible, acceptanceStatus: accepted.status, providerRequests: 0, published: false, retainedAssets: false, resultDigest: sha256(JSON.stringify({ sourceCommit: commit, stackId: staged.stackId, outputDigest: built.outputDigest, acceptanceReceipt: accepted.receiptDigest })) });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== "--json") fail("Q10_CI_ARGUMENT_INVALID", "Q10 CI accepts only --json");
  const result = await runM11Q10Ci();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${JSON.stringify({ ok: false, status: "Q10_CI_FAILED", code: error?.code ?? "Q10_CI_FAILED", message: error?.message, errorDigest: sha256(String(error?.stack ?? error)) }, null, 2)}\n`); process.exitCode = 1; });
