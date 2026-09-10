#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createReleaseBuildController, createReleasePayloadStager, createThinPayloadResolver, hashFile, sha256 } from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function outside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function buildM11WorkflowRelease({
  rootDir = ROOT,
  sourceCommit,
  outputRoot,
  releaseStatus = "RC",
  protectedReceiptPath = null,
  workParent = os.tmpdir(),
  stager = createReleasePayloadStager({ rootDir }),
  thinResolver = createThinPayloadResolver(),
  controller = createReleaseBuildController({ rootDir }),
} = {}) {
  if (!COMMIT.test(sourceCommit ?? "") || typeof outputRoot !== "string" || !path.isAbsolute(outputRoot) || !outside(rootDir, outputRoot) || !["RC", "PUBLISHED"].includes(releaseStatus)) fail("M11_WORKFLOW_BUILD_ARGUMENT_INVALID", "workflow build requires exact source, status and non-repository output");
  if (releaseStatus === "PUBLISHED" && (typeof protectedReceiptPath !== "string" || !path.isAbsolute(protectedReceiptPath))) fail("M11_WORKFLOW_BUILD_EVIDENCE_REQUIRED", "published build requires an absolute protected receipt");
  const parent = await fs.realpath(workParent);
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(parent, "only-my-pi-workflow-build-")));
  await fs.chmod(workspace, 0o700);
  try {
    const stageOptions = { sourceCommit, outputRoot: path.join(workspace, "stage") };
    const staged = await stager.apply(stageOptions, await stager.plan(stageOptions));
    const [stackManifest, ledger] = await Promise.all([
      fs.readFile(path.join(staged.thinPayloadRoot, "stack-manifest.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(staged.thinPayloadRoot, "transitive-artifact-ledger.json"), "utf8").then(JSON.parse),
    ]);
    const thinResolvedRoot = await thinResolver({ payloadRoot: staged.thinPayloadRoot, cacheRoot: workspace, inspection: { stackManifest }, metadata: { ledger } });
    let receipt = protectedReceiptPath;
    if (releaseStatus === "RC") {
      receipt = path.join(workspace, "rc-build-receipt.json");
      await fs.writeFile(receipt, `${JSON.stringify({ formatVersion: 1, kind: "only-my-pi-rc-build-receipt", status: "HOLD_PUBLICATION", sourceCommit, stackId: staged.stackId, protectedLiveMatrix: false, publicationAuthority: false }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    }
    const buildOptions = { fullPayloadRoot: staged.fullPayloadRoot, thinPayloadRoot: staged.thinPayloadRoot, thinResolvedRoot, protectedReceiptPath: receipt, protectedEvidenceDigest: await hashFile(receipt), outputRoot, sourceCommit, status: releaseStatus };
    const built = await controller.apply(buildOptions, await controller.plan(buildOptions));
    if (built.stackId !== staged.stackId || built.reproducible !== true) fail("M11_WORKFLOW_BUILD_IDENTITY_MISMATCH", "workflow build did not preserve the staged reproducible stack identity");
    return Object.freeze({ formatVersion: 1, ok: true, status: "M11_WORKFLOW_RELEASE_BUILT", releaseStatus, sourceCommit, stackId: staged.stackId, outputDigest: built.outputDigest, assetCount: built.assetCount, reproducible: true, protectedAuthority: releaseStatus === "PUBLISHED", published: false });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

export function parseM11WorkflowBuildArgs(argv) {
  const result = { json: false, releaseStatus: "RC", protectedReceiptPath: null };
  const values = new Map([["--source-commit", "sourceCommit"], ["--output", "outputRoot"], ["--status", "releaseStatus"], ["--protected-receipt", "protectedReceiptPath"]]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") { if (seen.has(token)) fail("M11_WORKFLOW_BUILD_ARGUMENT_INVALID", "duplicate --json"); seen.add(token); result.json = true; continue; }
    if (!values.has(token) || seen.has(token)) fail("M11_WORKFLOW_BUILD_ARGUMENT_INVALID", `unsupported or duplicate argument: ${token}`);
    seen.add(token);
    const value = argv[++index];
    if (!value || value.startsWith("--") || /[\0\r\n]/u.test(value)) fail("M11_WORKFLOW_BUILD_ARGUMENT_INVALID", `${token} requires a value`);
    result[values.get(token)] = value;
  }
  if (!result.sourceCommit || !result.outputRoot) fail("M11_WORKFLOW_BUILD_ARGUMENT_INVALID", "--source-commit and --output are required");
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseM11WorkflowBuildArgs(argv);
  const result = await buildM11WorkflowRelease(options);
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${JSON.stringify({ ok: false, status: "M11_WORKFLOW_BUILD_FAILED", code: error?.code ?? "M11_WORKFLOW_BUILD_FAILED", message: error?.message, errorDigest: sha256(String(error?.stack ?? error)) }, null, 2)}\n`); process.exitCode = 1; });
