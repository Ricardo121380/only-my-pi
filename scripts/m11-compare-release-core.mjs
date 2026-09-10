#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { hashFile, sha256, validateReleaseIndex } from "../packages/release-stack/index.mjs";

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

async function directory(target) {
  if (typeof target !== "string" || !path.isAbsolute(target)) fail("M11_CORE_COMPARE_ARGUMENT_INVALID", "release roots must be absolute");
  const stat = await fs.lstat(target).catch(() => null); const real = stat ? await fs.realpath(target) : null;
  if (!stat?.isDirectory() || stat.isSymbolicLink() || real !== path.resolve(target)) fail("M11_CORE_COMPARE_ROOT_UNSAFE", "release root is missing or unsafe");
  return real;
}

export async function compareM11ReleaseCore({ rcRoot, finalRoot } = {}) {
  const [rc, final] = await Promise.all([directory(rcRoot), directory(finalRoot)]);
  const [rcIndex, finalIndex] = await Promise.all([fs.readFile(path.join(rc, "release-index.json"), "utf8").then(JSON.parse).then(validateReleaseIndex), fs.readFile(path.join(final, "release-index.json"), "utf8").then(JSON.parse).then(validateReleaseIndex)]);
  if (rcIndex.status !== "RC" || finalIndex.status !== "PUBLISHED" || rcIndex.version !== finalIndex.version || rcIndex.sourceCommit !== finalIndex.sourceCommit || rcIndex.stackManifestSha256 !== finalIndex.stackManifestSha256) fail("M11_CORE_COMPARE_AUTHORITY_INVALID", "RC and Final release authority, version or source differs");
  const prefix = `only-my-pi-${rcIndex.version}`;
  const core = ["THIRD_PARTY_NOTICES.txt", "install.sh", `${prefix}-darwin-arm64-full.tar.gz`, `${prefix}-darwin-arm64-thin.tar.gz`, `${prefix}.spdx.json`, "stack-manifest.json", "transitive-artifact-ledger.json"];
  const files = [];
  for (const name of core) {
    const [left, right] = await Promise.all([hashFile(path.join(rc, name)), hashFile(path.join(final, name))]);
    if (left !== right) fail("M11_CORE_ASSET_DRIFT", `Final core asset differs from accepted RC: ${name}`);
    files.push({ name, sha256: left });
  }
  return Object.freeze({ ok: true, status: "M11_RC_FINAL_CORE_IDENTICAL", sourceCommit: finalIndex.sourceCommit, stackManifestSha256: finalIndex.stackManifestSha256, assetCount: files.length, coreDigest: sha256(JSON.stringify(files)) });
}

function parse(argv) { const result = { json: false }; for (let i = 0; i < argv.length; i += 1) { const token = argv[i]; if (token === "--json" && !result.json) result.json = true; else if (["--rc-root", "--final-root"].includes(token) && result[token === "--rc-root" ? "rcRoot" : "finalRoot"] === undefined) result[token === "--rc-root" ? "rcRoot" : "finalRoot"] = argv[++i]; else fail("M11_CORE_COMPARE_ARGUMENT_INVALID", `unsupported or duplicate argument: ${token}`); } return result; }
export async function main(argv = process.argv.slice(2)) { const options = parse(argv); const result = await compareM11ReleaseCore(options); process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`); return 0; }
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${JSON.stringify({ ok: false, status: "M11_CORE_COMPARE_FAILED", code: error?.code ?? "M11_CORE_COMPARE_FAILED", message: error?.message, errorDigest: sha256(String(error?.stack ?? error)) }, null, 2)}\n`); process.exitCode = 1; });
