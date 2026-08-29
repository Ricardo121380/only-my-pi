import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { canonicalJson } from "../config-runtime/index.mjs";
import { sha256 } from "./contracts.mjs";
import { hashFile } from "./deterministic-archive.mjs";
import { buildFullThinPayloads, inspectFullThinPayloadInputs } from "./release-builder.mjs";

const exec = promisify(execFile);
const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function outside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.startsWith("..") && !path.isAbsolute(relative);
}

async function defaultSourceInspector(rootDir) {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    exec("git", ["rev-parse", "HEAD"], { cwd: rootDir }),
    exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: rootDir, maxBuffer: 16 * 1024 * 1024 }),
  ]);
  return Object.freeze({ head: head.trim(), clean: status.trim().length === 0 });
}

async function realDirectory(target, code) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== path.resolve(target)) fail(code, `release build directory is unsafe: ${path.basename(target)}`);
  return path.resolve(target);
}

async function rootDigest(root) {
  return `sha256:${await hashResourcePath({ artifactRoot: path.dirname(root), relativePath: path.basename(root), allowContainedSymlinks: false })}`;
}

async function outputManifest(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("RELEASE_OUTPUT_UNSAFE", "release output cannot contain symlinks");
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const stat = await fs.lstat(target);
        files.push({ name: path.relative(root, target).split(path.sep).join("/"), bytes: stat.size, mode: stat.mode & 0o777, sha256: await hashFile(target) });
      } else fail("RELEASE_OUTPUT_UNSAFE", "release output contains a special file");
    }
  }
  await visit(root);
  return Object.freeze(files);
}

export class ReleaseBuildController {
  constructor({ rootDir, sourceInspector = defaultSourceInspector, builder = buildFullThinPayloads } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("release build controller requires an absolute rootDir");
    this.rootDir = path.resolve(rootDir);
    this.sourceInspector = sourceInspector;
    this.builder = builder;
  }

  async plan(options = {}) {
    const paths = [options.fullPayloadRoot, options.thinPayloadRoot, options.thinResolvedRoot, options.protectedReceiptPath, options.outputRoot];
    if (!paths.every((value) => typeof value === "string" && path.isAbsolute(value))) fail("RELEASE_BUILD_PATH_INVALID", "release build paths must be explicit absolute paths");
    if (!paths.every((value) => outside(this.rootDir, value))) fail("RELEASE_BUILD_PATH_IN_REPOSITORY", "release inputs and output must remain outside the Git checkout");
    if (!COMMIT.test(options.sourceCommit ?? "")) fail("RELEASE_BUILD_SOURCE_INVALID", "release source must be a full lowercase commit SHA");
    if (!DIGEST.test(options.protectedEvidenceDigest ?? "")) fail("RELEASE_BUILD_EVIDENCE_INVALID", "protected evidence digest must be a SHA-256 identity");
    if (!["RC", "PUBLISHED"].includes(options.status ?? "RC")) fail("RELEASE_BUILD_STATUS_INVALID", "release build status must be RC or PUBLISHED");
    const source = await this.sourceInspector(this.rootDir);
    if (source.head !== options.sourceCommit || source.clean !== true) fail("RELEASE_BUILD_SOURCE_NOT_CLEAN", "release build requires a clean checkout at the exact source commit");
    const [fullRoot, thinRoot, resolvedRoot, receipt] = await Promise.all([
      realDirectory(options.fullPayloadRoot, "RELEASE_BUILD_INPUT_UNSAFE"),
      realDirectory(options.thinPayloadRoot, "RELEASE_BUILD_INPUT_UNSAFE"),
      realDirectory(options.thinResolvedRoot, "RELEASE_BUILD_INPUT_UNSAFE"),
      fs.realpath(options.protectedReceiptPath).catch(() => null),
    ]);
    const receiptStat = receipt ? await fs.lstat(receipt) : null;
    if (receipt !== path.resolve(options.protectedReceiptPath) || !receiptStat?.isFile() || receiptStat.isSymbolicLink() || receiptStat.size < 1 || receiptStat.size > 16 * 1024 * 1024) fail("RELEASE_BUILD_RECEIPT_UNSAFE", "protected receipt is not a bounded regular file");
    if (await hashFile(receipt) !== options.protectedEvidenceDigest) fail("PROTECTED_EVIDENCE_DIGEST_MISMATCH", "protected receipt bytes differ from the reviewed digest");
    const parent = await realDirectory(path.dirname(options.outputRoot), "RELEASE_BUILD_OUTPUT_PARENT_UNSAFE");
    if (parent !== path.dirname(path.resolve(options.outputRoot))) fail("RELEASE_BUILD_OUTPUT_PARENT_UNSAFE", "release output parent is unsafe");
    if (await fs.lstat(options.outputRoot).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("RELEASE_BUILD_OUTPUT_EXISTS", "release output path already exists");
    const inspection = await inspectFullThinPayloadInputs({ fullPayloadRoot: fullRoot, thinPayloadRoot: thinRoot, thinResolvedRoot: resolvedRoot });
    if (inspection.fullMetadata.stackManifest.sourceCommit !== options.sourceCommit) fail("RELEASE_BUILD_SOURCE_BINDING_INVALID", "stack manifest is not bound to the selected source commit");
    const input = {
      full: await rootDigest(fullRoot),
      thin: await rootDigest(thinRoot),
      thinResolved: await rootDigest(resolvedRoot),
      protectedReceipt: options.protectedEvidenceDigest,
    };
    const plan = {
      formatVersion: 1,
      kind: "only-my-pi-release-build-plan",
      mutation: false,
      status: "RELEASE_BUILD_PLANNED",
      releaseStatus: options.status ?? "RC",
      sourceCommit: options.sourceCommit,
      stackId: inspection.fullMetadata.stackManifest.stackId,
      inputDigest: sha256(canonicalJson(input)),
      outputClass: "EXPLICIT_NON_REPOSITORY_DIRECTORY",
      networkRequired: false,
      reproducibilityBuilds: 2,
    };
    plan.planDigest = sha256(canonicalJson(plan));
    return Object.freeze(plan);
  }

  async apply(options = {}, reviewedPlan) {
    const plan = await this.plan(options);
    if (plan.planDigest !== reviewedPlan?.planDigest) fail("RELEASE_BUILD_PLAN_DRIFT", "release inputs changed after the reviewed plan");
    const parent = path.dirname(path.resolve(options.outputRoot));
    const temporary = await fs.mkdtemp(path.join(parent, ".only-my-pi-release-"));
    await fs.chmod(temporary, 0o700);
    const left = path.join(temporary, "first");
    const right = path.join(temporary, "second");
    const buildOptions = {
      fullPayloadRoot: options.fullPayloadRoot,
      thinPayloadRoot: options.thinPayloadRoot,
      thinResolvedRoot: options.thinResolvedRoot,
      protectedReceiptPath: options.protectedReceiptPath,
      protectedEvidenceDigest: options.protectedEvidenceDigest,
      status: options.status ?? "RC",
    };
    try {
      const first = await this.builder({ ...buildOptions, outputRoot: left });
      const second = await this.builder({ ...buildOptions, outputRoot: right });
      const [firstFiles, secondFiles] = await Promise.all([outputManifest(left), outputManifest(right)]);
      if (canonicalJson(firstFiles) !== canonicalJson(secondFiles)) fail("RELEASE_BUILD_NOT_REPRODUCIBLE", "two isolated release builds produced different bytes");
      if (first.stackId !== plan.stackId || second.stackId !== plan.stackId) fail("RELEASE_BUILD_STACK_DRIFT", "release builder produced an unexpected stack identity");
      await fs.rename(left, options.outputRoot);
      return Object.freeze({
        ok: true,
        status: "RELEASE_BUILD_COMMITTED",
        mutation: true,
        sourceCommit: plan.sourceCommit,
        stackId: plan.stackId,
        releaseStatus: plan.releaseStatus,
        outputClass: plan.outputClass,
        reproducible: true,
        assetCount: firstFiles.length,
        outputDigest: sha256(canonicalJson(firstFiles)),
      });
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}

export function createReleaseBuildController(options) {
  return new ReleaseBuildController(options);
}
